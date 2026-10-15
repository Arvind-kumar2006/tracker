/**
 * Logger — structured logging with PHI redaction.
 *
 * PRD NFR-6: journal text is highly personal and must be redacted from every log. The columns
 * it lives in (`accomplished`, `blockers`, `tomorrowChange`, plan text, and the AI prompts
 * built from them) are exactly the things a naive `console.log(JSON.stringify(state))` would
 * write to disk on every error.
 *
 * Design:
 *   - DENYLIST of field names whose values are never emitted. Redaction preserves the key and a
 *     length marker, so logs stay diagnosable ("blockers: <redacted 412 chars>") without
 *     leaking the content.
 *   - a hard length cap on any single string, as a backstop for a field nobody thought to list;
 *   - no third-party reporter, no file transport — stdout only, which is what NFR-6 assumes.
 *
 * Redaction is a pure function so it can be tested exhaustively without capturing output.
 */

/**
 * Fields whose values are journal content or derived from it.
 *
 * A denylist is inherently incomplete, and an early soak check proved it: `passiveDays[].evidence`
 * and `timeBlocks[].label` both carried verbatim journal text past a first-pass denylist. So the
 * list is now defence-in-depth, and call sites log SCALARS ONLY — passing a whole metrics object
 * or an entry into a log is the mistake this module exists to make survivable, not to encourage.
 */
export const PHI_KEYS = new Set([
  'accomplished',
  'blockers',
  'blockersRaw',
  'tomorrowChange',
  'buildNote',
  'summary',
  'items',
  'segments',
  'prompt',
  'system',
  'content',
  'daysText',
  // Verbatim journal quotes extracted for passive-learning detection.
  'evidence',
  'evidenceQuotes',
  // The user's own task names, written by hand in the workbook.
  'label',
  'quote',
  'body',
  'why',
  'firstStep',
  'action',
  'note',
  'issues',
  'rewrittenBlocks',
  'text',
  'rawValue',
  'userResponse',
  'private_key',
  'apiKey',
  'api_key',
  'token',
  'access_token',
  'password',
]);

/** Anything longer than this is truncated even if its key is not on the denylist. */
export const MAX_STRING = 200;

export const REDACTED = '<redacted>';

const marker = (value) => {
  const len = typeof value === 'string' ? value.length : undefined;
  return len === undefined ? REDACTED : `${REDACTED} ${len} chars`;
};

/**
 * Deep-redact a value. Cycles are handled; depth is bounded.
 */
export function redact(value, { depth = 0, seen = new WeakSet() } = {}) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (+${value.length - MAX_STRING} chars)` : value;
  }
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '<circular>';
  if (depth > 6) return '<depth-limit>';
  seen.add(value);

  if (Array.isArray(value)) {
    const out = value.slice(0, 20).map((v) => redact(v, { depth: depth + 1, seen }));
    if (value.length > 20) out.push(`… (+${value.length - 20} items)`);
    return out;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, code: value.code, message: value.message, stack: value.stack };
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = PHI_KEYS.has(k) ? marker(v) : redact(v, { depth: depth + 1, seen });
  }
  return out;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

let threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

/**
 * Create a logger. `scope` is a short subsystem tag, e.g. 'ai' or 'sheets'.
 *
 * `fields` should only ever contain operational metadata: counts, durations, ids, costs.
 */
export function createLogger(scope = 'app', fields = {}) {
  const log = (level, message, extra = {}) => {
    if (LEVELS[level] < threshold) return;
    const record = {
      t: new Date().toISOString(),
      level,
      scope,
      msg: message,
      ...redact({ ...fields, ...extra }),
    };
    const line = JSON.stringify(record);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (m, e) => log('debug', m, e),
    info: (m, e) => log('info', m, e),
    warn: (m, e) => log('warn', m, e),
    error: (m, e) => log('error', m, e),
    child: (childScope, childFields = {}) => createLogger(`${scope}:${childScope}`, { ...fields, ...childFields }),
  };
}

export const logger = createLogger('app');

export function setLogLevel(level) {
  if (LEVELS[level] !== undefined) threshold = LEVELS[level];
}

export const getLogLevel = () => Object.keys(LEVELS).find((k) => LEVELS[k] === threshold) ?? 'info';