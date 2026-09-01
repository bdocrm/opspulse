// Lightweight structured logger. Emits newline-delimited JSON so logs are easy
// to aggregate (e.g. in Vercel, Datadog, or a log shipper). Zero dependencies.

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configuredLevel: LogLevel =
  process.env.LOG_LEVEL && process.env.LOG_LEVEL in LEVELS
    ? (process.env.LOG_LEVEL as LogLevel)
    : process.env.NODE_ENV === "production"
    ? "info"
    : "debug";

function emit(level: LogLevel, msg: string, ctx?: LogContext) {
  if (LEVELS[level] < LEVELS[configuredLevel]) return;

  const entry: LogContext & {
    level: LogLevel;
    msg: string;
    time: string;
    [k: string]: unknown;
  } = {
    level,
    msg,
    time: new Date().toISOString(),
    ...(ctx ?? {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

function serializeError(err: unknown): LogContext {
  if (err instanceof Error) {
    return { error: err.message, stack: err.stack };
  }
  return { error: String(err) };
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
  errorWithCause: (msg: string, err: unknown, ctx?: LogContext) =>
    emit("error", msg, { ...serializeError(err), ...(ctx ?? {}) }),
};

export function logApiRequest(req: Request, handler: string, extra?: LogContext) {
  const url = new URL(req.url);
  logger.info("api:request", {
    handler,
    method: req.method,
    path: url.pathname,
    ...(extra ?? {}),
  });
}

export function logApiError(handler: string, err: unknown, extra?: LogContext) {
  logger.errorWithCause(`api:error [${handler}]`, err, extra);
}
