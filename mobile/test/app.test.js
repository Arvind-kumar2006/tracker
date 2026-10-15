/**
 * Mobile domain + use-case tests.
 *
 * These run in plain node with no emulator, no bundler, and no React — which is the payoff for
 * keeping src/domain and src/application free of platform imports.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeTargetMet, formatHours, formatPercent, formatDate, monthForDate, daysInMonth,
  datesInMonth, monthGrid, buildDashboardView, sortBySeverity, TargetMet, TONE_COLORS,
} from '../src/domain/index.js';
import { importWorkbooks, loadDashboard, runAnalysis } from '../src/application/useCases.js';

/* ================================================================== *
 * Domain — the blank-day rule is the one that matters most
 * ================================================================== */

test('a day with no data is NOT shown as missed', () => {
  const s = describeTargetMet(null, false);
  assert.equal(s.label, 'Not logged');
  assert.equal(s.tone, 'neutral');
  assert.notEqual(s.tone, 'negative');
  assert.notEqual(s.label, 'Missed');
});

test('SKIPPED and MISSED render differently', () => {
  const skipped = describeTargetMet(TargetMet.SKIPPED, false);
  const missed = describeTargetMet(TargetMet.MISSED, true);
  assert.notEqual(skipped.tone, missed.tone);
  assert.equal(missed.tone, 'negative');
});

test('MISSED is only ever shown when the day actually has data', () => {
  for (const tm of Object.values(TargetMet)) {
    const s = describeTargetMet(tm, false);
    assert.notEqual(s.tone, 'negative', `${tm} with no data must not read as negative`);
  }
});

test('tone colours cover every status tone', () => {
  for (const tone of ['positive', 'warning', 'negative', 'neutral']) {
    assert.ok(TONE_COLORS[tone], `missing colour for ${tone}`);
  }
});

/* ---------------- formatting ---------------- */

test('formatHours distinguishes null from zero', () => {
  assert.equal(formatHours(null), '—', 'unknown is not zero');
  assert.equal(formatHours(undefined), '—');
  assert.equal(formatHours(0), '0h');
  assert.equal(formatHours(1.5), '1h 30m');
  assert.equal(formatHours(2), '2h');
});

test('formatPercent handles null', () => {
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(38.46), '38%');
  assert.equal(formatPercent(0), '0%');
});

test('formatDate is timezone-stable', () => {
  // Excel serial 46296 is 2026-10-01; this must not drift by a day in any timezone.
  assert.equal(formatDate('2026-10-01'), 'Thu 1 Oct');
  assert.equal(formatDate('2026-10-31', { weekday: false }), '31 Oct');
  assert.equal(formatDate(null), '—');
});

/* ---------------- month maths ---------------- */

test('monthForDate handles the year boundary', () => {
  assert.equal(monthForDate('2026-10-05'), '2026-10');
  assert.equal(monthForDate('2026-12-31'), '2026-12');
  assert.equal(monthForDate('2027-01-01'), '2027-01');
});

test('daysInMonth knows February and leap years', () => {
  assert.equal(daysInMonth('2026-10'), 31);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-09'), 30);
});

test('datesInMonth pads correctly', () => {
  const d = datesInMonth('2026-10');
  assert.equal(d.length, 31);
  assert.equal(d[0], '2026-10-01');
  assert.equal(d[30], '2026-10-31');
});

test('monthGrid pads to whole weeks and starts on the right weekday', () => {
  const grid = monthGrid('2026-10');
  assert.equal(grid.length % 7, 0);
  // 1 Oct 2026 is a Thursday, so a Sunday-first grid needs 4 blanks before it.
  assert.equal(grid.slice(0, 4).every((x) => x === null), true);
  assert.equal(grid[4], '2026-10-01');
});

/* ---------------- dashboard view-model ---------------- */

const entries = [
  { date: '2026-10-05', hasData: true, totalHoursComputed: 1.75, targetMet: 'PARTIAL', buildOutcome: 'NONE', weekday: 'Mon' },
  { date: '2026-10-06', hasData: true, totalHoursComputed: 1.67, targetMet: 'PARTIAL', buildOutcome: 'BUILT', weekday: 'Tue' },
  { date: '2026-10-07', hasData: true, totalHoursComputed: 2.08, targetMet: 'MISSED', buildOutcome: 'LEARNED', weekday: 'Wed' },
];

