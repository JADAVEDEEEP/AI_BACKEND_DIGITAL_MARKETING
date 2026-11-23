/**
 * Dependency-free HTML extraction of publicly published company facts.
 * Extracts only what the page itself states — nothing is inferred here.
 */
const { socialPlatformOf, domainKey } = require("../../utils/url");

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  hellip: "…", copy: "©", reg: "®", trade: "™",
};

function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s, max = 1000) =>
  decodeEntities(String(s || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function parseAttributes(tag) {
  const attrs = {};
  const re = /([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function extractMeta(html) {
  const meta = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = parseAttributes(m[0]);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content && !meta[key]) meta[key] = a.content.trim();
  }
  return meta;
}

function extractLinks(html, baseUrl) {
  const links = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = parseAttributes(m[1]);
    if (!a.href) continue;
    const href = a.href.trim();
    if (/^(javascript|data):/i.test(href)) continue;
    let abs = href;
    if (!/^(mailto|tel):/i.test(href)) {
      try {
        abs = new URL(href, baseUrl).href;
      } catch {
        continue;
      }
    }
    links.push({ href: abs, text: clean(m[2], 120) });
  }
  return links;
}

const ORG_TYPES =
  /^(Organization|Corporation|LocalBusiness|Store|OnlineStore|OnlineBusiness|Restaurant|FoodEstablishment|ProfessionalService|MedicalBusiness|MedicalOrganization|HealthAndBeautyBusiness|SportsActivityLocation|LodgingBusiness|AutomotiveBusiness|EducationalOrganization|NGO|HomeAndConstructionBusiness|FinancialService|RealEstateAgent|LegalService|Brand|ClothingStore|BeautySalon|DaySpa|HealthClub|Dentist|Physician)$/i;

function flattenJsonLd(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((n) => flattenJsonLd(n, out));
    return out;
  }
  out.push(node);
  if (node["@graph"]) flattenJsonLd(node["@graph"], out);
  return out;
}

function addressToString(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return clean(addr, 300);
  if (Array.isArray(addr)) return addressToString(addr[0]);
  const country =
    typeof addr.addressCountry === "object" ? addr.addressCountry?.name : addr.addressCountry;
  return [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, country]
    .filter(Boolean)
    .map((s) => clean(s, 120))
    .join(", ");
}

function extractJsonLdOrganization(html) {
  const nodes = [];
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      flattenJsonLd(JSON.parse(m[1].trim()), nodes);
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }

  const org = nodes.find((n) => {
    const t = n["@type"];
    return (Array.isArray(t) ? t : [t]).some((x) => typeof x === "string" && ORG_TYPES.test(x));
  });
  if (!org) return null;

  const sameAs = Array.isArray(org.sameAs) ? org.sameAs : org.sameAs ? [org.sameAs] : [];
  const contactPoints = Array.isArray(org.contactPoint)
    ? org.contactPoint
    : org.contactPoint
    ? [org.contactPoint]
    : [];

  return {
    type: Array.isArray(org["@type"]) ? org["@type"].join(",") : org["@type"],
    name: clean(org.name, 200),
    legalName: clean(org.legalName, 200),
    description: clean(org.description, 600),
    url: typeof org.url === "string" ? org.url : "",
    address: addressToString(org.address || org.location?.address),
    telephone: clean(org.telephone || contactPoints[0]?.telephone, 60),
    email: clean(org.email || contactPoints[0]?.email, 120).replace(/^mailto:/i, ""),
    sameAs: sameAs.filter((s) => typeof s === "string"),
    foundingDate: clean(org.foundingDate, 40),
    numberOfEmployees:
      typeof org.numberOfEmployees === "object"
        ? clean(org.numberOfEmployees?.value ?? org.numberOfEmployees?.minValue, 40)
        : clean(org.numberOfEmployees, 40),
  };
}

function visibleText(html, max = 4000) {
  return clean(
    html
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|p|div|li|h[1-6]|section|article|tr)\b[^>]*>/gi, " . "),
    max
  ).replace(/(\s\.\s)+/g, ". ");
}

const ROLE_MAILBOXES =
  /^(info|hello|hi|contact|contacts|enquiries|enquiry|inquiries|inquiry|sales|marketing|press|media|pr|partnerships|partners|business|bd|support|help|office|team|admin|customerservice|service|bookings|booking|reservations|events|wholesale|orders|studio|general|mail)$/i;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;

function isRoleEmail(email) {
  return ROLE_MAILBOXES.test(email.split("@")[0]);
}

