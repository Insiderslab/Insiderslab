import type { Metadata } from "next";
import InvalidLink from "@/components/portal/invalid-link";
import PortalHeader from "@/components/portal/portal-header";
import { portalPath, portalTagline, portalTitle } from "@/components/portal/helpers";
import { clientServices } from "@/lib/clients";
import { enabledKinds, productName } from "@/lib/variant";
import { getPortalReviewer } from "./reviewer";

type ReviewLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
};

// The link token is the credential: keep the pages out of search engines and
// caches, and never send the URL as Referer to external media or logo hosts.
const PRIVATE_METADATA: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export async function generateMetadata({ params }: Pick<ReviewLayoutProps, "params">): Promise<Metadata> {
  const { token } = await params;
  const reviewer = await getPortalReviewer(token);
  return {
    ...PRIVATE_METADATA,
    title: reviewer ? `${portalTitle(portalServices(reviewer.client))} · ${reviewer.client.name}` : `Link non valido · ${productName()}`,
  };
}

/** The client's services on this instance (the instance's kinds when none). */
function portalServices(client: Parameters<typeof clientServices>[0]) {
  const services = clientServices(client);
  return services.length > 0 ? services : enabledKinds();
}

/**
 * Client portal shell: no agency navigation, just the client's header.
 * An invalid link renders a friendly page here, so no page below it ever
 * runs without a reviewer.
 */
export default async function ReviewLayout({ children, params }: ReviewLayoutProps) {
  const { token } = await params;
  const reviewer = await getPortalReviewer(token);
  if (!reviewer) return <InvalidLink productName={productName()} />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PortalHeader
        clientName={reviewer.client.name}
        logoUrl={reviewer.client.logoUrl}
        homeHref={portalPath(token)}
        productName={productName()}
        tagline={portalTagline(portalServices(reviewer.client))}
      />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 pt-4">{children}</div>
    </div>
  );
}
