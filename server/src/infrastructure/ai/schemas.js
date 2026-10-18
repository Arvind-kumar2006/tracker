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

/* ---------------- planQuality ---------------- */

export const PlanQualityOutputSchema = z.object({
  realistic: z.boolean(),
  summary: z.string(),
  suggestions: z.array(z.object({
    itemId: z.string(),
    suggestion: z.string(),
    reason: z.string(),
  })).max(3),
});

/* ---------------- planGeneration ---------------- */

export const PlanGenerationOutputSchema = z.object({
  summary: z.string(),
  items: z.array(z.object({
    text: z.string().min(3).max(400),
    outcome: z.string().min(3).max(400),
    estimatedMinutes: z.number().int().min(5).max(240),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  })).min(1).max(3),
  minimumMinutes: z.number().int().min(0).max(1440),
  idealMinutes: z.number().int().min(0).max(1440),
  breakMinutes: z.number().int().min(0).max(240),
  bufferMinutes: z.number().int().min(0).max(240),
  availableMinutes: z.number().int().min(0).max(1440),
});

/* ---------------- reflectionQuality ---------------- */

export const ReflectionFieldQualitySchema = z.object({
  fieldId: z.enum(['floorHit', 'accomplished', 'blockers', 'planBend', 'tomorrowChange']),
  score: z.number().int().min(0).max(10),
  isVague: z.boolean(),
  reason: z.string(),
  suggestion: z.string().nullable(),
});

const CoachingEvidenceRef = z.string().min(1).max(80);
const CoachingObservationSchema = z.object({
  text: z.string().min(1).max(320),
  evidence: z.array(CoachingEvidenceRef).min(1).max(3),
});
const CoachingInterpretationSchema = z.object({
  text: z.string().min(1).max(320),
  evidence: z.array(CoachingEvidenceRef).min(1).max(3),
  confidence: z.enum(['low', 'medium', 'high']),
});
const CoachingRecommendationSchema = z.object({
  action: z.string().min(1).max(240),
  why: z.string().min(1).max(240),
  evidence: z.array(CoachingEvidenceRef).min(1).max(3),
});

export const ReflectionQualityOutputSchema = z.object({
  fields: z.array(ReflectionFieldQualitySchema),
  overallScore: z.number().int().min(0).max(10),
  vagueCount: z.number().int(),
  isComplete: z.boolean(),
  summary: z.string(),
  observations: z.array(CoachingObservationSchema).max(4).default([]),
  interpretations: z.array(CoachingInterpretationSchema).max(3).default([]),
  mainBottleneck: z.object({
    text: z.string().min(1).max(240),
    evidence: z.array(CoachingEvidenceRef).min(1).max(3),
  }).nullable().default(null),
  recommendations: z.array(CoachingRecommendationSchema).max(2).default([]),
  followUpMeasure: z.string().max(240).nullable().default(null),
  confidence: z.enum(['low', 'medium', 'high']).default('low'),
});

/* ---------------- reflectionCoach ---------------- */

export const ReflectionCoachOutputSchema = z.object({
  observation: z.string().min(1).max(240),
  obstaclePattern: z.string().min(1).max(240),
  tomorrowSuggestion: z.string().min(1).max(240),
});

/* ---------------- weekly handwritten plan extraction ---------------- */

const WeeklyAnswerSchema = z.object({
  reviewLastWeek: z.string().max(4000),
  blockers: z.string().max(4000),
  plannedChange: z.string().max(4000),
  successOutcomes: z.string().max(4000),
  deliverables: z.string().max(4000),
  fixedCommitments: z.string().max(4000),
  fitAssessment: z.string().max(4000),
});

const WeeklyOutcomeSchema = z.object({
  outcome: z.string().max(500),
  deliverable: z.string().max(700),
  completionDay: z.string().max(40),
});

const WeeklyCommitmentSchema = z.object({
  text: z.string().max(500),
  day: z.string().max(40),
  start: z.string().max(30),
  hardStop: z.string().max(30),
});

const WeeklyBlockSchema = z.object({
  day: z.string().max(40),
  type: z.string().max(80),
  action: z.string().max(500),
  result: z.string().max(500),
  start: z.string().max(30),
  hardStop: z.string().max(30),
});

export const WeeklyPlanExtractionSchema = z.object({
  answers: WeeklyAnswerSchema,
  outcomes: z.array(WeeklyOutcomeSchema).max(3),
  commitments: z.array(WeeklyCommitmentSchema).max(30),
  dailyBlocks: z.array(WeeklyBlockSchema).max(100),
  extractedObstacles: z.array(z.string().max(300)).max(30),
  plannedChange: z.string().max(4000),
  unclearSections: z.array(z.string().max(160)).max(20),
  confidence: z.enum(['low', 'medium', 'high']),
});

/* ---------------- monthly handwritten plan extraction ---------------- */

const MonthlyAnswerSchema = z.object({
  reviewLastMonth: z.string().max(4000),
  blockers: z.string().max(4000),
  plannedChange: z.string().max(4000),
  successOutcomes: z.string().max(4000),
  deliverables: z.string().max(4000),
  deadlinesCommitments: z.string().max(4000),
  weeklyMilestones: z.string().max(4000),
  fitAssessment: z.string().max(4000),
});

const MonthlyOutcomeSchema = z.object({
  outcome: z.string().max(500),
  deliverable: z.string().max(700),
});

const MonthlyDeadlineSchema = z.object({
  text: z.string().max(500),
  date: z.string().max(80),
});

const MonthlyCommitmentSchema = z.object({
  text: z.string().max(500),
  when: z.string().max(120),
});

const MonthlyMilestoneSchema = z.object({
  week: z.string().max(40),
  milestone: z.string().max(700),
});

export const MonthlyPlanExtractionSchema = z.object({
  answers: MonthlyAnswerSchema,
  outcomes: z.array(MonthlyOutcomeSchema).max(3),
  expectedDeliverables: z.string().max(4000),
  majorDeadlines: z.array(MonthlyDeadlineSchema).max(30),
  fixedCommitments: z.array(MonthlyCommitmentSchema).max(30),
  weeklyMilestones: z.array(MonthlyMilestoneSchema).max(5),
  extractedObstacles: z.array(z.string().max(300)).max(30),
  plannedChange: z.string().max(4000),
  unclearSections: z.array(z.string().max(160)).max(20),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const SCHEMAS = {
  detectPatterns: DetectPatternsOutputSchema,
  critique: CritiqueOutputSchema,
  coach: CoachOutputSchema,
  critiquePlans: PlanCritiqueOutputSchema,
  planQuality: PlanQualityOutputSchema,
  planGeneration: PlanGenerationOutputSchema,
  reflectionQuality: ReflectionQualityOutputSchema,
  reflectionCoach: ReflectionCoachOutputSchema,
  weeklyPlanExtraction: WeeklyPlanExtractionSchema,
  monthlyPlanExtraction: MonthlyPlanExtractionSchema,
};
