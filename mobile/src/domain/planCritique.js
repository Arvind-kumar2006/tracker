/**
 * Plan-critique view-model.
 *
 * Phase 5. The 4-axis critique is already generated and persisted by the analysis graph; this
 * module turns it into something a person can act on, and it is pure so it can be tested in
 * plain node.
 *
 * The aggregate is the part that matters. A per-day score of "3/10 realistic" is a number;
 * "realistic averages 3.1/10 across 2 days with data, and you declared 4h against 2.1h logged"
 * is a finding.
 */

export const AXES = {
  specific: {
    label: 'Specific',
    question: 'Is each item a concrete task rather than a vague intention?',
    lowMeans: 'Too vague to start without deciding what "done" looks like.',
    highMeans: 'Named, specific work.',
  },
  timeboxed: {
    label: 'Time-boxed',
    question: 'Does the plan carry durations or clock times?',
    lowMeans: 'No time attached, so nothing can be measured.',
    highMeans: 'Explicit time blocks.',
  },
  measurable: {
    label: 'Measurable',
    question: 'Could you say yes or no whether it happened?',
    lowMeans: 'No observable done-condition.',
    highMeans: 'Finished/verified state is clear.',
  },
  realistic: {
    label: 'Realistic',
    question: 'Does the declared time match what you actually log?',
    lowMeans: 'Under- or over-scoped against your real output.',
    highMeans: 'Declared hours track actual hours.',
  },
};

export const AXIS_ORDER = ['specific', 'timeboxed', 'measurable', 'realistic'];

export const band = (score) => (score >= 7 ? 'strong' : score >= 4 ? 'fair' : 'weak');

export const BAND_LABEL = { strong: 'Strong', fair: 'Fair', weak: 'Weak' };

export const BAND_COLOR = { strong: '#00B894', fair: '#FDCB6E', weak: '#FF7675' };

/** A one-line verdict for a single day's critique. */
export function critiqueSummary(critique) {
  const overall = Number(critique?.overall ?? 0);
  const axes = critique?.axes ?? {};
  const scores = AXIS_ORDER.map((k) => ({ key: k, score: Number(axes[k]?.score ?? 0) }));
  const weakest = scores.reduce((a, b) => (b.score < a.score ? b : a));

  const verdict = overall >= 7 ? 'A plan you can keep' : overall >= 4 ? 'Workable with gaps' : 'This plan will not survive the week';
  return `${verdict} — weakest on ${AXES[weakest.key].label.toLowerCase()} (${weakest.score}/10)`;
}

/**
 * Expand a rewritten block into readable start/end times.
 * The graph emits `{label, start: "7:00 pm", durationMin}`; a person wants to see the end.
 */
export function expandBlocks(blocks) {
  // `?? []` rather than a default parameter: a default only covers `undefined`, and the API can
  // legitimately return `rewrittenBlocks: null` when the model produced none.
  return (blocks ?? []).map((b) => {
    const startMinutes = parseClock(b.start);
    const endMinutes = startMinutes === null ? null : startMinutes + (Number(b.durationMin) || 0);
    return {
      ...b,
      start: b.start,
      end: endMinutes === null ? null : formatClock(endMinutes),
      crossesMidnight: endMinutes !== null && endMinutes >= 1440,
    };
  });
}

export function formatClock(minutesFromMidnight) {
  const wrapped = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const meridiem = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${meridiem}`;
}

function parseClock(text) {
  if (!text) return null;
  const m = String(text).match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(hour)) return null;
  const mer = m[3]?.toLowerCase();
  if (mer === 'pm' && hour < 12) hour += 12;
  else if (mer === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/**
 * Aggregate across days — the genuinely useful part.
 *
 * `realisticAvg` alongside `declaredVsActual` is what turns "you plan 4h" into "you plan 4h
 * and deliver 2.1h, every time", which is the single most actionable pattern in the reference
 * data.
 */
export function critiqueStats(critiques = []) {
  const rows = (critiques ?? []).filter((c) => c && c.date);
  if (rows.length === 0) {
    return { days: 0, overallAvg: null, byAxis: {}, weakestAxis: null, biggestGap: null };
  }

  const byAxis = {};
  for (const key of AXIS_ORDER) {
    const scores = rows.map((c) => Number(c?.axes?.[key]?.score)).filter((n) => Number.isFinite(n));
    byAxis[key] = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;
  }

  const weakestAxis = AXIS_ORDER.filter((k) => byAxis[k] !== null).sort((a, b) => byAxis[a] - byAxis[b])[0] ?? null;

  const overalls = rows.map((c) => Number(c.overall)).filter(Number.isFinite);
  const overallAvg = overalls.length ? Number((overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(2)) : null;

  // Largest under-scoping gap named in the issues text, if the graph reported one.
  let biggestGap = null;
  for (const c of rows) {
    const issue = (c.issues ?? []).find((i) => /declared|logged|short/i.test(String(i)));
    if (!issue) continue;
    if (!biggestGap || issue.length > biggestGap.text.length) biggestGap = { date: c.date, text: issue };
  }

  return { days: rows.length, overallAvg, byAxis, weakestAxis, biggestGap };
}

/** Newest first — the critique you still care about is the one from yesterday. */
export const sortCritiques = (rows = []) => [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));

/** Overall score as a 0-10 band, used for the headline colour. */
export const overallBand = (overall) => band(Number(overall ?? 0));