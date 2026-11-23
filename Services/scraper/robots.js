/**
 * robots.txt parser + matcher following RFC 9309.
 *
 * - Groups are selected by matching our product token (case-insensitive);
 *   falls back to "*" groups.
 * - Longest matching rule wins; on equal length "allow" wins.
 * - Supports "*" wildcards and "$" end anchors.
 * - Exposes Crawl-delay (non-standard but widely used) and Sitemap lines.
 */

function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;

  const lines = String(text || "").split(/\r\n|\r|\n/);

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;

    if (field === "sitemap") {
      sitemaps.push(value);
      continue;
    }

    if (!current) continue;

    if (field === "allow" || field === "disallow") {
      // An empty Disallow means "allow everything" – no rule needed.
      if (field === "disallow" && value === "") continue;
      current.rules.push({ allow: field === "allow", path: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  return { groups, sitemaps };
}

function escapeRegex(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function ruleToRegex(path) {
  let anchored = false;
  let p = path;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const pattern = p
    .split("*")
    .map((part) => escapeRegex(part))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`);
}

function normalizePathForMatch(path) {
  // Percent-encode characters consistently so both sides compare equal.
  try {
    return encodeURI(decodeURI(path));
  } catch {
    return path;
  }
}

class RobotsPolicy {
  constructor(text, { allowAll = false, disallowAll = false } = {}) {
    this.allowAll = allowAll;
    this.disallowAll = disallowAll;
    this.parsed = parseRobots(text);
  }

  static allowAll() {
    return new RobotsPolicy("", { allowAll: true });
  }

  static disallowAll() {
    return new RobotsPolicy("", { disallowAll: true });
  }

  groupsFor(token) {
    const t = String(token || "").toLowerCase();
    const specific = this.parsed.groups.filter((g) =>
      g.agents.some((a) => a !== "*" && t.includes(a))
    );
    if (specific.length) return specific;
    return this.parsed.groups.filter((g) => g.agents.includes("*"));
  }

  isAllowed(urlOrPath, token) {
    if (this.disallowAll) return false;
    if (this.allowAll) return true;

    let path = urlOrPath;
    try {
      const u = new URL(urlOrPath);
      path = u.pathname + u.search;
    } catch {
      /* already a path */
    }
    path = normalizePathForMatch(path || "/");
    if (path === "/robots.txt") return true;

    const rules = this.groupsFor(token).flatMap((g) => g.rules);
    let best = null;

    for (const rule of rules) {
      const rulePath = normalizePathForMatch(rule.path);
      if (!ruleToRegex(rulePath).test(path)) continue;
      const len = rulePath.length;
      if (
        !best ||
        len > best.len ||
        (len === best.len && rule.allow && !best.allow)
      ) {
        best = { len, allow: rule.allow };
      }
    }

    return best ? best.allow : true;
  }

  crawlDelayMs(token) {
    if (this.allowAll || this.disallowAll) return null;
    const delays = this.groupsFor(token)
      .map((g) => g.crawlDelay)
      .filter((d) => d !== null);
    return delays.length ? Math.max(...delays) * 1000 : null;
  }

  get sitemaps() {
    return this.parsed.sitemaps;
  }
}

/**
 * Per-origin robots.txt cache with RFC 9309 failure semantics:
 * 2xx -> parse, 4xx -> allow all, 5xx / network error -> disallow all.
 */
class RobotsCache {
  constructor({ fetchText, ttlMs = 24 * 3600 * 1000, maxEntries = 20000 }) {
    this.fetchText = fetchText; // async (url) => { status, body }
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.cache = new Map();
    this.inflight = new Map();
  }

  async policyFor(url) {
    const origin = new URL(url).origin;
    const hit = this.cache.get(origin);
    if (hit && hit.expires > Date.now()) return hit.policy;

    if (this.inflight.has(origin)) return this.inflight.get(origin);

    const p = (async () => {
      let policy;
      let ttl = this.ttlMs;
      try {
        const res = await this.fetchText(`${origin}/robots.txt`);
        if (res.status >= 200 && res.status < 300) {
          policy = new RobotsPolicy(res.body);
        } else if (res.status >= 400 && res.status < 500) {
          policy = RobotsPolicy.allowAll();
        } else {
          policy = RobotsPolicy.disallowAll();
          ttl = Math.min(ttl, 3600 * 1000);
        }
      } catch {
        policy = RobotsPolicy.disallowAll();
        ttl = Math.min(ttl, 3600 * 1000);
      }

      if (this.cache.size >= this.maxEntries) {
        this.cache.delete(this.cache.keys().next().value);
      }
      this.cache.set(origin, { policy, expires: Date.now() + ttl });
      return policy;
    })().finally(() => this.inflight.delete(origin));

    this.inflight.set(origin, p);
    return p;
  }
}

module.exports = { parseRobots, RobotsPolicy, RobotsCache };
