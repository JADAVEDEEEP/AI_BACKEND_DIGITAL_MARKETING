/**
 * Shared Gemini client for the discovery pipeline.
 *
 * Reuses the same @google/genai integration, model and JSON parsing as
 * Services/ai.service.js, adding retries, a global concurrency limit,
 * timeouts and Google Search grounding source extraction.
 */
const { GoogleGenAI } = require("@google/genai");
const config = require("../config");
const logger = require("../utils/logger");
const { parseGeminiJSON } = require("../utils/parseGeminiJSON");
const { withRetry } = require("../utils/retry");
const { createLimiter } = require("../utils/concurrency");
const { AppError } = require("../utils/errors");

let client = null;
let limiter = null;

function getClient() {
  if (!config.gemini.apiKey) {
    throw new AppError("GEMINI_API_KEY is not configured.", {
      status: 500,
      code: "AI_NOT_CONFIGURED",
      retryable: false,
    });
  }
  if (!client) {
    client = new GoogleGenAI({
      apiKey: config.gemini.apiKey,
      httpOptions: { timeout: config.gemini.timeoutMs },
    });
  }
  return client;
}

function getLimiter() {
  if (!limiter) limiter = createLimiter(config.gemini.concurrency);
  return limiter;
}

/**
 * Extract web sources from grounding metadata (Google Search tool).
 */
function extractGroundingSources(response) {
  const chunks =
    response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const queries =
    response?.candidates?.[0]?.groundingMetadata?.webSearchQueries || [];

  const sources = chunks
    .map((c) => c?.web)
    .filter((w) => w && w.uri)
    .map((w) => ({ title: w.title || "", url: w.uri }));

  return { sources, queries };
}

/**
 * Generate JSON from Gemini.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.stage        Label for logs.
 * @param {boolean} [opts.useSearch] Enable Google Search grounding.
 * @param {number} [opts.temperature]
 * @param {string} [opts.model]
 * @param {object} [opts.log]        Child logger.
 * @returns {Promise<{data: any, grounding: {sources: object[], queries: string[]}, model: string}>}
 */
async function generateJSON({
  prompt,
  stage,
  useSearch = false,
  temperature = 0,
  model = config.gemini.model,
  log = logger,
}) {
  const ai = getClient();

  const genConfig = { temperature };

  if (useSearch) {
    // Search grounding: JSON mime type is not combinable with tools on
    // every model, so we rely on the prompt + tolerant JSON parser.
    genConfig.tools = [{ googleSearch: {} }];
  } else {
    genConfig.responseMimeType = "application/json";
  }

  return getLimiter()(() =>
    withRetry(
      async (attempt) => {
        const started = Date.now();
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: genConfig,
        });

        const text = response?.text?.trim();
        if (!text) {
          const err = new Error(`Gemini returned an empty response during ${stage}.`);
          err.retryable = true;
          throw err;
        }

        const data = parseGeminiJSON(text);
        const grounding = useSearch
          ? extractGroundingSources(response)
          : { sources: [], queries: [] };

        log.debug("gemini.success", {
          stage,
          attempt,
          model,
          promptLength: prompt.length,
          responseLength: text.length,
          durationMs: Date.now() - started,
        });

        return { data, grounding, model };
      },
      {
        retries: config.gemini.retries,
        minDelayMs: 1000,
        maxDelayMs: 30000,
        onRetry: (err, attempt, delay) =>
          log.warn("gemini.retry", {
            stage,
            attempt,
            delayMs: delay,
            status: err.status,
            error: err.message,
          }),
      }
    )
  );
}

/** Test hook: inject a fake client. */
function __setClient(fake) {
  client = fake;
}

module.exports = { generateJSON, extractGroundingSources, __setClient };
