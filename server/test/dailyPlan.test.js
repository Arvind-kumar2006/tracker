import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPlan, reviewDailyPlan } from '../src/domain/services/DailyPlan.js';
import { buildFallbackDailyPlan, unfinishedPlanItems } from '../src/interface/http/dailyPlanRoute.js';
import { saveFocusSession } from '../src/interface/http/focusSessionRoute.js';

test('buildDailyPlan creates a backward-compatible canonical plan', () => {
  const plan = buildDailyPlan({
    date: '2026-10-16',
    input: {
      items: [{ text: 'Solve 10 array problems', outcome: '10 working solutions', estimatedMinutes: 90, priority: 'HIGH' }],
      minimumMinutes: 30,
      idealMinutes: 120,
      breakMinutes: 15,
      bufferMinutes: 15,
    },
  });

  assert.equal(plan.items[0].id, '2026-10-16-1');
  assert.equal(plan.items[0].estimatedMinutes, 90);
  assert.equal(plan.declaredHours, 2);
  assert.equal(plan.minimumMinutes, 30);
});

test('buildDailyPlan rejects more than three priorities', () => {
  assert.throws(
    () => buildDailyPlan({ date: '2026-10-16', input: { items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] } }),
    (error) => error.code === 'IMPOSSIBLE_RANGE'
  );
});

test('buildFallbackDailyPlan creates a transparent editable starter plan', () => {
  const plan = buildFallbackDailyPlan({
    date: '2026-10-16',
    goal: 'prepare for a backend interview',
    availableMinutes: 45,
    minimumMinutes: 30,
    idealMinutes: 120,
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].text, 'prepare for a backend interview');
  assert.equal(plan.items[0].estimatedMinutes, 45);
  assert.match(plan.items[0].outcome, /prepare for a backend interview/);
  assert.equal(plan.availableMinutes, 45);
});

test('reviewDailyPlan flags vague tasks and an overloaded schedule', () => {
  const plan = buildDailyPlan({
    date: '2026-10-16',
    input: {
      items: [{ text: 'Study DSA', outcome: '', estimatedMinutes: 120 }],
      availableMinutes: 60,
    },
  });
  const review = reviewDailyPlan(plan);
  assert.ok(review.warnings.some((w) => w.code === 'VAGUE_TASK'));
  assert.ok(review.warnings.some((w) => w.code === 'MISSING_OUTCOME'));
  assert.ok(review.warnings.some((w) => w.code === 'SCHEDULE_OVERLOAD'));
});

test('unfinishedPlanItems excludes completed priorities and keeps partial work', () => {
  const items = unfinishedPlanItems({ items: [
    { id: 'done', status: 'DONE', estimatedMinutes: 30, actualMinutes: 30 },
    { id: 'partial', status: 'PLANNED', estimatedMinutes: 60, actualMinutes: 20 },
    { id: 'met', status: 'PLANNED', estimatedMinutes: 20, actualMinutes: 20 },
  ] });
  assert.deepEqual(items.map((item) => item.id), ['partial']);
});

test('saveFocusSession adds actual minutes without changing the planned estimate', async () => {
  let stored = {
    date: '2026-10-16',
    month: '2026-10',
    hasData: true,
    plan: {
      items: [{ id: '2026-10-16-1', n: 1, text: 'Build API', estimatedMinutes: 60, actualMinutes: 0 }],
      declaredHours: 1,
    },
    minutes: { genaiMinutes: null, codingMinutes: null, englishMinutes: null, otherMinutes: null },
    blockers: { raw: '', segments: [], machineWritten: false },
    accomplished: '',
    buildOutcome: null,
    targetMet: null,
    tomorrowChange: '',
    totalHoursComputed: null,
    totalHoursReported: null,
    timeBlocks: [],
    focusSessions: [],
  };
  const repositories = {
    dailyLogRepository: {
      findByDate: async () => stored,
      findByMonth: async () => [stored],
      upsertMany: async ([entry]) => { stored = entry; return { matched: 1, modified: 1 }; },
    },
    monthRepository: { find: async () => null, upsert: async () => {} },
  };

  const result = await saveFocusSession({
    date: '2026-10-16',
    payload: { itemId: '2026-10-16-1', durationMinutes: 25, interrupted: true },
    repositories,
  });

  assert.ok(result.ok, result.ok ? '' : result.error.message);
  assert.equal(stored.plan.items[0].estimatedMinutes, 60);
  assert.equal(stored.plan.items[0].actualMinutes, 25);
  assert.equal(stored.focusSessions.length, 1);
  assert.equal(stored.focusSessions[0].interrupted, true);
});

test('saveFocusSession is idempotent when the mobile client retries the same session', async () => {
  let stored = {
    date: '2026-10-16',
    month: '2026-10',
    hasData: true,
    plan: { items: [{ id: 'priority-1', text: 'Build API', estimatedMinutes: 60, actualMinutes: 25 }] },
    minutes: {},
    focusSessions: [{ id: 'focus-retry-1', itemId: 'priority-1', durationMinutes: 25 }],
  };
  let writes = 0;
  const repositories = {
    dailyLogRepository: {
      findByDate: async () => stored,
      findByMonth: async () => [stored],
      upsertMany: async ([entry]) => { writes += 1; stored = entry; return { matched: 1, modified: 1 }; },
    },
    monthRepository: { find: async () => null, upsert: async () => {} },
  };

  const result = await saveFocusSession({
    date: '2026-10-16',
    payload: { id: 'focus-retry-1', itemId: 'priority-1', durationMinutes: 25 },
    repositories,
  });

  assert.ok(result.ok, result.ok ? '' : result.error.message);
  assert.equal(result.value.idempotent, true);
  assert.equal(writes, 0);
  assert.equal(stored.plan.items[0].actualMinutes, 25);
  assert.equal(stored.focusSessions.length, 1);
});

