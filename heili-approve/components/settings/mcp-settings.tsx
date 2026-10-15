/**
 * «Collega la tua AI (MCP)» — how to connect Claude, ChatGPT, Codex or Claude
 * Code to this workspace through the remote MCP server (docs/COLLEGARE-AI-MCP.md).
 * Server component: it only shows the public MCP address and whether OAuth is
 * configured (never any configuration value). The copy buttons are client islands.
 */

import CopyButton from "@/components/clients/copy-button";

const COPY_CLASS = "btn btn-quiet btn-sm shrink-0 self-start";

function Command({ value, label }: { value: string; label: string }) {
  return (
    <div className="inset flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
      <code className="min-w-0 whitespace-pre-wrap break-all text-[13px] leading-5">{value}</code>
      <CopyButton value={value} label={label} className={COPY_CLASS} />
    </div>
  );
}

export default function McpSettings({
  url,
  enabled,
  oauthConfigured,
  canManage = false,
}: {
  url: string;
  enabled: boolean;
  oauthConfigured: boolean;
  /** Owner or admin: the line about switching on the account login points to the server settings, not to «ask the owner». */
  canManage?: boolean;
}) {
  return (
    <section className="panel space-y-4 rounded p-4 sm:p-6" data-testid="mcp-settings">
      <div>
        <h2 className="text-base font-semibold">Collega la tua AI (MCP)</h2>
        <p className="mt-2 text-sm text-muted">
          Claude, ChatGPT o Codex possono leggere post, piani e commenti dei clienti dei tuoi workspace e preparare
          bozze. Non approvano, non inviano al cliente, non programmano e non pubblicano: ciò che creano resta in
          Bozza finché lo invii tu.
        </p>
      </div>

      {!enabled ? (
        <p className="text-sm text-muted" data-testid="mcp-disabled">
          Il collegamento MCP è disattivato su questa installazione.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium">Indirizzo del connettore</p>
            <Command value={url} label="Copia indirizzo" />
          </div>

          <p className="text-sm" data-testid="mcp-oauth-status">
            <span className="font-medium">Accesso con il tuo account: </span>
            {oauthConfigured ? (
              <span className="text-success">configurato</span>
            ) : (
              <span className="text-warning">non configurato</span>
            )}
            <span className="text-muted">
              {oauthConfigured
                ? " — Claude e ChatGPT ti fanno accedere con lo stesso account di Heili."
                : canManage
                  ? " — per ora collega con una chiave personale (sezione «Importa con Codex o Claude» qui sopra). Per attivare l'accesso con account aggiungi la configurazione OAuth tra le variabili d'ambiente del server: i passi sono nella guida «Collegare l'AI via MCP» del progetto."
                  : " — per ora collega con una chiave personale (sezione «Importa con Codex o Claude» qui sopra). Per attivare l'accesso con account chiedi a chi gestisce l'installazione."}
            </span>
          </p>

          <div className="divide-y divide-border">
            {oauthConfigured && (
              <>
              <details className="py-3" open>
                <summary className="cursor-pointer text-sm font-semibold">Claude</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
                  <li>Apri Claude → Impostazioni → <strong>Connettori</strong>.</li>
                  <li>Scegli <strong>Aggiungi connettore personalizzato</strong>.</li>
                  <li>Incolla l&apos;indirizzo qui sopra e conferma.</li>
                  <li>Accedi con il tuo account quando richiesto.</li>
                </ol>
              </details>

              <details className="py-3">
                <summary className="cursor-pointer text-sm font-semibold">ChatGPT</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
                  <li>Impostazioni → Connettori → <strong>Impostazioni avanzate</strong> → attiva la <strong>modalità sviluppatore</strong>.</li>
                  <li>Crea un nuovo connettore (app personalizzata) e incolla l&apos;indirizzo.</li>
                  <li>Scegli l&apos;accesso con <strong>OAuth</strong> e accedi con il tuo account.</li>
                </ol>
              </details>

              </>
            )}

            <details className="py-3" open={!oauthConfigured}>
              <summary className="cursor-pointer text-sm font-semibold">Codex e Claude Code</summary>
              <div className="mt-2 space-y-2">
                {oauthConfigured ? (
                  <>
                    <p className="text-sm text-muted">Dal terminale, con accesso tramite account:</p>
                    <Command value={`codex mcp add approve --url ${url}`} label="Copia comando" />
                    <Command value={`claude mcp add --transport http approve ${url}`} label="Copia comando" />
                  </>
                ) : (
                  <p className="text-sm text-muted">
                    Claude e ChatGPT sul web chiedono l&apos;accesso con account, non ancora attivo qui. Dal terminale
                    funziona la chiave personale.
                  </p>
                )}
                <p className="text-sm text-muted">
                  Con la <strong>chiave personale</strong> (sezione «Importa con Codex o Claude» qui sopra) non serve
                  l&apos;accesso con account: Claude Code la invia come <code>Authorization: Bearer</code>.
                </p>
                <Command
                  value={`claude mcp add --transport http approve ${url} --header "Authorization: Bearer ⟨la tua chiave⟩"`}
                  label="Copia comando"
                />
                <p className="text-sm text-muted">
                  Codex: imposta la chiave in una variabile d&apos;ambiente (es. <code>APPROVE_KEY</code>) e nel file
                  di configurazione aggiungi <code>bearer_token_env_var = &quot;APPROVE_KEY&quot;</code> al server
                  <code> approve</code>. Non incollare mai la chiave in chat.
                </p>
              </div>
            </details>
          </div>
        </>
      )}
    </section>
  );
}
