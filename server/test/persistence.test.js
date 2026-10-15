/**
 * Integration tests for the Mongo layer and the import use case.
 *
 * These need a running mongod on 127.0.0.1:27017. If one is not reachable they SKIP rather than
 * fail, so the pure-domain suite stays runnable without any infrastructure.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(__dirname, '../../October_Accountability-2.xlsx');

const mongoUp = await new Promise((resolve) => {
  const s = net.createConnection({ host: '127.0.0.1', port: 27017 }, () => {
    s.destroy();
    resolve(true);
  });
  s.on('error', () => resolve(false));
  s.setTimeout(1000, () => {
    s.destroy();
    resolve(false);
  });
});

const it = mongoUp ? test : test.skip;
if (!mongoUp) {
  console.log('[skip] mongod not reachable on 27017 — persistence tests skipped');
}

it('mongo persistence', async (t) => {
  const { container, shutdown } = await import('../src/shared/di/container.js');

  // Its own database: test files run in parallel, and sharing one would let this file's
  // dropDatabase() delete e2e.test.js's data mid-run.
  process.env.MONGO_DB_NAME = 'study_tracker_persistence';

  await container.mongo.connect();
  await container.mongo.getDb().dropDatabase();
  const baseline = await container.dailyLogRepository.count();

  // Subtests are awaited on `t` so they run in order — they share state deliberately.
  await t.test('first import upserts every parsed row', async () => {
    const r = await container.importWorkbooks({ asOf: '2026-10-13' });
    assert.ok(r.ok, r.ok ? '' : r.error.message);
    assert.equal(r.value.filesFound, 1);
    assert.equal(r.value.months[0], '2026-10');

    const after = await container.dailyLogRepository.count();
    assert.equal(after - baseline, 31, '31 daily rows should be written');
  });

  await t.test('re-importing an unchanged file is skipped by sha256', async () => {
    const r = await container.importWorkbooks({ asOf: '2026-10-13' });
    assert.equal(r.value.imported.length, 0);
    assert.match(r.value.skipped[0].reason, /already imported/);
  });

  await t.test('forced re-import upserts rather than duplicating', async () => {
    const before = await container.dailyLogRepository.count();
    await container.importWorkbooks({ asOf: '2026-10-13', force: true });
    assert.equal(await container.dailyLogRepository.count(), before, 'date _id makes upsert idempotent');
  });

  await t.test('a day with no data has a null total, not zero', async () => {
    const empty = await container.dailyLogRepository.findByDate('2026-10-25');
    assert.ok(empty, 'empty day is still stored as a calendar row');
    assert.equal(empty.hasData, false);
    assert.equal(empty.totalHoursComputed, null);
  });

  await t.test('filtering for data excludes empty days', async () => {
    const withData = await container.dailyLogRepository.findWithData('2026-10');
    assert.equal(withData.length, 5);
    for (const e of withData) assert.equal(e.hasData, true);
  });

  await t.test('month metrics persisted and agree with the user summary', async () => {
    const doc = await container.monthRepository.find('2026-10');
    assert.ok(doc);
    assert.equal(doc.metrics.daysLogged, 5);
    assert.equal(doc.metrics.hoursTotal, 7.67);
    assert.equal(doc.metrics.consistencyRate, 38.46);
    assert.equal(doc.metrics.passiveLearningRatio, 20);
  });

  await t.test('the repeat flag survived the round trip', async () => {
    const e = await container.dailyLogRepository.findByDate('2026-10-07');
    assert.equal(e.plan.isRepeat, true);
    assert.equal(e.plan.repeatOf, '2026-10-06');
  });

  await t.test('the machine-written blocker flag survived the round trip', async () => {
    assert.equal((await container.dailyLogRepository.findByDate('2026-10-07')).blockers.machineWritten, true);
    assert.equal((await container.dailyLogRepository.findByDate('2026-10-08')).blockers.machineWritten, false);
  });

  await t.test('time blocks including the midnight crossing persisted', async () => {
    const e = await container.dailyLogRepository.findByDate('2026-10-05');
    const crossing = e.timeBlocks.find((b) => b.crossesMidnight);
    assert.ok(crossing, 'expected a block crossing midnight');
    assert.equal(crossing.durationMin, 90);
    assert.equal(crossing.end, '1:00 am');
  });

  await t.test('insights upsert by content hash — regeneration does not duplicate', async () => {
    const payload = [{ section: 'RISK', title: 'T', body: 'B', evidenceDates: ['2026-10-05'], severity: 'HIGH' }];
    await container.insightRepository.upsertMany(payload, { month: '2026-10' });
    await container.insightRepository.upsertMany(payload, { month: '2026-10' });
    const stored = await container.insightRepository.findByMonth('2026-10');
    assert.equal(stored.length, 1, 'identical insight must not be stored twice');
    assert.equal(stored[0].status, 'OPEN');
  });

  await t.test('a dismissed insight is remembered, not deleted', async () => {
    await container.insightRepository.dismissAllForMonth('2026-10');
    assert.equal((await container.insightRepository.findByMonth('2026-10'))[0].status, 'DISMISSED');
  });

  await t.test('quarantine rows are recorded and resolvable', async () => {
    const unresolved = await container.quarantineRepository.unresolved();
    assert.ok(unresolved.length >= 1);
    await container.quarantineRepository.resolve(unresolved[0]._id);
    assert.equal((await container.quarantineRepository.unresolved()).length, unresolved.length - 1);
  });

  await t.test('settings round-trip', async () => {
    await container.settingsRepository.set('targetDailyHours', 4);
    assert.equal(await container.settingsRepository.get('targetDailyHours'), 4);
    assert.equal(await container.settingsRepository.get('missing', 'fallback'), 'fallback');
  });

  await t.test('import log records the sha256 and the unit decision', async () => {
    const log = (await container.importLogRepository.list()).find(
      (l) => l.fileName === 'October_Accountability-2.xlsx'
    );
    assert.ok(log);
    assert.equal(log.headerRow, 4);
    assert.equal(log.agreement.agrees, true);
    assert.equal(log.unitDecisions.GENAI.unit, 'MINUTES');
  });

  await t.after(async () => {
    await shutdown();
  });
});