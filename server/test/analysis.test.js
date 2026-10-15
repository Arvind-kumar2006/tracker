/**
 * Phase 3 graph tests.
 *
 * These run the REAL LangGraph pipeline against a FAKE LLM — no API key, no network. That is the
 * point of the LLMPort abstraction: the safety-critical behaviour (the validator rejecting
 * fabricated citations) must be provable without spending money or needing credentials.
 *
 * The fake deliberately returns Hallucinated first-pass output so the regeneration loop and the
 * evidence gate are exercised, not just the happy path.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { readWorkbook } from '../src/infrastructure/persistence/xlsx/xlsxReader.js';
import { normalizeWorkbook } from '../src/domain/services/WorkbookNormalizer.js';
import { extractConstraints } from '../src/domain/services/ConstraintExtractor.js';
import { validateBundle, validateInsight, allowedDates, assertEnoughData } from '../src/domain/services/InsightValidator.js';
import { buildAnalysisGraph } from '../src/infrastructure/ai/graphs/analysisGraph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(__dirname, '../../October_Accountability-2.xlsx');

const wb = await readWorkbook(WORKBOOK);
const { entries } = normalizeWorkbook({ rows: wb.sheets[0].rows, fileName: wb.fileName });
const MONTH = '2026-10';

/* ================================================================== *
 * 1. The validator in isolation — pure, the most important tests
 * ================================================================== */

test('validator: the allowed set excludes all 26 blank days', () => {
  const allowed = allowedDates(entries);
  assert.equal(entries.length, 31);
  assert.equal(allowed.size, 5);
  assert.equal(allowed.has('2026-10-25'), false);
  assert.equal(allowed.has('2026-10-12'), false);
});

test('validator: an insight citing a blank day is rejected', () => {
  const r = validateInsight(
    { title: 'October slump', body: 'b', section: 'COSTING_YOU', severity: 'HIGH',
      evidence: [{ date: '2026-10-20', quote: 'i did nothing today' }] },
    allowedDates(entries)
  );
  assert.ok(r);
  assert.equal(r.reason, 'CITES_EMPTY_OR_UNKNOWN_DAY');
});

test('validator: an insight with a quote the day never said is rejected', () => {
  const r = validateInsight(
    { title: 'Slept badly', body: 'b', section: 'COSTING_YOU', severity: 'MEDIUM',
      evidence: [{ date: '2026-10-05', quote: 'i watched lectures in bed all morning' }] },
    allowedDates(entries)
  );
  assert.ok(r);
  assert.equal(r.reason, 'QUOTE_NOT_FOUND_IN_SOURCE');
});

test('validator: an insight with no evidence at all is rejected', () => {
  const r = validateInsight(
    { title: 'Generally going well', body: 'b', section: 'WELL', severity: 'INFO', evidence: [] },
    allowedDates(entries)
  );
  assert.equal(r.reason, 'NO_EVIDENCE');
});

test('validator: a genuine, verbatim-cited insight is accepted', () => {
  const r = validateInsight(
    { title: 'Passive learning on Oct 5', body: 'b', section: 'COSTING_YOU', severity: 'HIGH',
      evidence: [{ date: '2026-10-05', quote: 'only watch like a movie' }] },
    allowedDates(entries)
  );
  assert.equal(r, null, 'a truthful, cited insight must survive');
});

test('validator: quote matching tolerates smart punctuation', () => {
  const r = validateInsight(
    { title: 'x', body: 'b', section: 'COSTING_YOU', severity: 'LOW',
      evidence: [{ date: '2026-10-05', quote: "I DON'T code myself" }] },
    allowedDates(entries)
  );
  assert.equal(r, null, 'capitalisation and a typographic apostrophe must not count as fabrication');
});

test('validator: a quote the day did not actually say is still caught', () => {
  // Guards against over-loose matching: the corpus says "don't code myself", never "didn't".
  const r = validateInsight(
    { title: 'x', body: 'b', section: 'COSTING_YOU', severity: 'LOW',
      evidence: [{ date: '2026-10-05', quote: "i didn't code myself" }] },
    allowedDates(entries)
  );
  assert.ok(r);
  assert.equal(r.reason, 'QUOTE_NOT_FOUND_IN_SOURCE');
});

