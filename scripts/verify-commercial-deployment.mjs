import { readFileSync } from "node:fs";

function deploymentHost(raw) {
  // Validate the entire input before a workflow attaches its bypass credential.
  if (typeof raw !== "string" || !/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(raw)) {
    throw new Error("Expected an HTTPS Vercel deployment URL without credentials, port, path or query.");
  }
  return new URL(raw).hostname;
}

function expectations() {
  const environment = process.env.EXPECTED_ENVIRONMENT;
  const sha = process.env.EXPECTED_SHA;
  if (!["staging", "production"].includes(environment)) {
    throw new Error("EXPECTED_ENVIRONMENT must be staging or production.");
  }
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) {
    throw new Error("EXPECTED_SHA must be a full commit SHA.");
  }
  return { environment, sha };
}

function expectedProjectId() {
  const expectedProject = process.env.EXPECTED_PROJECT;
  if (!/^prj_[a-zA-Z0-9]+$/.test(expectedProject ?? "")) {
    throw new Error("EXPECTED_PROJECT must identify the commercial Vercel project.");
  }
  return expectedProject;
}

function verifyProject(project) {
  const { environment } = expectations();
  if (project?.id !== expectedProjectId() || project.name !== `sh-workforce-${environment}`) {
    throw new Error("Expected the dedicated commercial project for this environment.");
  }
  if (project.nodeVersion !== "24.x") throw new Error("The commercial project must build with Node 24.");
}

function verifyDeployment(deployment) {
  const { sha } = expectations();
  const expectedProject = expectedProjectId();
  const host = deploymentHost(process.env.DEPLOYMENT_URL);
  if (deployment?.url !== host) throw new Error("Deployment URL mismatch.");
  if (deployment.readyState !== "READY") throw new Error("Deployment must be READY.");

  const outputs = (deployment.builds ?? []).flatMap((build) => build.output ?? []);
  const projectIds = outputs
    .map((output) => typeof output.digest === "string" ? output.digest.split("/")[0] : null)
    .filter((id) => id?.startsWith("prj_"));
  const project = deployment.projectId ?? deployment.project?.id;
  if (project ? project !== expectedProject : !projectIds.length || projectIds.some((id) => id !== expectedProject)) {
    throw new Error("Deployment project mismatch.");
  }
  const shas = [deployment.meta?.githubCommitSha, deployment.meta?.gitCommitSha, deployment.gitSource?.sha, deployment.source?.sha]
    .filter((value) => value !== undefined && value !== null);
  if (!shas.length || shas.some((value) => value !== sha)) throw new Error("Deployment SHA mismatch.");
  const regions = [
    ...(deployment.regions ?? []),
    ...outputs.flatMap((output) => output.lambda?.deployedTo ?? []),
  ];
  if (!regions.length || regions.some((region) => region !== "lhr1")) {
    throw new Error("Commercial functions must run only in London (lhr1).");
  }
}

function verifyHealth(live, ready) {
  const { environment, sha } = expectations();
  for (const [name, result] of [["Liveness", live], ["Readiness", ready]]) {
    if (result?.environment !== environment) throw new Error(`${name} environment mismatch.`);
    if (result.deploymentSha !== sha) throw new Error(`${name} SHA mismatch.`);
    if (result.status !== "ok") throw new Error(`${name} is not healthy.`);
  }
  if (ready.dependencies?.configuration !== "ready" || ready.dependencies?.supabaseAuth !== "ready") {
    throw new Error("Readiness dependencies are not ready.");
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Do not echo HTML redirects, provider output, credentials or local paths.
    throw new Error("Missing or invalid deployment verification JSON.");
  }
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "url" && args.length === 1) {
    console.log(deploymentHost(args[0]));
  } else if (command === "project" && args.length === 1) {
    verifyProject(readJson(args[0]));
    console.log("Commercial project and Node 24 build runtime verified.");
  } else if (command === "deployment" && args.length === 1) {
    verifyDeployment(readJson(args[0]));
    console.log("Commercial deployment identity, SHA and London region verified.");
  } else if (command === "health" && args.length === 2) {
    verifyHealth(readJson(args[0]), readJson(args[1]));
    console.log("Commercial liveness and readiness verified for the expected SHA.");
  } else {
    throw new Error("Use url <url>, project <file>, deployment <file>, or health <live-file> <ready-file>.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Commercial deployment verification failed.");
  process.exitCode = 1;
}
