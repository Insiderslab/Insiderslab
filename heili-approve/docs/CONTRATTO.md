# Approve by Heili — contratto di architettura

Piattaforma di revisione/approvazione dei post social dei clienti. L'agenzia
prepara i post, il cliente li rivede da un link personale (senza login), e i
post approvati vengono programmati automaticamente su Metricool.

Stessa tecnologia di **DM by Heili** (`Insiderslab/heili-dm`), da cui sono
stati presi login, workspace/ruoli/inviti, shell del pannello, coda BullMQ,
Docker e design system:

- Next.js **16** (App Router, `proxy.ts` al posto di `middleware.ts`, React 19,
  React Compiler). È diverso da Next 13/14/15: prima di usare un'API di Next,
  controlla la guida in `node_modules/next/dist/docs/`.
- Prisma **7** con `@prisma/adapter-pg` (client generato in `app/generated/prisma`,
  import da `@/app/generated/prisma/client`), Postgres 16.
- NextAuth v5 (magic link email), sessione su DB. Solo lo staff dell'agenzia fa login.
- BullMQ + Redis, worker separato (`npm run worker`).
- Tailwind 4 con i token in `app/globals.css` (`bg-background`, `bg-surface`,
  `border-border`, `text-muted`, `text-accent`, `bg-accent`, `text-success`,
  `text-warning`, `text-error`, classe `.panel`). Stile sobrio: niente gradienti,
  glow o animazioni (vedi il commento in globals.css).
- zod 4, vitest (`__tests__/**/*.test.ts`), `@anthropic-ai/sdk`.

**Tutta l'interfaccia è in italiano.** Commenti nel codice in inglese, come in heili-dm.

## Già pronto (non riscrivere)

| File | Cosa |
|---|---|
| `prisma/schema.prisma` | Modello dati completo. Leggilo per primo. |
| `lib/domain.ts` | Reti, formati, limiti caratteri, `MediaItem`, macchina a stati (`assertTransition`, `nextStatus`), etichette stato. **Ogni cambio di stato passa da qui.** |
| `lib/crypto.ts` | `encryptSecret`/`decryptSecret` (AES-256-GCM), `generateToken`, `hashToken`. |
| `lib/env.ts` | `getBaseUrl()`, `getUploadDir()`, `getMetricoolApiBase()`, allowlist login. |
| `lib/queue/client.ts` | Coda `post-scheduling`, `SchedulePostJob`, `schedulePostJobId`. |
| `lib/auth.ts`, `lib/workspace*.ts`, `lib/active-workspace.ts` | Da heili-dm. Usa `getCurrentWorkspaceContext()` (in `lib/workspace-access.ts`) in ogni pagina/azione dell'agenzia: restituisce `{ userId, workspaceId, workspace, role }` o null. |
| `lib/db/client.ts` | `prisma`. |
| `components/dashboard-shell.tsx`, `sidebar.tsx`, `top-bar.tsx`, `workspace-switcher.tsx`, `status-badge.tsx`, `stat-card.tsx` | Shell del pannello. `StatusBadge` accetta un `PostStatus`. |
| `app/(dashboard)/layout.tsx` | Layout autenticato. Le pagine dell'agenzia vanno sotto `app/(dashboard)/`. |
| `proxy.ts` | Protegge `/dashboard /posts /calendar /clients /settings`. `/review/*`, `/media/*`, `/api/review/*` sono pubblici (autenticati da token). |

## Regole di sicurezza (non negoziabili)

1. Ogni query dell'agenzia filtra per `workspaceId` del contesto corrente. Mai fidarsi di un id dal client senza verificarne il workspace.
2. Il portale cliente si autentica **solo** con il token del link (`/review/<token>`): `resolveReviewerToken(token)` → reviewer + client. Ogni azione verifica che `post.clientId === reviewer.clientId` e che lo stato sia visibile al cliente (`CLIENT_VISIBLE_STATUSES`). Il cliente non vede mai le bozze (`DRAFT`, `CANCELLED`).
3. Approvazione **legata alla versione**: approve/request-changes ricevono `versionNumber` e falliscono se non è la versione corrente (il cliente approva esattamente ciò che vede).
4. Il token Metricool non lascia mai il server e non finisce nei log.
5. L'assistente AI **non approva mai da solo**: propone; serve sempre il clic del cliente.
6. Input validato con zod in ogni route/azione.

