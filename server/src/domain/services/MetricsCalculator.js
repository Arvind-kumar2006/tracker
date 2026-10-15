/**
 * MetricsCalculator — deterministic statistics over normalised DayEntry records.
 *
 * Deliberately contains NO LLM calls. The AI reads these numbers; it never computes them.
 * That separation is what makes the analysis reproducible and unit-testable (NFR-7).
 *
 * Every metric that could be misread by a language model is computed here and handed over as a
 * fact.
 */

import { TargetMet, BuildOutcome } from '../entities/valueObjects.js';
import { StudyCategory, CATEGORY_FIELD } from '../entities/studyCategory.js';

const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
const pct = (part, whole) => (whole === 0 ? null : round2((part / whole) * 100));

/** Minutes-from-midnight at which a session is considered to have started "late". */
export const LATE_START_THRESHOLD_MIN = 21 * 60; // 9:00 pm

/**
 * Detect the "passive learning" pattern (FR-3.7) visible in the reference workbook:
 * "I completed the two lecture of gen ai but only watch like a movie but i don't code myself no notes".
 *
 * Returns matched evidence rather than a bare boolean, so the UI and the AI prompt can show
 * the user the exact phrase that triggered it.
 */
export function detectPassiveLearning(entry) {
  const text = `${entry.accomplished ?? ''} ${entry.buildNote ?? ''}`.trim();
  if (text === '') return { passive: false, evidence: [] };

  const passiveCues = [
    /\bonly\s+watch(ed|ing)?\b/i,
    /\bwatch(ed|ing)?\s+like\s+a\s+(movie|film)\b/i,
    /\bno\s+notes?\b/i,
    /\bwithout\s+(code|coding|notes)\b/i,
    /\b(don't|didn't|do not|did not)\s+code\b/i,
    /\bi\s+did\s+not\s+code\b/i,
    /\bjust\s+watch(ed|ing)?\b/i,
  ];

  const evidence = [];
  for (const cue of passiveCues) {
    const m = text.match(cue);
    if (m) evidence.push(m[0]);
  }

  return { passive: evidence.length > 0, evidence };
}

/** Ordinary least squares slope of y over x=0..n-1. Negative means the trend is downward. */
export function linearSlope(values) {
  const n = values.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? null : round2(num / den);
}

