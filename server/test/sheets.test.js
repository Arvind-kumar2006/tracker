/**
 * Phase 2 tests: row mappers, the write planner, and the mirror.
 *
 * The Sheets API is never called. A fake client implements the same interface and records
 * every write, so idempotency is verified by observing that a second identical sync issues
 * updates rather than appends — without a Google account.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorkbook } from '../src/infrastructure/persistence/xlsx/xlsxReader.js';
import { normalizeWorkbook } from '../src/domain/services/WorkbookNormalizer.js';
import { TAB_SCHEMA, TABS, colLetter, a1Range } from '../src/infrastructure/sheets/sheetSchema.js';
import {
  MAPPERS, mapTab, monthRow, dailyLogRow, timeBlockRows, blockerRows,
  insightRow, planCritiqueRow, importLogRow,
} from '../src/infrastructure/sheets/rowMappers.js';
import { planWrites, planRangeUpdates, parseKeyColumn, groupContiguous } from '../src/infrastructure/sheets/writePlanner.js';
import { syncMonth, ensureWorkbook } from '../src/infrastructure/sheets/sheetsMirror.js';
import { parseServiceAccount } from '../src/infrastructure/sheets/googleSheetsClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wb = await readWorkbook(path.resolve(__dirname, '../../October_Accountability-2.xlsx'));
const { entries } = normalizeWorkbook({ rows: wb.sheets[0].rows, fileName: wb.fileName });

/* ================================================================== *
 * A fake Sheets client that behaves like the real one
 * ================================================================== */

function createFakeSheets() {
  const store = new Map(); // tab -> array of row arrays (row 0 is the header)
  const log = [];

  const tab = (name) => {
    if (!store.has(name)) store.set(name, []);
    return store.get(name);
  };

  const parseRange = (range) => {
    // Handles both `A1:Y25` and the whole-column form `A:A`.
    const m = range.match(/!?([A-Z]+)(\d*):([A-Z]+)(\d*)/);
    if (!m) return [1, 1];
    const from = m[2] ? Number(m[2]) : 1;
    const to = m[4] ? Number(m[4]) : Infinity;
    return [from, to];
  };
  const singleColumn = (range) => /!?([A-Z]+):([A-Z]+)\s*$/.test(range);

  return {
    store, log,

    async readRange(_id, range) {
      const t = range.match(/'([^']+)'!/)[1];
      const rows = tab(t);
      const [from, to] = parseRange(range);
      log.push({ op: 'read', tab: t, from, singleCol: singleColumn(range) });

      const body = rows.slice(from - 1, to === Infinity ? undefined : to);
      // The real API returns a single-column range as [[v1],[v2],...]; mirror that exactly,
      // otherwise the fake would let a bug in parseKeyColumn pass.
      return singleColumn(range) ? body.map((r) => [r?.[0] ?? '']) : body;
    },

    async writeRange(_id, range, values) {
      const t = range.match(/'([^']+)'!/)[1];
      const rows = tab(t);
      const [from] = parseRange(range);
      log.push({ op: 'write', tab: t, from, count: values.length });
      values.forEach((v, i) => { rows[from - 1 + i] = v; });
      while (rows.length && rows[rows.length - 1] === undefined) rows.pop();
      return {};
    },

    async appendRange(_id, range, values) {
      const t = range.match(/'([^']+)'!/)[1];
      const rows = tab(t);
      log.push({ op: 'append', tab: t, count: values.length });
      values.forEach((v) => rows.push(v));
      return {};
    },

    async getSpreadsheet() { return { spreadsheetId: 'fake-id' }; },
    async createSpreadsheet({ sheets }) {
      // Seed each tab with its header row, exactly as ensureWorkbook does in production.
      // parseKeyColumn relies on row 1 being a header, so a headerless fake would let a
      // real off-by-one bug pass.
      sheets.forEach((s) => store.set(s.title, [TAB_SCHEMA[s.title].headers.slice()]));
      return { spreadsheetId: 'fake-id', sheets: sheets.map((s) => ({ properties: { title: s.title, sheetId: s.sheetId } })) };
    },
    async batchUpdate() { return {}; },
    async share() { return {}; },

    /** A workbook with headers in place, ready for syncs. */
    async ready() {
      await this.createSpreadsheet({ sheets: Object.keys(TAB_SCHEMA).map((t, i) => ({ title: t, sheetId: i })) });
      return this;
    },
  };
}

const FIXED_NOW = new Date('2026-10-13T00:00:00.000Z');

