/**
 * Minimal structured JSON logger (no external dependency).
 * Usage: const log = logger.child({ jobId }); log.info("msg", { extra });
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold =
  LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] || LEVELS.info;

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  return {
    name: err.name,
    message: err.message,
    status: err.status,
    code: err.code,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  };
}

function createLogger(bindings = {}) {
  const write = (level, msg, meta = {}) => {
    if (LEVELS[level] < threshold) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...bindings,
    };

    for (const [k, v] of Object.entries(meta || {})) {
      entry[k] = v instanceof Error ? serializeError(v) : v;
    }

    const line = JSON.stringify(entry);
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };

  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

module.exports = createLogger({ service: "ai-backend" });
module.exports.createLogger = createLogger;
