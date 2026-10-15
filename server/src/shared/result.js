/**
 * Result<T, DomainError> — the return convention used across every layer boundary.
 * Rule 5 of the clean-architecture contract: use cases never throw, they return.
 */

export const ok = (value) => ({ ok: true, value });

export const err = (error) => ({ ok: false, error });

/**
 * Unwrap or throw. Reserved for the composition points (graph nodes, HTTP controllers)
 * where throwing is the surrounding contract anyway.
 */
export function unwrap(result) {
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new TypeError('unwrap() called with a non-Result value');
  }
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}

/** Collect a list of Results into a Result of list. First error wins. */
export function all(results) {
  const values = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}