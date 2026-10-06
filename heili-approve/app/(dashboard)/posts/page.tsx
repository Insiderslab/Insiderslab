/**
 * Posts List Page
 *
 * Every item of the workspace with filters in the URL: kind (`?kind=social|
 * blog|ads`, only the kinds this instance handles, offered when it handles
 * more than one), status (`?status=attention` = changes requested +
 * scheduling errors, as linked from the top bar), client, period and title
 * search. Drafts can be sent to the clients in bulk.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ContentKind, Prisma } from "@/app/generated/prisma/client";
import {
  buildPostsHref,
  contentWords,
  newContentHref,
  parseStatusFilter,
  statusesForFilter,
  statusesForKinds,
} from "@/components/posts/helpers";
import PostFilters from "@/components/posts/post-filters";
import PostList, { type PostListRow } from "@/components/posts/post-list";
import { AD_PLATFORM_LABELS } from "@/lib/content/ads";
import { prisma } from "@/lib/db/client";
import { KIND_CONFIG, NETWORK_LABELS, isNetwork, statusLabelFor, STATUS_LABELS } from "@/lib/domain";
import { readKindContent, summarizeVersionForList } from "@/lib/posts";
import { KIND_UI, enabledKinds, isMetricoolEnabled, kindParam, productName, resolveKindFilter } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const kind = resolveKindFilter((await searchParams).kind);
  return { title: `${kind ? KIND_UI[kind].navLabel : "Contenuti"} - ${productName()}` };
}

const PAGE_SIZE = 50;

type SearchParams = {
  kind?: string | string[];
  status?: string | string[];
  clientId?: string | string[];
  periodo?: string | string[];
  q?: string | string[];
  pagina?: string | string[];
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Second line of a row: networks (social), "Articolo · /slug" (blog), platform and variants (ads). */
function rowDetail(
  kind: ContentKind,
  networks: string[],
  version: { text: string; media: unknown; content: unknown } | undefined
): { detail: string; variantCount: number | null } {
  if (kind === "SOCIAL_POST") {
    return { detail: networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(", "), variantCount: null };
  }
  const summary = summarizeVersionForList(kind, version);
  const content = version ? readKindContent(kind, version.content) : null;
  if (content && "variants" in content) {
    const variants = summary.variantCount ?? content.variants.length;
    return {
      detail: `${AD_PLATFORM_LABELS[content.campaign.platform]} · ${variants === 1 ? "1 variante" : `${variants} varianti`}`,
      variantCount: variants,
    };
  }
  if (content && "slug" in content && content.slug) return { detail: `/${content.slug}`, variantCount: null };
  return { detail: KIND_CONFIG[kind].label, variantCount: summary.variantCount };
}

