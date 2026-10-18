/**
 * RowMappers — Mongo document -> sheet row (a flat array of strings/numbers).
 *
 * Pure functions with no I/O, so the projection is unit-testable without Google credentials.
 * Every mapper MUST return an array whose length and order match `headers` in sheetSchema.js.
 * The `length` assertion in the test suite enforces that coupling.
 *
 * Note these are projections, not copies: what belongs in the user's own columns stays in the
 * user's own columns. AI output only ever lands in AI_Insights (FR-6.3).
 */

import { TABS } from './sheetSchema.js';

const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const bool = (v) => (v === true ? 'YES' : v === false ? 'NO' : '');
const joinList = (v) => (Array.isArray(v) ? v.join(' | ') : '');
const joinDate = (v) => (Array.isArray(v) ? v.join(', ') : '');

/**
 * A short stable id from a natural key. Sheets has no unique constraint, so the id column makes
 * a row traceable back to its source and is itself the upsert key.
 */
const shortId = (...parts) =>
  parts
    .filter(Boolean)
    .join(':')
    .slice(0, 120);

const planItemLabel = (item) => {
  const task = item.task ?? item.text ?? '';
  const schedule = (item.start ?? item.startTime) && (item.end ?? item.endTime)
    ? ` ${item.start ?? item.startTime}-${item.end ?? item.endTime}`
    : '';
  const type = item.type ?? item.workType ?? '';
  const must = item.isMust ? ' ★' : '';
  return `${item.n}. ${task}${type ? ` [${type}]` : ''}${schedule}${must}`;
};

const planBlockJson = (doc) => JSON.stringify((doc.plan?.items ?? []).map((item) => ({
  id: item.id,
  date: item.date ?? doc.date,
  task: item.task ?? item.text ?? '',
  doneWhen: item.doneWhen ?? item.outcome ?? '',
  type: item.type ?? item.workType ?? 'Other',
  start: item.start ?? item.startTime ?? '',
  end: item.end ?? item.endTime ?? '',
  minutes: Number(item.minutes ?? item.estimatedMinutes ?? 0),
  isMust: Boolean(item.isMust),
  status: item.status ?? 'PLANNED',
})));

/**
 * The upsert key for a document.
 *
 * Mirror input normally comes straight out of Mongo, where the natural key IS `_id`. But the
 * same mappers are exercised against raw normalised domain objects (which carry `date`,
 * `month` or `sha256` and no `_id`), so fall back rather than emitting a null key column — a
 * null key would be appended on every sync and silently break idempotency.
 */
const docKey = (doc, ...fallbacks) => {
  if (doc?._id !== null && doc?._id !== undefined && doc._id !== '') return doc._id;
  for (const f of fallbacks) {
    if (doc?.[f] !== null && doc?.[f] !== undefined && doc[f] !== '') return doc[f];
  }
  return '';
};

/* ------------------------------------------------------------------ */

export function monthRow(doc) {
  const m = doc.metrics ?? {};
  return [
    docKey(doc, 'month'),
    doc.monthlyGoal ?? '',
    doc.targetDailyHours ?? '',
    m.daysLogged ?? '',
    m.daysElapsed ?? '',
    m.daysEmpty ?? '',
    m.hoursTotal ?? '',
    m.hoursAvgPerLoggedDay ?? '',
    m.consistencyRate ?? '',
    m.longest ?? '',
    m.current ?? '',
    m.daysTargetMet ?? '',
    m.daysPartial ?? '',
    m.daysMissed ?? '',
    m.buildRate ?? '',
    m.passiveLearningRatio ?? '',
    m.lateStartRate ?? '',
    m.trend?.direction ?? '',
    // Surfaced so a unit misread is visible in the spreadsheet, not just in the API.
    m.trend?.slopeHoursPerDay ?? '',
    iso(doc.lastUpdated),
  ];
}

export function dailyLogRow(doc, syncedAt) {
  const p = doc.plan ?? {};
  const mins = doc.minutes ?? {};
  // synced_at must reflect when the SOURCE row last changed, not the moment of the sync.
  // Stamping `new Date()` here would rewrite every row on every run, so a no-op re-sync would
  // still mutate the sheet and the "sync is idempotent" guarantee would be unverifiable.
  const stamp = doc.updatedAt ?? doc.createdAt ?? syncedAt ?? '';
  return [
    docKey(doc, 'date'),
    doc.weekday ?? '',
    bool(doc.hasData),
    p.summary ?? '',
    (p.items ?? []).map(planItemLabel).join(' | '),
    p.isRepeat ? `REPEAT OF ${p.repeatOf}` : '',
    p.declaredHours ?? '',
    mins.genaiMinutes ?? '',
    mins.codingMinutes ?? '',
    mins.englishMinutes ?? '',
    mins.otherMinutes ?? '',
    doc.totalHoursComputed === null || doc.totalHoursComputed === undefined ? '' : doc.totalHoursComputed,
    doc.totalHoursReported ?? '',
    doc.variancePct ?? '',
    doc.targetMet ?? '',
    doc.accomplished ?? '',
    doc.buildOutcome ?? '',
    doc.buildNote ?? '',
    doc.blockers?.raw ?? '',
    bool(doc.blockers?.machineWritten),
    doc.tomorrowChange ?? '',
    (doc.timeBlocks ?? [])
      .map((b) => `${b.start}-${b.end}${b.done ? ' [done]' : ''}${b.missed ? ' [missed]' : ''} ${b.label}`)
      .join(' | '),
    doc.sourceFile ?? '',
    shortId(doc.date, doc.plan?.items?.length ?? 0, doc.totalHoursComputed ?? 'x'),
    iso(stamp),
    bool(doc.floorHit),
    doc.floorHitReason ?? '',
    doc.planBend ?? '',
    JSON.stringify(doc.focusSessions ?? []),
    p.minimumMinutes ?? '',
    p.idealMinutes ?? '',
    p.breakMinutes ?? '',
    p.bufferMinutes ?? '',
    (p.items ?? []).map((item) => {
      const task = item.task ?? item.text ?? '';
      const outcome = (item.doneWhen ?? item.outcome) ? ` → ${item.doneWhen ?? item.outcome}` : '';
      const actual = item.actualMinutes ? ` actual ${item.actualMinutes}m` : '';
      const state = item.status ? ` [${item.status}]` : '';
      const schedule = (item.start ?? item.startTime) && (item.end ?? item.endTime)
        ? ` ${item.start ?? item.startTime}-${item.end ?? item.endTime}`
        : '';
      const type = item.type ?? item.workType ?? '';
      const must = item.isMust ? ' ★' : '';
      return `${item.n}. ${task}${type ? ` [${type}]` : ''}${schedule}${must} [${item.priority ?? 'MEDIUM'}] ${item.minutes ?? item.estimatedMinutes ?? '?'}m${actual}${state}${outcome}`;
    }).join(' | '),
    planBlockJson(doc),
  ];
}