test('buildDashboardView separates logged, blank and future days', () => {
  const v = buildDashboardView({ month: '2026-10', metrics: { hoursTotal: 5.5, consistencyRate: 40 }, entries, asOf: '2026-10-13' });

  assert.equal(v.loggedDays, 3);
  assert.equal(v.days.length, 31);
  assert.equal(v.days.filter((d) => d.isFuture).length, 18, 'Oct 14-31 are future on the 13th');
  assert.equal(v.days.filter((d) => !d.hasData && !d.isFuture).length, 10, 'Oct 1-4 plus Oct 8-13');
});

test('buildDashboardView never marks a future or blank day as failed', () => {
  const v = buildDashboardView({ month: '2026-10', metrics: {}, entries, asOf: '2026-10-13' });
  for (const d of v.days) {
    if (!d.hasData) {
      assert.equal(d.status.tone, 'neutral', `${d.date} must be neutral`);
      assert.equal(d.totalHours, null, `${d.date} must have a null total, not 0`);
    }
  }
});

test('buildDashboardView surfaces the repeat-plan flag', () => {
  const withRepeat = [...entries, { date: '2026-10-08', hasData: true, totalHoursComputed: 2.17, targetMet: 'MISSED', buildOutcome: 'BUILT', plan: { isRepeat: true } }];
  const v = buildDashboardView({ month: '2026-10', metrics: {}, entries: withRepeat, asOf: '2026-10-31' });
  assert.equal(v.days.find((d) => d.date === '2026-10-08').planRepeat, true);
});

test('severity sorting puts HIGH first and does not mutate the input', () => {
  const input = [{ severity: 'INFO' }, { severity: 'HIGH' }, { severity: 'MEDIUM' }];
  const sorted = sortBySeverity(input);
  assert.deepEqual(sorted.map((i) => i.severity), ['HIGH', 'MEDIUM', 'INFO']);
  assert.deepEqual(input.map((i) => i.severity), ['INFO', 'HIGH', 'MEDIUM'], 'input must not be mutated');
});

/* ================================================================== *
 * Use cases — driven by fake ports, no network
 * ================================================================== */

/**
 * The adapter that actually exists.
 *
 * The previous fake modelled folder ENUMERATION, which `@react-native-documents/picker` v10 does
 * not support — verified against its TypeScript definitions, which export no `listDirectory` and
 * no `listAllFiles`. The tests below describe the real flow instead: the user picks files.
 */
const fakeFileSystem = (files, { onRead } = {}) => ({
  canPickFolder: async () => false,
  pickFiles: async () => ({ ok: true, value: files }),
  pickFolder: async () => ({ ok: false, error: Object.assign(new Error('no folder picker'), { code: 'NO_FOLDER_PICKER' }) }),
  listSpreadsheets: async () => ({
    ok: false,
    error: Object.assign(new Error('enumeration unsupported'), { code: 'FOLDER_ENUM_UNSUPPORTED' }),
  }),
  readBase64: async (uri) => {
    if (onRead) onRead(uri);
    return { ok: true, value: Buffer.from(uri).toString('base64') };
  },
});

test('import: filters to spreadsheets and defers the upload until confirmed', async () => {
  let uploaded = null;
  const api = {
    uploadWorkbooks: async (files, opts) => {
      uploaded = { files, opts };
      return { ok: true, value: { imported: [], skipped: [], filesReceived: files.length } };
    },
  };

  const res = await importWorkbooks({
    fileSystem: fakeFileSystem([
      { name: 'October_Accountability-2.xlsx', uri: 'a', size: 120 },
      { name: '~$lock.xlsx', uri: 'b', size: 1 },
      { name: '._resource.xlsx', uri: 'c', size: 1 },
      { name: 'notes.txt', uri: 'd', size: 10 },
    ]),
    api,
  });

  assert.ok(res.ok);
  assert.equal(res.value.fileCount, 1, 'lock files, resource forks and non-spreadsheets are filtered out');
  assert.equal(res.value.files[0].name, 'October_Accountability-2.xlsx');
  assert.equal(uploaded, null, 'nothing uploads until the user confirms');

  const done = await res.value.upload();
  assert.ok(done.ok);
  assert.equal(uploaded.files.length, 1);
  assert.equal(uploaded.files[0].name, 'October_Accountability-2.xlsx');
  assert.ok(uploaded.files[0].base64, 'the file is read as base64 for the server to parse');
});

