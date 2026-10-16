/**
 * HTTP interface layer. Thin by design: validate -> call use case -> serialise.
 * No business logic here (clean arch rule 4).
 */

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pathToFileURL } from 'node:url';
import { config } from '../../infrastructure/config/env.js';
import { container, bootstrap, shutdown } from '../../shared/di/container.js';
import { unwrap } from '../../shared/result.js';
import { getLogLevel } from '../../shared/logger.js';
import { budgets, budgets as _b } from '../../shared/diagnostics.js';
import { uploadRouter } from './uploadRoute.js';
import { dailyEntryRouter } from './dailyEntryRoute.js';
import { dailyPlanRouter } from './dailyPlanRoute.js';
import { focusSessionRouter } from './focusSessionRoute.js';
import { REFLECTION_QUESTIONS } from '../../domain/entities/reflectionQuestions.js';
import { buildMechanicalReflectionQualityReport } from '../../infrastructure/ai/graphs/reflectionQualityGraph.js';
import { parseServiceAccount } from '../../infrastructure/sheets/googleSheetsClient.js';

export function createApp({ expressFactory = express } = {}) {
  const app = expressFactory();

  app.set('trust proxy', false);
  // Mobile folder upload (Phase 4). Mounted FIRST, with its own larger JSON limit, because a
  // base64 spreadsheet easily exceeds the app-wide 1mb cap used for ordinary API calls.
  app.use(uploadRouter());
  app.use(dailyEntryRouter());
  app.use(dailyPlanRouter());
  app.use(focusSessionRouter());

  /**
   * Every mutating route below takes JSON.
   *
   * `express.json()` silently ignores a body sent with any other Content-Type, which meant
   * `curl -d 'hello'` (curl defaults to form-encoded) reached the handler with an empty body and
   * POST /api/import cheerfully ran a full import from the watch folder. Rejecting it is both
   * correct HTTP and stops a malformed request doing real work.
   */
  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type && type !== 'application/json' && !type.endsWith('+json')) {
      return res.status(415).json({
        error: {
          name: 'UnsupportedMediaType',
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Expected application/json, received ${type || 'nothing'}.`,
        },
      });
    }
    next();
  });

  app.use(helmet());
  app.use(express.json({ limit: config.http.bodyLimit }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.http.rateLimitPerMinute,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  /* ---------------------------------------------------------------- */
  app.get('/health', async (_req, res) => {
    let mongo = 'down';
    try {
      await bootstrap();
      mongo = (await container.mongo.ping()) ? 'up' : 'down';
    } catch {
      mongo = 'down';
    }
    res.json({
      status: mongo === 'up' ? 'ok' : 'degraded',
      service: 'study-accountability-server',
      mongo,
      folder: config.ingest.watchFolder,
      aiConfigured: Boolean(process.env.OPENROUTER_API_KEY),
      sheetsConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    });
  });

  /* ---------------------------------------------------------------- */
  app.get('/api/config', (_req, res) => {
    res.json({
      watchFolder: config.ingest.watchFolder,
      recursive: config.ingest.recursive,
      models: { fast: config.ai.fastModel, strong: config.ai.strongModel },
      temperatureAnalysis: config.ai.temperatureAnalysis,
      monthlyBudgetCredits: config.ai.monthlyBudgetCredits,
      targetDailyHours: config.monthlyGoalDefaultTargetHours,
    });
  });

  /* --- ingest ------------------------------------------------------- */

  // Pre-flight (FR-1.8): parse and report WITHOUT writing. The user must confirm first.
  app.get('/api/import/preflight', async (req, res) => {
    const folder = req.query.folder ?? config.ingest.watchFolder;
    const recursive = req.query.recursive === 'true';
    await bootstrap();

    const files = await container.workbookReader.listSpreadsheets(folder, { recursive });
    const previews = [];
    for (const filePath of files) {
      const wb = await container.workbookReader.readWorkbook(filePath);
      const { normalizeWorkbook } = await import('../../domain/services/WorkbookNormalizer.js');
      try {
        const n = normalizeWorkbook({ rows: wb.sheets[0].rows, fileName: wb.fileName, sheetName: wb.sheets[0].name });
        previews.push({
          fileName: wb.fileName,
          sha256: wb.sha256.slice(0, 12),
          alreadyImported: await container.importLogRepository.hasBeenImported(wb.sha256),
          headerRow: n.meta.headerRow,
          rowsPopulated: n.meta.rowsPopulated,
          daysWithData: n.meta.daysWithData,
          months: n.meta.months,
          quarantined: n.meta.rowsQuarantined,
          unitDecisions: n.meta.unitDecisions,
          userSummary: n.summary,
          agreement: n.agreement,
          quarantineSample: n.quarantined.slice(0, 5),
        });
      } catch (e) {
        previews.push({ fileName: wb.fileName, sha256: wb.sha256.slice(0, 12), error: e.message });
      }
    }
    res.json({ folder, filesFound: files.length, previews });
  });

  app.post('/api/import', async (req, res) => {
    const { folder, recursive = false, force = false, asOf } = req.body ?? {};
    const result = await container.importWorkbooks({ folder, recursive, force, asOf });
    if (!result.ok) {
      budgets.ingest.failure(result.error);
      return res.status(400).json({ error: result.error.toJSON() });
    }
    budgets.ingest.success();
    res.json(result.value);
  });

  /* --- data --------------------------------------------------------- */

  app.get('/api/months', async (_req, res) => {
    await bootstrap();
    res.json(await container.monthRepository.list());
  });

  app.get('/api/months/:month', async (req, res) => {
    await bootstrap();
    const doc = await container.monthRepository.find(req.params.month);
    if (!doc) return res.status(404).json({ error: 'month not found' });
    res.json(doc);
  });

  app.get('/api/months/:month/days', async (req, res) => {
    await bootstrap();
    const withData = req.query.withData === 'true';
    const rows = withData
      ? await container.dailyLogRepository.findWithData(req.params.month)
      : await container.dailyLogRepository.findByMonth(req.params.month);
    res.json(rows);
  });

  app.get('/api/months/:month/metrics', async (req, res) => {
    await bootstrap();
    const doc = await container.monthRepository.find(req.params.month);
    if (!doc) return res.status(404).json({ error: 'month not found' });
    res.json(doc.metrics);
  });

  app.get('/api/quarantine', async (_req, res) => {
    await bootstrap();
    res.json({ unresolved: await container.quarantineRepository.unresolved() });
  });

  app.post('/api/quarantine/:id/resolve', async (req, res) => {
    await bootstrap();
    await container.quarantineRepository.resolve(req.params.id);
    res.json({ ok: true, id: req.params.id });
  });

  app.get('/api/imports', async (_req, res) => {
    await bootstrap();
    res.json(await container.importLogRepository.list());
  });

  /* --- AI analysis (Phase 3) --------------------------------------- */

  // Dry run: parse + metrics only, no LLM, no cost. Useful for confirming the month is
  // analysable before spending anything.
  app.get('/api/analysis/:month/precheck', async (req, res) => {
    await bootstrap();
    const entries = await container.dailyLogRepository.findByMonth(req.params.month);
    if (entries.length === 0) return res.status(404).json({ error: 'no data for that month' });

    const { calculateMetrics } = await import('../../domain/services/MetricsCalculator.js');
    const { extractConstraints, describeConstraints } = await import(
      '../../domain/services/ConstraintExtractor.js'
    );
    const { assertEnoughData, allowedDates } = await import('../../domain/services/InsightValidator.js');

    const metrics = calculateMetrics({
      entries,
      month: req.params.month,
      asOf: req.query.asOf ?? new Date().toISOString().slice(0, 10),
    });

    res.json({
      month: req.params.month,
      canAnalyse: assertEnoughData(entries).ok,
      gate: assertEnoughData(entries),
      citableDates: [...allowedDates(entries).keys()],
      constraints: describeConstraints(extractConstraints(entries)),
      metrics,
    });
  });

  app.post('/api/analysis/:month', async (req, res) => {
    await bootstrap();

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: {
          code: 'NO_PROVIDER',
          message: 'OPENROUTER_API_KEY is not configured on the server. Set it in server/.env.',
        },
      });
    }

    const { generateInsights } = await import('../../application/useCases/generateInsights.js');
    const { createOpenRouterAdapter } = await import('../../infrastructure/ai/openRouterClient.js');

    const result = await generateInsights({
      dailyLogRepository: container.dailyLogRepository,
      monthRepository: container.monthRepository,
      insightRepository: container.insightRepository,
      planCritiqueRepository: container.planCritiqueRepository,
      llm: createOpenRouterAdapter(),
      month: req.params.month,
      asOf: req.body?.asOf,
    });

    if (!result.ok) return res.status(400).json({ error: result.error.toJSON() });

    // FR-4.7: refuse rather than fabricate when there is not enough to go on.
    if (result.value.insufficient) {
      return res.status(422).json({ month: req.params.month, insufficient: result.value.insufficient });
    }
    res.json(result.value);
  });

  /** Insights already persisted, with their OPEN/ACTED_ON/DISMISSED status. */
  app.get('/api/analysis/:month/insights', async (req, res) => {
    await bootstrap();
    res.json(await container.insightRepository.findByMonth(req.params.month));
  });

  app.post('/api/analysis/:month/dismiss-all', async (req, res) => {
    await bootstrap();
    await container.insightRepository.dismissAllForMonth(req.params.month);
    res.json({ ok: true, month: req.params.month });
  });

  app.post('/api/insights/:id/status', async (req, res) => {
    await bootstrap();
    const { status } = req.body ?? {};
    if (!['OPEN', 'ACTED_ON', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ error: 'status must be OPEN, ACTED_ON or DISMISSED' });
    }
    await container.insightRepository.setStatus(req.params.id, status);
    res.json({ ok: true, id: req.params.id, status });
  });

  app.get('/api/plan-critiques', async (_req, res) => {
    await bootstrap();
    res.json(await container.planCritiqueRepository.list());
  });

  /* --- Reflection (Phase 7) ---------------------------------------- */

  /** The 5 reflection questions — pure constant, no DB needed. */
  app.get('/api/reflection-questions', (_req, res) => {
    res.json({ questions: REFLECTION_QUESTIONS });
  });

  /** AI quality check on a single day's reflection. */
  app.get('/api/reflection-quality/:date', async (req, res) => {
    await bootstrap();

    const entry = await container.dailyLogRepository.findByDate(req.params.date);
    if (!entry) {
      return res.status(404).json({ error: 'no entry for that date' });
    }

    const history = entry.month
      ? await container.dailyLogRepository.findByMonth(entry.month)
      : [entry];
    const mechanicalWarning = 'AI review is unavailable; showing deterministic quality checks.';
    const persistReport = async (report) => {
      const stored = {
        ...report,
        generatedAt: new Date().toISOString(),
      };
      await container.dailyLogRepository.updateReflectionAnalysis(req.params.date, stored);
      return stored;
    };

    if (!process.env.OPENROUTER_API_KEY) {
      return res.json(await persistReport({
        ...buildMechanicalReflectionQualityReport({ date: req.params.date, entry, history, warning: mechanicalWarning }),
        qualitySource: 'mechanical',
      }));
    }

    try {
      const { buildReflectionQualityGraph } = await import(
        '../../infrastructure/ai/graphs/reflectionQualityGraph.js'
      );
      const { createOpenRouterAdapter } = await import(
        '../../infrastructure/ai/openRouterClient.js'
      );

      const graph = buildReflectionQualityGraph({ llm: createOpenRouterAdapter() });
      const result = await graph.invoke(
        { date: req.params.date, entry, history },
        { configurable: { thread_id: `reflection-quality-${req.params.date}` } }
      );

      // The graph already falls back to mechanical validation when the provider fails. Surface
      // that state to the app instead of turning a provider 5xx into a useless 502 screen.
      return res.json(await persistReport({
        ...(result.report ?? buildMechanicalReflectionQualityReport({
          date: req.params.date,
          entry,
          history,
          warning: mechanicalWarning,
        })),
        qualitySource: result.errors?.length ? 'mechanical' : 'ai',
        ...(result.errors?.length ? { warning: mechanicalWarning } : {}),
      }));
    } catch {
      // AI construction/import/provider failures must not prevent the user from seeing the
      // deterministic quality result for answers that were already saved in Mongo.
      return res.json(await persistReport({
        ...buildMechanicalReflectionQualityReport({ date: req.params.date, entry, history, warning: mechanicalWarning }),
        qualitySource: 'mechanical',
      }));
    }
  });

  /* --- Google Sheets mirror (Phase 2) ------------------------------ */

  app.get('/api/sheets/status', async (_req, res) => {
    await bootstrap();
    const id = await container.settingsRepository.get('sheets.spreadsheetId', null) ?? config.sheets.spreadsheetId;
    let credentialsValid = false;
    let credentialError = null;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        parseServiceAccount(config.sheets.serviceAccountJson);
        credentialsValid = true;
      } catch {
        credentialError = 'Google Sheets credentials are invalid. Replace GOOGLE_SERVICE_ACCOUNT_JSON with the complete service-account JSON.';
      }
    }
    res.json({
      connected: Boolean(id),
      syncReady: Boolean(id && credentialsValid),
      spreadsheetId: id,
      url: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null,
      credentialsConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      credentialsValid,
      credentialError,
      // Without this a service-account-owned workbook is invisible to the human.
      userEmailConfigured: Boolean(process.env.GOOGLE_USER_EMAIL),
      tabs: Object.values(
        await import('../../infrastructure/sheets/sheetSchema.js').then((m) => m.TABS)
      ),
    });
  });

  app.post('/api/sheets/connect', async (req, res) => {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return res.status(503).json({
        error: {
          code: 'CONFIG_MISSING',
          message: 'GOOGLE_SERVICE_ACCOUNT_JSON is not configured. See docs/SECURITY.md.',
        },
      });
    }
    await bootstrap();
    const { connectSheets } = await import('../../application/useCases/syncToSheets.js');
    const { createSheetsClient } = await import('../../infrastructure/sheets/googleSheetsClient.js');

    const result = await connectSheets({
      sheetsClient: createSheetsClient({ json: config.sheets.serviceAccountJson }),
      settingsRepository: container.settingsRepository,
      spreadsheetId: req.body?.spreadsheetId ?? config.sheets.spreadsheetId ?? null,
      userEmail: req.body?.userEmail ?? process.env.GOOGLE_USER_EMAIL ?? null,
    });
    if (!result.ok) return res.status(400).json({ error: result.error.toJSON() });
    res.json(result.value);
  });

  app.post('/api/sheets/sync/:month', async (req, res) => {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return res.status(503).json({ error: { code: 'CONFIG_MISSING', message: 'GOOGLE_SERVICE_ACCOUNT_JSON is not configured.' } });
    }
    await bootstrap();
    const { syncToSheets } = await import('../../application/useCases/syncToSheets.js');
    const { createSheetsClient } = await import('../../infrastructure/sheets/googleSheetsClient.js');

    const result = await syncToSheets({
      sheetsClient: createSheetsClient({ json: config.sheets.serviceAccountJson }),
      settingsRepository: container.settingsRepository,
      spreadsheetId: config.sheets.spreadsheetId,
      dailyLogRepository: container.dailyLogRepository,
      monthRepository: container.monthRepository,
      insightRepository: container.insightRepository,
      planCritiqueRepository: container.planCritiqueRepository,
      importLogRepository: container.importLogRepository,
      month: req.params.month,
      dryRun: req.body?.dryRun === true,
    });
    if (!result.ok) {
      budgets.sheets.failure(result.error);
      return res.status(400).json({ error: result.error.toJSON() });
    }
    budgets.sheets.success();
    res.json(result.value);
  });

  /* --- diagnostics (Phase 6) --------------------------------------- */

  /**
   * Operational health: error budgets, circuit-breaker state, and AI spend against the NFR-2
   * ceiling. Deliberately contains counts and costs only — never journal content.
   */
  app.get('/api/diagnostics', async (req, res) => {
    await bootstrap();
    const { snapshotAllBudgets } = await import('../../shared/diagnostics.js');
    const { evaluateBudget, estimateAnalysisCost } = await import('../../shared/spend.js');
    const { aiBreaker } = await import('../../infrastructure/ai/circuitBreaker.js');

    const months = await container.monthRepository.list();
    const spend = {};
    for (const m of months) {
      const spent = await container.insightRepository.spendForMonth(m._id).catch(() => 0);
      spend[m._id] = evaluateBudget({
        limitCredits: config.ai.monthlyBudgetCredits,
        spentSoFar: spent,
        estimatedCost: estimateAnalysisCost(m.metrics?.daysLogged ?? 0),
      });
    }

    res.json({
      generatedAt: new Date().toISOString(),
      errorBudgets: snapshotAllBudgets(),
      circuitBreakers: [aiBreaker.snapshot()],
      spend,
      totals: {
        daysLogged: await container.dailyLogRepository.count(),
        insights: (await container.insightRepository.findByMonth(months[0]?._id ?? 'x')).length,
        unresolvedQuarantine: await container.quarantineRepository.countUnresolved(),
      },
      logLevel: getLogLevel(),
    });
  });

  /** Reset the in-memory budgets. Used after fixing a problem, or by a soak test. */
  app.post('/api/diagnostics/reset', async (_req, res) => {
    await bootstrap();
    const { budgets } = await import('../../shared/diagnostics.js');
    const { aiBreaker } = await import('../../infrastructure/ai/circuitBreaker.js');
    for (const b of Object.values(budgets)) b.reset();
    aiBreaker.reset();
    res.json({ ok: true });
  });

  /* --- error trap --------------------------------------------------- */
  app.use((err, _req, res, _next) => {
    // body-parser failures are the CLIENT's fault. Without this they fall through as 500s,
    // which makes a typo'd curl command look like a server crash.
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: { name: 'BadRequest', code: 'INVALID_JSON', message: 'Request body is not valid JSON.' },
      });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error: { name: 'PayloadTooLarge', code: 'BODY_TOO_LARGE', message: 'Request body exceeds the size limit.' },
      });
    }

    const status = err?.name === 'DomainError' ? 400 : 500;
    // Never echo file contents or journal text into error responses (NFR-6).
    res.status(status).json({ error: { name: err?.name, code: err?.code, message: err?.message } });
  });

  return app;
}

export async function start() {
  const app = createApp();
  const server = app.listen(config.http.port, config.http.host, async () => {
    let mongo = 'down';
    try {
      await bootstrap();
      mongo = (await container.mongo.ping()) ? 'up' : 'down';
    } catch (e) {
    console.log(`  listening   http://${config.http.host}:${config.http.port}`);
  }});


  const bye = async () => {
    server.close();
    await shutdown();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  return server;
}

export { unwrap };

// Entry point: only auto-start when executed directly, never when imported by a test.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch((e) => {
    console.error('[fatal] failed to start:', e.message);
    process.exit(1);
  });
}
