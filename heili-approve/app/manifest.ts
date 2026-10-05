import type { MetadataRoute } from "next";

// Installable to the home screen (same as DM by Heili).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Approve by Heili",
    short_name: "Approve",
    description: "Revisione e approvazione dei post dei clienti",
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
