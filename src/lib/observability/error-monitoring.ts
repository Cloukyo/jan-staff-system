export type ErrorReport = {
  name: string;
  message: string;
  stack?: string;
  component: string;
  correlationId?: string;
  context?: Record<string, unknown>;
};

export type ErrorReporter = (report: ErrorReport) => void | Promise<void>;

let configuredReporter: ErrorReporter | null = null;

export function configureErrorReporter(reporter: ErrorReporter): () => void {
  const previous = configuredReporter;
  configuredReporter = reporter;
  return () => {
    configuredReporter = previous;
  };
}

export function captureException(
  error: unknown,
  input: {
    component: string;
    correlationId?: string;
    context?: Record<string, unknown>;
  },
): void {
  const normalised = error instanceof Error ? error : new Error(String(error));
  void configuredReporter?.({
    name: normalised.name,
    message: normalised.message,
    stack: normalised.stack,
    component: input.component,
    correlationId: input.correlationId,
    context: input.context ? redactLogContext(input.context) : undefined,
  });
}
import { redactLogContext } from "@/lib/observability/logging";
