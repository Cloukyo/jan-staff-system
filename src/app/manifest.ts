import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jan Preschool Staff Clock",
    short_name: "Staff Clock",
    description: "Jan Preschool staff attendance clock",
    start_url: "/clock",
    scope: "/clock",
    display: "standalone",
    background_color: "#2e1065",
    theme_color: "#2e1065",
    icons: [
      {
        src: "/brand/jan-logo.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  };
}
