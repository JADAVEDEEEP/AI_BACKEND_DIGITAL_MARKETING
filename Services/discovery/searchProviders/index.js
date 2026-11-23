/**
 * Discovery source registry.
 *
 * Every provider exposes: discover(query, ctx) -> Promise<Candidate[]>
 * where Candidate = { name, website, industry, location, sourceUrl,
 * snippet, provider, query }.
 *
 * - "gemini_grounded": Gemini + Google Search grounding (existing Gemini
 *   integration). Always available when GEMINI_API_KEY is set.
 * - "brave" / "google_cse": official search APIs, enabled by API keys.
 *   Raw results are turned into candidates by an AI extraction step that
 *   may only use names/domains present in the results.
 */
const {
  groundedDiscoveryPrompt,
  extractFromResultsPrompt,
} = require("../../../prompts/discoveryPrompts");
const { createBraveProvider, createGoogleCseProvider } = require("./webSearchApis");
const { isNonCompanyDomain, domainKey } = require("../../../utils/url");

const str = (v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function sanitizeCandidates(list, provider, query) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c === "object" && str(c.name))
    .map((c) => ({
      name: str(c.name, 200),
      website: str(c.website, 300),
      industry: str(c.industry, 120),
      location: str(c.location, 200),
      sourceUrl: str(c.sourceUrl, 1000),
      snippet: str(c.whyRelevant || c.snippet, 400),
      provider,
      query,
    }));
}

function createGeminiGroundedSource({ ai }) {
  return {
    name: "gemini_grounded",
    async discover(query, { profile, excludeNames, log }) {
      const { data, grounding } = await ai.generateJSON({
        prompt: groundedDiscoveryPrompt({ profile, query, excludeNames }),
        stage: "discovery.grounded",
        useSearch: true,
        temperature: 0.2,
        log,
      });
      const candidates = sanitizeCandidates(data?.companies, "gemini_grounded", query);
      // Attach grounding sources as discovery provenance.
      const groundingSources = (grounding?.sources || []).slice(0, 20);
      return candidates.map((c) => ({ ...c, groundingSources }));
    },
  };
}

function createWebSearchSource({ provider, ai, batchSize = 20 }) {
  return {
    name: provider.name,
    async discover(query, { profile, log }) {
      const { results } = await provider.search(query);
      if (!results.length) return [];

      const out = [];
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize);
        const { data } = await ai.generateJSON({
          prompt: extractFromResultsPrompt({ profile, results: batch }),
          stage: `discovery.extract.${provider.name}`,
          temperature: 0,
          log,
        });
        const allowedUrls = new Set(batch.map((r) => r.url));
        const allowedDomains = new Set(batch.map((r) => domainKey(r.url)).filter(Boolean));
        const blob = JSON.stringify(batch).toLowerCase();

        for (const c of sanitizeCandidates(data?.companies, provider.name, query)) {
          // Anti-fabrication: the company website must appear in the results
          // (as a result domain or literally in the text); otherwise drop it.
          const d = domainKey(c.website);
          if (c.website && !(allowedDomains.has(d) || (d && blob.includes(d)))) c.website = "";
          if (c.sourceUrl && !allowedUrls.has(c.sourceUrl)) c.sourceUrl = batch[0].url;
          const res = batch.find((r) => r.url === c.sourceUrl);
          if (res && !c.snippet) c.snippet = str(res.snippet, 400);
          out.push(c);
        }
      }
      return out;
    },
  };
}

function buildDiscoverySources({ config, ai }) {
  const sources = [];
  if (config.gemini.apiKey && config.gemini.useSearchGrounding) {
    sources.push(createGeminiGroundedSource({ ai }));
  }
  if (config.search.braveApiKey) {
    sources.push(
      createWebSearchSource({
        ai,
        provider: createBraveProvider({
          apiKey: config.search.braveApiKey,
          resultsPerQuery: config.search.resultsPerQuery,
          minIntervalMs: config.search.minIntervalMs,
        }),
      })
    );
  }
  if (config.search.googleCseApiKey && config.search.googleCseId) {
    sources.push(
      createWebSearchSource({
        ai,
        provider: createGoogleCseProvider({
          apiKey: config.search.googleCseApiKey,
          cx: config.search.googleCseId,
          resultsPerQuery: config.search.resultsPerQuery,
          minIntervalMs: config.search.minIntervalMs,
        }),
      })
    );
  }
  return sources;
}

/**
 * Website resolver: for candidates found without a website, look up the
 * official domain using a web search API (never guessed by the AI).
 */
function createWebsiteResolver({ config }) {
  let provider = null;
  if (config.search.braveApiKey) {
    provider = createBraveProvider({ apiKey: config.search.braveApiKey, resultsPerQuery: 5 });
  } else if (config.search.googleCseApiKey && config.search.googleCseId) {
    provider = createGoogleCseProvider({
      apiKey: config.search.googleCseApiKey,
      cx: config.search.googleCseId,
      resultsPerQuery: 5,
    });
  }
  if (!provider) return null;

  const tokens = (name) =>
    name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);

  return async function resolveWebsite(name, location) {
    const { results } = await provider.search(`"${name}" ${location || ""} official website`.trim());
    const nameTokens = tokens(name);
    for (const r of results) {
      if (!r.url || isNonCompanyDomain(r.url)) continue;
      const hay = `${r.title} ${domainKey(r.url)}`.toLowerCase();
      const matched = nameTokens.filter((t) => hay.includes(t)).length;
      if (nameTokens.length && matched / nameTokens.length >= 0.5) {
        return { website: r.url, sourceUrl: r.url, snippet: r.snippet };
      }
    }
    return null;
  };
}

module.exports = {
  buildDiscoverySources,
  createWebsiteResolver,
  createGeminiGroundedSource,
  createWebSearchSource,
  sanitizeCandidates,
};
