/**
 * Deterministic parts of the scoring system.
 *
 * The AI proposes sub-scores; the server clamps each to its maximum,
 * computes evidence quality itself and sums the total. This guarantees
 * the breakdown always equals the final score and that scoring is
 * consistent across batches and jobs.
 */
const { SCORING_RUBRIC, PRIORITY_BANDS } = require("../../prompts/discoveryPrompts");

const clampInt = (v, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
};

/**
 * Evidence quality (0-10): how much verifiable public information exists.
 */
function computeEvidenceScore(company) {
  const p = company.profile || {};
  const verified = company.status === "verified" || company.scrapeStatus === "verified";
  let score = 0;

  if (verified) score += 3; // own website fetched and verified
  if (p.description && p.description.length >= 40) score += 1;
  if ((p.aboutText || "").length >= 200) score += 1;
  if (p.address || company.location) score += 1;
  if ((p.contacts?.emails?.length || 0) + (p.contacts?.phones?.length || 0) > 0 || p.contacts?.contactPageUrl) score += 1;
  const socialCount = Object.keys(p.socials || {}).length;
  if (socialCount >= 1) score += 1;
  if (socialCount >= 3) score += 1;
  const sources = new Set([...(company.sourceUrls || []), ...(company.discoveredVia || []).map((d) => d.sourceUrl).filter(Boolean)]);
  if (sources.size >= 3) score += 1;

  return Math.min(10, score);
}

function priorityFor(score) {
  return PRIORITY_BANDS.find((b) => score >= b.min).label;
}

/**
 * Build the final, consistent score from AI sub-scores + evidence score.
 */
function buildScore(aiScores = {}, evidenceScore = 0) {
  const breakdown = {};
  let total = 0;
  for (const c of SCORING_RUBRIC) {
    const value = c.computed ? clampInt(evidenceScore, c.max) : clampInt(aiScores[c.key], c.max);
    breakdown[c.key] = { label: c.label, score: value, max: c.max };
    total += value;
  }
  return { breakdown, score: total, priority: priorityFor(total) };
}

/**
 * Deterministic ranking comparator: score desc, then evidence, then
 * service fit, then ICP fit, then domain (stable, reproducible).
 */
function compareQualified(a, b) {
  const qa = a.qualification || {};
  const qb = b.qualification || {};
  const s = (q, k) => q.breakdown?.[k]?.score || 0;
  return (
    (qb.score || 0) - (qa.score || 0) ||
    s(qb, "evidenceQuality") - s(qa, "evidenceQuality") ||
    s(qb, "serviceFit") - s(qa, "serviceFit") ||
    s(qb, "icpFit") - s(qa, "icpFit") ||
    String(a.domainKey || a.nameKey).localeCompare(String(b.domainKey || b.nameKey))
  );
}

module.exports = { computeEvidenceScore, buildScore, priorityFor, compareQualified, clampInt };
