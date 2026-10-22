"use client";

import { useActionState, useState } from "react";
import { magicLinkAction, passwordSignInAction, type LoginFormState } from "@/app/login/actions";

export default function LoginForms({ callbackUrl }: { callbackUrl: string }) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(passwordSignInAction, {
    error: null,
    email: "",
  });

  const emailField = (
    <div className="space-y-1.5">
      <label htmlFor="email" className="block text-sm font-semibold text-foreground">
        Email di lavoro
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="nome@agenzia.it"
        defaultValue={state.email}
        className="field !min-h-11 !text-base"
      />
    </div>
  );

  if (mode === "link") {
    return (
      <div className="space-y-5">
        <form action={magicLinkAction} className="space-y-5">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          {emailField}
          <button type="submit" className="btn btn-primary w-full !min-h-11">
            Inviami il link di accesso
          </button>
        </form>
        <button type="button" onClick={() => setMode("password")} className="btn w-full !min-h-11">
          Accedi con email e password
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        {emailField}
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-semibold text-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="field !min-h-11 !text-base"
          />
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-error">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary w-full !min-h-11">
          {pending ? "Un attimo…" : "Accedi"}
        </button>
      </form>
      <div className="border-t border-border pt-4 text-center">
        <p className="mb-2 text-sm text-muted">Non hai ancora una password o l&apos;hai dimenticata?</p>
        <button type="button" onClick={() => setMode("link")} className="btn w-full !min-h-11">
          Ricevi un link di accesso via email
        </button>
      </div>
    </div>
  );
}