## Moduli e proprietari (un solo autore per file)

### Fase 1 — in parallelo

**A. core** — servizi di dominio, email, storage
- `lib/events.ts`: `recordEvent(tx|prisma, { postId, type, actor, versionNumber?, metadata? })`.
- `lib/actor.ts`: `type Actor = { kind: "user"; userId: string } | { kind: "reviewer"; reviewerId: string } | { kind: "system" }`.
- `lib/posts.ts` (tutte le funzioni lanciano `InvalidTransitionError` / `NotFoundError` / `ForbiddenError` esportate da `lib/errors.ts`):
  - `createPost(workspaceId, input: PostInput, actor)` → crea Post + PostVersion 1, evento CREATED.
  - `updatePost(postId, workspaceId, input: Partial<PostInput> & { changeNote?: string }, actor)` → se il post è già stato inviato almeno una volta (`submittedAt != null`) e cambia il contenuto (text, firstCommentText, media), crea una nuova `PostVersion` (number+1, evento VERSION_CREATED); altrimenti aggiorna la versione corrente. Applica la transizione `edit`.
  - `submitForReview(postIds: string[], workspaceId, actor, opts?: { reviewDueAt?: Date })` → per ciascuno transizione `submit`, `submittedAt`, evento; poi **una sola email per reviewer** con l'elenco dei post (`notifyReviewRequested`).
  - `approvePost(postId, reviewer: { id; clientId }, versionNumber)` → APPROVED, `approvedAt`, `approvedByReviewerId`, evento; se `client.autoSchedule` chiama `requestScheduling(postId, actor)` da `lib/scheduling.ts`; `notifyApproved`.
  - `requestChanges(postId, reviewer, versionNumber, message, opts?: { reviewSessionId?: string })` → CHANGES_REQUESTED + `PostComment` CLIENT con il messaggio, evento (metadata con reviewSessionId), `notifyChangesRequested`.
  - `cancelPost(postId, workspaceId, actor)`.
  - `addComment({ postId, actor, body, versionId?, mediaIndex?, pinX?, pinY? })`, `resolveComment(commentId, workspaceId)`.
  - `getPostForWorkspace(postId, workspaceId)` (include client, versions desc, comments, events, reviewSessions+messages), `getPostForReviewer(postId, reviewer)`, `listPostsForReviewer(reviewer)`.
  - `PostInput = { clientId, title, publishAt: Date, networks: Network[], networkOptions?: NetworkOptions, text, firstCommentText?, media: MediaItem[] }`.
- `lib/clients.ts`: CRUD clienti (workspace-scoped).
- `lib/reviewers.ts`: `createReviewer(clientId, workspaceId, { name, email })` → `{ reviewer, reviewUrl }` (salva `tokenHash` + `tokenEncrypted`); `rotateReviewerLink`; `getReviewUrl(reviewer)` (decifra); `deactivateReviewer`; `resolveReviewerToken(token)` → `(ClientReviewer & { client: Client }) | null` (attivo, cliente non archiviato; aggiorna `lastSeenAt` al massimo ogni 5 min).
- `lib/email.ts`: `sendEmail({ to, subject, html, text })` — SMTP se `EMAIL_SERVER` (nodemailer, come heili-dm), altrimenti Resend via `fetch` se `RESEND_API_KEY` reale, altrimenti log su console (dev). Non lancia mai.
- `lib/notifications.ts`: `notifyReviewRequested(postIds)`, `notifyReviewReminder(postId)`, `notifyChangesRequested(postId)`, `notifyApproved(postId)`, `notifyScheduled(postId)`, `notifyScheduleFailed(postId)`. Template HTML semplici in italiano. Al team dell'agenzia scrivono ai membri OWNER/ADMIN del workspace. Non lanciano mai.
- `lib/storage.ts` + `app/api/uploads/route.ts` (POST multipart, agenzia autenticata, immagini e video mp4/mov, max 300 MB → `MediaAsset` + `MediaItem`) + `app/media/[...key]/route.ts` (GET pubblico con Content-Type e supporto `Range` per i video). Chiave non indovinabile (`<workspaceId>/<generateToken()>.<ext>`). URL pubblico: `${getBaseUrl()}/media/<key>`.
- Test: `__tests__/posts.test.ts` sulle regole pure (versioning, transizioni), `__tests__/reviewers.test.ts` sull'hashing.

