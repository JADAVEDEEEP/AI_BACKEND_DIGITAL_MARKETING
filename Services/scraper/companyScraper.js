/**
 * Verifies a company website and extracts publicly published facts, with
 * per-field evidence (source URL). Respects robots.txt, Crawl-delay and
 * per-host rate limits. Never fabricates: missing facts stay empty.
 */
const { createFetcher } = require("./safeFetch");
const { RobotsCache } = require("./robots");
const { extractPage } = require("./htmlExtractor");
const { HostRateLimiter } = require("../../utils/concurrency");
const { homepageUrl, domainKey, isNonCompanyDomain } = require("../../utils/url");

const SCRAPE_STATUS = {
  VERIFIED: "verified",
  INVALID: "invalid",
  ROBOTS_BLOCKED: "robots_blocked",
  UNREACHABLE: "unreachable",
};

function cleanTitleToName(title) {
  if (!title) return "";
  // "Acme | Handmade Soap in Austin" -> "Acme"
  const parts = title.split(/\s[|\-–—:·•]\s/).map((s) => s.trim()).filter(Boolean);
  return (parts.sort((a, b) => a.length - b.length)[0] || title).slice(0, 120);
}

function createCompanyScraper(crawlerConfig, overrides = {}) {
  const rateLimiter =
    overrides.rateLimiter ||
    new HostRateLimiter({
      defaultIntervalMs: crawlerConfig.perHostIntervalMs,
      maxIntervalMs: crawlerConfig.maxCrawlDelayMs,
    });

  const fetchPage =
    overrides.fetchPage ||
    createFetcher({
      userAgent: crawlerConfig.userAgent,
      timeoutMs: crawlerConfig.timeoutMs,
      maxBytes: crawlerConfig.maxBytes,
      maxRedirects: crawlerConfig.maxRedirects,
      retries: crawlerConfig.retries,
      allowPrivateNetwork: crawlerConfig.allowPrivateNetwork,
      fetchImpl: overrides.fetchImpl,
    });

  const token = crawlerConfig.robotsUserAgentToken;

  const robots =
    overrides.robotsCache ||
    new RobotsCache({
      ttlMs: crawlerConfig.robotsCacheTtlMs,
      fetchText: async (robotsUrl) => {
        const res = await fetchPage(robotsUrl, {
          accept: "text/plain,*/*;q=0.5",
          beforeRequest: (u) => rateLimiter.wait(u.host),
        });
        return { status: res.status, body: res.body };
      },
    });

  /** Hook run before every request hop: robots + crawl delay + rate limit. */
  async function politeGate(url) {
    const policy = await robots.policyFor(url.href);
    const delay = policy.crawlDelayMs(token);
    if (delay) rateLimiter.setInterval(url.host, delay);
    if (!policy.isAllowed(url.href, token)) {
      throw Object.assign(new Error(`robots.txt disallows ${url.href}`), {
        code: "ROBOTS_DISALLOWED",
        retryable: false,
      });
    }
    await rateLimiter.wait(url.host);
  }

  async function fetchHtml(url) {
    const res = await fetchPage(url, { beforeRequest: politeGate });
    return res;
  }

  /**
   * @returns {Promise<object>} scrape result (see SCRAPE_STATUS)
   */
  async function scrapeCompany(website) {
    const startUrl = homepageUrl(website);
    const fetchedAt = new Date();

    if (!startUrl) {
      return { status: SCRAPE_STATUS.INVALID, reason: "invalid_url", fetchedAt };
    }
    if (isNonCompanyDomain(startUrl)) {
      return { status: SCRAPE_STATUS.INVALID, reason: "non_company_domain", fetchedAt };
    }

    let home;
    try {
      home = await fetchHtml(startUrl);
    } catch (err) {
      if (err.code === "ROBOTS_DISALLOWED") {
        return { status: SCRAPE_STATUS.ROBOTS_BLOCKED, reason: "robots_disallowed", fetchedAt };
      }
      if (err.code === "BLOCKED_HOST") {
        return { status: SCRAPE_STATUS.INVALID, reason: "non_public_host", fetchedAt };
      }
      const code = err.code || err.cause?.code;
      return {
        status: code === "ENOTFOUND" ? SCRAPE_STATUS.INVALID : SCRAPE_STATUS.UNREACHABLE,
        reason: code === "ENOTFOUND" ? "domain_not_found" : `fetch_error:${code || err.status || err.message}`.slice(0, 120),
        fetchedAt,
      };
    }

    const finalUrl = home.url;
    const finalDomain = domainKey(finalUrl);

    if (home.status === 401 || home.status === 403) {
      return { status: SCRAPE_STATUS.UNREACHABLE, reason: `http_${home.status}`, finalUrl, fetchedAt };
    }
    if (home.status >= 400) {
      return { status: SCRAPE_STATUS.INVALID, reason: `http_${home.status}`, finalUrl, fetchedAt };
    }
    if (!/html|xml/i.test(home.contentType)) {
      return { status: SCRAPE_STATUS.INVALID, reason: "not_html", finalUrl, fetchedAt };
    }
    if (isNonCompanyDomain(finalUrl)) {
      return { status: SCRAPE_STATUS.INVALID, reason: "redirects_to_non_company_domain", finalUrl, fetchedAt };
    }

    const opts = { contactEmailPolicy: crawlerConfig.contactEmailPolicy };
    const pages = [extractPage(home.body, finalUrl, opts)];

    if (pages[0].parked) {
      return { status: SCRAPE_STATUS.INVALID, reason: "parked_or_placeholder", finalUrl, fetchedAt };
    }
    if (pages[0].text.length < 80 && !pages[0].description && !pages[0].jsonLd) {
      return { status: SCRAPE_STATUS.INVALID, reason: "insufficient_content", finalUrl, fetchedAt };
    }

    // Fetch a couple of about/contact pages (robots-checked, best effort).
    const extra = pages[0].subpages.slice(0, Math.max(0, crawlerConfig.maxPagesPerSite - 1));
    for (const sub of extra) {
      try {
        const res = await fetchHtml(sub);
        if (res.status < 400 && /html/i.test(res.contentType) && domainKey(res.url) === finalDomain) {
          pages.push(extractPage(res.body, res.url, opts));
        }
      } catch {
        /* non-critical */
      }
    }

    return {
      status: SCRAPE_STATUS.VERIFIED,
      finalUrl,
      domainKey: finalDomain,
      fetchedAt,
      ...mergePages(pages),
    };
  }

  return { scrapeCompany, politeGate, robots, rateLimiter };
}

