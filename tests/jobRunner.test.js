const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LOG_LEVEL = "error";
const logger = require("../utils/logger");
const { MemoryDiscoveryRepository } = require("../repositories/memory.repository");
const { JobRunner } = require("../Services/discovery/jobRunner");
const { JobCancelledError } = require("../utils/errors");

const cfg = { jobs: { concurrency: 1, leaseMs: 60000, pollIntervalMs: 20, maxAttempts: 3 } };

const waitStatus = async (repo, id, statuses) => {
  for (let i = 0; i < 200; i++) {
    const j = await repo.getJob(id);
    if (statuses.includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout");
};

test("transient failure is retried and resumes from the failed stage", async () => {
  const repo = new MemoryDiscoveryRepository();
  const seenStages = [];
  let calls = 0;
  const pipeline = {
    async run(job) {
      calls++;
      seenStages.push(job.stage);
      if (calls === 1) {
        await repo.updateJob(job.id, { stage: "verifying" });
        throw Object.assign(new Error("Gemini 503"), { status: 503 });
      }
      await repo.updateJob(job.id, { status: "completed", stage: "completed" });
    },
  };
  const runner = new JobRunner({ repo, pipeline, config: cfg, logger });
  const job = await repo.createJob({ profile: { agencyType: "x" } });
  runner.start();
  const done = await waitStatus(repo, job.id, ["completed", "failed"]);
  await runner.stop();
  assert.equal(done.status, "completed");
  assert.deepEqual(seenStages, ["queued", "verifying"]);
  assert.equal(done.attempts, 2);
});

test("permanent failure marks job failed; cancellation marks cancelled", async () => {
  const repo = new MemoryDiscoveryRepository();
  const pipeline = {
    async run(job) {
      if (job.profile.agencyType === "fail") throw Object.assign(new Error("bad config"), { retryable: false });
      throw new JobCancelledError();
    },
  };
  const runner = new JobRunner({ repo, pipeline, config: cfg, logger });
  const a = await repo.createJob({ profile: { agencyType: "fail" } });
  const b = await repo.createJob({ profile: { agencyType: "cancel" } });
  runner.start();
  assert.equal((await waitStatus(repo, a.id, ["failed"])).error.message, "bad config");
  assert.equal((await waitStatus(repo, b.id, ["cancelled"])).status, "cancelled");
  await runner.stop();
});

test("expired lease lets another worker claim a crashed job", async () => {
  const repo = new MemoryDiscoveryRepository();
  const job = await repo.createJob({ profile: { agencyType: "x" } });
  const first = await repo.claimJob({ workerId: "w1", leaseMs: 1 });
  assert.equal(first.id, job.id);
  assert.equal(await repo.claimJob({ workerId: "w2", leaseMs: 60000 }).then((j) => j && j.leaseOwner), null);
  await new Promise((r) => setTimeout(r, 5));
  const second = await repo.claimJob({ workerId: "w2", leaseMs: 60000 });
  assert.equal(second.id, job.id);
  assert.equal(second.leaseOwner, "w2");
  assert.equal(await repo.renewLease(job.id, "w1", 1000), false);
});
