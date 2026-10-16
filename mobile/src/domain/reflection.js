/**
 * Reflection domain — pure, zero imports.
 *
 * The 5 questions, their mapping to API fields, and the view-model
 * for the quality report. Testable in plain node.
 */

export const REFLECTION_QUESTIONS = [
  {
    id: 'floorHit',
    shortLabel: 'Did',
    question: 'What did I plan, and what did I actually complete?',
    description: "Floor hit means the day counts, even if the target wasn't reached.",
    type: 'boolean-reason',
    fields: ['floorHit', 'floorHitReason'],
    placeholder: 'e.g., "Yes — finished the RAG module even though I planned 4 hours" or "No — only studied 30 minutes"',
    hint: 'Write yes or no, plus one line on why.',
  },
  {
    id: 'accomplished',
    shortLabel: 'Win',
    question: 'What went well today, even something small?',
    description: '"Nothing" is an acceptable answer, and it\'s still useful, because it tells you whether you built or only watched.',
    type: 'text',
    fields: ['accomplished'],
    placeholder: 'e.g., "Completed LangChain module 3 on RAG prompting" or "Nothing built today"',
    hint: 'Be specific. "studied" is useless. "Completed module 3" is evidence.',
  },
  {
    id: 'blockers',
    shortLabel: 'Avoids',
    question: 'What distracted me or made work difficult?',
    description: 'It\'s a fact you can act on, not a regret to feel bad about.',
    type: 'text',
    fields: ['blockers'],
    placeholder: 'e.g., "Avoided phone scrolling — kept it in another room" or "Avoided coding, watched lectures instead"',
    hint: 'Name what you avoided AND what you did instead.',
  },
  {
    id: 'planBend',
    shortLabel: 'Roadblock',
    question: 'Why did I delay, avoid, or abandon a task?',
    description: 'Over the weeks, the goal is to catch the bend earlier.',
    type: 'text',
    fields: ['planBend'],
    placeholder: 'e.g., "Plan said start at 7pm, actually started at 9:30 — noticed at 10pm" or "Plan held all day"',
    hint: 'Where exactly did the plan first bend? Did you notice then or only later?',
  },
  {
    id: 'tomorrowChange',
    shortLabel: 'One thing',
    question: "What's the first small action tomorrow starts with?",
    description: "Decide it tonight, so morning-you doesn't have to plan.",
    type: 'text',
    fields: ['tomorrowChange'],
    placeholder: 'e.g., "Open VS Code and write the first function signature" or "Start by 7pm, phone in drawer"',
    hint: 'One concrete action. "Study more" is worthless. "Open the doc and write the first line" is a start.',
  },
];

/**
 * Build the initial empty form state for the reflection.
 */
export function emptyReflectionForm() {
  return {
    floorHit: null,
    floorHitReason: '',
    accomplished: '',
    blockers: '',
    planBend: '',
    tomorrowChange: '',
  };
}

/**
 * Convert form state to API payload.
 */
export function formToPayload(form) {
  return {
    floorHit: form.floorHit,
    floorHitReason: form.floorHitReason || null,
    accomplished: form.accomplished || null,
    blockers: form.blockers || null,
    planBend: form.planBend || null,
    tomorrowChange: form.tomorrowChange || null,
  };
}

/**
 * Convert API entry to form state (for editing).
 */
export function entryToForm(entry) {
  const blockers = entry?.blockers && typeof entry.blockers === 'object'
    ? entry.blockers.raw ?? entry.blockers.segments?.join('\n') ?? ''
    : entry?.blockers ?? '';
  return {
    floorHit: entry?.floorHit ?? null,
    floorHitReason: entry?.floorHitReason ?? '',
    accomplished: entry?.accomplished ?? '',
    blockers,
    planBend: entry?.planBend ?? '',
    tomorrowChange: entry?.tomorrowChange ?? '',
  };
}

/**
 * Build a view-model for the quality report.
 */
export function buildQualityViewModel(report) {
  if (!report) return null;

  const tone = report.overallScore >= 7 ? 'positive' : report.overallScore >= 4 ? 'warning' : 'negative';

  return {
    date: report.date,
    overallScore: report.overallScore,
    tone,
    summary: report.summary,
    isComplete: report.isComplete,
    vagueCount: report.vagueCount,
    fields: (report.fields ?? []).map((f) => ({
      ...f,
      scoreTone: f.score >= 7 ? 'positive' : f.score >= 4 ? 'warning' : 'negative',
    })),
    droppedFields: report.droppedFields ?? [],
    followUpQuestions: report.followUpQuestions ?? [],
    status: report.status ?? (report.qualitySource === 'mechanical' ? 'fallback' : 'complete'),
    qualitySource: report.qualitySource ?? 'unknown',
    observations: report.observations ?? [],
    interpretations: report.interpretations ?? [],
    mainBottleneck: report.mainBottleneck ?? null,
    recommendations: report.recommendations ?? [],
    followUpMeasure: report.followUpMeasure ?? null,
    confidence: report.confidence ?? 'low',
    metadata: report.metadata ?? {},
  };
}

export default REFLECTION_QUESTIONS;
