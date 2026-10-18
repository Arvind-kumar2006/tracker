/** Small DI container for the two daily screens. */

import { createApiClient } from '../infrastructure/apiClient.js';

const api = createApiClient();

export const container = {
  api,
  loadDay: (date) => api.getDay(date),
  loadReflectionCoach: (date) => api.getReflectionCoach(date),
  loadSheetsStatus: () => api.getSheetsStatus(),
  loadWeeklyStatus: (date) => api.getWeeklyStatus(date),
  loadWeeklyPlan: (weekStart) => api.getWeeklyPlan(weekStart),
  extractWeeklyPlan: (weekStart, image) => api.extractWeeklyPlan(weekStart, image),
  confirmWeeklyPlan: (weekStart, plan) => api.confirmWeeklyPlan(weekStart, plan),
  loadMonthlyStatus: (date) => api.getMonthlyStatus(date),
  loadMonthlyPlan: (month) => api.getMonthlyPlan(month),
  extractMonthlyPlan: (month, image) => api.extractMonthlyPlan(month, image),
  confirmMonthlyPlan: (month, plan) => api.confirmMonthlyPlan(month, plan),
  loadMonth: (month) => api.getMonth(month),
  saveMonthPlan: (month, plan) => api.saveMonthPlan(month, plan),
  saveDailyPlan: (date, plan) => api.saveDailyPlan(date, plan),
  saveDailyEntry: async ({ date, accomplished, buildNote, blockers, buildOutcome, targetMet, plannedHours, floorHit, floorHitReason, planBend, tomorrowChange }) =>
    api.saveDailyEntry({ date, accomplished, buildNote, blockers, buildOutcome, targetMet, plannedHours, floorHit, floorHitReason, planBend, tomorrowChange }),
};

export default container;
