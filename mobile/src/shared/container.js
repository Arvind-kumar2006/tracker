/** Small DI container for the two daily screens. */

import { createApiClient } from '../infrastructure/apiClient.js';

const api = createApiClient();

export const container = {
  api,
  loadDay: (date) => api.getDay(date),
  loadReflectionCoach: (date) => api.getReflectionCoach(date),
  loadSheetsStatus: () => api.getSheetsStatus(),
  saveDailyPlan: (date, plan) => api.saveDailyPlan(date, plan),
  saveDailyEntry: async ({ date, accomplished, buildNote, blockers, buildOutcome, targetMet, plannedHours, floorHit, floorHitReason, planBend, tomorrowChange }) =>
    api.saveDailyEntry({ date, accomplished, buildNote, blockers, buildOutcome, targetMet, plannedHours, floorHit, floorHitReason, planBend, tomorrowChange }),
};

export default container;
