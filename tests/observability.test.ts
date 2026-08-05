import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import {
  buildLiveness,
  checkReadiness,
} from "@/lib/observability/health";
import {
  captureException,
  configureErrorReporter,
} from "@/lib/observability/error-monitoring";
import { createLogger } from "@/lib/observability/logging";
import { correlationId } from "@/lib/observability/request-context";

const productionEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  APP_ENV: "production",
  APP_MODE: "production",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://staff.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://prodref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-secret-value",
  SUPABASE_PROJECT_REF: "prodref",
  PRODUCTION_SUPABASE_PROJECT_REF: "prodref",
  PRODUCTION_SITE_HOST: "staff.example.com",
  VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
};

describe("request correlation", () => {
  it("preserves a valid incoming correlation ID", () => {
    expect(correlationId("req_01HZYK3AHYT6CP9J2J4D5QME8F")).toBe(
      "req_01HZYK3AHYT6CP9J2J4D5QME8F",
    );
  });

  it("replaces invalid incoming values", () => {
    const generated = correlationId("bad value with spaces");
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns the correlation ID on application responses", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/dashboard", {
        headers: { "x-request-id": "request-12345678" },
      }),
    );

    expect(response.headers.get("x-request-id")).toBe("request-12345678");
  });
});

describe("structured logging", () => {
  it("emits JSON-ready records and redacts sensitive values", () => {
    const records: unknown[] = [];
    const logger = createLogger("readiness", {
      correlationId: "request-12345678",
      sink: (_level, record) => records.push(record),
    });

    logger.info("dependency checked", {
      status: "ready",
      authorization: "Bearer secret",
      nested: { pin: "1234" },
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "info",
      component: "readiness",
      message: "dependency checked",
      correlationId: "request-12345678",
      status: "ready",
      authorization: "[REDACTED]",
      nested: { pin: "[REDACTED]" },
    });
  });
});

describe("error monitoring hook", () => {
  it("forwards normalised errors without requiring a provider credential", () => {
    const reporter = vi.fn();
    const restore = configureErrorReporter(reporter);
    captureException(new Error("database unavailable"), {
      component: "readiness",
      correlationId: "request-12345678",
      context: { serviceRoleKey: "must-not-leak" },
    });
    restore();

    expect(reporter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Error",
        message: "database unavailable",
        component: "readiness",
        correlationId: "request-12345678",
        context: { serviceRoleKey: "[REDACTED]" },
      }),
    );
  });
});

describe("commercial health reporting", () => {
  it("reports version and deployment SHA without environment secrets", () => {
    const payload = buildLiveness(productionEnvironment, new Date("2026-08-05T12:00:00Z"));
    expect(payload).toMatchObject({
      status: "ok",
      environment: "production",
      deploymentSha: productionEnvironment.VERCEL_GIT_COMMIT_SHA,
      checkedAt: "2026-08-05T12:00:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("publishable-secret-value");
  });

  it("requires a successful Supabase Auth health response in production", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"name":"GoTrue"}', { status: 200 }));
    const result = await checkReadiness(productionEnvironment, fetcher);

    expect(result.ready).toBe(true);
    expect(result.payload.dependencies.supabaseAuth).toBe("ready");
    expect(fetcher).toHaveBeenCalledWith(
      "https://prodref.supabase.co/auth/v1/health",
      expect.objectContaining({ headers: { apikey: "publishable-secret-value" } }),
    );
  });

  it("returns not ready when Supabase is unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const result = await checkReadiness(productionEnvironment, fetcher);

    expect(result.ready).toBe(false);
    expect(result.payload.dependencies.supabaseAuth).toBe("unavailable");
  });
});
