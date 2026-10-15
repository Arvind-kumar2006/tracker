/**
 * LLMPort — the interface the application layer depends on.
 *
 * The graph never imports OpenRouter or LangChain directly; it receives an implementation of
 * this port. That is what lets the entire pipeline be tested with a fake model and no API key,
 * and what would let a different provider be swapped in without touching the graph.
 *
 * @typedef {object} LLMPort
 * @property {(req: {task: string, system: string, prompt: string, schema: object}) => Promise<LlmResult>} structured
 * @property {(req: {task: string, system: string, prompt: string}) => AsyncIterable<string>} stream
 */

/**
 * @typedef {object} LlmResult
 * @property {object} data      parsed, schema-validated output
 * @property {string} model     model actually used (may differ from requested via fallback)
 * @property {number} tokens    total tokens
 * @property {number} cost      credits spent, from OpenRouter's usage.cost
 * @property {boolean} fellBack whether the primary model failed and a fallback served this
 */

