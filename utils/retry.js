const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decide whether an error is worth retrying (rate limits, transient
 * server errors and network failures).
 */
function isRetryableError(err) {
  if (!err) return false;
  if (err.retryable === false) return false;
  if (err.retryable === true) return true;

  const status = Number(err.status || err.statusCode || err.response?.status);
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  if (status >= 400 && status < 500) return false;

  const code = err.code || err.cause?.code;
  const transientCodes = [
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENOTFOUND",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "UND_ERR_HEADERS_TIMEOUT",
  ];
  if (transientCodes.includes(code)) return true;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;

  // Gemini occasionally returns malformed/partial JSON; retrying helps.
  if (/JSON|empty response/i.test(err.message || "")) return true;

  return false;
}

/**
 * Run fn with exponential backoff + full jitter.
 */
async function withRetry(fn, options = {}) {
  const {
    retries = 3,
    minDelayMs = 500,
    maxDelayMs = 15000,
    shouldRetry = isRetryableError,
    onRetry,
  } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;

      const retryAfter = Number(err.retryAfterMs) || 0;
      const backoff = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
      const delay = Math.max(retryAfter, Math.round(Math.random() * backoff));

      if (onRetry) onRetry(err, attempt + 1, delay);
      attempt++;
      await sleep(delay);
    }
  }
}

module.exports = { withRetry, isRetryableError, sleep };
