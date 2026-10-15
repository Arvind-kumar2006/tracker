/**
 * ImportWorkbooks — the Phase 1 application use case.
 *
 * Orchestrates: scan folder -> read workbook -> normalise -> reconcile -> persist.
 * Returns Result, never throws across the layer boundary (clean arch rule 5).
 * Depends only on PORTS; the concrete xlsx and Mongo adapters are injected by the container.
 */

import { ok, err } from '../../shared/result.js';
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';
import { normalizeWorkbook } from '../../domain/services/WorkbookNormalizer.js';
import { calculateMetrics } from '../../domain/services/MetricsCalculator.js';

/**
 * @param {object} deps
 * @param {{listSpreadsheets: Function, readWorkbook: Function}} deps.workbookReader
 * @param {{upsertMany: Function}} deps.dailyLogRepository
 * @param {{upsert: Function}} deps.monthRepository
 * @param {{hasBeenImported: Function, record: Function}} deps.importLogRepository
 * @param {{insertMany: Function}} deps.quarantineRepository
 * @param {string} deps.folder
 * @param {boolean} [deps.recursive]
 * @param {boolean} [deps.force] - re-import even if the sha256 was seen before
 * @param {string} [deps.asOf] - injectable "today" for deterministic tests
 */
export async function importWorkbooks({
  workbookReader,
  dailyLogRepository,
  monthRepository,
  importLogRepository,
  quarantineRepository,
  folder,
  recursive = false,
  force = false,
  asOf = new Date().toISOString().slice(0, 10),
}) {
  let files;
  try {
    files = await workbookReader.listSpreadsheets(folder, { recursive });
  } catch (e) {
    return err(
      e instanceof DomainError
        ? e
        : new DomainError(ErrorCode.FILE_NOT_READABLE, `folder scan failed: ${e.message}`, { folder })
    );
  }

  if (files.length === 0) {
    return err(
      new DomainError(ErrorCode.FILE_NOT_READABLE, `no .xlsx files found in ${folder}`, { folder, searched: files.length })
    );
  }

  const results = [];
  const skipped = [];

  for (const filePath of files) {
    let workbook;
    try {
      workbook = await workbookReader.readWorkbook(filePath);
    } catch (e) {
      const record = {
        sha256: `error:${filePath}`,
        fileName: filePath,
        status: 'FAILED',
        error: e.message,
      };
      await importLogRepository.record(record);
      results.push({ ...record, fileName: filePath });
      continue;
    }

    // FR-1.7: skip a file we have already ingested unless forced.
    if (!force && (await importLogRepository.hasBeenImported(workbook.sha256))) {
      skipped.push({ fileName: workbook.fileName, reason: 'already imported (identical sha256)' });
      continue;
    }

    // The reference workbook has one sheet. Multiple sheets are handled independently so a
    // stray "Notes" tab does not break the import.
    for (const sheet of workbook.sheets) {
      let normalised;
      try {
        normalised = normalizeWorkbook({ rows: sheet.rows, fileName: workbook.fileName, sheetName: sheet.name });
      } catch (e) {
        if (e instanceof DomainError) {
          skipped.push({ fileName: workbook.fileName, sheet: sheet.name, reason: e.message });
          continue;
        }
        throw e;
      }

      if (normalised.entries.length === 0) {
        skipped.push({ fileName: workbook.fileName, sheet: sheet.name, reason: 'no daily rows detected' });
        continue;
      }

      // Persist quarantined values FIRST so they survive even if persistence later fails.
      await quarantineRepository.insertMany(normalised.quarantined);

      const write = await dailyLogRepository.upsertMany(normalised.entries, { fileName: workbook.fileName });

      // Split metrics by month — the schema is month-scoped.
      const byMonth = new Map();
      for (const e of normalised.entries) {
        if (!byMonth.has(e.month)) byMonth.set(e.month, []);
        byMonth.get(e.month).push(e);
      }

      const monthSummaries = [];
      for (const [month, monthEntries] of byMonth) {
        const metrics = calculateMetrics({ entries: monthEntries, month, asOf });
        const existing = await monthRepository.find(month);
        await monthRepository.upsert(
          month,
          metrics,
          existing?.monthlyGoal ?? null,
          existing?.targetDailyHours ?? null
        );
        monthSummaries.push({ month, metrics });
      }

      const logEntry = {
        sha256: workbook.sha256,
        fileName: workbook.fileName,
        filePath: workbook.filePath,
        sheetName: sheet.name,
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
    folder,
    filesFound: files.length,
    imported: results,
    skipped,
    months: results.flatMap((r) => r.months ?? []).filter((v, i, a) => a.indexOf(v) === i),
  });
}