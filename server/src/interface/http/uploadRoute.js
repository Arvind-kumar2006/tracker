/**
 * Upload ingestion — accepts .xlsx bytes from the mobile app.
 *
 * The RN app does NOT parse spreadsheets locally: SheetJS needs fs/Buffer polyfills in React
 * Native, and duplicating the normaliser in two places guarantees the two drift apart. The app
 * picks a folder, reads the bytes, and uploads them; the server owns normalisation.
 *
 * Body: { folder?, files: [{ name, base64 }], recursive?, force?, asOf? }
 */

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ok, err } from '../../shared/result.js';
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';
import { normalizeWorkbook } from '../../domain/services/WorkbookNormalizer.js';
import { calculateMetrics } from '../../domain/services/MetricsCalculator.js';
import * as XLSX from 'xlsx';
import { container, bootstrap } from '../../shared/di/container.js';

/** Guards against a runaway upload from a malformed client. */
const MAX_FILES = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Magic bytes: .xlsx/.xlsm are ZIP archives; legacy .xls is OLE2 compound-file. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

function looksLikeSpreadsheet(buffer) {
  if (buffer.length < 4) return false;
  return ZIP_MAGIC.equals(buffer.subarray(0, 4)) || OLE2_MAGIC.equals(buffer.subarray(0, 4));
}

/**
 * Parse an in-memory spreadsheet into raw row arrays.
 *
 * SheetJS is extremely lenient and will happily "parse" arbitrary bytes into a single-sheet
 * workbook, so the container is sniffed first. Without this, any base64 blob the phone sends
 * would come back as a nonsensical sheet rather than being rejected.
 *
 * @returns {Array<{name: string, rows: Array}>|null} null when the bytes are not a spreadsheet
 */
export function parseWorkbookBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !looksLikeSpreadsheet(buffer)) return null;

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  } catch {
    return null;
  }
  if (!workbook?.SheetNames?.length) return null;

  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    }),
  }));
}

/**
 * Apply uploaded workbooks. Split from the HTTP layer so it is directly testable.
 */
