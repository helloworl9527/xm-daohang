const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const TRUNCATED = "[Truncated]";
const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 50;
const MAX_STRING_LENGTH = 2_048;

const SENSITIVE_KEY =
  /(?:api[-_]?key|authorization|cookie|credential|password|secret|session|token)/i;
const SENSITIVE_QUERY_KEY = /(?:api[-_]?key|auth|code|credential|key|password|secret|signature|token)/i;

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;
type LogWriter = (line: string) => void;

function truncate(value: string): string {
  return value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`;
}

function sanitizeUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return truncate(value);

  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
    }
    return truncate(url.toString());
  } catch {
    return truncate(value);
  }
}

function sanitizeError(
  error: Error & { code?: unknown },
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    name: sanitizeUrl(error.name),
    message: sanitizeUrl(error.message),
  };

  if (typeof error.code === "string" || typeof error.code === "number") {
    sanitized.code = error.code;
  }
  if (error.cause !== undefined) {
    sanitized.cause = sanitizeValue(error.cause, seen, depth + 1);
  }

  return sanitized;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return sanitizeUrl(value);
  if (typeof value === "undefined") return undefined;
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (depth > MAX_DEPTH) return TRUNCATED;

  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  if (value instanceof Error) {
    return sanitizeError(value, seen, depth);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeValue(entry, seen, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : sanitizeValue(entry, seen, depth + 1);
  }
  return sanitized;
}

export function sanitizeForLog(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>(), 0);
}

export function serializeLog(value: unknown): string {
  return JSON.stringify(sanitizeForLog(value));
}

export function createLogger(write: LogWriter = console.log) {
  const log = (level: LogLevel, event: string, fields: LogFields = {}) => {
    write(serializeLog({ level, event, ...fields }));
  };

  return {
    debug: (event: string, fields?: LogFields) => log("debug", event, fields),
    info: (event: string, fields?: LogFields) => log("info", event, fields),
    warn: (event: string, fields?: LogFields) => log("warn", event, fields),
    error: (event: string, fields?: LogFields) => log("error", event, fields),
  };
}

export const logger = createLogger();