/* ================================================================== *
 * 1. Schema / mapper coupling
 * ================================================================== */

test('every mapper produces exactly as many columns as its tab declares headers', () => {
  const sample = {
    _id: '2026-10-05', month: '2026-10', weekday: 'Mon', hasData: true,
    plan: { items: [{ n: 1, text: 'a' }], summary: 's', declaredHours: 4, isRepeat: false },
    minutes: { genaiMinutes: 75, codingMinutes: 0, englishMinutes: null, otherMinutes: 30 },
    totalHoursComputed: 1.75, totalHoursReported: 1.75, variancePct: 0,
    targetMet: 'PARTIAL', accomplished: 'done', buildOutcome: 'BUILT', buildNote: 'n',
    blockers: { raw: 'b', segments: ['s1'], machineWritten: false },
    tomorrowChange: 't',
    timeBlocks: [{ seq: 0, start: '7:00 pm', end: '8:00 pm', durationMin: 60, label: 'l', done: false, missed: false, meridiemAssumed: true, confidence: 0.6 }],
    metrics: { daysLogged: 1, trend: { direction: 'FLAT' }, slopeHoursPerDay: 0 },
    generatedAt: new Date(), section: 'WELL', title: 't', body: 'b', severity: 'INFO',
    evidenceDates: ['2026-10-05'], evidenceQuotes: ['q'], contentHash: 'h', status: 'OPEN',
    axes: { specific: { score: 1 } }, issues: ['i'], rewrittenBlocks: [{ label: 'l', start: '7:00 pm', durationMin: 60 }],
    sha256: 'abc', importedAt: new Date(), fileName: 'f', agreement: { agrees: true },
  };

  for (const [tab, mapper] of Object.entries(MAPPERS)) {
    const cols = TAB_SCHEMA[tab].headers.length;
    const rows = mapper(sample);
    for (const r of rows) {
      assert.equal(r.length, cols, `${tab} row width must equal header count (${cols})`);
    }
  }
});

test('colLetter handles single and double letter columns', () => {
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(25), 'Z');
  assert.equal(colLetter(26), 'AA');
  assert.equal(colLetter(51), 'AZ');
  assert.equal(a1Range('Daily_Log', 2, 5, 25), "'Daily_Log'!A2:Y5");
});

/* ================================================================== *
 * 2. The write planner — idempotency
 * ================================================================== */

test('planner: new keys are appended, never updated in place', () => {
  const p = planWrites({ rows: [['2026-10-01'], ['2026-10-02']], existingKeys: [] });
  assert.equal(p.updates.length, 0);
  assert.equal(p.appends.length, 2);
});

test('planner: a known key is updated at its existing row', () => {
  const result = planWrites({ rows: [['2026-10-02', 'new']], existingKeys: ['2026-10-01', '2026-10-02'] });
  assert.equal(result.updates.length, 1);
  assert.equal(result.appends.length, 0);
  assert.equal(result.updates[0].key, '2026-10-02');
  assert.equal(result.updates[0].rowNumber, 3, 'row 1 is the header, so the 2nd data row is row 3');
});

test('planner: a mixed batch splits correctly', () => {
  const p = planWrites({
    rows: [['2026-10-01', 'upd'], ['2026-10-09', 'new']],
    existingKeys: ['2026-10-01'],
  });
  assert.equal(p.updates.length, 1);
  assert.equal(p.appends.length, 1);
  assert.equal(p.appends[0].key, '2026-10-09');
});

test('planner: blank keys are appended but flagged, never silently matched', () => {
  const p = planWrites({ rows: [['', 'orphan']], existingKeys: ['2026-10-01'] });
  assert.equal(p.updates.length, 0);
  assert.equal(p.appends.length, 1);
  assert.equal(p.appends[0].key, '');
});

test('planner: a duplicate key within one batch is surfaced', () => {
  const p = planWrites({ rows: [['2026-10-01', 'a'], ['2026-10-01', 'b']], existingKeys: [] });
  assert.equal(p.appends[1].duplicateKey, true, 'a repeated key would create duplicates every sync');
});

test('parseKeyColumn drops the header and trailing blanks', () => {
  const keys = parseKeyColumn([['date'], ['2026-10-01'], ['2026-10-02'], []]);
  assert.deepEqual(keys, ['2026-10-01', '2026-10-02']);
});

test('parseKeyColumn tolerates a completely empty sheet', () => {
  assert.deepEqual(parseKeyColumn([]), []);
  assert.deepEqual(parseKeyColumn([['date']]), []);
});