test('import: every selected file is read, not just the first', async () => {
  const read = [];
  const res = await importWorkbooks({
    fileSystem: fakeFileSystem(
      [
        { name: 'a.xlsx', uri: 'uri-a', size: 1 },
        { name: 'b.xlsx', uri: 'uri-b', size: 1 },
        { name: 'c.xlsx', uri: 'uri-c', size: 1 },
      ],
      { onRead: (u) => read.push(u) }
    ),
    api: { uploadWorkbooks: async () => ({ ok: true, value: {} }) },
  });
  assert.ok(res.ok);
  assert.equal(res.value.fileCount, 3);
  assert.deepEqual(read, ['uri-a', 'uri-b', 'uri-c']);
});

test('import: a selection with no spreadsheets returns a clear error', async () => {
  const res = await importWorkbooks({
    fileSystem: fakeFileSystem([{ name: 'a.txt', uri: 'x', size: 1 }]),
    api: {},
  });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NO_SPREADSHEETS');
  assert.equal(res.error.message, 'That selection contains no .xlsx files.');
});

test('import: a cancelled picker is not an error worth shouting about', async () => {
  const fs = {
    ...fakeFileSystem([]),
    pickFiles: async () => ({ ok: false, error: Object.assign(new Error('No selection made.'), { code: 'CANCELLED' }) }),
  };
  const res = await importWorkbooks({ fileSystem: fs, api: {} });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'CANCELLED');
});

test('import: a read failure aborts rather than uploading a partial batch', async () => {
  const fs = {
    ...fakeFileSystem([
      { name: 'a.xlsx', uri: 'ok', size: 1 },
      { name: 'b.xlsx', uri: 'broken', size: 1 },
    ]),
    readBase64: async (uri) =>
      uri === 'broken' ? { ok: false, error: new Error('EACCES') } : { ok: true, value: 'ZGF0YQ==' },
  };
  let called = false;
  const res = await importWorkbooks({ fileSystem: fs, api: { uploadWorkbooks: async () => { called = true; return { ok: true, value: {} }; } } });
  assert.equal(res.ok, false);
  assert.equal(called, false, 'a half-read batch must never be uploaded');
});

test('loadDashboard returns metrics and days together', async () => {
  const api = {
    getMetrics: async () => ({ ok: true, value: { hoursTotal: 7.67 } }),
    getDays: async () => ({ ok: true, value: entries }),
  };
  const res = await loadDashboard({ api, month: '2026-10', asOf: '2026-10-13' });
  assert.ok(res.ok);
  assert.equal(res.value.metrics.hoursTotal, 7.67);
  assert.equal(res.value.entries.length, 3);
});

test('loadDashboard surfaces a connection failure instead of rendering an empty month', async () => {
  const api = {
    getMetrics: async () => ({ ok: false, error: new Error('Cannot reach the tracker server') }),
    getDays: async () => ({ ok: true, value: [] }),
  };
  const res = await loadDashboard({ api, month: '2026-10' });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Cannot reach/);
});

test('analysis: a 422 "not enough data" is a normal outcome, not a crash', async () => {
  const api = {
    analyse: async () => ({
      ok: false,
      error: Object.assign(new Error('insufficient'), {
        status: 422,
        payload: { insufficient: { code: 'INSUFFICIENT_DATA', message: 'Only 1 day carries data.' } },
      }),
    }),
  };
  const res = await runAnalysis({ api, month: '2026-10' });
  assert.ok(res.ok, 'the UI needs a renderable result, not an exception');
  assert.equal(res.value.insufficient.code, 'INSUFFICIENT_DATA');
  assert.equal(res.value.bundle, null);
});

test('analysis: a real failure still propagates', async () => {
  const api = {
    analyse: async () => ({ ok: false, error: Object.assign(new Error('upstream'), { status: 500 }) }),
  };
  const res = await runAnalysis({ api, month: '2026-10' });
  assert.equal(res.ok, false);
});