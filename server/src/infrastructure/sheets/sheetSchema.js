/**
 * Sheet schema — the tab definitions for the accountability mirror.
 *
 * Sheets is a PROJECTION of committed Mongo documents, not a second source of truth. Every tab
 * has a natural key so re-syncing updates in place instead of appending duplicates (FR-6.4).
 */

export const TABS = {
  MONTHS: 'Months',
  DAILY_LOG: 'Daily_Log',
  TIME_BLOCKS: 'Time_Blocks',
  BLOCKERS: 'Blockers',
  AI_INSIGHTS: 'AI_Insights',
  PLAN_CRITIQUES: 'Plan_Critiques',
  IMPORT_LOG: 'Import_Log',
};

/**
 * `key` is the column used for idempotent upsert. `headers` order MUST match `rowMappers`.
 */
export const TAB_SCHEMA = {
  [TABS.MONTHS]: {
    key: 'month',
    headers: [
      'month', 'monthly_goal', 'target_daily_hours', 'days_logged', 'days_elapsed', 'days_empty',
      'hours_total', 'hours_avg', 'consistency_rate', 'longest_streak', 'current_streak',
      'days_target_met', 'days_partial', 'days_missed', 'build_rate', 'passive_learning_rate',
      'late_start_rate', 'trend', 'unit_warning', 'last_updated',
    ],
    widths: [90, 280, 120, 100, 100, 90, 100, 100, 110, 110, 110, 110, 100, 100, 100, 130, 110, 90, 200, 150],
  },

  [TABS.DAILY_LOG]: {
    key: 'date',
    headers: [
      'date', 'weekday', 'has_data', 'plan_summary', 'plan_items', 'plan_repeat', 'declared_hours',
      'genai_min', 'coding_min', 'english_min', 'other_min', 'total_computed_h', 'total_reported_h',
      'variance_pct', 'target_met', 'accomplished', 'build_outcome', 'build_note', 'blockers',
      'machine_written_blockers', 'tomorrow_change', 'time_blocks', 'source_file', 'content_hash',
      'synced_at', 'floor_hit', 'floor_hit_reason', 'plan_bend', 'focus_sessions',
      'plan_minimum_min', 'plan_ideal_min', 'plan_break_min', 'plan_buffer_min', 'plan_tasks', 'plan_blocks',
    ],
    widths: [100, 80, 90, 300, 420, 100, 110, 90, 90, 90, 90, 110, 120, 100, 100, 420, 110, 300, 420, 130, 300, 360, 190, 120, 150, 90, 420, 420, 420, 100, 100, 100, 100, 520, 620],
  },

  [TABS.TIME_BLOCKS]: {
    key: 'blockId',
    headers: [
      'block_id', 'date', 'seq', 'start', 'end', 'duration_min', 'crosses_midnight', 'label',
      'done', 'missed', 'meridiem_assumed', 'confidence',
    ],
    widths: [150, 100, 50, 90, 90, 100, 120, 260, 60, 70, 120, 90],
  },

  [TABS.BLOCKERS]: {
    key: 'blockerId',
    headers: [
      'blocker_id', 'date', 'weekday', 'raw_text', 'statement', 'category', 'severity',
      'days_repeated', 'machine_written', 'status',
    ],
    widths: [150, 100, 80, 420, 420, 110, 90, 110, 120, 100],
  },

  [TABS.AI_INSIGHTS]: {
    key: 'insightId',
    headers: [
      'insight_id', 'generated_at', 'month', 'section', 'title', 'body', 'severity',
      'evidence_dates', 'evidence_quotes', 'action', 'constraint_ref', 'model', 'tokens',
      'cost_credits', 'content_hash', 'status', 'user_response',
    ],
    widths: [200, 150, 80, 110, 260, 520, 90, 200, 420, 300, 240, 190, 80, 100, 110, 100, 200],
  },

  [TABS.PLAN_CRITIQUES]: {
    key: 'date',
    headers: [
      'date', 'overall', 'axis_specific', 'axis_timeboxed', 'axis_measurable', 'axis_realistic',
      'issues', 'rewritten_blocks', 'summary', 'user_accepted', 'updated_at',
    ],
    widths: [100, 80, 110, 110, 110, 110, 420, 420, 420, 110, 150],
  },

  [TABS.IMPORT_LOG]: {
    key: 'sha256',
    headers: [
      'sha256', 'imported_at', 'file_name', 'sheet_name', 'header_row', 'rows_populated',
      'rows_parsed', 'rows_quarantined', 'days_with_data', 'months', 'unit_decisions',
      'agrees_with_user_summary', 'status', 'error',
    ],
    widths: [280, 150, 240, 140, 90, 110, 100, 120, 110, 120, 320, 170, 80, 200],
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
