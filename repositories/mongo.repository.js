/**
 * MongoDB (Mongoose) implementation of the discovery repository.
 */
const mongoose = require("mongoose");
const DiscoveryJob = require("../model/DiscoveryJob");
const DiscoveredCompany = require("../model/DiscoveredCompany");
const CompanyCache = require("../model/CompanyCache");

const plain = (doc) => {
  if (!doc) return null;
  const out = { ...doc, id: String(doc._id) };
  if (out.jobId) out.jobId = String(out.jobId);
  delete out.__v;
  return out;
};

const validId = (id) => mongoose.isValidObjectId(id);

function buildUpdate(set = {}, { inc, push, unset } = {}) {
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (inc) update.$inc = inc;
  if (unset) update.$unset = unset;
  if (push) {
    update.$push = {};
    for (const [k, v] of Object.entries(push)) {
      update.$push[k] = Array.isArray(v) ? { $each: v } : v;
    }
  }
  return update;
}

class MongoDiscoveryRepository {
  constructor() {
    this.kind = "mongo";
  }

  async init() {
    await Promise.all([
      DiscoveryJob.syncIndexes(),
      DiscoveredCompany.syncIndexes(),
      CompanyCache.syncIndexes(),
    ]);
  }

  // ---------------- jobs ----------------
  async createJob(data) {
    const job = await DiscoveryJob.create(data);
    return plain(job.toObject());
  }

  async getJob(id) {
    if (!validId(id)) return null;
    return plain(await DiscoveryJob.findById(id).lean());
  }

  async updateJob(id, set, extra) {
    if (!validId(id)) return null;
    return plain(
      await DiscoveryJob.findByIdAndUpdate(id, buildUpdate(set, extra), { new: true }).lean()
    );
  }

  async listJobs({ limit = 20, skip = 0, status } = {}) {
    const filter = status ? { status } : {};
    const [items, total] = await Promise.all([
      DiscoveryJob.find(filter)
        .select("-queriesRun -stageLog")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DiscoveryJob.countDocuments(filter),
    ]);
    return { items: items.map(plain), total };
  }

  async claimJob({ workerId, leaseMs }) {
    const now = new Date();
    const job = await DiscoveryJob.findOneAndUpdate(
      {
        cancelRequested: { $ne: true },
        $or: [{ status: "queued" }, { status: "running", leaseUntil: { $lt: now } }],
      },
      {
        $set: { status: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + leaseMs) },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } }
    ).lean();
    return plain(job);
  }

  async renewLease(id, workerId, leaseMs) {
    const res = await DiscoveryJob.updateOne(
      { _id: id, leaseOwner: workerId, status: "running" },
      { $set: { leaseUntil: new Date(Date.now() + leaseMs) } }
    );
    return res.matchedCount === 1;
  }

  // ---------------- companies ----------------
  async upsertCompany(jobId, domainKey, insertDoc, via) {
    // discoveredVia/discoveryCount are only touched by $push/$inc so the
    // same update works for both insert and merge (no path conflicts).
    const { discoveredVia, discoveryCount, ...onInsert } = insertDoc;
    const update = {
      $setOnInsert: {
        status: "discovered",
        profile: {},
        evidence: [],
        sourceUrls: [],
        qualification: null,
        isTop10: false,
        isWinner: false,
        ...onInsert,
        jobId,
        domainKey,
        ...(via ? {} : { discoveredVia: [] }),
      },
      $inc: { discoveryCount: 1 },
      ...(via ? { $push: { discoveredVia: { $each: [via], $slice: 10 } } } : {}),
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await DiscoveredCompany.updateOne({ jobId, domainKey }, update, {
          upsert: true,
          // Defaults are set explicitly above; avoids $push/$setOnInsert conflicts.
          setDefaultsOnInsert: false,
        });
        return { created: res.upsertedCount === 1 };
      } catch (err) {
        // Concurrent upsert race on the unique index: retry as an update.
        if (err.code !== 11000 || attempt === 1) throw err;
      }
    }
    return { created: false };
  }

  async findCompany(jobId, filter) {
    return plain(await DiscoveredCompany.findOne({ jobId, ...filter }).lean());
  }

  async findCompanies(jobId, filter = {}, { sort = { createdAt: 1 }, skip = 0, limit = 1000, select } = {}) {
    let q = DiscoveredCompany.find({ jobId, ...filter }).sort(sort).skip(skip).limit(limit);
    if (select) q = q.select(select);
    return (await q.lean()).map(plain);
  }

  async countCompanies(jobId, filter = {}) {
    return DiscoveredCompany.countDocuments({ jobId, ...filter });
  }

  async countByStatus(jobId) {
    const rows = await DiscoveredCompany.aggregate([
      { $match: { jobId: new mongoose.Types.ObjectId(String(jobId)) } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }

  async updateCompany(id, set, extra) {
    await DiscoveredCompany.updateOne({ _id: id }, buildUpdate(set, extra));
  }

  async updateCompanies(jobId, filter, set) {
    await DiscoveredCompany.updateMany({ jobId, ...filter }, { $set: set });
  }

  // ---------------- cache ----------------
  async getCache(domainKey) {
    const hit = await CompanyCache.findOne({ domainKey, expiresAt: { $gt: new Date() } }).lean();
    return hit ? hit.result : null;
  }

  async setCache(domainKey, result, ttlMs) {
    await CompanyCache.updateOne(
      { domainKey },
      { $set: { result, expiresAt: new Date(Date.now() + ttlMs) } },
      { upsert: true }
    );
  }
}

module.exports = { MongoDiscoveryRepository };
