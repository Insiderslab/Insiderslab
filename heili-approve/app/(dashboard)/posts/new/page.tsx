/**
 * New Post Page
 *
 * Empty editor of the chosen kind: `?kind=social|blog|ads`. On instances
 * with several kinds and no kind given, the page first asks for the client
 * (`?clientId=`, also preselected from the clients pages), then offers only
 * that client's services — none to choose when it has exactly one. With a
 * kind, the client select lists only the clients with that service.
 * `?data=YYYY-MM-DD` preselects the day (from the calendar).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ContentKind } from "@/app/generated/prisma/client";
import { loadEditorClients } from "@/app/(dashboard)/posts/data";
import ContentEditor from "@/components/posts/content-editor";
import { addDays, contentWords, dayKeyIn, DEFAULT_TIME_ZONE, isDayKey, newContentHref } from "@/components/posts/helpers";
import { KindIcon } from "@/components/posts/kind-badge";
import PostEditor from "@/components/posts/post-editor";
import type { EditorClient } from "@/components/posts/types";
import { emptyAdContent } from "@/lib/content/ads";
import { emptyBlogContent } from "@/lib/content/blog";
import { isNetwork } from "@/lib/domain";
import { KIND_UI, enabledKinds, parseKindParam, postsHref, productName } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

type SearchParams = { kind?: string | string[]; clientId?: string | string[]; data?: string | string[] };

/** The kind requested in the URL: the requested enabled one, the only one, or null. */
function requestedKind(value: string | string[] | undefined): ContentKind | null {
  const kinds = enabledKinds();
  if (kinds.length === 1) return kinds[0];
  const requested = parseKindParam(value);
  return requested && kinds.includes(requested) ? requested : null;
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const kind = requestedKind((await searchParams).kind);
  return { title: `${kind ? KIND_UI[kind].newTitle : "Nuovo contenuto"} - ${productName()}` };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** What each kind is, on the "what do you want to create?" cards. */
const KIND_DESCRIPTIONS: Record<ContentKind, string> = {
  SOCIAL_POST: "Testo, foto o video per i social. Dopo l'approvazione si programma su Metricool.",
  BLOG_ARTICLE: "Un articolo per il sito, con SEO. Il cliente commenta le frasi; dopo l'approvazione lo esporti.",
  AD_CREATIVE: "Varianti di una campagna (foto o video e testi). Il cliente approva o scarta ogni variante.",
};

function KindCards({ kinds, clientId, day }: { kinds: ContentKind[]; clientId: string | null; day: string | null }) {
  return (
    <ul className="grid gap-3 md:grid-cols-3">
      {kinds.map((option) => (
        <li key={option}>
          <Link
            href={newContentHref(option, { clientId, day })}
            className="panel flex h-full flex-col gap-2 rounded p-4 hover:border-border-hover"
          >
            <span className="flex items-center gap-2 text-base font-semibold text-foreground">
              <KindIcon kind={option} className="h-5 w-5 text-accent" />
              {KIND_UI[option].newTitle}
            </span>
            <span className="text-sm text-muted">{KIND_DESCRIPTIONS[option]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function NewPostPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const kinds = enabledKinds();
  const requestedClient = first(params.clientId);
  const requestedDay = first(params.data);
  const day = isDayKey(requestedDay) ? requestedDay : null;
  const allClients = await loadEditorClients(context.workspaceId);
  const pickedClient = allClients.find((c) => c.id === requestedClient) ?? null;

  // The kind: from the URL, or the picked client's only service.
  const kind =
    requestedKind(params.kind) ?? (pickedClient && pickedClient.services.length === 1 ? pickedClient.services[0] : null);
  const backHref = kind ? postsHref(kind) : "/posts";
  const backLabel = kind ? `← ${contentWords([kind]).all}` : "← Tutti i contenuti";

  // ── Several kinds and none chosen: client first, then its services ──
  if (!kind) {
    if (pickedClient) {
      return (
        <div className="space-y-4">
          <Link href={backHref} className="text-sm text-muted hover:text-foreground">
            {backLabel}
          </Link>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Cosa vuoi preparare per {pickedClient.name}?</h2>
            {pickedClient.services.length === 0 ? (
              <p className="panel rounded p-4 text-sm text-muted">
                {pickedClient.name} non ha servizi attivi.{" "}
                <Link href={`/clients/${pickedClient.id}`} className="text-accent hover:underline">
                  Attivane uno nella scheda del cliente
                </Link>
                .
              </p>
            ) : (
              <KindCards kinds={pickedClient.services} clientId={pickedClient.id} day={day} />
            )}
            <p className="text-sm">
              <Link href={newContentHref(null, { day })} className="text-muted hover:text-foreground">
                Scegli un altro cliente
              </Link>
            </p>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <Link href={backHref} className="text-sm text-muted hover:text-foreground">
          {backLabel}
        </Link>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Per quale cliente?</h2>
          {allClients.length === 0 ? (
            <p className="panel rounded p-4 text-sm text-muted">
              Nessun cliente.{" "}
              <Link href="/clients/new" className="text-accent hover:underline">
                Aggiungi il primo cliente
              </Link>
              .
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {allClients.map((option) => (
                <li key={option.id}>
                  <Link
                    href={newContentHref(null, { clientId: option.id, day })}
                    className="panel flex h-full flex-col gap-2 rounded p-4 hover:border-border-hover"
                  >
                    <span className="text-base font-semibold text-foreground">{option.name}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {option.services.length === 0
                        ? "Nessun servizio attivo"
                        : option.services.map((service) => (
                            <span key={service} className="inline-flex items-center gap-1">
                              <KindIcon kind={service} className="h-3.5 w-3.5" />
                              {KIND_UI[service].serviceLabel}
                            </span>
                          ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-muted">Oppure parti dal tipo di contenuto</h2>
          <KindCards kinds={kinds} clientId={null} day={day} />
        </section>
      </div>
    );
  }

  // Only the clients with this service can be picked.
  const clients: EditorClient[] = allClients.filter((c) => c.services.includes(kind));
  const client =
    clients.find((c) => c.id === requestedClient) ?? (clients.length === 1 ? clients[0] : undefined);
  const missingService = pickedClient && !pickedClient.services.includes(kind) ? pickedClient : null;
  const timezone = client?.timezone ?? DEFAULT_TIME_ZONE;
  const date = day ?? addDays(dayKeyIn(new Date(), timezone), 1);

  const notice = missingService ? (
    <p className="panel rounded p-4 text-sm" role="status">
      <span className="text-warning">
        Il servizio «{KIND_UI[kind].serviceLabel}» non è attivo per {missingService.name}.
      </span>{" "}
      <Link href={`/clients/${missingService.id}`} className="text-accent hover:underline">
        Attivalo nella scheda del cliente
      </Link>{" "}
      oppure scegli un altro cliente.
    </p>
  ) : null;

  if (kind === "BLOG_ARTICLE" || kind === "AD_CREATIVE") {
    return (
      <div className="space-y-4">
        <Link href={backHref} className="text-sm text-muted hover:text-foreground">
          {backLabel}
        </Link>
        {notice}
        <ContentEditor
          kind={kind}
          mode="create"
          clients={clients}
          initial={{
            clientId: client?.id ?? "",
            title: "",
            date,
            time: kind === "BLOG_ARTICLE" ? "09:00" : "10:00",
            content: kind === "BLOG_ARTICLE" ? emptyBlogContent() : emptyAdContent(),
            changeNote: "",
          }}
        />
      </div>
    );
  }

  // A client with exactly one network gets it preselected.
  const clientNetworks = (client?.networks ?? []).filter(isNetwork);

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm text-muted hover:text-foreground">
        {backLabel}
      </Link>
      {notice}
      <PostEditor
        mode="create"
        clients={clients}
        initial={{
          clientId: client?.id ?? "",
          title: "",
          date,
          time: "10:00",
          networks: clientNetworks.length === 1 ? clientNetworks : [],
          networkOptions: {},
          text: "",
          firstCommentText: "",
          media: [],
          videoCoverMs: null,
          changeNote: "",
        }}
      />
    </div>
  );
}
