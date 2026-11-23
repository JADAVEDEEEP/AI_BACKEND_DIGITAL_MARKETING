/**
 * End-to-end test of the discovery pipeline through the HTTP API with a
 * fake AI client and a fake web (no network access required).
 */
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LOG_LEVEL = "error";
const config = require("../config");
config.jobs.pollIntervalMs = 50;
config.search.concurrency = 2;
config.discovery.maxRounds = 4;
config.discovery.queriesPerRound = 2;

const { createApp } = require("../app");
const { setRepository } = require("../repositories");
const { MemoryDiscoveryRepository } = require("../repositories/memory.repository");
const { createDiscoveryService } = require("../Services/discovery");
const { createCompanyScraper } = require("../Services/scraper/companyScraper");
const { createGeminiGroundedSource } = require("../Services/discovery/searchProviders");

// ---------------------------------------------------------------- fake web
const page = (title, body, extraHead = "") =>
  `<!doctype html><html lang="en"><head><title>${title}</title>${extraHead}</head><body>${body}</body></html>`;

const SITES = {
  "https://alpha-bakery.com/robots.txt": { body: "User-agent: *\nDisallow: /private\n", type: "text/plain" },
  "https://alpha-bakery.com/": {
    body: page(
      "Alpha Bakery | Artisan bread in Austin",
      `<a href="/about">About us</a><a href="mailto:hello@alpha-bakery.com">mail</a>
       <a href="mailto:jane.doe@alpha-bakery.com">Jane</a>
       <a href="https://instagram.com/alphabakery">IG</a><a href="https://facebook.com/alphabakery">FB</a>
       <p>Fresh sourdough and pastries baked daily in Austin. Order online for pickup.</p>`,
      `<meta name="description" content="Family-owned artisan bakery in Austin, Texas, opening a second location in 2026.">
       <script type="application/ld+json">{"@type":"LocalBusiness","name":"Alpha Bakery","telephone":"+1 512 555 0100","address":{"addressLocality":"Austin","addressRegion":"TX"}}</script>`
    ),
  },
  "https://alpha-bakery.com/about": {
    body: page("About Alpha Bakery", `<p>${"Founded in 2015 by two bakers, Alpha Bakery serves Austin neighbourhoods with handmade bread. ".repeat(4)}</p>`),
  },
  "https://beta-coffee.co.uk/": {
    body: page("Beta Coffee Roasters", "<p>Speciality coffee roastery in Manchester supplying cafes and online subscribers across the UK.</p>",
      '<meta name="description" content="Speciality coffee roasters in Manchester.">'),
  },
  "https://gamma-gym.com/robots.txt": { body: "User-agent: *\nDisallow: /\n", type: "text/plain" },
  "https://gamma-gym.com/": { body: page("Gamma Gym", "<p>should never be fetched</p>") },
  "https://parked-site.com/": { body: page("parked-site.com", "<p>This domain is for sale. Buy this domain today.</p>") },
  "https://delta-salon.com/": { status: 301, location: "https://delta-beauty.com/" },
  "https://delta-beauty.com/": {
    body: page("Delta Beauty Studio", '<p>Hair and beauty salon in Austin offering bridal styling and colour.</p><a href="https://www.tiktok.com/@deltabeauty">TikTok</a>',
      '<meta name="description" content="Award-winning hair and beauty studio in Austin.">'),
  },
  "https://acme-marketing.com/": {
    body: page("Acme Marketing Agency", "<p>Full-service social media marketing agency in Austin helping brands grow online.</p>"),
  },
  "https://epsilon-yoga.com/": {
    body: page("Epsilon Yoga", "<p>Yoga and pilates studio in Austin with online classes and teacher training programmes.</p>",
      '<meta name="description" content="Yoga studio in Austin, TX.">'),
  },
};

const fetched = [];
async function fakeFetch(input) {
  const href = String(input instanceof URL ? input.href : input);
  fetched.push(href);
  const site = SITES[href];
  if (!site) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  if (site.status === 301) return new Response(null, { status: 301, headers: { location: site.location } });
  return new Response(site.body, { status: 200, headers: { "content-type": site.type || "text/html; charset=utf-8" } });
}

