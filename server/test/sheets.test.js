/** Tests for the compact tracker Google Sheets projection. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorkbook } from '../src/infrastructure/persistence/xlsx/xlsxReader.js';
import { normalizeWorkbook } from '../src/domain/services/WorkbookNormalizer.js';
import { TAB_SCHEMA, TABS, colLetter, a1Range } from '../src/infrastructure/sheets/sheetSchema.js';
import { MAPPERS, mapTab, dailyTrackerRow, obstacleRows, studyHoursRow } from '../src/infrastructure/sheets/rowMappers.js';
import { planWrites, planRangeUpdates, parseKeyColumn, groupContiguous } from '../src/infrastructure/sheets/writePlanner.js';
import { syncMonth, ensureWorkbook } from '../src/infrastructure/sheets/sheetsMirror.js';
import { parseServiceAccount } from '../src/infrastructure/sheets/googleSheetsClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wb = await readWorkbook(path.resolve(__dirname, '../../October_Accountability-2.xlsx'));
const { entries } = normalizeWorkbook({ rows: wb.sheets[0].rows, fileName: wb.fileName });

function createFakeSheets() {
  const store = new Map();
  const log = [];
  const tab = (name) => {
    if (!store.has(name)) store.set(name, []);
    return store.get(name);
  };
  const parseRange = (range) => {
    const match = range.match(/!?([A-Z]+)(\d*):([A-Z]+)(\d*)/);
    if (!match) return [1, Infinity];
    return [match[2] ? Number(match[2]) : 1, match[4] ? Number(match[4]) : Infinity];
  };
  const singleColumn = (range) => /!?([A-Z]+):([A-Z]+)\s*$/.test(range) && range.match(/!?([A-Z]+):([A-Z]+)\s*$/)?.[1] === range.match(/!?([A-Z]+):([A-Z]+)\s*$/)?.[2];

  return {
    store,
    log,
    async readRange(_id, range) {
      const name = range.match(/'([^']+)'!/)[1];
      const rows = tab(name);
      const [from, to] = parseRange(range);
      log.push({ op: 'read', tab: name });
      const body = rows.slice(from - 1, to === Infinity ? undefined : to);
      return singleColumn(range) ? body.map((row) => [row?.[0] ?? '']) : body;
    },
    async writeRange(_id, range, values) {
      const name = range.match(/'([^']+)'!/)[1];
      const rows = tab(name);
      const [from] = parseRange(range);
      log.push({ op: 'write', tab: name, count: values.length });
      values.forEach((value, index) => { rows[from - 1 + index] = value; });
      while (rows.length && rows.at(-1) === undefined) rows.pop();
    },
    async appendRange(_id, range, values) {
      const name = range.match(/'([^']+)'!/)[1];
      log.push({ op: 'append', tab: name, count: values.length });
      tab(name).push(...values);
    },
    async getSpreadsheet() { return { spreadsheetId: 'fake-id' }; },
    async createSpreadsheet({ sheets }) {
      sheets.forEach((sheet) => store.set(sheet.title, [TAB_SCHEMA[sheet.title].headers.slice()]));
      return {
        spreadsheetId: 'fake-id',
        sheets: sheets.map((sheet) => ({ properties: { title: sheet.title, sheetId: sheet.sheetId } })),
      };
    },
    async batchUpdate() {},
    async share() {},
    async ready() {
      await this.createSpreadsheet({ sheets: Object.keys(TAB_SCHEMA).map((title, sheetId) => ({ title, sheetId })) });
      return this;
    },
  };
}

const FIXED_NOW = new Date('2026-10-13T00:00:00.000Z');

const sample = {
  date: '2026-10-18',
  weekday: 'Sun',
  plan: {
    items: [{
      id: '2026-10-18-1', task: 'Solve confidence intervals', doneWhen: '3 examples solved',
      type: 'Study', start: '09:00', end: '09:50', minutes: 50, isMust: true, status: 'PLANNED',
    }],
  },
  accomplished: 'Completed two examples',
  buildNote: 'Wrote the mistakes summary',
  blockers: { raw: 'Phone notifications', segments: ['Phone notifications'] },
  tomorrowChange: 'Start before opening social media',
  totalHoursComputed: 1.5,
  targetMet: 'PARTIAL',
  sourceFile: 'October.xlsx',
};

test('the workbook has the tracker tabs', () => {
  assert.deepEqual(Object.values(TABS), ['Daily_Tracker', 'Obstacles', 'Study_Hours', 'Weekly_Plans']);
  assert.deepEqual(Object.keys(TAB_SCHEMA), Object.values(TABS));
});

test('every mapper matches its headers', () => {
  for (const [tab, mapper] of Object.entries(MAPPERS)) {
    const rows = tab === TABS.OBSTACLES ? mapper([sample]) : mapper(sample);
    for (const row of rows) assert.equal(row.length, TAB_SCHEMA[tab].headers.length, tab);
  }
});
test('daily tracker keeps one plan block and the reflection on one row', () => {
  const row = dailyTrackerRow(sample);
  const headers = TAB_SCHEMA[TABS.DAILY_TRACKER].headers;
  assert.equal(row[headers.indexOf('record_id')], '2026-10-18-1');
  assert.equal(row[headers.indexOf('date')], '2026-10-18');
  assert.equal(row[headers.indexOf('task')], 'Solve confidence intervals');
  assert.equal(row[headers.indexOf('done_when')], '3 examples solved');
  assert.equal(row[headers.indexOf('must_do')], 'YES');
  assert.equal(row[headers.indexOf('accomplishment')], 'Completed two examples');
  assert.equal(row[headers.indexOf('built_finished_or_produced')], 'Wrote the mistakes summary');
});

test('obstacle rows are unique and leave solution blank', () => {
  const rows = obstacleRows([
    sample,
    { date: '2026-10-19', blockers: { segments: ['Phone notifications', 'Started late'] } },
  ]);
  assert.deepEqual(rows, [['Phone notifications', ''], ['Started late', '']]);
});

test('study-hours rows provide numeric histogram input', () => {
  const row = studyHoursRow(sample);
  assert.equal(row[2], 1.5);
  assert.equal(row[3], 50 / 60);
  assert.equal(row[4], 50);
});

test('colLetter and ranges remain correct', () => {
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(25), 'Z');
  assert.equal(colLetter(26), 'AA');
  assert.equal(a1Range('Daily_Tracker', 2, 5, 17), "'Daily_Tracker'!A2:Q5");
});

test('write planner remains idempotent', () => {
  const first = planWrites({ rows: [['a'], ['b']], existingKeys: [] });
  assert.equal(first.appends.length, 2);
  const second = planWrites({ rows: [['a', 'new']], existingKeys: ['a', 'b'] });
  assert.equal(second.updates.length, 1);
  assert.equal(second.appends.length, 0);
  assert.deepEqual(groupContiguous([3, 4, 5, 8]), [[3, 5], [8, 8]]);
  assert.deepEqual(parseKeyColumn([['date'], ['a'], ['b']]), ['a', 'b']);
  assert.equal(planRangeUpdates({ rows: [['a'], ['b']], existingKeys: ['a', 'b'], colCount: 1 }).updateCount, 2);
});

test('sync writes tracker tabs and preserves manual obstacle solutions', async () => {
  const client = await createFakeSheets().ready();
  const sources = { dailyLogs: [sample] };

  const first = await syncMonth({ client, spreadsheetId: 'fake-id', sources, now: FIXED_NOW });
  assert.equal(first.tabs.length, 4);
  assert.equal(client.store.get(TABS.DAILY_TRACKER).length, 2);
  assert.equal(client.store.get(TABS.OBSTACLES).length, 2);
  assert.equal(client.store.get(TABS.STUDY_HOURS).length, 2);

  client.store.get(TABS.OBSTACLES)[1][1] = 'Put phone away before studying';
  await syncMonth({ client, spreadsheetId: 'fake-id', sources, now: FIXED_NOW });
  assert.equal(client.store.get(TABS.OBSTACLES)[1][1], 'Put phone away before studying');
  assert.equal(client.store.get(TABS.DAILY_TRACKER).length, 2);
});

test('real workbook produces one daily tracker and study-hours row per day', () => {
  assert.ok(mapTab(TABS.DAILY_TRACKER, entries).length >= 31);
  assert.equal(mapTab(TABS.STUDY_HOURS, entries).length, 31);
  assert.ok(mapTab(TABS.OBSTACLES, entries).length > 0);
});

test('ensureWorkbook creates the tracker tabs', async () => {
  const client = createFakeSheets();
  const result = await ensureWorkbook(client, { title: 'Study Accountability Tracker' });
  assert.equal(result.created, true);
  assert.deepEqual([...client.store.keys()], Object.values(TABS));
});

test('service account parser handles escaped private-key newlines', () => {
  const credentials = parseServiceAccount(JSON.stringify({
    client_email: 'sa@x.iam.gserviceaccount.com',
    private_key: '-----BEGIN-----\\nABC\\n-----END-----',
  }));
  assert.ok(credentials.private_key.includes('\n'));
  assert.ok(!credentials.private_key.includes('\\n'));
});

test('service account parser accepts a JSON file path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-tracker-creds-'));
  const file = path.join(dir, 'service-account.json');
  fs.writeFileSync(file, JSON.stringify({
    client_email: 'sa@x.iam.gserviceaccount.com',
    private_key: '-----BEGIN-----\\nABC\\n-----END-----',
  }));
  try {
    assert.equal(parseServiceAccount(file).client_email, 'sa@x.iam.gserviceaccount.com');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
void 0;
