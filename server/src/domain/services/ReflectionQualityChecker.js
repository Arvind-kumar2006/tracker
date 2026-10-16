/**
 * ReflectionQualityChecker — pure function, no LLM, no I/O.
 *
 * Scores a day's reflection for completeness and specificity. The LLM
 * in the reflection quality graph handles nuance; this function handles
 * the mechanical checks that don't need a model:
 *
 *   - Is the answer present at all?
 *   - Is it long enough to be meaningful?
 *   - Does it contain at least one concrete detail (a number, a named
 *     entity, a time, a specific action)?
 *
 * The LLM handles the subjective judgment: "studied" is vague, "completed
 * module 3 on RAG" is specific. This function just catches the obvious.
 */

const MIN_MEANINGFUL_LENGTH = 10;

/** Reflection answers are strings in mobile payloads and structured blocker objects in Mongo. */
export function reflectionAnswerText(value) {
  if (value && typeof value === 'object') {
    if (value.raw !== undefined) return String(value.raw ?? '').trim();
    if (Array.isArray(value.segments)) return value.segments.join(' ').trim();
    if (value.text !== undefined) return String(value.text ?? '').trim();
    return '';
  }
  return String(value ?? '').trim();
}

const VAGUE_ONLY_PATTERN = /^(studied|did some work|worked|read|watched|nothing|none|n\/?a|na|idk|dunno|skip|skipped|same as usual|nothing much|not much|some|a bit|little|few things|stuff|things|ok|okay|fine|alright|decent|good|nice|great|bad|meh|whatever)$/i;

const CONCRETE_DETAIL_PATTERNS = [
  /\d/,
  /\b(pm|am|o'?clock|hour|minute|min|hrs?|mins?)\b/i,
  /\b(module|chapter|section|page|exercise|problem|project|function|class|method|api|test|commit|issue|ticket|email|call|meeting|lecture|video|tutorial|course|lesson|topic|concept|algorithm|model|code|app|feature|bug|fix|deploy|build|finish|complete|start|end|submit|review|practice|revise|note|summary|plan|goal|target|deadline|exam|quiz|assignment|lab|report|essay|presentation)\b/i,
];

/**
 * Check a single reflection field.
 *
 * @param {string} fieldId - one of: floorHit, accomplished, blockers, planBend, tomorrowChange
 * @param {string} text - the user's answer
 * @param {boolean} [boolValue] - for floorHit: the yes/no answer
 * @returns {{fieldId: string, score: number, isVague: boolean, reason: string, suggestion: string}}
 */
export function checkFieldQuality(fieldId, text, boolValue) {
  const trimmed = reflectionAnswerText(text);

  if (fieldId === 'floorHit') {
    if (boolValue === null || boolValue === undefined) {
      return {
        fieldId, score: 0, isVague: true,
        reason: 'No yes/no answer given.',
        suggestion: 'Answer yes or no — did the day count?',
      };
    }
    if (trimmed.length < 5) {
      return {
        fieldId, score: 3, isVague: true,
        reason: 'Yes/no given but no reason.',
        suggestion: 'Add one line on why the floor was or wasn\'t hit.',
      };
    }
    if (trimmed.length < MIN_MEANINGFUL_LENGTH) {
      return {
        fieldId, score: 5, isVague: true,
        reason: 'Reason is very short.',
        suggestion: 'Give a bit more detail — what made the day count or not?',
      };
    }
    return {
      fieldId, score: 8, isVague: false,
      reason: 'Clear yes/no with a reason.',
      suggestion: null,
    };
  }

  if (trimmed.length === 0) {
    return {
      fieldId, score: 0, isVague: true,
      reason: 'Empty answer.',
      suggestion: 'This question is left blank. Even a short answer helps.',
    };
  }

  if (trimmed.length < 5) {
    return {
      fieldId, score: 2, isVague: true,
      reason: 'Too short to be useful.',
      suggestion: 'Give at least a sentence — what specifically happened?',
    };
  }

  if (VAGUE_ONLY_PATTERN.test(trimmed)) {
    return {
      fieldId, score: 2, isVague: true,
      reason: 'Vague answer with no concrete detail.',
      suggestion: 'Name a specific thing — what, where, when, or how much.',
    };
  }

  const hasDetail = CONCRETE_DETAIL_PATTERNS.some((p) => p.test(trimmed));
  if (!hasDetail) {
    return {
      fieldId, score: 5, isVague: true,
      reason: 'No concrete detail detected.',
      suggestion: 'Add a number, a name, a time, or a specific action.',
    };
  }

  if (trimmed.length < MIN_MEANINGFUL_LENGTH) {
    return {
      fieldId, score: 6, isVague: false,
      reason: 'Has some detail but could be more specific.',
      suggestion: 'Good start — add a bit more context.',
    };
  }

  return {
    fieldId, score: 8, isVague: false,
    reason: 'Specific and complete.',
    suggestion: null,
  };
}

/**
 * Check all 5 reflection fields at once.
 *
 * @param {object} entry - a day entry with reflection fields
 * @returns {{fields: Array, overallScore: number, vagueCount: number, isComplete: boolean}}
 */
export function checkReflectionQuality(entry) {
  const fields = [
    checkFieldQuality('floorHit', entry?.floorHitReason, entry?.floorHit),
    checkFieldQuality('accomplished', entry?.accomplished),
    checkFieldQuality('blockers', reflectionAnswerText(entry?.blockers)),
    checkFieldQuality('planBend', entry?.planBend),
    checkFieldQuality('tomorrowChange', entry?.tomorrowChange),
  ];

  const overallScore = Math.round(
    fields.reduce((sum, f) => sum + f.score, 0) / fields.length
  );
  const vagueCount = fields.filter((f) => f.isVague).length;
  const isComplete = fields.every((f) => f.score > 0);

  return { fields, overallScore, vagueCount, isComplete };
}

export default checkReflectionQuality;
