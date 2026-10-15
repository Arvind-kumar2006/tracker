/**
 * UnitInference — resolves PRD finding F1.
 *
 * The real workbook labels columns D-G as "(h)" but stores MINUTES. Proof from row 5:
 *   GenAI 75 + Coding 0 + English 0 + Other 30 = 105 minutes
 *   105 / 60 = 1.75 hours, and cell I5 is exactly 1.75.
 *
 * So the header lies, and the system must detect this from data rather than trusting either
 * the header or the raw value. This module is deliberately pure and synchronous so it can be
 * exhaustively unit-tested.
 */

export const Unit = { HOURS: 'HOURS', MINUTES: 'MINUTES', UNKNOWN: 'UNKNOWN' };

/** No human studies more than 24h in a day, so a value above this ceiling proves minutes. */
const DAILY_CEILING = 24;

/** A single "day" of study is almost always well under this; used only for tie-breaking. */
const IMPLAUSIBLE_HOUR_CEILING = 16;

const NUMERIC = /^-?\d+(\.\d+)?$/;

function toNumeric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text === '') return null;
  if (!NUMERIC.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Infer the unit of a single numeric column from its observed values.
 *
 * @param {Array<string|number|null|undefined>} values - every non-header cell in the column
 * @returns {{unit: string, confidence: number, reason: string, samples: number[], max: number|null}}
 */
export function inferColumnUnit(values) {
  const numerics = values.map(toNumeric).filter((n) => n !== null);
  const samples = numerics.filter((n) => n > 0); // ignore explicit zeros when judging plausibility

  if (samples.length === 0) {
    // Nothing to judge from. Default to the header's claim, but be honest that it's unverified.
    return {
      unit: Unit.HOURS,
      confidence: 0,
      reason: 'no numeric values in column; defaulting to header claim without verification',
      samples: [],
      max: null,
    };
  }

  const max = Math.max(...samples);

  // A value above 24 cannot be hours-in-a-day, so the column is minutes.
  if (max > DAILY_CEILING) {
    return {
      unit: Unit.MINUTES,
      confidence: 0.95,
      reason: `max value ${max} exceeds the ${DAILY_CEILING}h/day ceiling, so values are minutes, not hours`,
      samples: samples.length,
      max,
    };
  }

  // Ambiguous band. A value just under the ceiling is very unlikely in hours, so minutes is the
  // better bet — but not as certain as the >24 case.
  if (max > IMPLAUSIBLE_HOUR_CEILING) {
    return {
      unit: Unit.MINUTES,
      confidence: 0.6,
      reason: `max value ${max} is implausible as hours for one day, so values are probably minutes`,
      samples: samples.length,
      max,
    };
  }

  // Everything fits comfortably as hours.
  return {
    unit: Unit.HOURS,
    confidence: 0.9,
    reason: `all ${samples.length} values fit within a plausible daily hour count (max ${max})`,
    samples: samples.length,
    max,
  };
}

/**
 * Strong corroboration: if dividing the column sum by 60 reproduces the value the user
 * themselves recorded in the "Total (h)" column, the minutes reading is confirmed.
 * This is what turns an inference into a fact for the reference workbook.
 *
 * @returns {{supported: boolean, confidenceBoost: number, detail: string}}
 */
export function corroborateAgainstReportedTotal(columnSum, reportedTotalHours, tolerancePct = 0.05) {
  if (columnSum === null || reportedTotalHours === null || reportedTotalHours <= 0) {
    return { supported: false, confidenceBoost: 0, detail: 'no comparable total available' };
  }

  const asMinutes = columnSum / 60;
  const diffPct = Math.abs(asMinutes - reportedTotalHours) / reportedTotalHours;

  if (diffPct <= tolerancePct) {
    return {
      supported: true,
      confidenceBoost: 0.05,
      detail: `sum/60 = ${asMinutes.toFixed(2)}h matches reported total ${reportedTotalHours}h (within ${(diffPct * 100).toFixed(1)}%), confirming minutes`,
    };
  }

  const asHours = columnSum;
  const hoursDiffPct = Math.abs(asHours - reportedTotalHours) / reportedTotalHours;

  if (hoursDiffPct <= tolerancePct) {
    return {
      supported: true,
      confidenceBoost: 0.05,
      detail: `sum = ${asHours}h matches reported total ${reportedTotalHours}h, confirming hours`,
    };
  }

  return {
    supported: false,
    confidenceBoost: 0,
    detail: `neither reading matches reported total ${reportedTotalHours}h (sum=${columnSum}); row flagged for review`,
  };
}

/** Convert a numeric cell to canonical MINUTES, given the resolved unit. */
export function toMinutes(value, unit) {
  const n = toNumeric(value);
  if (n === null) return null;
  if (unit === Unit.MINUTES) return n;
  if (unit === Unit.HOURS) return n * 60;
  return null; // UNKNOWN: refuse to invent a number
}

export { toNumeric };