import { getPlatformBranding } from "@/lib/platform/branding";

export function safeExportSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "site";
}

export function getExportIdentity(env: NodeJS.ProcessEnv = process.env) {
  const branding = getPlatformBranding(env);
  return {
    ...branding,
    siteSlug: safeExportSlug(branding.siteDisplayName),
  };
}