function extractContacts(html, links, siteDomain, policy = "role_based") {
  const emails = new Set();
  const phones = new Set();

  const consider = (raw) => {
    const email = raw.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(email)) return;
    if (/\.(png|jpe?g|gif|svg|webp)$/.test(email)) return;
    if (/(example\.|sentry|wixpress|domain\.com)/.test(email)) return;
    if (policy === "role_based" && !isRoleEmail(email)) return;
    emails.add(email);
  };

  for (const l of links) {
    if (/^mailto:/i.test(l.href)) consider(decodeURIComponent(l.href));
    if (/^tel:/i.test(l.href)) {
      const p = decodeURIComponent(l.href.slice(4)).replace(/[^\d+()\-\s.]/g, "").trim();
      if (p.replace(/\D/g, "").length >= 7) phones.add(p);
    }
  }
  for (const m of visibleText(html, 20000).matchAll(EMAIL_RE)) consider(m[0]);

  // Prefer emails on the company's own domain.
  const sorted = [...emails].sort(
    (a, b) =>
      Number(domainKey(b.split("@")[1]) === siteDomain) -
      Number(domainKey(a.split("@")[1]) === siteDomain)
  );

  return { emails: sorted.slice(0, 5), phones: [...phones].slice(0, 3) };
}

function extractSocials(links, jsonLdSameAs = []) {
  const socials = {};
  const candidates = [...jsonLdSameAs, ...links.map((l) => l.href)];
  for (const href of candidates) {
    const platform = socialPlatformOf(href);
    if (!platform || socials[platform]) continue;
    // Skip share/intent links, which are not the company's own profile.
    if (/\/(share|sharer|intent|dialog|plugins)[/.?]/i.test(href)) continue;
    try {
      const u = new URL(href);
      if (u.pathname === "/" || u.pathname === "") continue;
      socials[platform] = `${u.origin}${u.pathname}`.replace(/\/$/, "");
    } catch {
      /* ignore */
    }
  }
  return socials;
}

const PARKED_PATTERNS =
  /(this domain (is|may be) for sale|buy this domain|domain parking|parked (free|domain)|is parked|under construction|coming soon|website is (currently )?unavailable|account (has been )?suspended|default web page|it works!|welcome to nginx|index of \/)/i;

function detectParked(text, title) {
  return PARKED_PATTERNS.test(`${title} ${text.slice(0, 1500)}`) && text.length < 2500;
}

const SUBPAGE_RE = /\/(about|about-us|company|who-we-are|our-story|story|contact|contact-us)(\/|$|\.html?)/i;

function findSubpages(links, siteDomain, limit = 2) {
  const seen = new Set();
  const out = [];
  for (const l of links) {
    if (/^(mailto|tel):/i.test(l.href)) continue;
    try {
      const u = new URL(l.href);
      if (domainKey(u.href) !== siteDomain) continue;
      if (!SUBPAGE_RE.test(u.pathname)) continue;
      const key = u.pathname.replace(/\/$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${u.origin}${u.pathname}`);
    } catch {
      /* ignore */
    }
  }
  // Prefer about pages before contact pages
  out.sort((a, b) => Number(/contact/i.test(a)) - Number(/contact/i.test(b)));
  return out.slice(0, limit);
}

/**
 * Extract facts from a single HTML page.
 */
function extractPage(html, pageUrl, { contactEmailPolicy = "role_based" } = {}) {
  const siteDomain = domainKey(pageUrl);
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = clean(titleMatch ? titleMatch[1] : "", 300);
  const meta = extractMeta(html);
  const links = extractLinks(html, pageUrl);
  const jsonLd = extractJsonLdOrganization(html);
  const text = visibleText(html);
  const langMatch = html.match(/<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z-]+)/i);

  return {
    url: pageUrl,
    title,
    lang: langMatch ? langMatch[1] : "",
    description: clean(meta.description || meta["og:description"] || "", 600),
    siteName: clean(meta["og:site_name"] || "", 200),
    ogTitle: clean(meta["og:title"] || "", 200),
    jsonLd,
    text,
    socials: extractSocials(links, jsonLd?.sameAs),
    contacts: extractContacts(html, links, siteDomain, contactEmailPolicy),
    subpages: findSubpages(links, siteDomain),
    parked: detectParked(text, title),
  };
}

module.exports = {
  extractPage,
  extractJsonLdOrganization,
  extractSocials,
  extractContacts,
  visibleText,
  decodeEntities,
  isRoleEmail,
};
