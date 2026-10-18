const ISO_MONTH = /^\d{4}-\d{2}$/;

const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const array = (value) => (Array.isArray(value) ? value : []);

function monthDate(value) {
  if (!ISO_MONTH.test(String(value ?? ''))) throw new Error(`invalid month "${value}"`);
  const date = new Date(`${value}-01T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid month "${value}"`);
  return date;
}

const monthKey = (date) => date.toISOString().slice(0, 7);

export function monthForDate(value) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`invalid ISO date "${value}"`);
  return text.slice(0, 7);
}

export function monthEnd(month) {
  const date = monthDate(month);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

export function previousMonth(month) {
  const date = monthDate(month);
  date.setUTCMonth(date.getUTCMonth() - 1, 1);
  return monthKey(date);
}

export function monthName(month) {
  return monthDate(month).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
}

export function monthYear(month) {
  return Number(month.slice(0, 4));
}

export function weekCountForMonth(month) {
  const date = monthDate(month);
  return Math.ceil(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate() / 7);
}

function cleanOutcome(item) {
  return {
    outcome: clean(item?.outcome, 500),
    deliverable: clean(item?.deliverable, 700),
  };
}

function cleanDeadline(item) {
  return {
    text: clean(item?.text ?? item?.deadline, 500),
    date: clean(item?.date ?? item?.when, 80),
  };
}

function cleanCommitment(item) {
  return {
    text: clean(item?.text ?? item?.commitment, 500),
    when: clean(item?.when ?? item?.date, 120),
  };
}

function cleanMilestone(item) {
  return {
    week: clean(item?.week, 40),
    milestone: clean(item?.milestone ?? item?.text, 700),
  };
}

export function normaliseMonthlyPlan({ month, input = {}, image = null } = {}) {
  const key = monthDate(month) && month;
  const answers = input.answers ?? {};
  const plannedChange = clean(answers.plannedChange ?? input.plannedChange);
  return {
    month: key,
    monthName: monthName(key),
    year: monthYear(key),
    monthEnd: monthEnd(key),
    weekCount: weekCountForMonth(key),
    answers: {
      reviewLastMonth: clean(answers.reviewLastMonth),
      blockers: clean(answers.blockers),
      plannedChange,
      successOutcomes: clean(answers.successOutcomes),
      deliverables: clean(answers.deliverables),
      deadlinesCommitments: clean(answers.deadlinesCommitments),
      weeklyMilestones: clean(answers.weeklyMilestones),
      fitAssessment: clean(answers.fitAssessment),
    },
    outcomes: array(input.outcomes).map(cleanOutcome).filter((item) => item.outcome || item.deliverable).slice(0, 3),
    expectedDeliverables: clean(input.expectedDeliverables, 4000),
    majorDeadlines: array(input.majorDeadlines).map(cleanDeadline).filter((item) => item.text).slice(0, 30),
    fixedCommitments: array(input.fixedCommitments ?? input.commitments).map(cleanCommitment).filter((item) => item.text).slice(0, 30),
    weeklyMilestones: array(input.weeklyMilestones).map(cleanMilestone).filter((item) => item.milestone).slice(0, 5),
    extractedObstacles: array(input.extractedObstacles).map((item) => clean(item, 300)).filter(Boolean).slice(0, 30),
    plannedChange,
    unclearSections: array(input.unclearSections).map((item) => clean(item, 160)).filter(Boolean).slice(0, 20),
    confidence: ['low', 'medium', 'high'].includes(input.confidence) ? input.confidence : 'low',
    ...(image ? { image } : {}),
  };
}

export function validateMonthlyPlan(plan) {
  const required = [
    'reviewLastMonth', 'blockers', 'plannedChange', 'successOutcomes',
    'deliverables', 'deadlinesCommitments', 'weeklyMilestones', 'fitAssessment',
  ];
  const missingAnswers = required.filter((key) => !clean(plan?.answers?.[key]));
  const hasPlanContent = (plan?.outcomes ?? []).length > 0 || clean(plan?.answers?.successOutcomes) !== '';
  return {
    ok: missingAnswers.length === 0 && hasPlanContent,
    missingAnswers,
    message: missingAnswers.length
      ? `Please confirm an answer for question ${required.indexOf(missingAnswers[0]) + 1}.`
      : !hasPlanContent ? 'Please confirm at least one monthly outcome.' : null,
  };
}

export function buildMonthlyAnalytics({ monthlyPlan, weeklyPlans = [], dailyLogs = [] } = {}) {
  const plannedMinutes = dailyLogs.reduce((sum, entry) => {
    const items = entry.plan?.items ?? [];
    return sum + items.reduce((total, item) => total + (Number(item.minutes ?? item.estimatedMinutes) || 0), 0);
  }, 0);
  const actualMinutes = dailyLogs.reduce((sum, entry) => {
    const hours = Number(entry.totalHoursComputed ?? entry.totalHoursReported);
    return sum + (Number.isFinite(hours) ? hours * 60 : 0);
  }, 0);
  const completedDailyOutcomes = dailyLogs.flatMap((entry) => entry.plan?.items ?? [])
    .filter((item) => item.status === 'DONE' || Number(item.actualMinutes ?? 0) >= Number(item.estimatedMinutes ?? 0)).length;
  const completedWeeklyPlans = weeklyPlans.filter((plan) => plan.status === 'COMPLETED').length;
  const obstacles = [
    ...(monthlyPlan?.extractedObstacles ?? []),
    ...dailyLogs.flatMap((entry) => entry.blockers?.segments ?? []),
  ].map((item) => clean(item, 300)).filter(Boolean);
  const uniqueObstacles = [...new Set(obstacles.map((item) => item.toLowerCase()))]
    .map((key) => obstacles.find((item) => item.toLowerCase() === key));

  return {
    plannedOutcomes: monthlyPlan?.outcomes?.length ?? 0,
    plannedMilestones: monthlyPlan?.weeklyMilestones?.length ?? 0,
    completedMilestones: Math.min(monthlyPlan?.weeklyMilestones?.length ?? 0, completedWeeklyPlans),
    completedWeeklyPlans,
    completedDailyOutcomes,
    plannedMinutes,
    actualMinutes: Math.round(actualMinutes),
    loggedDays: new Set(dailyLogs.map((entry) => entry.date)).size,
    repeatedObstacles: uniqueObstacles.filter((obstacle) => obstacles.filter((item) => item.toLowerCase() === obstacle.toLowerCase()).length > 1).slice(0, 20),
  };
}

export { ISO_MONTH };
