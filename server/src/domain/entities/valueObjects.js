import { StudyCategory, CATEGORY_COLUMN } from './studyCategory.js';


export const TargetMet = {
  MET: 'MET',
  PARTIAL: 'PARTIAL',
  MISSED: 'MISSED',
  SKIPPED: 'SKIPPED',
  UNKNOWN: 'UNKNOWN',
};

const TARGET_MET_ALIASES = new Map(
  Object.entries({
    // positive
    met: TargetMet.MET,
    yes: TargetMet.MET,
    y: TargetMet.MET,
    yep: TargetMet.MET,
    done: TargetMet.MET,
    achieved: TargetMet.MET,
    full: TargetMet.MET,
    '✅': TargetMet.MET,
    // reduced bar
    floor: TargetMet.PARTIAL,
    minimum: TargetMet.PARTIAL,
    partial: TargetMet.PARTIAL,
    half: TargetMet.PARTIAL,
    almost: TargetMet.PARTIAL,
    // negative
    no: TargetMet.MISSED,
    n: TargetMet.MISSED,
    missed: TargetMet.MISSED,
    failed: TargetMet.MISSED,
    '❌': TargetMet.MISSED,
    '✗': TargetMet.MISSED,
    '0': TargetMet.MISSED,
  })
);

/**
 * @param {string|number|null|undefined} raw
 * @param {boolean} hasData - false when the day has no entries (PRD F2: a 0 must never
 *                            be read as "studied zero hours")
 * @returns {{value: string, confidence: number, reason: string|null}}
 */
export function parseTargetMet(raw, hasData = true) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    // An empty status on an empty day means "never recorded", which is SKIPPED, not MISSED.
    return {
      value: hasData ? TargetMet.UNKNOWN : TargetMet.SKIPPED,
      confidence: 1,
      reason: hasData ? 'empty status on a day that has data' : 'no data recorded for this day',
    };
  }

  const key = String(raw).trim().toLowerCase().replace(/[.!]+$/, '');
  const mapped = TARGET_MET_ALIASES.get(key);

  if (mapped) {
    return {
      value: mapped,
      // A direct exact-match on an alias we recognise is high confidence.
      confidence: 0.95,
      reason: `"${String(raw).trim()}" mapped to ${mapped}`,
    };
  }

  // Unrecognised value: do NOT guess. Surface it (PRD quarantine contract).
  return {
    value: TargetMet.UNKNOWN,
    confidence: 0,
    reason: `"${String(raw).trim()}" is not a recognised target-met value`,
  };
}

/**
 * Column L "Did I build something today, or learn about building it?" — PRD F4.
 * Observed values: "Nothing", "- learn to build", "yes i build but it's vibe code ...".
 */
export const BuildOutcome = {
  NONE: 'NONE',
  LEARNED: 'LEARNED',
  BUILT: 'BUILT',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Ordered longest-prefix-first so "learn to" wins over a generic "no" scan, and an
 * explicit "yes i build" outranks the word "learned" appearing later in the sentence.
 */
const BUILD_RULES = [
  { outcome: BuildOutcome.NONE, patterns: [/^\s*nothing\b/i, /^\s*no\s*[.!]?\s*$/i, /\bnothing\s+built\b/i] },
  { outcome: BuildOutcome.BUILT, patterns: [/\byes\b.*\b(built|build|made|created|shipped)\b/i, /\bi\s+(built|made|created)\b/i] },
  { outcome: BuildOutcome.LEARNED, patterns: [/\blearn(ed|t|ing)?\s+(to|about|how)\b/i, /\b(learned|studied)\s+about\s+building\b/i] },
];

export function parseBuildOutcome(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { value: BuildOutcome.UNKNOWN, confidence: 1, reason: 'empty value' };
  }

  const text = String(raw);
  for (const rule of BUILD_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { value: rule.outcome, confidence: 0.85, reason: `matched "${rule.outcome}" pattern` };
    }
  }

  return {
    value: BuildOutcome.UNKNOWN,
    confidence: 0,
    reason: `"${text.slice(0, 60)}" does not match a known build-outcome shape`,
  };
}

export { StudyCategory, CATEGORY_COLUMN };