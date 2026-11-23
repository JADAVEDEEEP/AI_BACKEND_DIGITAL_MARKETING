const { getRepository } = require("../repositories");
const { getRunner } = require("../Services/discovery");
const { normalizeProfile, normalizeOptions } = require("../middleware/validateDiscovery");
const logger = require("../utils/logger");

const JOB_STATUSES = new Set(["queued", "running", "completed", "failed", "cancelled"]);

const STATUS_FILTERS = new Set([
  "discovered", "needs_website", "verified", "robots_blocked", "unreachable",
  "invalid", "duplicate", "qualified", "disqualified", "qualification_failed",
]);

function jobView(job, { full = false } = {}) {
  if (!job) return null;
  const view = {
    id: job.id,
    status: job.status,
    stage: job.stage,
    profile: job.profile,
    options: job.options,
    progress: job.progress,
    discoveryRounds: job.discoveryRounds,
    attempts: job.attempts,
    error: job.error,
    cancelRequested: job.cancelRequested,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    winner: job.winner
      ? { name: job.winner.name, website: job.winner.website, score: job.winner.score, priority: job.winner.priority }
      : null,
  };
  if (full) {
    view.top10 = job.top10;
    view.winner = job.winner;
    view.queriesRun = job.queriesRun;
  }
  return view;
}

function companyView(c, { full = false } = {}) {
  const p = c.profile || {};
  const q = c.qualification || null;
  const view = {
    id: c.id,
    name: p.name || c.name,
    website: c.website,
    domain: c.domainKey?.startsWith("name:") ? null : c.domainKey,
    status: c.status,
    invalidReason: c.invalidReason || undefined,
    duplicateOf: c.duplicateOf || undefined,
    industry: q?.industry || c.industryHint || "",
    location: q?.location || p.address || c.locationHint || "",
    businessDescription: q?.businessDescription || p.description || "",
    contacts: p.contacts || {},
    socials: p.socials || {},
    score: q?.score ?? null,
    priority: q?.priority ?? null,
    isTop10: Boolean(c.isTop10),
    top10Rank: c.top10Rank ?? null,
    isWinner: Boolean(c.isWinner),
    discoveryCount: c.discoveryCount,
    sourceUrls: [...new Set([...(c.sourceUrls || []), ...(c.discoveredVia || []).map((v) => v.sourceUrl).filter(Boolean)])],
  };
  if (full) {
    view.qualification = q;
    view.evidence = c.evidence;
    view.discoveredVia = c.discoveredVia;
    view.profile = p;
    view.fetchedAt = c.fetchedAt;
  }
  return view;
}

const notFound = (res) => res.status(404).json({ success: false, message: "Discovery job not found." });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    logger.error("discovery.controller_error", { path: req.path, error: err });
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : "Internal Server Error" });
  });

// POST /api/discovery/jobs
const createJob = asyncHandler(async (req, res) => {
  const repo = getRepository();
  const job = await repo.createJob({
    profile: normalizeProfile(req.body),
    options: normalizeOptions(req.body.options),
  });
  getRunner()?.kick();
  logger.info("discovery.job_created", { jobId: job.id });

  res.status(202).location(`/api/discovery/jobs/${job.id}`).json({
    success: true,
    message: "Discovery job queued.",
    data: jobView(job),
    links: {
      self: `/api/discovery/jobs/${job.id}`,
      companies: `/api/discovery/jobs/${job.id}/companies`,
      top10: `/api/discovery/jobs/${job.id}/top10`,
      winner: `/api/discovery/jobs/${job.id}/winner`,
    },
  });
});

// GET /api/discovery/jobs
const listJobs = asyncHandler(async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { items, total } = await getRepository().listJobs({
    limit,
    skip: (page - 1) * limit,
    // Only accept known values (never pass raw query input into a DB filter)
    status: JOB_STATUSES.has(req.query.status) ? req.query.status : undefined,
  });
  res.json({ success: true, data: items.map((j) => jobView(j)), pagination: { page, limit, total } });
});