export async function ingestUploads({ files, folder, recursive = false, force = false, asOf, repositories }) {
  const { dailyLogRepository, monthRepository, importLogRepository, quarantineRepository } = repositories;

  if (!Array.isArray(files) || files.length === 0) {
    return err(new DomainError(ErrorCode.FILE_NOT_READABLE, 'no files were uploaded'));
  }
  if (files.length > MAX_FILES) {
    return err(new DomainError(ErrorCode.FILE_NOT_READABLE, `too many files (${files.length}); limit is ${MAX_FILES}`));
  }

  const structurallyInvalid = files.filter((f) => !f || typeof f.name !== 'string' || typeof f.base64 !== 'string');
  if (structurallyInvalid.length === files.length) {
    // Every entry was junk. Returning 200 with "skipped: everything" reads as success while
    // importing nothing, which is how a client bug stays invisible for months.
    return err(
      new DomainError(
        ErrorCode.FILE_NOT_READABLE,
        `none of the ${files.length} uploaded entries had a name and base64 payload`,
        { received: files.length }
      )
    );
  }

  const results = [];
  const skipped = [...structurallyInvalid.map((f) => ({ fileName: f?.name ?? '(unnamed)', reason: 'missing name or base64 payload' }))];

  for (const file of files) {
    if (!file?.name || typeof file.base64 !== 'string') continue; // already counted above

    let buffer;
    try {
      buffer = Buffer.from(file.base64, 'base64');
    } catch {
      skipped.push({ fileName: file.name, reason: 'payload was not valid base64' });
      continue;
    }

    if (buffer.length === 0) {
      skipped.push({ fileName: file.name, reason: 'file was empty' });
      continue;
    }
    if (buffer.length > MAX_FILE_BYTES) {
      skipped.push({ fileName: file.name, reason: `file exceeds ${MAX_FILE_BYTES} bytes` });
      continue;
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    // Same dedupe rule as the folder scan (FR-1.7): an unchanged file is a no-op.
    if (!force && (await importLogRepository.hasBeenImported(sha256))) {
      skipped.push({ fileName: file.name, reason: 'already imported (identical sha256)' });
      continue;
    }

    const sheets = parseWorkbookBuffer(buffer);
    if (!sheets || sheets.length === 0) {
      skipped.push({ fileName: file.name, reason: 'not a readable .xlsx file' });
      continue;
    }

    for (const sheet of sheets) {
      let normalised;
      try {
        normalised = normalizeWorkbook({ rows: sheet.rows, fileName: file.name, sheetName: sheet.name });
      } catch (e) {
        if (e instanceof DomainError) {
          skipped.push({ fileName: file.name, sheet: sheet.name, reason: e.message });
          continue;
        }
        throw e;
      }

      if (normalised.entries.length === 0) {
        skipped.push({ fileName: file.name, sheet: sheet.name, reason: 'no daily rows detected' });
        continue;
      }

      await quarantineRepository.insertMany(normalised.quarantined);
      const write = await dailyLogRepository.upsertMany(normalised.entries, { fileName: file.name });

      const byMonth = new Map();
      for (const e of normalised.entries) {
        if (!byMonth.has(e.month)) byMonth.set(e.month, []);
        byMonth.get(e.month).push(e);
      }
      for (const [month, monthEntries] of byMonth) {
        const metrics = calculateMetrics({
          entries: monthEntries,
          month,
          asOf: asOf ?? new Date().toISOString().slice(0, 10),
        });
        const existing = await monthRepository.find(month);
        await monthRepository.upsert(month, metrics, existing?.monthlyGoal ?? null, existing?.targetDailyHours ?? null);
      }

      const logEntry = {
        sha256,
        fileName: file.name,
        sheetName: sheet.name,
        source: 'mobile-upload',
        folder: folder ?? null,
        headerRow: normalised.meta.headerRow,
        rowsPopulated: normalised.meta.rowsPopulated,
        rowsParsed: normalised.meta.rowsParsed,
        rowsQuarantined: normalised.meta.rowsQuarantined,
        daysWithData: normalised.meta.daysWithData,
        months: normalised.meta.months,
        unitDecisions: Object.fromEntries(
          Object.entries(normalised.meta.unitDecisions).map(([k, v]) => [k, { unit: v.unit, confidence: v.confidence }])
        ),
        userSummary: normalised.summary,
        agreement: normalised.agreement,
        status: 'OK',
      };
      await importLogRepository.record(logEntry);
      results.push({ ...logEntry, sheetsWritten: write });
    }
  }

  return ok({
    source: 'mobile-upload',
    filesReceived: files.length,
    imported: results,
    skipped,
    months: [...new Set(results.flatMap((r) => r.months ?? []))],
  });
}

/** Uploads carry base64 spreadsheets, so this route gets its own, larger body limit. */
export const UPLOAD_BODY_LIMIT = '32mb';

export function uploadRouter({ bodyLimit = UPLOAD_BODY_LIMIT } = {}) {
  const router = express.Router();

  // Mounted with its own parser so the app-wide 1mb limit does not reject a 5 MB workbook.
  router.use(express.json({ limit: bodyLimit }));

  router.post('/api/import/upload', async (req, res) => {
    await bootstrap();
    const { files, folder, recursive, force, asOf } = req.body ?? {};
    const result = await ingestUploads({
      files,
      folder,
      recursive,
      force,
      asOf,
      repositories: {
        dailyLogRepository: container.dailyLogRepository,
        monthRepository: container.monthRepository,
        importLogRepository: container.importLogRepository,
        quarantineRepository: container.quarantineRepository,
      },
    });
    if (!result.ok) return res.status(400).json({ error: result.error.toJSON() });
    res.json(result.value);
  });

  return router;
}

export { MAX_FILES, MAX_FILE_BYTES };