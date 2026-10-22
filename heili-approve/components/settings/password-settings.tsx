"use client";

import { useActionState } from "react";
import { savePasswordAction, type PasswordSettingsState } from "@/app/(dashboard)/settings/password-actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

export default function PasswordSettings({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [state, formAction, pending] = useActionState<PasswordSettingsState, FormData>(savePasswordAction, {
    error: null,
    saved: false,
  });

  return (
    <form action={formAction} className="space-y-4">
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      {hasPassword && (
        <div className="space-y-1.5">
          <label htmlFor="currentPassword" className="block text-sm font-semibold text-foreground">
            Password attuale
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="field !min-h-11 !text-base"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="newPassword" className="block text-sm font-semibold text-foreground">
          {hasPassword ? "Nuova password" : "Password"}
        </label>
        <input
          id="newPassword"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          className="field !min-h-11 !text-base"
        />
        <p className="text-xs text-muted">Almeno {PASSWORD_MIN_LENGTH} caratteri.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="newPasswordConfirmation" className="block text-sm font-semibold text-foreground">
          Ripeti la password
        </label>
        <input
          id="newPasswordConfirmation"
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
      {state.saved && (
        <p role="status" className="text-sm text-success">
          Password salvata. Da ora puoi accedere con {email} e questa password.
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary !min-h-11">
        {pending ? "Salvataggio…" : hasPassword ? "Cambia password" : "Imposta password"}
      </button>
    </form>
  );
}
