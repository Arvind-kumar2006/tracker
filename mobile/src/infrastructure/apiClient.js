/** The only mobile module that performs network calls. */

import { ok, err, httpError } from '../shared/result.js';
import { config, endpoints, BASE_URL } from './config.js';

async function request(path, { method = 'GET', body, timeoutMs = config.timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!res.ok) {
      return httpError(res.status, payload?.error?.message ?? `Request failed (${res.status})`, payload);
    }
    return ok(payload);
  } catch (e) {
    if (e.name === 'AbortError') {
      return err(Object.assign(new Error('The server took too long to respond.'), { code: 'TIMEOUT' }));
    }
    return err(Object.assign(
      new Error(
        `Cannot reach the tracker server at ${config.baseUrl}. ` +
        'Is it running (`npm start` in server/), and is EXPO_PUBLIC_API_URL correct?'
      ),
      { code: 'NETWORK', baseUrl: config.baseUrl },
    ));
  } finally {
    clearTimeout(timer);
  }
}

export function createApiClient() {
  return {
    baseUrl: BASE_URL,
    getDay: (date) => request(endpoints.day(date)),
    getReflectionCoach: (date) => request(endpoints.reflectionCoach(date), { timeoutMs: config.aiTimeoutMs }),
    getSheetsStatus: () => request(endpoints.sheetsStatus),
    saveDailyEntry: (entry) => request(endpoints.day(entry.date), {
      method: 'PUT',
      body: entry,
      timeoutMs: config.saveTimeoutMs,
    }),
    saveDailyPlan: (date, plan) => request(endpoints.plan(date), {
      method: 'PUT',
      body: plan,
      timeoutMs: config.saveTimeoutMs,
    }),
  };
}
