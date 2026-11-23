const mongoose = require("mongoose");

/**
 * Cross-job cache of website scrapes keyed by registrable domain, so the
 * same site is not re-crawled for every job (politeness + cost).
 */
const companyCacheSchema = new mongoose.Schema(
  {
    domainKey: { type: String, required: true, unique: true },
    result: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false }
);

// MongoDB TTL index removes expired entries automatically.
companyCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.CompanyCache || mongoose.model("CompanyCache", companyCacheSchema);
