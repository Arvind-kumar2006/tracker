/**
 * CircuitBreaker — fail fast instead of burning credits against a provider that is already down.
 *
 * The retry/fallback logic in the OpenRouter adapter is good at handling a single blip. It is
 * actively harmful during an outage: 3 retries x 2 models x 5 graph nodes x N regeneration
 * passes means a provider being down for an hour can cost real money and produce a UI that
 * hangs. The breaker short-circuits that.
 *
 * States:
 *   CLOSED     normal operation; failures counted
 *   OPEN       failing fast and immediately; no request leaves the process
 *   HALF_OPEN  one probe allowed through after the cooldown, to test recovery
 */

// src/infrastructure/ai/ -> two levels up reaches src/.
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';

export const State = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

export class CircuitBreaker {
  /**
   * @param {object} opts
   * @param {number} opts.failureThreshold - consecutive failures that trip the breaker
   * @param {number} opts.cooldownMs - how long to stay open before probing
   * @param {Function} [opts.now] - injectable clock for tests
   */
  constructor({ name = 'default', failureThreshold = 3, cooldownMs = 60_000, now = () => Date.now() } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;

    this.state = State.CLOSED;
    this.failures = 0;
    this.openedAt = null;
    this.trips = 0;
    this.rejected = 0;
  }

  /** Whether a call should be attempted right now. */
  canAttempt() {
    if (this.state === State.CLOSED) return true;
    if (this.state === State.OPEN) {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = State.HALF_OPEN;
        return true;
      }
      return false;
    }
    // HALF_OPEN admits exactly one probe; further callers are refused until it resolves.
    return true;
  }

  onSuccess() {
    this.failures = 0;
    this.state = State.CLOSED;
    this.openedAt = null;
  }

  onFailure() {
    this.failures += 1;
    if (this.state === State.HALF_OPEN || this.failures >= this.failureThreshold) {
      if (this.state === State.CLOSED) this.trips += 1;
      this.state = State.OPEN;
      this.openedAt = this.now();
    }
  }

  /** Throw or return null. Call after `canAttempt()`. */
  guard() {
    if (this.canAttempt()) return null;
    this.rejected += 1;
    const waitMs = Math.max(0, this.cooldownMs - (this.now() - this.openedAt));
    return new DomainError(
      ErrorCode.NO_PROVIDER,
      `AI provider circuit is open after ${this.trips} trip(s). Retrying in ${Math.ceil(waitMs / 1000)}s — ` +
        'refusing to spend more credits while it is down.',
      { breaker: this.name, state: this.state, waitMs }
    );
  }

  snapshot() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.failures,
      trips: this.trips,
      rejected: this.rejected,
      cooldownMs: this.cooldownMs,
    };
  }

  reset() {
    this.state = State.CLOSED;
    this.failures = 0;
    this.openedAt = null;
  }
}

/** The breaker guarding the AI provider. */
export const aiBreaker = new CircuitBreaker({
  name: 'openrouter',
  failureThreshold: 3,
  cooldownMs: 60_000,
});