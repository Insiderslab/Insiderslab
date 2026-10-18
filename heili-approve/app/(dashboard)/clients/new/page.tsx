/**
 * New Client Page
 *
 * Name, services (the kinds this instance handles; social posts preselected
 * when available), Metricool brand, time zone, networks (brand and networks
 * only when the client gets social posts). Reviewers are added on the client
 * page the form redirects to.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { loadBrandOptions } from "@/app/(dashboard)/clients/brands";
import ClientForm from "@/components/clients/client-form";
import { buildTimeZoneOptions } from "@/components/clients/helpers";
import { contentWords } from "@/components/posts/helpers";
import { defaultKind, enabledKinds, isMetricoolEnabled, productName } from "@/lib/variant";
import { listWorkspaceMembers } from "@/lib/workspace";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Nuovo cliente - ${productName()}` };
}

export default async function NewClientPage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const metricool = isMetricoolEnabled();
  // No Metricool call at all on blog / ads instances.
  const [brands, members] = await Promise.all([
    metricool ? loadBrandOptions(context.workspaceId) : Promise.resolve({ status: "not_configured" as const }),
    listWorkspaceMembers(context.workspaceId),
  ]);
  const words = contentWords(enabledKinds());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/clients" className="text-sm text-muted hover:text-foreground">
        ← Clienti
      </Link>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-1 text-base font-semibold">Nuovo cliente</h2>
        <p className="mb-6 text-sm text-muted">
          Dopo il salvataggio potrai aggiungere le persone che approvano {words.the}.
        </p>
        <ClientForm
          mode="create"
          initial={{
            name: "",
            logoUrl: "",
            timezone: "Europe/Rome",
            metricoolBlogId: "",
            networks: [],
            autoSchedule: true,
            ownerUserId: null,
            services: [defaultKind()],
          }}
          timeZoneOptions={buildTimeZoneOptions()}
          brands={brands}
          metricool={metricool}
          kinds={enabledKinds()}
          members={members}
        />
      </section>
    </div>
  );
}
