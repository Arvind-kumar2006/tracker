import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyDailyPlan,
  planToPayload,
  planToForm,
  reviewPlan,
} from '../src/domain/dailyPlan.js';

test('daily plan keeps up to three priorities and converts numeric fields', () => {
  const form = emptyDailyPlan();
  form.items[0].text = 'Solve 10 array problems';
  form.items[0].outcome = '10 working solutions';
  form.items[0].estimatedMinutes = '90';
  form.availableMinutes = '120';

  const payload = planToPayload(form);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].estimatedMinutes, 90);
  assert.equal(payload.availableMinutes, 120);
});

test('saved plans can be loaded back into the editable form', () => {
  const form = planToForm({
    items: [{ id: '2026-10-16-1', n: 1, text: 'Build API', outcome: 'health endpoint works', estimatedMinutes: 60, priority: 'HIGH' }],
    minimumMinutes: 30,
    idealMinutes: 120,
    breakMinutes: 15,
    bufferMinutes: 15,
  });
  assert.equal(form.items[0].text, 'Build API');
  assert.equal(form.items[0].estimatedMinutes, '60');
  assert.equal(form.items[0].priority, 'HIGH');
});

test('plan review flags vague work and schedule overload without changing the plan', () => {
  const form = emptyDailyPlan();
  form.items[0].text = 'Study DSA';
  form.items[0].outcome = '';
  form.items[0].estimatedMinutes = '120';
  form.availableMinutes = '60';

  const reviewed = reviewPlan(form);
  assert.ok(reviewed.warnings.some((w) => w.code === 'VAGUE_TASK'));
  assert.ok(reviewed.warnings.some((w) => w.code === 'MISSING_OUTCOME'));
  assert.ok(reviewed.warnings.some((w) => w.code === 'SCHEDULE_OVERLOAD'));
  assert.equal(form.items[0].text, 'Study DSA');
});

