/**
 * Spend guard — turns NFR-2 ("≤ US$0.15 per full-month regeneration") from an aspiration into
 * an enforced ceiling.
 *
 * OpenRouter returns `usage.cost` on every call, and the graph accumulates it, so the actual
 * figure is known rather than estimated. This guard checks the month-to-date total BEFORE an
 * expensive run starts, and refuses once the ceiling is reached.
 *
 * It is deliberately a hard stop with an explicit override rather than a soft warning: the whole
 * failure mode this guards against is a loop nobody is watching.
 */

import { DomainError, ErrorCode } from '../domain/errors/DomainError.js';
import { logger } from './logger.js';

const log = logger.child('spend');

export const DEFAULT_BUDGET_CREDITS = 0.5; // USD; ~3 full regenerations at the default routing

/**
 * @param {object} args
 * @param {number} args.limitCredits - monthly ceiling in USD credits
 * @param {number} args.spentSoFar - month-to-date spend
 * @param {number} [args.estimatedCost] - rough cost of the run about to start
 * @param {boolean} [args.force] - explicit user override
 */
export function evaluateBudget({ limitCredits = DEFAULT_BUDGET_CREDITS, spentSoFar = 0, estimatedCost = 0, force = false }) {
  const projected = spentSoFar + estimatedCost;
  const remaining = Number((limitCredits - spentSoFar).toFixed(6));
  const overLimit = spentSoFar >= limitCredits;
  const wouldExceed = projected > limitCredits;

  const status = overLimit ? 'EXHAUSTED' : wouldExceed ? 'WOULD_EXCEED' : spentSoFar > 0 ? 'SPENT' : 'UNUSED';

  return {
    ok: force || (!overLimit && !wouldExceed),
    status,
    limitCredits,
    spentSoFar: Number(spentSoFar.toFixed(6)),
    estimatedCost: Number(estimatedCost.toFixed(6)),
    projected: Number(projected.toFixed(6)),
    remaining,
    reason: overLimit
      ? `Monthly AI budget of $${limitCredits} is spent.`
      : wouldExceed
        ? `This run would cost ~$${estimatedCost.toFixed(4)}, exceeding the $${remaining.toFixed(4)} remaining.`
        : null,
  };
}

/** Throw a DomainError the UI can render, or return null when within budget. */
export function assertBudget(budget) {
  if (budget.ok) return null;
  log.warn('spend budget exceeded', { status: budget.status, spent: budget.spentSoFar, limit: budget.limitCredits });
  return new DomainError(ErrorCode.BUDGET_EXCEEDED, budget.reason, budget);
}

/**
 * A rough pre-flight estimate so the user is not surprised by a $0.05 surprise.
 *
 * Derived from the observed costs of the reference run (5 model calls, ~9k tokens) rather than
 * a guess: roughly $0.016 per full analysis on the default routing.
 */
export const estimateAnalysisCost = (daysWithData = 5) =>
  Number((0.002 + daysWithData * 0.0028).toFixed(6));

export { ErrorCode };