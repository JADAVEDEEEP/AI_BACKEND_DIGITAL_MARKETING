/**
 * Repository contract: the same behaviour is required of the in-memory and
 * MongoDB implementations. The MongoDB run is enabled by TEST_MONGODB_URI
 * (e.g. TEST_MONGODB_URI=mongodb://localhost:27017/discovery_test npm test).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { MemoryDiscoveryRepository } = require("../repositories/memory.repository");

const impls = [["memory", async () => new MemoryDiscoveryRepository(), async () => {}]];

if (process.env.TEST_MONGODB_URI) {
  const mongoose = require("mongoose");
  const { MongoDiscoveryRepository } = require("../repositories/mongo.repository");
  impls.push([
    "mongo",
    async () => {
      await mongoose.connect(process.env.TEST_MONGODB_URI);
      await mongoose.connection.db.dropDatabase();
      const repo = new MongoDiscoveryRepository();
      await repo.init();
      return repo;
    },
    async () => mongoose.disconnect(),
  ]);
}

for (const [name, make, teardown] of impls) {
  test(`${name} repository satisfies the contract`, async (t) => {
    const repo = await make();
    t.after(teardown);

    const job = await repo.createJob({ profile: { agencyType: "SMM" }, options: {} });
    assert.equal(job.status, "queued");
    assert.equal((await repo.getJob(job.id)).id, job.id);

    // upsert + merge on the same (jobId, domainKey)
    const via = (n) => ({ provider: "p", query: `q${n}`, sourceUrl: `https://s/${n}`, snippet: "", at: new Date() });
    assert.equal((await repo.upsertCompany(job.id, "a.com", { name: "A", nameKey: "a", status: "discovered" }, via(1))).created, true);
    assert.equal((await repo.upsertCompany(job.id, "a.com", { name: "A Inc", nameKey: "a", status: "discovered" }, via(2))).created, false);
    const a = await repo.findCompany(job.id, { domainKey: "a.com" });
    assert.equal(a.name, "A");
    assert.equal(a.discoveryCount, 2);
    assert.equal(a.discoveredVia.length, 2);

    // concurrent upserts never create duplicates
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => repo.upsertCompany(job.id, "b.com", { name: "B", nameKey: "b", status: "discovered" }, via(i)))
    );
    assert.equal(await repo.countCompanies(job.id, { domainKey: "b.com" }), 1);

    // changing domainKey to an existing one is rejected (unique index)
    await repo.upsertCompany(job.id, "name:c", { name: "C", nameKey: "c", status: "needs_website" }, via(3));
    const c = await repo.findCompany(job.id, { domainKey: "name:c" });
    await assert.rejects(repo.updateCompany(c.id, { domainKey: "a.com" }), (e) => e.code === 11000);

    // filters, sorting, counts
    await repo.updateCompany(a.id, { status: "qualified", qualification: { score: 70 } });
    const b = await repo.findCompany(job.id, { domainKey: "b.com" });
    await repo.updateCompany(b.id, { status: "qualified", qualification: { score: 90 } });
    const ranked = await repo.findCompanies(job.id, { status: { $in: ["qualified"] } }, { sort: { "qualification.score": -1 } });
    assert.deepEqual(ranked.map((x) => x.domainKey), ["b.com", "a.com"]);
    assert.deepEqual(await repo.countByStatus(job.id), { qualified: 2, needs_website: 1 });
    assert.equal((await repo.findCompanies(job.id, { status: "needs_website", qualification: null })).length, 1);

    await repo.updateCompanies(job.id, { status: "qualified" }, { isTop10: true });
    assert.equal(await repo.countCompanies(job.id, { isTop10: true }), 2);

    // job updates with push / inc
    await repo.updateJob(job.id, { stage: "discovering" }, { push: { queriesRun: ["x", "y"] }, inc: { discoveryRounds: 1 } });
    const j2 = await repo.getJob(job.id);
    assert.deepEqual(j2.queriesRun, ["x", "y"]);
    assert.equal(j2.discoveryRounds, 1);

    // lease claim semantics
    const claimed = await repo.claimJob({ workerId: "w1", leaseMs: 60000 });
    assert.equal(claimed.id, job.id);
    assert.equal(await repo.claimJob({ workerId: "w2", leaseMs: 60000 }), null);
    assert.equal(await repo.renewLease(job.id, "w1", 60000), true);
    assert.equal(await repo.renewLease(job.id, "w2", 60000), false);

    // cache
    await repo.setCache("a.com", { status: "verified" }, 60000);
    assert.deepEqual(await repo.getCache("a.com"), { status: "verified" });
    assert.equal(await repo.getCache("zzz.com"), null);
  });
}
