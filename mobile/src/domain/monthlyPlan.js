export const ISO_MONTH = /^\d{4}-\d{2}$/;

export const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const currentMonth = (date = today()) => String(date).slice(0, 7);

export const monthName = (month) => {
  const date = new Date(`${month}-01T12:00:00`);
  return date.toLocaleString('en-US', { month: 'long' });
};

export const monthEnd = (month) => {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + 1, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const emptyMonthlyPlan = (month = currentMonth()) => ({
  month,
  monthName: monthName(month),
  year: Number(month.slice(0, 4)),
  monthEnd: monthEnd(month),
  weekCount: Math.ceil(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() / 7),
  answers: {
    reviewLastMonth: '', blockers: '', plannedChange: '', successOutcomes: '',
    deliverables: '', deadlinesCommitments: '', weeklyMilestones: '', fitAssessment: '',
  },
  outcomes: [],
  expectedDeliverables: '',
  majorDeadlines: [],
  fixedCommitments: [],
  weeklyMilestones: [],
  extractedObstacles: [],
  plannedChange: '',
  unclearSections: [],
  confidence: 'low',
});

export const planFromRecord = (record, month) => {
  const empty = emptyMonthlyPlan(month);
  return {
    ...empty,
    ...record,
    month: record?.month ?? month,
    monthName: record?.monthName ?? empty.monthName,
    monthEnd: record?.monthEnd ?? empty.monthEnd,
    answers: { ...empty.answers, ...(record?.answers ?? {}) },
    outcomes: Array.isArray(record?.outcomes) ? record.outcomes : [],
    majorDeadlines: Array.isArray(record?.majorDeadlines) ? record.majorDeadlines : [],
    fixedCommitments: Array.isArray(record?.fixedCommitments) ? record.fixedCommitments : [],
    weeklyMilestones: Array.isArray(record?.weeklyMilestones) ? record.weeklyMilestones : [],
    extractedObstacles: Array.isArray(record?.extractedObstacles) ? record.extractedObstacles : [],
  };
};
