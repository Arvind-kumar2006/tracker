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
  weeklyStatus: (date) => `/api/weeks/status?date=${encodeURIComponent(date)}`,
  weeklyPlan: (weekStart) => `/api/weeks/${weekStart}`,
  weeklyExtract: (weekStart) => `/api/weeks/${weekStart}/extract`,
  weeklyConfirm: (weekStart) => `/api/weeks/${weekStart}/confirm`,
  monthlyStatus: (date) => `/api/months/status?date=${encodeURIComponent(date)}`,
  monthlyPlan: (month) => `/api/months/${month}/plan`,
  monthlyExtract: (month) => `/api/months/${month}/plan/extract`,
  monthlyConfirm: (month) => `/api/months/${month}/plan/confirm`,
  month: (month) => `/api/months/${month}`,
  monthPlan: (month) => `/api/months/${month}/plan`,
};
