const mongoose = require("mongoose");

const JOB_STATUS = ["queued", "running", "completed", "failed", "cancelled"];

const JOB_STAGES = [
  "queued",
  "planning",
  "discovering",
  "resolving_websites",
  "verifying",
  "qualifying",
  "ranking",
  "final_evaluation",
  "completed",
];

const agencyProfileSchema = new mongoose.Schema(
  {
    agencyName: String,
    agencyType: { type: String, required: true },
    agencyServices: [String],
    targetIndustries: [String],
    targetLocations: [String],
    agencyLocation: String,
    idealCustomerProfile: String,
    companySize: String,
    businessRequirements: String,
    excludedCompanies: [String],
  },
  { _id: false }
);

const discoveryJobSchema = new mongoose.Schema(
  {
    status: { type: String, enum: JOB_STATUS, default: "queued", index: true },
    stage: { type: String, enum: JOB_STAGES, default: "queued" },
    profile: { type: agencyProfileSchema, required: true },
    options: {
      maxCandidates: Number,
      maxRounds: Number,
      queriesPerRound: Number,
      minQualifiedScore: Number,
    },

    // Progress / stats (updated as stages run)
    progress: { type: mongoose.Schema.Types.Mixed, default: {} },
    queriesRun: { type: [String], default: [] },
    discoveryRounds: { type: Number, default: 0 },

    // Results
    top10: { type: [mongoose.Schema.Types.Mixed], default: [] },
    finalEvaluation: { type: mongoose.Schema.Types.Mixed, default: null },
    winner: { type: mongoose.Schema.Types.Mixed, default: null },

    // Execution
    attempts: { type: Number, default: 0 },
    leaseOwner: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    cancelRequested: { type: Boolean, default: false },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
    stageLog: { type: [mongoose.Schema.Types.Mixed], default: [] },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true, minimize: false }
);

discoveryJobSchema.index({ status: 1, leaseUntil: 1, createdAt: 1 });
discoveryJobSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.DiscoveryJob || mongoose.model("DiscoveryJob", discoveryJobSchema);
module.exports.JOB_STATUS = JOB_STATUS;
module.exports.JOB_STAGES = JOB_STAGES;
