/**
 * Automated company discovery & qualification pipeline.
 *
 * Stages (each persisted & resumable):
 *   discovering -> resolving_websites -> verifying -> qualifying
 *   -> ranking -> final_evaluation -> completed
 *
 * All dependencies are injected so the pipeline can be unit-tested and
 * so providers can be swapped without touching orchestration logic.
 */
const { planQueries } = require("./queryPlanner");
const { qualifyBatch } = require("../qualification/qualifier");
const { evaluateFinalists } = require("../qualification/finalEvaluator");
const { compareQualified } = require("../qualification/scoring");
const { createLimiter, mapWithConcurrency } = require("../../utils/concurrency");
const { JobCancelledError } = require("../../utils/errors");
const {
  domainKey: toDomainKey,
  isNonCompanyDomain,
  normalizeCompanyName,
  homepageUrl,
} = require("../../utils/url");

const STAGE_ORDER = [
  "discovering",
  "resolving_websites",
  "verifying",
  "qualifying",
  "ranking",
  "final_evaluation",
  "completed",
];

const QUALIFIABLE_STATUSES = ["verified", "robots_blocked", "unreachable"];

class LeaseLostError extends Error {
  constructor() {
    super("Job lease lost to another worker.");
    this.name = "LeaseLostError";
    this.retryable = false;
  }
}

