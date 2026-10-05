/**
 * Clients List Page
 *
 * Every client of the workspace with its Metricool brand, networks,
 * reviewers and how many posts sit in each status.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { groupStatusCounts, statusCountEntries, totalPosts, clientInitials } from "@/components/clients/helpers";
import { listClients } from "@/lib/clients";
import { prisma } from "@/lib/db/client";
import { NETWORK_LABELS, STATUS_TONES, isNetwork } from "@/lib/domain";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Clienti - Approve by Heili" };

const toneClass = {
  neutral: "text-muted",
  info: "text-accent",
  warning: "text-warning",
  success: "text-success",
  error: "text-error",
} as const;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ archiviati?: string }>;
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const showArchived = params.archiviati === "1";

  const [clients, grouped, metricool] = await Promise.all([
    listClients(context.workspaceId, { includeArchived: showArchived }),
    prisma.post.groupBy({
      by: ["clientId", "status"],
      where: { workspaceId: context.workspaceId, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
    prisma.workspace.findUnique({
      where: { id: context.workspaceId },
      select: { metricoolTokenEncrypted: true },
    }),
  ]);

  const counts = groupStatusCounts(
    grouped.map((row) => ({ clientId: row.clientId, status: row.status, count: row._count._all }))
  );
  const metricoolConnected = Boolean(metricool?.metricoolTokenEncrypted);
  const activeCount = clients.filter((c) => !c.archivedAt).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-muted">
          {activeCount} {activeCount === 1 ? "cliente" : "clienti"}
          {showArchived && clients.length > activeCount
            ? ` · ${clients.length - activeCount} archiviati`
            : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={showArchived ? "/clients" : "/clients?archiviati=1"}
            className="flex-1 rounded border border-border px-4 py-2 text-center text-sm font-medium text-muted hover:text-foreground sm:flex-none"
          >
            {showArchived ? "Nascondi archiviati" : "Mostra archiviati"}
          </Link>
          <Link
            href="/clients/new"
            className="flex-1 rounded bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-hover sm:flex-none"
          >
            Nuovo cliente
          </Link>
        </div>
      </div>

      {!metricoolConnected && clients.length > 0 && (
        <div className="panel rounded p-4 text-sm">
          <span className="text-warning">Metricool non è collegato:</span>{" "}
          <span className="text-muted">i post approvati non possono essere programmati.</span>{" "}
          <Link href="/settings" className="text-accent hover:underline">
            Collegalo nelle Impostazioni
          </Link>
        </div>
      )}

      {clients.length === 0 && (
        <div className="panel rounded p-8 text-center sm:p-12">
          <h3 className="mb-2 text-lg font-semibold">
            {showArchived ? "Nessun cliente" : "Ancora nessun cliente"}
          </h3>
          <p className="mx-auto mb-6 max-w-sm text-sm text-muted">
            Aggiungi un cliente, collegalo al suo brand su Metricool e invita chi deve approvare i post.
          </p>
          <Link
            href="/clients/new"
            className="inline-flex items-center rounded bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Aggiungi cliente
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {clients.map((client) => {
          const entries = statusCountEntries(counts[client.id]);
          const total = totalPosts(counts[client.id]);
          const networks = client.networks.filter(isNetwork);
          return (
            <div
              key={client.id}
              className={`panel rounded p-4 transition-colors hover:border-border-hover ${
                client.archivedAt ? "opacity-70" : ""
              }`}
            >
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                {client.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={client.logoUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded border border-border object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-border bg-background text-sm font-semibold text-muted">
                    {clientInitials(client.name)}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={`/clients/${client.id}`}
                      className="truncate text-base font-semibold text-foreground hover:underline"
                    >
                      {client.name}
                    </Link>
                    {client.archivedAt && <span className="text-xs text-muted">Archiviato</span>}
                  </div>

                  <p className="mt-1 text-xs text-muted">
                    {client.metricoolBlogId ? (
                      "Brand Metricool collegato"
                    ) : (
                      <span className="text-warning">Brand Metricool non collegato</span>
                    )}
                    {" · "}
                    {client._count.reviewers === 0 ? (
                      <span className="text-warning">nessun referente</span>
                    ) : client._count.reviewers === 1 ? (
                      "1 referente"
                    ) : (
                      `${client._count.reviewers} referenti`
                    )}
                    {" · "}
                    {client.timezone}
                    {!client.autoSchedule && " · programmazione manuale"}
                  </p>

                  {networks.length > 0 && (
                    <p className="mt-1 truncate text-xs text-muted">
                      {networks.map((n) => NETWORK_LABELS[n]).join(", ")}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {entries.length === 0 ? (
                      <span className="text-muted">Nessun post</span>
                    ) : (
                      entries.map((entry) => (
                        <Link
                          key={entry.status}
                          href={`/posts?clientId=${client.id}&status=${entry.status}`}
                          className={`whitespace-nowrap hover:underline ${toneClass[STATUS_TONES[entry.status]]}`}
                        >
                          {entry.count} {entry.label.toLowerCase()}
                        </Link>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex w-full gap-2 sm:w-auto">
                  {total > 0 && (
                    <Link
                      href={`/posts?clientId=${client.id}`}
                      className="flex-1 rounded border border-border px-3 py-1.5 text-center text-xs font-medium text-muted hover:text-foreground sm:flex-none"
                    >
                      Post ({total})
                    </Link>
                  )}
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex-1 rounded border border-border px-3 py-1.5 text-center text-xs font-medium text-muted hover:text-foreground sm:flex-none"
                  >
                    Apri
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
