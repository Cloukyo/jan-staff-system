export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;
export type LogRecord = LogContext & {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
};
export type LogSink = (level: LogLevel, record: LogRecord) => void;

const sensitiveKey = /authorization|cookie|password|secret|token|api.?key|service.?role|pin/i;

function sanitise(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitise(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : sanitise(item, seen),
    ]),
  );
}

export function redactLogContext(context: LogContext): LogContext {
  return sanitise(context) as LogContext;
}

const consoleSink: LogSink = (level, record) => {
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else if (level === "debug") console.debug(output);
  else console.info(output);
};

export function createLogger(
  component: string,
  options: { correlationId?: string; sink?: LogSink; context?: LogContext } = {},
) {
  const sink = options.sink ?? consoleSink;
  const base = redactLogContext({
    ...options.context,
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  });
  const write = (level: LogLevel, message: string, context: LogContext = {}) => {
    const record = {
      ...base,
      ...redactLogContext(context),
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
    } satisfies LogRecord;
    sink(level, record);
  };
  return {
    debug: (message: string, context?: LogContext) => write("debug", message, context),
    info: (message: string, context?: LogContext) => write("info", message, context),
    warn: (message: string, context?: LogContext) => write("warn", message, context),
    error: (message: string, context?: LogContext) => write("error", message, context),
  };
}