/** Longest and current runs of consecutive days carrying data. */
function streaks(datesInOrder) {
  if (datesInOrder.length === 0) return { longest: 0, current: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < datesInOrder.length; i++) {
    const prev = new Date(`${datesInOrder[i - 1]}T00:00:00Z`).getTime();
    const cur = new Date(`${datesInOrder[i]}T00:00:00Z`).getTime();
    run = cur - prev === 86400000 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { longest, current: run };
}

/**
 * @param {object} args
 * @param {Array} args.entries - normalised DayEntry records (may include empty days)
 * @param {string} args.month - "2026-10"
 * @param {string} args.asOf - ISO date acting as "today" (injectable for testability)
 * @returns {object} metrics
 */
export function calculateMetrics({ entries, month, asOf }) {
  const inMonth = entries.filter((e) => e.month === month).sort((a, b) => a.date.localeCompare(b.date));
  const logged = inMonth.filter((e) => e.hasData);
  const withHours = logged.filter((e) => e.hasMinutes);

  const monthStart = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const asOfDate = asOf && asOf <= `${month}-${String(daysInMonth).padStart(2, '0')}` ? asOf : `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const daysElapsed = Math.min(daysInMonth, Math.max(1, Number(asOfDate.slice(-2))));
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  /* --- FR-3.4 hours --- */
  const hoursTotal = round2(withHours.reduce((s, e) => s + (e.totalHoursComputed ?? 0), 0));
  const hoursAvgPerLoggedDay = logged.length ? round2(withHours.reduce((s, e) => s + (e.totalHoursComputed ?? 0), 0) / logged.length) : null;

  /* --- FR-3.5 category split --- */
  const categoryMinutes = Object.fromEntries(Object.values(CATEGORY_FIELD).map((f) => [f, 0]));
  for (const e of withHours) {
    for (const f of Object.values(CATEGORY_FIELD)) categoryMinutes[f] += e.minutes[f] ?? 0;
  }
  const minutesSum = Object.values(categoryMinutes).reduce((a, b) => a + b, 0);
  const categorySplit = Object.fromEntries(
    Object.entries(categoryMinutes).map(([f, v]) => [f, pct(v, minutesSum)])
  );

  /* --- FR-3.7 passive learning --- */
  const passiveDays = logged.filter((e) => detectPassiveLearning(e).passive);
  const passiveLearningRatio = passiveDays.length ? pct(passiveDays.length, logged.length) : 0;

  /* --- FR-3.8 weekday vs weekend --- */
  const weekend = logged.filter((e) => e.weekday === 'Sat' || e.weekday === 'Sun');
  const weekday = logged.filter((e) => e.weekday !== 'Sat' && e.weekday !== 'Sun');
  const sumHours = (list) => round2(list.reduce((s, e) => s + (e.totalHoursComputed ?? 0), 0));

  /* --- FR-3.9 late starts --- */
  // "Late" describes when the day BEGAN, so this must use the day's EARLIEST block. Checking
  // whether ANY block falls after the threshold would mark a day that started at 7pm and ran
  // until 1am as "late", which is exactly backwards.
  const firstBlockOf = (e) =>
    e.timeBlocks.length ? e.timeBlocks.reduce((a, b) => (b.startMinutes < a.startMinutes ? b : a)) : null;

  const lateStartDays = logged.filter((e) => {
    const first = firstBlockOf(e);
    return first !== null && first.startMinutes >= LATE_START_THRESHOLD_MIN;
  });
  const earliestStart = logged.length
    ? Math.min(...logged.map((e) => firstBlockOf(e)?.startMinutes).filter((m) => m !== null && m !== undefined))
    : null;

  /* --- FR-3.10 trend --- */
  const slope = linearSlope(withHours.map((e) => e.totalHoursComputed ?? 0));

  /* --- plan vs actual --- */
  const plannedItems = logged.reduce((s, e) => s + e.plan.items.length, 0);
  const daysWithDeclaredHours = logged.filter((e) => e.plan.declaredHours !== null);
  const planVsActual =
    daysWithDeclaredHours.length > 0
      ? daysWithDeclaredHours.map((e) => ({
          date: e.date,
          declared: e.plan.declaredHours,
          actual: e.totalHoursComputed,
          shortfall: e.totalHoursComputed === null ? null : round2(e.plan.declaredHours - e.totalHoursComputed),
        }))
      : [];

  const targetCounts = logged.reduce((acc, e) => {
    acc[e.targetMet] = (acc[e.targetMet] ?? 0) + 1;
    return acc;
  }, {});
  const buildCounts = logged.reduce((acc, e) => {
    acc[e.buildOutcome] = (acc[e.buildOutcome] ?? 0) + 1;
    return acc;
  }, {});

  return {
    month,
    asOf: asOfDate,
    daysInMonth,
    daysElapsed,
    daysRemaining,

    daysLogged: logged.length,
    daysEmpty: inMonth.length - logged.length,
    consistencyRate: pct(logged.length, daysElapsed),
    ...streaks(inMonth.filter((e) => e.hasData).map((e) => e.date)),

    hoursTotal,
    hoursAvgPerLoggedDay,
    daysWithHours: withHours.length,
    categorySplit,
    categoryMinutes,

    targetCounts,
    daysTargetMet: targetCounts[TargetMet.MET] ?? 0,
    daysPartial: targetCounts[TargetMet.PARTIAL] ?? 0,
    daysMissed: targetCounts[TargetMet.MISSED] ?? 0,

    buildCounts,
    buildRate: pct(
      logged.filter((e) => e.buildOutcome === BuildOutcome.BUILT || e.buildOutcome === BuildOutcome.LEARNED).length,
      logged.length
    ),

    plannedItems,
    planRepeatCount: logged.filter((e) => e.plan.isRepeat).length,
    planVsActual,

    passiveLearningRatio,
    passiveDays: passiveDays.map((e) => ({
      date: e.date,
      evidence: detectPassiveLearning(e).evidence,
    })),

    weekday: { days: weekday.length, hours: sumHours(weekday) },
    weekend: { days: weekend.length, hours: sumHours(weekend) },

    lateStartDays: lateStartDays.map((e) => e.date),
    lateStartRate: pct(lateStartDays.length, logged.length),
    earliestStartMinutes: earliestStart,

    trend: {
      slopeHoursPerDay: slope,
      direction: slope === null ? 'UNKNOWN' : slope > 0.2 ? 'RISING' : slope < -0.2 ? 'FALLING' : 'FLAT',
    },

    machineWrittenBlockerDays: logged.filter((e) => e.blockers.machineWritten).map((e) => e.date),
  };
}