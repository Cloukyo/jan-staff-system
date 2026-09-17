import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("commercial production release workflow", () => {
  const workflow = readFileSync(resolve(".github/workflows/release.yml"), "utf8");
  const stagingWorkflow = readFileSync(resolve(".github/workflows/promote-staging.yml"), "utf8");
  const releaseStagingVerification =
    workflow.match(/  verify-staging-sha:[\s\S]*?(?=\n  verify-migration-ledgers:)/)?.[0] ?? "";
  const productionDeployment = workflow.slice(workflow.indexOf("  deploy-production:"));

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

  it("uses the Commercial Staging environment token contract", () => {
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
    expect(stagingWorkflow).toContain("--regions lhr1");
    expect(stagingWorkflow).toContain("EXPECTED_ENVIRONMENT: staging");
    expect(stagingWorkflow).toContain("node scripts/verify-commercial-deployment.mjs deployment deployment.json");
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

  it("uses the executable health verifier in both pre-release and post-release checks", () => {
    expect(releaseStagingVerification).toContain("node scripts/verify-commercial-deployment.mjs health live.json ready.json");
    expect(productionDeployment).toContain("node scripts/verify-commercial-deployment.mjs health production-live.json production-ready.json");
  });

  it("sets the required Node runtime in every job that executes Node or npm", () => {
    const packageMetadata = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const minimumMajor = packageMetadata.engines.node.match(/^>=(\d+)/)[1];
    for (const source of [workflow, stagingWorkflow]) {
      const jobs = source.split(/\n  [a-z][a-z-]+:\r?\n/).filter((job) => job.includes("    steps:"));
      for (const job of jobs.filter((candidate) => /\b(node|npm) /.test(candidate))) {
        expect(job).toContain(`node-version: ${minimumMajor}`);
        expect(job.indexOf("node-version:")).toBeLessThan(job.search(/\b(node|npm) /));
      }
    }
  });

  it("verifies the production project and London runtime before requesting application health", () => {
    expect(productionDeployment).toContain("EXPECTED_ENVIRONMENT: production");
    expect(productionDeployment).toContain("EXPECTED_PROJECT: ${{ secrets.COMMERCIAL_PRODUCTION_VERCEL_PROJECT_ID }}");
    expect(productionDeployment).toContain("--regions lhr1");
    const identityCheck = productionDeployment.indexOf("node scripts/verify-commercial-deployment.mjs deployment deployment.json");
    expect(identityCheck).toBeGreaterThan(0);
    expect(identityCheck).toBeLessThan(productionDeployment.indexOf("vercel curl /api/health/live"));
    expect(productionDeployment).toContain('vercel curl /api/health/ready --deployment "$production_url"');
  });

  it("validates the supplied staging URL and identity before transmitting the bypass secret", () => {
    expect(releaseStagingVerification.indexOf("verify-commercial-deployment.mjs url")).toBeGreaterThan(0);
    expect(releaseStagingVerification.indexOf("verify-commercial-deployment.mjs deployment")).toBeLessThan(
      releaseStagingVerification.indexOf('--header "x-vercel-protection-bypass'),
    );
    expect(releaseStagingVerification).not.toContain("--location");
  });

  it.each([stagingWorkflow, productionDeployment])("checks the target before deploying and keeps the provider response outside the upload", (source) => {
    const targetCheck = source.indexOf('node scripts/verify-commercial-deployment.mjs project "$RUNNER_TEMP/commercial-project.json"');
    expect(targetCheck).toBeGreaterThan(0);
    expect(targetCheck).toBeLessThan(source.indexOf("vercel deploy"));
    expect(source).not.toMatch(/> project\.json/);
  });
});
