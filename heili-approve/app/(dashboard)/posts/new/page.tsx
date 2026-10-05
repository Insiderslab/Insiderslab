/**
 * New Post Page
 *
 * Empty editor. `?clientId=` preselects the client (from the clients list),
 * `?data=YYYY-MM-DD` the day (from the calendar).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { loadEditorClients } from "@/app/(dashboard)/posts/data";
import { addDays, dayKeyIn, DEFAULT_TIME_ZONE, isDayKey } from "@/components/posts/helpers";
import PostEditor from "@/components/posts/post-editor";
import { isNetwork } from "@/lib/domain";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Nuovo post - Approve by Heili" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string | string[]; data?: string | string[] }>;
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const clients = await loadEditorClients(context.workspaceId);
  const requestedClient = first(params.clientId);
  const client =
    clients.find((c) => c.id === requestedClient) ?? (clients.length === 1 ? clients[0] : undefined);
  const timezone = client?.timezone ?? DEFAULT_TIME_ZONE;

  const requestedDay = first(params.data);
  const date = isDayKey(requestedDay) ? requestedDay : addDays(dayKeyIn(new Date(), timezone), 1);
  // A client with exactly one network gets it preselected.
  const clientNetworks = (client?.networks ?? []).filter(isNetwork);

  return (
    <div className="space-y-4">
      <Link href="/posts" className="text-sm text-muted hover:text-foreground">
        ← Tutti i post
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
