import { describe, expect, it } from "vitest";
import { evaluateNotificationRoute } from "@/lib/notifications/route-policy";

describe("notification route policy", () => {
  const workerSecret = "worker-secret-with-sufficient-entropy";

  it.each(["staging", "production"] as const)(
    "accepts authenticated %s invocations while delivery is enabled",
    (appEnvironment) => {
      expect(
        evaluateNotificationRoute({
          appEnvironment,
          authorization: `Bearer ${workerSecret}`,
          workerSecret,
          deliveryEnabled: true,
        }),
      ).toBe("process");
    },
  );

  it("returns a safe no-op for an authenticated disabled worker", () => {
    expect(
      evaluateNotificationRoute({
        appEnvironment: "production",
        authorization: `Bearer ${workerSecret}`,
        workerSecret,
        deliveryEnabled: false,
      }),
    ).toBe("disabled");
  });

  it.each([null, "Bearer wrong-secret"])(
    "fails closed for an unauthorised caller",
    (authorization) => {
      expect(
        evaluateNotificationRoute({
          appEnvironment: "production",
          authorization,
          workerSecret,
          deliveryEnabled: true,
        }),
      ).toBe("not_found");
    },
  );

  it("fails closed outside staging and production", () => {
    expect(
      evaluateNotificationRoute({
        appEnvironment: "preview",
        authorization: `Bearer ${workerSecret}`,
        workerSecret,
        deliveryEnabled: true,
      }),
    ).toBe("not_found");
  });
});

