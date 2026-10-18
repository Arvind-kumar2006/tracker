/**
 * Mobile-facing routes: workbook upload and daily-entry writes.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ingestUploads, parseWorkbookBuffer, MAX_FILES } from '../src/interface/http/uploadRoute.js';
import { buildEntryFromInput, saveDailyEntry } from '../src/interface/http/dailyEntryRoute.js';

const mongoUp = await new Promise((resolve) => {
  const s = net.createConnection({ host: '127.0.0.1', port: 27017 }, () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.setTimeout(1000, () => { s.destroy(); resolve(false); });
});

const it = mongoUp ? test : test.skip;
if (!mongoUp) console.log('[skip] mongod not reachable — mobile route tests skipped');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(__dirname, '../../October_Accountability-2.xlsx');

/* ================================================================== *
 * Pure: entry construction from app input
 * ================================================================== */

test('buildEntryFromInput maps app fields onto the canonical schema', () => {
  const e = buildEntryFromInput({
    date: '2026-10-14',
    payload: {
      accomplished: 'Finished the RAG lecture and wrote notes',
      buildNote: 'A small RAG demo with three test questions',
      blockers: 'Slept till 9\nPhone during breaks',
      buildOutcome: 'BUILT',
      targetMet: 'partial',
      plannedHours: '3',
    },
  });

  assert.equal(e.date, '2026-10-14');
  assert.equal(e.month, '2026-10');
  assert.equal(e.weekday, 'Wed', '14 Oct 2026 is a Wednesday');
  assert.equal(e.hasData, true);
  assert.equal(e.targetMet, 'PARTIAL');
  assert.equal(e.buildOutcome, 'BUILT');
  assert.equal(e.buildNote, 'A small RAG demo with three test questions');
  assert.equal(e.blockers.segments.length, 2);
  assert.equal(e.plan.declaredHours, 3);
});

test('an app entry has no spreadsheet provenance and no invented hours', () => {
  const e = buildEntryFromInput({ date: '2026-10-14', payload: { accomplished: 'x' } });
  assert.equal(e.sourceFile, null, 'must not masquerade as an imported row');
  assert.equal(e.sheetRow, null);
  assert.equal(e.origin, 'app');
  assert.equal(e.totalHoursComputed, null, 'the app never guesses study time');
  assert.equal(e.hasMinutes, false);
});

test('an empty submission is not data', () => {
  const e = buildEntryFromInput({ date: '2026-10-14', payload: {} });
  assert.equal(e.hasData, false);
});

test('an invalid date is rejected, not coerced', () => {
  assert.throws(() => buildEntryFromInput({ date: '14/10/2026', payload: {} }), (e) => e.name === 'DomainError');
  assert.throws(() => buildEntryFromInput({ date: '', payload: {} }), (e) => e.name === 'DomainError');
});

test('oversized text is clamped', () => {
  const e = buildEntryFromInput({ date: '2026-10-14', payload: { accomplished: 'x'.repeat(10_000) } });
  assert.ok(e.accomplished.length <= 4000);
});

test('reflection update preserves an existing plan and measured sessions', async () => {
  let stored = {
    ...buildEntryFromInput({ date: '2026-10-14', payload: {} }),
    hasData: true,
    plan: {
      items: [{ id: '2026-10-14-1', n: 1, text: 'Build API', estimatedMinutes: 60, actualMinutes: 25 }],
      summary: 'Build API',
      declaredHours: 1,
      minimumMinutes: 30,
      idealMinutes: 60,
      breakMinutes: 10,
      bufferMinutes: 10,
    },
    focusSessions: [{ id: 'session-1', durationMinutes: 25 }],
    reflectionAnalysis: { status: 'complete', recommendations: [{ action: 'old advice' }] },
  };
  const repositories = {
    dailyLogRepository: {
      findByDate: async () => stored,
      findByMonth: async () => [stored],
      upsertMany: async ([entry]) => { stored = entry; return { matched: 1, modified: 1 }; },
    },
    monthRepository: {
      find: async () => null,
      upsert: async () => {},
    },
  };

  const result = await saveDailyEntry({
    date: '2026-10-14',
    payload: { accomplished: 'Shipped the first endpoint.' },
    repositories,
  });

  assert.ok(result.ok, result.ok ? '' : result.error.message);
  assert.equal(stored.plan.items[0].text, 'Build API');
  assert.equal(stored.plan.items[0].actualMinutes, 25);
  assert.equal(stored.focusSessions[0].durationMinutes, 25);
  assert.equal(stored.accomplished, 'Shipped the first endpoint.');
  assert.equal(stored.reflectionAnalysis, null, 'editing the reflection must invalidate stale analysis');
});

