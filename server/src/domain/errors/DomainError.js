/**
 * DomainError — the only error type allowed to cross a layer boundary (clean arch rule 5).
 * Carries a stable machine-readable `code` so the UI can react without string-matching messages.
 */

export const ErrorCode = {
  // Normalisation
  MISSING_HEADER: 'MISSING_HEADER',
  UNKNOWN_UNIT: 'UNKNOWN_UNIT',
  UNPARSEABLE_VALUE: 'UNPARSEABLE_VALUE',
  IMPOSSIBLE_RANGE: 'IMPOSSIBLE_RANGE',

  // Analysis
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  NO_PROVIDER: 'NO_PROVIDER',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',

  // Spend control (NFR-2)
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',

  // Persistence / config
  CONFIG_MISSING: 'CONFIG_MISSING',
  PERSISTENCE_ERROR: 'PERSISTENCE_ERROR',
  FILE_NOT_READABLE: 'FILE_NOT_READABLE',
};

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}