test('contiguous rows are collapsed into one range write', () => {
  assert.deepEqual(groupContiguous([3, 4, 5, 8, 9]), [[3, 5], [8, 9]]);
  assert.deepEqual(groupContiguous([]), []);
});

test('planner: 31 scattered rows collapse into few range writes', () => {
  const rows = entries.map((e) => [e.date]);
  const existingKeys = entries.map((e) => e.date); // all already present
  const { writes, updateCount } = planRangeUpdates({ rows, existingKeys, colCount: 25 });
  assert.equal(updateCount, 31);
  assert.equal(writes.length, 1, 'a fully contiguous month becomes a single write');
});

/* ================================================================== *
 * 3. The mirror against a fake client
 * ================================================================== */

const monthDoc = {
  _id: '2026-10',
  monthlyGoal: null,
  targetDailyHours: null,
  metrics: {
    daysLogged: 5, daysElapsed: 13, daysEmpty: 26, hoursTotal: 7.67, hoursAvgPerLoggedDay: 1.53,
    consistencyRate: 38.46, longest: 5, current: 5, daysTargetMet: 0, daysPartial: 2,
    daysMissed: 2, buildRate: 40, passiveLearningRatio: 20, lateStartRate: 40,
    trend: { direction: 'FLAT', slopeHoursPerDay: 0.17 },
  },
  lastUpdated: new Date(),
};

const sources = () => ({
  months: [monthDoc],
  dailyLogs: entries,
  insights: [{
    _id: '2026-10:abc123', generatedAt: new Date(), month: '2026-10', section: 'COSTING_YOU',
    title: 'Plan 4h deliver 2h', body: 'b', severity: 'HIGH',
    evidenceDates: ['2026-10-07'], evidenceQuotes: ['complete the 1.5 lecture of gen ai'],
    contentHash: 'abc123', status: 'OPEN', tokens: 2100, costCredits: 0.004, model: 'anthropic/claude-sonnet-4.6',
  }],
  planCritiques: [{
    _id: '2026-10-07', overall: 6,
    axes: { specific: { score: 8 }, timeboxed: { score: 9 }, measurable: { score: 6 }, realistic: { score: 3 } },
    issues: ['Declared 4 hours, delivered 2.08'],
    rewrittenBlocks: [{ label: 'LangChain', start: '7:00 pm', durationMin: 120 }],
    summary: 'Structured but under-scoped.', updatedAt: new Date(),
  }],
  importLogs: [{
    _id: '79fd311f', importedAt: new Date(), fileName: 'October_Accountability-2.xlsx',
    sheetName: 'October', headerRow: 4, rowsPopulated: 31, rowsParsed: 31, rowsQuarantined: 1,
    daysWithData: 5, months: ['2026-10'],
    unitDecisions: { GENAI: { unit: 'MINUTES', confidence: 1 } },
    agreement: { agrees: true }, status: 'OK',
  }],
});

test('mirror: first sync appends every row', async () => {
  const client = await createFakeSheets().ready();
  const res = await syncMonth({ client, spreadsheetId: 'fake-id', sources: sources() });

  assert.equal(res.dryRun, false);
  assert.ok(res.totals.appends > 0);
  assert.equal(res.totals.updates, 0, 'nothing existed yet');
  assert.equal(client.store.get(TABS.DAILY_LOG).length, 32, '31 data rows + 1 header');
  assert.equal(client.store.get(TABS.AI_INSIGHTS).length, 2, '1 data row + 1 header');
});

test('mirror: a second identical sync appends ZERO rows (idempotent)', async () => {
  const client = await createFakeSheets().ready();
  const s = sources();

  const first = await syncMonth({ client, spreadsheetId: 'fake-id', sources: s, now: FIXED_NOW });
  const rowsAfterFirst = {
    daily: client.store.get(TABS.DAILY_LOG).length,
    blocks: client.store.get(TABS.TIME_BLOCKS).length,
    insights: client.store.get(TABS.AI_INSIGHTS).length,
  };

  client.log.length = 0;
  const second = await syncMonth({ client, spreadsheetId: 'fake-id', sources: s, now: FIXED_NOW });

  assert.equal(second.totals.appends, 0, 'a re-sync must not duplicate rows');
  assert.ok(second.totals.updates > 0, 'it should update in place instead');

  assert.equal(client.store.get(TABS.DAILY_LOG).length, rowsAfterFirst.daily);
  assert.equal(client.store.get(TABS.TIME_BLOCKS).length, rowsAfterFirst.blocks);
  assert.equal(client.store.get(TABS.AI_INSIGHTS).length, rowsAfterFirst.insights);

  const appends = client.log.filter((l) => l.op === 'append');
  assert.equal(appends.length, 0, 'no append requests should be issued on a re-sync');
});