/* ================================================================== *
 * Upload parsing (no database needed)
 * ================================================================== */

test('parseWorkbookBuffer reads a real xlsx from base64', async () => {
  const buf = await fs.readFile(WORKBOOK);
  const sheets = parseWorkbookBuffer(buf);
  assert.ok(Array.isArray(sheets));
  assert.equal(sheets.length, 1);
  assert.ok(sheets[0].rows.length > 30);
  assert.ok(Array.isArray(sheets[0].rows[0]));
});

test('parseWorkbookBuffer returns null on garbage rather than throwing', () => {
  assert.equal(parseWorkbookBuffer(Buffer.from('this is not a spreadsheet')), null);
});

test('upload rejects an empty file list', async () => {
  const res = await ingestUploads({ files: [], repositories: {} });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'FILE_NOT_READABLE');
});

test('upload rejects a file count over the limit', async () => {
  const files = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `f${i}.xlsx`, base64: '' }));
  const res = await ingestUploads({ files, repositories: {} });
  assert.equal(res.ok, false);
});

/* ================================================================== *
 * With Mongo
 * ================================================================== */

it('mobile routes against mongo', async (t) => {
  const { container, shutdown } = await import('../src/shared/di/container.js');
  process.env.MONGO_DB_NAME = 'study_tracker_mobile';
  await container.mongo.connect();
  await container.mongo.getDb().dropDatabase();

  const repos = {
    dailyLogRepository: container.dailyLogRepository,
    monthRepository: container.monthRepository,
    importLogRepository: container.importLogRepository,
    quarantineRepository: container.quarantineRepository,
  };

  await t.test('a base64 workbook upload imports exactly like a folder scan', async () => {
    const buf = await fs.readFile(WORKBOOK);
    const res = await ingestUploads({
      files: [{ name: 'October_Accountability-2.xlsx', base64: buf.toString('base64') }],
      repositories: repos,
      asOf: '2026-10-13',
    });

    assert.ok(res.ok, res.ok ? '' : res.error.message);
    assert.equal(res.value.imported.length, 1);
    const i = res.value.imported[0];
    assert.equal(i.rowsParsed, 31);
    assert.equal(i.daysWithData, 5);
    assert.equal(i.agreement.agrees, true);
    assert.equal(i.unitDecisions.GENAI.unit, 'MINUTES');
    assert.equal(i.source, 'mobile-upload');
    assert.equal(await container.dailyLogRepository.count(), 31);
  });

  await t.test('re-uploading the same file is a no-op', async () => {
    const buf = await fs.readFile(WORKBOOK);
    const res = await ingestUploads({
      files: [{ name: 'October_Accountability-2.xlsx', base64: buf.toString('base64') }],
      repositories: repos,
    });
    assert.equal(res.value.imported.length, 0);
    assert.match(res.value.skipped[0].reason, /already imported/);
    assert.equal(await container.dailyLogRepository.count(), 31);
  });

  await t.test('a non-spreadsheet payload is skipped with a reason', async () => {
    const res = await ingestUploads({
      files: [{ name: 'fake.xlsx', base64: Buffer.from('nope').toString('base64') }],
      repositories: repos,
      force: true,
    });
    assert.ok(res.ok);
    assert.equal(res.value.imported.length, 0);
    assert.match(res.value.skipped[0].reason, /not a readable/);
  });

  await t.test('a saved daily entry persists and refreshes the month rollup', async () => {
    const res = await saveDailyEntry({
      date: '2026-10-14',
      payload: { accomplished: 'Restarted. One lecture.', blockers: 'Phone', buildOutcome: 'LEARNED' },
      repositories: repos,
    });
    assert.ok(res.ok, res.ok ? '' : res.error.message);

    const saved = await container.dailyLogRepository.findByDate('2026-10-14');
    assert.equal(saved.hasData, true);
    assert.equal(saved.origin, 'app');
    assert.equal(saved.accomplished, 'Restarted. One lecture.');
    assert.equal(saved.totalHoursComputed, null);

    const month = await container.monthRepository.find('2026-10');
    assert.equal(month.metrics.daysLogged, 6, 'the rollup picked up the new day');
  });

  await t.test('an app entry and an imported entry coexist under one natural key', async () => {
    await container.importWorkbooks({ force: true, asOf: '2026-10-13' });
    const d = await container.dailyLogRepository.findByDate('2026-10-05');
    assert.equal(d.origin, 'import', 'an imported row keeps its provenance');
    assert.ok(d.sourceFile);
    assert.equal(await container.dailyLogRepository.count(), 31, 'no duplicate calendar rows');
  });

  await t.after(async () => { await shutdown(); });
});
