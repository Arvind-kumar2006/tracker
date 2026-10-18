/**
 * The deliberately small Google Sheets projection for the mobile tracker.
 *
 * Mongo remains the source of truth. These three tabs are a human-readable mirror:
 * - Daily_Tracker: one row per plan block, with the day's reflection repeated on that row;
 * - Obstacles: unique obstacles discovered in reflections plus a manual solution column;
 * - Study_Hours: one row per day, shaped for a study-hours histogram;
 * - Weekly_Plans: one confirmed or failed weekly planning exercise per row.
 */

export const TABS = {
  DAILY_TRACKER: 'Daily_Tracker',
  OBSTACLES: 'Obstacles',
  STUDY_HOURS: 'Study_Hours',
  WEEKLY_PLANS: 'Weekly_Plans',
};

export const TAB_SCHEMA = {
  [TABS.DAILY_TRACKER]: {
    key: 'record_id',
    headers: [
      'record_id',
      'date',
      'weekday',
      'block_id',
      'task',
      'done_when',
      'type',
      'start',
      'end',
      'minutes',
      'must_do',
      'status',
      'accomplishment',
      'built_finished_or_produced',
      'obstacles',
      'tomorrow_change',
      'synced_at',
    ],
    widths: [180, 100, 80, 180, 280, 320, 120, 100, 100, 110, 100, 150, 420, 420, 420, 420, 160],
  },

  [TABS.OBSTACLES]: {
    key: 'obstacle',
    headers: ['obstacle', 'solution'],
    widths: [440, 560],
    // The user owns this column. Sync may add a new obstacle but must never erase a solution.
    preserveColumns: [1],
  },

  [TABS.STUDY_HOURS]: {
    key: 'date',
    headers: ['date', 'weekday', 'study_hours', 'planned_hours', 'planned_minutes', 'target_met', 'source', 'synced_at'],
    widths: [100, 80, 110, 120, 130, 110, 110, 160],
  },

  [TABS.WEEKLY_PLANS]: {
    key: 'week_id',
    headers: [
      'week_id', 'week_number', 'week_start', 'week_end', 'status', 'uploaded_image',
      'answer_1_review', 'answer_2_blockers', 'answer_3_change', 'answer_4_outcomes',
      'answer_5_deliverables', 'answer_6_commitments', 'answer_7_fit', 'weekly_outcomes',
      'fixed_commitments', 'daily_time_blocks', 'extracted_obstacles', 'confirmed_at', 'synced_at',
    ],
    widths: [160, 110, 110, 110, 150, 220, 360, 360, 360, 360, 360, 360, 360, 500, 500, 600, 360, 180, 180],
  },
};

/** Sheet names cannot contain some characters and are capped at 100 chars. */
export const sanitiseTabName = (name) => name.slice(0, 100).replace(/[\\/?*[\]:]/g, '_');

/** A1 range helper: col 0 -> 'A'. */
export function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const a1Range = (tab, startRow, endRow, colCount) => {
  const last = colLetter(colCount - 1);
  return `'${tab}'!A${startRow}:${last}${endRow}`;
};
