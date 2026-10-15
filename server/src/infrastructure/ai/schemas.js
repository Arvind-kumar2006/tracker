/**
 * Structured-output schemas for every LLM node.
 *
 * These are the contract between the model and the validator. Anything the model returns must
 * fit one of these shapes; anything that does not is rejected at parse time rather than being
 * coerced, because a coerced insight is exactly the kind of half-truth the validator exists to
 * stop.
 *
 * Note `evidence` is an array of {date, quote}. The quote is NOT optional in spirit — the
 * validator will drop any evidence item lacking a verbatim quote.
 */

import * as z from 'zod';

export const Severity = z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH']);
export const Section = z.enum(['WELL', 'COSTING_YOU', 'PATTERN', 'TRAJECTORY']);

/** A citation. `quote` must appear verbatim in that day's text or the validator drops it. */
export const EvidenceSchema = z.object({
  date: z.string().describe('ISO date, e.g. 2026-10-05. MUST be a day listed in the input.'),
  quote: z.string().describe('A SHORT exact substring copied from that day. Do not paraphrase.'),
});

/* ---------------- detectPatterns ---------------- */

export const PatternSchema = z.object({
  category: z.enum([
    'sleep',
    'distraction',
    'passive_learning',
    'overplanning',
    'start_lateness',
    'task_avoidance',
    'resource_chaos',
    'env_collapse',
    'inconsistent_logging',
  ]),
  summary: z.string().describe('One sentence describing the pattern.'),
  severity: Severity,
  evidence: z.array(EvidenceSchema).min(1),
});

export const DetectPatternsOutputSchema = z.object({
  patterns: z.array(PatternSchema),
});

/* ---------------- critique ---------------- */

export const InsightSchema = z.object({
  section: Section,
  title: z.string().max(90),
  body: z.string().describe('2-4 sentences. Specific, not generic encouragement.'),
  severity: Severity,
  evidence: z.array(EvidenceSchema).min(1),
});

export const CritiqueOutputSchema = z.object({
  wentWell: z.array(InsightSchema),
  costingYou: z.array(InsightSchema),
});

/* ---------------- coach ---------------- */

export const ActionSchema = z.object({
  action: z.string().describe('What to do, starting with a verb.'),
  why: z.string().describe('Tie it to a cited day.'),
  firstStep: z.string().describe('The single concrete first action.'),
  timeBox: z.string().describe('e.g. "7:00 pm - 9:00 pm". Must respect the user constraints.'),
  evidence: z.array(EvidenceSchema).min(1),
});

export const CoachOutputSchema = z.object({
  actions: z.array(ActionSchema).max(3),
});

/* ---------------- critiquePlans ---------------- */

export const PlanAxesSchema = z.object({
  specific: z.object({ score: z.number().int().min(0).max(10), note: z.string() }),
  timeboxed: z.object({ score: z.number().int().min(0).max(10), note: z.string() }),
  measurable: z.object({ score: z.number().int().min(0).max(10), note: z.string() }),
  realistic: z.object({ score: z.number().int().min(0).max(10), note: z.string() }),
});

export const PlanCritiqueSchema = z.object({
  date: z.string(),
  axes: PlanAxesSchema,
  overall: z.number().int().min(0).max(10),
  issues: z.array(z.string()).min(1),
  rewrittenBlocks: z.array(
    z.object({
      label: z.string(),
      start: z.string().describe('e.g. "7:00 pm"'),
      durationMin: z.number().int().min(5).max(240),
    })
  ).min(1),
  summary: z.string(),
});

export const PlanCritiqueOutputSchema = z.object({
  critiques: z.array(PlanCritiqueSchema),
});

/* ---------------- reflectionQuality ---------------- */

export const ReflectionFieldQualitySchema = z.object({
  fieldId: z.enum(['floorHit', 'accomplished', 'blockers', 'planBend', 'tomorrowChange']),
  score: z.number().int().min(0).max(10),
  isVague: z.boolean(),
  reason: z.string(),
  suggestion: z.string().nullable(),
});

export const ReflectionQualityOutputSchema = z.object({
  fields: z.array(ReflectionFieldQualitySchema),
  overallScore: z.number().int().min(0).max(10),
  vagueCount: z.number().int(),
  isComplete: z.boolean(),
  summary: z.string(),
});

export const SCHEMAS = {
  detectPatterns: DetectPatternsOutputSchema,
  critique: CritiqueOutputSchema,
  coach: CoachOutputSchema,
  critiquePlans: PlanCritiqueOutputSchema,
  reflectionQuality: ReflectionQualityOutputSchema,
};