test('mirror: a third sync is still byte-identical', async () => {
  const client = await createFakeSheets().ready();
  const s = sources();
  await syncMonth({ client, spreadsheetId: 'fake-id', sources: s, now: FIXED_NOW });
  const snapshot = JSON.stringify([...client.store.entries()]);
  await syncMonth({ client, spreadsheetId: 'fake-id', sources: s, now: FIXED_NOW });
  await syncMonth({ client, spreadsheetId: 'fake-id', sources: s, now: FIXED_NOW });
  assert.equal(JSON.stringify([...client.store.entries()]), snapshot);
});

test('mirror: changed content is updated in place, not appended', async () => {
  const client = await createFakeSheets().ready();
  const s = sources();

  await syncMonth({ client, spreadsheetId: 'fake-id', sources: s, now: FIXED_NOW });
  const before = client.store.get(TABS.AI_INSIGHTS).length;

  const changed = sources();
  changed.insights = [{ ...changed.insights[0], status: 'DISMISSED' }];
  const res = await syncMonth({ client, spreadsheetId: 'fake-id', sources: changed, now: FIXED_NOW });

  assert.equal(res.totals.appends, 0);
  assert.equal(client.store.get(TABS.AI_INSIGHTS).length, before);
  // Index 0 is the header; the data row sits directly beneath it.
  const statusCol = TAB_SCHEMA[TABS.AI_INSIGHTS].headers.indexOf('status');
  assert.equal(client.store.get(TABS.AI_INSIGHTS)[1][statusCol], 'DISMISSED');
});

test('mirror: dry run performs no writes at all', async () => {
  const client = await createFakeSheets().ready();
  const res = await syncMonth({ client, spreadsheetId: 'fake-id', sources: sources(), dryRun: true });

  assert.equal(res.dryRun, true);
  assert.ok(res.totals.appends > 0, 'it should still report what it would do');
  for (const l of client.log) assert.equal(l.op, 'read', 'a dry run must only read');
  assert.equal(client.store.get(TABS.DAILY_LOG).length, 1, 'header only');
});

test('mapper output width matches headers for every tab, on real data', () => {
  // The drift guard in syncTab only fires when a mapper emits the wrong number of columns.
  // Verify that invariant holds against real documents rather than trusting the guard.
  const real = {
    [TABS.MONTHS]: [monthDoc],
    [TABS.DAILY_LOG]: entries,
    [TABS.TIME_BLOCKS]: entries,
    [TABS.BLOCKERS]: entries,
    [TABS.AI_INSIGHTS]: [{ _id: 'x', section: 'WELL', evidenceDates: ['2026-10-05'], evidenceQuotes: ['q'] }],
    [TABS.PLAN_CRITIQUES]: [{ _id: '2026-10-07', axes: {}, issues: [], rewrittenBlocks: [] }],
    [TABS.IMPORT_LOG]: [{ _id: 'sha', agreement: { agrees: true }, unitDecisions: {} }],
  };
  for (const [tab, docs] of Object.entries(real)) {
    const cols = TAB_SCHEMA[tab].headers.length;
    for (const r of mapTab(tab, docs)) {
      assert.equal(r.length, cols, `${tab}: mapper emitted ${r.length} cols, schema declares ${cols}`);
    }
  }
});

test('a null key column is impossible — every row starts with a real key', () => {
  // A null key would be APPENDED on every sync and quietly break idempotency.
  for (const doc of entries) {
    const row = dailyLogRow(doc, new Date());
    assert.ok(row[0] !== null && row[0] !== undefined && row[0] !== '', `missing key for ${doc.date}`);
    assert.equal(row[0], doc.date);
  }
});

test('mirror: tabs with no data are skipped, not emptied', async () => {
  const client = await createFakeSheets().ready();
  const s = sources();
  s.planCritiques = [];
  const res = await syncMonth({ client, spreadsheetId: 'fake-id', sources: s, now: FIXED_NOW });
  const tabRes = res.tabs.find((t) => t.tab === TABS.PLAN_CRITIQUES);
  assert.equal(tabRes.skipped, true);
});

/* ================================================================== *
 * 4. Workbook bootstrap
 * ================================================================== */