// ---------------------------------------------------------------- fake AI
const DISCOVERED = [
  { name: "Alpha Bakery", website: "https://alpha-bakery.com", industry: "Bakery", location: "Austin", sourceUrl: "https://news.example/austin-bakeries", whyRelevant: "Local bakery" },
  { name: "Alpha Bakery LLC", website: "https://www.alpha-bakery.com/menu", industry: "Bakery", location: "Austin", sourceUrl: "https://list.example/a" },
  { name: "Beta Coffee", website: "beta-coffee.co.uk", industry: "Coffee", location: "Manchester", sourceUrl: "https://list.example/b" },
  { name: "Gamma Gym", website: "https://gamma-gym.com", industry: "Fitness", location: "Austin", sourceUrl: "https://list.example/c", whyRelevant: "Gamma Gym is a boutique gym in Austin launching new classes" },
  { name: "Parked Co", website: "https://parked-site.com", industry: "?", location: "", sourceUrl: "https://list.example/d" },
  { name: "Delta Salon", website: "https://delta-salon.com", industry: "Beauty", location: "Austin", sourceUrl: "https://list.example/e" },
  { name: "Delta Beauty Studio", website: "https://delta-beauty.com", industry: "Beauty", location: "Austin", sourceUrl: "https://list.example/f" },
  { name: "Epsilon Yoga", website: "https://epsilon-yoga.com", industry: "Fitness", location: "Austin", sourceUrl: "https://list.example/g" },
  { name: "Zeta Pets", website: "https://www.linkedin.com/company/zeta-pets", industry: "Pets", location: "Austin", sourceUrl: "https://list.example/h" },
  { name: "Acme Marketing Agency", website: "https://acme-marketing.com", industry: "Marketing", location: "Austin", sourceUrl: "https://list.example/i" },
];

const SCORES = {
  "alpha-bakery.com": { icpFit: 18, serviceFit: 18, industryRelevance: 14, marketingNeed: 17, businessPotential: 8, buyingSignals: 4 },
  "beta-coffee.co.uk": { icpFit: 6, serviceFit: 10, industryRelevance: 8, marketingNeed: 8, businessPotential: 5, buyingSignals: 1 },
  "gamma-gym.com": { icpFit: 12, serviceFit: 12, industryRelevance: 10, marketingNeed: 10, businessPotential: 5, buyingSignals: 3 },
  "delta-beauty.com": { icpFit: 17, serviceFit: 19, industryRelevance: 14, marketingNeed: 18, businessPotential: 8, buyingSignals: 4 },
  "epsilon-yoga.com": { icpFit: 14, serviceFit: 15, industryRelevance: 12, marketingNeed: 12, businessPotential: 6, buyingSignals: 2 },
};

