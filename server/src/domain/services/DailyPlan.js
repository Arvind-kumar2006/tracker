import { DomainError, ErrorCode } from '../errors/DomainError.js';

export const MAX_DAILY_PRIORITIES = 3;
export const PLAN_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
export const PLAN_STATUSES = ['PLANNED', 'DONE', 'PARTIAL', 'MOVED'];

const MAX_TEXT = 400;
const clampText = (value) => String(value ?? '').trim().slice(0, MAX_TEXT);

function boundedMinutes(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1440, Math.round(number)));
}

function priority(value) {
  const candidate = String(value ?? '').trim().toUpperCase();
  return PLAN_PRIORITIES.includes(candidate) ? candidate : 'MEDIUM';
}

function status(value) {
  const candidate = String(value ?? '').trim().toUpperCase();
  return PLAN_STATUSES.includes(candidate) ? candidate : 'PLANNED';
}

/**
 * Convert mobile plan input into the canonical plan shape. Existing imported plans only have
 * `n` and `text`, so every new property remains optional and backward-compatible.
 */
export function buildDailyPlan({ date, input = {} } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
    throw new DomainError(ErrorCode.UNPARSEABLE_VALUE, `invalid date "${date}"`);
  }

  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length > MAX_DAILY_PRIORITIES) {
    throw new DomainError(
      ErrorCode.IMPOSSIBLE_RANGE,
      `A daily plan can contain at most ${MAX_DAILY_PRIORITIES} priorities.`
    );
  }

  const items = rawItems.map((raw, index) => {
    const text = clampText(raw?.text ?? raw?.task);
    if (!text) {
      throw new DomainError(ErrorCode.UNPARSEABLE_VALUE, `priority ${index + 1} needs a task.`);
    }

    const estimatedMinutes = boundedMinutes(raw?.estimatedMinutes, 30);
    if (estimatedMinutes < 5) {
      throw new DomainError(ErrorCode.IMPOSSIBLE_RANGE, `priority ${index + 1} needs at least 5 minutes.`);
    }

    return {
      id: clampText(raw?.id) || `${date}-${index + 1}`,
      n: index + 1,
      text,
      outcome: clampText(raw?.outcome),
      estimatedMinutes,
      actualMinutes: boundedMinutes(raw?.actualMinutes, 0),
      priority: priority(raw?.priority),
      status: status(raw?.status),
    };
  });

  const minimumMinutes = boundedMinutes(input.minimumMinutes, 0);
  const idealMinutes = boundedMinutes(input.idealMinutes, 0);
  const declaredHours = idealMinutes > 0
    ? Number((idealMinutes / 60).toFixed(2))
    : input.declaredHours === null || input.declaredHours === undefined || input.declaredHours === ''
      ? null
      : Number(input.declaredHours);

  return {
    items,
    summary: clampText(input.summary) || items.map((item) => item.text).join(' · ').slice(0, MAX_TEXT),
    declaredHours: Number.isFinite(declaredHours) ? declaredHours : null,
    minimumMinutes,
    idealMinutes,
    breakMinutes: boundedMinutes(input.breakMinutes, 0),
    bufferMinutes: boundedMinutes(input.bufferMinutes, 0),
    availableMinutes: boundedMinutes(input.availableMinutes, 0),
    isRepeat: Boolean(input.isRepeat),
    ...(input.repeatOf ? { repeatOf: clampText(input.repeatOf) } : {}),
  };
}

const VAGUE_TASK = /^(study|learn|work|work on|do|practice|read|watch|prepare|research|revise)(\s+\w+)?[.!?]?$/i;
const CONCRETE_SIGNAL = /\b(\d+|complete|finish|build|write|solve|submit|implement|draft|test|commit|summari[sz]e|flashcards?|pages?|problems?|questions?|functions?|chapters?)\b/i;

export function reviewDailyPlan(plan = {}) {
  const warnings = [];
  const items = Array.isArray(plan.items) ? plan.items : [];

  for (const item of items) {
    const task = String(item.text ?? '').trim();
    if (!String(item.outcome ?? '').trim()) {
      warnings.push({
        code: 'MISSING_OUTCOME',
        itemId: item.id,
        message: `"${task}" needs a concrete outcome.`,
        suggestion: 'Name the artifact, checkpoint, or observable result you will finish.',
      });
    }
    if (VAGUE_TASK.test(task) || (!CONCRETE_SIGNAL.test(task) && task.length < 18)) {
      warnings.push({
        code: 'VAGUE_TASK',
        itemId: item.id,
        message: `"${task}" is too vague to verify later.`,
        suggestion: 'Add a topic plus a quantity, artifact, or checkpoint.',
      });
    }
  }

  const focusedMinutes = items.reduce((sum, item) => sum + Number(item.estimatedMinutes ?? 0), 0);
  const scheduledMinutes = focusedMinutes + Number(plan.breakMinutes ?? 0) + Number(plan.bufferMinutes ?? 0);
  const availableMinutes = Number(plan.availableMinutes ?? 0);

  if (Number(plan.minimumMinutes ?? 0) > Number(plan.idealMinutes ?? 0) && Number(plan.idealMinutes ?? 0) > 0) {
    warnings.push({
      code: 'MINIMUM_ABOVE_IDEAL',
      message: 'The minimum target is greater than the ideal target.',
      suggestion: 'Make the minimum the smallest acceptable win and the ideal the stretch target.',
    });
  }
  if (availableMinutes > 0 && scheduledMinutes > availableMinutes) {
    warnings.push({
      code: 'SCHEDULE_OVERLOAD',
      message: `The plan needs ${scheduledMinutes} minutes but only ${availableMinutes} are available.`,
      suggestion: 'Shorten a task or move one priority; the app will not change it for you.',
    });
  }
  if (availableMinutes === 0 && scheduledMinutes > 600) {
    warnings.push({
      code: 'LONG_DAY',
      message: `The plan schedules ${scheduledMinutes} minutes, which is a very long focused day.`,
      suggestion: 'Add available time or reduce the plan before committing to it.',
    });
  }
  if (focusedMinutes > 120 && Number(plan.breakMinutes ?? 0) === 0) {
    warnings.push({
      code: 'NO_BREAKS',
      message: 'The plan has more than two hours of focus time but no break time.',
      suggestion: 'Add breaks so the schedule reflects real working conditions.',
    });
  }

  return {
    warnings,
    focusedMinutes,
    scheduledMinutes,
    isRealistic: !warnings.some((warning) => ['SCHEDULE_OVERLOAD', 'LONG_DAY', 'MINIMUM_ABOVE_IDEAL'].includes(warning.code)),
  };
}

