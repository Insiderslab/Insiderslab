"use client";

/**
 * The «Sul sito» iframe (served by Approve at /embed/site, inside the
 * client's test site). It is the only part with Heili, comments and the
 * session; the script on the site only picks elements and hosts it.
 *
 * Trust: it answers a `hello` only from window.parent, on its random
 * channel, from an origin that is EXACTLY one of the site's registered
 * origins (GET /api/site/v1/site); it replies with that origin as
 * targetOrigin, never "*". The session lives in this iframe's own
 * sessionStorage (Approve's origin): the site's JavaScript never sees it.
 * Deciding (approve / request changes) happens only in the portal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HeiliAssistantIcon from "@/components/heili-assistant-icon";
import { AssistantPanel, type AssistantPanelHandle } from "@/components/review/assistant-panel";
import { DEVICE_LABELS } from "@/lib/content/website";
import { siteMarker } from "@/lib/review-assistant/shared";
import type { EmbedContext, EmbedMarker } from "@/lib/website/embed";

type Phase = "waiting" | "ready" | "error";
type Tab = "note" | "heili";

interface PageInfo {
  url: string;
  title: string;
  viewport: { w: number; h: number };
  scrollY: number;
}

interface Pick {
  selector: string;
  textSnippet: string;
  tag: string;
  sectionHeading: string;
  field: boolean;
  offsetX: number;
  offsetY: number;
  scrollY: number;
  viewport: { w: number; h: number };
  pageUrl: string;
}

const DECIDE_IN_PORTAL = "Per approvare o chiedere modifiche torna al portale: qui puoi commentare e parlare con Heili.";

// ─── Message validation (hand-written, like the script's) ────────────────────

const str = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const num = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

function readViewport(value: unknown): { w: number; h: number } | null {
  if (!value || typeof value !== "object") return null;
  const { w, h } = value as { w?: unknown; h?: unknown };
  return num(w, 1, 20000) && num(h, 1, 20000) ? { w: Math.round(w), h: Math.round(h) } : null;
}

function readPage(value: unknown): PageInfo | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  const viewport = readViewport(page.viewport);
  if (!str(page.url, 2048) || !/^https?:\/\//.test(page.url) || !str(page.title, 400) || !viewport || !num(page.scrollY, 0, 1e7)) {
    return null;
  }
  return { url: page.url, title: page.title, viewport, scrollY: Math.round(page.scrollY) };
}

function readPick(data: Record<string, unknown>, page: PageInfo | null): Pick | null {
  const viewport = readViewport(data.viewport);
  const fromPage = readPage(data.page) ?? page;
  if (
    !fromPage ||
    !viewport ||
    !str(data.selector, 300) ||
    !data.selector ||
    !str(data.textSnippet, 400) ||
    !str(data.tag, 40) ||
    !str(data.sectionHeading, 400) ||
    !num(data.offsetX, 0, 1) ||
    !num(data.offsetY, 0, 1) ||
    !num(data.scrollY, 0, 1e7)
  ) {
    return null;
  }
  return {
    selector: data.selector,
    textSnippet: data.textSnippet,
    tag: /^[a-z][a-z0-9-]{0,30}$/.test(data.tag) ? data.tag : "",
    sectionHeading: data.sectionHeading,
    field: data.field === true,
    offsetX: data.offsetX,
    offsetY: data.offsetY,
    scrollY: Math.round(data.scrollY),
    viewport: { w: Math.min(4000, Math.max(200, viewport.w)), h: Math.min(4000, Math.max(200, viewport.h)) },
    pageUrl: fromPage.url,
  };
}

function storageKey(siteKey: string): string {
  return `heili-site-session:${siteKey}`;
}

type ApiError = Error & { code?: string; retryable: boolean };

const NETWORK_MESSAGE = "Non riesco a collegarmi ad Approve. Controlla la connessione e tocca «Riprova».";

async function api<T>(url: string, init: RequestInit & { session?: string } = {}): Promise<T> {
  const { session, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session}` } : {}),
      },
    });
  } catch {
    const error = new Error(NETWORK_MESSAGE) as ApiError;
    error.retryable = true;
    throw error;
  }
  const json = (await response.json().catch(() => null)) as { success: boolean; data?: T; error?: string; code?: string } | null;
  if (!response.ok || !json?.success) {
    const error = new Error(json?.error || "Si è verificato un errore. Tocca «Riprova».") as ApiError;
    error.code = json?.code;
    // No code = not a refusal of the server (network, 5xx): worth another try. «rate» = too many requests, wait a moment.
    error.retryable = !json?.code || json.code === "rate";
    throw error;
  }
  return json.data as T;
}

export default function EmbedApp() {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [message, setMessage] = useState<string | null>(null);
  const [ctx, setCtx] = useState<EmbedContext | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("note");
  const [page, setPage] = useState<PageInfo | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusMethod, setFocusMethod] = useState<string | null>(null);
  const hostRef = useRef<{ origin: string; channel: string } | null>(null);
  /** The site is in «Tocca l'elemento» mode (this iframe still has the keyboard focus). */
  const pickingRef = useRef(false);
  /** Heili was tapped before the handshake ended: open as soon as it does. */
  const openPending = useRef(false);
  const pageRef = useRef<PageInfo | null>(null);
  const assistant = useRef<AssistantPanelHandle | null>(null);
  /** «Riprova» after a failure that is worth another try (network, server). */
  const retryRef = useRef<(() => void) | null>(null);
  const [retryable, setRetryable] = useState(false);
  const openRef = useRef(false);
  const wasOpen = useRef(false);
  /** After «Indica un punto» the cursor goes to the note field, not to the top of the panel. */
  const focusNote = useRef(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const post = useCallback((type: string, data: Record<string, unknown> = {}) => {
    const host = hostRef.current;
    if (!host) return;
    window.parent.postMessage({ v: 1, c: host.channel, type, ...data }, host.origin);
  }, []);

  const showMarkers = useCallback(
    (markers: EmbedMarker[]) =>
      post("markers", {
        markers: markers.map((m) => ({ id: m.id, n: m.n, selector: m.selector, textSnippet: m.textSnippet, pageUrl: m.pageUrl, resolved: m.resolved })),
      }),
    [post]
  );

  const setUi = useCallback(
    (next: boolean) => {
      setOpen(next);
      post("ui", { state: next ? "open" : "closed" });
    },
    [post]
  );

  // ─── Handshake ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const siteKey = params.get("k") ?? "";
    const channel = /^#c=([a-f0-9]{32})$/.exec(window.location.hash)?.[1] ?? null;
    if (window.parent === window || !channel || !/^hs_[A-Za-z0-9_-]{16,64}$/.test(siteKey)) {
      queueMicrotask(() => {
        setPhase("error");
        setMessage("Apri il sito dal portale di revisione.");
      });
      return;
    }
    let origins: string[] | null = null;
    const pending: MessageEvent[] = [];
    let handled = false;

    let lastHello: { event: MessageEvent; data: Record<string, unknown> } | null = null;

    const fail = (text: string, end: boolean, retry: (() => void) | null = null) => {
      setPhase("error");
      setMessage(text);
      retryRef.current = retry;
      setRetryable(Boolean(retry));
      if (end && hostRef.current) post("end");
    };

    const handleHello = async (event: MessageEvent, data: Record<string, unknown>) => {
      if (handled) return;
      if (!origins || !origins.includes(event.origin)) return; // not a registered origin: no answer at all
      handled = true;
      hostRef.current = { origin: event.origin, channel };
      const firstPage = readPage(data.page);
      if (firstPage) {
        pageRef.current = firstPage;
        setPage(firstPage);
      }
      const code = typeof data.launchCode === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(data.launchCode) ? data.launchCode : null;
      try {
        let context: EmbedContext;
        let token: string;
        if (code) {
          const exchanged = await api<EmbedContext & { session: string }>("/api/site/v1/exchange", {
            method: "POST",
            body: JSON.stringify({ siteKey, code, hostOrigin: event.origin, v: 1 }),
          });
          token = exchanged.session;
          context = exchanged;
          try {
            sessionStorage.setItem(storageKey(siteKey), JSON.stringify({ session: token, origin: event.origin }));
          } catch {
            // the session then lasts for this page only
          }
        } else {
          let stored: { session?: string; origin?: string } = {};
          try {
            stored = JSON.parse(sessionStorage.getItem(storageKey(siteKey)) ?? "{}");
          } catch {
            stored = {};
          }
          if (!stored.session || stored.origin !== event.origin) {
            fail("La sessione è scaduta: riapri il sito dal portale.", true);
            return;
          }
          token = stored.session;
          context = await api<EmbedContext>("/api/site/v1/context", { session: token });
        }
        setSession(token);
        setCtx(context);
        setPhase("ready");
        post("ready");
        showMarkers(context.markers);
        if (openPending.current) setUi(true);
        if (context.focus) {
          post("focus", {
            selector: context.focus.selector,
            textSnippet: context.focus.textSnippet,
            scrollY: context.focus.scrollY,
            offsetX: context.focus.offsetX,
            offsetY: context.focus.offsetY,
          });
          setUi(true);
        }
      } catch (e) {
        if ((e as Partial<ApiError>).retryable === true) {
          // Not a refusal: keep the session and the code, «Riprova» tries again.
          handled = false;
          fail(e instanceof Error ? e.message : NETWORK_MESSAGE, false, () => {
            setPhase("waiting");
            setMessage(null);
            if (lastHello) void handleHello(lastHello.event, lastHello.data);
          });
          return;
        }
        try {
          sessionStorage.removeItem(storageKey(siteKey));
        } catch {
          // nothing stored
        }
        fail(e instanceof Error ? e.message : "Non riesco ad aprire la revisione.", true);
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object" || data.v !== 1 || data.c !== channel || typeof data.type !== "string") return;
      if (data.type === "hello") {
        lastHello = lastHello ?? { event, data };
        if (!origins) pending.push(event);
        else void handleHello(event, data);
        return;
      }
      // Everything else only from the origin that completed the handshake.
      if (!hostRef.current || event.origin !== hostRef.current.origin) return;
      if (data.type === "page") {
        const next = readPage(data.page);
        if (next) {
          pageRef.current = next;
          setPage(next);
        }
      } else if (data.type === "pick:result") {
        pickingRef.current = false;
        const picked = readPick(data, pageRef.current);
        if (picked) {
          setPick(picked);
          setTab("note");
          focusNote.current = true;
          setOpen(true);
          setNotice(picked.field ? "Questo campo non si può commentare: ho scelto il riquadro che lo contiene." : null);
        }
      } else if (data.type === "pick:cancel") {
        pickingRef.current = false;
        setOpen(true);
      } else if (data.type === "focus:result" && str(data.method, 20)) {
        setFocusMethod(data.method);
      }
    };

    // Esc cancels «Indica un punto» also when the keyboard focus stayed in this iframe;
    // with the panel open it closes the panel (the focus goes back to Heili's button).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pickingRef.current) {
        pickingRef.current = false;
        post("pick:cancel");
        setOpen(true);
      } else if (openRef.current) {
        setOpen(false);
        post("ui", { state: "closed" });
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
    let attempts = 0;
    const loadOrigins = () => {
      attempts += 1;
      api<{ origins: string[] }>(`/api/site/v1/site?key=${encodeURIComponent(siteKey)}`)
        .then((result) => {
          origins = result.origins;
          setPhase((current) => (current === "error" ? "waiting" : current));
          for (const event of pending.splice(0)) onMessage(event);
        })
        .catch((e: Partial<ApiError>) => {
          if (e.retryable && attempts < 3) {
            window.setTimeout(loadOrigins, 1500 * attempts);
            return;
          }
          if (!e.retryable) return fail("Questo sito non è collegato ad Approve: avvisa l'agenzia.", false);
          fail(e.message ?? NETWORK_MESSAGE, false, () => {
            setPhase("waiting");
            setMessage(null);
            attempts = 0;
            loadOrigins();
          });
        });
    };
    loadOrigins();
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
    };
  }, [post, setUi, showMarkers]);

  useEffect(() => {
    openRef.current = open;
    if (open) {
      wasOpen.current = true;
      // Keyboard and screen reader users land in the panel (or in the note after «Indica un punto»).
      requestAnimationFrame(() => {
        const note = focusNote.current ? document.getElementById("embed-note") : null;
        focusNote.current = false;
        (note ?? panelRef.current)?.focus();
      });
    } else if (wasOpen.current) {
      wasOpen.current = false;
      // Closed (button, Esc) or off to «Indica un punto»: back to Heili's button, so Esc keeps working.
      requestAnimationFrame(() => launcherRef.current?.focus());
    }
  }, [open]);

  // ─── Comments ──────────────────────────────────────────────────────────────

  async function sendComment() {
    if (!session || busy) return;
    const body = draft.trim();
    if (!body) {
      setError("Scrivi la nota.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const anchor = pick
        ? {
            pageUrl: pick.pageUrl,
            device: pick.viewport.w < 768 ? "phone" : "desktop",
            viewport: pick.viewport,
            selector: pick.selector,
            textSnippet: pick.textSnippet,
            ...(pick.tag ? { tag: pick.tag } : {}),
            ...(pick.sectionHeading ? { sectionHeading: pick.sectionHeading } : {}),
            offsetX: pick.offsetX,
            offsetY: pick.offsetY,
            scrollY: pick.scrollY,
          }
        : undefined;
      const result = await api<{ commentId: string; markers: EmbedMarker[] }>("/api/site/v1/comments", {
        method: "POST",
        session,
        body: JSON.stringify({ body, ...(anchor ? { anchor } : {}) }),
      });
      setCtx((current) => (current ? { ...current, markers: result.markers } : current));
      showMarkers(result.markers);
      setDraft("");
      setPick(null);
      setNotice("Nota salvata: la trovi anche nel portale, in «Le tue note».");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nota non salvata. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  function insertPickInHeili() {
    if (!pick) return;
    assistant.current?.insertMarker(
      siteMarker({ page: pick.pageUrl, device: pick.viewport.w < 768 ? "phone" : "desktop", textSnippet: pick.textSnippet })
    );
  }

  const transport = useMemo(
    () => (session ? { baseUrl: "/api/site/v1/assistant", headers: { Authorization: `Bearer ${session}` } } : undefined),
    [session]
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!open) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-transparent">
        <button
          ref={launcherRef}
          type="button"
          onClick={() => {
            if (phase === "ready") setUi(true);
            else if (phase === "error") {
              // The panel can open once the site is known; before that a tap is a retry.
              if (hostRef.current) setUi(true);
              else retryRef.current?.();
            } else openPending.current = true;
          }}
          aria-label={phase === "ready" ? "Apri Heili" : phase === "error" ? "Heili: qualcosa non va, tocca per i dettagli" : "Heili"}
          title={message ?? "Heili"}
          className="relative flex h-16 w-16 items-center justify-center rounded-full shadow-lg"
          data-testid="embed-launcher"
          data-phase={phase}
        >
          <HeiliAssistantIcon className="h-16 w-16 rounded-full" />
          {phase === "error" && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-error text-sm font-bold text-white"
            >
              !
            </span>
          )}
        </button>
      </div>
    );
  }

  const here = page?.url ?? "";
  const pageMarkers = ctx?.markers.filter((m) => m.pageUrl === here) ?? [];
  const otherMarkers = (ctx?.markers.length ?? 0) - pageMarkers.length;
  const device = page ? (page.viewport.w < 768 ? "phone" : "desktop") : null;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Heili, revisione del sito"
      className="flex h-screen flex-col bg-background text-foreground outline-none"
      data-testid="embed-panel"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <HeiliAssistantIcon className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Heili</p>
          <p className="truncate text-xs text-muted">{ctx ? `${ctx.post.title} · Giro ${ctx.post.round}` : "Revisione del sito"}</p>
        </div>
        <button type="button" onClick={() => setUi(false)} className="btn btn-quiet btn-sm" aria-label="Chiudi Heili (Esc)">
          Chiudi
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {phase !== "ready" || !ctx ? (
          <div className="space-y-3">
            <p className={`text-sm ${phase === "error" ? "text-error" : ""}`} role={phase === "error" ? "alert" : "status"}>
              {message ?? "Collegamento in corso…"}
            </p>
            {phase === "error" && retryable && (
              <button type="button" className="btn btn-primary w-full" onClick={() => retryRef.current?.()} data-testid="embed-retry">
                Riprova
              </button>
            )}
            {phase === "error" && !retryable && (
              <p className="text-sm text-muted">Torna al portale e tocca di nuovo «Apri il sito».</p>
            )}
          </div>
        ) : ctx.role === "AGENCY" ? (
          <AgencyFocus ctx={ctx} method={focusMethod} />
        ) : (
          <>
            {ctx.canComment && ctx.assistantEnabled && (
              <div className="flex gap-2" role="tablist">
                {(["note", "heili"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`btn btn-sm flex-1 ${tab === id ? "btn-primary" : ""}`}
                  >
                    {id === "note" ? "Commenta" : "Parla con Heili"}
                  </button>
                ))}
              </div>
            )}

            {!ctx.canComment && (
              <p className="rounded-lg border border-border bg-surface p-3 text-sm">
                Questa revisione è già stata decisa: qui puoi solo guardare le note.
              </p>
            )}

            {ctx.canComment && (
              <section className="space-y-3" hidden={tab !== "note"}>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setOpen(false);
                    pickingRef.current = true;
                    post("pick:start");
                  }}
                  className="btn w-full"
                  data-testid="embed-pick"
                >
                  Indica un punto
                </button>
                {pick && (
                  <div className="rounded-lg border border-accent/40 bg-surface p-3 text-sm" data-testid="embed-picked">
                    <p className="text-xs text-muted">
                      Elemento indicato · {DEVICE_LABELS[pick.viewport.w < 768 ? "phone" : "desktop"]}
                    </p>
                    <p className="break-words font-medium">{pick.textSnippet ? `«${pick.textSnippet}»` : `<${pick.tag || "elemento"}>`}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-sm" onClick={() => setPick(null)}>
                        Togli il punto
                      </button>
                      {ctx.assistantEnabled && (
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          onClick={() => {
                            setTab("heili");
                            requestAnimationFrame(insertPickInHeili);
                          }}
                        >
                          Chiedi a Heili
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <label className="block text-sm font-medium" htmlFor="embed-note">
                  {pick ? "La tua nota su questo elemento" : "La tua nota su questa pagina"}
                </label>
                <textarea
                  id="embed-note"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={4}
                  maxLength={5000}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-base"
                  placeholder="Es. Il pulsante Contatti si vede poco"
                />
                {error && (
                  <p className="text-sm text-error" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="text-sm text-success" role="status">
                    {notice}
                  </p>
                )}
                <button type="button" onClick={sendComment} disabled={busy || !draft.trim()} className="btn btn-primary w-full" data-testid="embed-send">
                  {busy ? "Invio…" : "Invia la nota"}
                </button>
              </section>
            )}

            {ctx.canComment && ctx.assistantEnabled && transport && (
              <section hidden={tab !== "heili"}>
                {pick && (
                  <button type="button" className="btn btn-sm mb-2" onClick={insertPickInHeili}>
                    Usa l&apos;elemento indicato
                  </button>
                )}
                <AssistantPanel
                  transport={transport}
                  liveVoice={false}
                  decisionsElsewhere={DECIDE_IN_PORTAL}
                  postId={ctx.post.id}
                  versionNumber={ctx.post.versionNumber}
                  kind="WEBSITE"
                  mode={ctx.post.status === "CHANGES_REQUESTED" ? "feedback" : "decision"}
                  controlRef={assistant}
                  showHeader={false}
                  onSubmitChanges={async () => {
                    throw new Error(DECIDE_IN_PORTAL);
                  }}
                />
              </section>
            )}

            <section className="space-y-2 border-t border-border pt-3">
              <h2 className="text-sm font-semibold">Note su questa pagina ({pageMarkers.length})</h2>
              {pageMarkers.length === 0 ? (
                <p className="text-sm text-muted">Ancora nessuna nota qui.</p>
              ) : (
                <ul className="space-y-2">
                  {pageMarkers.map((m) => (
                    <li key={m.id} className="rounded border border-border p-2 text-sm" data-testid="embed-note">
                      <span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-xs font-semibold text-background">
                        {m.n}
                      </span>
                      <span className="text-xs text-muted">{m.mine ? "Tu" : m.authorName}</span>
                      <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              {otherMarkers > 0 && <p className="text-xs text-muted">Altre {otherMarkers} note su altre pagine.</p>}
              {device && <p className="text-xs text-muted">Stai guardando da {DEVICE_LABELS[device].toLowerCase()}.</p>}
            </section>

            <div className="space-y-2 rounded-lg bg-surface p-3 text-sm">
              <p>{DECIDE_IN_PORTAL}</p>
              {ctx.portalUrl && (
                <a href={ctx.portalUrl} target="_blank" rel="noopener noreferrer" className="btn w-full" data-testid="embed-portal">
                  Apri il portale
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AgencyFocus({ ctx, method }: { ctx: EmbedContext; method: string | null }) {
  const focus = ctx.focus;
  const outcome =
    method === "selector"
      ? "Elemento trovato"
      : method === "text"
        ? "Elemento trovato dal testo"
        : method === "scroll" || method === "none"
          ? "Elemento non trovato: posizione approssimativa"
          : "Cerco l'elemento…";
  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-border bg-surface p-3 text-sm">Vista dell&apos;agenzia: sola lettura.</p>
      {focus ? (
        <article className="space-y-2 rounded-lg border border-accent/40 p-3 text-sm" data-testid="embed-focus">
          <p className="text-xs text-muted">
            {focus.authorName} · {new Date(focus.createdAt).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <p className="text-xs font-medium text-muted">{focus.chip}</p>
          <p className="whitespace-pre-wrap break-words">{focus.body}</p>
          <p className={`text-xs font-medium ${method === "selector" || method === "text" ? "text-success" : "text-warning"}`}>{outcome}</p>
        </article>
      ) : (
        <p className="text-sm text-muted">Nessuna nota da mostrare.</p>
      )}
    </div>
  );
}
