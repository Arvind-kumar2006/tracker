/** Pure monthly planning rules and analytics. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMonthlyAnalytics,
  monthEnd,
  monthName,
  normaliseMonthlyPlan,
  previousMonth,
  validateMonthlyPlan,
  weekCountForMonth,
} from '../src/domain/services/MonthlyPlan.js';

test('monthly calendar helpers handle month boundaries and week counts', () => {
  assert.equal(monthEnd('2026-10'), '2026-10-31');
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(monthName('2026-10'), 'October');
  assert.equal(weekCountForMonth('2026-10'), 5);
  assert.equal(weekCountForMonth('2026-02'), 4);
});

test('monthly plan normalisation preserves the eight handwritten answers', () => {
  const plan = normaliseMonthlyPlan({
    month: '2026-10',
    input: {
      answers: {
        reviewLastMonth: 'Finished the prototype.',
        blockers: 'Started too late.',
        plannedChange: 'Start before lunch.',
        successOutcomes: 'Ship the tracker and finish the report.',
        deliverables: 'A deployed app and a submitted report.',
        deadlinesCommitments: 'Report due on Friday.',
        weeklyMilestones: 'Week 1 prototype; Week 2 test; Week 3 ship.',
        fitAssessment: 'Yes, after removing one side project.',
      },
      outcomes: [{ outcome: 'Ship the tracker', deliverable: 'Production URL' }],
      weeklyMilestones: [
        { week: 'Week 1', milestone: 'Finish prototype' },
        { week: 'Week 2', milestone: 'Test API' },
      ],
      confidence: 'high',
    },
  });

  assert.equal(plan.month, '2026-10');
  assert.equal(plan.answers.fitAssessment, 'Yes, after removing one side project.');
  assert.equal(plan.weeklyMilestones.length, 2);
  assert.equal(validateMonthlyPlan(plan).ok, true);
});

test('monthly analytics compares milestones, daily focus, and obstacles', () => {
  const analytics = buildMonthlyAnalytics({
    monthlyPlan: {
      outcomes: [{ outcome: 'Ship tracker' }],
      weeklyMilestones: [{ week: 'Week 1', milestone: 'Prototype' }, { week: 'Week 2', milestone: 'Ship' }],
      extractedObstacles: ['Phone'],
    },
    weeklyPlans: [{ status: 'COMPLETED' }, { status: 'AWAITING_CONFIRMATION' }],
    dailyLogs: [{
      date: '2026-10-01',
      plan: { items: [{ status: 'DONE', minutes: 50, estimatedMinutes: 50 }] },
      totalHoursComputed: 1.5,
      blockers: { segments: ['Phone', 'Late start'] },
    }],
  });

  assert.deepEqual(analytics, {
    plannedOutcomes: 1,
    plannedMilestones: 2,
    completedMilestones: 1,
    completedWeeklyPlans: 1,
    completedDailyOutcomes: 1,
    plannedMinutes: 50,
    actualMinutes: 90,
    loggedDays: 1,
    repeatedObstacles: ['Phone'],
  });
});
