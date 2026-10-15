/**
 * AnalysisGraph — the LangGraph pipeline for Phase 3.
 *
 * Why a graph and not one prompt (PRD §6.1): four requirements force multi-step control flow.
 *   (a) evidence must be validated before anything is shown to the user;
 *   (b) claims about blank days must be *caught*, not hoped away;
 *   (c) a plan that violates a constraint the user stated must be rejected and regenerated;
 *   (d) a provider failure mid-run must fall back to another model without failing the run.
 * A single prompt can do none of these.
 *
 * Shape:
 *
 *   START -> loadContext --(<3 days)--> insufficientData -> END
 *              |
 *              v
 *        computeMetrics
 *              |
 *              v
 *       detectPatterns --(no patterns)--> critique
 *              |                              |
 *              +------------------------------+
 *                                             v
 *                                          coach
 *                                             |
 *                                             v
 *                                     critiquePlans
 *                                             |
 *                                             v
 *                                         validate
 *                                             |
 *                                  needsRegeneration --(rejected && attempts<1)--> critique
 *                                             |
 *                                        render -> persist -> END
 */

import { StateGraph, Annotation, START, END, MemorySaver } from '@langchain/langgraph';
import { calculateMetrics } from '../../../domain/services/MetricsCalculator.js';
import { extractConstraints, describeConstraints } from '../../../domain/services/ConstraintExtractor.js';
import { validateBundle, assertEnoughData } from '../../../domain/services/InsightValidator.js';
import { SCHEMAS } from '../schemas.js';
import {
  ANALYSIS_SYSTEM_PROMPT,
  detectPatternsPrompt,
  critiquePrompt,
  coachPrompt,
  critiquePlansPrompt,
  regeneratePrompt,
  renderDays,
} from '../prompts.js';

const MAX_REGENERATION = 1;

/**
 * Last-write-wins channels are not pre-seeded with their default, so a node can legitimately
 * read `undefined` on the first pass. Every array read in this file goes through here.
 */
const list = (v) => v ?? [];

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

/**
 * Reducer policy, chosen per key from what the data actually means:
 *
 *   LAST-WRITE-WINS (no reducer) — every writer of these keys is the *most recent* version of
 *   the truth. loadContext narrows `entries` to citable days; `critique`/`coach`/`critiquePlans`
 *   rewrite themselves on a retry; `validate` reports the rejections of its own pass. A concat
 *   reducer here would leave a rejected first attempt sitting in state next to its successful
 *   replacement — the user would see the exact insights we threw away.
 *
 *   ACCUMULATE (concat reducer) — spend, token counts and model names genuinely add up across
 *   the whole run, and must survive every rewrite.
 */
export const AnalysisState = Annotation.Root({
  month: Annotation(),
  monthGoal: Annotation({ default: () => '' }),
  asOf: Annotation(),

  /** LAST-WRITE-WINS: set once by loadContext to the citable subset. */
  entries: Annotation({ default: () => [] }),
  /** Captured BEFORE filtering, so the bundle can honestly report blank days. */
  monthTotals: Annotation({ default: () => ({ totalDays: 0, daysWithData: 0, emptyDays: 0 }) }),

  allowedDates: Annotation({ default: () => [] }),
  metrics: Annotation({ default: () => null }),
  constraints: Annotation({ default: () => [] }),
  daysText: Annotation({ default: () => '' }),

  patterns: Annotation({ default: () => [] }),
  insights: Annotation({ default: () => [] }),
  actions: Annotation({ default: () => [] }),
  planCritiques: Annotation({ default: () => [] }),

  /** Populated by validate(); everything here was DROPPED from what the user will see. */
  rejected: Annotation({ default: () => [] }),
  rejectedActions: Annotation({ default: () => [] }),
  /**
   * ACCUMULATES across regeneration passes. `rejected` is last-write-wins because it describes
   * the final, visible output; this keeps the earlier attempt's failures too, so the user can
   * see that the model was corrected rather than silently handed a different answer.
   */
  rejectionHistory: Annotation({ reducer: (a, b) => (a ?? []).concat(b ?? []), default: () => [] }),
  validationStats: Annotation({ default: () => null }),
  attempts: Annotation({ reducer: (a, b) => (a ?? 0) + (b ?? 0), default: () => 0 }),

  costCredits: Annotation({ reducer: (a, b) => (a ?? 0) + (b ?? 0), default: () => 0 }),
  tokens: Annotation({ reducer: (a, b) => (a ?? 0) + (b ?? 0), default: () => 0 }),
  modelsUsed: Annotation({ reducer: (a, b) => (a ?? []).concat(b ?? []), default: () => [] }),

  bundle: Annotation({ default: () => null }),
  insufficient: Annotation({ default: () => null }),
  errors: Annotation({ reducer: (a, b) => (a ?? []).concat(b ?? []), default: () => [] }),
});

