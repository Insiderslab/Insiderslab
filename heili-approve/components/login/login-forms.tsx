"use client";

import { useActionState, useState } from "react";
import {
  magicLinkAction,
  passwordSignInAction,
  requestPasswordResetAction,
  type LoginFormState,
  type ResetRequestState,
} from "@/app/login/actions";

type Mode = "password" | "reset" | "link";

function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor="email" className="block text-sm font-semibold text-foreground">
        Email di lavoro
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="username"
        placeholder="nome@agenzia.it"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field !min-h-11 !text-base"
      />
    </div>
  );
}

export default function LoginForms({ callbackUrl, initialMode = "password" }: { callbackUrl: string; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  // Typed once, kept across the three forms.
  const [email, setEmail] = useState("");
  const [signInState, signInAction, signingIn] = useActionState<LoginFormState, FormData>(passwordSignInAction, {
    error: null,
    email: "",
  });
  const [resetState, resetAction, sendingReset] = useActionState<ResetRequestState, FormData>(
    requestPasswordResetAction,
    { error: null, sentTo: null }
  );

  const backToPassword = (
    <button type="button" onClick={() => setMode("password")} className="btn w-full !min-h-11">
      Torna all&apos;accesso con password
    </button>
  );

  if (mode === "reset") {
    if (resetState.sentTo) {
      return (
        <div className="space-y-5 text-center">
          <h2 className="text-xl font-semibold">Controlla la tua email</h2>
          <p className="text-muted">
            Se {resetState.sentTo} ha un account, ti è arrivato un link per scegliere la nuova password. Vale un&apos;ora:
            se non lo trovi, guarda nello spam.
          </p>
          {backToPassword}
        </div>
      );
    }
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Password dimenticata?</h2>
          <p className="mt-1 text-sm text-muted">
            Scrivi la tua email: ti mandiamo un link per sceglierne una nuova. Serve anche se non hai mai impostato una
            password.
          </p>
        </div>
        <form action={resetAction} className="space-y-5">
          <EmailField value={email} onChange={setEmail} />
          {resetState.error && (
            <p role="alert" className="text-sm text-error">
              {resetState.error}
            </p>
          )}
          <button type="submit" disabled={sendingReset} className="btn btn-primary w-full !min-h-11">
            {sendingReset ? "Invio…" : "Mandami il link"}
          </button>
        </form>
        {backToPassword}
      </div>
    );
  }

  if (mode === "link") {
    return (
      <div className="space-y-5">
        <form action={magicLinkAction} className="space-y-5">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <EmailField value={email} onChange={setEmail} />
          <button type="submit" className="btn btn-primary w-full !min-h-11">
            Inviami il link di accesso
          </button>
        </form>
        {backToPassword}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form action={signInAction} className="space-y-5">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <EmailField value={email} onChange={setEmail} />
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="password" className="block text-sm font-semibold text-foreground">
              Password
            </label>
            <button
              type="button"
              onClick={() => setMode("reset")}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline"
            >
              Password dimenticata?
            </button>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="field !min-h-11 !text-base"
          />
        </div>
        {signInState.error && (
          <p role="alert" className="text-sm text-error">
            {signInState.error}
          </p>
        )}
        <button type="submit" disabled={signingIn} className="btn btn-primary w-full !min-h-11">
          {signingIn ? "Un attimo…" : "Accedi"}
        </button>
      </form>
      <div className="border-t border-border pt-4 text-center">
        <button
          type="button"
          onClick={() => setMode("link")}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline"
        >
          Accedi senza password, con un link via email
        </button>
      </div>
    </div>
  );
}
