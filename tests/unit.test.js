const test = require("node:test");
const assert = require("node:assert/strict");

const url = require("../utils/url");
const { RobotsPolicy } = require("../Services/scraper/robots");
const { extractPage } = require("../Services/scraper/htmlExtractor");
const { buildScore, priorityFor, computeEvidenceScore, compareQualified } = require("../Services/qualification/scoring");
const { parseGeminiJSON } = require("../utils/parseGeminiJSON");
const { isPrivateIP } = require("../Services/scraper/safeFetch");
const { sanitizeWinner } = require("../Services/qualification/finalEvaluator");
const { verifiedLocation } = require("../Services/qualification/qualifier");
const { withRetry } = require("../utils/retry");

test("domainKey normalises subdomains, www and multi-part TLDs", () => {
  assert.equal(url.domainKey("https://www.Acme.com/about"), "acme.com");
  assert.equal(url.domainKey("shop.acme.com"), "acme.com");
  assert.equal(url.domainKey("http://www.brand.co.uk"), "brand.co.uk");
  assert.equal(url.domainKey("store.brand.com.au/path"), "brand.com.au");
  assert.equal(url.domainKey("not a url"), null);
  assert.equal(url.domainKey(""), null);
});

test("non-company domains are rejected", () => {
  assert.equal(url.isNonCompanyDomain("https://www.linkedin.com/company/acme"), true);
  assert.equal(url.isNonCompanyDomain("https://clutch.co/profile/x"), true);
  assert.equal(url.isNonCompanyDomain("https://acme-bakery.com"), false);
});

test("normalizeCompanyName strips legal suffixes and punctuation", () => {
  assert.equal(url.normalizeCompanyName("Acme Bakery, Inc."), "acme bakery");
  assert.equal(url.normalizeCompanyName("ACME BAKERY LLC"), "acme bakery");
  assert.equal(url.normalizeCompanyName("Café Ñandú Ltd"), "cafe nandu");
  assert.equal(url.normalizeCompanyName("Smith & Sons Co."), "smith and sons");
});

test("robots.txt: longest match wins, allow wins ties, wildcards and $", () => {
  const p = new RobotsPolicy(`
User-agent: *
Disallow: /private
Allow: /private/public
Disallow: /*.pdf$
Crawl-delay: 2

User-agent: AgencyLeadDiscoveryBot
Disallow: /no-bots
`);
  const t = "AgencyLeadDiscoveryBot/1.0";
  // Specific group applies to our bot, not "*"
  assert.equal(p.isAllowed("https://x.com/private", t), true);
  assert.equal(p.isAllowed("https://x.com/no-bots/a", t), false);
  // Other bots use "*"
  assert.equal(p.isAllowed("https://x.com/private/a", "OtherBot"), false);
  assert.equal(p.isAllowed("https://x.com/private/public/a", "OtherBot"), true);
  assert.equal(p.isAllowed("https://x.com/file.pdf", "OtherBot"), false);
  assert.equal(p.isAllowed("https://x.com/file.pdf?x=1", "OtherBot"), true);
  assert.equal(p.crawlDelayMs("OtherBot"), 2000);
  assert.equal(RobotsPolicy.disallowAll().isAllowed("https://x.com/", t), false);
});

test("robots.txt: Disallow: / blocks everything except robots.txt", () => {
  const p = new RobotsPolicy("User-agent: *\nDisallow: /");
  assert.equal(p.isAllowed("https://x.com/", "Bot"), false);
  assert.equal(p.isAllowed("https://x.com/robots.txt", "Bot"), true);
  assert.equal(new RobotsPolicy("User-agent: *\nDisallow:").isAllowed("https://x.com/a", "Bot"), true);
});

test("HTML extractor gets JSON-LD, socials, role-based emails only", () => {
  const html = `<!doctype html><html lang="en"><head>
    <title>Alpha Bakery | Artisan bread in Austin</title>
    <meta name="description" content="Family-owned artisan bakery in Austin, TX.">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Bakery","name":"x"}</script>
    <script type="application/ld+json">{"@graph":[{"@type":"LocalBusiness","name":"Alpha Bakery","telephone":"+1 512 555 0100",
      "address":{"streetAddress":"1 Main St","addressLocality":"Austin","addressRegion":"TX"},
      "sameAs":["https://www.instagram.com/alphabakery/"]}]}</script>
    </head><body>
    <a href="https://facebook.com/alphabakery">FB</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
    <a href="mailto:hello@alpha-bakery.com">Email</a>
    <a href="mailto:john.smith@alpha-bakery.com">John</a>
    <a href="/about-us">About</a><a href="/contact">Contact</a>
    <p>We bake sourdough every morning &amp; deliver across Austin.</p>
    </body></html>`;
  const page = extractPage(html, "https://alpha-bakery.com/");
  assert.equal(page.jsonLd.name, "Alpha Bakery");
  assert.equal(page.jsonLd.address, "1 Main St, Austin, TX");
  assert.equal(page.socials.instagram, "https://www.instagram.com/alphabakery");
  assert.equal(page.socials.facebook, "https://facebook.com/alphabakery");
  assert.deepEqual(page.contacts.emails, ["hello@alpha-bakery.com"]);
  assert.deepEqual(page.subpages, ["https://alpha-bakery.com/about-us", "https://alpha-bakery.com/contact"]);
  assert.match(page.text, /sourdough every morning & deliver/);
  assert.equal(page.parked, false);
});

