/**
 * DI container for the app. Wires infrastructure adapters to the application use cases.
 * Hand-rolled, no framework — matching the server.
 */

import { createApiClient } from '../infrastructure/apiClient.js';
import { createFileSystem } from '../infrastructure/fileSystem.js';
import {
  importWorkbooks, loadDashboard, runAnalysis, loadInsights, updateInsightStatus,
} from '../application/useCases.js';

const api = createApiClient();
const fileSystem = createFileSystem();

export const container = {
  api,
  fileSystem,

  importWorkbooks: (opts) => importWorkbooks({ fileSystem, api, ...opts }),
  loadDashboard: (opts) => loadDashboard({ api, ...opts }),
  runAnalysis: (opts) => runAnalysis({ api, ...opts }),
  loadInsights: (opts) => loadInsights({ api, ...opts }),
  updateInsightStatus: (opts) => updateInsightStatus({ api, ...opts }),
  loadPlanCritiques: () => api.getPlanCritiques(),

  /**
   * Saving a daily entry.
   *
   * Deliberately appends through the API rather than editing the xlsx: the workbook is an
   * artefact you own, and silently rewriting someone's file is a worse default than a row in
   * the app that the next import will reconcile.
   */
  saveDailyEntry: async ({ date, accomplished, blockers, buildOutcome, targetMet, plannedHours, floorHit, floorHitReason, planBend, tomorrowChange }) =>
    api.saveDailyEntry({ date, accomplished, blockers, buildOutcome, targetMet, plannedHours, floorHit, floorHitReason, planBend, tomorrowChange }),

  /** Phase 7: reflection quality check. */
  getReflectionQuestions: () => api.getReflectionQuestions(),
  getReflectionQuality: (date) => api.getReflectionQuality(date),
};

export default container;