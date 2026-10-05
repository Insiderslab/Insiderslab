/**
 * Posts List Page
 *
 * Every post of the workspace with filters in the URL: status
 * (`?status=attention` = changes requested + scheduling errors, as linked
 * from the top bar), client, period and title search. Drafts can be sent to
 * the clients in bulk.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@/app/generated/prisma/client";
import { buildPostsHref, parseStatusFilter, statusesForFilter } from "@/components/posts/helpers";
import PostFilters from "@/components/posts/post-filters";
import PostList, { type PostListRow } from "@/components/posts/post-list";
import { prisma } from "@/lib/db/client";
import { NETWORK_LABELS, isNetwork, parseMediaItems } from "@/lib/domain";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Post - Approve by Heili" };

const PAGE_SIZE = 50;

type SearchParams = {
  status?: string | string[];
  clientId?: string | string[];
  periodo?: string | string[];
  q?: string | string[];
  pagina?: string | string[];
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function PostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const filter = parseStatusFilter(params.status);
  const statusValue = filter.kind === "attention" ? "attention" : filter.kind === "status" ? filter.status : "";
  const periodo = ["prossimi", "passati"].includes(first(params.periodo)) ? first(params.periodo) : "";
  const q = first(params.q).slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number.parseInt(first(params.pagina), 10) || 1));

  const clients = await prisma.client.findMany({
    where: { workspaceId: context.workspaceId },
    select: { id: true, name: true, archivedAt: true },
    orderBy: { name: "asc" },
  });
  const requestedClient = first(params.clientId);
  // Only ids of this workspace reach the query.
  const clientId = clients.some((c) => c.id === requestedClient) ? requestedClient : "";

  const now = new Date();
  const where: Prisma.PostWhereInput = {
    workspaceId: context.workspaceId,
    status: { in: statusesForFilter(filter) },
    ...(clientId ? { clientId } : {}),
    ...(periodo === "prossimi" ? { publishAt: { gte: now } } : periodo === "passati" ? { publishAt: { lt: now } } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
  };

  const [total, posts] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      // Upcoming first when looking ahead; otherwise most recent publication first.
      orderBy: periodo === "prossimi" ? [{ publishAt: "asc" }] : [{ publishAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        client: { select: { name: true, timezone: true } },
        versions: { orderBy: { number: "desc" }, take: 1, select: { media: true } },
        _count: { select: { comments: { where: { authorType: "CLIENT", resolvedAt: null } } } },
      },
    }),
  ]);

  const rows: PostListRow[] = posts.map((post) => {
    const media = parseMediaItems(post.versions[0]?.media);
    const cover = media[0];
    return {
      id: post.id,
      title: post.title,
      clientId: post.clientId,
      clientName: post.client.name,
      timezone: post.client.timezone,
      networkLabels: post.networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]),
      publishAt: post.publishAt,
      status: post.status,
      versionNumber: post.currentVersionNumber,
      openClientComments: post._count.comments,
      lastError: post.lastError,
      thumbnail: cover ? { url: cover.url, type: cover.type, ...(cover.posterUrl ? { posterUrl: cover.posterUrl } : {}) } : null,
    };
  });

  const filterValues = { status: statusValue, clientId, periodo, q };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(statusValue || clientId || periodo || q);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-muted">
          {filter.kind === "attention"
            ? `${total} da gestire: il cliente ha chiesto modifiche o la programmazione non è riuscita`
            : `${total} post`}
        </p>
        <Link
          href={clientId ? `/posts/new?clientId=${clientId}` : "/posts/new"}
          className="rounded bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-hover"
        >
          Nuovo post
        </Link>
      </div>

      <PostFilters
        values={filterValues}
        clients={clients.map((c) => ({ id: c.id, name: c.archivedAt ? `${c.name} (archiviato)` : c.name }))}
      />

      {rows.length === 0 ? (
        <div className="panel rounded p-8 text-center sm:p-12">
          <h3 className="mb-2 text-lg font-semibold">{filtered ? "Nessun post trovato" : "Ancora nessun post"}</h3>
          <p className="mx-auto mb-6 max-w-sm text-sm text-muted">
            {filtered
              ? filter.kind === "attention"
                ? "Niente da gestire: nessuna richiesta di modifica e nessun errore di programmazione."
                : "Prova a cambiare o azzerare i filtri."
              : clients.length === 0
                ? "Aggiungi prima un cliente, poi prepara il primo post da fargli approvare."
                : "Prepara il primo post: lo invii al cliente, lui lo approva dal telefono e parte su Metricool."}
          </p>
          {!filtered && (
            <Link
              href={clients.length === 0 ? "/clients/new" : "/posts/new"}
              className="inline-flex items-center rounded bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {clients.length === 0 ? "Aggiungi cliente" : "Nuovo post"}
            </Link>
          )}
        </div>
      ) : (
        <PostList rows={rows} />
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagine">
          {page > 1 ? (
            <Link href={buildPostsHref({ ...filterValues, pagina: page - 1 })} className="text-accent hover:underline">
              ← Precedenti
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Pagina {page} di {pages}
          </span>
          {page < pages ? (
            <Link href={buildPostsHref({ ...filterValues, pagina: page + 1 })} className="text-accent hover:underline">
              Successivi →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
