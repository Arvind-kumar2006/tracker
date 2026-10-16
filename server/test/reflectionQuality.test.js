/**
 * ReflectionQuality tests — drive the graph with a fake LLM.
 *
 * No API key, no network, no cost. The anti-vagueness behaviour
 * must be provable without spending money.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReflectionQualityGraph } from '../src/infrastructure/ai/graphs/reflectionQualityGraph.js';
import { checkReflectionQuality } from '../src/domain/services/ReflectionQualityChecker.js';
import {
  buildReflectionEvidence,
  validateReflectionCoaching,
  buildDeterministicReflectionCoaching,
} from '../src/domain/services/ReflectionCoaching.js';

/* ------------------------------------------------------------------ */
/* Fake LLM                                                            */
/* ------------------------------------------------------------------ */

function fakeLlm(fields) {
  return {
    structured: async ({ task }) => {
      assert.equal(task, 'reflectionQuality');
      return {
        data: {
          fields,
          overallScore: Math.round(fields.reduce((s, f) => s + f.score, 0) / fields.length),
          vagueCount: fields.filter((f) => f.isVague).length,
          isComplete: fields.every((f) => f.score > 0),
          summary: 'Test summary',
        },
        model: 'fake-model',
        tokens: 100,
        cost: 0.001,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tests                                                                */
/* ------------------------------------------------------------------ */

test('checkReflectionQuality: all fields filled with detail', () => {
  const entry = {
    floorHit: true,
    floorHitReason: 'Completed LangChain module 3 on RAG prompting even though I planned 4 hours',
    accomplished: 'Built a small RAG pipeline with 3 documents',
    blockers: 'Avoided phone scrolling for 2 hours — kept it in another room',
    planBend: 'Plan said start at 7pm, actually started at 9:30 — noticed at 10pm',
    tomorrowChange: 'Open VS Code and write the first function signature',
  };

  const result = checkReflectionQuality(entry);
  assert.equal(result.isComplete, true);
  assert.equal(result.vagueCount, 0);
  assert.ok(result.overallScore >= 6);
});

test('checkReflectionQuality: empty entry is incomplete', () => {
  const result = checkReflectionQuality({});
  assert.equal(result.isComplete, false);
  assert.equal(result.vagueCount, 5);
  assert.equal(result.overallScore, 0);
});

test('checkReflectionQuality: vague answers are flagged', () => {
  const entry = {
    floorHit: true,
    floorHitReason: 'yes',
    accomplished: 'studied',
    blockers: 'stuff',
    planBend: 'things',
    tomorrowChange: 'study more',
  };

  const result = checkReflectionQuality(entry);
  assert.ok(result.vagueCount >= 3);
});

test('checkReflectionQuality: Mongo blocker objects are normalized as reflection text', () => {
  const result = checkReflectionQuality({
    floorHit: true,
    floorHitReason: 'Completed the minimum block',
    accomplished: 'Finished module 3',
    blockers: { raw: 'Phone notifications interrupted the 7pm focus block', segments: ['Phone notifications interrupted the 7pm focus block'] },
    planBend: 'Started 30 minutes late',
    tomorrowChange: 'Put phone in another room',
  });

  assert.equal(result.fields.find((field) => field.fieldId === 'blockers').isVague, false);
});

test('checkReflectionQuality: floorHit without reason is vague', () => {
  const entry = {
    floorHit: true,
    floorHitReason: '',
    accomplished: 'Completed module 3',
    blockers: 'phone',
    planBend: 'Plan held',
    tomorrowChange: 'Start early',
  };

  const result = checkReflectionQuality(entry);
  const floorField = result.fields.find((f) => f.fieldId === 'floorHit');
  assert.ok(floorField.isVague);
});

test('deterministic checker distinguishes vague statements from useful short answers', () => {
  const vague = checkReflectionQuality({
    floorHit: true,
    floorHitReason: 'Everything was fine',
    accomplished: 'I wasted time',
    blockers: 'I was lazy',
    planBend: 'The plan changed',
    tomorrowChange: 'I will work harder tomorrow',
  });
  const useful = checkReflectionQuality({
    floorHit: true,
    floorHitReason: 'Completed task 3',
    accomplished: 'Fixed the login test',
    blockers: 'Phone during the 7pm block',
    planBend: 'Started at 9pm instead of 7pm',
    tomorrowChange: 'Open the editor and write the first function',
  });

  assert.ok(vague.vagueCount >= 3);
  assert.equal(useful.vagueCount, 0);
});

test('reflection evidence exposes only recorded plan, focus, and historical facts', () => {
  const entry = {
    date: '2026-10-16',
    hasData: true,
    plan: { items: [{ estimatedMinutes: 60, actualMinutes: 25 }] },
    focusSessions: [{ durationMinutes: 25, interrupted: true }],
    blockers: { raw: 'Phone during the first block' },
  };
  const history = [
    { date: '2026-10-12', hasData: true, plan: { items: [{ estimatedMinutes: 60, actualMinutes: 30 }] } },
    { date: '2026-10-13', hasData: true, plan: { items: [{ estimatedMinutes: 60, actualMinutes: 40 }] } },
    { date: '2026-10-14', hasData: true, plan: { items: [{ estimatedMinutes: 60, actualMinutes: 20 }] } },
  ];
  const evidence = buildReflectionEvidence({ entry, history });

  assert.ok(evidence.allowedRefs.has('today.focus_sessions'));
  assert.ok(evidence.allowedRefs.has('history.plan_vs_actual'));
  assert.ok(!evidence.allowedRefs.has('tomorrow.predicted_success'));
  assert.equal(evidence.historySufficient, true);
});

test('coaching validation drops unsupported claims and keeps evidence-linked claims', () => {
  const evidence = buildReflectionEvidence({
    entry: { date: '2026-10-16', hasData: true, plan: { items: [{ estimatedMinutes: 60, actualMinutes: 30 }] } },
  });
  const result = validateReflectionCoaching({
    observations: [
      { text: 'Recorded focus was 30 minutes.', evidence: ['today.plan.actual_minutes'] },
      { text: 'You were distracted by Discord for three hours.', evidence: ['invented.fact'] },
    ],
    interpretations: [],
    recommendations: [],
  }, evidence);

  assert.equal(result.observations.length, 1);
  assert.equal(result.rejectedCount, 1);
  assert.deepEqual(result.observations[0].evidence, ['today.plan.actual_minutes']);
});

test('prior AI recommendations are context, not evidence', () => {
  const evidence = buildReflectionEvidence({
    entry: { date: '2026-10-16', hasData: true },
    history: [{
      date: '2026-10-15',
      hasData: true,
      reflectionAnalysis: { recommendations: [{ action: 'Use a smaller plan tomorrow.' }] },
    }],
  });

  assert.ok(evidence.facts.some((fact) => fact.kind === 'prior_analysis'));
  assert.equal(evidence.allowedRefs.has('history.analysis.2026-10-15.0'), false);
});

test('mechanical coaching gives a bounded plan adjustment without an LLM', () => {
  const entry = { date: '2026-10-16', hasData: true, plan: { items: [{ estimatedMinutes: 120, actualMinutes: 30 }] } };
  const evidence = buildReflectionEvidence({ entry });
  const result = buildDeterministicReflectionCoaching({
    evidence,
    quality: checkReflectionQuality({ accomplished: 'completed task 1' }),
  });

  assert.equal(result.recommendations.length, 1);
  assert.match(result.recommendations[0].action, /two must-do/i);
  assert.ok(result.recommendations[0].evidence.includes('today.plan.estimated_minutes'));
});

test('graph: produces a report with all fields', async () => {
  const entry = {
    floorHit: true,
    floorHitReason: 'Finished the RAG module even though I planned 4 hours',
    accomplished: 'Built a small RAG pipeline with 3 documents',
    blockers: 'Avoided phone scrolling — kept it in another room',
    planBend: 'Plan said start at 7pm, actually started at 9:30 — noticed at 10pm',
    tomorrowChange: 'Open VS Code and write the first function signature',
  };

  const fields = [
    { fieldId: 'floorHit', score: 9, isVague: false, reason: 'Clear', suggestion: null },
    { fieldId: 'accomplished', score: 9, isVague: false, reason: 'Specific', suggestion: null },
    { fieldId: 'blockers', score: 8, isVague: false, reason: 'Has detail', suggestion: null },
    { fieldId: 'planBend', score: 8, isVague: false, reason: 'Specific', suggestion: null },
    { fieldId: 'tomorrowChange', score: 9, isVague: false, reason: 'Actionable', suggestion: null },
  ];

  const graph = buildReflectionQualityGraph({ llm: fakeLlm(fields) });
  const result = await graph.invoke(
    { date: '2026-10-15', entry },
    { configurable: { thread_id: 'test-thread' } }
  );

  assert.ok(result.report);
  assert.equal(result.report.date, '2026-10-15');
  assert.equal(result.report.fields.length + result.report.droppedFields.length, 5);
  assert.ok(result.report.overallScore >= 7);
});

test('graph: vague answers produce follow-up questions', async () => {
  const entry = {
    floorHit: true,
    floorHitReason: 'yes',
    accomplished: 'studied',
    blockers: 'stuff',
    planBend: 'things went off plan',
    tomorrowChange: 'study more',
  };

  const fields = [
    { fieldId: 'floorHit', score: 3, isVague: true, reason: 'No reason given', suggestion: 'Add one line on why the floor was or wasn\'t hit.' },
    { fieldId: 'accomplished', score: 2, isVague: true, reason: 'Vague', suggestion: 'Name one specific thing you finished.' },
    { fieldId: 'blockers', score: 2, isVague: true, reason: 'Vague', suggestion: 'Name what you avoided AND what you did instead.' },
    { fieldId: 'planBend', score: 3, isVague: true, reason: 'Vague', suggestion: 'Where exactly did the plan first bend?' },
    { fieldId: 'tomorrowChange', score: 2, isVague: true, reason: 'Vague', suggestion: 'What\'s the first small action tomorrow starts with?' },
  ];

  const graph = buildReflectionQualityGraph({ llm: fakeLlm(fields) });
  const result = await graph.invoke(
    { date: '2026-10-15', entry },
    { configurable: { thread_id: 'test-thread' } }
  );

  assert.ok(result.report);
  assert.ok(result.report.followUpQuestions.length > 0);
  assert.ok(result.report.followUpQuestions.length <= 2);
  assert.equal(result.report.status, 'needs_clarification');
});

test('graph: malformed model fields fall back to deterministic field validation', async () => {
  const graph = buildReflectionQualityGraph({
    llm: {
      structured: async () => ({
        data: {
          fields: [{ fieldId: 'accomplished', score: 'ten', reason: {}, suggestion: {} }],
          summary: {},
        },
      }),
    },
  });
  const result = await graph.invoke(
    { date: '2026-10-15', entry: { accomplished: 'Fixed login test' } },
    { configurable: { thread_id: 'malformed-model-thread' } }
  );

  assert.ok(result.report);
  assert.equal(result.report.fields.length + result.report.droppedFields.length, 5);
  assert.ok(Number.isFinite(result.report.overallScore));
  assert.ok(result.report.fields.every((field) => Number.isInteger(field.score)));
});

test('graph: provider failure still returns deterministic coaching', async () => {
  const graph = buildReflectionQualityGraph({
    llm: { structured: async () => { throw new Error('provider unavailable'); } },
  });
  const result = await graph.invoke(
    {
      date: '2026-10-15',
      entry: { date: '2026-10-15', hasData: true, plan: { items: [{ estimatedMinutes: 90, actualMinutes: 20 }] } },
    },
    { configurable: { thread_id: 'provider-fallback-thread' } }
  );

  assert.ok(result.report);
  assert.equal(result.report.status, 'fallback');
  assert.ok(result.report.recommendations.length > 0);
  assert.ok(result.errors.length > 0);
});

test('graph: missing entry produces an error', async () => {
  const graph = buildReflectionQualityGraph({ llm: fakeLlm([]) });
  const result = await graph.invoke(
    { date: '2026-10-15', entry: null },
    { configurable: { thread_id: 'test-thread' } }
  );

  assert.ok(result.errors.length > 0);
  assert.ok(!result.report);
});
