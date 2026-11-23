/**
 * Polite, bounded HTTP fetcher for public websites.
 *
 * - Manual redirect handling so every hop can be checked (robots, SSRF).
 * - Blocks private / loopback / link-local targets (SSRF protection).
 * - Timeout + maximum body size.
 * - Retries transient failures with backoff.
 */
const dns = require("node:dns").promises;
const net = require("node:net");
const { withRetry, isRetryableError } = require("../../utils/retry");

function isPrivateIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw Object.assign(new Error(`Blocked non-public host: ${host}`), {
      code: "BLOCKED_HOST",
      retryable: false,
    });
  }
  const addrs = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIP(a.address))) {
    throw Object.assign(new Error(`Blocked private network address for ${host}`), {
      code: "BLOCKED_HOST",
      retryable: false,
    });
  }
}

async function readBody(response, maxBytes) {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }

  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const ct = response.headers.get("content-type") || "";
  const charset = (ct.match(/charset=([^;]+)/i) || [])[1];
  let text;
  try {
    text = new TextDecoder(charset ? charset.trim() : "utf-8").decode(buf);
  } catch {
    text = buf.toString("utf8");
  }
  return { text, truncated };
}

/**
 * Create a fetcher bound to crawler settings.
 *
 * @param {object} opts
 * @param {string} opts.userAgent
 * @param {number} opts.timeoutMs
 * @param {number} opts.maxBytes
 * @param {number} opts.maxRedirects
 * @param {number} opts.retries
 * @param {boolean} opts.allowPrivateNetwork
 * @param {(url: URL) => Promise<void>} [opts.beforeRequest] hook per hop
 *        (rate-limiting / robots); throw to abort.
 */
function createFetcher(opts) {
  const {
    userAgent,
    timeoutMs = 12000,
    maxBytes = 1500000,
    maxRedirects = 5,
    retries = 2,
    allowPrivateNetwork = false,
    fetchImpl = globalThis.fetch,
  } = opts;

  async function fetchOnce(url, { beforeRequest, accept }) {
    let current = new URL(url);
    const redirects = [];

    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!["http:", "https:"].includes(current.protocol)) {
        throw Object.assign(new Error(`Unsupported protocol ${current.protocol}`), {
          retryable: false,
        });
      }
      if (!allowPrivateNetwork) await assertPublicHost(current.hostname);
      if (beforeRequest) await beforeRequest(current);

      const res = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": userAgent,
          accept: accept || "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en;q=0.9,*;q=0.5",
        },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        const next = new URL(res.headers.get("location"), current);
        redirects.push(next.href);
        current = next;
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel().catch(() => {});
        const retryAfter = Number(res.headers.get("retry-after"));
        throw Object.assign(new Error(`HTTP ${res.status} for ${current.href}`), {
          status: res.status,
          retryAfterMs: Number.isFinite(retryAfter) ? Math.min(retryAfter, 60) * 1000 : 0,
        });
      }

      const { text, truncated } = await readBody(res, maxBytes);
      return {
        url: current.href,
        status: res.status,
        contentType: res.headers.get("content-type") || "",
        headers: Object.fromEntries(res.headers),
        body: text,
        truncated,
        redirects,
      };
    }

    throw Object.assign(new Error(`Too many redirects for ${url}`), { retryable: false });
  }

  return async function fetchPage(url, { beforeRequest, accept, retry = true } = {}) {
    return withRetry(() => fetchOnce(url, { beforeRequest, accept }), {
      retries: retry ? retries : 0,
      minDelayMs: 1000,
      maxDelayMs: 10000,
      // A domain that does not resolve will not start resolving on retry.
      shouldRetry: (err) =>
        (err.code || err.cause?.code) !== "ENOTFOUND" && isRetryableError(err),
    });
  };
}

module.exports = { createFetcher, isPrivateIP, assertPublicHost };
