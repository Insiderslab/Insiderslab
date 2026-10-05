import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
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

  // Posts waiting on the agency: the client asked for changes, or scheduling
  // on Metricool failed. Shown as a counter in the top bar.
  const needsAttention = await prisma.post.count({
    where: {
      workspaceId: workspace.id,
      status: { in: ["CHANGES_REQUESTED", "FAILED"] },
    },
  });

  return (
    <DashboardShell
      workspaceName={workspace.name}
      metricoolConnected={Boolean(workspace.metricoolTokenEncrypted)}
      needsAttention={needsAttention}
    >
      {children}
    </DashboardShell>
  );
}
