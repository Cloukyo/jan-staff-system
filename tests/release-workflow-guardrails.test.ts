import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("commercial production release workflow", () => {
  const workflow = readFileSync(resolve(".github/workflows/release.yml"), "utf8");
  const stagingWorkflow = readFileSync(resolve(".github/workflows/promote-staging.yml"), "utf8");
  const releaseStagingVerification =
    workflow.match(/  verify-staging-sha:[\s\S]*?(?=\n  verify-migration-ledgers:)/)?.[0] ?? "";

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

  it("uses the protected Commercial Staging environment token contract", () => {
    expect(stagingWorkflow).toContain("secrets.COMMERCIAL_VERCEL_TOKEN");
    expect(stagingWorkflow).not.toContain("COMMERCIAL_STAGING_VERCEL_TOKEN");
    expect(workflow).toContain("environment: commercial-staging");
    expect(workflow).toContain("secrets.COMMERCIAL_VERCEL_TOKEN");
    expect(workflow).not.toContain("COMMERCIAL_STAGING_VERCEL_TOKEN");
  });

  it("checks both migration ledgers before deployment", () => {
    expect(workflow).toContain("COMMERCIAL_STAGING_DATABASE_URL");
    expect(workflow).toContain("COMMERCIAL_PRODUCTION_DATABASE_URL");
    expect(workflow).toContain("verify-remote-migration-ledger");
  });

  it.each([
    ["staging", stagingWorkflow],
    ["production", workflow],
  ])("uses a protected-secret-compatible remote build for %s", (_name, source) => {
    expect(source).toContain('--build-env "DEPLOYMENT_SHA=');
    expect(source).toContain('--env "DEPLOYMENT_SHA=');
    expect(source).not.toContain("vercel build");
    expect(source).not.toContain("--prebuilt");
  });

  it("requires the Commercial Staging deployment to run in London", () => {
    expect(stagingWorkflow).toContain("deployment.json");
    expect(stagingWorkflow).toContain("deployment.builds");
    expect(stagingWorkflow).toContain("output.lambda?.deployedTo");
    expect(stagingWorkflow).toContain('includes("lhr1")');
    expect(stagingWorkflow).toContain('result.status !== "ok"');
  });

  it("provides the staging project context to post-deploy Vercel verification", () => {
    expect(stagingWorkflow).toMatch(
      /name: Verify staging identity, liveness, readiness, and SHA[\s\S]*?VERCEL_ORG_ID: \$\{\{ secrets\.COMMERCIAL_STAGING_VERCEL_ORG_ID \}\}[\s\S]*?VERCEL_PROJECT_ID: \$\{\{ secrets\.COMMERCIAL_STAGING_VERCEL_PROJECT_ID \}\}[\s\S]*?run: \|/,
    );
  });

  it.each([
    ["staging promotion", stagingWorkflow],
    ["production precheck", releaseStagingVerification],
  ])("verifies protected Commercial Staging without user-scoped Vercel CLI access in %s", (_name, source) => {
    expect(source).toContain("api.vercel.com/v13/deployments");
    expect(source).toContain("COMMERCIAL_STAGING_AUTOMATION_BYPASS_SECRET");
    expect(source).toContain("x-vercel-protection-bypass");
    expect(source).not.toContain("vercel inspect");
    expect(source).not.toContain("vercel curl");
  });

  it("uses the deployed health response contract throughout the production release", () => {
    expect(workflow).not.toContain("result.ok !== true");
    expect(workflow.match(/result\.status !== "ok"/g)).toHaveLength(2);
  });
});
