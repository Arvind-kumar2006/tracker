/**
 * SheetsMirror — projects committed Mongo documents into the Google Sheet.
 *
 * Write order matters: Mongo commits first, Sheets second. A Sheets failure therefore leaves the
 * database correct and the sheet merely stale, which the next sync repairs. The reverse would let
 * a half-written sheet become the apparent source of truth.
 *
 * Idempotency: every tab has a natural key in column 0. Each sync reads that column, builds an
 * index, and either UPDATEs the exact row or APPENDs when the key is new. Re-running a sync
 * produces byte-identical content and zero new rows.
 */

import { TAB_SCHEMA, TABS, colLetter } from './sheetSchema.js';
import { mapTab, keyOfRow } from './rowMappers.js';
import { planWrites, planRangeUpdates, parseKeyColumn } from './writePlanner.js';

export const WORKBOOK_TITLE = 'Study Accountability Tracker';

/** Tab order and initial sizing for a fresh workbook. */
const CREATE_PLAN = [
  { title: TABS.MONTHS, cols: 20, rows: 1000 },
  { title: TABS.DAILY_LOG, cols: TAB_SCHEMA[TABS.DAILY_LOG].headers.length, rows: 2000 },
  { title: TABS.TIME_BLOCKS, cols: 12, rows: 3000 },
  { title: TABS.BLOCKERS, cols: 10, rows: 3000 },
  { title: TABS.AI_INSIGHTS, cols: 17, rows: 2000 },
  { title: TABS.PLAN_CRITIQUES, cols: 11, rows: 2000 },
  { title: TABS.IMPORT_LOG, cols: 14, rows: 1000 },
];

/**
 * Create the workbook with every tab, header row, frozen header and column widths.
 * Idempotent: an existing workbook is returned untouched.
 */
export async function ensureWorkbook(client, { title = WORKBOOK_TITLE, spreadsheetId = null, userEmail = null } = {}) {
  if (spreadsheetId) {
    const existing = await client.getSpreadsheet(spreadsheetId); // throws if unreachable/invalid
    // An existing blank spreadsheet (the common first-run case) has only `Sheet1`. Add the
    // tracker tabs while preserving any user-created tabs and data.
    if (Array.isArray(existing.sheets)) {
      const missing = CREATE_PLAN.filter(
        (plan) => !existing.sheets.some((sheet) => sheet.properties?.title === plan.title)
      );
      if (missing.length) {
        await client.batchUpdate(
          spreadsheetId,
          missing.map((plan) => ({
            addSheet: {
              properties: {
                title: plan.title,
                gridProperties: { rowCount: plan.rows, columnCount: plan.cols },
              },
            },
          }))
        );

      }

      // Also refresh headers for existing tabs. This is a small schema migration for fields
      // added after the workbook was first created (including the mobile reflection columns).
      const refreshed = missing.length ? await client.getSpreadsheet(spreadsheetId) : existing;
      const presentPlans = CREATE_PLAN.filter(
        (plan) => refreshed.sheets?.some((sheet) => sheet.properties?.title === plan.title)
      );
      if (presentPlans.length) {
        await client.batchUpdate(spreadsheetId, buildSetupRequests(refreshed, presentPlans));
      }
    }
    return { spreadsheetId, created: false, url: sheetUrl(spreadsheetId) };
  }

  const created = await client.createSpreadsheet({
    title,
    sheets: CREATE_PLAN.map((s, i) => ({ sheetId: i, title: s.title, cols: s.cols, rows: s.rows })),
  });

  const id = created.spreadsheetId;

  await client.batchUpdate(id, buildSetupRequests(created, CREATE_PLAN));

  // The workbook is owned by the service account, so it is invisible to the human until shared.
  let shared = false;
  if (userEmail) {
    try {
      await client.share(id, userEmail, 'writer');
      shared = true;
    } catch {
      shared = false;
    }
  }

  return { spreadsheetId: id, created: true, url: sheetUrl(id), sharedWith: shared ? userEmail : null };
}

const sheetIdFor = (created, title) => {
  const found = (created.sheets ?? []).find((s) => s.properties.title === title);
  return found ? found.properties.sheetId : 0;
};

