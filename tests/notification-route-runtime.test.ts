import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processBatch: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/config/environment", () => ({
  validateEnvironment: () => ({ appEnvironment: "staging" }),
}));
vi.mock("@/lib/notifications/worker", () => ({
  processNotificationBatch: mocks.processBatch,
}));

import { GET } from "@/app/api/internal/notifications/process/route";

const originalEnvironment = { ...process.env };

function configureWorker() {
  process.env.CRON_SECRET = "worker-secret-with-sufficient-entropy";
  process.env.NOTIFICATION_DELIVERY_ENABLED = "true";
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_FROM_ADDRESS = "Workforce Platform <staging@example.test>";
  process.env.RESEND_STAGING_RECIPIENT = "delivered+pilot@resend.dev";
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example.test";
}

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
  mocks.processBatch.mockReset();
  mocks.rpc.mockReset();
});

describe("notification worker runtime", () => {
  it("returns a correlated safe failure and emits a structured diagnostic", async () => {
    configureWorker();
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.processBatch.mockRejectedValue(new Error("private database detail"));

    const response = await GET(new Request("https://staging.example.test/api/internal/notifications/process", {
      headers: {
        authorization: "Bearer worker-secret-with-sufficient-entropy",
        "x-request-id": "notification-test-1234",
      },
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("notification-test-1234");
    await expect(response.json()).resolves.toEqual({ ok: false, code: "worker_failed" });
    expect(errorOutput).toHaveBeenCalledWith(expect.stringContaining('"component":"notification-worker"'));
    expect(errorOutput).toHaveBeenCalledWith(expect.stringContaining('"code":"worker_failed"'));
    expect(errorOutput).not.toHaveBeenCalledWith(expect.stringContaining("private database detail"));
  });

  it("reports bounded batch counts without recipient data", async () => {
    configureWorker();
    const infoOutput = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.processBatch.mockResolvedValue({
      claimed: 2,
      accepted: 1,
      retryableFailures: 1,
      permanentFailures: 0,
    });

    const response = await GET(new Request("https://staging.example.test/api/internal/notifications/process", {
      headers: { authorization: "Bearer worker-secret-with-sufficient-entropy" },
    }));

    expect(response.status).toBe(200);
    expect(infoOutput).toHaveBeenCalledWith(expect.stringContaining('"claimed":2'));
    expect(JSON.stringify(infoOutput.mock.calls)).not.toContain("recipientAddress");
  });
});