export default async function PostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const kinds = enabledKinds();
  const multiKind = kinds.length > 1;
  // The only kind on single-kind instances; the requested enabled one, or null (all), otherwise.
  const kindFilter = resolveKindFilter(params.kind);
  const kindValue = multiKind && kindFilter ? kindParam(kindFilter) : "";
  const shownKinds = kindFilter ? [kindFilter] : kinds;
  const words = contentWords(shownKinds);
  const social = shownKinds.includes("SOCIAL_POST");

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
    kind: kindFilter ? kindFilter : { in: kinds },
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
        versions: { orderBy: { number: "desc" }, take: 1, select: { text: true, media: true, content: true } },
        _count: { select: { comments: { where: { authorType: "CLIENT", resolvedAt: null } } } },
      },
    }),
  ]);

  const rows: PostListRow[] = posts.map((post) => {
    const version = post.versions[0];
    const { cover } = summarizeVersionForList(post.kind, version);
    const { detail } = rowDetail(post.kind, post.networks, version);
    return {
      id: post.id,
      kind: post.kind,
      title: post.title,
      clientId: post.clientId,
      clientName: post.client.name,
      timezone: post.client.timezone,
      detail,
      publishAt: post.publishAt,
      status: post.status,
      versionNumber: post.currentVersionNumber,
      openClientComments: post._count.comments,
      lastError: post.lastError,
      thumbnail: cover ? { url: cover.url, type: cover.type, ...(cover.posterUrl ? { posterUrl: cover.posterUrl } : {}) } : null,
    };
  });

  const filterValues = { kind: kindValue, status: statusValue, clientId, periodo, q };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(statusValue || clientId || periodo || q);
  const newKind = kindFilter ?? (multiKind ? null : kinds[0]);
  const newLabel = newKind ? KIND_UI[newKind].newTitle : "Nuovo contenuto";
  const newHref = newContentHref(newKind, { clientId: clientId || null });
  const singleShown = shownKinds.length === 1 ? shownKinds[0] : null;

  const emptyHint = (() => {
    if (clients.length === 0) return `Aggiungi prima un cliente, poi prepara il primo contenuto da fargli approvare.`;
    if (singleShown === "SOCIAL_POST" && isMetricoolEnabled()) {
      return "Prepara il primo post: lo invii al cliente, lui lo approva dal telefono e parte su Metricool.";
    }
    if (singleShown === "BLOG_ARTICLE") {
      return "Prepara il primo articolo: il cliente lo legge dal telefono, commenta le frasi e lo approva; poi lo esporti per il sito.";
    }
    if (singleShown === "AD_CREATIVE") {
      return "Prepara il primo set di creatività: il cliente approva o scarta ogni variante e tu scarichi il pacchetto per la campagna.";
    }
    return "Prepara il primo contenuto: il cliente lo rivede dal telefono e lo approva.";
  })();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-muted">
          {filter.kind === "attention"
            ? social
              ? `${total} da gestire: il cliente ha chiesto modifiche o la programmazione non è riuscita`
              : `${total} da gestire: il cliente ha chiesto modifiche`
            : `${total} ${total === 1 && singleShown ? KIND_CONFIG[singleShown].label.toLowerCase() : words.plural}`}
        </p>
        <Link
          href={newHref}
          className="rounded bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-hover"
        >
          {newLabel}
        </Link>
      </div>

      <PostFilters
        values={filterValues}
        kinds={multiKind ? kinds.map((k) => ({ value: kindParam(k), label: KIND_CONFIG[k].plural })) : []}
        statuses={statusesForKinds(shownKinds).map((status) => ({
          value: status,
          label: singleShown ? statusLabelFor(singleShown, status) : STATUS_LABELS[status],
        }))}
        attentionLabel={social ? "Da gestire (modifiche richieste ed errori)" : "Da gestire (modifiche richieste)"}
        clients={clients.map((c) => ({ id: c.id, name: c.archivedAt ? `${c.name} (archiviato)` : c.name }))}
      />

      {rows.length === 0 ? (
        <div className="panel rounded p-8 text-center sm:p-12">
          <h3 className="mb-2 text-lg font-semibold">
            {filtered ? "Nessun risultato" : `Ancora nessun ${singleShown ? KIND_CONFIG[singleShown].label.toLowerCase() : "contenuto"}`}
          </h3>
          <p className="mx-auto mb-6 max-w-sm text-sm text-muted">
            {filtered
              ? filter.kind === "attention"
                ? social
                  ? "Niente da gestire: nessuna richiesta di modifica e nessun errore di programmazione."
                  : "Niente da gestire: nessuna richiesta di modifica."
                : "Prova a cambiare o azzerare i filtri."
              : emptyHint}
          </p>
          {!filtered && (
            <Link
              href={clients.length === 0 ? "/clients/new" : newHref}
              className="inline-flex items-center rounded bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {clients.length === 0 ? "Aggiungi cliente" : newLabel}
            </Link>
          )}
        </div>
      ) : (
        <PostList rows={rows} showKind={multiKind && !kindFilter} detailLabel={social && !multiKind ? "Reti" : "Dettagli"} />
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
