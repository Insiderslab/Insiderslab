/**
 * Importa post
 *
 * Creates the social drafts of one client from a sheet (Excel, CSV or cells
 * pasted from a spreadsheet), with the same validation as the automation API
 * (docs/AGENT-IMPORT.md). The client is the one picked in the main menu, or
 * chosen here (?clientId=); only clients with the social service are offered.
 * The sheet is read in the browser; rows are checked again on the server.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { loadRecentClientIds } from "@/app/(dashboard)/posts/data";
import ClientPicker from "@/components/posts/client-picker";
import ImportClientSelect from "@/components/posts/import/client-select";
import ImportWizard from "@/components/posts/import/import-wizard";
import SyncCurrentClient from "@/components/sync-current-client";
import { clientHasService } from "@/lib/clients";
import { getCurrentClientId, resolveClientScope } from "@/lib/current-client";
import { prisma } from "@/lib/db/client";
import { isKindEnabled, productName } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Importa post - ${productName()}` };
}

type SearchParams = { clientId?: string | string[]; modo?: string | string[] };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function ImportPostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");
  // Imports are social posts only: instances without them have nothing to import.
  if (!isKindEnabled("SOCIAL_POST")) redirect("/posts");

  const params = await searchParams;
  const clients = await prisma.client.findMany({
    where: { workspaceId: context.workspaceId, archivedAt: null },
    select: { id: true, name: true, timezone: true, networks: true, services: true },
    orderBy: { name: "asc" },
  });
  const eligible = clients.filter((c) => clientHasService(c, "SOCIAL_POST"));
  const currentId = await getCurrentClientId(context.workspaceId);
  const scopedId = resolveClientScope(first(params.clientId), eligible.map((c) => c.id), currentId);
  const scoped = eligible.find((c) => c.id === scopedId) ?? null;
  // The client in the menu has no social service: say why the picker shows up.
  const skipped = !scoped && currentId ? clients.find((c) => c.id === currentId && !eligible.includes(c)) : null;

  return (
    <div className="space-y-5">
      {scoped && <SyncCurrentClient clientId={scoped.id} currentClientId={currentId} />}
      <Link href="/posts" className="text-sm text-muted hover:text-foreground">
        ← Post
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold">{scoped ? `Importa post per ${scoped.name}` : "Importa post da Excel"}</h2>
          <p className="text-sm text-muted">
            Carica il foglio con i post e le loro immagini: controlli tutto qui, poi si creano le bozze. Non parte nulla verso il cliente.
          </p>
        </div>
        {scoped && eligible.length > 1 && (
          <ImportClientSelect clients={eligible.map((c) => ({ id: c.id, name: c.name }))} value={scoped.id} />
        )}
      </div>

      {eligible.length === 0 ? (
        <div className="panel p-6 text-center sm:p-10">
          <h3 className="mb-1 text-base font-semibold">Nessun cliente con il servizio «Post social»</h3>
          <p className="mx-auto mb-4 max-w-md text-sm text-muted">
            Attiva il servizio nella scheda del cliente, poi torna qui per importare i suoi post.
          </p>
          <Link href="/clients" className="btn">
            Vai ai clienti
          </Link>
        </div>
      ) : scoped ? (
        <ImportWizard
          client={{ id: scoped.id, name: scoped.name, timezone: scoped.timezone, networks: scoped.networks }}
          startWith={first(params.modo) === "incolla" ? "paste" : "file"}
        />
      ) : (
        <section className="panel space-y-4 p-4 sm:p-6" aria-labelledby="pick-client" data-testid="import-pick-client">
          <div className="space-y-1">
            <h3 id="pick-client" className="text-base font-semibold">
              Per quale cliente importi i post?
            </h3>
            {skipped && (
              <p className="text-sm text-warning">
                {skipped.name}, scelto nel menu, non ha il servizio «Post social»: scegli un altro cliente.
              </p>
            )}
          </div>
          <ClientPicker
            clients={eligible.map((c) => ({
              id: c.id,
              name: c.name,
              href: `/posts/import?clientId=${encodeURIComponent(c.id)}${first(params.modo) === "incolla" ? "&modo=incolla" : ""}`,
            }))}
            recentIds={await loadRecentClientIds(context.workspaceId)}
            testId="import-client-option"
          />
        </section>
      )}
    </div>
  );
}