test('validator: a one-word quote is rejected as too short to be evidence', () => {
  const r = validateInsight(
    { title: 'x', body: 'b', section: 'WELL', severity: 'INFO',
      evidence: [{ date: '2026-10-05', quote: 'i' }] },
    allowedDates(entries)
  );
  assert.equal(r.reason, 'EVIDENCE_MISSING_QUOTE');
});

test('validator: mixed batch keeps the honest ones and drops the fabricated', () => {
  const r = validateBundle({
    entries,
    insights: [
      { title: 'OK', body: 'b', section: 'WELL', severity: 'INFO',
        evidence: [{ date: '2026-10-08', quote: 'did the image captioning part of OJT' }] },
      { title: 'FABRICATED DAY', body: 'b', section: 'COSTING_YOU', severity: 'HIGH',
        evidence: [{ date: '2026-10-22', quote: 'anything at all here' }] },
      { title: 'FABRICATED QUOTE', body: 'b', section: 'COSTING_YOU', severity: 'HIGH',
        evidence: [{ date: '2026-10-06', quote: 'i studied for nine hours straight' }] },
    ],
  });
  assert.equal(r.insights.length, 1);
  assert.equal(r.insights[0].title, 'OK');
  assert.equal(r.stats.fabricatedDayCitations, 1);
  assert.equal(r.stats.insightsIn, 3);
  assert.equal(r.stats.insightsOut, 1);
});

test('validator: rejected items are reported, never silently dropped', () => {
  const r = validateBundle({
    entries,
    insights: [{ title: 'X', body: 'b', section: 'WELL', severity: 'INFO', evidence: [] }],
  });
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].reason, 'NO_EVIDENCE');
  assert.equal(r.rejected[0].kind, 'insight');
});

/* ================================================================== *
 * 2. Constraint enforcement
 * ================================================================== */

test('constraints: the user\'s own midnight rule is extracted', () => {
  const c = extractConstraints(entries);
  const tw = c.find((x) => x.type === 'TIME_WINDOW');
  assert.ok(tw, 'expected a TIME_WINDOW constraint');
  assert.equal(tw.notAfterMinutes, 0, '"Can’t study after the 12 am" means midnight');
});

test('constraints: prior AI-written text is not laundered into a hard constraint', () => {
  const c = extractConstraints(entries);
  const fromAi = c.find((x) => x.text.includes('non-negotiable'));
  assert.equal(fromAi, undefined, 'machine-written advice must not become the user\'s rule');
});

test('constraints: ordering rules from column M are captured', () => {
  const c = extractConstraints(entries);
  assert.ok(c.some((x) => x.type === 'ORDERING' && /milk/i.test(x.text)));
});

/* ================================================================== *
 * 3. The sufficiency gate
 * ================================================================== */

test('sufficiency gate: refuses a month with no data', () => {
  const gate = assertEnoughData(entries.filter((e) => !e.hasData));
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'INSUFFICIENT_DATA');
});

test('sufficiency gate: accepts the real month', () => {
  assert.equal(assertEnoughData(entries).ok, true);
});

/* ================================================================== *
 * 4. The full graph, driven by a fake LLM
 * ================================================================== */