// GET /api/discovery/jobs/:id
const getJob = asyncHandler(async (req, res) => {
  const job = await getRepository().getJob(req.params.id);
  if (!job) return notFound(res);
  res.json({ success: true, data: jobView(job, { full: req.query.full === "true" }) });
});

// GET /api/discovery/jobs/:id/companies
const listCompanies = asyncHandler(async (req, res) => {
  const repo = getRepository();
  const job = await repo.getJob(req.params.id);
  if (!job) return notFound(res);

  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const statuses = String(req.query.status || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => STATUS_FILTERS.has(s));

  const filter = statuses.length ? { status: { $in: statuses } } : {};
  const sort =
    req.query.sort === "discovered"
      ? { createdAt: 1 }
      : req.query.sort === "name"
      ? { nameKey: 1 }
      : { "qualification.score": -1, createdAt: 1 };

  const [items, total] = await Promise.all([
    repo.findCompanies(job.id, filter, { sort, skip: (page - 1) * limit, limit }),
    repo.countCompanies(job.id, filter),
  ]);

  res.json({
    success: true,
    data: items.map((c) => companyView(c, { full: req.query.full === "true" })),
    pagination: { page, limit, total },
  });
});

// GET /api/discovery/jobs/:id/top10
const getTop10 = asyncHandler(async (req, res) => {
  const repo = getRepository();
  const job = await repo.getJob(req.params.id);
  if (!job) return notFound(res);

  const companies = await repo.findCompanies(job.id, { isTop10: true }, { sort: { top10Rank: 1 }, limit: 10 });
  res.json({
    success: true,
    status: job.status,
    stage: job.stage,
    data: job.top10 || [],
    companies: companies.map((c) => companyView(c, { full: true })),
  });
});

// GET /api/discovery/jobs/:id/winner
const getWinner = asyncHandler(async (req, res) => {
  const repo = getRepository();
  const job = await repo.getJob(req.params.id);
  if (!job) return notFound(res);

  if (job.status !== "completed") {
    return res.status(409).json({
      success: false,
      message: `Job is ${job.status} (stage: ${job.stage}). The winner is available once the job completes.`,
      status: job.status,
      stage: job.stage,
    });
  }
  const company = job.winner
    ? await repo.findCompany(job.id, { isWinner: true })
    : null;

  res.json({
    success: true,
    data: {
      winner: job.winner,
      finalEvaluation: job.finalEvaluation,
      company: company ? companyView(company, { full: true }) : null,
    },
  });
});

// POST /api/discovery/jobs/:id/cancel
const cancelJob = asyncHandler(async (req, res) => {
  const repo = getRepository();
  const job = await repo.getJob(req.params.id);
  if (!job) return notFound(res);
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return res.status(409).json({ success: false, message: `Job already ${job.status}.` });
  }
  const set = job.status === "queued"
    ? { cancelRequested: true, status: "cancelled", completedAt: new Date() }
    : { cancelRequested: true };
  const updated = await repo.updateJob(job.id, set);
  res.status(202).json({ success: true, message: "Cancellation requested.", data: jobView(updated) });
});

// POST /api/discovery/jobs/:id/retry  (re-queue a failed job; resumes from its stage)
const retryJob = asyncHandler(async (req, res) => {
  const repo = getRepository();
  const job = await repo.getJob(req.params.id);
  if (!job) return notFound(res);
  if (job.status !== "failed") {
    return res.status(409).json({ success: false, message: "Only failed jobs can be retried." });
  }
  const updated = await repo.updateJob(job.id, { status: "queued", attempts: 0, error: null, completedAt: null });
  getRunner()?.kick();
  res.status(202).json({ success: true, message: "Job re-queued.", data: jobView(updated) });
});

module.exports = {
  createJob,
  listJobs,
  getJob,
  listCompanies,
  getTop10,
  getWinner,
  cancelJob,
  retryJob,
  jobView,
  companyView,
};