/* ------------------------------------------------------------------ */
/* Nodes                                                                */
/* ------------------------------------------------------------------ */

/**
 * Gate 1: refuse to analyse thin data. 26 of 31 days in the reference month are blank, and an
 * LMC asked to describe a month of that shape will invent a narrative. FR-4.7.
 */
function loadContext(state) {
  const gate = assertEnoughData(list(state.entries), 3);
  if (!gate.ok) return { insufficient: gate };

  // Captured BEFORE narrowing, so the bundle can still honestly report how many days were blank.
  const monthTotals = {
    totalDays: list(state.entries).length,
    daysWithData: gate.daysWithData,
    emptyDays: list(state.entries).length - gate.daysWithData,
  };

  const entries = list(state.entries).filter((e) => e.hasData);
  return {
    entries,
    monthTotals,
    allowedDates: entries.map((e) => e.date),
    daysText: renderDays(entries),
  };
}

/** Deterministic. No LLM may be involved in arithmetic (NFR-7). */
function computeMetrics(state) {
  const metrics = calculateMetrics({
    entries: list(state.entries).filter((e) => e.hasData),
    month: state.month,
    asOf: state.asOf,
  });
  const constraints = extractConstraints(list(state.entries));
  return { metrics, constraints };
}

async function detectPatterns(state, { llm }) {
  try {
    const res = await llm.structured({
      task: 'detectPatterns',
      system: ANALYSIS_SYSTEM_PROMPT,
      prompt: detectPatternsPrompt({
        days: state.daysText,
        metrics: state.metrics,
        month: state.month,
      }),
      schema: SCHEMAS.detectPatterns,
      temperature: 0.1,
    });
    return {
      patterns: res.data.patterns ?? [],
      costCredits: res.cost,
      tokens: res.tokens,
      modelsUsed: [res.model],
    };
  } catch (e) {
    // Pattern detection is an enhancement; the run continues without it.
    return { errors: [`detectPatterns failed: ${e.message}`] };
  }
}

async function critique(state, { llm }) {
  // On a regeneration pass, tell the model exactly what it got wrong last time.
  const rejections = list(state.rejected);
  const rejectionNote = rejections.length ? `\n\n${regeneratePrompt({ rejections })}` : '';

  try {
    const res = await llm.structured({
      task: 'critique',
      system: ANALYSIS_SYSTEM_PROMPT,
      prompt: critiquePrompt({
        days: state.daysText,
        metrics: state.metrics,
        month: state.month,
        patterns: list(state.patterns),
      }) + rejectionNote,
      schema: SCHEMAS.critique,
      temperature: 0.3,
    });
    // Last-write-wins: on a retry this overwrites the rejected first attempt.
    return {
      insights: [...(res.data.wentWell ?? []), ...(res.data.costingYou ?? [])],
      // Count this pass. Without it the regeneration edge below never terminates.
      attempts: 1,
      costCredits: res.cost,
      tokens: res.tokens,
      modelsUsed: [res.model],
    };
  } catch (e) {
    return { attempts: 1, errors: [`critique failed: ${e.message}`] };
  }
}

