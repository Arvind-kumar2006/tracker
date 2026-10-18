const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function dateAtNoon(value) {
  if (!ISO_DATE.test(String(value ?? ''))) throw new Error(`invalid ISO date "${value}"`);
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ISO date "${value}"`);
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function weekStartForDate(value) {
  const date = dateAtNoon(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return isoDate(date);
}

export function weekEndForStart(value) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + 6);
  return isoDate(date);
}

export function weekNumberOfMonth(value) {
  const date = dateAtNoon(value);
  return Math.floor((date.getUTCDate() - 1) / 7) + 1;
}

export function previousWeekStart(value) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() - 7);
  return weekStartForDate(isoDate(date));
}

const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const array = (value) => (Array.isArray(value) ? value : []);

function timeMinutes(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59 || hour > (meridiem ? 12 : 23)) return null;
  if (meridiem) {
    if (hour === 12) hour = 0;
    if (meridiem === 'pm') hour += 12;
  }
  return hour * 60 + minute;
}

function blockDuration(block) {
  const start = timeMinutes(block.start);
  const end = timeMinutes(block.hardStop);
  if (start === null || end === null) return 0;
  return end >= start ? end - start : (24 * 60 - start) + end;
}

function cleanOutcome(item) {
  return {
    outcome: clean(item?.outcome, 500),
    deliverable: clean(item?.deliverable, 700),
    completionDay: clean(item?.completionDay ?? item?.day, 40),
  };
}

function cleanCommitment(item) {
  return {
    text: clean(item?.text ?? item?.commitment, 500),
    day: clean(item?.day, 40),
    start: clean(item?.start ?? item?.startTime, 30),
    hardStop: clean(item?.hardStop ?? item?.end ?? item?.endTime, 30),
  };
}

function cleanBlock(item) {
  return {
    day: clean(item?.day, 40),
    type: clean(item?.type, 80),
    action: clean(item?.action ?? item?.task, 500),
    result: clean(item?.result ?? item?.outcome, 500),
    start: clean(item?.start ?? item?.startTime, 30),
    hardStop: clean(item?.hardStop ?? item?.end ?? item?.endTime, 30),
  };
}

export function normaliseWeeklyPlan({ weekStart, input = {}, image = null } = {}) {
  const start = weekStartForDate(weekStart);
  const answers = input.answers ?? {};
  const plannedChange = clean(input.plannedChange ?? answers.plannedChange);
  return {
    weekStart: start,
    weekEnd: weekEndForStart(start),
    weekNumber: weekNumberOfMonth(start),
    answers: {
      reviewLastWeek: clean(answers.reviewLastWeek),
      blockers: clean(answers.blockers),
      plannedChange,
      successOutcomes: clean(answers.successOutcomes),
      deliverables: clean(answers.deliverables),
      fixedCommitments: clean(answers.fixedCommitments),
      fitAssessment: clean(answers.fitAssessment),
    },
    outcomes: array(input.outcomes).map(cleanOutcome).filter((item) => item.outcome || item.deliverable).slice(0, 3),
    commitments: array(input.commitments).map(cleanCommitment).filter((item) => item.text).slice(0, 30),
    dailyBlocks: array(input.dailyBlocks).map(cleanBlock).filter((item) => item.action || item.result).slice(0, 100),
    extractedObstacles: array(input.extractedObstacles).map((item) => clean(item, 300)).filter(Boolean).slice(0, 30),
    plannedChange,
    unclearSections: array(input.unclearSections).map((item) => clean(item, 160)).filter(Boolean).slice(0, 20),
    confidence: ['low', 'medium', 'high'].includes(input.confidence) ? input.confidence : 'low',
    ...(image ? { image } : {}),
  };
}

export function validateWeeklyPlan(plan) {
  const required = ['reviewLastWeek', 'blockers', 'plannedChange', 'successOutcomes', 'deliverables', 'fixedCommitments', 'fitAssessment'];
  const missingAnswers = required.filter((key) => !clean(plan?.answers?.[key]));
  const hasPlanContent = (plan?.outcomes ?? []).length > 0 || clean(plan?.answers?.successOutcomes) !== '';
  return {
    ok: missingAnswers.length === 0 && hasPlanContent,
    missingAnswers,
    message: missingAnswers.length
      ? `Please confirm an answer for question ${required.indexOf(missingAnswers[0]) + 1}.`
      : !hasPlanContent ? 'Please confirm at least one weekly outcome.' : null,
  };
}

export function buildWeeklyAnalytics({ weeklyPlan, dailyLogs = [] } = {}) {
  const planItems = (weeklyPlan?.dailyBlocks ?? []).filter((block) => block.action || block.result);
  const dates = new Set(dailyLogs.map((entry) => entry.date));
  const plannedDates = new Set(planItems.map((block) => block.day).filter(Boolean));
  const plannedMinutes = planItems.reduce((sum, block) => sum + blockDuration(block), 0);
  const actualMinutes = dailyLogs.reduce((sum, entry) => {
    const value = Number(entry.totalHoursComputed ?? entry.totalHoursReported);
    return sum + (Number.isFinite(value) ? value * 60 : 0);
  }, 0);
  const completedOutcomes = dailyLogs.flatMap((entry) => entry.plan?.items ?? [])
    .filter((item) => item.status === 'DONE' || Number(item.actualMinutes ?? 0) >= Number(item.estimatedMinutes ?? 0)).length;
  const obstacles = dailyLogs.flatMap((entry) => entry.blockers?.segments ?? [])
    .map((item) => clean(item, 300)).filter(Boolean);
  return {
    plannedBlocks: planItems.length,
    plannedDates: plannedDates.size,
    actualLoggedDays: dates.size,
    plannedMinutes,
    actualMinutes: Math.round(actualMinutes),
    completedOutcomes,
    repeatedObstacles: [...new Set(obstacles.map((item) => item.toLowerCase()))]
      .map((key) => obstacles.find((item) => item.toLowerCase() === key))
      .slice(0, 20),
    adherence: planItems.length ? Math.round((Math.min(planItems.length, completedOutcomes) / planItems.length) * 100) : null,
  };
}

export { ISO_DATE };
