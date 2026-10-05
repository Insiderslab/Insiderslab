"use client";

import { useState } from "react";

interface InvitationAcceptCardProps {
  token: string;
  isSignedIn: boolean;
  invitedEmail: string;
}

export default function InvitationAcceptCard({
  token,
  isSignedIn,
  invitedEmail,
}: InvitationAcceptCardProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function acceptInvite() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/workspace/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json();
    if (payload.success) {
      window.location.assign("/dashboard");
      return;
    }
    setMessage(payload.error ?? "Non è stato possibile accettare l'invito");
    setBusy(false);
  }

  if (!isSignedIn) {
    return (
      <a
        href="/login"
        className="inline-flex items-center justify-center rounded bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover"
      >
        Accedi per accettare
      </a>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={acceptInvite}
        disabled={busy}
        className="inline-flex items-center justify-center rounded bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? "Un attimo…" : "Accetta l'invito"}
      </button>
      {message && <p className="text-sm text-error">{message}</p>}
      <p className="text-xs text-muted">
        Accedi con il link via email per {invitedEmail}.
      </p>
    </div>
  );
}

