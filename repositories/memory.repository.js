/**
 * In-memory implementation of the discovery repository.
 * Used for local development/tests when MONGODB_URI is not configured.
 * Data is NOT persisted across restarts.
 */
const crypto = require("node:crypto");

const newId = () => crypto.randomBytes(12).toString("hex");
const clone = (v) => (v === undefined ? v : structuredClone(v));

const getPath = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

const setPath = (obj, path, value) => {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
};

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return cond.some((f) => matches(doc, f));
    const value = getPath(doc, key);
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, arg]) => {
        switch (op) {
          case "$in": return arg.includes(value);
          case "$nin": return !arg.includes(value);
          case "$ne": return value !== arg;
          case "$exists": return arg ? value !== undefined && value !== null : value === undefined || value === null;
          case "$gte": return value >= arg;
          case "$gt": return value > arg;
          case "$lte": return value <= arg;
          case "$lt": return value < arg;
          default: throw new Error(`Unsupported operator ${op}`);
        }
      });
    }
    return value === cond;
  });
}

function sortDocs(docs, sort = {}) {
  const keys = Object.entries(sort);
  return docs.sort((a, b) => {
    for (const [k, dir] of keys) {
      const va = getPath(a, k);
      const vb = getPath(b, k);
      if (va === vb) continue;
      if (va === undefined || va === null) return 1;
      if (vb === undefined || vb === null) return -1;
      return (va > vb ? 1 : -1) * (dir < 0 ? -1 : 1);
    }
    return 0;
  });
}

function applyUpdate(doc, set = {}, { inc, push, unset } = {}) {
  for (const [k, v] of Object.entries(set)) setPath(doc, k, clone(v));
  for (const [k, v] of Object.entries(inc || {})) setPath(doc, k, (getPath(doc, k) || 0) + v);
  for (const [k, v] of Object.entries(push || {})) {
    const arr = getPath(doc, k) || [];
    arr.push(...(Array.isArray(v) ? clone(v) : [clone(v)]));
    setPath(doc, k, arr);
  }
  for (const k of Object.keys(unset || {})) setPath(doc, k, undefined);
  doc.updatedAt = new Date();
}

class MemoryDiscoveryRepository {
  constructor() {
    this.kind = "memory";
    this.jobs = new Map();
    this.companies = new Map(); // id -> doc
    this.companyKeys = new Map(); // `${jobId}|${domainKey}` -> id
    this.cache = new Map();
  }

  async init() {}

  // ---------------- jobs ----------------
  async createJob(data) {
    const now = new Date();
    const job = {
      status: "queued",
      stage: "queued",
      progress: {},
      queriesRun: [],
      discoveryRounds: 0,
      top10: [],
      finalEvaluation: null,
      winner: null,
      attempts: 0,
      leaseOwner: null,
      leaseUntil: null,
      cancelRequested: false,
      error: null,
      stageLog: [],
      ...clone(data),
      _id: newId(),
      createdAt: now,
      updatedAt: now,
    };
    job.id = job._id;
    this.jobs.set(job.id, job);
    return clone(job);
  }

  async getJob(id) {
    return clone(this.jobs.get(String(id)) || null);
  }

  async updateJob(id, set, extra) {
    const job = this.jobs.get(String(id));
    if (!job) return null;
    applyUpdate(job, set, extra);
    return clone(job);
  }

  async listJobs({ limit = 20, skip = 0, status } = {}) {
    const all = sortDocs(
      [...this.jobs.values()].filter((j) => !status || j.status === status),
      { createdAt: -1 }
    );
    return {
      items: all.slice(skip, skip + limit).map(({ queriesRun, stageLog, ...j }) => clone(j)),
      total: all.length,
    };
  }