/** A model that cites a blank day on the first pass, then behaves on the retry. */
function makeFakeLlm({ fabricateFirst = true } = {}) {
  const calls = [];
  let critiqueCall = 0;

  return {
    calls,
    async structured({ task, schema }) {
      calls.push(task);

      if (task === 'detectPatterns') {
        return {
          data: {
            patterns: [
              {
                category: 'passive_learning',
                summary: 'Oct 5 was watch-only, not build.',
                severity: 'HIGH',
                evidence: [{ date: '2026-10-05', quote: 'only watch like a movie' }],
              },
            ],
          },
          model: 'fake/fast', cost: 0.0001, tokens: 100, fellBack: false,
        };
      }

      if (task === 'critique') {
        critiqueCall += 1;
        const data = fabricateFirst && critiqueCall === 1
          ? {
              wentWell: [],
              costingYou: [
                // Fabrication #1: cites a day with no data at all.
                { section: 'COSTING_YOU', title: 'You went quiet after the 9th',
                  body: 'Your last two weeks were empty.', severity: 'HIGH',
                  evidence: [{ date: '2026-10-22', quote: 'nothing recorded' }] },
                // Fabrication #2: a quote that day never contained.
                { section: 'COSTING_YOU', title: 'Sleep is destroying output',
                  body: 'You overslept badly.', severity: 'MEDIUM',
                  evidence: [{ date: '2026-10-06', quote: 'i slept until 11 am and lost the morning' }] },
                // Truthful: verbatim and on a real day.
                { section: 'COSTING_YOU', title: 'Plans over-promise by half',
                  body: 'You declared 4 hours and logged under 2.', severity: 'HIGH',
                  evidence: [{ date: '2026-10-07', quote: 'complete the 1.5 lecture of gen ai' }] },
              ],
            }
          : {
              wentWell: [],
              costingYou: [
                { section: 'COSTING_YOU', title: 'Plans over-promise by half',
                  body: 'You declared 4 hours and logged under 2.', severity: 'HIGH',
                  evidence: [{ date: '2026-10-07', quote: 'complete the 1.5 lecture of gen ai' }] },
              ],
            };
        return { data, model: 'fake/strong', cost: 0.002, tokens: 500, fellBack: false };
      }

      if (task === 'coach') {
        return {
          data: {
            actions: [
              // Violates the user's "cannot study after 12 am" rule.
              { action: 'Finish the RAG lecture', why: 'w', firstStep: 'open the repo',
                timeBox: '11:30 pm - 1:00 am',
                evidence: [{ date: '2026-10-07', quote: 'complete the 1.5 lecture of gen ai' }] },
              // Respects it.
              { action: 'Code the document loader', why: 'w', firstStep: 'write one test',
                timeBox: '7:00 pm - 9:00 pm',
                evidence: [{ date: '2026-10-08', quote: 'did the image captioning part of OJT' }] },
            ],
          },
          model: 'fake/strong', cost: 0.001, tokens: 300, fellBack: false,
        };
      }

      if (task === 'critiquePlans') {
        return {
          data: {
            critiques: [
              { date: '2026-10-07',
                axes: {
                  specific: { score: 8, note: 'named tasks' },
                  timeboxed: { score: 9, note: 'has durations' },
                  measurable: { score: 6, note: 'vague on done-ness' },
                  realistic: { score: 3, note: 'declared 4h, logged 2.08h' },
                },
                overall: 6,
                issues: ['Declared 4 hours but logged 2.08'],
                rewrittenBlocks: [{ label: 'LangChain lecture', start: '7:00 pm', durationMin: 120 }],
                summary: 'Well-structured, consistently under-scoped.' },
            ],
          },
          model: 'fake/strong', cost: 0.001, tokens: 400, fellBack: false,
        };
      }

      throw new Error(`fake llm got unexpected task "${task}"`);
    },
    async *stream() { yield ''; },
  };
}

let graphResult;

before(async () => {
  const llm = makeFakeLlm({ fabricateFirst: true });
  const graph = buildAnalysisGraph({ llm });
  graphResult = await graph.invoke(
    { month: MONTH, asOf: '2026-10-13', entries },
    { configurable: { thread_id: 'test-thread' } }
  );
});

test('graph: the data-sufficiency gate short-circuits on a thin month', async () => {
  const llm = makeFakeLlm();
  const graph = buildAnalysisGraph({ llm });
  const res = await graph.invoke(
    { month: MONTH, asOf: '2026-10-13', entries: entries.filter((e) => !e.hasData) },
    { configurable: { thread_id: 'thin' } }
  );
  assert.ok(res.insufficient, 'expected the gate to fire');
  assert.equal(res.insufficient.code, 'INSUFFICIENT_DATA');
  assert.ok(!res.bundle, 'no bundle should be produced from a thin month');
  assert.deepEqual(llm.calls, [], 'the LLM must not be called at all');
});

