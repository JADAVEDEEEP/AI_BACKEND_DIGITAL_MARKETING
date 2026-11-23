const { body, param, query, validationResult } = require("express-validator");
const config = require("../config");

const toList = (v) => {
  if (v === undefined || v === null || v === "") return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,;\n]/);
  return arr
    .map((s) => (typeof s === "string" ? s.trim() : String(s ?? "").trim()))
    .filter(Boolean)
    .map((s) => s.slice(0, 200))
    .slice(0, 50);
};

const text = (max) => (v) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Normalise the agency profile from the request body.
 * Accepts the legacy field names used by POST /api/research as aliases.
 */
function normalizeProfile(b) {
  return {
    agencyName: text(200)(b.agencyName),
    agencyType: text(200)(b.agencyType),
    agencyServices: toList(b.agencyServices),
    targetIndustries: toList(b.targetIndustries ?? b.industries),
    targetLocations: toList(b.targetLocations ?? b.locations ?? b.location),
    agencyLocation: text(200)(b.agencyLocation),
    idealCustomerProfile: text(3000)(b.idealCustomerProfile),
    companySize: text(200)(b.companySize),
    businessRequirements: text(3000)(b.businessRequirements ?? b.agencyRequirements),
    excludedCompanies: toList(b.excludedCompanies),
  };
}

function normalizeOptions(o = {}) {
  const d = config.discovery;
  const int = (v, min, max, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    maxCandidates: int(o.maxCandidates, 10, d.hardMaxCandidates, d.defaultMaxCandidates),
    maxRounds: int(o.maxRounds, 1, 20, d.maxRounds),
    queriesPerRound: int(o.queriesPerRound, 1, 50, d.queriesPerRound),
    minQualifiedScore: int(o.minQualifiedScore, 0, 100, d.minQualifiedScore),
  };
}

const handle = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed.",
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

const listOrString = (v) =>
  (Array.isArray(v) && v.length > 0) || (typeof v === "string" && v.trim().length > 0);

const validateCreateJob = [
  body("agencyType").isString().trim().notEmpty().withMessage("agencyType is required."),
  body("agencyServices").custom(listOrString).withMessage("agencyServices is required (array or comma-separated string)."),
  body().custom((b) => {
    const hasIndustries = listOrString(b?.targetIndustries ?? b?.industries);
    const hasIcp = typeof b?.idealCustomerProfile === "string" && b.idealCustomerProfile.trim();
    if (!hasIndustries && !hasIcp) {
      throw new Error("Provide targetIndustries and/or idealCustomerProfile.");
    }
    return true;
  }),
  body("options").optional().isObject().withMessage("options must be an object."),
  body("options.maxCandidates").optional().isInt({ min: 10, max: config.discovery.hardMaxCandidates }),
  body("options.minQualifiedScore").optional().isInt({ min: 0, max: 100 }),
  handle,
];

const validateJobId = [param("id").isString().isLength({ min: 8, max: 64 }).withMessage("Invalid job id."), handle];

const validateListCompanies = [
  ...validateJobId.slice(0, 1),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 200 }),
  query("sort").optional().isIn(["score", "discovered", "name"]),
  handle,
];

module.exports = {
  validateCreateJob,
  validateJobId,
  validateListCompanies,
  normalizeProfile,
  normalizeOptions,
};