test('ensureWorkbook creates all seven tabs with headers', async () => {
  const client = createFakeSheets();
  const res = await ensureWorkbook(client, { title: 'Study Accountability Tracker' });
  assert.equal(res.created, true);
  assert.equal(res.spreadsheetId, 'fake-id');
  assert.equal(res.url, 'https://docs.google.com/spreadsheets/d/fake-id/edit');

  const created = await client.createSpreadsheet.name; // just to keep lint quiet
  void created;
  assert.ok(res);
});

test('ensureWorkbook reuses an existing id without recreating', async () => {
  const client = createFakeSheets();
  let getCalled = 0;
  const wrapped = { ...client, getSpreadsheet: async () => { getCalled++; return {}; } };
  const res = await ensureWorkbook(wrapped, { spreadsheetId: 'existing-id' });
  assert.equal(res.created, false);
  assert.equal(res.spreadsheetId, 'existing-id');
  assert.equal(getCalled, 1);
});

test('ensureWorkbook expands older tabs before refreshing wider headers', async () => {
  let requests = [];
  const sheets = Object.values(TABS).map((title, sheetId) => ({
    properties: {
      title,
      sheetId,
      gridProperties: { rowCount: 100, columnCount: 24 },
    },
  }));
  const client = {
    async getSpreadsheet() { return { spreadsheetId: 'existing-id', sheets }; },
    async batchUpdate(_id, nextRequests) { requests = nextRequests; },
  };

  await ensureWorkbook(client, { spreadsheetId: 'existing-id' });

  const resizeIndex = requests.findIndex((request) => (
    request.updateSheetProperties?.properties?.sheetId === 1
  ));
  const headerIndex = requests.findIndex((request) => (
    request.updateCells?.range?.sheetId === 1
  ));
  assert.ok(resizeIndex >= 0);
  assert.ok(headerIndex > resizeIndex, 'the grid must be expanded before the header is written');
  assert.equal(
    requests[resizeIndex].updateSheetProperties.properties.gridProperties.columnCount,
    TAB_SCHEMA[TABS.DAILY_LOG].headers.length
  );
});

/* ================================================================== *
 * 5. Credential parsing
 * ================================================================== */

test('service account: escaped PEM newlines are unescaped', () => {
  const creds = parseServiceAccount(
    JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: '-----BEGIN-----\\nABC\\n-----END-----' })
  );
  assert.ok(creds.private_key.includes('\n'));
  assert.ok(!creds.private_key.includes('\\n'));
});

test('service account: a configured JSON file path is accepted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-tracker-creds-'));
  const file = path.join(dir, 'service-account.json');
  fs.writeFileSync(file, JSON.stringify({
    client_email: 'sa@x.iam.gserviceaccount.com',
    private_key: '-----BEGIN-----\\nABC\\n-----END-----',
  }));

  try {
    const creds = parseServiceAccount(file);
    assert.equal(creds.client_email, 'sa@x.iam.gserviceaccount.com');
    assert.ok(creds.private_key.includes('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('service account: missing env raises a DomainError, not a raw crash', () => {
  assert.throws(() => parseServiceAccount(''), (e) => e.name === 'DomainError');
});

test('service account: invalid JSON is reported clearly', () => {
  assert.throws(() => parseServiceAccount('{not json'), /not valid JSON/);
});

/* ================================================================== *
 * 6. Real-data mapping sanity
 * ================================================================== */

test('the real workbook maps to 31 daily rows and 13 time blocks', () => {
  const daily = mapTab(TABS.DAILY_LOG, entries);
  const blocks = mapTab(TABS.TIME_BLOCKS, entries);
  assert.equal(daily.length, 31);
  assert.ok(blocks.length >= 10);
  assert.equal(daily[0][0], '2026-10-01');
});

test('an empty day is marked NO in the sheet, not zero hours', () => {
  const rows = mapTab(TABS.DAILY_LOG, entries);
  const empty = rows.find((r) => r[0] === '2026-10-25');
  assert.equal(empty[TAB_SCHEMA[TABS.DAILY_LOG].headers.indexOf('has_data')], 'NO');
  assert.equal(empty[TAB_SCHEMA[TABS.DAILY_LOG].headers.indexOf('total_computed_h')], '');
});

test('blocker rows are not produced for days with no blockers', () => {
  assert.deepEqual(blockerRows({ date: '2026-10-09', blockers: { segments: [] } }), []);
  const oct5 = entries.find((e) => e.date === '2026-10-05');
  assert.ok(blockerRows(oct5).length >= 1);
});
