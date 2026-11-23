/**
 * AI qualification of discovered + verified companies, in batches.
 * The model sees only scraped/search evidence; outputs are validated and
 * scores are recomputed server-side (see scoring.js).
 */
const {
  qualificationPrompt,
  PROMPT_VERSION,
} = require("../../prompts/discoveryPrompts");
const { buildScore, computeEvidenceScore } = require("./scoring");

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function toEvidencePayload(c) {
  const p = c.profile || {};
  return {
    id: c.domainKey,
    name: p.name || c.name,
    website: c.website,
    verifiedWebsite: c.status === "verified",
    discoveredIndustry: c.industryHint || "",
    discoveredLocation: c.locationHint || "",
    description: str(p.description, 500),
    about: str(p.aboutText, 700),
    homepageText: str(p.homepageText, 500),
    address: p.address || "",
    socialProfiles: Object.keys(p.socials || {}),
    hasPublicContact: Boolean(
      p.contacts?.emails?.length || p.contacts?.phones?.length || p.contacts?.contactPageUrl
    ),
    discoverySnippets: (c.discoveredVia || [])
      .map((d) => d.snippet)
      .filter(Boolean)
      .slice(0, 2),
  };
}

function evidenceBlob(payload) {
  return JSON.stringify(payload).toLowerCase();
}

/**
 * Keep AI-reported location only if it is supported by the evidence.
 */
function verifiedLocation(aiLocation, payload) {
  const loc = str(aiLocation, 200);
  if (loc) {
    const blob = evidenceBlob(payload);
    const parts = loc.toLowerCase().split(",").map((s) => s.trim()).filter((s) => s.length > 2);
    if (parts.length && parts.some((part) => blob.includes(part))) return loc;
  }
  return payload.address || payload.discoveredLocation || "";
}

function applyEvaluation(company, payload, ev, model) {
  const evidenceScore = computeEvidenceScore(company);
  const relevant = ev.relevant !== false && ev.relevant !== "false";
  const { breakdown, score, priority } = buildScore(ev.scores || {}, evidenceScore);

  return {
    relevant,
    disqualifyReason: relevant ? "" : str(ev.disqualifyReason, 300) || "Not relevant",
    industry: str(ev.industry, 120) || payload.discoveredIndustry,
    location: verifiedLocation(ev.location, payload),
    businessDescription: str(ev.businessDescription, 600) || payload.description,
    marketingNeeds: (Array.isArray(ev.marketingNeeds) ? ev.marketingNeeds : [])
      .map((n) => str(n, 200))
      .filter(Boolean)
      .slice(0, 8),
    reasoning: str(ev.reasoning, 1200),
    // Score always equals the breakdown sum; irrelevance is expressed by
    // `relevant: false` (=> status "disqualified"), never by altering scores.
    breakdown,
    score,
    priority,
    model,
    promptVersion: PROMPT_VERSION,
    evaluatedAt: new Date(),
  };
}

/**
 * Qualify a batch. Returns Map<domainKey, qualification | {error}>.
 */
async function qualifyBatch({ ai, profile, companies, log }) {
  const payloads = companies.map(toEvidencePayload);
  const byId = new Map(companies.map((c, i) => [c.domainKey, { company: c, payload: payloads[i] }]));
  const results = new Map();

  const run = async (subset) => {
    const { data, model } = await ai.generateJSON({
      prompt: qualificationPrompt({ profile, companies: subset }),
      stage: "qualification",
      temperature: 0,
      log,
    });
    const evals = Array.isArray(data?.evaluations) ? data.evaluations : [];
    for (const ev of evals) {
      const entry = byId.get(String(ev?.id || ""));
      if (!entry || results.has(entry.company.domainKey)) continue;
      results.set(entry.company.domainKey, applyEvaluation(entry.company, entry.payload, ev, model));
    }
  };

  await run(payloads);

  // Retry once for any company the model skipped.
  const missing = payloads.filter((p) => !results.has(p.id));
  if (missing.length) {
    log?.warn("qualification.missing", { count: missing.length });
    try {
      await run(missing);
    } catch (err) {
      log?.warn("qualification.retry_failed", { error: err.message });
    }
  }

  for (const p of payloads) {
    if (!results.has(p.id)) results.set(p.id, { error: "AI did not return an evaluation" });
  }
  return results;
}

module.exports = { qualifyBatch, toEvidencePayload, applyEvaluation, verifiedLocation };
