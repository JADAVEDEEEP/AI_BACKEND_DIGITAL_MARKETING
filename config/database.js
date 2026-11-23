const mongoose = require("mongoose");
const config = require("./index");
const logger = require("../utils/logger");

let connected = false;

/**
 * Connect to MongoDB when MONGODB_URI is configured.
 * Returns true when connected, false when no URI is configured.
 */
async function connectDatabase() {
  if (!config.mongo.uri) return false;
  if (connected) return true;

  mongoose.set("strictQuery", true);
  mongoose.connection.on("error", (err) => logger.error("mongo.error", { error: err }));
  mongoose.connection.on("disconnected", () => logger.warn("mongo.disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("mongo.reconnected"));

  await mongoose.connect(config.mongo.uri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
  });
  connected = true;
  logger.info("mongo.connected");
  return true;
}

async function disconnectDatabase() {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

module.exports = { connectDatabase, disconnectDatabase };
