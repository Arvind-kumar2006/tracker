/**
 * Server addressing.
 *
 * The backend binds 127.0.0.1 by default, so the iOS simulator can reach it as `localhost`
 * with zero LAN exposure (it shares the Mac's network stack). Android's emulator needs the
 * host-loopback alias. Physical-device access is intentionally not enabled by this local setup.
 *
 * That trade-off is why this file is the ONLY place that knows a URL, and why the value comes
 * from EXPO_PUBLIC_API_URL rather than being hardcoded per-platform in several components.
 */

import { Platform } from 'react-native';

const env = (typeof process !== 'undefined' && process.env) || {};
const { EXPO_PUBLIC_API_URL } = env;

/** Host loopback alias for the Android emulator. */
export const ANDROID_EMULATOR_HOST = '10.0.2.2';

export const DEFAULT_PORT = 5555;

export const LAN_HINT =
  'Physical-device access is unavailable while the backend is restricted to localhost.';

/**
 * Resolve the API base URL.
 * Order: explicit env var -> platform-appropriate loopback default.
 */
export function resolveBaseUrl() {
  if (EXPO_PUBLIC_API_URL) return EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  const host = Platform.OS === 'android' ? ANDROID_EMULATOR_HOST : 'localhost';
  return `http://${host}:${DEFAULT_PORT}`;
}

export const BASE_URL = resolveBaseUrl();

/** True when the app is pointed at something other than the Mac's loopback. */
export const isLanAddress = /^https?:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2)/.test(BASE_URL);

export const config = {
  baseUrl: BASE_URL,
  timeoutMs: 30000,
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