**B. metricool** — integrazione, programmazione, worker, cron
- `lib/metricool/client.ts`: `MetricoolClient({ userId, token })` con `listBrands()` (`GET /admin/simpleProfiles?userId=`), `schedulePost(blogId, payload)` (`POST /v2/scheduler/posts?blogId=&userId=`, header `X-Mc-Auth`), `testConnection()`. Base URL da `getMetricoolApiBase()`. Errori tipizzati (`MetricoolError` con `status`, `retryable`). `getWorkspaceMetricoolClient(workspaceId)` (decifra il token). **Modalità finta** se `METRICOOL_FAKE=1`: nessuna chiamata di rete, restituisce brand e id finti (serve per i test end-to-end).
- `lib/metricool/payload.ts` (puro): `buildSchedulerPayload({ post, version, client })` → body Metricool: `publicationDate { dateTime: "YYYY-MM-DDTHH:mm:ss" nel fuso del cliente, timezone }`, `text`, `firstCommentText`, `providers: [{ network }]`, `media: string[]`, `autoPublish: true`, `draft: false`, e per **ogni** rete selezionata il suo `<network>Data` (da `post.networkOptions`, `{}` se assente). Validazioni (Instagram richiede media, Reel richiede video, Bluesky ≤ 300 caratteri, ecc.) → `validateForNetworks(...)` che restituisce errori leggibili in italiano, usata anche dall'editor.
- `lib/scheduling.ts`: `requestScheduling(postId, actor)` (transizione `schedule` o `retry`, accoda job con `schedulePostJobId`), `processSchedulePost(job)` (corpo del worker: rifiuta se la versione non è quella approvata; chiama Metricool; SCHEDULED + `metricoolPostId` + evento + `notifyScheduled`, oppure al fallimento definitivo FAILED + `lastError` + evento + `notifyScheduleFailed`; errori non ritentabili → FAILED subito), `sweepApprovedPosts()` (riaccoda gli APPROVED con autoSchedule rimasti indietro).
- `worker/approval-worker.ts` (heartbeat con `lib/ops/worker-health.ts`, come heili-dm).
- `app/api/cron/reminders/route.ts` (solleciti per i post IN_REVIEW oltre `reviewDueAt` o fermi da 48 h, max 1 sollecito/24 h, usa `notifyReviewReminder` e un evento REMINDER_SENT), `app/api/cron/sweep/route.ts`; autorizzazione `Bearer CRON_SECRET|NEXTAUTH_SECRET` come heili-dm; aggiorna `scripts/cron.sh`.
- Test: `__tests__/metricool-payload.test.ts` (fuso orario incluso il cambio ora legale, networkData, validazioni).

