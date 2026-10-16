/**
 * ReflectionQualityGraph — LangGraph pipeline for per-day reflection quality.
 *
 * Separate from the main analysis graph because:
 *   - Different trigger: post-save (per-day) vs. monthly batch
 *   - Different latency budget: < 5s vs. < 20s
 *   - Different prompt: 5 specific questions vs. whole-month narrative
 *
 * Shape:
 *   START -> loadEntry -> prepareEvidence -> checkQuality -> validate -> render -> END
 *
 * The LLM handles subjective judgment (is "studied" vague? yes). The
 * validate node is a pure function that drops fields scoring below
 * a threshold — same pattern as the main graph's evidence validator.
 */

import { StateGraph, Annotation, START, END, MemorySaver } from '@langchain/langgraph';
import { checkReflectionQuality } from '../../../domain/services/ReflectionQualityChecker.js';
import { SCHEMAS } from '../schemas.js';
import { reflectionQualityPrompt } from '../prompts.js';
import {
  buildReflectionEvidence,
  renderReflectionEvidence,
  validateReflectionCoaching,
  buildDeterministicReflectionCoaching,
} from '../../../domain/services/ReflectionCoaching.js';

const list = (v) => v ?? [];
const REFLECTION_FIELD_IDS = new Set(['floorHit', 'accomplished', 'blockers', 'planBend', 'tomorrowChange']);

export const ReflectionQualityState = Annotation.Root({
  date: Annotation(),
  entry: Annotation({ default: () => null }),
  history: Annotation({ default: () => [] }),
  evidence: Annotation({ default: () => null }),

  /** LLM output: per-field quality scores. */
  fieldResults: Annotation({ default: () => [] }),
  overallScore: Annotation({ default: () => 0 }),
  vagueCount: Annotation({ default: () => 0 }),
  isComplete: Annotation({ default: () => true }),
  summary: Annotation({ default: () => '' }),
  coachingRaw: Annotation({ default: () => null }),
  coaching: Annotation({ default: () => null }),
  analysisStatus: Annotation({ default: () => 'fallback' }),
  aiSucceeded: Annotation({ default: () => false }),
  model: Annotation({ default: () => null }),
  fellBack: Annotation({ default: () => false }),
  tokens: Annotation({ default: () => 0 }),
  costCredits: Annotation({ default: () => 0 }),

  /** Pure-function validation: drops fields below threshold. */
  validatedFields: Annotation({ default: () => [] }),
  droppedFields: Annotation({ default: () => [] }),

  /** Client-facing bundle. */
  report: Annotation({ default: () => null }),

  errors: Annotation({ reducer: (a, b) => (a ?? []).concat(b ?? []), default: () => [] }),
});

/* ------------------------------------------------------------------ */
/* Nodes                                                                */
/* ------------------------------------------------------------------ */

function loadEntry(state) {
  if (!state.entry) {
    return { errors: ['No entry found for this date'], entryMissing: true };
  }
  return {};
}

function prepareEvidence(state) {
  return { evidence: buildReflectionEvidence({ entry: state.entry, history: state.history }) };
}

async function checkQuality(state, { llm }) {
  try {
    const res = await llm.structured({
      task: 'reflectionQuality',
      system: 'You are a strict study reflection quality reviewer. You score daily reflections for specificity and completeness.',
      prompt: reflectionQualityPrompt({
        date: state.date,
        entry: state.entry,
        evidenceText: renderReflectionEvidence(state.evidence),
      }),
      schema: SCHEMAS.reflectionQuality,
      temperature: 0.2,
    });
    return {
      fieldResults: Array.isArray(res.data?.fields) ? res.data.fields : [],
      overallScore: Number.isFinite(res.data?.overallScore) ? res.data.overallScore : 0,
      vagueCount: Number.isInteger(res.data?.vagueCount) ? res.data.vagueCount : 0,
      isComplete: res.data?.isComplete === true,
      summary: typeof res.data?.summary === 'string' ? res.data.summary : '',
      coachingRaw: res.data,
      aiSucceeded: true,
      model: res.model ?? null,
      fellBack: Boolean(res.fellBack),
      tokens: res.tokens ?? 0,
      costCredits: res.cost ?? 0,
    };
  } catch (e) {
    return { errors: [`checkQuality failed: ${e.message}`] };
  }
}

