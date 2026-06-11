export type AppMode = "demo" | "production";

export function getAppMode(env: NodeJS.ProcessEnv = process.env): AppMode {
  const configured = env.APP_MODE;
  if (configured === "demo" || configured === "production") return configured;
  return env.NODE_ENV === "production" ? "production" : "demo";
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAppMode(env) === "demo";
}
