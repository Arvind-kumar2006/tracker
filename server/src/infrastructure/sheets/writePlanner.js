/**
 * WritePlanner — decides what to UPDATE and what to APPEND.
 *
 * This is the whole of Sheets idempotency (FR-6.4), expressed as a pure function so it can be
 * exhaustively tested without a Google account. The adapter just executes the plan.
 *
 * The problem: Sheets has no unique constraint and no upsert. Left naive, every sync appends a
 * duplicate of every row. The fix is to read the key column, build an index, and address each
 * record's exact row.
 *
 * Row 1 is the header, so data starts at row 2. Rows are addressed 1-indexed.
 */

/**
 * @param {object} args
 * @param {Array<Array>} args.rows       - rows to write, each starting with its key in column 0
 * @param {Array<string>} args.existingKeys - key column as currently stored in the sheet
 * @param {number} [args.firstDataRow]  - default 2 (header occupies row 1)
 * @returns {{updates: Array, appends: Array, unchanged: number, plan: string[]}}
 */
export function planWrites({ rows, existingKeys, firstDataRow = 2 }) {
  const index = new Map();
  existingKeys.forEach((k, i) => {
    const key = String(k ?? '').trim();
    if (key !== '') index.set(key, firstDataRow + i);
  });

  const updates = [];
  const appends = [];
  const unchanged = [];
  const used = new Set();

  for (const row of rows) {
    const key = row?.[0] === null || row?.[0] === undefined ? '' : String(row[0]).trim();
    if (key === '') {
      appends.push({ key: '', row });
      continue;
    }
    if (used.has(key)) {
      // Two records claiming the same key would make the sync non-idempotent (each run would
      // append a new duplicate). Surface it rather than silently writing both.
      appends.push({ key, row, duplicateKey: true });
      continue;
    }
    used.add(key);

    if (index.has(key)) {
      const rowNumber = index.get(key);
      updates.push({ key, rowNumber, row, range: { startRow: rowNumber, endRow: rowNumber } });
    } else {
      appends.push({ key, row });
    }
  }

  return {
    updates,
    appends,
    unchanged: rows.length - updates.length - appends.length,
    plan: [
      ...updates.map((u) => `UPDATE row ${u.rowNumber} (${u.key})`),
      ...appends.map((a) => `APPEND (${a.key || '<blank>'})`),
    ],
  };
}

/**
 * Extract the key column from a Sheets range response.
 *
 * The API returns a single-column range as [[v1],[v2],...] — an array of one-element rows.
 * This must NOT be flattened with `flatMap`, which would collapse the rows into one list and
 * lose the positional relationship to sheet rows. Taking column 0 of each row preserves both
 * the value and its position.
 *
 * @param {Array<Array|string>>} values
 * @returns {string[]} keys in sheet order, header excluded, trailing blanks trimmed
 */
export function parseKeyColumn(values) {
  const body = (values ?? [])
    .map((r) => (Array.isArray(r) ? (r[0] ?? '') : (r ?? '')))
    .map((v) => String(v).trim());

  // Row 1 is the header.
  const out = body.slice(1);
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** Contiguous A1 ranges for a set of rows, so bulk writes stay under the request quota. */
export function groupContiguous(rowNumbers) {
  if (rowNumbers.length === 0) return [];
  const sorted = [...rowNumbers].sort((a, b) => a - b);
  const groups = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    groups.push([start, prev]);
    start = n;
    prev = n;
  }
  groups.push([start, prev]);
  return groups;
}

/**
 * Collapse per-row updates into contiguous range writes where possible.
 * Sheets bills by request, so a month of 31 scattered rows is far cheaper as 2–3 writes.
 */
export function planRangeUpdates({ rows, existingKeys, firstDataRow = 2, colCount }) {
  const { updates } = planWrites({ rows, existingKeys, firstDataRow });
  const byRow = new Map(updates.map((u) => [u.rowNumber, u.row]));

  const writes = [];
  for (const [from, to] of groupContiguous([...byRow.keys()])) {
    const height = to - from + 1;
    const values = [];
    for (let r = from; r <= to; r++) {
      values.push(byRow.get(r) ?? new Array(colCount).fill(''));
    }
    writes.push({ startRow: from, endRow: to, height, values });
  }
  return { writes, updateCount: updates.length };
}