test("parked pages are detected", () => {
  const page = extractPage("<html><title>parked-site.com</title><body>This domain is for sale!</body></html>", "https://parked-site.com/");
  assert.equal(page.parked, true);
});

test("score breakdown always sums to the total and is clamped", () => {
  const { breakdown, score, priority } = buildScore(
    { icpFit: 50, serviceFit: 18, industryRelevance: 12.4, marketingNeed: -5, businessPotential: "8", buyingSignals: null },
    7
  );
  assert.equal(breakdown.icpFit.score, 20);
  assert.equal(breakdown.marketingNeed.score, 0);
  assert.equal(breakdown.industryRelevance.score, 12);
  assert.equal(breakdown.evidenceQuality.score, 7);
  const sum = Object.values(breakdown).reduce((a, b) => a + b.score, 0);
  assert.equal(sum, score);
  assert.equal(score, 65);
  assert.equal(priority, "WARM");
  assert.equal(priorityFor(80), "HOT");
  assert.equal(priorityFor(39), "POOR FIT");
  const maxTotal = Object.values(breakdown).reduce((a, b) => a + b.max, 0);
  assert.equal(maxTotal, 100);
});

test("evidence score rewards verified, well-documented companies", () => {
  const rich = computeEvidenceScore({
    status: "verified",
    sourceUrls: ["a", "b", "c"],
    profile: {
      description: "x".repeat(50),
      aboutText: "y".repeat(250),
      address: "Austin",
      contacts: { emails: ["info@x.com"] },
      socials: { instagram: "i", facebook: "f", x: "t" },
    },
  });
  assert.equal(rich, 10);
  assert.equal(computeEvidenceScore({ status: "robots_blocked", profile: {} }), 0);
});

test("ranking comparator is deterministic with tie-breakers", () => {
  const mk = (dk, score, ev, sf) => ({
    domainKey: dk,
    qualification: { score, breakdown: { evidenceQuality: { score: ev }, serviceFit: { score: sf }, icpFit: { score: 0 } } },
  });
  const list = [mk("b.com", 70, 5, 10), mk("a.com", 70, 5, 10), mk("c.com", 70, 8, 1), mk("d.com", 90, 0, 0)];
  list.sort(compareQualified);
  assert.deepEqual(list.map((c) => c.domainKey), ["d.com", "c.com", "a.com", "b.com"]);
});

test("parseGeminiJSON handles fences, prose and arrays", () => {
  assert.deepEqual(parseGeminiJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseGeminiJSON('Here you go: {"a":"}"} trailing'), { a: "}" });
  assert.deepEqual(parseGeminiJSON("[1,2]"), [1, 2]);
  assert.throws(() => parseGeminiJSON('{"a":'), /incomplete/);
});

test("private IPs are blocked for SSRF protection", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateIP(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.equal(isPrivateIP(ip), false, ip);
});

test("final evaluation drops claims citing URLs outside the evidence", () => {
  const w = sanitizeWinner(
    {
      whyBestProspect: "Because",
      supportingEvidence: [
        { claim: "Real", sourceUrl: "https://a.com/" },
        { claim: "Invented", sourceUrl: "https://made-up.com/x" },
        { claim: "Uncited", sourceUrl: "" },
      ],
      recommendedServices: ["Instagram Marketing", "Nuclear Engineering"],
    },
    new Set(["https://a.com/"]),
    { agencyServices: ["Instagram Marketing"] }
  );
  assert.deepEqual(w.supportingEvidence, [{ claim: "Real", sourceUrl: "https://a.com/" }]);
  assert.equal(w.droppedUncitedClaims, 1);
  assert.deepEqual(w.recommendedServices, ["Instagram Marketing"]);
});

test("AI location is only kept when supported by evidence", () => {
  const payload = { address: "", discoveredLocation: "", homepageText: "Proudly serving Austin, Texas" };
  assert.equal(verifiedLocation("Austin, TX", payload), "Austin, TX");
  assert.equal(verifiedLocation("Paris, France", payload), "");
});

test("withRetry retries transient errors and stops on permanent ones", async () => {
  let calls = 0;
  const out = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("busy"), { status: 503 });
      return "ok";
    },
    { retries: 4, minDelayMs: 1, maxDelayMs: 2 }
  );
  assert.equal(out, "ok");
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw Object.assign(new Error("bad request"), { status: 400 });
    }, { retries: 4, minDelayMs: 1 })
  );
  assert.equal(calls, 1);
});