export function timeBlockRows(doc) {
  return (doc.timeBlocks ?? []).map((b) => [
    shortId(doc.date, b.seq),
    doc.date,
    b.seq,
    b.start,
    b.end,
    b.durationMin,
    bool(b.crossesMidnight),
    b.label,
    b.done ? 'YES' : '',
    b.missed ? 'YES' : '',
    b.meridiemAssumed ? 'ASSUMED' : '',
    b.confidence ?? '',
  ]);
}

export function blockerRows(doc) {
  const segments = doc.blockers?.segments ?? [];
  if (segments.length === 0) return [];
  return segments.map((text, i) => [
    shortId(doc.date, i),
    doc.date,
    doc.weekday ?? '',
    doc.blockers?.raw ?? '',
    text,
    '', // category — filled by the AI layer later
    '', // severity
    '', // days_repeated
    bool(doc.blockers?.machineWritten),
    'OPEN',
  ]);
}

export function insightRow(doc) {
  return [
    docKey(doc, 'contentHash'),
    iso(doc.generatedAt),
    doc.month ?? '',
    doc.section ?? '',
    doc.title ?? '',
    doc.body ?? '',
    doc.severity ?? '',
    joinDate(doc.evidenceDates),
    joinList(doc.evidenceQuotes),
    doc.action ?? '',
    doc.constraintRef ?? '',
    doc.model ?? '',
    doc.tokens ?? '',
    doc.costCredits ?? '',
    doc.contentHash ?? '',
    doc.status ?? 'OPEN',
    doc.userResponse ?? '',
  ];
}

export function planCritiqueRow(doc) {
  const a = doc.axes ?? {};
  return [
    docKey(doc, 'date'),
    doc.overall ?? '',
    a.specific?.score ?? '',
    a.timeboxed?.score ?? '',
    a.measurable?.score ?? '',
    a.realistic?.score ?? '',
    joinList(doc.issues),
    (doc.rewrittenBlocks ?? [])
      .map((b) => `${b.start} (${b.durationMin}m) ${b.label}`)
      .join(' | '),
    doc.summary ?? '',
    doc.userAccepted ? 'YES' : '',
    iso(doc.updatedAt),
  ];
}

export function importLogRow(doc) {
  return [
    docKey(doc, 'sha256'),
    iso(doc.importedAt),
    doc.fileName ?? '',
    doc.sheetName ?? '',
    doc.headerRow ?? '',
    doc.rowsPopulated ?? '',
    doc.rowsParsed ?? '',
    doc.rowsQuarantined ?? '',
    doc.daysWithData ?? '',
    joinList(doc.months),
    Object.entries(doc.unitDecisions ?? {})
      .map(([k, v]) => `${k}=${v.unit}@${v.confidence}`)
      .join(' | '),
    doc.agreement?.agrees === undefined ? '' : doc.agreement.agrees ? 'YES' : 'NO',
    doc.status ?? '',
    doc.error ?? '',
  ];
}

/** tab name -> mapper. Records-to-rows is 1:N for the child tabs. */
export const MAPPERS = {
  [TABS.MONTHS]: (doc) => [monthRow(doc)],
  [TABS.DAILY_LOG]: (doc, now) => [dailyLogRow(doc, now)],
  [TABS.TIME_BLOCKS]: timeBlockRows,
  [TABS.BLOCKERS]: blockerRows,
  [TABS.AI_INSIGHTS]: (doc) => [insightRow(doc)],
  [TABS.PLAN_CRITIQUES]: (doc) => [planCritiqueRow(doc)],
  [TABS.IMPORT_LOG]: (doc) => [importLogRow(doc)],
};

/** Flatten a set of documents into rows for one tab. */
export function mapTab(tab, docs, now = undefined) {
  const mapper = MAPPERS[tab];
  if (!mapper) throw new Error(`no mapper registered for tab "${tab}"`);
  return docs.flatMap((d) => mapper(d, now));
}

/** The upsert key for a row: column 0 of every tab, by construction. */
export const keyOfRow = (row) => (row?.[0] === null || row?.[0] === undefined ? '' : String(row[0]));

export { TABS };
