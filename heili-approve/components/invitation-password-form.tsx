"use client";

import { useActionState } from "react";
import {
  createPasswordFromInvitationAction,
  type InvitePasswordState,
} from "@/app/invite/[token]/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

export default function InvitationPasswordForm({ token, invitedEmail }: { token: string; invitedEmail: string }) {
  const [state, formAction, pending] = useActionState<InvitePasswordState, FormData>(
    createPasswordFromInvitationAction,
    { error: null }
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the pair under the right email. */}
      <input type="email" name="username" value={invitedEmail} autoComplete="username" readOnly hidden />
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-semibold text-foreground">
          Scegli una password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          aria-describedby="password-hint"
          className="field !min-h-11 !text-base"
        />
        <p id="password-hint" className="text-xs text-muted">
          Almeno {PASSWORD_MIN_LENGTH} caratteri.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirmation" className="block text-sm font-semibold text-foreground">
          Ripeti la password
        </label>
        <input
          id="confirmation"
          name="confirmation"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          className="field !min-h-11 !text-base"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full !min-h-11">
        {pending ? "Un attimo…" : "Crea la password ed entra"}
      </button>
      <p className="text-xs text-muted">
        Da qui in poi accedi con {invitedEmail} e questa password.
      </p>
    </form>
  );
}
