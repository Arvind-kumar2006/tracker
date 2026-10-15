/**
 * ErrorBudget — the reliability accounting PRD Phase 6 calls for.
 *
 * The question an error budget answers is not "did something fail?" but "are we failing more
 * than we decided to tolerate?". A tool that imports your month, spends money on AI, and writes
 * to your spreadsheet needs a stated tolerance before you trust it unattended.
 *
 * Failures are bucketed by CAUSE, not by message, because the cause determines the response:
 *
 *   PROVIDER    OpenRouter is down / rate-limited   -> back off, spend nothing, tell the user
 *   UPSTREAM    Google Sheets rejected a write     -> safe to retry; Mongo is still correct
 *   PERSISTENCE Mongo unavailable / write refused  -> STOP; retrying risks duplicates
 *   INPUT       the user's file or payload is bad  -> do NOT retry; ask the user
 *   NETWORK     the phone cannot reach us          -> do NOT retry; nothing is wrong server-side
 *   INTERNAL    our bug                            -> fix the code
 *
 * Retrying an INPUT error forever, or a PERSISTENCE error blindly, is how a local tool quietly
 * burns a whole evening's worth of API credits.
 */

export const Cause = {
  PROVIDER: 'PROVIDER',
  UPSTREAM: 'UPSTREAM',
  PERSISTENCE: 'PERSISTENCE',
  INPUT: 'INPUT',
  NETWORK: 'NETWORK',
  INTERNAL: 'INTERNAL',
};

/** Which causes are worth retrying automatically, and which are terminal. */
export const RETRYABLE = new Set([Cause.PROVIDER, Cause.UPSTREAM, Cause.NETWORK]);

const PROVIDER_HINTS = ['openrouter', 'rate limit', '429', 'overloaded', 'model', 'completion', 'llm'];
const PERSISTENCE_HINTS = ['mongo', 'econnrefused 27017', 'duplicate key', 'document failed validation'];
const NETWORK_HINTS = ['econnrefused', 'enotfound', 'etimedout', 'fetch failed', 'socket hang up'];
const UPSTREAM_HINTS = ['google', 'sheets', 'permission denied', 'quota', '401', '403'];

/** Classify an error into a Cause. Pure and total — never throws. */
export function classifyError(error) {
  if (!error) return { cause: Cause.INTERNAL, retryable: false, reason: 'no error supplied' };

  const code = error.code ?? '';
  const name = error.name ?? '';
  const message = String(error.message ?? '').toLowerCase();
  const haystack = `${code} ${name} ${message}`;

  const has = (hints) => hints.some((h) => haystack.includes(h));

  // DomainError codes are the most reliable signal — they are assigned deliberately.
  if (code.startsWith('HTTP_')) {
    const status = Number(code.slice(5));
    const cause = status >= 500 ? Cause.UPSTREAM : Cause.INPUT;
    return { cause, retryable: RETRYABLE.has(cause), reason: `HTTP ${status}` };
  }
  if (['UNPARSEABLE_VALUE', 'MISSING_HEADER', 'FILE_NOT_READABLE', 'INSUFFICIENT_DATA'].includes(code)) {
    return { cause: Cause.INPUT, retryable: false, reason: `domain:${code}` };
  }
  if (code === 'CONFIG_MISSING') return { cause: Cause.INPUT, retryable: false, reason: 'configuration' };
  if (code === 'UPSTREAM_ERROR') return { cause: Cause.PROVIDER, retryable: true, reason: 'llm upstream' };
  if (code === 'NO_PROVIDER') return { cause: Cause.INPUT, retryable: false, reason: 'no api key configured' };
  if (code === 'BUDGET_EXCEEDED') return { cause: Cause.INPUT, retryable: false, reason: 'spend limit' };

  if (has(PROVIDER_HINTS)) return { cause: Cause.PROVIDER, retryable: true, reason: 'provider hints' };
  if (has(PERSISTENCE_HINTS)) return { cause: Cause.PERSISTENCE, retryable: false, reason: 'persistence hints' };
  if (has(UPSTREAM_HINTS)) return { cause: Cause.UPSTREAM, retryable: true, reason: 'upstream hints' };
  if (has(NETWORK_HINTS)) return { cause: Cause.NETWORK, retryable: true, reason: 'network hints' };

  return { cause: Cause.INTERNAL, retryable: false, reason: name || 'unclassified' };
}

/* ------------------------------------------------------------------ */

export const WINDOW_MS = 60 * 60 * 1000; // one hour

/**
 * Sliding-window counters. In-memory by design: this is a local single-process tool, and a
 * persisted counter would itself become a thing that can fail to persist.
 */
export class ErrorBudget {
  /**
   * @param {object} opts
   * @param {number} opts.maxFailureRate - tolerated fraction of operations, 0..1
   * @param {number} opts.windowMs
   */
  constructor({ maxFailureRate = 0.05, windowMs = WINDOW_MS } = {}) {
    this.maxFailureRate = maxFailureRate;
    this.windowMs = windowMs;
    this.events = [];
  }

  #prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    this.events = this.events.filter((e) => e.at >= cutoff);
  }

  /** Record a successful operation. */
  success(now = Date.now()) {
    this.#prune(now);
    this.events.push({ at: now, ok: true });
  }

  /** Record a failure and its classified cause. */
  failure(error, now = Date.now()) {
    this.#prune(now);
    const { cause, retryable, reason } = classifyError(error);
    this.events.push({ at: now, ok: false, cause, retryable, reason, code: error?.code ?? null });
    return { cause, retryable, reason };
  }

  snapshot(now = Date.now()) {
    this.#prune(now);
    const total = this.events.length;
    const failures = this.events.filter((e) => !e.ok);
    const byCause = failures.reduce((acc, e) => {
      acc[e.cause] = (acc[e.cause] ?? 0) + 1;
      return acc;
    }, {});

    const failureRate = total === 0 ? 0 : failures.length / total;
    const exhausted = total >= 5 && failureRate > this.maxFailureRate;

    return {
      windowMs: this.windowMs,
      operations: total,
      failures: failures.length,
      failureRate: Number(failureRate.toFixed(4)),
      maxFailureRate: this.maxFailureRate,
      byCause,
      exhausted,
      // A budget blown by terminal errors matters more than one blown by transient blips.
      blockingCauses: Object.entries(byCause)
        .filter(([cause]) => cause !== Cause.PROVIDER && cause !== Cause.UPSTREAM)
        .map(([cause, count]) => ({ cause, count })),
      lastFailure: failures.at(-1) ?? null,
    };
  }

  reset() {
    this.events = [];
  }
}

/** Process-wide budgets, one per subsystem. */
export const budgets = {
  ingest: new ErrorBudget({ maxFailureRate: 0.1 }),
  analysis: new ErrorBudget({ maxFailureRate: 0.25 }), // model calls fail more often, and cost money to retry
  sheets: new ErrorBudget({ maxFailureRate: 0.1 }),
  upload: new ErrorBudget({ maxFailureRate: 0.1 }),
};

export function snapshotAllBudgets() {
  return Object.fromEntries(Object.entries(budgets).map(([k, b]) => [k, b.snapshot()]));
}