**C. assistente AI di revisione**
- `lib/review-assistant/*`: conversazione guidata col cliente. Quando il feedback è vago ("mmh, non mi convince") fa **una domanda alla volta** per capire cosa (testo, immagine n°, tono, CTA, hashtag, orario…) finché il feedback è azionabile; quando il cliente è soddisfatto lo dice e suggerisce di approvare. Alla fine `finalizeSession` produce con structured outputs `{ verdict: "approve"|"changes"|"unclear", summary, actionItems: [{ area, mediaIndex?, request, priority }] }`. Ogni messaggio è salvato in `ReviewMessage` (con `inputMode` TEXT/VOICE). SDK `@anthropic-ai/sdk`, modello da `REVIEW_ASSISTANT_MODEL` (default `claude-opus-5-5`). `isAssistantEnabled()` = `ANTHROPIC_API_KEY` presente.
- API pubbliche (token): `app/api/review/[token]/assistant/route.ts` (POST messaggio → risposta) e `app/api/review/[token]/assistant/finalize/route.ts`.
- `components/review/assistant-panel.tsx` (client component) — props: `{ token: string; postId: string; versionNumber: number; onSubmitChanges(input: { message: string; reviewSessionId: string }): Promise<void>; onApprove(): Promise<void> }`. Chat + **dettatura vocale** (Web Speech API, `it-IT`, se disponibile) + pulsanti finali ("Invia le modifiche all'agenzia" / "Approva"). Il messaggio inviato all'agenzia è il riepilogo + elenco puntato delle azioni.
- `components/review/assistant-transcript.tsx` (sola lettura, per l'agenzia): riepilogo, azioni, trascrizione completa con orari.

**D. anteprime**
- `components/post-preview/*`: `PostPreview` — props `{ network: Network; format?: string; text: string; firstCommentText?: string | null; media: MediaItem[]; accountName: string; accountAvatarUrl?: string | null; publishAt?: Date | string; pins?: Array<{ id: string; mediaIndex: number; x: number; y: number; label: string }>; onMediaClick?: (p: { mediaIndex: number; x: number; y: number }) => void }`. Mockup realistici e sobri di: Instagram (feed singolo, carosello con frecce/indicatori, Reel 9:16, Story), Facebook post, LinkedIn post, TikTok, X/Threads/Bluesky (testo), generico per le altre. Testo con "altro…" troncato come sulla rete, hashtag evidenziati, video con `<video controls playsInline>`. Pin numerati sovrapposti al media; clic sul media → coordinate relative 0..1.
- `components/post-preview/network-tabs.tsx`: `NetworkPreviewTabs` — stesse props ma con `networks: Network[]` e `networkOptions`, una scheda per rete.

### Fase 2 — in parallelo (dopo la fase 1)

**E. agenzia: post** — `app/(dashboard)/dashboard`, `posts` (elenco con filtri per stato/cliente, `?status=attention` = CHANGES_REQUESTED+FAILED), `posts/new`, `posts/[id]` (editor, caricamento media, opzioni per rete, validazioni, anteprima, versioni, commenti con risposta/risolvi, timeline eventi, trascrizioni dell'assistente, azioni Invia in revisione / Programma ora / Riprova / Annulla), `calendar` (mese/settimana per cliente), invio multiplo in revisione. Server actions in file `actions.ts` accanto alle pagine.

**F. agenzia: clienti e impostazioni** — `app/(dashboard)/clients` (elenco, nuovo, dettaglio: dati, scelta brand Metricool da `listBrands()`, reti, fuso orario, autoSchedule, reviewer con copia link / nuovo link / disattiva / reinvia), `app/(dashboard)/settings` (connessione Metricool: userId + token, prova connessione; team e inviti riusando `app/api/workspace/members` di heili-dm).

**G. portale cliente** — `app/review/[token]/layout.tsx` (senza shell agenzia, intestazione con nome cliente), `page.tsx` (post da rivedere, raggruppati per stato, con data di pubblicazione), `posts/[postId]/page.tsx` (anteprima per rete, versioni con "cosa è cambiato", commenti con pin sull'immagine, Approva / Chiedi modifiche, pannello assistente AI se abilitato), API o server actions per approve/request-changes/comment che usano i servizi del modulo A. Mobile first: i clienti aprono il link dal telefono.

### Fase 3 — integrazione
Build, lint, typecheck, test, `scripts/seed.ts`, avvio con `METRICOOL_FAKE=1`, test end-to-end con Playwright del flusso completo, `README.md` e `.env.example`.

## Regole per gli agenti di fase 1 e 2
- Scrivi **solo** i file del tuo modulo. Se ti serve qualcosa di un altro modulo, importalo con la firma qui sopra (se non esiste ancora, lo scriverà il suo proprietario).
- Non installare dipendenze, non toccare `package.json`, `prisma/schema.prisma`, `lib/domain.ts`. Se serve una modifica, segnalala nel resoconto finale.
- Verifica con `npx tsc --noEmit --incremental false` (ignora gli errori nei file di altri moduli ancora in lavorazione), `npx eslint <tuoi file>`, `npx vitest run <tuoi test>`. **Non** lanciare `next build` / `next dev` (li lancia la fase 3).
- Non fare commit.
- DB locale: `postgresql://postgres@localhost:5432/approve`, Redis `localhost:6379`, `.env` già presente.
