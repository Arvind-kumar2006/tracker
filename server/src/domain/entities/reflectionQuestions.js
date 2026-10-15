/**
 * ReflectionQuestions — the 5-question daily reflection (Phase 7).
 *
 * Pure constant, zero imports — testable anywhere.
 *
 * Each question maps to specific Mongo fields on the day entry:
 *
 *   Q1 (Did)       → floorHit (bool) + floorHitReason (string)
 *   Q2 (Win)       → accomplished (string)
 *   Q3 (Avoids)    → blockers (string)
 *   Q4 (Roadblock) → planBend (string)  [NEW field]
 *   Q5 (One thing) → tomorrowChange (string)
 *
 * The questions are intentionally specific. "Did I hit my floor" forces a
 * binary answer plus a reason. "Where did the plan first bend" forces
 * metacognitive awareness of plan deviation. "What did I avoid and what did
 * I do instead" turns a regret into a fact.
 */

export const REFLECTION_QUESTIONS = [
  {
    id: 'floorHit',
    shortLabel: 'Did',
    question: 'Did I hit my floor today?',
    description: 'Floor hit means the day counts, even if the target wasn\'t reached.',
    type: 'boolean-reason',
    fields: ['floorHit', 'floorHitReason'],
    placeholder: 'e.g., "Yes — finished the RAG module even though I planned 4 hours" or "No — only studied 30 minutes"',
    hint: 'Write yes or no, plus one line on why.',
  },
  {
    id: 'accomplished',
    shortLabel: 'Win',
    question: 'What did I build or finish, even something small?',
    description: '"Nothing" is an acceptable answer, and it\'s still useful, because it tells you whether you built or only watched.',
    type: 'text',
    fields: ['accomplished'],
    placeholder: 'e.g., "Completed LangChain module 3 on RAG prompting" or "Nothing built today"',
    hint: 'Be specific. "studied" is useless. "Completed module 3" is evidence.',
  },
  {
    id: 'blockers',
    shortLabel: 'Avoids',
    question: 'What did I avoid today, and what did I do instead?',
    description: 'It\'s a fact you can act on, not a regret to feel bad about.',
    type: 'text',
    fields: ['blockers'],
    placeholder: 'e.g., "Avoided phone scrolling — kept it in another room" or "Avoided coding, watched lectures instead"',
    hint: 'Name what you avoided AND what you did instead.',
  },
  {
    id: 'planBend',
    shortLabel: 'Roadblock',
    question: 'Where did the plan first bend, and did I notice it then or only later?',
    description: 'Over the weeks, the goal is to catch the bend earlier.',
    type: 'text',
    fields: ['planBend'],
    placeholder: 'e.g., "Plan said start at 7pm, actually started at 9:30 — noticed at 10pm" or "Plan held all day"',
    hint: 'Where exactly did the plan first bend? Did you notice then or only later?',
  },
  {
    id: 'tomorrowChange',
    shortLabel: 'One thing',
    question: 'What\'s the first small action tomorrow starts with?',
    description: 'Decide it tonight, so morning-you doesn\'t have to plan.',
    type: 'text',
    fields: ['tomorrowChange'],
    placeholder: 'e.g., "Open VS Code and write the first function signature" or "Start by 7pm, phone in drawer"',
    hint: 'One concrete action. "Study more" is worthless. "Open the doc and write the first line" is a start.',
  },
];

export const REFLECTION_QUESTION_IDS = REFLECTION_QUESTIONS.map((q) => q.id);

/** Field names that the reflection writes to a day entry. */
export const REFLECTION_WRITTEN_FIELDS = [
  'floorHit',
  'floorHitReason',
  'accomplished',
  'blockers',
  'planBend',
  'tomorrowChange',
];

export default REFLECTION_QUESTIONS;
