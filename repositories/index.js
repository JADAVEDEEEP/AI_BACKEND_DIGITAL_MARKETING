const config = require("../config");
const logger = require("../utils/logger");
const { connectDatabase } = require("../config/database");
const { MongoDiscoveryRepository } = require("./mongo.repository");
const { MemoryDiscoveryRepository } = require("./memory.repository");

let repository = null;

/**
 * Initialise the discovery repository: MongoDB when MONGODB_URI is set,
 * otherwise an in-memory store (development only, not persisted).
 */
async function initRepository() {
  if (repository) return repository;

  if (await connectDatabase()) {
    repository = new MongoDiscoveryRepository();
  } else {
    logger.warn("repository.memory_fallback", {
      message:
        "MONGODB_URI is not set. Discovery jobs are stored in memory and will be lost on restart. Configure MongoDB for production.",
    });
    repository = new MemoryDiscoveryRepository();
  }
  await repository.init();
  return repository;
}

function getRepository() {
  if (!repository) throw new Error("Repository not initialised. Call initRepository() first.");
  return repository;
}

function setRepository(repo) {
  repository = repo;
}

module.exports = { initRepository, getRepository, setRepository };
