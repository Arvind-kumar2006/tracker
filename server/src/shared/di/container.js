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
} from '../../infrastructure/persistence/mongo/repositories.js';
import { connect, close, ping, getDb } from '../../infrastructure/persistence/mongo/connection.js';
import { importWorkbooks } from '../../application/useCases/importWorkbooks.js';
import { syncToSheets } from '../../application/useCases/syncToSheets.js';
import { createSheetsClient } from '../../infrastructure/sheets/googleSheetsClient.js';

let ready = false;

export async function bootstrap() {
  if (ready) return;
  await connect();
  ready = true;
}

export async function shutdown() {
  await close();
  ready = false;
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
      spreadsheetId: config.sheets.spreadsheetId,
      month,
    });
  },
};

export default container;
