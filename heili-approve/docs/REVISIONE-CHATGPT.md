# Approve by Heili: scheda per la revisione esterna

Documento per chi rivede l'app dall'esterno (per esempio ChatGPT). Spiega cos'è, come è fatta, dove guardare
e cosa ci interessa migliorare. Le regole tecniche complete sono in `docs/CONTRATTO.md`, `docs/VARIANTI.md` e
`README.md`.

## Che cos'è

Una piattaforma per agenzie di marketing (InsidersLab / 3Runes, ecosistema "Heili") in cui **i clienti
rivedono e approvano i contenuti** preparati dall'agenzia:

- **post social** (foto, caroselli, video e Reel): una volta approvati vengono **programmati in automatico su
  Metricool**;
- **articoli di blog**: commenti sulla frase selezionata, controlli SEO, export Markdown/HTML;
- **creatività ads** (Meta, TikTok, LinkedIn, Google Ads Display / Ricerca / Performance Max): decisione per
  variante, titoli, descrizioni e parole chiave, pacchetto ZIP e CSV per Google Ads Editor;
- **piano del mese**: tutti i post social di un mese di un cliente inviati insieme, con griglia Instagram e
  «Approva tutto il piano».

Il cliente **non ha password**: apre un link personale (`/review/<token>`) da telefono, vede le anteprime
come appariranno davvero, commenta (anche toccando un punto dell'immagine o un secondo del video), e approva
o chiede modifiche. Un **assistente AI** (OpenAI) fa domande al cliente quando un commento è vago ("non mi
piace" → "cosa esattamente? il testo, la foto, il colore?") e registra tutto. L'approvazione vale sempre per
la **versione esatta** che il cliente ha visto.

Online su `https://approve.heili.cloud` (VPS Hostinger, Docker, dietro Caddy).

## Stack

- Next.js 16 (App Router, `proxy.ts` al posto del middleware, React 19, React Compiler), TypeScript.
- Prisma 7 + PostgreSQL 16 (`@prisma/adapter-pg`), client generato in `app/generated/prisma`.
- Auth.js (NextAuth v5) con magic link via Resend, solo per il team dell'agenzia.
- BullMQ + Redis: worker `worker/approval-worker.ts` (programmazione Metricool, email), cron `scripts/cron.sh`.
- Tailwind 4 con i token del design system Heili (`app/globals.css`: classi `.panel`, `.inset`, `.btn*`,
  `.field`, `.chip*`, `.label-caps`).
- Test: Vitest (574 test, `__tests__/`) e Playwright end-to-end (37 test, `e2e/`).
- Una sola immagine Docker; `APP_VARIANT=all` in produzione (social + blog + ads in un'unica app).

## Mappa del codice

| Area | Dove |
|---|---|
| Modello dati | `prisma/schema.prisma`, `prisma/migrations/` |
| Regole di dominio (stati, transizioni, etichette) | `lib/domain.ts`, `lib/variant.ts` |
| Servizi contenuti (crea, invia, approva, commenti, versioni) | `lib/posts.ts` |
| Piano del mese | `lib/plans.ts`, `lib/plan-rules.ts`, `app/(dashboard)/plans/`, `app/review/[token]/piani/`, `components/plans/`, `components/portal/plan-review.tsx` |
| Referenti e link del cliente | `lib/reviewers.ts`, `components/share/`, `components/clients/` |
| Cliente attivo nel menu | `lib/current-client.ts`, `components/client-switcher.tsx`, `components/sidebar.tsx` |
| Metricool | `lib/metricool/`, `lib/scheduling.ts`, `worker/` |
| Assistente AI di revisione | `lib/review-assistant/` |
| Notifiche email | `lib/notifications.ts`, `lib/email.ts` |
| Blog | `lib/content/blog.ts`, `components/blog/` |
| Ads e Google Ads | `lib/content/ads.ts`, `lib/content/google-ads.ts`, `components/ads/` |
| **Anteprime dei post** (feed, Reel/Storie, video con marcatori) | `components/post-preview/` |
| **Revisione del post lato cliente** | `app/review/[token]/posts/[postId]/page.tsx`, `components/portal/post-review.tsx`, `components/portal/comment-*.tsx`, `components/portal/bottom-sheet.tsx` |
| **Scheda del post lato agenzia** | `app/(dashboard)/posts/[id]/page.tsx`, `components/posts/` |
| Portale cliente (home, schede per tipo) | `app/review/[token]/page.tsx`, `components/portal/` |
| Pannello agenzia | `app/(dashboard)/` |
| Schermate attuali | `docs/screenshots/` |

## Cosa ci interessa dalla revisione

Il titolare è contento dell'insieme ("molto pratica, veloce"). Il punto che vuole migliorare per primo:

1. **La visualizzazione del post**, soprattutto **da telefono**: sia la pagina in cui il cliente rivede un
   post (`components/portal/post-review.tsx` + `components/post-preview/*`) sia la scheda del post
   nell'agenzia. Guardare: gerarchia delle informazioni, quanto spazio prende l'anteprima rispetto a testo e
   commenti, posizione dei pulsanti Approva / Chiedi modifiche, passaggio tra reti (Instagram, Facebook,
   LinkedIn…), caroselli, Reel e commenti al secondo del video, lunghezza della pagina, leggibilità della
   didascalia, chiarezza di cosa deve fare il cliente.
2. **UX e interfaccia in generale** (agenzia e portale cliente), coerenza con il design system Heili
   (principi: calma e verificabile, colore che significa qualcosa, stati sempre con parola, niente
   gradienti/emoji, mobile first, testo nei campi a 16 px, area toccabile 44 px).
3. **Bug e casi limite** nei flussi principali: invio, approvazione per versione, modifiche richieste,
   piano del mese, «Approva tutto», programmazione Metricool, link del cliente.
4. **Sicurezza**: accesso con token nel portale, isolamento tra workspace e tra clienti, upload, export,
   HTML degli articoli, azioni server.
5. **Qualità del codice e prestazioni**: duplicazioni, componenti troppo grandi, query N+1, cose da
   semplificare.

## Limiti noti (già sappiamo)

- La conferma «Programmato» parte per ogni singolo post (con un piano da 12 post = 12 email); anche i
  promemoria sono per post.
- Non c'è ancora «Togli dal piano»; il commento sul piano non ha risposta dall'agenzia.
- I limiti di Google Ads (numero e lunghezza di titoli, descrizioni, formati) sono da verificare con le
  regole attuali di Google.
- Dockerfile su `node:20-slim` mentre alcune dipendenze chiedono Node 22 (solo avvisi).
- Le pagine del portale sono larghe al massimo ~740 px: su desktop alcune colonne sono strette.

## Come avviarla in locale (se serve)

Vedi `README.md`, sezione «Avvio in locale»: Postgres e Redis, `cp .env.example .env`,
`npx prisma migrate deploy`, `npm run db:seed` (crea clienti e contenuti di esempio e stampa i link del
portale), `npm run dev`. Login di sviluppo: cookie `authjs.session-token=dev-session-stefano-insiderslab-0000000001`
(solo con il database di seed).
