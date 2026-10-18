export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const weekStartForDate = (value = today()) => {
  const date = new Date(`${value}T12:00:00`);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const weekEndForStart = (value) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 6);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const weekNumberOfMonth = (value) => Math.floor((Number(String(value).slice(-2)) - 1) / 7) + 1;

export const emptyWeeklyPlan = (weekStart = weekStartForDate()) => ({
  weekStart,
  weekEnd: weekEndForStart(weekStart),
  weekNumber: weekNumberOfMonth(weekStart),
  answers: {
    reviewLastWeek: '', blockers: '', plannedChange: '', successOutcomes: '',
    deliverables: '', fixedCommitments: '', fitAssessment: '',
  },
  outcomes: [],
  commitments: [],
  dailyBlocks: [],
  extractedObstacles: [],
  plannedChange: '',
  unclearSections: [],
  confidence: 'low',
});

export const planFromRecord = (record, weekStart) => {
  const empty = emptyWeeklyPlan(weekStart);
  return {
    ...empty,
    ...record,
    weekStart: record?.weekStart ?? weekStart,
    weekEnd: record?.weekEnd ?? empty.weekEnd,
    answers: { ...empty.answers, ...(record?.answers ?? {}) },
    outcomes: Array.isArray(record?.outcomes) ? record.outcomes : [],
    commitments: Array.isArray(record?.commitments) ? record.commitments : [],
    dailyBlocks: Array.isArray(record?.dailyBlocks) ? record.dailyBlocks : [],
    extractedObstacles: Array.isArray(record?.extractedObstacles) ? record.extractedObstacles : [],
  };
};
