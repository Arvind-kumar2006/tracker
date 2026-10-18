/**
 * Mongo document -> the compact tracker tabs.
 *
 * The mappers are pure. They keep plan blocks as rows and repeat the day-level reflection on
 * those rows, which makes filtering and analysis straightforward.
 */

import { TABS } from './sheetSchema.js';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? '');
const bool = (value) => (value === true ? 'YES' : value === false ? 'NO' : '');
const text = (value) => String(value ?? '').trim();

const planItems = (doc) => Array.isArray(doc?.plan?.items) ? doc.plan.items.slice(0, 3) : [];

const blockCells = (item) => item ? [
  item.id ?? '',
  item.task ?? item.text ?? '',
  item.doneWhen ?? item.outcome ?? '',
  item.type ?? item.workType ?? '',
  item.start ?? item.startTime ?? '',
  item.end ?? item.endTime ?? '',
  Number(item.minutes ?? item.estimatedMinutes) || 0,
  bool(Boolean(item.isMust)),
  item.status ?? 'PLANNED',
] : Array(9).fill('');

const blockerTexts = (doc) => {
  const segments = doc?.blockers?.segments;
  if (Array.isArray(segments) && segments.length) return segments.map(text).filter(Boolean);
  const raw = text(doc?.blockers?.raw ?? doc?.blockers);
  return raw ? [raw] : [];
};

const plannedMinutes = (doc) => planItems(doc).reduce(
  (sum, item) => sum + (Number(item.minutes ?? item.estimatedMinutes) || 0),
  0
);

const actualStudyHours = (doc) => {
  const value = doc?.totalHoursComputed ?? doc?.totalHoursReported;
  return value === null || value === undefined || value === '' ? '' : Number(value);
};

/** One row per plan block, with the day-level reflection repeated on that row. */
export function dailyTrackerRows(doc, syncedAt = undefined) {
  const items = planItems(doc).length ? planItems(doc) : [null];
  const stamp = doc.updatedAt ?? doc.createdAt ?? syncedAt ?? '';
  const rawBlockers = doc.blockers?.raw ?? (typeof doc.blockers === 'string' ? doc.blockers : blockerTexts(doc).join(' | '));
  return items.map((item) => [
    item?.id ?? `${doc.date}:reflection`,
    doc.date ?? '',
    doc.weekday ?? '',
    ...blockCells(item),
    doc.accomplished ?? '',
    doc.buildNote ?? '',
    rawBlockers,
    doc.tomorrowChange ?? '',
    iso(stamp),
  ]);
}

export const dailyTrackerRow = (doc, syncedAt = undefined) => dailyTrackerRows(doc, syncedAt)[0];
export const dailyLogRow = dailyTrackerRow;

/** Unique obstacle rows. The second column is intentionally blank for manual writing. */
export function obstacleRows(docs = []) {
  const unique = new Map();
  for (const doc of docs) {
    for (const obstacle of blockerTexts(doc)) {
      const original = obstacle.replace(/\s+/g, ' ').trim();
      const key = original.toLocaleLowerCase();
      if (original && !unique.has(key)) unique.set(key, [original, '']);
    }
  }
  return [...unique.values()];
}

/** One row per day, with actual hours as the histogram source column. */
export function studyHoursRow(doc, syncedAt = undefined) {
  const actualHours = actualStudyHours(doc);
  const planned = plannedMinutes(doc);
  return [
    doc.date ?? '',
    doc.weekday ?? '',
    actualHours,
    planned ? planned / 60 : '',
    planned || '',
    doc.targetMet ?? '',
    doc.sourceFile ? 'imported' : 'app',
    iso(doc.updatedAt ?? doc.createdAt ?? syncedAt ?? ''),
  ];
}

const json = (value) => (Array.isArray(value) && value.length ? JSON.stringify(value) : '');

export function weeklyPlanRow(doc, syncedAt = undefined) {
  const answers = doc?.answers ?? {};
  return [
    doc?.weekStart ?? doc?._id ?? '',
    doc?.weekNumber ?? '',
    doc?.weekStart ?? '',
    doc?.weekEnd ?? '',
    doc?.status ?? '',
    doc?.image?.fileName ?? doc?.image?.sha256 ?? '',
    answers.reviewLastWeek ?? '',
    answers.blockers ?? '',
    answers.plannedChange ?? doc?.plannedChange ?? '',
    answers.successOutcomes ?? '',
    answers.deliverables ?? '',
    answers.fixedCommitments ?? '',
    answers.fitAssessment ?? '',
    json(doc?.outcomes),
    json(doc?.commitments),
    json(doc?.dailyBlocks),
    json(doc?.extractedObstacles),
    iso(doc?.confirmedAt),
    iso(doc?.updatedAt ?? doc?.createdAt ?? syncedAt ?? ''),
  ];
}

export const MAPPERS = {
  [TABS.DAILY_TRACKER]: dailyTrackerRows,
  [TABS.OBSTACLES]: obstacleRows,
  [TABS.STUDY_HOURS]: (doc, now) => [studyHoursRow(doc, now)],
  [TABS.WEEKLY_PLANS]: (doc, now) => [weeklyPlanRow(doc, now)],
};

/** Flatten documents into rows for one tab. Obstacles are deduplicated across all days. */
export function mapTab(tab, docs, now = undefined) {
  const mapper = MAPPERS[tab];
  if (!mapper) throw new Error(`no mapper registered for tab "${tab}"`);
  if (tab === TABS.OBSTACLES) return mapper(docs, now);
  return docs.flatMap((doc) => mapper(doc, now));
}

/** The first cell is the idempotent upsert key for every tab. */
export const keyOfRow = (row) => (row?.[0] === null || row?.[0] === undefined ? '' : String(row[0]));