async function coach(state, { llm }) {
  try {
    const res = await llm.structured({
      task: 'coach',
      system: ANALYSIS_SYSTEM_PROMPT,
      prompt: coachPrompt({
        days: state.daysText,
        metrics: state.metrics,
        constraints: describeConstraints(list(state.constraints)),
        insights: list(state.insights),
      }),
      schema: SCHEMAS.coach,
      temperature: 0.4,
    });
    return {
      actions: res.data.actions ?? [],
      costCredits: res.cost,
      tokens: res.tokens,
      modelsUsed: [res.model],
    };
  } catch (e) {
    return { errors: [`coach failed: ${e.message}`] };
  }
}

async function critiquePlans(state, { llm }) {
  try {
    const res = await llm.structured({
      task: 'critiquePlans',
      system: ANALYSIS_SYSTEM_PROMPT,
      prompt: critiquePlansPrompt({
        days: state.daysText,
        metrics: state.metrics,
        constraints: describeConstraints(list(state.constraints)),
      }),
      schema: SCHEMAS.critiquePlans,
      temperature: 0.5,
    });
    return {
      planCritiques: res.data.critiques ?? [],
      costCredits: res.cost,
      tokens: res.tokens,
      modelsUsed: [res.model],
    };
  } catch (e) {
    return { errors: [`critiquePlans failed: ${e.message}`] };
  }
}

/**
 * THE GATE. Pure domain logic — no LLM, no I/O. Drops anything that fails to prove itself.
 * Runs LAST in the pipeline, after every node has had its chance to produce output.
 */
function validate(state) {
  const result = validateBundle({
    entries: list(state.entries),
    insights: list(state.insights),
    patterns: list(state.patterns),
    actions: list(state.actions),
    constraints: list(state.constraints),
  });

  return {
    insights: result.insights,
    patterns: result.patterns,
    actions: result.actions,
    // validate() only sees the citable days, so restate the whole-month picture from the
    // totals loadContext captured before filtering.
    validationStats: { ...result.stats, ...(state.monthTotals ?? {}) },
    rejected: result.rejected.filter((r) => r.kind === 'insight' || r.kind === 'pattern'),
    rejectedActions: result.rejected.filter((r) => r.kind === 'action'),
    rejectionHistory: result.rejected.map((r) => ({
      kind: r.kind,
      reason: r.reason,
      title: r.item?.title ?? r.item?.action ?? null,
      detail: r.detail ?? r.constraint ?? null,
    })),
  };
}

/**
 * Conditional edge: if something was rejected AND we have not already retried, go back to
 * `critique` with the rejection list in the prompt. One retry only — a model that fails the
 * evidence rule twice will fail it again, and looping costs money for nothing.
 */
function needsRegeneration(state) {
  const hadRejections = list(state.rejected).length > 0 || list(state.rejectedActions).length > 0;
  return hadRejections && state.attempts <= MAX_REGENERATION ? 'regenerate' : 'done';
}

