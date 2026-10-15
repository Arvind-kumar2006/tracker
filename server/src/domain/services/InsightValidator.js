/**
 * InsightValidator — the gate between the LLM and the user.
 *
 * This is the most important module in Phase 3. It is deliberately a PURE DOMAIN FUNCTION with
 * no LLM, no network, and no database, so it can be exhaustively tested without an API key.
 *
 * The reference workbook makes this non-negotiable: 26 of 31 days carry no data at all. An LLM
 * handed that shape will happily produce a fluent month-long narrative about days on which
 * nothing was recorded. Every claim must therefore be proven, not trusted:
 *
 *   1. Every insight carries at least one evidence date.
 *   2. Every cited date is a day that ACTUALLY HAS DATA.
 *   3. Every cited quote appears verbatim in that day's own text.
 *   4. No action violates a study constraint the user stated in column M.
 *
 * Anything failing a rule is DROPPED and recorded in `rejected`, surfaced to the user rather
 * than silently hidden.
 */

import { TargetMet } from '../entities/valueObjects.js';
import { parseTimeBlocks } from './TimeBlockParser.js';

/** Text a quote is allowed to be drawn from, for a given day. */
export function buildDayCorpus(entry) {
  const parts = [
    entry.accomplished,
    entry.buildNote,
    entry.plan?.items?.map((i) => i.text).join(' '),
    entry.plan?.summary,
    entry.tomorrowChange,
    entry.blockers?.raw,
    ...(entry.blockers?.segments ?? []),
    ...(entry.timeBlocks ?? []).map((b) => b.label),
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Normalise for comparison: lowercase, unify smart quotes and dashes, strip punctuation noise,
 * collapse whitespace. Models routinely "beautify" an apostrophe or a dash when quoting, and
 * that must not be treated as fabrication.
 */
export function normaliseForMatch(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^a-z0-9'\s:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SEVERITIES = new Set(['INFO', 'LOW', 'MEDIUM', 'HIGH']);
const SECTIONS = new Set(['WELL', 'COSTING_YOU', 'PATTERN', 'TRAJECTORY']);

/**
 * The set of dates an insight is permitted to reference.
 * Days with hasData === false are excluded outright — this is the anti-fabrication boundary.
 */
export function allowedDates(entries) {
  const allowed = new Map();
  for (const e of entries) {
    if (e.hasData) allowed.set(e.date, buildDayCorpus(e));
  }
  return allowed;
}

/**
 * Validate one insight. Returns null when it passes, or a rejection object when it does not.
 */
export function validateInsight(insight, allowed, options = {}) {
  const { requireVerbatimQuote = true, minQuoteLength = 8 } = options;

  if (!insight || typeof insight !== 'object') {
    return { item: insight, reason: 'INSIGHT_NOT_AN_OBJECT' };
  }
  if (!insight.title || !insight.body) {
    return { item: insight, reason: 'MISSING_TITLE_OR_BODY' };
  }
  if (insight.severity && !SEVERITIES.has(insight.severity)) {
    return { item: insight, reason: `UNKNOWN_SEVERITY:${insight.severity}` };
  }
  if (insight.section && !SECTIONS.has(insight.section)) {
    return { item: insight, reason: `UNKNOWN_SECTION:${insight.section}` };
  }

  const evidence = insight.evidence ?? insight.evidenceDates ?? [];
  const evidenceList = Array.isArray(evidence) ? evidence : [];

  // Rule 1 — no evidence, no insight.
  if (evidenceList.length === 0) {
    return { item: insight, reason: 'NO_EVIDENCE' };
  }

  for (const ev of evidenceList) {
    // Tolerate a bare date string, but prefer {date, quote}.
    const date = typeof ev === 'string' ? ev : ev?.date;
    const quote = typeof ev === 'string' ? null : (ev?.quote ?? null);

    // Rule 2 — the cited day must exist and must have data.
    if (!date || !allowed.has(date)) {
      const known = date ? 'CITES_EMPTY_OR_UNKNOWN_DAY' : 'EVIDENCE_MISSING_DATE';
      return { item: insight, reason: known, detail: { date, title: insight.title } };
    }

    // Rule 3 — the quote must really come from that day.
    if (requireVerbatimQuote) {
      if (!quote || normaliseForMatch(quote).length < minQuoteLength) {
        return {
          item: insight,
          reason: 'EVIDENCE_MISSING_QUOTE',
          detail: { date, title: insight.title },
        };
      }
      const corpus = normaliseForMatch(allowed.get(date));
      if (!corpus.includes(normaliseForMatch(quote))) {
        return {
          item: insight,
          reason: 'QUOTE_NOT_FOUND_IN_SOURCE',
          detail: { date, title: insight.title, quote: String(quote).slice(0, 120) },
        };
      }
    }
  }

  return null;
}

/**
 * Does this action break a rule the user explicitly stated?
 * FR-5.4: a generated plan that violates a stated constraint is rejected and regenerated.
 */
export function validateActionAgainstConstraints(action, constraints = []) {
  if (!action?.action) return { ok: false, reason: 'ACTION_EMPTY' };

  const text = normaliseForMatch(`${action.action} ${action.firstStep ?? ''}`);
  if (text === '') return { ok: false, reason: 'ACTION_EMPTY' };

  // Parse the proposed time box with the SAME parser used for the user's own blocks, so a
  // constraint is checked against the same interpretation the rest of the system uses.
  let parsed = [];
  if (action.timeBox) {
    try {
      parsed = parseTimeBlocks(action.timeBox).blocks;
    } catch {
      parsed = [];
    }
  }

  for (const c of constraints) {
    if (!c.text) continue;

    // A time constraint such as "cannot study after 00:00" means the session must FINISH by
    // that clock time. Two traps this avoids:
    //   - checking every clock token would also test the START time, rejecting a perfectly
    //     legal 19:00-23:00 session;
    //   - a limit of 0 is midnight, i.e. the 1440 end-of-day boundary, not "00:00 sharp".
    if (c.type === 'TIME_WINDOW' && c.notAfterMinutes !== undefined) {
      const limitOnTimeline = c.notAfterMinutes === 0 ? 1440 : c.notAfterMinutes;

      for (const b of parsed) {
        // A session ending EXACTLY at midnight is legal — the rule says "after the 12 am".
        // Only overshooting counts. `crossesMidnight` is true whenever end <= start, which
        // includes "20:00 -> 00:00", so the end-time check disambiguates it.
        const overshootsMidnight = b.crossesMidnight && b.endMinutes !== 0;
        // A session starting in the small hours (00:00-06:00) is already past midnight, even
        // though its clock value is small. Without this, "1:00 am - 3:00 am" would sneak past
        // a midnight cutoff purely because 60 < 1440.
        const startsInSmallHours = b.startMinutes < 6 * 60;

        if (limitOnTimeline === 1440 && (overshootsMidnight || startsInSmallHours)) {
          return {
            ok: false,
            reason: 'CONSTRAINT_VIOLATION',
            constraint: c.text,
            detail: `session ${b.start}-${b.end} runs past midnight, which the constraint forbids`,
          };
        }
        if (b.endMinutes > limitOnTimeline) {
          return {
            ok: false,
            reason: 'CONSTRAINT_VIOLATION',
            constraint: c.text,
            detail: `session ends ${b.end} but the latest allowed finish is ${formatMinutes(limitOnTimeline)}`,
          };
        }
        if (b.startMinutes > limitOnTimeline) {
          return {
            ok: false,
            reason: 'CONSTRAINT_VIOLATION',
            constraint: c.text,
            detail: `session starts ${b.start} but the latest allowed finish is ${formatMinutes(limitOnTimeline)}`,
          };
        }
      }
    }

    // A prohibition such as "no nap after 19:00" forbids mentioning the banned activity.
    if (c.type === 'PROHIBITION' && c.bans && c.bans.length > 0) {
      for (const banned of c.bans) {
        if (banned && text.includes(normaliseForMatch(banned))) {
          return { ok: false, reason: 'CONSTRAINT_VIOLATION', constraint: c.text, detail: `mentions "${banned}"` };
        }
      }
    }
  }

  return { ok: true };
}

function formatMinutes(mins) {
  const m = mins >= 1440 ? 1440 : mins;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Validate a whole analysis bundle.
 *
 * @param {object} args
 * @param {Array} args.entries  - every normalised day, including empty ones
 * @param {Array} args.insights
 * @param {Array} [args.patterns]
 * @param {Array} [args.actions]
 * @param {Array} [args.constraints]
 * @returns {{insights: Array, rejected: Array, stats: object, allowedDateCount: number}}
 */
export function validateBundle({ entries, insights = [], patterns = [], actions = [], constraints = [] }) {
  const allowed = allowedDates(entries);

  const accepted = [];
  const rejected = [];

  for (const ins of insights) {
    const r = validateInsight(ins, allowed);
    if (r) rejected.push({ ...r, kind: 'insight' });
    else accepted.push(ins);
  }

  const acceptedPatterns = [];
  for (const p of patterns) {
    const synthetic = { title: p.category, body: p.summary ?? p.category, evidence: p.evidence ?? [], section: 'PATTERN', severity: p.severity };
    const r = validateInsight(synthetic, allowed);
    if (r) rejected.push({ ...r, kind: 'pattern' });
    else acceptedPatterns.push(p);
  }

  const acceptedActions = [];
  for (const a of actions) {
    const c = validateActionAgainstConstraints(a, constraints);
    if (!c.ok) rejected.push({ item: a, reason: c.reason, constraint: c.constraint, detail: c.detail, kind: 'action' });
    else acceptedActions.push(a);
  }

  const totalDays = entries.length;
  const emptyDays = entries.filter((e) => !e.hasData).length;

  return {
    insights: accepted,
    patterns: acceptedPatterns,
    actions: acceptedActions,
    rejected,
    allowedDateCount: allowed.size,
    allowedDateCount: allowed.size,
    stats: {
      insightsIn: insights.length,
      insightsOut: accepted.length,
      patternsIn: patterns.length,
      patternsOut: acceptedPatterns.length,
      actionsIn: actions.length,
      actionsOut: acceptedActions.length,
      rejectedCount: rejected.length,
      rejectionBreakdown: rejected.reduce((acc, r) => {
        const k = String(r.reason).split(':')[0];
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
      allowedDateCount: allowed.size,
      totalDays,
      emptyDays,
      // The headline safety number: 0 means the model invented nothing about blank days.
      fabricatedDayCitations: rejected.filter((r) => r.reason === 'CITES_EMPTY_OR_UNKNOWN_DAY').length,
    },
  };
}

/**
 * An analysis must refuse to run on too little data (FR-4.7) rather than manufacture a view.
 */
export function assertEnoughData(entries, minimum = 3) {
  const withData = entries.filter((e) => e.hasData);
  if (withData.length < minimum) {
    return {
      ok: false,
      code: 'INSUFFICIENT_DATA',
      message: `Only ${withData.length} day(s) carry data; at least ${minimum} are needed before analysis is meaningful.`,
      daysWithData: withData.length,
      daysNeeded: minimum,
      dates: withData.map((e) => e.date),
    };
  }
  return { ok: true, daysWithData: withData.length };
}

export { TargetMet };