function createPipeline({ repo, ai, sources, resolveWebsite, scraper, config, logger }) {
  const d = config.discovery;

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  function createContext(job, { heartbeat } = {}) {
    const log = logger.child({ jobId: job.id });
    let lastCheck = 0;

    const checkpoint = async (force = false) => {
      if (!force && Date.now() - lastCheck < 3000) return;
      lastCheck = Date.now();
      const fresh = await repo.getJob(job.id);
      if (!fresh || fresh.cancelRequested) throw new JobCancelledError();
      if (heartbeat && !(await heartbeat())) throw new LeaseLostError();
    };

    return { job, log, checkpoint, profile: job.profile, options: job.options || {} };
  }

  async function refreshProgress(jobId, extra = {}) {
    const byStatus = await repo.countByStatus(jobId);
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const progress = {
      totalDiscovered: total,
      unique: total - (byStatus.duplicate || 0),
      duplicates: byStatus.duplicate || 0,
      invalid: byStatus.invalid || 0,
      verified:
        (byStatus.verified || 0) +
        (byStatus.qualified || 0) +
        (byStatus.disqualified || 0) +
        (byStatus.qualification_failed || 0),
      qualified: byStatus.qualified || 0,
      disqualified: byStatus.disqualified || 0,
      byStatus,
    };
    const current = (await repo.getJob(jobId))?.progress || {};
    const merged = { ...current, ...progress, ...extra, updatedAt: new Date() };
    await repo.updateJob(jobId, { progress: merged });
    return merged;
  }

  async function setStage(ctx, stage) {
    ctx.job.stage = stage;
    await repo.updateJob(ctx.job.id, { stage }, { push: { stageLog: { stage, at: new Date() } } });
    ctx.log.info("stage.start", { stage });
  }

  // ------------------------------------------------------------------
  // ingestion + dedup
  // ------------------------------------------------------------------
  function buildExclusions(profile) {
    const names = new Set();
    const domains = new Set();
    for (const e of profile.excludedCompanies || []) {
      const dk = /\./.test(e) ? toDomainKey(e) : null;
      if (dk) domains.add(dk);
      const nk = normalizeCompanyName(e);
      if (nk) names.add(nk);
    }
    return { names, domains };
  }

  /**
   * Insert or merge a discovered candidate. Returns true if new.
   * Dedup keys: registrable domain (primary), normalised name (secondary).
   */
  async function ingestCandidate(ctx, c, exclusions) {
    const jobId = ctx.job.id;
    const nameKey = normalizeCompanyName(c.name);
    if (!nameKey || nameKey.length < 2) return false;
    if (exclusions.names.has(nameKey)) return false;

    let dk = null;
    let website = null;
    if (c.website && !isNonCompanyDomain(c.website)) {
      dk = toDomainKey(c.website);
      website = homepageUrl(c.website);
    }
    if (dk && exclusions.domains.has(dk)) return false;

    const via = {
      provider: c.provider,
      query: c.query,
      sourceUrl: c.sourceUrl || (c.groundingSources?.[0]?.url ?? ""),
      snippet: c.snippet || "",
      at: new Date(),
    };
    const base = {
      name: c.name,
      nameKey,
      industryHint: c.industry || "",
      locationHint: c.location || "",
    };

    if (dk) {
      // Upgrade a name-only record found earlier to this domain.
      const nameOnly = await repo.findCompany(jobId, { domainKey: `name:${nameKey}` });
      if (nameOnly) {
        const existing = await repo.findCompany(jobId, { domainKey: dk });
        if (existing) {
          await repo.updateCompany(nameOnly.id, { status: "duplicate", duplicateOf: dk });
        } else {
          try {
            await repo.updateCompany(
              nameOnly.id,
              { domainKey: dk, website, status: "discovered" },
              { push: { discoveredVia: via }, inc: { discoveryCount: 1 } }
            );
            return false;
          } catch (err) {
            if (err.code !== 11000) throw err;
            await repo.updateCompany(nameOnly.id, { status: "duplicate", duplicateOf: dk });
          }
        }
      }
      const { created } = await repo.upsertCompany(
        jobId,
        dk,
        { ...base, website, status: "discovered" },
        via
      );
      return created;
    }

    // No website: merge into any record with the same name.
    const sameName = await repo.findCompany(jobId, { nameKey });
    if (sameName) {
      await repo.updateCompany(sameName.id, {}, { inc: { discoveryCount: 1 } });
      return false;
    }
    const { created } = await repo.upsertCompany(
      jobId,
      `name:${nameKey}`,
      { ...base, website: "", status: "needs_website" },
      via
    );
    return created;
  }

  // ------------------------------------------------------------------
  // STAGE: discovering
  // ------------------------------------------------------------------
  async function stageDiscover(ctx) {
    if (!sources.length) {
      throw Object.assign(
        new Error("No discovery sources configured (set GEMINI_API_KEY and/or a search API key)."),
        { retryable: false }
      );
    }

    const maxCandidates = ctx.options.maxCandidates || d.defaultMaxCandidates;
    const maxRounds = ctx.options.maxRounds || d.maxRounds;
    const perRound = ctx.options.queriesPerRound || d.queriesPerRound;
    const exclusions = buildExclusions(ctx.profile);
    const ingestLock = createLimiter(1); // serialise merges within a job

    let job = await repo.getJob(ctx.job.id);
    let round = job.discoveryRounds || 0;
    const previousQueries = [...(job.queriesRun || [])];

    while (round < maxRounds) {
      await ctx.checkpoint(true);
      const total = await repo.countCompanies(ctx.job.id, { status: { $ne: "duplicate" } });
      if (total >= maxCandidates) {
        ctx.log.info("discovery.cap_reached", { total, maxCandidates });
        break;
      }

      round++;
      const queries = await planQueries({
        ai,
        profile: ctx.profile,
        round,
        previousQueries,
        count: perRound,
        log: ctx.log,
      });
      if (!queries.length) break;

      let found = 0;
      let created = 0;
      let failures = 0;
      const tasks = queries.flatMap((q) => sources.map((s) => ({ q, s })));

      // Exclusion list for the AI: names already discovered (for diversity).
      const known = (
        await repo.findCompanies(ctx.job.id, {}, { sort: { createdAt: -1 }, limit: 150 })
      ).map((c) => c.name);

      let liveTotal = total;
      await mapWithConcurrency(tasks, config.search.concurrency, async ({ q, s }) => {
        if (liveTotal >= maxCandidates) return;
        let candidates = [];
        try {
          candidates = await s.discover(q, { profile: ctx.profile, excludeNames: known, log: ctx.log });
        } catch (err) {
          failures++;
          ctx.log.warn("discovery.source_failed", { source: s.name, query: q, error: err.message });
          return;
        }
        found += candidates.length;
        for (const c of candidates) {
          if (liveTotal >= maxCandidates) break;
          if (await ingestLock(() => ingestCandidate(ctx, c, exclusions))) {
            created++;
            liveTotal++;
          }
        }
        await ctx.checkpoint();
      });

      previousQueries.push(...queries);
      await repo.updateJob(
        ctx.job.id,
        { discoveryRounds: round },
        { push: { queriesRun: queries } }
      );
      const progress = await refreshProgress(ctx.job.id, { discoveryRoundsCompleted: round });
      ctx.log.info("discovery.round", { round, queries: queries.length, found, created, failures, total: progress.unique });

      if (failures === tasks.length) {
        throw Object.assign(new Error("All discovery requests failed in this round."), { retryable: true });
      }
      // Saturation: stop when rounds stop producing new companies.
      if (round >= 2 && (created === 0 || created / Math.max(1, found) < d.saturationRatio)) {
        ctx.log.info("discovery.saturated", { round, found, created });
        break;
      }
    }
  }

  // ------------------------------------------------------------------
  // STAGE: resolving_websites
  // ------------------------------------------------------------------
  async function stageResolveWebsites(ctx) {
    for (;;) {
      await ctx.checkpoint(true);
      const batch = await repo.findCompanies(ctx.job.id, { status: "needs_website" }, { limit: 100 });
      if (!batch.length) break;

      if (!resolveWebsite) {
        await repo.updateCompanies(ctx.job.id, { status: "needs_website" }, {
          status: "invalid",
          invalidReason: "no_verifiable_website",
        });
        break;
      }

      await mapWithConcurrency(batch, config.search.concurrency, async (c) => {
        try {
          const res = await resolveWebsite(c.name, c.locationHint);
          const dk = res && toDomainKey(res.website);
          if (!dk || isNonCompanyDomain(res.website)) {
            await repo.updateCompany(c.id, { status: "invalid", invalidReason: "no_website_found" });
            return;
          }
          const existing = await repo.findCompany(ctx.job.id, { domainKey: dk });
          if (existing) {
            await repo.updateCompany(c.id, { status: "duplicate", duplicateOf: dk });
            return;
          }
          await repo.updateCompany(
            c.id,
            { domainKey: dk, website: homepageUrl(res.website), status: "discovered" },
            { push: { discoveredVia: { provider: "website_resolver", query: c.name, sourceUrl: res.sourceUrl, snippet: res.snippet || "", at: new Date() } } }
          );
        } catch (err) {
          if (err.code === 11000) {
            await repo.updateCompany(c.id, { status: "duplicate" });
            return;
          }
          ctx.log.warn("resolve.failed", { company: c.name, error: err.message });
          await repo.updateCompany(c.id, { status: "invalid", invalidReason: "website_resolution_failed" });
        }
      });
    }
    await refreshProgress(ctx.job.id);
  }

  // ------------------------------------------------------------------
  // STAGE: verifying (scrape own website)
  // ------------------------------------------------------------------
  async function verifyOne(ctx, c) {
    let result = await repo.getCache(c.domainKey);
    if (!result) {
      result = await scraper.scrapeCompany(c.website);
      if (result.status !== "unreachable") {
        await repo.setCache(c.domainKey, result, config.crawler.cacheTtlMs);
      }
    }

    // Redirected to a different registrable domain => canonicalise/dedupe.
    if (result.domainKey && result.domainKey !== c.domainKey) {
      const existing = await repo.findCompany(ctx.job.id, { domainKey: result.domainKey });
      if (existing && existing.id !== c.id) {
        await repo.updateCompany(c.id, { status: "duplicate", duplicateOf: result.domainKey });
        return;
      }
      try {
        await repo.updateCompany(c.id, { domainKey: result.domainKey, website: homepageUrl(result.finalUrl) });
      } catch (err) {
        if (err.code !== 11000) throw err;
        await repo.updateCompany(c.id, { status: "duplicate", duplicateOf: result.domainKey });
        return;
      }
    }

    const set = {
      status: result.status,
      scrapeStatus: result.status,
      invalidReason: result.reason || "",
      fetchedAt: result.fetchedAt ? new Date(result.fetchedAt) : new Date(),
    };
    if (result.status === "verified") {
      set.profile = result.profile;
      set.evidence = result.evidence;
      set.sourceUrls = result.sourceUrls;

      // Same brand on a sibling TLD (brand.com vs brand.co.uk) => duplicate.
      const label = (result.domainKey || c.domainKey).split(".")[0];
      const siteNameKey = normalizeCompanyName(result.profile?.name);
      if (siteNameKey) {
        const twins = await repo.findCompanies(ctx.job.id, { "profile.nameKey": siteNameKey, status: { $in: ["verified", "qualified", "disqualified"] } }, { limit: 5 });
        const twin = twins.find((t) => t.id !== c.id && t.domainKey.split(".")[0] === label);
        if (twin) {
          await repo.updateCompany(c.id, { status: "duplicate", duplicateOf: twin.domainKey });
          return;
        }
        set.profile = { ...result.profile, nameKey: siteNameKey };
      }
    }
    await repo.updateCompany(c.id, set);
  }

  async function stageVerify(ctx) {
    const batchSize = Math.max(20, config.crawler.concurrency * 5);
    for (;;) {
      await ctx.checkpoint(true);
      const batch = await repo.findCompanies(ctx.job.id, { status: "discovered" }, { limit: batchSize });
      if (!batch.length) break;

      const results = await mapWithConcurrency(batch, config.crawler.concurrency, (c) => verifyOne(ctx, c));
      for (const [i, r] of results.entries()) {
        if (r.status === "rejected") {
          ctx.log.warn("verify.failed", { domain: batch[i].domainKey, error: r.reason?.message });
          await repo.updateCompany(batch[i].id, { status: "unreachable", invalidReason: `verify_error:${r.reason?.message}`.slice(0, 200) });
        }
      }
      await refreshProgress(ctx.job.id);
    }
  }

  // ------------------------------------------------------------------
  // STAGE: qualifying (AI, batched)
  // ------------------------------------------------------------------
  async function stageQualify(ctx) {
    const minScore = ctx.options.minQualifiedScore ?? d.minQualifiedScore;
    const pending = (
      await repo.findCompanies(
        ctx.job.id,
        { status: { $in: QUALIFIABLE_STATUSES }, qualification: null },
        { limit: config.discovery.hardMaxCandidates }
      )
    ).filter(
      // Without a verified site we need at least search-snippet evidence.
      (c) => c.status === "verified" || (c.discoveredVia || []).some((v) => v.snippet)
    );

    const batches = [];
    for (let i = 0; i < pending.length; i += d.qualifyBatchSize) {
      batches.push(pending.slice(i, i + d.qualifyBatchSize));
    }
    ctx.log.info("qualification.start", { companies: pending.length, batches: batches.length });

    let done = 0;
    await mapWithConcurrency(batches, config.gemini.concurrency, async (batch) => {
      await ctx.checkpoint();
      let results;
      try {
        results = await qualifyBatch({ ai, profile: ctx.profile, companies: batch, log: ctx.log });
      } catch (err) {
        ctx.log.warn("qualification.batch_failed", { size: batch.length, error: err.message });
        results = new Map(batch.map((c) => [c.domainKey, { error: err.message }]));
      }
      for (const c of batch) {
        const q = results.get(c.domainKey);
        if (!q || q.error) {
          await repo.updateCompany(c.id, {
            status: "qualification_failed",
            qualification: { error: q?.error || "unknown", evaluatedAt: new Date() },
          });
          continue;
        }
        await repo.updateCompany(c.id, {
          status: q.relevant && q.score >= minScore ? "qualified" : "disqualified",
          qualification: q,
        });
      }
      done += batch.length;
      await refreshProgress(ctx.job.id, { qualificationProcessed: done, qualificationTotal: pending.length });
    });
  }

  // ------------------------------------------------------------------
  // STAGE: ranking
  // ------------------------------------------------------------------
  function summarize(c, rank) {
    const q = c.qualification || {};
    const p = c.profile || {};
    return {
      rank,
      companyId: c.id,
      domainKey: c.domainKey,
      name: p.name || c.name,
      website: c.website,
      industry: q.industry || c.industryHint || "",
      location: q.location || "",
      businessDescription: q.businessDescription || p.description || "",
      score: q.score,
      priority: q.priority,
      breakdown: q.breakdown,
      marketingNeeds: q.marketingNeeds || [],
      reasoning: q.reasoning || "",
      contacts: p.contacts || {},
      socials: p.socials || {},
      verifiedWebsite: c.status === "qualified" && c.scrapeStatus === "verified",
      sourceUrls: [...new Set([...(c.sourceUrls || []), ...(c.discoveredVia || []).map((v) => v.sourceUrl).filter(Boolean)])],
    };
  }

  async function stageRank(ctx) {
    await repo.updateCompanies(ctx.job.id, { isTop10: true }, { isTop10: false, top10Rank: null, isWinner: false });
    const qualified = await repo.findCompanies(
      ctx.job.id,
      { status: "qualified" },
      { sort: { "qualification.score": -1 }, limit: 200 }
    );
    qualified.sort(compareQualified);
    const top = qualified.slice(0, d.topN);

    for (const [i, c] of top.entries()) {
      await repo.updateCompany(c.id, { isTop10: true, top10Rank: i + 1 });
    }
    await repo.updateJob(ctx.job.id, { top10: top.map((c, i) => summarize(c, i + 1)) });
    await refreshProgress(ctx.job.id, { top10Count: top.length });
    ctx.log.info("ranking.done", { qualified: qualified.length, top: top.length });
    return top;
  }

  // ------------------------------------------------------------------
  // STAGE: final_evaluation
  // ------------------------------------------------------------------
  async function stageFinal(ctx) {
    const top = await repo.findCompanies(ctx.job.id, { isTop10: true }, { sort: { top10Rank: 1 }, limit: d.topN });
    if (!top.length) {
      await repo.updateJob(ctx.job.id, {
        winner: null,
        finalEvaluation: { method: "none", message: "No companies met the qualification threshold." },
      });
      return;
    }

    const evaluation = await evaluateFinalists({
      ai,
      profile: ctx.profile,
      top,
      model: config.gemini.finalModel,
      log: ctx.log,
    });

    const winnerCompany = top.find((c) => c.domainKey === evaluation.winnerDomainKey);
    await repo.updateCompany(winnerCompany.id, { isWinner: true });

    const finalRankById = new Map(evaluation.ranking.map((r) => [r.id, r]));
    const top10 = top.map((c, i) => ({
      ...summarize(c, i + 1),
      finalRank: finalRankById.get(c.domainKey)?.rank ?? null,
      finalRationale: finalRankById.get(c.domainKey)?.rationale ?? "",
      isWinner: c.domainKey === evaluation.winnerDomainKey,
    }));

    await repo.updateJob(ctx.job.id, {
      top10,
      finalEvaluation: evaluation,
      winner: {
        ...summarize(winnerCompany, winnerCompany.top10Rank),
        ...evaluation.winner,
        confidence: evaluation.confidence,
        selectionMethod: evaluation.method,
      },
    });
    ctx.log.info("final.done", { winner: evaluation.winnerDomainKey, method: evaluation.method });
  }

  // ------------------------------------------------------------------
  // runner
  // ------------------------------------------------------------------
  const STAGES = {
    discovering: stageDiscover,
    resolving_websites: stageResolveWebsites,
    verifying: stageVerify,
    qualifying: stageQualify,
    ranking: stageRank,
    final_evaluation: stageFinal,
  };

  async function run(job, { heartbeat } = {}) {
    const ctx = createContext(job, { heartbeat });
    const startIdx = Math.max(0, STAGE_ORDER.indexOf(job.stage));

    if (!job.startedAt) await repo.updateJob(job.id, { startedAt: new Date() });

    for (const stage of STAGE_ORDER.slice(startIdx)) {
      if (stage === "completed") break;
      await ctx.checkpoint(true);
      const started = Date.now();
      await setStage(ctx, stage);
      await STAGES[stage](ctx);
      ctx.log.info("stage.done", { stage, durationMs: Date.now() - started });
    }

    const progress = await refreshProgress(job.id);
    await repo.updateJob(job.id, {
      status: "completed",
      stage: "completed",
      completedAt: new Date(),
      leaseOwner: null,
      leaseUntil: null,
      error: null,
    });
    ctx.log.info("job.completed", { progress });
  }

  return { run, ingestCandidate, STAGE_ORDER };
}

module.exports = { createPipeline, LeaseLostError, STAGE_ORDER };
