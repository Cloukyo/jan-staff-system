export type PlatformBranding = {
  productName: string;
  productShortName: string;
  productLogoPath: string | null;
  organisationDisplayName: string;
  siteDisplayName: string;
  serviceIdentifier: string;
};

function value(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key]?.trim() || fallback;
}

export function getPlatformBranding(
  env: NodeJS.ProcessEnv = process.env,
): PlatformBranding {
  return {
    productName: value(env, "NEXT_PUBLIC_PRODUCT_NAME", "Workforce Operations Platform"),
    productShortName: value(env, "NEXT_PUBLIC_PRODUCT_SHORT_NAME", "Workforce Platform"),
    productLogoPath: env.NEXT_PUBLIC_PRODUCT_LOGO_PATH?.trim() || null,
    organisationDisplayName: value(env, "NEXT_PUBLIC_ORGANISATION_DISPLAY_NAME", "Organisation"),
    siteDisplayName: value(env, "NEXT_PUBLIC_SITE_DISPLAY_NAME", "Site"),
    serviceIdentifier: value(env, "PLATFORM_SERVICE_IDENTIFIER", "workforce-platform"),
  };
}