/**
 * Pure validation — no LLM. Drops fields scoring below 3 (too vague
 * to be useful for pattern analysis). Also runs the mechanical checker
 * as a cross-check: if the LLM and the mechanical checker disagree,
 * the mechanical result wins (it's deterministic).
 */
function validate(state) {
  const llmFields = list(state.fieldResults).filter((field) => {
    const score = field?.score;
    return REFLECTION_FIELD_IDS.has(field?.fieldId)
      && Number.isInteger(score)
      && score >= 0
      && score <= 10;
  });
  const mechanical = checkReflectionQuality(state.entry);

  // Merge: use mechanical scores as the floor. If the LLM scored higher,
  // trust the LLM (it caught nuance). If the LLM scored lower, trust
  // the mechanical result (it caught obvious vagueness).
  const merged = mechanical.fields.map((mechField) => {
    const llmField = llmFields.find((f) => f.fieldId === mechField.fieldId);
    if (!llmField) return mechField;

    // Take the lower score — be conservative about quality
    const score = Math.min(mechField.score, llmField.score);
    return {
      ...mechField,
      score,
      isVague: score < 4,
      reason: typeof llmField.reason === 'string' && llmField.reason.trim() ? llmField.reason : mechField.reason,
      suggestion: typeof llmField.suggestion === 'string' && llmField.suggestion.trim()
        ? llmField.suggestion
        : mechField.suggestion,
    };
  });

  const droppedFields = merged.filter((f) => f.score < 3);
  const validatedFields = merged.filter((f) => f.score >= 3);

  const overallScore = merged.length
    ? Math.round(merged.reduce((s, f) => s + f.score, 0) / merged.length)
    : 0;
  const vagueCount = merged.filter((f) => f.isVague).length;
  const isComplete = merged.every((f) => f.score > 0);
  const deterministic = buildDeterministicReflectionCoaching({
    evidence: state.evidence,
    quality: { fields: merged, vagueCount },
  });
  const checkedCoaching = validateReflectionCoaching(state.coachingRaw ?? {}, state.evidence ?? {});
  const coaching = {
    observations: checkedCoaching.observations.length ? checkedCoaching.observations : deterministic.observations,
    interpretations: checkedCoaching.interpretations.length ? checkedCoaching.interpretations : deterministic.interpretations,
    mainBottleneck: checkedCoaching.mainBottleneck ?? deterministic.mainBottleneck,
    recommendations: checkedCoaching.recommendations.length ? checkedCoaching.recommendations : deterministic.recommendations,
    followUpMeasure: checkedCoaching.followUpMeasure ?? deterministic.followUpMeasure,
    confidence: state.aiSucceeded ? checkedCoaching.confidence : deterministic.confidence,
    rejectedCount: checkedCoaching.rejectedCount,
  };
  const followUpQuestions = buildFollowUpQuestions(merged.filter((f) => f.score >= 3), merged.filter((f) => f.score < 3));

  return {
    validatedFields,
    droppedFields,
    overallScore,
    vagueCount,
    isComplete,
    coaching,
    analysisStatus: state.aiSucceeded ? (followUpQuestions.length ? 'needs_clarification' : 'complete') : 'fallback',
  };
}

function render(state) {
  const fields = list(state.validatedFields);
  const dropped = list(state.droppedFields);

  const report = {
    date: state.date,
    overallScore: state.overallScore,
    vagueCount: state.vagueCount,
    isComplete: state.isComplete,
    summary: state.summary,
    fields: fields.map((f) => ({
      fieldId: f.fieldId,
      score: f.score,
      isVague: f.isVague,
      reason: f.reason,
      suggestion: f.suggestion,
    })),
    droppedFields: dropped.map((f) => ({
      fieldId: f.fieldId,
      score: f.score,
      reason: f.reason,
      suggestion: f.suggestion,
    })),
    followUpQuestions: buildFollowUpQuestions(fields, dropped),
    status: state.analysisStatus,
    observations: state.coaching?.observations ?? [],
    interpretations: state.coaching?.interpretations ?? [],
    mainBottleneck: state.coaching?.mainBottleneck ?? null,
    recommendations: state.coaching?.recommendations ?? [],
    followUpMeasure: state.coaching?.followUpMeasure ?? null,
    confidence: state.coaching?.confidence ?? 'low',
    coachingRejectedCount: state.coaching?.rejectedCount ?? 0,
    metadata: {
      model: state.model,
      fellBack: state.fellBack,
      tokens: state.tokens,
      costCredits: Number((state.costCredits ?? 0).toFixed(6)),
    },
  };

  return { report };
}

