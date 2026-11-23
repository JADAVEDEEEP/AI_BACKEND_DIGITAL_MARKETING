/**
 * Official, permitted web search APIs. Each returns raw results
 * ({ title, url, snippet }) which are converted into company candidates
 * by an AI extraction step that may only use what the results contain.
 */
const { withRetry } = require("../../../utils/retry");
const { HostRateLimiter } = require("../../../utils/concurrency");

async function getJson(url, headers, timeoutMs = 15000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Search API HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    const ra = Number(res.headers.get("retry-after"));
    if (Number.isFinite(ra)) err.retryAfterMs = Math.min(ra, 60) * 1000;
    throw err;
  }
  return res.json();
}

function createBraveProvider({ apiKey, resultsPerQuery = 20, minIntervalMs = 1100 }) {
  const limiter = new HostRateLimiter({ defaultIntervalMs: minIntervalMs });
  return {
    name: "brave",
    kind: "web",
    async search(query) {
      const results = [];
      const pageSize = 20;
      for (let offset = 0; results.length < resultsPerQuery && offset < 5; offset++) {
        await limiter.wait("brave");
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(pageSize));
        url.searchParams.set("offset", String(offset));
        const data = await withRetry(() =>
          getJson(url, { Accept: "application/json", "X-Subscription-Token": apiKey })
        );
        const page = (data?.web?.results || []).map((r) => ({
          title: r.title || "",
          url: r.url,
          snippet: r.description || "",
        }));
        results.push(...page);
        if (page.length < pageSize) break;
      }
      return { results: results.slice(0, resultsPerQuery) };
    },
  };
}

function createGoogleCseProvider({ apiKey, cx, resultsPerQuery = 20, minIntervalMs = 1100 }) {
  const limiter = new HostRateLimiter({ defaultIntervalMs: minIntervalMs });
  return {
    name: "google_cse",
    kind: "web",
    async search(query) {
      const results = [];
      // The Custom Search JSON API returns at most 10 per page and 100 total.
      for (let start = 1; results.length < resultsPerQuery && start <= 91; start += 10) {
        await limiter.wait("google_cse");
        const url = new URL("https://www.googleapis.com/customsearch/v1");
        url.searchParams.set("key", apiKey);
        url.searchParams.set("cx", cx);
        url.searchParams.set("q", query);
        url.searchParams.set("num", "10");
        url.searchParams.set("start", String(start));
        const data = await withRetry(() => getJson(url, { Accept: "application/json" }));
        const page = (data?.items || []).map((r) => ({
          title: r.title || "",
          url: r.link,
          snippet: r.snippet || "",
        }));
        results.push(...page);
        if (page.length < 10) break;
      }
      return { results: results.slice(0, resultsPerQuery) };
    },
  };
}

module.exports = { createBraveProvider, createGoogleCseProvider };
