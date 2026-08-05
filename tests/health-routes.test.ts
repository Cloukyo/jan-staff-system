import { describe, expect, it } from "vitest";
import { GET as liveness } from "@/app/api/health/live/route";
import { GET as readiness } from "@/app/api/health/ready/route";

describe("commercial health endpoints", () => {
  it("serves an uncached liveness response", async () => {
    const response = await liveness();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.status).toBe("ok");
  });

  it("treats the local demo as ready without an external dependency", async () => {
    const response = await readiness();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dependencies.supabaseAuth).toBe("not_configured");
  });
});
