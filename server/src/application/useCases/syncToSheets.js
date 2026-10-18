/**
 * SyncToSheets — the Phase 2 application use case.
 *
 * Loads a month from Mongo, projects it into the Google Sheet, and remembers the spreadsheet id.
 * Depends only on ports/adapters so it can be tested with a fake Sheets client.
 */

import { ok, err } from '../../shared/result.js';
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';
import { ensureWorkbook, syncMonth, WORKBOOK_TITLE } from '../../infrastructure/sheets/sheetsMirror.js';
import { TABS } from '../../infrastructure/sheets/sheetSchema.js';

/** The spreadsheet id is remembered in Mongo so it is configured exactly once. */
const SETTINGS_KEY = 'sheets.spreadsheetId';

export async function connectSheets({
  sheetsClient,
  settingsRepository,
  userEmail = null,
  spreadsheetId = null,
  title = WORKBOOK_TITLE,
}) {
  const existing = spreadsheetId ?? (await settingsRepository.get(SETTINGS_KEY, null));

  try {
    const result = await ensureWorkbook(sheetsClient, {
      title,
      spreadsheetId: existing,
      userEmail,
    });

    await settingsRepository.set(SETTINGS_KEY, result.spreadsheetId);
    return ok({
      spreadsheetId: result.spreadsheetId,
      url: result.url,
      created: result.created,
      sharedWith: result.sharedWith ?? null,
      tabs: Object.values(TABS),
    });
  } catch (e) {
    return err(
      e instanceof DomainError
        ? e
        : new DomainError(ErrorCode.CONFIG_MISSING, `could not connect to Google Sheets: ${e.message}`)
    );
  }
}

export async function syncToSheets({ sheetsClient, settingsRepository, dailyLogRepository, monthRepository,
  insightRepository, planCritiqueRepository, importLogRepository, weeklyPlanRepository = null, monthlyPlanRepository = null, month, dryRun = false,
  spreadsheetId: configuredSpreadsheetId = null }) {
  const spreadsheetId = configuredSpreadsheetId ?? await settingsRepository.get(SETTINGS_KEY, null);
  if (!spreadsheetId) {
    return err(
      new DomainError(
        ErrorCode.CONFIG_MISSING,
        'no Google Sheet connected yet. Call POST /api/sheets/connect first.'
      )
    );
  }

  try {
    const [monthDoc, dailyLogs, insights, planCritiques, importLogs, weeklyPlans, monthlyPlan] = await Promise.all([
      monthRepository.find(month),
      dailyLogRepository.findByMonth(month),
      insightRepository.findByMonth(month),
      planCritiqueRepository.list(1000),
      importLogRepository.list(1000),
      weeklyPlanRepository?.list(1000) ?? [],
      monthlyPlanRepository?.findByMonth(month) ?? null,
    ]);

    const monthWeeklyPlans = weeklyPlans.filter((plan) => plan.weekStart?.startsWith(month) || plan.weekEnd?.startsWith(month));
    if (!monthDoc && dailyLogs.length === 0 && monthWeeklyPlans.length === 0 && !monthlyPlan) {
      return err(new DomainError(ErrorCode.PERSISTENCE_ERROR, `no data for ${month} — import a workbook first`));
    }

    const result = await syncMonth({
      client: sheetsClient,
      spreadsheetId,
      sources: {
        months: monthDoc ? [monthDoc] : [],
        dailyLogs,
        insights,
        planCritiques: planCritiques.filter((c) => c.date?.startsWith(month)),
        importLogs,
        weeklyPlans: monthWeeklyPlans,
        monthlyPlans: monthlyPlan ? [monthlyPlan] : [],
      },
      dryRun,
    });

    return ok({ month, ...result });
  } catch (e) {
    return err(
      e instanceof DomainError
        ? e
        : new DomainError(ErrorCode.PERSISTENCE_ERROR, `sheet sync failed: ${e.message}`, { month })
    );
  }
}

export { SETTINGS_KEY };
