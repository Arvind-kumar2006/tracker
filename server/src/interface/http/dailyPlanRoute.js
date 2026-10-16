import express from 'express';
import { ok, err } from '../../shared/result.js';
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';
import { buildEntryFromInput } from './dailyEntryRoute.js';
import { buildDailyPlan, reviewDailyPlan } from '../../domain/services/DailyPlan.js';
import { calculateMetrics } from '../../domain/services/MetricsCalculator.js';
import { container, bootstrap } from '../../shared/di/container.js';
import { SCHEMAS } from '../../infrastructure/ai/schemas.js';
import { planGenerationPrompt, planQualityPrompt } from '../../infrastructure/ai/prompts.js';

function syncResult(mirror) {
  return mirror?.ok
    ? { synced: true, totals: mirror.value?.totals ?? null }
    : { synced: false, error: mirror?.error?.message ?? 'Google Sheets sync failed' };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function unfinishedPlanItems(plan = {}) {
  return (plan.items ?? []).filter((item) => (
    item.status !== 'DONE' && Number(item.actualMinutes ?? 0) < Number(item.estimatedMinutes ?? 0)
  ));
}

export async function saveDailyPlan({ date, payload, repositories, sheetsSync = null }) {
  let plan;
  try {
    plan = buildDailyPlan({ date, input: payload });
  } catch (e) {
    return err(e instanceof DomainError ? e : new DomainError(ErrorCode.UNPARSEABLE_VALUE, e.message));
  }

  const { dailyLogRepository, monthRepository } = repositories;
  const existing = await dailyLogRepository.findByDate(date);
  const base = existing ?? buildEntryFromInput({ date, payload: {} });
  const entry = {
    ...base,
    date,
    month: date.slice(0, 7),
    plan,
    hasData: Boolean(base.hasData || plan.items.length > 0),
    sourceFile: base.sourceFile ?? null,
    origin: base.origin ?? 'app',
  };

  const write = await dailyLogRepository.upsertMany([entry], { fileName: null });
  const entries = await dailyLogRepository.findByMonth(entry.month);
  const metrics = calculateMetrics({
    entries,
    month: entry.month,
    asOf: new Date().toISOString().slice(0, 10),
  });
  const existingMonth = await monthRepository.find(entry.month);
  await monthRepository.upsert(
    entry.month,
    metrics,
    existingMonth?.monthlyGoal ?? null,
    existingMonth?.targetDailyHours ?? null
  );

  let sheets = { synced: false, skipped: true };
  if (sheetsSync) {
    try {
      sheets = syncResult(await sheetsSync(entry.month));
    } catch (e) {
      sheets = { synced: false, error: e.message };
    }
  }

  const saved = await dailyLogRepository.findByDate(date);
  return ok({
    date,
    written: write,
    plan: saved?.plan ?? plan,
    review: reviewDailyPlan(saved?.plan ?? plan),
    sheets,
  });
}

export async function carryForwardDailyPlan({ date, targetDate, repositories, sheetsSync = null }) {
  if (!ISO_DATE.test(String(targetDate ?? '')) || targetDate <= date) {
    return err(new DomainError(ErrorCode.IMPOSSIBLE_RANGE, 'targetDate must be a later ISO date than the source day.'));
  }

  const source = await repositories.dailyLogRepository.findByDate(date);
  if (!source) return err(new DomainError(ErrorCode.UNPARSEABLE_VALUE, `No daily plan exists for ${date}.`));

  const unfinished = unfinishedPlanItems(source.plan);
  if (unfinished.length === 0) {
    return err(new DomainError(ErrorCode.UNPARSEABLE_VALUE, 'There are no unfinished priorities to move.'));
  }

  const payload = {
    ...source.plan,
    items: unfinished.map((item, index) => ({
      ...item,
      id: `${targetDate}-${index + 1}`,
      n: index + 1,
      actualMinutes: 0,
      status: 'PLANNED',
    })),
  };
  const result = await saveDailyPlan({
    date: targetDate,
    payload,
    repositories,
    sheetsSync,
  });
  if (!result.ok) return result;
  return ok({
    ...result.value,
    sourceDate: date,
    targetDate,
    movedItems: unfinished.map((item) => item.text),
  });
}

export function dailyPlanRouter() {
  const router = express.Router();

  router.post('/api/days/:date/plan/carry-forward', async (req, res) => {
    await bootstrap();
    const result = await carryForwardDailyPlan({
      date: req.params.date,
      targetDate: req.body?.targetDate,
      repositories: {
        dailyLogRepository: container.dailyLogRepository,
        monthRepository: container.monthRepository,
      },
      sheetsSync: (month) => container.syncMonthToSheets(month),
    });
    if (!result.ok) return res.status(400).json({ error: result.error.toJSON() });
    res.json(result.value);
  });

  router.post('/api/days/:date/plan/generate', async (req, res) => {
    if (!ISO_DATE.test(String(req.params.date ?? ''))) {
      return res.status(400).json({
        error: {
          code: ErrorCode.UNPARSEABLE_VALUE,
          message: `invalid date "${req.params.date}"`,
        },
      });
    }
    const goal = String(req.body?.goal ?? '').trim().slice(0, 400);
    if (goal.length < 3) {
      return res.status(400).json({
        error: {
          code: ErrorCode.UNPARSEABLE_VALUE,
          message: 'Add a short goal before asking AI to draft a plan.',
        },
      });
    }
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: {
          code: ErrorCode.NO_PROVIDER,
          message: 'AI plan drafting is unavailable. You can still create the plan manually.',
        },
      });
    }

    try {
      const { createOpenRouterAdapter } = await import('../../infrastructure/ai/openRouterClient.js');
      const { data } = await createOpenRouterAdapter().structured({
        task: 'planGeneration',
        system: 'You create concise, realistic study-plan drafts. Never invent facts or completed work.',
        prompt: planGenerationPrompt({
          date: req.params.date,
          goal,
          availableMinutes: req.body?.availableMinutes,
          minimumMinutes: req.body?.minimumMinutes,
          idealMinutes: req.body?.idealMinutes,
        }),
        schema: SCHEMAS.planGeneration,
        temperature: 0.4,
        maxTokens: 1200,
      });
      const plan = buildDailyPlan({ date: req.params.date, input: data });
      return res.json({
        plan,
        review: reviewDailyPlan(plan),
        summary: data.summary,
        qualitySource: 'ai',
      });
    } catch {
      return res.status(502).json({
        error: {
          code: ErrorCode.UPSTREAM_ERROR,
          message: 'AI plan drafting failed. Create the plan manually and try again later.',
        },
      });
    }
  });

  router.post('/api/days/:date/plan/check', async (req, res) => {
    let plan;
    try {
      plan = buildDailyPlan({ date: req.params.date, input: req.body ?? {} });
    } catch (e) {
      const error = e instanceof DomainError ? e : new DomainError(ErrorCode.UNPARSEABLE_VALUE, e.message);
      return res.status(400).json({ error: error.toJSON() });
    }

    const mechanical = reviewDailyPlan(plan);
    const fallback = {
      ...mechanical,
      qualitySource: 'mechanical',
      suggestions: mechanical.warnings.map((warning) => ({
        itemId: warning.itemId ?? '',
        suggestion: warning.suggestion ?? warning.message,
        reason: warning.message,
      })).slice(0, 3),
      summary: mechanical.warnings.length
        ? 'The plan was reviewed with deterministic checks.'
        : 'The plan passed the deterministic checks.',
    };

    if (!process.env.OPENROUTER_API_KEY) return res.json(fallback);

    try {
      const { createOpenRouterAdapter } = await import('../../infrastructure/ai/openRouterClient.js');
      const result = await createOpenRouterAdapter().structured({
        task: 'planQuality',
        system: 'You are a precise study-planning reviewer. Be specific, neutral, and never invent facts.',
        prompt: planQualityPrompt({ date: req.params.date, plan, mechanical }),
        schema: SCHEMAS.planQuality,
        temperature: 0.2,
        maxTokens: 1200,
      });
      return res.json({ ...mechanical, ...result.data, qualitySource: 'ai' });
    } catch {
      return res.json({ ...fallback, warning: 'AI review was unavailable; deterministic checks are shown.' });
    }
  });

  router.put('/api/days/:date/plan', async (req, res) => {
    await bootstrap();
    const result = await saveDailyPlan({
      date: req.params.date,
      payload: req.body ?? {},
      repositories: {
        dailyLogRepository: container.dailyLogRepository,
        monthRepository: container.monthRepository,
      },
      sheetsSync: (month) => container.syncMonthToSheets(month),
    });
    if (!result.ok) return res.status(400).json({ error: result.error.toJSON() });
    res.json(result.value);
  });

  return router;
}

