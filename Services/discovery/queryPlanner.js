/**
 * Generates search queries for each discovery round. Uses the AI planner
 * when available and always mixes in deterministic combinations so that
 * discovery still works (and stays diverse) if the planner fails.
 */
const { queryPlanPrompt } = require("../../prompts/discoveryPrompts");

const arr = (v) =>
  Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v || "")
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

const SIGNAL_TEMPLATES = [
  "{industry} companies in {location}",
  "{industry} brands {location}",
  "independent {industry} business {location}",
  "growing {industry} startups {location}",
  "{industry} company hiring marketing manager {location}",
  "new {industry} brand launch {location} 2026",
  "local {industry} business {location} website",
  "top rated {industry} {location}",
  "family owned {industry} {location}",
  "{industry} ecommerce store {location}",
];

function deterministicQueries(profile, round, count) {
  const industries = arr(profile.targetIndustries);
  const locations = arr(profile.targetLocations);
  const inds = industries.length ? industries : [profile.agencyType ? "small business" : "company"];
  const locs = locations.length ? locations : [""];

  const all = [];
  for (const tpl of SIGNAL_TEMPLATES) {
    for (const industry of inds) {
      for (const location of locs) {
        all.push(
          tpl
            .replace("{industry}", industry)
            .replace("{location}", location ? `in ${location}`.replace(/^in in /, "in ") : "")
            .replace(/\s+in in\s+/, " in ")
            .replace(/\s+/g, " ")
            .trim()
        );
      }
    }
  }
  const start = ((round - 1) * count) % Math.max(1, all.length);
  return [...all.slice(start), ...all.slice(0, start)].slice(0, count);
}

async function planQueries({ ai, profile, round, previousQueries, count, log }) {
  const seen = new Set(previousQueries.map((q) => q.toLowerCase().trim()));
  const pick = (list) => {
    const out = [];
    for (const q of list) {
      const key = String(q || "").toLowerCase().trim();
      if (!key || key.length > 200 || seen.has(key)) continue;
      seen.add(key);
      out.push(String(q).trim());
    }
    return out;
  };

  let aiQueries = [];
  if (ai) {
    try {
      const { data } = await ai.generateJSON({
        prompt: queryPlanPrompt({ profile, round, previousQueries, count }),
        stage: "discovery.plan",
        temperature: 0.4,
        log,
      });
      aiQueries = pick(Array.isArray(data?.queries) ? data.queries : []);
    } catch (err) {
      log?.warn("discovery.plan.failed", { round, error: err.message });
    }
  }

  const fallback = pick(deterministicQueries(profile, round, count * 2));
  // ~75% AI queries, the rest deterministic, to keep both diversity & coverage.
  const aiShare = Math.ceil(count * 0.75);
  const queries = [...aiQueries.slice(0, aiShare), ...fallback];
  for (const q of aiQueries.slice(aiShare)) if (queries.length < count) queries.push(q);
  return queries.slice(0, count);
}

module.exports = { planQueries, deterministicQueries, arr };
