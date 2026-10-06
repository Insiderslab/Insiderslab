import type { MetadataRoute } from "next";
import { getAppVariant, productName, productShortName } from "@/lib/variant";

// Read per request: one image serves several variants (APP_VARIANT), so the
// manifest must not be frozen at build time.
export const dynamic = "force-dynamic";

// Installable to the home screen (same as DM by Heili).
export default function manifest(): MetadataRoute.Manifest {
  const variant = getAppVariant();
  return {
    name: productName(variant),
    short_name: productShortName(variant),
    description: "Revisione e approvazione dei contenuti dei clienti",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
