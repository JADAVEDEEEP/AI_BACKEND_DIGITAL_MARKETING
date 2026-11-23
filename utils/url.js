/**
 * URL / domain / company-name normalisation used for deduplication
 * and for filtering out non-company domains.
 */

// Common multi-label public suffixes (subset of the Public Suffix List).
// Used to derive the registrable domain (eTLD+1) without a dependency.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk", "me.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.nz", "org.nz", "net.nz",
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in",
  "co.za", "org.za", "web.za",
  "com.br", "net.br", "org.br",
  "com.mx", "org.mx", "com.ar", "com.co", "com.pe", "com.cl",
  "co.jp", "or.jp", "ne.jp", "ac.jp",
  "co.kr", "or.kr",
  "com.cn", "net.cn", "org.cn",
  "com.hk", "com.sg", "com.my", "com.ph", "com.tw", "com.vn", "co.th", "co.id",
  "com.tr", "com.sa", "com.eg", "com.pk", "com.bd", "com.ng", "com.gh",
  "co.ke", "co.il", "com.ua", "co.ae", "ac.ae",
  "com.es", "com.pt", "com.pl", "com.gr", "co.at", "or.at",
]);

// Domains that are never the target company itself (directories,
// marketplaces, social networks, media, review and data sites).
const NON_COMPANY_DOMAINS = new Set([
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "tiktok.com", "youtube.com", "pinterest.com", "reddit.com", "threads.net",
  "medium.com", "substack.com", "wikipedia.org", "wikimedia.org",
  "crunchbase.com", "zoominfo.com", "apollo.io", "rocketreach.co",
  "dnb.com", "bloomberg.com", "glassdoor.com", "indeed.com", "builtin.com",
  "yelp.com", "yellowpages.com", "tripadvisor.com", "trustpilot.com",
  "g2.com", "capterra.com", "clutch.co", "goodfirms.co", "upcity.com",
  "designrush.com", "sortlist.com", "themanifest.com", "bbb.org",
  "amazon.com", "ebay.com", "etsy.com", "shopify.com", "alibaba.com",
  "google.com", "goo.gl", "bing.com", "duckduckgo.com", "yahoo.com",
  "apple.com", "microsoft.com", "github.com", "gitlab.com",
  "forbes.com", "inc.com", "techcrunch.com", "businessinsider.com",
  "nytimes.com", "theguardian.com", "bbc.co.uk", "cnn.com", "reuters.com",
  "producthunt.com", "angel.co", "wellfound.com", "f6s.com",
  "mapquest.com", "foursquare.com", "manta.com", "chamberofcommerce.com",
  "vertexaisearch.cloud.google.com", "googleusercontent.com",
  "wix.com", "squarespace.com", "wordpress.com", "blogspot.com",
]);

const SOCIAL_PLATFORMS = {
  linkedin: ["linkedin.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  x: ["twitter.com", "x.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  pinterest: ["pinterest.com"],
  threads: ["threads.net"],
};

/**
 * Parse a loosely-formatted website string into a URL (https by default).
 * Returns null when it cannot be a public website.
 */
function toUrl(input) {
  if (!input || typeof input !== "string") return null;
  let value = input.trim();
  if (!value || /\s/.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!url.hostname.includes(".")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function hostnameOf(input) {
  const url = input instanceof URL ? input : toUrl(input);
  return url ? url.hostname.toLowerCase().replace(/\.$/, "") : null;
}

/**
 * Registrable domain (eTLD+1), e.g. "shop.brand.co.uk" -> "brand.co.uk".
 */
function registrableDomain(input) {
  const host = hostnameOf(input);
  if (!host) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return host;

  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");

  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/**
 * Canonical dedupe key for a company website.
 */
function domainKey(input) {
  const d = registrableDomain(input);
  return d ? d.replace(/^www\./, "") : null;
}

function isNonCompanyDomain(input) {
  const key = domainKey(input);
  if (!key) return true;
  if (NON_COMPANY_DOMAINS.has(key)) return true;
  const host = hostnameOf(input) || "";
  for (const d of NON_COMPANY_DOMAINS) {
    if (host === d || host.endsWith(`.${d}`)) return true;
  }
  return false;
}

/**
 * Canonical homepage URL for a company domain.
 */
function homepageUrl(input) {
  const url = toUrl(input);
  if (!url) return null;
  return `${url.protocol}//${url.host}/`;
}

const LEGAL_SUFFIXES =
  /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|plc|corp|corporation|co|company|gmbh|ag|sa|sas|srl|bv|nv|pty|pvt|private|llp|lp|oy|ab|as|kk)\b\.?/g;

/**
 * Normalised company name for secondary deduplication.
 */
function normalizeCompanyName(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Identify which social platform (if any) a URL belongs to.
 */
function socialPlatformOf(input) {
  const host = hostnameOf(input);
  if (!host) return null;
  for (const [platform, domains] of Object.entries(SOCIAL_PLATFORMS)) {
    if (domains.some((d) => host === d || host.endsWith(`.${d}`))) {
      return platform;
    }
  }
  return null;
}

module.exports = {
  toUrl,
  hostnameOf,
  registrableDomain,
  domainKey,
  homepageUrl,
  isNonCompanyDomain,
  normalizeCompanyName,
  socialPlatformOf,
  NON_COMPANY_DOMAINS,
};
