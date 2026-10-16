/**
 * Server addressing.
 *
 * The deployed Render backend is the default so the mobile app works on a physical device
 * without requiring a local server. Set EXPO_PUBLIC_API_URL to use a local backend instead.
 *
 * That trade-off is why this file is the ONLY place that knows a URL, and why the value comes
 * from EXPO_PUBLIC_API_URL rather than being hardcoded per-platform in several components.
 */

const env = (typeof process !== 'undefined' && process.env) || {};
const { EXPO_PUBLIC_API_URL } = env;

export const DEFAULT_API_URL = 'https://tracker-ngzd.onrender.com';

export const LAN_HINT = 'Using the deployed Render backend.';

/**
 * Resolve the API base URL.
 * Order: explicit env var -> deployed Render backend.
 */
export function resolveBaseUrl() {
  if (EXPO_PUBLIC_API_URL) return EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  return DEFAULT_API_URL;
}

export const BASE_URL = resolveBaseUrl();

/** True when the app is pointed at something other than the Mac's loopback. */
export const isLanAddress = /^https?:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2)/.test(BASE_URL);

export const config = {
  baseUrl: BASE_URL,
  timeoutMs: 30000,
  saveTimeoutMs: 120000, // saving also mirrors the entry to Google Sheets
  analysisTimeoutMs: 120000, // the graph runs up to 5 model calls
  uploadTimeoutMs: 120000,
};

/** Endpoints, in one place. */
export const endpoints = {
  health: '/health',
  config: '/api/config',
  importPreflight: '/api/import/preflight',
  importFolder: '/api/import',
  importUpload: '/api/import/upload',
  months: '/api/months',
  month: (m) => `/api/months/${m}`,
  days: (m) => `/api/months/${m}/days`,
  metrics: (m) => `/api/months/${m}/metrics`,
  precheck: (m) => `/api/analysis/${m}/precheck`,
  analyse: (m) => `/api/analysis/${m}`,
  insights: (m) => `/api/analysis/${m}/insights`,
  day: (d) => `/api/days/${d}`,
  plan: (d) => `/api/days/${d}/plan`,
  planCarryForward: (d) => `/api/days/${d}/plan/carry-forward`,
  planGenerate: (d) => `/api/days/${d}/plan/generate`,
  planCheck: (d) => `/api/days/${d}/plan/check`,
  focusSessions: (d) => `/api/days/${d}/focus-sessions`,
  insightStatus: (id) => `/api/insights/${id}/status`,
  planCritiques: '/api/plan-critiques',
  quarantine: '/api/quarantine',
  resolveQuarantine: (id) => `/api/quarantine/${id}/resolve`,
  sheetsStatus: '/api/sheets/status',
  sheetsConnect: '/api/sheets/connect',
  sheetsSync: (m) => `/api/sheets/sync/${m}`,
  reflectionQuestions: '/api/reflection-questions',
  reflectionQuality: (d) => `/api/reflection-quality/${d}`,
};