/**
 * Merge page extractions into one profile with per-field evidence.
 */
function mergePages(pages) {
  const home = pages[0];
  const evidence = [];
  const add = (field, value, sourceUrl) => {
    if (value && String(value).trim()) evidence.push({ field, value: String(value).slice(0, 600), sourceUrl });
  };

  const ld = pages.map((p) => p.jsonLd && { ...p.jsonLd, url: p.url }).find(Boolean);

  const name =
    ld?.name || home.siteName || cleanTitleToName(home.ogTitle) || cleanTitleToName(home.title);
  add("name", name, ld?.name ? ld.url : home.url);

  const aboutPage = pages.find((p) => /about|story|who-we-are|company/i.test(p.url));
  const description = ld?.description || home.description || aboutPage?.description || "";
  add("description", description, ld?.description ? ld.url : home.description ? home.url : aboutPage?.url);

  if (aboutPage) add("about", aboutPage.text.slice(0, 800), aboutPage.url);
  add("homepageText", home.text.slice(0, 800), home.url);

  const address = ld?.address || "";
  add("address", address, ld?.url);

  const socials = {};
  for (const p of pages) {
    for (const [k, v] of Object.entries(p.socials)) {
      if (!socials[k]) {
        socials[k] = v;
        add(`social.${k}`, v, p.url);
      }
    }
  }

  const emails = new Set();
  const phones = new Set();
  if (ld?.email && /@/.test(ld.email)) {
    // JSON-LD email is an explicitly published business contact.
    emails.add(ld.email.toLowerCase());
    add("contact.email", ld.email, ld.url);
  }
  if (ld?.telephone) {
    phones.add(ld.telephone);
    add("contact.phone", ld.telephone, ld.url);
  }
  for (const p of pages) {
    for (const e of p.contacts.emails) {
      if (!emails.has(e)) {
        emails.add(e);
        add("contact.email", e, p.url);
      }
    }
    for (const ph of p.contacts.phones) {
      if (!phones.has(ph)) {
        phones.add(ph);
        add("contact.phone", ph, p.url);
      }
    }
  }

  const contactPage = pages.find((p) => /contact/i.test(p.url));

  return {
    profile: {
      name: name || "",
      title: home.title,
      description,
      aboutText: (aboutPage?.text || "").slice(0, 1500),
      homepageText: home.text.slice(0, 1500),
      address,
      language: home.lang,
      foundingDate: ld?.foundingDate || "",
      employeeCount: ld?.numberOfEmployees || "",
      socials,
      contacts: {
        emails: [...emails].slice(0, 5),
        phones: [...phones].slice(0, 3),
        contactPageUrl: contactPage?.url || "",
      },
      hasStructuredData: Boolean(ld),
    },
    evidence,
    sourceUrls: [...new Set(pages.map((p) => p.url))],
    pagesFetched: pages.length,
  };
}

module.exports = { createCompanyScraper, mergePages, SCRAPE_STATUS, cleanTitleToName };
