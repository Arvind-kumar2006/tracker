/**
 * Application Configuration
 * Loads environment variables and provides default values.
 */

import 'dotenv/config';
import path from 'node:path';

// Get a required environment variable
const required = (name) => {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    throw new Error(
      `[config] ${name} is not set. Copy .env.example to .env and fill it in.\n` +
        `[config] See docs/SECURITY.md for how to obtain it.`
    );
  }

  return value.trim();
};

// Get an optional environment variable
const optional = (name, fallback) => {
  const value = process.env[name];

  return value && value.trim() !== ''
    ? value.trim()
    : fallback;
};

// Get a numeric environment variable
const int = (name, fallback) => {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
};

// Get a boolean environment variable
const bool = (name, fallback) => {
  const value = optional(name, null);

  if (value === null) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const runtimeEnv = optional('NODE_ENV', 'development');

// Application configuration
export const config = {
  // Environment
  env: runtimeEnv,

  // HTTP server configuration
  http: {
    port: int('PORT', 5555),
    // Keep local development loopback-only, but make hosted services reachable by their
    // platform health/port scanners without requiring a HOST secret or per-platform .env file.
    host: optional('HOST', runtimeEnv === 'production' ? '0.0.0.0' : '127.0.0.1'),
    rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 60),
    bodyLimit: optional('BODY_LIMIT', '1mb'),
  },

  // Excel file import configuration
  ingest: {
    watchFolder: path.resolve(
      optional('WATCH_FOLDER', path.resolve(process.cwd(), '..'))
    ),
    recursive: bool('WATCH_FOLDER_RECURSIVE', false),
  },

  // MongoDB configuration
  mongo: {
    uri: optional(
      'MONGO_URI',
      'mongodb://127.0.0.1:27017/study_tracker'
    ),
    dbName: optional('MONGO_DB_NAME', 'study_tracker'),
  },

  // OpenRouter AI configuration
  ai: {
    // Read the API key only when accessed.
    get apiKey() {
      return required('OPENROUTER_API_KEY');
    },

    baseUrl: optional(
      'OPENROUTER_BASE_URL',
      'https://openrouter.ai/api/v1'
    ),

    appUrl: optional(
      'OPENROUTER_APP_URL',
      'http://localhost:5555'
    ),

    appTitle: optional(
      'OPENROUTER_APP_TITLE',
      'Study Accountability Tracker'
    ),

    fastModel: optional(
      'MODEL_FAST',
      'google/gemini-2.5-flash'
    ),

    strongModel: optional(
      'MODEL_STRONG',
      'anthropic/claude-sonnet-4.6'
    ),

    fallbackFastModel: optional(
      'MODEL_FAST_FALLBACK',
      'openai/gpt-4o-mini'
    ),

    fallbackStrongModel: optional(
      'MODEL_STRONG_FALLBACK',
      'google/gemini-2.5-pro'
    ),

    // OpenRouter's free router is the final safety net for accounts that have not
    // purchased credits. Paid models remain preferred when they are available.
    freeModel: optional(
      'MODEL_FREE',
      'openrouter/free'
    ),

    freeFallbackModel: optional(
      'MODEL_FREE_FALLBACK',
      'nvidia/nemotron-3.5-super-vl:free'
    ),

    temperatureAnalysis: Number(
      optional('TEMP_ANALYSIS', '0.2')
    ),

    temperatureCreative: Number(
      optional('TEMP_CREATIVE', '0.6')
    ),

    maxTokens: int('AI_MAX_TOKENS', 3000),

    monthlyBudgetCredits: Number(
      optional('AI_MONTHLY_BUDGET_CREDITS', '0.50')
    ),
  },

  // Google Sheets configuration
  sheets: {
    // Read the service account JSON only when accessed.
    get serviceAccountJson() {
      return required('GOOGLE_SERVICE_ACCOUNT_JSON');
    },

    spreadsheetId: optional('SHEET_ID', null),
  },

  // Default daily study goal in hours
  monthlyGoalDefaultTargetHours: Number(
    optional('DEFAULT_TARGET_DAILY_HOURS', '4')
  ),
};

// Default export
export default config;
