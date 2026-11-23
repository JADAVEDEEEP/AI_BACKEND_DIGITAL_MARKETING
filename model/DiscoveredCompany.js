const mongoose = require("mongoose");

const COMPANY_STATUS = [
  "discovered", // found by a discovery source, not yet verified
  "needs_website", // found without a website; awaiting resolution
  "verified", // own website fetched & facts extracted
  "robots_blocked", // site disallows crawling; only search evidence available
  "unreachable", // site temporarily unreachable / blocks bots
  "invalid", // not a real/operating company website, directory, parked…
  "duplicate", // merged into another record (duplicateOf)
  "qualified", // AI-evaluated, relevant
  "disqualified", // AI-evaluated, irrelevant or below threshold
  "qualification_failed",
];

const discoveredCompanySchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "DiscoveryJob", required: true },
    // Registrable domain, or "name:<normalised name>" before a website is known
    domainKey: { type: String, required: true },
    nameKey: { type: String, index: true },
    name: String,
    website: String,
    industryHint: String,
    locationHint: String,

    discoveredVia: {
      type: [
        {
          _id: false,
          provider: String,
          query: String,
          sourceUrl: String,
          snippet: String,
          at: Date,
        },
      ],
      default: [],
    },
    discoveryCount: { type: Number, default: 1 },

    status: { type: String, enum: COMPANY_STATUS, default: "discovered" },
    scrapeStatus: String,
    invalidReason: String,
    duplicateOf: String,

    profile: { type: mongoose.Schema.Types.Mixed, default: {} },
    evidence: {
      type: [{ _id: false, field: String, value: String, sourceUrl: String }],
      default: [],
    },
    sourceUrls: { type: [String], default: [] },
    fetchedAt: Date,

    qualification: { type: mongoose.Schema.Types.Mixed, default: null },

    isTop10: { type: Boolean, default: false },
    top10Rank: Number,
    isWinner: { type: Boolean, default: false },
  },
  { timestamps: true, minimize: false }
);

discoveredCompanySchema.index({ jobId: 1, domainKey: 1 }, { unique: true });
discoveredCompanySchema.index({ jobId: 1, status: 1 });
discoveredCompanySchema.index({ jobId: 1, "qualification.score": -1 });
discoveredCompanySchema.index({ jobId: 1, isTop10: 1, top10Rank: 1 });
discoveredCompanySchema.index({ jobId: 1, nameKey: 1 });

module.exports =
  mongoose.models.DiscoveredCompany ||
  mongoose.model("DiscoveredCompany", discoveredCompanySchema);
module.exports.COMPANY_STATUS = COMPANY_STATUS;