/** Pure formatting into the client-facing bundle. */
function render(state) {
  const bundle = {
    month: state.month,
    generatedAt: new Date().toISOString(),
    metrics: state.metrics,
    constraints: describeConstraints(list(state.constraints)),

    wentWell: list(state.insights).filter((i) => i.section === 'WELL'),
    costingYou: list(state.insights).filter((i) => i.section === 'COSTING_YOU'),

    patterns: list(state.patterns).map((p) => ({
      category: p.category,
      summary: p.summary,
      severity: p.severity,
      evidenceDates: (p.evidence ?? []).map((e) => e.date),
      evidenceQuotes: (p.evidence ?? []).map((e) => e.quote),
    })),

    actions: list(state.actions).map((a) => ({
      action: a.action,
      why: a.why,
      firstStep: a.firstStep,
      timeBox: a.timeBox,
      evidenceDates: (a.evidence ?? []).map((e) => e.date),
    })),

    planCritiques: list(state.planCritiques),

    // Transparency: show the user what was thrown away and why.
    rejected: list(state.rejected).map((r) => ({
      reason: r.reason,
      title: r.item?.title ?? r.item?.category ?? null,
      detail: r.detail ?? null,
    })),
    rejectedActions: list(state.rejectedActions).map((r) => ({
      reason: r.reason,
      action: r.item?.action ?? null,
      constraint: r.constraint ?? null,
      detail: r.detail ?? null,
    })),

    // Everything the model got wrong across the whole run, including attempts the retry fixed.
    rejectionHistory: list(state.rejectionHistory),
    regeneration: {
      ran: (state.attempts ?? 0) > 1,
      critiquePasses: state.attempts ?? 0,
      correctedAfterRetry: (state.attempts ?? 0) > 1 ? list(state.rejectionHistory).length - list(state.rejected).length : 0,
    },

    validationStats: state.validationStats,
    cost: {
      credits: Number(state.costCredits.toFixed(6)),
      tokens: state.tokens,
      modelsUsed: [...new Set(list(state.modelsUsed))],
    },
    warnings: list(state.errors),
  };
  return { bundle };
}

/** Persisting is injected so the graph stays free of database concerns. */
async function persist(state, { insightRepository, planCritiqueRepository }) {
  if (!insightRepository) return {};

  // `state.month`, not the injected deps: deps carries the adapters, not the run's context.
  // Reading `month` from deps silently wrote every insight under an `undefined` month key,
  // making it invisible to every subsequent query.
  const month = state.month;

  if (list(state.insights).length) {
    await insightRepository.upsertMany(
      list(state.insights).map((i) => ({
        section: i.section,
        title: i.title,
        body: i.body,
        severity: i.severity,
        evidenceDates: (i.evidence ?? []).map((e) => e.date),
        evidenceQuotes: (i.evidence ?? []).map((e) => e.quote),
        action: list(state.actions)[0]?.action ?? null,
        model: state.modelsUsed.at(-1) ?? null,
        tokens: state.tokens,
        costCredits: Number(state.costCredits.toFixed(6)),
      })),
      { month }
    );
  }

  if (planCritiqueRepository) {
    for (const c of list(state.planCritiques)) {
      if (!c?.date) continue;
      await planCritiqueRepository.upsert(c.date, c);
    }
  }
  return {};
}

/* ------------------------------------------------------------------ */
/* Assembly                                                             */
/* ------------------------------------------------------------------ */

export function buildAnalysisGraph({ llm, insightRepository, planCritiqueRepository } = {}) {
  const deps = { llm, insightRepository, planCritiqueRepository };

  const graph = new StateGraph(AnalysisState)
    .addNode('loadContext', (s) => loadContext(s))
    .addNode('computeMetrics', (s) => computeMetrics(s))
    .addNode('detectPatterns', (s) => detectPatterns(s, deps))
    .addNode('critique', (s) => critique(s, deps))
    .addNode('coach', (s) => coach(s, deps))
    .addNode('critiquePlans', (s) => critiquePlans(s, deps))
    .addNode('validate', (s) => validate(s))
    .addNode('render', (s) => render(s))
    .addNode('persist', (s) => persist(s, deps))
    .addNode('insufficientData', () => ({}))

    .addEdge(START, 'loadContext')
    .addConditionalEdges('loadContext', (s) => (s.insufficient ? 'insufficientData' : 'computeMetrics'), {
      computeMetrics: 'computeMetrics',
      insufficientData: 'insufficientData',
    })
    .addEdge('computeMetrics', 'detectPatterns')
    .addEdge('detectPatterns', 'critique')
    .addEdge('critique', 'coach')
    .addEdge('coach', 'critiquePlans')
    .addEdge('critiquePlans', 'validate')

    .addConditionalEdges('validate', needsRegeneration, {
      regenerate: 'critique',
      done: 'render',
    })

    .addEdge('render', 'persist')
    .addEdge('persist', END)
    .addEdge('insufficientData', END)

    .compile({ checkpointer: new MemorySaver() });

  return graph;
}