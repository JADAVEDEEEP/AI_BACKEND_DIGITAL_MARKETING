/**
 * Separate, comparative AI evaluation of the top 10 to pick the NUMBER 1
 * prospect. Output is validated: the winner must be one of the top 10 and
 * every cited source must belong to that company's evidence.
 */
const { finalEvaluationPrompt, PROMPT_VERSION } = require("../../prompts/discoveryPrompts");

const str = (v, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v, max = 300, n = 10) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

function sourceUrlsOf(c) {
  return [
    ...new Set([
      ...(c.sourceUrls || []),
      ...(c.evidence || []).map((e) => e.sourceUrl),
      ...(c.discoveredVia || []).map((d) => d.sourceUrl),
    ].filter(Boolean)),
  ];
}

function toFinalPayload(c, rank) {
  const q = c.qualification || {};
  const p = c.profile || {};
  return {
    id: c.domainKey,
    preliminaryRank: rank,
    name: p.name || c.name,
    website: c.website,
    industry: q.industry,
    location: q.location,
    businessDescription: q.businessDescription,
    score: q.score,
    priority: q.priority,
    breakdown: Object.fromEntries(
      Object.entries(q.breakdown || {}).map(([k, v]) => [k, `${v.score}/${v.max}`])
    ),
    marketingNeeds: q.marketingNeeds,
    qualificationReasoning: q.reasoning,
    socialProfiles: p.socials || {},
    publicContactAvailable: Boolean(
      p.contacts?.emails?.length || p.contacts?.phones?.length || p.contacts?.contactPageUrl
    ),
    evidence: (c.evidence || [])
      .filter((e) => !/^contact\./.test(e.field))
      .slice(0, 12)
      .map((e) => ({ field: e.field, value: str(e.value, 300), sourceUrl: e.sourceUrl })),
    sourceUrls: sourceUrlsOf(c),
  };
}

function sanitizeWinner(raw, allowedUrls, profile) {
  const okUrl = (u) => typeof u === "string" && allowedUrls.has(u.trim());
  let dropped = 0;
  const keepCited = (items, map) =>
    (Array.isArray(items) ? items : [])
      .map(map)
      .filter((x) => {
        if (x.sourceUrl && !okUrl(x.sourceUrl)) {
          dropped++;
          return false;
        }
        return Boolean(x.claim || x.requirement);
      })
      .slice(0, 12);

  const w = raw || {};
  return {
    whyBestProspect: str(w.whyBestProspect, 2000),
    strengths: strList(w.strengths),
    matchingRequirements: keepCited(w.matchingRequirements, (m) => ({
      requirement: str(m?.requirement, 300),
      howItMatches: str(m?.howItMatches, 600),
      sourceUrl: str(m?.sourceUrl, 1000),
    })),
    supportingEvidence: keepCited(w.supportingEvidence, (e) => ({
      claim: str(e?.claim, 600),
      sourceUrl: str(e?.sourceUrl, 1000),
    })).filter((e) => e.sourceUrl), // evidence must be cited
    recommendedServices: strList(w.recommendedServices, 200).filter((s) =>
      // Only services the agency actually offers (loose match)
      (profile.agencyServices || []).some(
        (svc) => s.toLowerCase().includes(String(svc).toLowerCase()) || String(svc).toLowerCase().includes(s.toLowerCase())
      )
    ),
    suggestedOutreachAngle: str(w.suggestedOutreachAngle, 800),
    risksOrGaps: strList(w.risksOrGaps),
    comparisonToRunnerUp: str(w.comparisonToRunnerUp, 1200),
    droppedUncitedClaims: dropped,
  };
}

/**
 * @param {object} args
 * @param {object[]} args.top    Ranked top companies (with qualification).
 * @returns {Promise<object>} final evaluation record
 */
async function evaluateFinalists({ ai, profile, top, model, log }) {
  if (!top.length) throw new Error("No qualified companies to evaluate.");

  const payloads = top.map((c, i) => toFinalPayload(c, i + 1));
  const ids = new Set(payloads.map((p) => p.id));

  let data = null;
  let usedModel = model;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await ai.generateJSON({
        prompt: finalEvaluationPrompt({ profile, companies: payloads }),
        stage: "final_evaluation",
        temperature: 0,
        model,
        log,
      });
      if (ids.has(String(res.data?.winnerId || ""))) {
        data = res.data;
        usedModel = res.model;
        break;
      }
      lastError = new Error(`Final evaluation returned invalid winnerId "${res.data?.winnerId}"`);
      log?.warn("final_evaluation.invalid_winner", { attempt, winnerId: res.data?.winnerId });
    } catch (err) {
      lastError = err;
      log?.warn("final_evaluation.failed", { attempt, error: err.message });
    }
  }

  // Fallback: the deterministic #1 (still a real, verified, scored company).
  const fallback = !data;
  const winnerId = fallback ? payloads[0].id : data.winnerId;
  const winnerCompany = top.find((c) => c.domainKey === winnerId);
  const allowedUrls = new Set(sourceUrlsOf(winnerCompany));

  const ranking = (fallback ? [] : Array.isArray(data.ranking) ? data.ranking : [])
    .filter((r) => ids.has(String(r?.id)))
    .map((r) => ({ id: String(r.id), rank: Number(r.rank) || null, rationale: str(r.rationale, 600) }));

  const winner = fallback
    ? {
        whyBestProspect: `Selected by deterministic scoring (final AI evaluation unavailable: ${lastError?.message || "unknown error"}). ${winnerCompany.qualification?.reasoning || ""}`.trim(),
        strengths: winnerCompany.qualification?.marketingNeeds || [],
        matchingRequirements: [],
        supportingEvidence: (winnerCompany.evidence || [])
          .filter((e) => ["description", "about"].includes(e.field))
          .slice(0, 3)
          .map((e) => ({ claim: str(e.value, 300), sourceUrl: e.sourceUrl })),
        recommendedServices: [],
        suggestedOutreachAngle: "",
        risksOrGaps: ["Final comparative AI evaluation did not complete; review manually."],
        comparisonToRunnerUp: "",
        droppedUncitedClaims: 0,
      }
    : sanitizeWinner(data.winner, allowedUrls, profile);

  return {
    winnerDomainKey: winnerId,
    winnerName: winnerCompany.profile?.name || winnerCompany.name,
    ranking,
    winner,
    confidence: fallback ? "low" : ["high", "medium", "low"].includes(data.confidence) ? data.confidence : "medium",
    method: fallback ? "deterministic_fallback" : "ai_comparative",
    model: usedModel,
    promptVersion: PROMPT_VERSION,
    evaluatedAt: new Date(),
  };
}

module.exports = { evaluateFinalists, toFinalPayload, sanitizeWinner, sourceUrlsOf };
