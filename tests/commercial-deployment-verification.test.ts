// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/verify-commercial-deployment.mjs");
const sha = "0123456789abcdef0123456789abcdef01234567";
const directories: string[] = [];

function run(command: string, values: unknown[], environment = "production", overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "commercial-release-"));
  directories.push(directory);
  const args = values.map((value, index) => {
    const file = join(directory, `${index}.json`);
    writeFileSync(file, JSON.stringify(value));
    return file;
  });
  return spawnSync(process.execPath, [script, command, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      EXPECTED_ENVIRONMENT: environment,
      EXPECTED_SHA: sha,
      EXPECTED_PROJECT: `prj_${environment}`,
      DEPLOYMENT_URL: "https://commercial-candidate.vercel.app",
      ...overrides,
    },
  });
}

function deployment(environment = "production") {
  return {
    projectId: `prj_${environment}`,
    url: "commercial-candidate.vercel.app",
    readyState: "READY",
    regions: ["lhr1"],
    meta: { githubCommitSha: sha },
  };
}

function health(environment = "production") {
  return { status: "ok", environment, deploymentSha: sha };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("commercial deployment verification command", () => {
  it.each(["staging", "production"])("accepts only the named commercial %s project before deployment", (environment) => {
    const result = run("project", [{ id: `prj_${environment}`, name: `sh-workforce-${environment}`, nodeVersion: "24.x" }], environment);
    expect(result.status).toBe(0);
  });

  it.each([
    ["Jan project", { name: "jan-staff-system" }, /commercial project/i],
    ["swapped staging project", { name: "sh-workforce-staging" }, /commercial project/i],
    ["wrong project ID", { id: "prj_other" }, /commercial project/i],
    ["old build runtime", { nodeVersion: "22.x" }, /Node 24/i],
  ])("blocks %s before deployment", (_name, changes, error) => {
    const result = run("project", [{ id: "prj_production", name: "sh-workforce-production", nodeVersion: "24.x", ...changes }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(error);
  });

  it.each(["staging", "production"])("accepts the exact healthy London %s candidate", (environment) => {
    expect(run("deployment", [deployment(environment)], environment).status).toBe(0);
    expect(run("health", [health(environment), {
      ...health(environment), dependencies: { configuration: "ready", supabaseAuth: "ready" },
    }], environment).status).toBe(0);
  });

  it.each([
    ["wrong project", { projectId: "prj_jan" }, /project mismatch/i],
    ["wrong SHA", { meta: { githubCommitSha: "f".repeat(40) } }, /SHA mismatch/i],
    ["missing SHA", { meta: {} }, /SHA mismatch/i],
    ["conflicting SHA evidence", { gitSource: { sha: "f".repeat(40) } }, /SHA mismatch/i],
    ["US functions", { regions: ["iad1"] }, /London/i],
    ["mixed regions", { regions: ["lhr1", "iad1"] }, /London/i],
    ["unknown region", { regions: [] }, /London/i],
    ["unfinished deployment", { readyState: "BUILDING" }, /READY/i],
    ["different URL", { url: "different-candidate.vercel.app" }, /URL mismatch/i],
  ])("rejects %s", (_name, changes, error) => {
    const result = run("deployment", [{ ...deployment(), ...changes }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(error);
  });

  it("accepts the build-output project and region representation", () => {
    const result = run("deployment", [{
      ...deployment(), projectId: undefined, regions: undefined,
      builds: [{ output: [{ digest: "prj_production/function", lambda: { deployedTo: ["lhr1"] } }] }],
    }]);
    expect(result.status).toBe(0);
  });

  it("does not let build-output metadata override an explicit wrong project", () => {
    const result = run("deployment", [{
      ...deployment(), projectId: "prj_jan",
      builds: [{ output: [{ digest: "prj_production/function" }] }],
    }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/project mismatch/i);
  });

  it.each([
    ["different environment", { environment: "staging" }, /environment/i],
    ["stale readiness", { deploymentSha: "f".repeat(40) }, /SHA mismatch/i],
    ["unhealthy readiness", { status: "not_ready" }, /healthy/i],
    ["unavailable authentication", { dependencies: { configuration: "ready", supabaseAuth: "unavailable" } }, /dependencies/i],
    ["missing dependency checks", { dependencies: undefined }, /dependencies/i],
  ])("rejects %s even when liveness is healthy", (_name, changes, error) => {
    const result = run("health", [health(), {
      ...health(), dependencies: { configuration: "ready", supabaseAuth: "ready" }, ...changes,
    }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(error);
  });

  it("rejects stale liveness even when readiness is healthy", () => {
    const result = run("health", [{ ...health(), deploymentSha: "f".repeat(40) }, {
      ...health(), dependencies: { configuration: "ready", supabaseAuth: "ready" },
    }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/SHA mismatch/i);
  });

  it.each([
    { EXPECTED_SHA: "" }, { EXPECTED_SHA: "main" }, { EXPECTED_ENVIRONMENT: "preview" },
  ])("fails closed on incomplete release expectations: %j", (overrides) => {
    const result = run("deployment", [deployment()], "production", overrides);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/EXPECTED_(SHA|ENVIRONMENT)/);
  });

  it("fails closed when the expected project is absent", () => {
    const result = run("deployment", [deployment()], "production", { EXPECTED_PROJECT: "" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EXPECTED_PROJECT");
  });

  it.each([
    "https://attacker.example", "https://candidate.vercel.app.attacker.example",
    "http://candidate.vercel.app", "https://user:password@candidate.vercel.app",
    "https://candidate.vercel.app/path", "https://candidate.vercel.app?redirect=elsewhere",
    "https://candidate.vercel.app#fragment", "https://candidate.vercel.app:8443",
  ])("rejects credential-bearing or non-deployment origin %s", (url) => {
    const result = spawnSync(process.execPath, [script, "url", url], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/deployment URL/i);
    expect(result.stderr).not.toContain("password");
  });

  it("returns only the validated hostname for the Vercel API lookup", () => {
    const result = spawnSync(process.execPath, [script, "url", "https://candidate.vercel.app"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("candidate.vercel.app");
  });
});
