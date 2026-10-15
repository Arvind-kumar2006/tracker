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
  assert.equal(result.report.fields.length, 5);
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
  assert.ok(result.report.followUpQuestions.length <= 3);
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
