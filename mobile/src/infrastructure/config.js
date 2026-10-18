const env = (typeof process !== 'undefined' && process.env) || {};
const { EXPO_PUBLIC_API_URL } = env;

export const DEFAULT_API_URL = 'https://tracker-ngzd.onrender.com';
export const BASE_URL = EXPO_PUBLIC_API_URL
  ? EXPO_PUBLIC_API_URL.replace(/\/$/, '')
  : DEFAULT_API_URL;

export const config = {
  baseUrl: BASE_URL,
  timeoutMs: 30000,
  saveTimeoutMs: 120000,
  aiTimeoutMs: 120000,
};

export const endpoints = {
  day: (date) => `/api/days/${date}`,
  plan: (date) => `/api/days/${date}/plan`,
  reflectionCoach: (date) => `/api/reflection-coach/${date}`,
  sheetsStatus: '/api/sheets/status',
};
