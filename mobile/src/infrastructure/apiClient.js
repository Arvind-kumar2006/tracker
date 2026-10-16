/**
 * ApiGateway implementation — the only place in the app that performs network calls.
 */

import { ok, err, httpError } from '../shared/result.js';
import { config, endpoints, BASE_URL } from './config.js';

/** AbortController-based timeout, since RN's fetch has no built-in timeout. */
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
      const message = payload?.error?.message ?? `Request failed (${res.status})`;
      return httpError(res.status, message, payload);
    }
    return ok(payload);
  } catch (e) {
    if (e.name === 'AbortError') {
      return err(Object.assign(new Error('The server took too long to respond.'), { code: 'TIMEOUT' }));
    }
    // The single most common first-run failure: the backend is not running, or the app is
    // pointed at an address the device cannot reach. Say so plainly.
    return err(
      Object.assign(
        new Error(
          `Cannot reach the tracker server at ${config.baseUrl}. ` +
            'Is it running (`npm start` in server/), and is EXPO_PUBLIC_API_URL correct?'
        ),
        { code: 'NETWORK', baseUrl: config.baseUrl }
      )
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createApiClient() {
  return {
    baseUrl: BASE_URL,

    health: () => request(endpoints.health),
    getConfig: () => request(endpoints.config),

    getMonths: () => request(endpoints.months),
    getMonth: (m) => request(endpoints.month(m)),
    getDays: (m, { withData = false } = {}) =>
      request(`${endpoints.days(m)}${withData ? '?withData=true' : ''}`),
    getDay: (date) => request(endpoints.day(date)),
    getMetrics: (m) => request(endpoints.metrics(m)),
    getPrecheck: (m, { asOf } = {}) =>
      request(`${endpoints.precheck(m)}${asOf ? `?asOf=${asOf}` : ''}`),

    analyse: (m, { asOf } = {}) =>
      request(endpoints.analyse(m), { method: 'POST', body: { asOf }, timeoutMs: config.analysisTimeoutMs }),

    getInsights: (m) => request(endpoints.insights(m)),
    setInsightStatus: (id, status) => request(endpoints.insightStatus(id), { method: 'POST', body: { status } }),
    getPlanCritiques: () => request(endpoints.planCritiques),

    getQuarantine: () => request(endpoints.quarantine),
    resolveQuarantine: (id) => request(endpoints.resolveQuarantine(id), { method: 'POST', body: {} }),

    /** Write a daily entry created in the app. */
    saveDailyEntry: (entry) => request(`${endpoints.day(entry.date)}`, {
      method: 'PUT',
      body: entry,
      timeoutMs: config.saveTimeoutMs,
    }),
    saveDailyPlan: (date, plan) => request(endpoints.plan(date), {
      method: 'PUT',
      body: plan,
      timeoutMs: config.saveTimeoutMs,
    }),
    carryForwardPlan: (date, targetDate) => request(endpoints.planCarryForward(date), {
      method: 'POST',
      body: { targetDate },
      timeoutMs: config.saveTimeoutMs,
    }),
    generateDailyPlan: (date, input) => request(endpoints.planGenerate(date), {
      method: 'POST',
      body: input,
      timeoutMs: config.analysisTimeoutMs,
    }),
    checkDailyPlan: (date, plan) => request(endpoints.planCheck(date), {
      method: 'POST',
      body: plan,
      timeoutMs: config.analysisTimeoutMs,
    }),
    saveFocusSession: (date, session) => request(endpoints.focusSessions(date), {
      method: 'POST',
      body: session,
      timeoutMs: config.saveTimeoutMs,
    }),

    /** Large base64 payload — needs the longer timeout. */
    uploadWorkbooks: (files, opts = {}) =>
      request(endpoints.importUpload, {
        method: 'POST',
        body: { files, ...opts },
        timeoutMs: config.uploadTimeoutMs,
      }),

    scanFolder: (folder, opts = {}) => request(endpoints.importFolder, { method: 'POST', body: { folder, ...opts } }),
    preflightFolder: (folder) => request(`${endpoints.importPreflight}?folder=${encodeURIComponent(folder)}`),

    getSheetsStatus: () => request(endpoints.sheetsStatus),
    connectSheets: (opts = {}) => request(endpoints.sheetsConnect, { method: 'POST', body: opts }),
    syncSheets: (m, { dryRun = false } = {}) =>
      request(endpoints.sheetsSync(m), { method: 'POST', body: { dryRun } }),

    /** Phase 7: reflection quality check. */
    getReflectionQuestions: () => request(endpoints.reflectionQuestions),
    getReflectionQuality: (date) => request(`${endpoints.reflectionQuality(date)}`, { timeoutMs: config.analysisTimeoutMs }),
  };
}
