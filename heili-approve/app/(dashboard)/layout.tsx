import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { auth } from "@/lib/auth";
import { getCurrentClientId } from "@/lib/current-client";
import { prisma } from "@/lib/db/client";
import { enabledKinds, getAppVariant } from "@/lib/variant";
import { ensureWorkspaceForUser } from "@/lib/workspace";
import { getActiveWorkspaceForUser } from "@/lib/active-workspace";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  await ensureWorkspaceForUser(session.user.id, session.user.email);
  const active = await getActiveWorkspaceForUser(session.user.id);
  const workspace = active?.workspace ?? null;

  if (!workspace) {
    redirect("/login");
  }

  // Read on the server at request time (same image, different APP_VARIANT
  // per instance) and handed to the client shell as a prop.
  const variant = getAppVariant();

  // Items waiting on the agency: the client asked for changes, or scheduling
  // on Metricool failed. Only kinds this instance handles. Shown as a counter
  // in the top bar.
  // The client picked in the menu scopes the counter too.
  const [clients, currentClientId] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId: workspace.id, archivedAt: null },
      select: { id: true, name: true, logoUrl: true, services: true },
      orderBy: { name: "asc" },
    }),
    getCurrentClientId(workspace.id),
  ]);
  const needsAttention = await prisma.post.count({
    where: {
      workspaceId: workspace.id,
      kind: { in: enabledKinds(variant) },
      status: { in: ["CHANGES_REQUESTED", "FAILED"] },
      ...(currentClientId ? { clientId: currentClientId } : {}),
    },
  });

  return (
    <DashboardShell
      workspaceName={workspace.name}
      metricoolConnected={Boolean(workspace.metricoolTokenEncrypted)}
      needsAttention={needsAttention}
      variant={variant}
      clients={clients}
      currentClientId={currentClientId}
      currentClientServices={clients.find((client) => client.id === currentClientId)?.services.filter((kind) => enabledKinds(variant).includes(kind))}
    >
      {children}
    </DashboardShell>
  );
}