  async claimJob({ workerId, leaseMs }) {
    const now = Date.now();
    const candidates = sortDocs(
      [...this.jobs.values()].filter(
        (j) =>
          !j.cancelRequested &&
          (j.status === "queued" || (j.status === "running" && j.leaseUntil && j.leaseUntil.getTime() < now))
      ),
      { createdAt: 1 }
    );
    const job = candidates[0];
    if (!job) return null;
    applyUpdate(
      job,
      { status: "running", leaseOwner: workerId, leaseUntil: new Date(now + leaseMs) },
      { inc: { attempts: 1 } }
    );
    return clone(job);
  }

  async renewLease(id, workerId, leaseMs) {
    const job = this.jobs.get(String(id));
    if (!job || job.leaseOwner !== workerId || job.status !== "running") return false;
    job.leaseUntil = new Date(Date.now() + leaseMs);
    return true;
  }

  // ---------------- companies ----------------
  async upsertCompany(jobId, domainKey, insertDoc, via) {
    const key = `${jobId}|${domainKey}`;
    const existingId = this.companyKeys.get(key);
    if (existingId) {
      const doc = this.companies.get(existingId);
      doc.discoveryCount = (doc.discoveryCount || 0) + 1;
      if (via && doc.discoveredVia.length < 10) doc.discoveredVia.push(clone(via));
      doc.updatedAt = new Date();
      return { created: false };
    }
    const now = new Date();
    const { discoveredVia, discoveryCount, ...rest } = insertDoc;
    const doc = {
      status: "discovered",
      profile: {},
      evidence: [],
      sourceUrls: [],
      qualification: null,
      isTop10: false,
      isWinner: false,
      ...clone(rest),
      discoveredVia: via ? [clone(via)] : [],
      discoveryCount: 1,
      jobId: String(jobId),
      domainKey,
      _id: newId(),
      createdAt: now,
      updatedAt: now,
    };
    doc.id = doc._id;
    this.companies.set(doc.id, doc);
    this.companyKeys.set(key, doc.id);
    return { created: true };
  }

  _jobCompanies(jobId, filter) {
    return [...this.companies.values()].filter(
      (c) => c.jobId === String(jobId) && matches(c, filter)
    );
  }

  async findCompany(jobId, filter) {
    return clone(this._jobCompanies(jobId, filter)[0] || null);
  }

  async findCompanies(jobId, filter = {}, { sort = { createdAt: 1 }, skip = 0, limit = 1000 } = {}) {
    return sortDocs(this._jobCompanies(jobId, filter), sort)
      .slice(skip, skip + limit)
      .map(clone);
  }

  async countCompanies(jobId, filter = {}) {
    return this._jobCompanies(jobId, filter).length;
  }

  async countByStatus(jobId) {
    const out = {};
    for (const c of this._jobCompanies(jobId, {})) out[c.status] = (out[c.status] || 0) + 1;
    return out;
  }

  async updateCompany(id, set, extra) {
    const doc = this.companies.get(String(id));
    if (!doc) return;
    if (set.domainKey && set.domainKey !== doc.domainKey) {
      const newKey = `${doc.jobId}|${set.domainKey}`;
      if (this.companyKeys.has(newKey)) {
        const err = new Error("Duplicate key");
        err.code = 11000;
        throw err;
      }
      this.companyKeys.delete(`${doc.jobId}|${doc.domainKey}`);
      this.companyKeys.set(newKey, doc.id);
    }
    applyUpdate(doc, set, extra);
  }

  async updateCompanies(jobId, filter, set) {
    for (const c of this._jobCompanies(jobId, filter)) applyUpdate(c, set);
  }

  // ---------------- cache ----------------
  async getCache(domainKey) {
    const hit = this.cache.get(domainKey);
    if (!hit || hit.expiresAt < Date.now()) return null;
    return clone(hit.result);
  }

  async setCache(domainKey, result, ttlMs) {
    this.cache.set(domainKey, { result: clone(result), expiresAt: Date.now() + ttlMs });
  }
}

module.exports = { MemoryDiscoveryRepository };
