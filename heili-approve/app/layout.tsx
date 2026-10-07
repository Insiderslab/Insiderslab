import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { getAppVariant, productDescription, productName, productShortName } from "@/lib/variant";
import "./globals.css";

/**
 * Metadata follows the product variant (APP_VARIANT). It is read at request
 * time — connection() keeps every page out of build-time prerendering — so
 * one Docker image serves social, blog and ads instances. An invalid
 * APP_VARIANT throws here, on the first request, with a clear message.
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const variant = getAppVariant();
  const name = productName(variant);
  return {
    title: name,
    description: `${productDescription(variant)} By 3Runes.`,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: productShortName(variant),
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: "/apple-touch-icon.png",
    },
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#18181b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className="h-full">
      <head>
        {/* Heili type: Schibsted Grotesk (titles), Source Sans 3 (text), IBM Plex Mono (data). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=Schibsted+Grotesk:wght@600;700&family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&display=swap"
        />
      </head>
      <body
        className="min-h-full bg-background text-foreground font-sans antialiased"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {children}
      </body>
    </html>
  );
}
