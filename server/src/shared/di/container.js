/**
 * DI container — hand-rolled, no framework (clean arch rule 6).
 * Wires concrete infrastructure adapters into the ports the application layer declares.
 * Everything is built lazily so importing the container never opens a socket or requires a
 * secret, which keeps the pure-domain test path fast and dependency-free.
 */

import { config } from '../../infrastructure/config/env.js';
import * as xlsxReader from '../../infrastructure/persistence/xlsx/xlsxReader.js';
import {
  DailyLogRepository,
  MonthRepository,
  ImportLogRepository,
  QuarantineRepository,
  InsightRepository,
  PlanCritiqueRepository,
  SettingsRepository,
  WeeklyPlanRepository,
  MonthlyPlanRepository,
} from '../../infrastructure/persistence/mongo/repositories.js';
import { connect, close, ping, getDb } from '../../infrastructure/persistence/mongo/connection.js';
import { importWorkbooks } from '../../application/useCases/importWorkbooks.js';
import { syncToSheets } from '../../application/useCases/syncToSheets.js';
import { createSheetsClient } from '../../infrastructure/sheets/googleSheetsClient.js';
import { logger } from '../logger.js';

let ready = false;
let connecting = null;
const queuedSheetSyncs = new Map();
const log = logger.child('sheets-queue');

export async function bootstrap() {
  if (ready) return;
  if (!connecting) {
    connecting = connect()
      .then(() => { ready = true; })
      .finally(() => { connecting = null; });
  }
  await connecting;
}

export async function shutdown() {
  await close();
  ready = false;
  connecting = null;
}

export const container = {
  config,

  // --- ports -> adapters -------------------------------------------------
  workbookReader: xlsxReader,
  dailyLogRepository: DailyLogRepository,
  monthRepository: MonthRepository,
  importLogRepository: ImportLogRepository,
  quarantineRepository: QuarantineRepository,
  insightRepository: InsightRepository,
  planCritiqueRepository: PlanCritiqueRepository,
  settingsRepository: SettingsRepository,
  weeklyPlanRepository: WeeklyPlanRepository,
  monthlyPlanRepository: MonthlyPlanRepository,

  // --- infrastructure singletons ---------------------------------------
  mongo: { connect, close, ping, getDb },

  // --- use cases ---------------------------------------------------------
  async importWorkbooks(params = {}) {
    await bootstrap();
    return importWorkbooks({
      workbookReader: xlsxReader,
      dailyLogRepository: DailyLogRepository,
      monthRepository: MonthRepository,
      importLogRepository: ImportLogRepository,
      quarantineRepository: QuarantineRepository,
      folder: params.folder ?? config.ingest.watchFolder,
      recursive: params.recursive ?? config.ingest.recursive,
      force: params.force ?? false,
      asOf: params.asOf,
    });
  },

  /** Best-effort projection used after a mobile daily-entry save. */
  async syncMonthToSheets(month) {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return {
        ok: false,
        error: new Error('Google Sheets is not configured on the server.'),
      };
    }

    await bootstrap();
    return syncToSheets({
      sheetsClient: createSheetsClient({ json: config.sheets.serviceAccountJson }),
      settingsRepository: SettingsRepository,
      dailyLogRepository: DailyLogRepository,
      monthRepository: MonthRepository,
      insightRepository: InsightRepository,
      planCritiqueRepository: PlanCritiqueRepository,
      importLogRepository: ImportLogRepository,
      weeklyPlanRepository: WeeklyPlanRepository,
      monthlyPlanRepository: MonthlyPlanRepository,
      spreadsheetId: config.sheets.spreadsheetId,
      month,
    });
  },

  /**
   * Queue a Sheets projection without making the user's database save wait for Google APIs.
   * Mongo remains the source of truth; a later settings/manual sync can repair a failed job.
   */
  queueMonthToSheets(month) {
    if (queuedSheetSyncs.has(month)) {
      return Promise.resolve({ ok: true, value: { queued: true, deduplicated: true } });
    }

    const job = Promise.resolve()
      .then(() => this.syncMonthToSheets(month))
      .catch((error) => {
        log.warn('background Sheets sync failed', { month, error: error?.message ?? String(error) });
        return { ok: false, error };
      })
      .finally(() => queuedSheetSyncs.delete(month));

    queuedSheetSyncs.set(month, job);
    return Promise.resolve({ ok: true, value: { queued: true } });
  },
};

export default container;
