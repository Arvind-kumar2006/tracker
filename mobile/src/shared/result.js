/** Result type — the app never throws across a layer boundary. Mirrors the server's. */

export const ok = (value) => ({ ok: true, value });

/**
 * Build a failure Result.
 *
 * Accepts an Error OR a plain `{ code, message, ... }` object. The object form is common for
 * expected domain outcomes ("NO_SPREADSHEETS"), and naively wrapping it in `new Error(String(o))`
 * would stringify it to "[object Object]" and silently drop `code` — which is exactly what the
 * UI branches on to decide whether a message is worth showing at all.
 */
export const err = (error) => {
  if (error instanceof Error) return { ok: false, error };
  const e = new Error(error?.message ?? String(error));
  if (error && typeof error === 'object') Object.assign(e, error);
  return { ok: false, error: e };
};

export function unwrap(result) {
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new TypeError('unwrap() called with a non-Result value');
  }
  if (result.ok) return result.value;
  throw result.error;
}

/** A Result with extra HTTP context, used by the API gateway. */
export const httpError = (status, message, payload = null) =>
  err(Object.assign(new Error(message), { status, code: 'HTTP_' + status, payload }));