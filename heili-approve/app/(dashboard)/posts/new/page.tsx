/**
 * New Post Page
 *
 * Empty editor of the chosen kind: `?kind=social|blog|ads` (when the
 * instance handles several kinds and none is given, the page asks which
 * one first). `?clientId=` preselects the client (from the clients list),
 * `?data=YYYY-MM-DD` the day (from the calendar).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ContentKind } from "@/app/generated/prisma/client";
import { loadEditorClients } from "@/app/(dashboard)/posts/data";
import ContentEditor from "@/components/posts/content-editor";
import { addDays, contentWords, dayKeyIn, DEFAULT_TIME_ZONE, isDayKey, newContentHref } from "@/components/posts/helpers";
import { KindIcon } from "@/components/posts/kind-badge";
import PostEditor from "@/components/posts/post-editor";
import { emptyAdContent } from "@/lib/content/ads";
import { emptyBlogContent } from "@/lib/content/blog";
import { isNetwork } from "@/lib/domain";
import { KIND_UI, enabledKinds, parseKindParam, postsHref, productName } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

type SearchParams = { kind?: string | string[]; clientId?: string | string[]; data?: string | string[] };

/** The kind to create: the requested enabled one, the only one, or null (ask). */
function chosenKind(value: string | string[] | undefined): ContentKind | null {
  const kinds = enabledKinds();
  if (kinds.length === 1) return kinds[0];
  const requested = parseKindParam(value);
  return requested && kinds.includes(requested) ? requested : null;
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const kind = chosenKind((await searchParams).kind);
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

export default async function NewPostPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const kinds = enabledKinds();
  const kind = chosenKind(params.kind);
  const requestedClient = first(params.clientId);
  const requestedDay = first(params.data);
  const backHref = kind ? postsHref(kind) : "/posts";
  const backLabel = kind ? `← ${contentWords([kind]).all}` : "← Tutti i contenuti";

  // ── Several kinds and none chosen: ask ──
  if (!kind) {
    return (
      <div className="space-y-4">
        <Link href={backHref} className="text-sm text-muted hover:text-foreground">
          {backLabel}
        </Link>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Cosa vuoi preparare?</h2>
          <ul className="grid gap-3 md:grid-cols-3">
            {kinds.map((option) => (
              <li key={option}>
                <Link
                  href={newContentHref(option, {
                    clientId: requestedClient ?? null,
                    day: isDayKey(requestedDay) ? requestedDay : null,
                  })}
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
        </section>
      </div>
    );
  }

  const clients = await loadEditorClients(context.workspaceId);
  const client =
    clients.find((c) => c.id === requestedClient) ?? (clients.length === 1 ? clients[0] : undefined);
  const timezone = client?.timezone ?? DEFAULT_TIME_ZONE;
  const date = isDayKey(requestedDay) ? requestedDay : addDays(dayKeyIn(new Date(), timezone), 1);

  if (kind === "BLOG_ARTICLE" || kind === "AD_CREATIVE") {
    return (
      <div className="space-y-4">
        <Link href={backHref} className="text-sm text-muted hover:text-foreground">
          {backLabel}
        </Link>
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
