/**
 * ReflectionQualityGraph — LangGraph pipeline for per-day reflection quality.
 *
 * Separate from the main analysis graph because:
 *   - Different trigger: post-save (per-day) vs. monthly batch
 *   - Different latency budget: < 5s vs. < 20s
 *   - Different prompt: 5 specific questions vs. whole-month narrative
 *
 * Shape:
 *   START -> loadEntry -> checkQuality -> validate -> render -> END
 *
 * The LLM handles subjective judgment (is "studied" vague? yes). The
 * validate node is a pure function that drops fields scoring below
 * a threshold — same pattern as the main graph's evidence validator.
 */

import { StateGraph, Annotation, START, END, MemorySaver } from '@langchain/langgraph';
import { checkReflectionQuality } from '../../../domain/services/ReflectionQualityChecker.js';
import { SCHEMAS } from '../schemas.js';
import { reflectionQualityPrompt } from '../prompts.js';

const list = (v) => v ?? [];

export const ReflectionQualityState = Annotation.Root({
  date: Annotation(),
  entry: Annotation({ default: () => null }),

  /** LLM output: per-field quality scores. */
  fieldResults: Annotation({ default: () => [] }),
  overallScore: Annotation({ default: () => 0 }),
  vagueCount: Annotation({ default: () => 0 }),
  isComplete: Annotation({ default: () => true }),
  summary: Annotation({ default: () => '' }),

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

async function checkQuality(state, { llm }) {
  try {
    const res = await llm.structured({
      task: 'reflectionQuality',
      system: 'You are a strict study reflection quality reviewer. You score daily reflections for specificity and completeness.',
      prompt: reflectionQualityPrompt({ date: state.date, entry: state.entry }),
      schema: SCHEMAS.reflectionQuality,
      temperature: 0.2,
    });
    return {
      fieldResults: res.data.fields ?? [],
      overallScore: res.data.overallScore ?? 0,
      vagueCount: res.data.vagueCount ?? 0,
      isComplete: res.data.isComplete ?? false,
      summary: res.data.summary ?? '',
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
  const llmFields = list(state.fieldResults);
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
      reason: llmField.reason || mechField.reason,
      suggestion: llmField.suggestion || mechField.suggestion,
    };
  });

  const droppedFields = merged.filter((f) => f.score < 3);
  const validatedFields = merged.filter((f) => f.score >= 3);

  const overallScore = merged.length
    ? Math.round(merged.reduce((s, f) => s + f.score, 0) / merged.length)
    : 0;
  const vagueCount = merged.filter((f) => f.isVague).length;
  const isComplete = merged.every((f) => f.score > 0);

  return {
    validatedFields,
    droppedFields,
    overallScore,
    vagueCount,
    isComplete,
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
  };

  return { report };
}

/**
 * Build minimal follow-up questions for vague or missing answers.
 * Max 3 — the goal is to prompt, not to overwhelm.
 */
function buildFollowUpQuestions(fields, dropped) {
  const followUps = [];

  for (const f of [...dropped, ...fields.filter((f) => f.isVague)]) {
    if (followUps.length >= 3) break;
    if (f.suggestion) {
      followUps.push({
        fieldId: f.fieldId,
        question: f.suggestion,
      });
    }
  }

  return followUps;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                             */
/* ------------------------------------------------------------------ */

export function buildReflectionQualityGraph({ llm } = {}) {
  const deps = { llm };

  const graph = new StateGraph(ReflectionQualityState)
    .addNode('loadEntry', (s) => loadEntry(s))
    .addNode('checkQuality', (s) => checkQuality(s, deps))
    .addNode('validate', (s) => validate(s))
    .addNode('render', (s) => render(s))

    .addEdge(START, 'loadEntry')
    .addConditionalEdges('loadEntry', (s) => (!s.entry ? 'end' : 'checkQuality'), {
      checkQuality: 'checkQuality',
      end: END,
    })
    .addEdge('checkQuality', 'validate')
    .addEdge('validate', 'render')
    .addEdge('render', END)

    .compile({ checkpointer: new MemorySaver() });

  return graph;
}

export default buildReflectionQualityGraph;
