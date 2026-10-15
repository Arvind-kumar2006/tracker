/**
 * End-to-end: import -> precheck -> analyse -> persist.
 * Uses a fake LLM so it runs without an API key.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const mongoUp = await new Promise((resolve) => {
  const s = net.createConnection({ host: '127.0.0.1', port: 27017 }, () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.setTimeout(1000, () => { s.destroy(); resolve(false); });
});

const it = mongoUp ? test : test.skip;
if (!mongoUp) console.log('[skip] mongod not reachable — e2e test skipped');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(__dirname, '../../October_Accountability-2.xlsx');

it('end-to-end import -> analyse -> persist', async (t) => {
  const { container, shutdown } = await import('../src/shared/di/container.js');
  const { generateInsights } = await import('../src/application/useCases/generateInsights.js');

  // Node runs test FILES in parallel, and persistence.test.js also drops a database. Sharing
  // one database would have the two files deleting each other's data mid-run.
  process.env.MONGO_DB_NAME = 'study_tracker_e2e';

  await container.mongo.connect();
  await container.mongo.getDb().dropDatabase();
  await container.importWorkbooks({ force: true, asOf: '2026-10-13' });

  const llm = {
    async structured({ task }) {
      if (task === 'detectPatterns')
        return { data: { patterns: [{ category: 'passive_learning', severity: 'HIGH',
          summary: 'Oct 5 was watch-only, not build.',
          evidence: [{ date: '2026-10-05', quote: 'only watch like a movie' }] }] },
          model: 'google/gemini-2.5-flash', cost: 0.00021, tokens: 820 };
      if (task === 'critique')
        return { data: {
            wentWell: [{ section: 'WELL', title: 'OJT shipped', body: 'x', severity: 'INFO',
              evidence: [{ date: '2026-10-08', quote: 'did the image captioning part of OJT' }] }],
            costingYou: [
              { section: 'COSTING_YOU', title: 'Plan 4h deliver 2h', body: 'x', severity: 'HIGH',
                evidence: [{ date: '2026-10-07', quote: 'complete the 1.5 lecture of gen ai' }] },
              { section: 'COSTING_YOU', title: 'INVENTED', body: 'x', severity: 'HIGH',
                evidence: [{ date: '2026-10-24', quote: 'never happened' }] }] },
          model: 'anthropic/claude-sonnet-4.6', cost: 0.00412, tokens: 2140 };
      if (task === 'coach')
        return { data: { actions: [
            { action: 'Plan 2 hours not 4', why: 'x', firstStep: 'x', timeBox: '7:00 pm - 9:00 pm',
              evidence: [{ date: '2026-10-07', quote: 'complete the 1.5 lecture of gen ai' }] },
            { action: 'Midnight session', why: 'x', firstStep: 'x', timeBox: '11:30 pm - 1:00 am',
              evidence: [{ date: '2026-10-06', quote: "Can't study after the 12 am" }] }] },
          model: 'anthropic/claude-sonnet-4.6', cost: 0.00203, tokens: 990 };
      if (task === 'critiquePlans')
        return { data: { critiques: [{ date: '2026-10-07',
            axes: { specific: { score: 8, note: '' }, timeboxed: { score: 9, note: '' },
                    measurable: { score: 6, note: '' }, realistic: { score: 3, note: '4h planned 2.08h done' } },
            overall: 6, issues: ['Declared 4 hours, delivered 2.08'],
            rewrittenBlocks: [{ label: 'LangChain', start: '7:00 pm', durationMin: 120 }],
            summary: 'Structured but under-scoped.' }] },
          model: 'anthropic/claude-sonnet-4.6', cost: 0.00188, tokens: 1100 };
      throw new Error('unexpected ' + task);
    },
    async *stream() {},
  };

  const result = await generateInsights({
    dailyLogRepository: container.dailyLogRepository,
    monthRepository: container.monthRepository,
    insightRepository: container.insightRepository,
    planCritiqueRepository: container.planCritiqueRepository,
    llm, month: '2026-10', asOf: '2026-10-13',
  });

  assert.ok(result.ok, result.ok ? '' : result.error.message);
  const bundle = result.value.bundle;

  await t.test('the fabricated claim was dropped, the honest ones kept', () => {
    const titles = [...bundle.wentWell, ...bundle.costingYou].map((i) => i.title);
    assert.ok(!titles.includes('INVENTED'), 'blank-day citation must not reach the user');
    assert.ok(titles.includes('OJT shipped'));
    assert.ok(titles.includes('Plan 4h deliver 2h'));
  });

  await t.test('the midnight action was dropped for breaking the stated rule', () => {
    assert.deepEqual(bundle.actions.map((a) => a.action), ['Plan 2 hours not 4']);
    assert.equal(bundle.rejectedActions[0].reason, 'CONSTRAINT_VIOLATION');
  });

  await t.test('safety stats are honest about the blank days', () => {
    assert.equal(bundle.validationStats.allowedDateCount, 5);
    assert.equal(bundle.validationStats.totalDays, 31);
    assert.equal(bundle.validationStats.emptyDays, 26);
  });

  await t.test('insights are persisted under the correct month key', async () => {
    const rows = await container.insightRepository.findByMonth('2026-10');
    assert.equal(rows.length, 2, 'both validated insights must be stored');
    for (const r of rows) assert.equal(r.month, '2026-10');
    // Nothing may be written under an undefined month.
    const orphan = await container.mongo.getDb().collection('insights').countDocuments({ month: null });
    assert.equal(orphan, 0, 'insights must never be written with a null/undefined month');
  });

  await t.test('re-running does not duplicate insights', async () => {
    await generateInsights({
      dailyLogRepository: container.dailyLogRepository, monthRepository: container.monthRepository,
      insightRepository: container.insightRepository, planCritiqueRepository: container.planCritiqueRepository,
      llm, month: '2026-10', asOf: '2026-10-13',
    });
    assert.equal((await container.insightRepository.findByMonth('2026-10')).length, 2);
  });

  await t.test('plan critiques are persisted', async () => {
    const list_ = await container.planCritiqueRepository.list();
    assert.equal(list_.length, 1);
    assert.equal(list_[0].date, '2026-10-07');
  });

  await t.test('cost was accumulated across every node', () => {
    assert.ok(bundle.cost.credits > 0);
    assert.ok(bundle.cost.tokens > 0);
    assert.deepEqual(bundle.cost.modelsUsed.sort(), ['anthropic/claude-sonnet-4.6', 'google/gemini-2.5-flash']);
  });

  await t.after(async () => { await shutdown(); });
});