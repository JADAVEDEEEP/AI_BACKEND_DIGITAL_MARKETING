/**
 * Wires the discovery pipeline together with production dependencies.
 */
const config = require("../../config");
const logger = require("../../utils/logger");
const gemini = require("../gemini.client");
const { createCompanyScraper } = require("../scraper/companyScraper");
const { buildDiscoverySources, createWebsiteResolver } = require("./searchProviders");
const { createPipeline } = require("./pipeline");
const { JobRunner } = require("./jobRunner");

let runner = null;

function createDiscoveryService({ repo, overrides = {} }) {
  const ai = overrides.ai || gemini;
  const pipeline = createPipeline({
    repo,
    ai,
    sources: overrides.sources || buildDiscoverySources({ config, ai }),
    resolveWebsite:
      overrides.resolveWebsite !== undefined ? overrides.resolveWebsite : createWebsiteResolver({ config }),
    scraper: overrides.scraper || createCompanyScraper(config.crawler),
    config,
    logger: logger.child({ component: "discovery" }),
  });
  runner = new JobRunner({ repo, pipeline, config, logger });
  return { pipeline, runner };
}

function getRunner() {
  return runner;
}

module.exports = { createDiscoveryService, getRunner };
