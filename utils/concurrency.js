const { sleep } = require("./retry");

/**
 * Promise concurrency limiter (CommonJS replacement for p-limit).
 */
function createLimiter(concurrency) {
  const max = Math.max(1, Number(concurrency) || 1);
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };

  const limit = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });

  limit.activeCount = () => active;
  limit.pendingCount = () => queue.length;
  return limit;
}

/**
 * Enforces a minimum interval between requests to the same host.
 * The interval can be raised per host (e.g. robots.txt Crawl-delay).
 */
class HostRateLimiter {
  constructor({ defaultIntervalMs = 1000, maxIntervalMs = 30000 } = {}) {
    this.defaultIntervalMs = defaultIntervalMs;
    this.maxIntervalMs = maxIntervalMs;
    this.nextSlot = new Map();
    this.intervals = new Map();
  }

  setInterval(host, ms) {
    const bounded = Math.min(
      this.maxIntervalMs,
      Math.max(this.defaultIntervalMs, Number(ms) || 0)
    );
    this.intervals.set(host, bounded);
  }

  async wait(host) {
    const interval = this.intervals.get(host) ?? this.defaultIntervalMs;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) || 0);
    this.nextSlot.set(host, slot + interval);

    // Prevent unbounded growth of the map on very large crawls
    if (this.nextSlot.size > 50000) {
      for (const [h, t] of this.nextSlot) {
        if (t < now) this.nextSlot.delete(h);
      }
    }

    if (slot > now) await sleep(slot - now);
  }
}

/**
 * Map over items with bounded concurrency, collecting settled results.
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const limit = createLimiter(concurrency);
  return Promise.allSettled(items.map((item, i) => limit(() => fn(item, i))));
}

module.exports = { createLimiter, HostRateLimiter, mapWithConcurrency };