test('graph: fabricated citations are dropped by the validator', () => {
  const titles = graphResult.insights.map((i) => i.title);
  assert.ok(!titles.includes('You went quiet after the 9th'), 'blank-day citation must not survive');
  assert.ok(!titles.includes('Sleep is destroying output'), 'invented quote must not survive');
});

test('graph: the truthful insight survives', () => {
  assert.ok(graphResult.insights.some((i) => i.title === 'Plans over-promise by half'));
});

test('graph: the retry pass replaced the rejected output instead of stacking it', () => {
  // "attempts" counts critique passes, so 2 passes == exactly one regeneration.
  assert.equal(graphResult.attempts, 2, 'exactly one regeneration should have run');

  const dups = graphResult.insights.filter((i) => i.title === 'Plans over-promise by half');
  assert.equal(dups.length, 1, 'the rejected first attempt must be gone, not merely filtered out');
});

test('graph: the validator reports exactly what it dropped', () => {
  // The final pass produced only truthful output, so nothing was dropped from what the user
  // sees. The first attempt's failures live in rejectionHistory instead.
  assert.deepEqual(graphResult.rejected, []);
  assert.deepEqual(graphResult.bundle.rejected, []);

  const history = graphResult.bundle.rejectionHistory;
  assert.ok(history.some((r) => r.reason === 'CITES_EMPTY_OR_UNKNOWN_DAY'), 'blank-day citation recorded');
  assert.ok(history.some((r) => r.reason === 'QUOTE_NOT_FOUND_IN_SOURCE'), 'invented quote recorded');
});

test('graph: the bundle states that a regeneration happened and what it fixed', () => {
  const regen = graphResult.bundle.regeneration;
  assert.equal(regen.ran, true);
  assert.equal(regen.critiquePasses, 2);
  assert.ok(regen.correctedAfterRetry >= 2, 'the two fabricated claims were corrected on retry');
});

test('graph: a constraint-violating action is rejected and surfaced', () => {
  const actionTexts = graphResult.actions.map((a) => a.action);
  assert.ok(!actionTexts.includes('Finish the RAG lecture'), 'the 11:30pm-1am action must be dropped');
  assert.ok(actionTexts.includes('Code the document loader'), 'the compliant action must survive');

  // Assert against the rendered bundle, which flattens `item.action` to `action`.
  const rejectedAction = graphResult.bundle.rejectedActions.find((r) => r.action === 'Finish the RAG lecture');
  assert.ok(rejectedAction, 'the rejection must be reported to the user, not hidden');
  assert.equal(rejectedAction.reason, 'CONSTRAINT_VIOLATION');
  assert.match(rejectedAction.constraint, /study after the 12 am/i);
});

test('graph: the bundle is rendered and self-describing', () => {
  const b = graphResult.bundle;
  assert.ok(b);
  assert.equal(b.month, MONTH);
  assert.ok(Array.isArray(b.wentWell));
  assert.ok(Array.isArray(b.costingYou));
  assert.ok(Array.isArray(b.rejected));
  assert.ok(Array.isArray(b.actions));
  assert.ok(Array.isArray(b.constraints));
  assert.ok(b.metrics);
  assert.ok(b.cost.credits > 0, 'cost must be tracked, not guessed');
  assert.deepEqual(b.cost.modelsUsed, ['fake/fast', 'fake/strong']);
});

test('graph: validation stats expose the safety numbers', () => {
  const s = graphResult.validationStats;
  assert.equal(s.totalDays, 31, 'the whole month, including blank days');
  assert.equal(s.emptyDays, 26);
  assert.equal(s.allowedDateCount, 5);
  assert.ok(s.rejectedCount >= 1);
});

test('graph: every surviving insight cites only real days', () => {
  const allowed = allowedDates(entries);
  for (const i of graphResult.insights) {
    for (const e of i.evidence) {
      assert.ok(allowed.has(e.date), `${i.title} cites non-citable day ${e.date}`);
    }
  }
});

test('graph: plan critiques are produced', () => {
  assert.equal(graphResult.planCritiques.length, 1);
  assert.equal(graphResult.planCritiques[0].date, '2026-10-07');
  assert.equal(graphResult.planCritiques[0].axes.realistic.score, 3);
});