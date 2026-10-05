/**
 * Settings Page
 *
 * Metricool connection (userId + API token) and team. The token is
 * decrypted here only to compute its last 4 characters: the token itself is
 * never passed to a client component.
 */

import { redirect } from "next/navigation";
import { formatLongDate } from "@/components/clients/helpers";
import { secretTail } from "@/components/settings/helpers";
import MetricoolSettings from "@/components/settings/metricool-settings";
import TeamSettings from "@/components/settings/team-settings";
import { decryptSecret } from "@/lib/crypto";
import { isMetricoolFake } from "@/lib/metricool/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Impostazioni - Approve by Heili" };

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

  return (
    <div className="mx-auto max-w-2xl space-y-8">
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

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-6 text-base font-semibold">Team</h2>
        <TeamSettings canManage={canManage} currentUserId={context.userId} />
      </section>
    </div>
  );
}
