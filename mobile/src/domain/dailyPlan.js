/** Pure daily-plan shaping and validation for the mobile planner. */

export const MAX_DAILY_PRIORITIES = 3;
export const PLAN_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
export const WORK_TYPES = ['Mid-sem', 'GenAI', 'Coding', 'English', 'Internship/OJT', 'Buffer', 'Other'];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normaliseTime(value) {
  const candidate = String(value ?? '').trim();
  return TIME_PATTERN.test(candidate) ? candidate : '';
}

export function durationBetween(startTime, endTime) {
  const start = normaliseTime(startTime);
  const end = normaliseTime(endTime);
  if (!start || !end) return 0;
  const toMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  const duration = endMinutes - startMinutes;
  return duration > 0 ? duration : duration < 0 ? duration + 24 * 60 : 0;
}

export function emptyTask(index = 0) {
  return {
    id: `new-${index + 1}`,
    text: '',
    outcome: '',
    estimatedMinutes: '30',
    priority: index === 0 ? 'HIGH' : 'MEDIUM',
    workType: 'Other',
    startTime: '',
    endTime: '',
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
      estimatedMinutes: durationBetween(item.startTime, item.endTime) || minutes(item.estimatedMinutes),
      priority: item.priority,
      status: item.status ?? 'PLANNED',
      actualMinutes: minutes(item.actualMinutes),
      workType: WORK_TYPES.includes(item.workType) ? item.workType : 'Other',
      ...(normaliseTime(item.startTime) ? { startTime: normaliseTime(item.startTime) } : {}),
      ...(normaliseTime(item.endTime) ? { endTime: normaliseTime(item.endTime) } : {}),
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
    workType: WORK_TYPES.includes(item.workType ?? item.type) ? (item.workType ?? item.type) : 'Other',
    startTime: normaliseTime(item.startTime ?? item.start),
    endTime: normaliseTime(item.endTime ?? item.end),
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