function buildSetupRequests(spreadsheet, plans) {
  const requests = [];
  for (const plan of plans) {
    const schema = TAB_SCHEMA[plan.title];
    const sheetId = sheetIdFor(spreadsheet, plan.title);
    const sheet = (spreadsheet.sheets ?? []).find((s) => s.properties?.title === plan.title);
    if (sheetId === 0 && !sheet) continue;

    // Existing workbooks can have been created with an older schema. Google rejects an
    // updateCells request when the header is wider than the tab's current grid, so resize the
    // grid before writing the current header. Never shrink a user's existing sheet.
    const grid = sheet?.properties?.gridProperties ?? {};
    const rowCount = Math.max(Number(grid.rowCount) || 0, plan.rows);
    const columnCount = Math.max(Number(grid.columnCount) || 0, schema.headers.length);

    // Resize the grid and freeze the header before writing it. The order matters for old
    // workbooks whose grid is narrower than the current schema.
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1, rowCount, columnCount } },
        fields: 'gridProperties.frozenRowCount,gridProperties.rowCount,gridProperties.columnCount',
      },
    });

    // Header row.
    requests.push({
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        rows: [{ values: schema.headers.map((h) => ({ userEnteredValue: { stringValue: h } })) }],
        fields: 'userEnteredValue',
      },
    });

    // Column widths from the schema.
    schema.widths.forEach((width, col) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 },
          properties: { pixelSize: width },
          fields: 'pixelSize',
        },
      });
    });
  }
  return requests;
}

export const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/**
 * Sync one tab.
 *
 * @param {object} args
 * @param {Array} args.docs - Mongo documents to project
 * @param {string} args.tab
 * @param {boolean} [args.dryRun] - plan only, perform no writes
 */
export async function syncTab({ client, spreadsheetId, tab, docs, dryRun = false, now = undefined }) {
  const schema = TAB_SCHEMA[tab];
  if (!schema) throw new Error(`unknown tab "${tab}"`);

  // `now` is injectable so a dry run and a real run over identical data produce identical
  // output — which is what makes "a re-sync changes nothing" a testable claim.
  const rows = mapTab(tab, docs, now);
  const colCount = schema.headers.length;

  const malformed = rows.filter((r) => r.length !== colCount);
  if (malformed.length) {
    // A mapper/header mismatch would silently shift every column to the left. Fail loudly.
    throw new Error(
      `tab "${tab}": ${malformed.length} row(s) do not match ${colCount} headers. Mapper and schema have drifted.`
    );
  }

  // Read ONLY the key column. Fetching full row width for 2,000 rows to learn one column wastes
  // quota and, more importantly, the API's response shape for a single column is
  // [[v1],[v2],...] — parseKeyColumn relies on that contract.
  const existingValues = await client.readRange(spreadsheetId, `'${tab}'!${colLetter(0)}:${colLetter(0)}`);
  const existingKeys = parseKeyColumn(existingValues);

  const { writes, updateCount } = planRangeUpdates({ rows, existingKeys, colCount });
  const { appends } = planWrites({ rows, existingKeys });

  if (dryRun) {
    return {
      tab,
      rows: rows.length,
      updates: updateCount,
      appends: appends.length,
      rangeWrites: writes.map((w) => `rows ${w.startRow}-${w.endRow}`),
      dryRun: true,
    };
  }

  // Contiguous existing rows become one write each, keeping the request count low.
  for (const w of writes) {
    const lastCol = colLetter(colCount - 1);
    await client.writeRange(spreadsheetId, `'${tab}'!A${w.startRow}:${lastCol}${w.endRow}`, w.values);
  }

  // Only genuinely new keys are appended.
  if (appends.length) {
    await client.appendRange(spreadsheetId, `'${tab}'!A1`, appends.map((a) => a.row));
  }

  return {
    tab,
    rows: rows.length,
    updates: updateCount,
    appends: appends.length,
    rangeWrites: writes.length,
    dryRun: false,
  };
}

/**
 * Project a whole month across every tab.
 * `sources` supplies the already-loaded Mongo documents, so this function performs no reads.
 */
export async function syncMonth({ client, spreadsheetId, sources, dryRun = false, now = undefined }) {
  if (!dryRun) {
    // Ensure existing workbooks receive current headers before rows are projected. This is
    // idempotent and also creates any tracker tabs missing from an older connected workbook.
    await ensureWorkbook(client, { spreadsheetId });
  }

  const results = [];
  const plan = [
    [TABS.MONTHS, sources.months],
    [TABS.DAILY_LOG, sources.dailyLogs],
    [TABS.TIME_BLOCKS, sources.dailyLogs],
    [TABS.BLOCKERS, sources.dailyLogs],
    [TABS.AI_INSIGHTS, sources.insights],
    [TABS.PLAN_CRITIQUES, sources.planCritiques],
    [TABS.IMPORT_LOG, sources.importLogs],
  ];

  for (const [tab, docs] of plan) {
    if (!docs || docs.length === 0) {
      results.push({ tab, rows: 0, updates: 0, appends: 0, skipped: true });
      continue;
    }
    results.push(await syncTab({ client, spreadsheetId, tab, docs, dryRun, now }));
  }

  return {
    spreadsheetId,
    url: sheetUrl(spreadsheetId),
    tabs: results,
    totals: {
      rows: results.reduce((s, r) => s + (r.rows ?? 0), 0),
      updates: results.reduce((s, r) => s + (r.updates ?? 0), 0),
      appends: results.reduce((s, r) => s + (r.appends ?? 0), 0),
    },
    dryRun,
  };
}

export { TABS, keyOfRow };
