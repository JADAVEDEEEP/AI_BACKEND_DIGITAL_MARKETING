class AppError extends Error {
  constructor(message, { status = 500, code, details, retryable } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    if (retryable !== undefined) this.retryable = retryable;
  }
}

class JobCancelledError extends Error {
  constructor() {
    super("Job was cancelled.");
    this.name = "JobCancelledError";
    this.retryable = false;
  }
}

module.exports = { AppError, JobCancelledError };