const aiCalls = [];
const fakeAI = {
  async generateJSON({ prompt, stage }) {
    aiCalls.push(stage);
    if (stage === "discovery.plan") return { data: { queries: [`austin small business ${aiCalls.length}`] }, model: "fake" };
    if (stage === "discovery.grounded") {
      return { data: { companies: DISCOVERED }, grounding: { sources: [{ title: "x", url: "https://g.example/1" }] }, model: "fake" };
    }
    if (stage === "qualification") {
      const ids = [...prompt.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
      return {
        model: "fake",
        data: {
          evaluations: ids.map((id) => ({
            id,
            relevant: id !== "acme-marketing.com" && id !== "beta-coffee.co.uk",
            disqualifyReason: id === "beta-coffee.co.uk" ? "Outside target location" : "",
            industry: "Local business",
            location: id === "alpha-bakery.com" ? "Austin, TX" : "Atlantis",
            businessDescription: `Business at ${id}`,
            marketingNeeds: ["Limited social content"],
            scores: SCORES[id] || { icpFit: 20, serviceFit: 20, industryRelevance: 15, marketingNeed: 20, businessPotential: 10, buyingSignals: 5 },
            reasoning: "Evidence-based reasoning",
          })),
        },
      };
    }
    if (stage === "final_evaluation") {
      // Choose Alpha and include one invented URL (must be dropped).
      return {
        model: "fake-final",
        data: {
          winnerId: "alpha-bakery.com",
          ranking: [
            { id: "alpha-bakery.com", rank: 1, rationale: "Expansion signal" },
            { id: "delta-beauty.com", rank: 2, rationale: "Strong fit" },
          ],
          winner: {
            whyBestProspect: "Opening a second location creates an immediate need for local social campaigns.",
            strengths: ["Expansion", "Active Instagram"],
            matchingRequirements: [{ requirement: "Austin-based", howItMatches: "Located in Austin", sourceUrl: "https://alpha-bakery.com/" }],
            supportingEvidence: [
              { claim: "Opening a second location in 2026", sourceUrl: "https://alpha-bakery.com/" },
              { claim: "Revenue of $10M", sourceUrl: "https://invented.example/revenue" },
            ],
            recommendedServices: ["Instagram Marketing"],
            suggestedOutreachAngle: "Launch campaign for the new location",
            risksOrGaps: [],
            comparisonToRunnerUp: "Delta lacks a concrete buying signal.",
          },
          confidence: "high",
        },
      };
    }
    throw new Error(`unexpected stage ${stage}`);
  },
};

// ---------------------------------------------------------------- test
async function waitFor(fn, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("Timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("discovery job runs end-to-end via the API", async (t) => {
  const repo = new MemoryDiscoveryRepository();
  setRepository(repo);

  const scraper = createCompanyScraper(
    { ...config.crawler, perHostIntervalMs: 0, allowPrivateNetwork: true, retries: 0 },
    { fetchImpl: fakeFetch }
  );
  const { runner } = createDiscoveryService({
    repo,
    overrides: {
      ai: fakeAI,
      sources: [createGeminiGroundedSource({ ai: fakeAI })],
      resolveWebsite: null,
      scraper,
    },
  });
  runner.start();

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await runner.stop();
    server.close();
  });

  // Validation
  const bad = await fetch(`${base}/api/discovery/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agencyType: "SMM" }),
  });
  assert.equal(bad.status, 400);

  // Existing API still mounted (validation path, no AI call)
  const legacy = await fetch(`${base}/api/research`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(legacy.status, 400);
  assert.equal((await legacy.json()).message, "Agency type, services and requirements are required.");

  const res = await fetch(`${base}/api/discovery/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agencyName: "Bright Social",
      agencyType: "Social Media Marketing Agency",
      agencyServices: "Instagram Marketing, TikTok Content, Paid Social",
      targetIndustries: ["Food & Beverage", "Beauty", "Fitness"],
      targetLocations: "Austin, TX",
      idealCustomerProfile: "Independent local consumer brands with physical locations",
      businessRequirements: "Companies with growth signals",
    }),
  });
  assert.equal(res.status, 202);
  const jobId = (await res.json()).data.id;

  const job = await waitFor(async () => {
    const j = (await (await fetch(`${base}/api/discovery/jobs/${jobId}`)).json()).data;
    if (j.status === "failed") throw new Error(`job failed: ${JSON.stringify(j.error)}`);
    return j.status === "completed" ? j : null;
  });

  // Saturation stopped discovery before maxRounds (round 2 adds nothing new)
  assert.equal(job.discoveryRounds, 2);

  const all = (await (await fetch(`${base}/api/discovery/jobs/${jobId}/companies?limit=200&full=true`)).json()).data;
  const byDomain = Object.fromEntries(all.map((c) => [c.domain || c.name, c]));

  // Deduplication: www + LLC variant merged into one record
  assert.equal(all.filter((c) => c.domain === "alpha-bakery.com").length, 1);
  assert.equal(byDomain["alpha-bakery.com"].discoveryCount >= 2, true);
  // Redirect to an already-known domain => duplicate
  const deltaSalon = all.find((c) => c.name === "Delta Salon");
  assert.equal(deltaSalon.status, "duplicate");
  assert.equal(deltaSalon.duplicateOf, "delta-beauty.com");
  // Invalid results removed
  assert.equal(byDomain["parked-site.com"].status, "invalid");
  assert.equal(byDomain["Zeta Pets"].status, "invalid"); // LinkedIn URL is not a company site
  // Irrelevant results disqualified
  assert.equal(byDomain["acme-marketing.com"].status, "disqualified");
  assert.equal(byDomain["beta-coffee.co.uk"].status, "disqualified");

  // robots.txt respected: gamma homepage never fetched, qualified on search evidence only
  assert.equal(fetched.includes("https://gamma-gym.com/"), false);
  assert.equal(byDomain["gamma-gym.com"].qualification.breakdown.evidenceQuality.score, 0);

  // Extracted public data with evidence; personal email filtered out
  const alpha = byDomain["alpha-bakery.com"];
  assert.deepEqual(alpha.contacts.emails, ["hello@alpha-bakery.com"]);
  assert.equal(alpha.socials.instagram, "https://instagram.com/alphabakery");
  assert.equal(alpha.location, "Austin, TX");
  assert.ok(alpha.evidence.every((e) => e.sourceUrl.startsWith("https://alpha-bakery.com/")));
  // Unsupported AI location ("Atlantis") is not stored
  assert.notEqual(byDomain["delta-beauty.com"].location, "Atlantis");

  // Scores are consistent: breakdown sums to total
  for (const c of all.filter((x) => x.qualification?.breakdown)) {
    const sum = Object.values(c.qualification.breakdown).reduce((a, b) => a + b.score, 0);
    assert.equal(sum, c.score);
  }

  // Top 10 ranking
  const top = (await (await fetch(`${base}/api/discovery/jobs/${jobId}/top10`)).json()).data;
  // Alpha: AI 79 + evidence 9 = 88; Delta: AI 80 + evidence 5 = 85 (richer
  // verifiable evidence lifts Alpha above Delta).
  assert.deepEqual(top.map((c) => c.domainKey), ["alpha-bakery.com", "delta-beauty.com", "epsilon-yoga.com", "gamma-gym.com"]);
  assert.deepEqual(top.map((c) => c.score), [88, 85, 64, 52]);
  assert.ok(top.length <= 10);

  // Final, separate evaluation chose #1 with validated evidence
  const winner = (await (await fetch(`${base}/api/discovery/jobs/${jobId}/winner`)).json()).data;
  assert.equal(winner.winner.domainKey, "alpha-bakery.com");
  assert.equal(winner.finalEvaluation.method, "ai_comparative");
  assert.equal(winner.winner.supportingEvidence.length, 1); // invented URL dropped
  assert.equal(winner.finalEvaluation.winner.droppedUncitedClaims, 1);
  assert.equal(winner.company.isWinner, true);
  assert.ok(aiCalls.includes("final_evaluation"));

  // Cannot cancel a completed job
  const cancel = await fetch(`${base}/api/discovery/jobs/${jobId}/cancel`, { method: "POST" });
  assert.equal(cancel.status, 409);
});

test("final evaluation falls back to deterministic #1 when AI output is invalid", async () => {
  const { evaluateFinalists } = require("../Services/qualification/finalEvaluator");
  const top = [
    { domainKey: "a.com", name: "A", qualification: { score: 90, reasoning: "best" }, evidence: [{ field: "description", value: "A desc", sourceUrl: "https://a.com/" }] },
    { domainKey: "b.com", name: "B", qualification: { score: 80 } },
  ];
  const ai = { generateJSON: async () => ({ data: { winnerId: "not-in-list.com" }, model: "fake" }) };
  const res = await evaluateFinalists({ ai, profile: { agencyServices: [] }, top, log: null });
  assert.equal(res.winnerDomainKey, "a.com");
  assert.equal(res.method, "deterministic_fallback");
  assert.equal(res.confidence, "low");
});
