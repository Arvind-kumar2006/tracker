/** Pure daily-plan shaping and validation for the mobile planner. */

export const MAX_DAILY_PRIORITIES = 3;
export const PLAN_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];

export function emptyTask(index = 0) {
  return {
    id: `new-${index + 1}`,
    text: '',
    outcome: '',
    estimatedMinutes: '30',
    priority: index === 0 ? 'HIGH' : 'MEDIUM',
  };
}

export function emptyDailyPlan() {
  return {
    items: [emptyTask(0)],
    minimumMinutes: '30',
    idealMinutes: '120',
    breakMinutes: '15',
    bufferMinutes: '15',
    availableMinutes: '0',
  };
}

const minutes = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

export function planToPayload(form) {
  return {
    items: (form.items ?? []).filter((item) => item.text.trim()).map((item) => ({
      id: item.id,
      text: item.text.trim(),
      outcome: item.outcome.trim(),
      estimatedMinutes: minutes(item.estimatedMinutes),
      priority: item.priority,
      status: item.status ?? 'PLANNED',
      actualMinutes: minutes(item.actualMinutes),
    })),
    minimumMinutes: minutes(form.minimumMinutes),
    idealMinutes: minutes(form.idealMinutes),
    breakMinutes: minutes(form.breakMinutes),
    bufferMinutes: minutes(form.bufferMinutes),
    availableMinutes: minutes(form.availableMinutes),
  };
}

export function planToForm(plan) {
  const items = (plan?.items ?? []).slice(0, MAX_DAILY_PRIORITIES).map((item) => ({
    id: item.id ?? `saved-${item.n}`,
    text: item.text ?? '',
    outcome: item.outcome ?? '',
    estimatedMinutes: String(item.estimatedMinutes ?? 30),
    priority: PLAN_PRIORITIES.includes(item.priority) ? item.priority : 'MEDIUM',
    status: item.status ?? 'PLANNED',
    actualMinutes: item.actualMinutes ?? 0,
  }));

  return {
    items: items.length ? items : [emptyTask(0)],
    minimumMinutes: String(plan?.minimumMinutes ?? 30),
    idealMinutes: String(plan?.idealMinutes ?? (plan?.declaredHours ? plan.declaredHours * 60 : 120)),
    breakMinutes: String(plan?.breakMinutes ?? 15),
    bufferMinutes: String(plan?.bufferMinutes ?? 15),
    availableMinutes: String(plan?.availableMinutes ?? 0),
  };
}

const VAGUE_TASK = /^(study|learn|work|work on|do|practice|read|watch|prepare|research|revise)(\s+\w+)?[.!?]?$/i;
const CONCRETE_SIGNAL = /\b(\d+|complete|finish|build|write|solve|submit|implement|draft|test|commit|summari[sz]e|flashcards?|pages?|problems?|questions?|functions?|chapters?)\b/i;

export function reviewPlan(form) {
  const warnings = [];
  const tasks = (form.items ?? []).filter((item) => item.text.trim());

  for (const item of tasks) {
    if (!item.outcome.trim()) warnings.push({ code: 'MISSING_OUTCOME', itemId: item.id, message: `${item.text.trim()} needs a concrete outcome.` });
    if (VAGUE_TASK.test(item.text.trim()) || (!CONCRETE_SIGNAL.test(item.text) && item.text.trim().length < 18)) {
      warnings.push({ code: 'VAGUE_TASK', itemId: item.id, message: `${item.text.trim()} is too vague to verify later.` });
    }
  }

  const focusedMinutes = tasks.reduce((sum, item) => sum + minutes(item.estimatedMinutes), 0);
  const scheduledMinutes = focusedMinutes + minutes(form.breakMinutes) + minutes(form.bufferMinutes);
  const availableMinutes = minutes(form.availableMinutes);

  if (availableMinutes > 0 && scheduledMinutes > availableMinutes) {
    warnings.push({ code: 'SCHEDULE_OVERLOAD', message: `The plan needs ${scheduledMinutes} minutes but only ${availableMinutes} are available.` });
  }
  if (focusedMinutes > 120 && minutes(form.breakMinutes) === 0) {
    warnings.push({ code: 'NO_BREAKS', message: 'Add break time for a plan longer than two focused hours.' });
  }
  return { warnings, focusedMinutes, scheduledMinutes };
}

