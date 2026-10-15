/**
 * Env — configuration loading. Lives in infrastructure because it touches process.env.
 * Fails loudly and early if a required secret is missing: a silent default here would mean a
 * missing OpenRouter key surfaces as a confusing 401 halfway through a user's analysis.
 */

import 'dotenv/config';
import path from 'node:path';

const required = (name) => {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `[config] ${name} is not set. Copy .env.example to .env and fill it in.\n` +
        `[config] See docs/SECURITY.md for how to obtain it.`
    );
  }
  return v.trim();
};

const optional = (name, fallback) => {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
};

const int = (name, fallback) => {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const bool = (name, fallback) => {
  const v = optional(name, null);
  if (v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

/**
 * OPENROUTER_API_KEY and GOOGLE_SERVICE_ACCOUNT_JSON are read lazily so that the folder-import
 * and pure-domain paths can run (and be tested) without any secrets configured at all.
 */
export const config = {
  env: optional('NODE_ENV', 'development'),

  http: {
    // 127.0.0.1 by default: the simulator reaches it as localhost, with zero LAN exposure.
    // Set HOST=0.0.0.0 only when testing on a physical device.
    host: optional('HOST', '127.0.0.1'),
    port: int('PORT', 3000),
    rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 60),
    bodyLimit: optional('BODY_LIMIT', '1mb'),
  },

  ingest: {
    // Where the backend's folder scan looks for .xlsx files (PRD FR-1.3).
    watchFolder: path.resolve(optional('WATCH_FOLDER', path.resolve(process.cwd(), '..'))),
    recursive: bool('WATCH_FOLDER_RECURSIVE', false),
  },

  mongo: {
    uri: optional('MONGO_URI', 'mongodb://127.0.0.1:27017/study_tracker'),
    dbName: optional('MONGO_DB_NAME', 'study_tracker'),
  },

  ai: {
    get apiKey() {
      return required('OPENROUTER_API_KEY');
    },
    baseUrl: optional('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    appUrl: optional('OPENROUTER_APP_URL', 'http://localhost:3000'),
    appTitle: optional('OPENROUTER_APP_TITLE', 'Study Accountability Tracker'),
    fastModel: optional('MODEL_FAST', 'google/gemini-2.5-flash'),
    strongModel: optional('MODEL_STRONG', 'anthropic/claude-sonnet-4.6'),
    fallbackFastModel: optional('MODEL_FAST_FALLBACK', 'openai/gpt-4o-mini'),
    fallbackStrongModel: optional('MODEL_STRONG_FALLBACK', 'google/gemini-2.5-pro'),
    temperatureAnalysis: Number(optional('TEMP_ANALYSIS', '0.2')),
    temperatureCreative: Number(optional('TEMP_CREATIVE', '0.6')),
    maxTokens: int('AI_MAX_TOKENS', 3000),
    monthlyBudgetCredits: Number(optional('AI_MONTHLY_BUDGET_CREDITS', '0.50')),
  },

  sheets: {
    get serviceAccountJson() {
      return required('GOOGLE_SERVICE_ACCOUNT_JSON');
    },
    spreadsheetId: optional('SHEET_ID', null),
  },

  monthlyGoalDefaultTargetHours: Number(optional('DEFAULT_TARGET_DAILY_HOURS', '4')),
};

export default config;