/**
 * Build minimal follow-up questions for vague or missing answers.
 * Max 2 — the goal is to prompt, not to overwhelm.
 */
function buildFollowUpQuestions(fields, dropped) {
  const followUps = [];
  const choices = {
    blockers: ['Phone or social media', 'Discord or messages', 'Low energy', 'Task difficulty', 'Unclear next step', 'Unexpected work'],
    planBend: ['Started late', 'Task was too large', 'Priority changed', 'Did not know the next step', 'Unexpected work'],
    accomplished: ['Finished a planned task', 'Built something', 'Practised a skill', 'Nothing concrete today'],
    tomorrowChange: ['Start with a 25-minute block', 'Choose fewer priorities', 'Put the phone away', 'Define the first small step'],
    floorHit: ['Yes — completed the minimum', 'No — below the minimum', 'Not sure yet'],
  };

  for (const f of [...dropped, ...fields.filter((f) => f.isVague)]) {
    if (followUps.length >= 2) break;
    if (f.suggestion) {
      followUps.push({
        fieldId: f.fieldId,
        question: f.suggestion,
        choices: choices[f.fieldId] ?? [],
      });
    }
  }

  return followUps;
}

/**
 * Build a useful report without an AI provider. This keeps the quality screen available during
 * provider outages and makes the deterministic checks useful on their own.
 */
export function buildMechanicalReflectionQualityReport({ date, entry, history = [], warning = null } = {}) {
  const checked = checkReflectionQuality(entry);
  const droppedFields = checked.fields.filter((f) => f.score < 3);
  const fields = checked.fields.filter((f) => f.score >= 3);
  const evidence = buildReflectionEvidence({ entry, history });
  const coaching = buildDeterministicReflectionCoaching({ evidence, quality: checked });

  return {
    date,
    overallScore: checked.overallScore,
    vagueCount: checked.vagueCount,
    isComplete: checked.isComplete,
    summary: warning ?? 'Quality scored using deterministic checks because AI review is unavailable.',
    fields,
    droppedFields,
    followUpQuestions: buildFollowUpQuestions(fields, droppedFields),
    status: 'fallback',
    observations: coaching.observations,
    interpretations: coaching.interpretations,
    mainBottleneck: coaching.mainBottleneck,
    recommendations: coaching.recommendations,
    followUpMeasure: coaching.followUpMeasure,
    confidence: coaching.confidence,
    coachingRejectedCount: 0,
    metadata: { model: null, fellBack: true, tokens: 0, costCredits: 0 },
  };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                             */
/* ------------------------------------------------------------------ */

export function buildReflectionQualityGraph({ llm } = {}) {
  const deps = { llm };

  const graph = new StateGraph(ReflectionQualityState)
    .addNode('loadEntry', (s) => loadEntry(s))
    .addNode('prepareEvidence', (s) => prepareEvidence(s))
    .addNode('checkQuality', (s) => checkQuality(s, deps))
    .addNode('validate', (s) => validate(s))
    .addNode('render', (s) => render(s))

    .addEdge(START, 'loadEntry')
    .addConditionalEdges('loadEntry', (s) => (!s.entry ? 'end' : 'prepareEvidence'), {
      prepareEvidence: 'prepareEvidence',
      end: END,
    })
    .addEdge('prepareEvidence', 'checkQuality')
    .addEdge('checkQuality', 'validate')
    .addEdge('validate', 'render')
    .addEdge('render', END)

    .compile({ checkpointer: new MemorySaver() });

  return graph;
}

export default buildReflectionQualityGraph;
