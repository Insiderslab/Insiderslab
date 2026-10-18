import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { countOpenTasks } from "@/lib/activity";
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

  // Items waiting on the agency: open tasks (assigned to me plus unassigned),
  // shown in the menu and in the top bar, which now leads to /attivita.
  const [clients, currentClientId, openTasks] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId: workspace.id, archivedAt: null },
      select: { id: true, name: true, logoUrl: true, services: true },
      orderBy: { name: "asc" },
    }),
    getCurrentClientId(workspace.id),
    countOpenTasks(workspace.id, session.user.id),
  ]);

  return (
    <DashboardShell
      workspaceName={workspace.name}
      metricoolConnected={Boolean(workspace.metricoolTokenEncrypted)}
      needsAttention={openTasks}
      variant={variant}
      clients={clients}
      currentClientId={currentClientId}
      activityCount={openTasks}
      currentClientServices={clients.find((client) => client.id === currentClientId)?.services.filter((kind) => enabledKinds(variant).includes(kind))}
    >
      {children}
    </DashboardShell>
  );
}
