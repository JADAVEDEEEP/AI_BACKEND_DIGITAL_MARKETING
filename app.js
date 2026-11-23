const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const reportRouter = require("./routes/reportrouter");
const discoveryRouter = require("./routes/discovery.routes");
const logger = require("./utils/logger");

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(compression());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (req, res) => {
    res.json({ message: "API is Live" });
  });

  // Existing API (unchanged)
  app.use("/api", reportRouter);

  // New automated discovery & qualification pipeline
  app.use("/api/discovery", discoveryRouter);

  app.use((req, res) => {
    res.status(404).json({ success: false, message: "Route not found." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ success: false, message: "Invalid JSON body." });
    }
    logger.error("http.unhandled_error", { path: req.path, error: err });
    res.status(err.status || 500).json({ success: false, message: "Internal Server Error" });
  });

  return app;
}

module.exports = { createApp };
