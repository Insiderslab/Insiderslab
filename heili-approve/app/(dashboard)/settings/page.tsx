/**
 * Settings Page
 *
 * Metricool connection (userId + API token) and team. The token is
 * decrypted here only to compute its last 4 characters: the token itself is
 * never passed to a client component. Instances without social posts (blog,
 * ads) have no Metricool section: only the team.
 */

import { redirect } from "next/navigation";
import { formatLongDate } from "@/components/clients/helpers";
import { secretTail } from "@/components/settings/helpers";
import MetricoolSettings from "@/components/settings/metricool-settings";
import TeamSettings from "@/components/settings/team-settings";
import AutomationSettings from "@/components/settings/automation-settings";
import { prisma } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";
import { isMetricoolFake } from "@/lib/metricool/client";
import { contentWords } from "@/components/posts/helpers";
import { enabledKinds, isMetricoolEnabled, productName } from "@/lib/variant";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Impostazioni - ${productName()}` };
}

function storedTokenTail(encrypted: string | null): { tail: string | null; unreadable: boolean } {
  if (!encrypted) return { tail: null, unreadable: false };
  try {
    return { tail: secretTail(decryptSecret(encrypted)) || null, unreadable: false };
  } catch {
    return { tail: null, unreadable: true };
  }
}

export default async function SettingsPage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const { workspace } = context;
  const connected = Boolean(workspace.metricoolUserId && workspace.metricoolTokenEncrypted);
  const token = storedTokenTail(workspace.metricoolTokenEncrypted);
  const canManage = canManageWorkspace(context.role);
  const metricool = isMetricoolEnabled();
  const tokens = await prisma.automationToken.findMany({
    where: { workspaceId: context.workspaceId, userId: context.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, name: true, expiresAt: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <AutomationSettings tokens={tokens.map(token => ({ ...token, expiresAt: token.expiresAt.toISOString() }))} />
      {metricool && (
        <section className="panel rounded p-4 sm:p-6">
          <h2 className="mb-1 text-base font-semibold">Metricool</h2>
          <p className="mb-4 text-sm text-muted">
            Quando un cliente approva un post, lo programmiamo sul suo brand Metricool con l&apos;account
            dell&apos;agenzia.
          </p>
          <MetricoolSettings
            connected={connected}
            userId={workspace.metricoolUserId}
            connectedAtLabel={workspace.metricoolConnectedAt ? formatLongDate(workspace.metricoolConnectedAt) : null}
            tokenTail={token.tail}
            tokenUnreadable={token.unreadable}
            canManage={canManage}
            fakeMode={isMetricoolFake()}
          />
        </section>
      )}

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-6 text-base font-semibold">Team</h2>
        <TeamSettings
          canManage={canManage}
          currentUserId={context.userId}
          metricool={metricool}
          contentsThe={contentWords(enabledKinds()).the}
        />
      </section>
    </div>
  );
}
