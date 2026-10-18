import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeeklyAnalytics,
  normaliseWeeklyPlan,
  previousWeekStart,
  weekEndForStart,
  weekNumberOfMonth,
  weekStartForDate,
} from '../src/domain/services/WeeklyPlan.js';

test('weekly dates are Monday through Sunday and week number is month-based', () => {
  assert.equal(weekStartForDate('2026-10-18'), '2026-10-12');
  assert.equal(weekEndForStart('2026-10-12'), '2026-10-18');
  assert.equal(previousWeekStart('2026-10-12'), '2026-10-05');
  assert.equal(weekNumberOfMonth('2026-10-12'), 2);
});

test('weekly plans are bounded and analytics compares planned and actual minutes', () => {
  const plan = normaliseWeeklyPlan({
    weekStart: '2026-10-12',
    input: {
      answers: {
        reviewLastWeek: 'Finished one item', blockers: 'Late start', plannedChange: 'Start at 9',
        successOutcomes: 'Ship the endpoint', deliverables: 'Health endpoint by Thursday',
        fixedCommitments: 'Classes', fitAssessment: 'Yes',
      },
      outcomes: [{ outcome: 'Ship API', deliverable: 'Health endpoint', completionDay: 'Thursday' }],
      dailyBlocks: [{ day: 'Monday', type: 'Build', action: 'Implement route', result: 'Route works', start: '09:00', hardStop: '10:30' }],
    },
  });
  const analytics = buildWeeklyAnalytics({
    weeklyPlan: plan,
    dailyLogs: [{ date: '2026-10-12', totalHoursComputed: 1, plan: { items: [{ status: 'DONE', actualMinutes: 60, estimatedMinutes: 60 }] }, blockers: { segments: ['Late start'] } }],
  });
  assert.equal(analytics.plannedMinutes, 90);
  assert.equal(analytics.actualMinutes, 60);
  assert.deepEqual(analytics.repeatedObstacles, ['Late start']);
});
