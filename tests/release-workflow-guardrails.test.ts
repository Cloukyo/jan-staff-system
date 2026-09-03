import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("commercial production release workflow", () => {
  const workflow = readFileSync(resolve(".github/workflows/release.yml"), "utf8");

  it("requires the exact staging SHA and health evidence before production", () => {
    expect(workflow).toContain("expected_sha");
    expect(workflow).toContain("staging_deployment_url");
    expect(workflow).toContain("verify-staging-sha");
    expect(workflow).toContain("/api/health/live");
    expect(workflow).toContain("/api/health/ready");
    expect(workflow).toMatch(/needs:[\s\S]*verify-candidate[\s\S]*verify-staging-sha/);
  });

  it("uses separate staging and production project credentials", () => {
    expect(workflow).toContain("COMMERCIAL_STAGING_VERCEL_PROJECT_ID");
    expect(workflow).toContain("COMMERCIAL_PRODUCTION_VERCEL_PROJECT_ID");
    expect(workflow).not.toContain("vercel promote");
  });

  it("checks both migration ledgers before deployment", () => {
    expect(workflow).toContain("COMMERCIAL_STAGING_DATABASE_URL");
    expect(workflow).toContain("COMMERCIAL_PRODUCTION_DATABASE_URL");
    expect(workflow).toContain("verify-remote-migration-ledger");
  });
});
