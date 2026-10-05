/**
 * New Client Page
 *
 * Name, Metricool brand, time zone, networks. Reviewers are added on the
 * client page the form redirects to.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { loadBrandOptions } from "@/app/(dashboard)/clients/brands";
import ClientForm from "@/components/clients/client-form";
import { buildTimeZoneOptions } from "@/components/clients/helpers";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Nuovo cliente - Approve by Heili" };

export default async function NewClientPage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const brands = await loadBrandOptions(context.workspaceId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/clients" className="text-sm text-muted hover:text-foreground">
        ← Clienti
      </Link>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-1 text-base font-semibold">Nuovo cliente</h2>
        <p className="mb-6 text-sm text-muted">
          Dopo il salvataggio potrai aggiungere le persone che approvano i post.
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
          }}
          timeZoneOptions={buildTimeZoneOptions()}
          brands={brands}
        />
      </section>
    </div>
  );
}
