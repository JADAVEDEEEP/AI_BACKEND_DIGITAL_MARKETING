/**
 * Lease-based background job runner.
 *
 * Jobs are claimed atomically from the repository with a time-limited
 * lease that is renewed while the job runs. If a process crashes, the
 * lease expires and any instance can resume the job from its last stage.
 * This makes the runner safe to run on multiple instances.
 */
const os = require("node:os");
const crypto = require("node:crypto");
const { JobCancelledError } = require("../../utils/errors");
const { LeaseLostError } = require("./pipeline");
const { isRetryableError } = require("../../utils/retry");

class JobRunner {
  constructor({ repo, pipeline, config, logger }) {
    this.repo = repo;
    this.pipeline = pipeline;
    this.cfg = config.jobs;
    this.log = logger.child({ component: "jobRunner" });
    this.workerId = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
    this.active = new Map();
    this.timer = null;
    this.stopping = false;
  }

  start() {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => this.tick(), this.cfg.pollIntervalMs);
    this.timer.unref?.();
    this.log.info("runner.started", { workerId: this.workerId, concurrency: this.cfg.concurrency });
    this.tick();
  }

  /** Trigger an immediate claim attempt (e.g. after a job is enqueued). */
  kick() {
    setImmediate(() => this.tick());
  }

  async tick() {
    if (this.stopping || this.ticking) return;
    this.ticking = true;
    try {
      while (this.active.size < this.cfg.concurrency && !this.stopping) {
        const job = await this.repo.claimJob({ workerId: this.workerId, leaseMs: this.cfg.leaseMs });
        if (!job) break;
        const p = this.execute(job).finally(() => this.active.delete(job.id));
        this.active.set(job.id, p);
      }
    } catch (err) {
      this.log.error("runner.tick_failed", { error: err });
    } finally {
      this.ticking = false;
    }
  }

  async execute(job) {
    const log = this.log.child({ jobId: job.id, attempt: job.attempts });

    if (job.attempts > this.cfg.maxAttempts) {
      await this.repo.updateJob(job.id, {
        status: "failed",
        leaseOwner: null,
        leaseUntil: null,
        completedAt: new Date(),
        error: { message: "Maximum attempts exceeded", lastError: job.error },
      });
      log.error("job.max_attempts");
      return;
    }

    log.info("job.claimed", { stage: job.stage });

    let leaseOk = true;
    const renew = setInterval(async () => {
      try {
        leaseOk = await this.repo.renewLease(job.id, this.workerId, this.cfg.leaseMs);
      } catch (err) {
        log.warn("job.lease_renew_failed", { error: err.message });
      }
    }, Math.max(1000, Math.floor(this.cfg.leaseMs / 3)));
    renew.unref?.();

    try {
      await this.pipeline.run(job, { heartbeat: async () => leaseOk });
    } catch (err) {
      if (err instanceof LeaseLostError) {
        log.warn("job.lease_lost");
        return;
      }
      if (err instanceof JobCancelledError) {
        await this.repo.updateJob(job.id, {
          status: "cancelled",
          leaseOwner: null,
          leaseUntil: null,
          completedAt: new Date(),
        });
        log.info("job.cancelled");
        return;
      }

      const retry = isRetryableError(err) && job.attempts < this.cfg.maxAttempts;
      const current = await this.repo.getJob(job.id);
      await this.repo.updateJob(job.id, {
        status: retry ? "queued" : "failed",
        leaseOwner: null,
        leaseUntil: null,
        ...(retry ? {} : { completedAt: new Date() }),
        error: {
          message: err.message,
          stage: current?.stage,
          at: new Date(),
          willRetry: retry,
        },
      });
      log.error("job.failed", { error: err, willRetry: retry, stage: current?.stage });
    } finally {
      clearInterval(renew);
    }
  }

  /** Stop claiming new jobs and release leases of running ones. */
  async stop({ timeoutMs = 10000 } = {}) {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const running = [...this.active.values()];
    if (!running.length) return;

    await Promise.race([
      Promise.allSettled(running),
      new Promise((r) => setTimeout(r, timeoutMs).unref?.()),
    ]);

    // Jobs still running will be resumed by another instance after the
    // lease expires; release them now so that happens immediately.
    for (const id of this.active.keys()) {
      await this.repo
        // A graceful shutdown should not consume one of the job's attempts.
        .updateJob(id, { status: "queued", leaseOwner: null, leaseUntil: null }, { inc: { attempts: -1 } })
        .catch(() => {});
    }
  }
}

module.exports = { JobRunner };
