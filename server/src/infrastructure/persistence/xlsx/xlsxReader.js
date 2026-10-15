/**
 * XlsxReader — infrastructure adapter for reading a workbook off disk.
 * Lives in infrastructure because it depends on SheetJS; the domain never sees `xlsx`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { DomainError, ErrorCode } from '../../../domain/errors/DomainError.js';

const XLSX_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xls']);

/** Recursively list spreadsheet files in a directory. */
export async function listSpreadsheets(dir, { recursive = false } = {}) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (cause) {
    throw new DomainError(ErrorCode.FILE_NOT_READABLE, `cannot read directory ${dir}`, { cause: String(cause) });
  }

  const out = [];
  for (const entry of entries) {
    // macOS resource-fork and Office lock files are noise, skip them.
    if (entry.name.startsWith('~$') || entry.name.startsWith('._')) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...(await listSpreadsheets(full, { recursive })));
    } else if (XLSX_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out.sort();
}

export async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Read a workbook into plain row arrays.
 *
 * @returns {{fileName, filePath, sha256, sheets: [{name, rows}]}}
 */
export async function readWorkbook(filePath) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (cause) {
    throw new DomainError(ErrorCode.FILE_NOT_READABLE, `cannot read file ${filePath}`, { cause: String(cause) });
  }

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });

  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1, // array-of-arrays: preserves the true column positions the normaliser needs
      raw: true,
      defval: null,
      blankrows: true,
    }),
  }));

  return {
    fileName: path.basename(filePath),
    filePath,
    sha256: hash,
    sheets,
  };
}

/** Read every spreadsheet in a directory and return parsed sheets ready for normalisation. */
export async function readFolder(dir, { recursive = false } = {}) {
  const files = await listSpreadsheets(dir, { recursive });
  const workbooks = [];
  for (const file of files) {
    workbooks.push(await readWorkbook(file));
  }
  return { dir, workbooks };
}