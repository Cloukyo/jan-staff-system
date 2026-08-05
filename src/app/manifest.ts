import type { MetadataRoute } from "next";
import { getPlatformBranding } from "@/lib/platform/branding";

export default function manifest(): MetadataRoute.Manifest {
  const branding = getPlatformBranding();
  return {
    name: `${branding.productName} Staff Clock`,
    short_name: "Staff Clock",
    description: `${branding.siteDisplayName} staff attendance clock`,
    start_url: "/clock",
    scope: "/clock",
    display: "standalone",
    background_color: "#2e1065",
    theme_color: "#2e1065",
    icons: branding.productLogoPath ? [
      {
        src: branding.productLogoPath,
        sizes: "any",
        type: "image/png",
      },
    ] : undefined,
  };
}
