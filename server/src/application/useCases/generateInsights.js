/**
 * GenerateInsights — the Phase 3 application use case.
 *
 * Loads a month from Mongo, runs the LangGraph pipeline, persists the validated output.
 * Depends only on ports, so the whole thing is testable with a fake LLM and no API key.
 */

import { ok, err } from '../../shared/result.js';
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';
import { buildAnalysisGraph } from '../../infrastructure/ai/graphs/analysisGraph.js';
import { calculateMetrics } from '../../domain/services/MetricsCalculator.js';
import { evaluateBudget, assertBudget, estimateAnalysisCost, DEFAULT_BUDGET_CREDITS } from '../../shared/spend.js';
import { budgets } from '../../shared/diagnostics.js';
import { logger } from '../../shared/logger.js';

const log = logger.child('analysis');

export async function generateInsights({
  dailyLogRepository,
  monthRepository,
  insightRepository,
  planCritiqueRepository,
  llm,
  month,
  asOf = new Date().toISOString().slice(0, 10),
  threadId,
  budgetCredits = null,
  force = false,
  skipBudget = false,
}) {
  if (!month) {
    return err(new DomainError(ErrorCode.CONFIG_MISSING, 'month is required, e.g. "2026-10"'));
  }

  const entries = await dailyLogRepository.findByMonth(month);
  if (entries.length === 0) {
    budgets.analysis.success();
    return err(
      new DomainError(ErrorCode.PERSISTENCE_ERROR, `no data for ${month} — import a workbook first`, { month })
    );
  }

  // --- spend gate (NFR-2) ---------------------------------------------------
  // Checked before the graph runs, because the graph makes up to 5 model calls and the whole
  // point of the ceiling is to refuse the expensive part, not to report it afterwards.
  const daysWithData = entries.filter((e) => e.hasData).length;
  let budget = null;
  if (!skipBudget) {
    const spentSoFar = await insightRepository.spendForMonth(month).catch(() => 0);
    budget = evaluateBudget({
      limitCredits: budgetCredits ?? DEFAULT_BUDGET_CREDITS,
      spentSoFar,
      estimatedCost: estimateAnalysisCost(daysWithData),
      force,
    });
    const refusal = assertBudget(budget);
    if (refusal) {
      budgets.analysis.failure(refusal);
      return err(refusal);
    }
  }

  const monthDoc = await monthRepository.find(month);
  const graph = buildAnalysisGraph({ llm, insightRepository, planCritiqueRepository });

  const startedAt = Date.now();
  try {
    const finalState = await graph.invoke(
      {
        month,
        monthGoal: monthDoc?.monthlyGoal ?? '',
        asOf,
        // Feed every day, empty ones included, so `loadContext` performs the filtering and
        // the sufficiency gate sees the true picture rather than a pre-trimmed set.
        entries,
      },
      { configurable: { thread_id: threadId ?? `month:${month}` } }
    );

    budgets.analysis.success();

    // Scalars only, never the metrics object or an entry. Passing whole structures here is how
    // journal text ends up on disk; the logger would redact most of it, but "most" is not a
    // privacy guarantee. (An early version of this line leaked `passiveDays[].evidence`.)
    log.info('analysis complete', {
      month,
      durationMs: Date.now() - startedAt,
      daysLogged: daysWithData,
      insightCount: finalState.insights?.length ?? 0,
      rejectedCount: finalState.validationStats?.rejectedCount ?? 0,
      regenerated: (finalState.attempts ?? 0) > 1,
      costCredits: Number((finalState.costCredits ?? 0).toFixed(6)),
    });

    return ok({
      month,
      insufficient: finalState.insufficient ?? null,
      bundle: finalState.bundle,
      validationStats: finalState.validationStats,
      costCredits: finalState.costCredits,
      budget,
      warnings: finalState.errors,
    });
  } catch (e) {
    budgets.analysis.failure(e);
    log.error('analysis failed', { month, error: e.message, code: e.code });
    return err(
      new DomainError(ErrorCode.UPSTREAM_ERROR, `analysis failed: ${e.message}`, {
        month,
        cause: e.name,
      })
    );
  }
}

/**
 * Deterministic metrics for a month — no LLM, no cost. This is what the dashboard renders.
 */
export async function getMonthMetrics({ dailyLogRepository, monthRepository, month, asOf }) {
  const entries = await dailyLogRepository.findByMonth(month);
  if (entries.length === 0) return err(new DomainError(ErrorCode.PERSISTENCE_ERROR, `no data for ${month}`));

  const metrics = calculateMetrics({ entries, month, asOf: asOf ?? new Date().toISOString().slice(0, 10) });
  const doc = await monthRepository.find(month);
  return ok({
    month,
    monthlyGoal: doc?.monthlyGoal ?? null,
    targetDailyHours: doc?.targetDailyHours ?? null,
    metrics,
  });
}