const express = require("express");
const c = require("../controller/discovery.controller");
const {
  validateCreateJob,
  validateJobId,
  validateListCompanies,
} = require("../middleware/validateDiscovery");

const discoveryRouter = express.Router();

discoveryRouter.post("/jobs", validateCreateJob, c.createJob);
discoveryRouter.get("/jobs", c.listJobs);
discoveryRouter.get("/jobs/:id", validateJobId, c.getJob);
discoveryRouter.get("/jobs/:id/companies", validateListCompanies, c.listCompanies);
discoveryRouter.get("/jobs/:id/top10", validateJobId, c.getTop10);
discoveryRouter.get("/jobs/:id/winner", validateJobId, c.getWinner);
discoveryRouter.post("/jobs/:id/cancel", validateJobId, c.cancelJob);
discoveryRouter.post("/jobs/:id/retry", validateJobId, c.retryJob);

module.exports = discoveryRouter;
