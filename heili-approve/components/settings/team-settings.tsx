"use client";

/**
 * Team Settings
 *
 * Workspace members and pending invitations, ported from DM by Heili's
 * settings page. Talks to the same app/api/workspace/members route. Invites
 * are links to copy and send: the route does not email them.
 */

import { useEffect, useState } from "react";
import CopyButton from "@/components/clients/copy-button";
import { ROLE_LABELS, translateMemberApiError } from "@/components/settings/helpers";

type Role = "OWNER" | "ADMIN" | "MEMBER";

interface WorkspaceMembersData {
  currentUserRole: Role;
  members: Array<{
    id: string;
    role: Role;
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: Role;
    inviteUrl: string;
    expiresAt: string;
  }>;
}

interface TeamSettingsProps {
  /** From the server session; the API enforces it again. */
  canManage: boolean;
  currentUserId: string;
}

const dateFormat = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Rome",
});

export default function TeamSettings({ canManage, currentUserId }: TeamSettingsProps) {
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workspace/members")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setMembersData(payload.data);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  async function callMembersApi(method: "POST" | "PATCH" | "DELETE", body: unknown, fallback: string) {
    try {
      const res = await fetch("/api/workspace/members", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (payload.success) {
        setMembersData(payload.data);
        return true;
      }
      setMemberError(translateMemberApiError(payload.error, fallback));
    } catch {
      setMemberError(fallback);
    }
    return false;
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setNotice(null);
    setBusy("invite");
    const email = inviteEmail.trim().toLowerCase();
    const ok = await callMembersApi(
      "POST",
      { email, role: inviteRole },
      "Invito non riuscito. Riprova tra poco."
    );
    if (ok) {
      setInviteEmail("");
      setNotice(`Invito creato per ${email}: copia il link qui sotto e mandalo alla persona. Se ha già un account, è stata aggiunta subito al team.`);
    }
    setBusy(null);
  }

  async function removeInvitation(invitationId: string) {
    setMemberError(null);
    setNotice(null);
    setBusy(`invite:${invitationId}`);
    await callMembersApi("DELETE", { invitationId }, "Revoca non riuscita. Riprova tra poco.");
    setBusy(null);
  }

  async function changeRole(memberId: string, role: "ADMIN" | "MEMBER") {
    setMemberError(null);
    setNotice(null);
    setBusy(`role:${memberId}`);
    await callMembersApi("PATCH", { memberId, role }, "Modifica del ruolo non riuscita.");
    setBusy(null);
  }

  async function removeMember(memberId: string, label: string) {
    if (!confirm(`Rimuovere ${label} dal team? Non potrà più accedere a questo workspace.`)) return;
    setMemberError(null);
    setNotice(null);
    setBusy(`remove:${memberId}`);
    await callMembersApi("DELETE", { memberId }, "Rimozione non riuscita. Riprova tra poco.");
    setBusy(null);
  }

  if (loading) {
    return <div className="h-32 rounded border border-border bg-background" />;
  }

  if (loadError || !membersData) {
    return <p className="text-sm text-error">Impossibile caricare il team. Ricarica la pagina.</p>;
  }

  return (
    <div>
      <div className="space-y-3">
        {membersData.members.map((member) => {
          const label = member.user.name ?? member.user.email ?? "Persona senza nome";
          const editable = canManage && member.role !== "OWNER" && member.user.id !== currentUserId;
          return (
            <div
              key={member.id}
              className="flex flex-col gap-2 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {label}
                  {member.user.id === currentUserId && <span className="font-normal text-muted"> (tu)</span>}
                </p>
                <p className="truncate text-xs text-muted">{member.user.email}</p>
              </div>
              {editable ? (
                <div className="flex shrink-0 gap-2">
                  <select
                    value={member.role}
                    onChange={(e) => changeRole(member.id, e.target.value as "ADMIN" | "MEMBER")}
                    disabled={busy !== null}
                    aria-label={`Ruolo di ${label}`}
                    className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                  >
                    <option value="MEMBER">{ROLE_LABELS.MEMBER}</option>
                    <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeMember(member.id, label)}
                    disabled={busy !== null}
                    className="rounded border border-error/20 px-3 py-1 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                  >
                    Rimuovi
                  </button>
                </div>
              ) : (
                <span className="w-fit rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted">
                  {ROLE_LABELS[member.role]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {membersData.invitations.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Inviti in attesa</p>
          <div className="space-y-3">
            {membersData.invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-col gap-3 rounded border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{invitation.email}</p>
                  <p className="truncate text-xs text-muted">
                    {ROLE_LABELS[invitation.role]} · scade il {dateFormat.format(new Date(invitation.expiresAt))}
                  </p>
                </div>
                <div className="flex gap-2">
                  <CopyButton
                    value={invitation.inviteUrl}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                  />
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => removeInvitation(invitation.id)}
                      disabled={busy === `invite:${invitation.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      {busy === `invite:${invitation.id}` ? "Revoca…" : "Revoca"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {notice && <p className="mt-4 text-sm text-success">{notice}</p>}
      {memberError && !canManage && <p className="mt-4 text-sm text-error">{memberError}</p>}

      {canManage ? (
        <form
          onSubmit={inviteMember}
          className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_160px_auto]"
        >
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="collega@agenzia.it"
            aria-label="Email della persona da invitare"
            autoCapitalize="none"
            className="rounded border border-border bg-background px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
            required
          />
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as "ADMIN" | "MEMBER")}
            aria-label="Ruolo"
            className="rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
          >
            <option value="MEMBER">{ROLE_LABELS.MEMBER}</option>
            <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
          </select>
          <button
            type="submit"
            disabled={busy === "invite"}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === "invite" ? "Invito…" : "Invita"}
          </button>
          {memberError && <p className="text-sm text-error sm:col-span-3">{memberError}</p>}
          <p className="text-xs text-muted sm:col-span-3">
            Gli amministratori gestiscono team e Metricool; i membri preparano i post e gestiscono i clienti.
          </p>
        </form>
      ) : (
        <p className="mt-6 border-t border-border pt-4 text-xs text-muted">
          Solo titolari e amministratori possono invitare persone o cambiare i ruoli.
        </p>
      )}
    </div>
  );
}
