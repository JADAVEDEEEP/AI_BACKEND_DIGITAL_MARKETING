/**
 * Centralised configuration for the discovery pipeline.
 * All values are overridable via environment variables.
 */
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) =>
  v === undefined || v === "" ? d : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());

function load() {
  const env = process.env;

  return {
    env: env.NODE_ENV || "development",

    mongo: {
      uri: env.MONGODB_URI || "",
    },

    gemini: {
      apiKey: env.GEMINI_API_KEY || "",
      // Same default model the existing /api/research flow uses.
      model: env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      // Model used for the final top-10 evaluation (can be a stronger model).
      finalModel: env.GEMINI_FINAL_MODEL || env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      concurrency: int(env.AI_CONCURRENCY, 3),
      retries: int(env.AI_RETRIES, 4),
      timeoutMs: int(env.AI_TIMEOUT_MS, 120000),
      useSearchGrounding: bool(env.GEMINI_SEARCH_GROUNDING, true),
    },

    search: {
      braveApiKey: env.BRAVE_SEARCH_API_KEY || "",
      googleCseApiKey: env.GOOGLE_CSE_API_KEY || "",
      googleCseId: env.GOOGLE_CSE_ID || "",
      resultsPerQuery: int(env.SEARCH_RESULTS_PER_QUERY, 20),
      concurrency: int(env.SEARCH_CONCURRENCY, 2),
      minIntervalMs: int(env.SEARCH_MIN_INTERVAL_MS, 1100),
    },

    discovery: {
      // Safety cap, not a target: discovery stops earlier on saturation.
      defaultMaxCandidates: int(env.DISCOVERY_DEFAULT_MAX_CANDIDATES, 500),
      hardMaxCandidates: int(env.DISCOVERY_HARD_MAX_CANDIDATES, 5000),
      maxRounds: int(env.DISCOVERY_MAX_ROUNDS, 6),
      queriesPerRound: int(env.DISCOVERY_QUERIES_PER_ROUND, 12),
      // Stop when a round yields fewer than this share of new companies.
      saturationRatio: Number(env.DISCOVERY_SATURATION_RATIO || 0.1),
      qualifyBatchSize: int(env.QUALIFY_BATCH_SIZE, 15),
      minQualifiedScore: int(env.MIN_QUALIFIED_SCORE, 40),
      topN: 10,
    },

    crawler: {
      userAgent:
        env.CRAWLER_USER_AGENT ||
        "AgencyLeadDiscoveryBot/1.0 (+https://example.com/bot; respects robots.txt)",
      robotsUserAgentToken: env.CRAWLER_ROBOTS_TOKEN || "AgencyLeadDiscoveryBot",
      concurrency: int(env.CRAWLER_CONCURRENCY, 8),
      perHostIntervalMs: int(env.CRAWLER_PER_HOST_INTERVAL_MS, 1500),
      maxCrawlDelayMs: int(env.CRAWLER_MAX_CRAWL_DELAY_MS, 30000),
      timeoutMs: int(env.CRAWLER_TIMEOUT_MS, 12000),
      maxBytes: int(env.CRAWLER_MAX_BYTES, 1500000),
      maxPagesPerSite: int(env.CRAWLER_MAX_PAGES_PER_SITE, 3),
      maxRedirects: 5,
      retries: int(env.CRAWLER_RETRIES, 2),
      cacheTtlMs: int(env.CRAWLER_CACHE_TTL_HOURS, 168) * 3600 * 1000,
      robotsCacheTtlMs: 24 * 3600 * 1000,
      // Block requests to private/loopback networks (SSRF protection).
      allowPrivateNetwork: bool(env.CRAWLER_ALLOW_PRIVATE_NETWORK, false),
      // "role_based" keeps only generic business mailboxes (info@, sales@…).
      contactEmailPolicy: env.CONTACT_EMAIL_POLICY || "role_based",
    },

    jobs: {
      concurrency: int(env.JOB_CONCURRENCY, 2),
      leaseMs: int(env.JOB_LEASE_MS, 120000),
      pollIntervalMs: int(env.JOB_POLL_INTERVAL_MS, 5000),
      maxAttempts: int(env.JOB_MAX_ATTEMPTS, 3),
      enabled: bool(env.DISCOVERY_WORKER_ENABLED, true),
    },
  };
}

const config = load();
config.reload = () => Object.assign(config, load());

module.exports = config;
