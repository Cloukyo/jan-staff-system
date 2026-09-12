function parseApplicationOrigin(configured: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(configured.trim());
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a valid application origin.");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL must contain only the application origin.");
  }
  return parsed;
}

export function canonicalApplicationOrigin(configured: string, appEnvironment: string): string {
  const parsed = parseApplicationOrigin(configured);
  if (appEnvironment !== "local" && parsed.protocol !== "https:") {
    throw new Error("The application origin must use HTTPS outside local development.");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("The application origin must use HTTP or HTTPS.");
  }
  return parsed.origin;
}

export function applicationUrl(path: string, configured: string, appEnvironment: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Application URLs require an application-relative path.");
  }
  return `${canonicalApplicationOrigin(configured, appEnvironment)}${path}`;
}

export function configuredApplicationUrl(path: string): string | undefined {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return undefined;
  return applicationUrl(path, configured, process.env.APP_ENV?.trim() || "local");
}
