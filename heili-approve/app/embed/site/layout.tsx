import type { Metadata } from "next";

/**
 * Shell of the «Sul sito» iframe: no portal or agency chrome, transparent
 * page (closed, it is only Heili's round button on the client's site).
 * Framing is allowed only by the site's registered origins: proxy.ts sets
 * `frame-ancestors` from the key in the address (?k=hs_…).
 */
export const metadata: Metadata = {
  title: "Heili",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function EmbedSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{"html,body{background:transparent!important;min-height:0!important;padding:0!important;color-scheme:normal}"}</style>
      {children}
    </>
  );
}
