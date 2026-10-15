/**
 * OpenRouterAdapter — the LLMPort implementation.
 *
 * Uses LangChain's ChatOpenAI pointed at OpenRouter's OpenAI-compatible endpoint. Benefits:
 *   - `withStructuredOutput(schema)` gives us schema-enforced JSON rather than hopeful parsing;
 *   - `usage_metadata` carries OpenRouter's credit cost, which we persist per insight so the
 *     budget ceiling in the PRD is auditable rather than guessed.
 *
 * Two resilience behaviours, both required by the PRD:
 *   - model fallback: if the primary model errors (provider 5xx, rate limit, moderation), retry
 *     once with a configured secondary model and record `fellBack`;
 *   - retry with jittered backoff on 429/5xx before falling back.
 */

import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config/env.js';
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';
import { aiBreaker } from './circuitBreaker.js';
import { logger } from '../../shared/logger.js';

const log = logger.child('ai');

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * 250);

/** Model per task, with its configured fallback. */
const MODEL_MAP = {
  detectPatterns: { primary: () => config.ai.fastModel, fallback: () => config.ai.fallbackFastModel },
  critique: { primary: () => config.ai.strongModel, fallback: () => config.ai.fallbackStrongModel },
  coach: { primary: () => config.ai.strongModel, fallback: () => config.ai.fallbackStrongModel },
  critiquePlans: { primary: () => config.ai.strongModel, fallback: () => config.ai.fallbackStrongModel },
};

export function createOpenRouterAdapter({ apiKey } = {}) {
  const key = apiKey ?? config.ai.apiKey; // throws a clear error when unset

  const build = (model, temperature, maxTokens) =>
    new ChatOpenAI({
      model,
      apiKey: key,
      temperature,
      maxTokens,
      timeout: 90_000,
      maxRetries: 0, // we do our own retry so we can fall back between models
      configuration: {
        baseURL: config.ai.baseUrl,
        defaultHeaders: {
          'HTTP-Referer': config.ai.appUrl,
          'X-OpenRouter-Title': config.ai.appTitle,
        },
      },
    });

  const extractUsage = (result) => {
    const usage = result?.usage_metadata ?? {};
    // OpenRouter returns credit cost in its own metadata; LangChain surfaces it here.
    const meta = result?.response_metadata?.['openrouter'] ?? result?.response_metadata ?? {};
    const cost =
      meta?.cost ??
      meta?.usage?.cost ??
      parseFloat(result?.response_metadata?.['x-openrouter-cost']) ??
      0;
    return {
      tokens: usage.total_tokens ?? 0,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cost: Number.isFinite(cost) ? cost : 0,
    };
  };

  const isRetryable = (err) => {
    const s = err?.status ?? err?.statusCode ?? err?.response?.status;
    if (s && RETRYABLE_STATUS.has(s)) return true;
    const msg = String(err?.message ?? '').toLowerCase();
    return (
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('overloaded') ||
      msg.includes('502') ||
      msg.includes('503')
    );
  };

  /**
   * Run a structured call with retry + model fallback, behind a circuit breaker.
   *
   * The breaker sits in FRONT of the retry loop: retrying hard against a provider that is
   * genuinely down turns one outage into a large bill. Failures here are provider failures, so
   * they trip the breaker; they do not count against the input/data error budget.
   */
  async function structured({ task, system, prompt, schema, temperature, maxTokens }) {
    const open = aiBreaker.guard();
    if (open) throw open;

    const models = MODEL_MAP[task] ?? MODEL_MAP.critique;
    const candidates = [
      { model: models.primary(), fellBack: false },
      { model: models.fallback(), fellBack: true },
    ];

    let lastError = null;

    for (const candidate of candidates) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const llm = build(
            candidate.model,
            temperature ?? config.ai.temperatureAnalysis,
            maxTokens ?? config.ai.maxTokens
          );
          const structuredLlm = llm.withStructuredOutput(schema, { name: `${task}Output` });

          const result = await structuredLlm.invoke([
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ]);

          const usage = extractUsage(result);
          aiBreaker.onSuccess();
          log.debug('llm call ok', { task, model: candidate.model, tokens: usage.tokens, cost: usage.cost, fellBack: candidate.fellBack });
          return { data: result, model: candidate.model, fellBack: candidate.fellBack, ...usage };
        } catch (err) {
          lastError = err;
          if (!isRetryable(err)) break; // non-retryable: skip straight to the fallback model
          if (attempt < 3) await sleep(jitter(500 * 2 ** (attempt - 1)));
        }
      }
    }

    // Every model failed: that is a provider outage, not a bad request.
    aiBreaker.onFailure();
    log.warn('llm call failed on all models', { task, breaker: aiBreaker.snapshot(), lastError: lastError?.message });
    throw new DomainError(
      ErrorCode.UPSTREAM_ERROR,
      `LLM task "${task}" failed on all models: ${lastError?.message ?? 'unknown error'}`,
      { task, attempts: candidates.length * 3, breaker: aiBreaker.snapshot() }
    );
  }

  /**
   * Stream plain text (used for the conversational "ask about my data" path).
   */
  async function* stream({ task = 'critique', system, prompt, temperature, maxTokens }) {
    const models = MODEL_MAP[task] ?? MODEL_MAP.critique;
    const llm = build(models.primary(), temperature ?? config.ai.temperatureCreative, maxTokens ?? config.ai.maxTokens);

    const stream_ = await llm.stream([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]);

    for await (const chunk of stream_) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (text) yield text;
    }
  }

  return { structured, stream };
}

/** A deterministic offline adapter, used by tests and by anyone without an API key. */
export function createFakeAdapter(responses = {}) {
  return {
    structured: async ({ task, schema }) => {
      const payload = responses[task];
      if (payload === undefined) {
        throw new DomainError(ErrorCode.UPSTREAM_ERROR, `fake adapter has no canned response for "${task}"`);
      }
      return {
        data: typeof payload === 'function' ? payload() : payload,
        model: 'fake/model',
        fellBack: false,
        tokens: 1234,
        inputTokens: 1000,
        outputTokens: 234,
        cost: 0.00042,
      };
    },
    async *stream() {
      yield 'fake stream';
    },
  };
}