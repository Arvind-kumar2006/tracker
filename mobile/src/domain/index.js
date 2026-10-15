/**
 * Domain layer — pure, zero imports. Mirrors the server's domain so both sides agree on the
 * meaning of "target met", "has data", and a study block.
 *
 * This is the part of the app that must not rot, so it is written to be testable with plain
 * `node --test` (see mobile/test/domain.test.js) — no emulator, no bundler, no React.
 */

export const StudyCategory = {
  GENAI: 'GENAI',
  CODING: 'CODING',
  ENGLISH: 'ENGLISH',
  OTHER: 'OTHER',
};

export const StudyCategoryLabel = {
  GENAI: 'GenAI',
  CODING: 'Coding',
  ENGLISH: 'English',
  OTHER: 'Other',
};

export const StudyCategoryColor = {
  GENAI: '#6C5CE7',
  CODING: '#00B894',
  ENGLISH: '#FDCB6E',
  OTHER: '#74B9FF',
};

export const TargetMet = {
  MET: 'MET',
  PARTIAL: 'PARTIAL',
  MISSED: 'MISSED',
  SKIPPED: 'SKIPPED',
  UNKNOWN: 'UNKNOWN',
};

export const BuildOutcome = { NONE: 'NONE', LEARNED: 'LEARNED', BUILT: 'BUILT', UNKNOWN: 'UNKNOWN' };

export const ALL_CATEGORIES = [StudyCategory.GENAI, StudyCategory.CODING, StudyCategory.ENGLISH, StudyCategory.OTHER];

/**
 * How a day's target status should read on screen.
 *
 * The single most important rule from the PRD: SKIPPED must never look like MISSED. A blank
 * day means "nothing recorded", not "studied nothing" — showing red for it is the fastest way
 * to make an honest blank feel like failure and train the user to stop opening the app.
 */
export function describeTargetMet(targetMet, hasData) {
  if (!hasData) {
    return { label: 'Not logged', tone: 'neutral', icon: '—', detail: 'Nothing recorded for this day.' };
  }
  switch (targetMet) {
    case TargetMet.MET:
      return { label: 'Target met', tone: 'positive', icon: '✓', detail: 'You hit the goal you set.' };
    case TargetMet.PARTIAL:
      return { label: 'Partial', tone: 'warning', icon: '~', detail: 'You hit a reduced bar, not the full target.' };
    case TargetMet.MISSED:
      return { label: 'Missed', tone: 'negative', icon: '✕', detail: 'The target was set and not reached.' };
    case TargetMet.UNKNOWN:
      return { label: 'Unmarked', tone: 'neutral', icon: '?', detail: 'There is data, but no target status recorded.' };
    default:
      return { label: 'Not logged', tone: 'neutral', icon: '—', detail: 'Nothing recorded for this day.' };
  }
}

export const describeBuildOutcome = (o) =>
  ({
    NONE: { label: 'Built nothing', tone: 'negative' },
    LEARNED: { label: 'Learned how', tone: 'warning' },
    BUILT: { label: 'Built something', tone: 'positive' },
    UNKNOWN: { label: 'Not marked', tone: 'neutral' },
  })[o] ?? { label: 'Not marked', tone: 'neutral' };

/* ------------------------------------------------------------------ */

export const formatHours = (hours) => {
  if (hours === null || hours === undefined) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

export const formatMinutes = (mins) => formatHours((mins ?? 0) / 60);

export const formatPercent = (pct) => (pct === null || pct === undefined ? '—' : `${Math.round(pct)}%`);

/** "2026-10-05" -> "Mon 5 Oct". */
export function formatDate(iso, { weekday = true } = {}) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDate();
  const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const wd = date.toLocaleString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return weekday ? `${wd} ${day} ${month}` : `${day} ${month}`;
}

export const monthKeyOf = (iso) => (iso ? iso.slice(0, 7) : null);

/** The month a date belongs to, including the year rollover. */
export function monthForDate(dateIso) {
  const [y, m] = dateIso.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}`;
}

export const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Every ISO date in a month. */
export const datesInMonth = (month) =>
  Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);

/** Build a calendar grid (weeks of 7) covering the month, for the dashboard heatmap. */
export function monthGrid(month) {
  const dates = datesInMonth(month);
  const [y, m] = month.split('-').map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  return [...Array(firstDow).fill(null), ...dates];
}

/**
 * Derived dashboard view-model. All arithmetic already happened on the server; this only
 * shapes it for display, so the client never disagrees with the API.
 */
export function buildDashboardView({ month, metrics, entries = [], asOf }) {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const days = datesInMonth(month).map((date) => {
    const entry = byDate.get(date);
    const hasData = Boolean(entry?.hasData);
    return {
      date,
      weekday: entry?.weekday ?? null,
      hasData,
      isFuture: asOf ? date > asOf : false,
      totalHours: entry?.totalHoursComputed ?? null,
      targetMet: entry?.targetMet ?? null,
      buildOutcome: entry?.buildOutcome ?? null,
      status: describeTargetMet(entry?.targetMet ?? null, hasData),
      planRepeat: Boolean(entry?.plan?.isRepeat),
    };
  });

  return {
    month,
    days,
    futureDays: days.filter((d) => d.isFuture).length,
    loggedDays: days.filter((d) => d.hasData).length,
    hoursTotal: metrics?.hoursTotal ?? null,
    hoursAvg: metrics?.hoursAvgPerLoggedDay ?? null,
    consistencyRate: metrics?.consistencyRate ?? null,
    currentStreak: metrics?.current ?? 0,
    longestStreak: metrics?.longest ?? 0,
    daysTargetMet: metrics?.daysTargetMet ?? 0,
    daysPartial: metrics?.daysPartial ?? 0,
    daysMissed: metrics?.daysMissed ?? 0,
    passiveLearningRatio: metrics?.passiveLearningRatio ?? null,
    lateStartRate: metrics?.lateStartRate ?? null,
    categorySplit: metrics?.categorySplit ?? null,
    trend: metrics?.trend ?? null,
  };
}

/** Severity ordering, highest first — drives how insights are ranked on screen. */
export const SEVERITY_ORDER = ['HIGH', 'MEDIUM', 'LOW', 'INFO'];

export const sortBySeverity = (items) =>
  [...items].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity ?? 'INFO') - SEVERITY_ORDER.indexOf(b.severity ?? 'INFO'));

export const TONE_COLORS = {
  positive: '#00B894',
  warning: '#FDCB6E',
  negative: '#FF7675',
  neutral: '#B2BEC3',
};