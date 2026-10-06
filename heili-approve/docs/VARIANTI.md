# Varianti di Approve by Heili — contratto

Richiesta del titolare: **stessa base, funzionalità diverse**, varianti **a gestione interna** (nessuna integrazione Metricool):

| Variante (`APP_VARIANT`) | Prodotto | Contenuti (`Post.kind`) | Dopo l'approvazione |
|---|---|---|---|
| `social` (default) | Approve by Heili — Social | `SOCIAL_POST` | Metricool (esistente) |
| `blog` | Approve by Heili — Blog | `BLOG_ARTICLE` | interno: export + "Segna come pubblicato" → `DELIVERED` |
| `ads` | Approve by Heili — Ads | `AD_CREATIVE` | interno: pacchetto ZIP delle varianti approvate + "Segna come consegnato" → `DELIVERED` |
| `all` | tutto in un'app | tutti e tre | come sopra per tipo |

Ogni variante si pubblica come istanza separata (stessa immagine Docker, `APP_VARIANT` diverso, database proprio), es. `blog.heili.cloud`, `ads.heili.cloud`. Le correzioni alla base valgono per tutte.

Leggi anche `docs/CONTRATTO.md` (stack, sicurezza, regole) — vale tutto, salvo dove questo file lo estende.

## Già pronto (non riscrivere)

- `prisma/schema.prisma`: `enum ContentKind`, `Post.kind`, `PostStatus.DELIVERED`, `PostVersion.content` (JSON), `PostComment.anchor` (JSON) e `PostComment.variantId`, `model CreativeDecision` (decisione del cliente per variante, legata a `versionNumber`), eventi `DELIVERED` e `VARIANT_DECIDED`. Migrazione `20261006175434_content_kinds_blog_ads`.
- `lib/domain.ts`: azione `deliver` (APPROVED → DELIVERED), `KIND_CONFIG` (etichette, `internal`, testo dell'azione di consegna), `statusLabelFor(kind, status)`, `CONTENT_KINDS`.
- `lib/content/types.ts`: `BlogContent`, `BlogAnchor`, `AdContent`, `AdCampaign`, `AdVariant`, `AdPlacement`, `AdPlatform`, `VariantDecision`.
- Dipendenze installate: `marked` (Markdown→HTML), `sanitize-html` (HTML sicuro), `diff` (diff parola per parola), `jszip` (pacchetto ZIP).

## Regole comuni

1. **Nessuna integrazione esterna** per blog e ads: niente Metricool, niente code di programmazione. Per `KIND_CONFIG[kind].internal === true` l'approvazione porta ad `APPROVED`; poi l'agenzia esporta e usa `deliver`. Mai chiamare `requestScheduling` per questi tipi.
2. **La variante decide cosa si vede**: `lib/variant.ts` → `getAppVariant()`, `enabledKinds()`, `productName()` ("Approve by Heili — Blog"…), voci di menu. Nessuna pagina mostra un tipo non attivo; i servizi rifiutano di creare un tipo non attivo. Metricool (impostazioni, top bar "Collega Metricool", scelta brand nel cliente) si vede solo se `SOCIAL_POST` è attivo.
3. **Versioni e approvazione**: `PostVersion.content` è contenuto approvabile — cambiarlo dopo l'invio crea una nuova versione, come testo e media. Il cliente approva sempre la versione esatta che vede.
4. **HTML sicuro**: il Markdown degli articoli si rende solo con `marked` + `sanitize-html` (whitelist), mai `dangerouslySetInnerHTML` su testo non sanificato. Link esterni con `rel="noopener noreferrer"`.
5. **Ads, decisione per variante**: il cliente approva o scarta ogni variante (con nota obbligatoria se scarta). Il post diventa `APPROVED` solo quando ogni variante ha una decisione per la versione corrente e almeno una è `APPROVED`; se tutte sono scartate → `CHANGES_REQUESTED` con le note. Le varianti scartate restano visibili all'agenzia con la nota.
6. **Commenti ancorati**: blog → `anchor` (`BlogAnchor`, testo selezionato) ; ads → `variantId` + (`mediaIndex`, `pinX/pinY` | `timeSec/timeEndSec` per i video, riusando il lettore video con i marcatori). Social invariato.
7. **Assistente AI** per tipo: blog → chiede quale paragrafo/frase, tono, lunghezza, SEO; ads → quale variante, quale posizionamento, quale secondo del video, il copy o la CTA. Stessi limiti, stessa registrazione, stesso divieto di approvare da solo.
8. Interfaccia in italiano, colori Heili (token in `app/globals.css`), mobile first per il portale cliente.

## Moduli e proprietari

### Fase 1 (in parallelo)

**V1. base multi-variante** — `lib/variant.ts` (nuovo), `lib/posts.ts`, `lib/clients.ts`, `lib/notifications.ts`, `lib/scheduling.ts` (solo per escludere i tipi interni da sweep/solleciti dove serve), `lib/events.ts`, nuovo `lib/creative-decisions.ts`, `components/sidebar.tsx`, `components/top-bar.tsx`, `app/(dashboard)/layout.tsx`, `app/layout.tsx`/`app/manifest.ts`/`app/login` (nome prodotto per variante), test.
- `createPost/updatePost` accettano `kind` e `content` (validato con `parseBlogContent` / `parseAdContent` dai moduli V2/V3 — importali con questi nomi), rifiutano tipi non attivi; per blog/ads `networks` = [] e niente validazioni Metricool.
- `submitForReview`: per blog/ads valida con `validateBlogForReview` / `validateAdsForReview` (moduli V2/V3) invece di `validateForNetworks`.
- `approvePost`: per `AD_CREATIVE` rifiuta se le decisioni non sono complete (vedi regola 5); per tipi interni non chiama mai lo scheduling.
- `lib/creative-decisions.ts`: `decideVariant(postId, reviewer, versionNumber, { variantId, verdict, note })`, `listDecisions(postId, versionNumber)`, `finalizeCreativeReview(postId, reviewer, versionNumber)` → APPROVED o CHANGES_REQUESTED secondo la regola 5. Transazioni + controllo di stato come il resto.
- `deliverPost(postId, workspaceId, actor)` (azione `deliver`, solo tipi interni).
- `addComment` accetta `anchor` (validato) e `variantId` (deve esistere nella versione).
- Notifiche ed email: testi per tipo ("un nuovo articolo da approvare", "3 creatività da approvare").

**V2. blog** — `lib/content/blog.ts`, `components/blog/*`, `app/api/export/blog/[postId]/route.ts`, test.
- `blogContentSchema` (zod), `parseBlogContent(json)`, `emptyBlogContent()`, `validateBlogForReview(content)` → errori in italiano (titolo, corpo minimo, meta description 50–160, slug valido…), `seoChecks(content)` → lista di controlli con esito (keyword nel titolo/primo paragrafo/meta, lunghezze, immagine con alt, link interni/esterni, H2 presenti, leggibilità semplice: frasi lunghe), `readingTime`, `wordCount`, `slugify`, `renderMarkdownSafe(md)` → HTML sanificato con blocchi top-level marcati `data-block="n"`, `diffWords(a, b)` (pacchetto `diff`), `findAnchor(html|text, anchor)` per ri-ancorare i commenti tra versioni.
- Componenti: `BlogEditor` (editor Markdown con barra: titoli, grassetto, corsivo, elenco, link, citazione, immagine da upload; anteprima affiancata; contatori; pannello SEO con i controlli; campi meta; immagine in evidenza; categorie/tag), `BlogArticlePreview` (resa "come sul sito": immagine, titolo, autore, data, tempo di lettura, corpo), `BlogReader` per la revisione: selezionando del testo compare "Commenta questa frase" → callback con `BlogAnchor`; evidenziazione dei passaggi commentati con numerino; clic → apre il commento), `BlogVersionDiff` (parole aggiunte/tolte tra due versioni, anche per i campi SEO), `SeoPanel`.
- Export: `GET /api/export/blog/<postId>?format=md|html` (agenzia autenticata, workspace-scoped, solo versione approvata o corrente con avviso), scarica Markdown con front-matter (title, slug, meta, tag) o HTML pulito pronto da incollare in WordPress.

**V3. ads** — `lib/content/ads.ts`, `components/ads/*`, `app/api/export/ads/[postId]/route.ts`, test.
- `adContentSchema`, `parseAdContent`, `emptyAdContent()`, `newVariant(index)`, `validateAdsForReview(content)` e `adSpecChecks(variant)` → per posizionamento: rapporto d'aspetto del media (dalle dimensioni note: `MediaAsset.width/height` o `MediaItem` con `width/height` se presenti — altrimenti avviso "da verificare"), durata video (Reels ≤ 90 s, TikTok 5–60 s consigliati), limiti di testo (Meta: testo principale 125 consigliati, titolo 40, descrizione 30; Google: titolo breve 30, descrizione 90; LinkedIn: introduzione 150, titolo 70), CTA presente, URL valido https. Esiti: ok / avviso / errore, in italiano.
- Componenti: `AdSetEditor` (dati campagna; lista varianti A/B/C… con duplica/rimuovi/riordina; per variante: media con upload riusando /api/uploads, copy, CTA con suggerimenti per piattaforma, URL, posizionamenti; controlli specifiche in tempo reale), `AdPreview` per posizionamento (mockup sobri e realistici: feed Meta con "Sponsorizzato" e pulsante CTA, Stories/Reels 9:16 con **zone di sicurezza** attivabili, TikTok in-feed, Google display 1.91:1 e 1:1, LinkedIn), riusando `components/post-preview/video-player.tsx` per i video con marcatori e "Commenta a m:ss", `AdVariantReview` (scheda variante per il cliente: anteprime per posizionamento, commenti con pin/timecode, pulsanti "Approva variante" / "Scarta" con nota), `AdVariantCompare` (varianti affiancate per confrontarle).
- Export: `GET /api/export/ads/<postId>` → ZIP con i file delle **varianti approvate** rinominati `<cliente>_<campagna>_<variante>_<posizionamento>.<ext>` + `copy.csv` (variante, testo principale, titolo, descrizione, CTA, URL, posizionamenti) + `README.txt` con le decisioni e le note del cliente.

### Fase 2 (in parallelo, dopo la fase 1)

**V4. pannello agenzia** — pagine sotto `app/(dashboard)` e `components/posts/*`: dashboard ed elenco con filtro per tipo (solo i tipi attivi), "Nuovo" che chiede il tipo se ce n'è più d'uno, editor e scheda per tipo (blog: `BlogEditor`, diff, commenti ancorati, export, "Segna come pubblicato"; ads: `AdSetEditor`, decisioni per variante con note, confronto, export ZIP, "Segna come consegnato"), calendario con icona per tipo; le parti Metricool nascoste quando il social non è attivo.

**V5. portale cliente + assistente** — `app/review/[token]/**`, `components/portal/*`, `lib/review-assistant/*`: elenco con il tipo di ogni contenuto; pagina articolo (lettura comoda su telefono, commenti su frase selezionata, "cosa è cambiato" parola per parola, Approva / Chiedi modifiche); pagina ads (una scheda per variante, decisione per variante, poi "Invia le mie decisioni"); assistente con prompt e domande per tipo (vedi regola 7) e `actionItems` con `variantId` / `anchor` quando servono.

### Fase 3 — integrazione
Build, lint, typecheck, test, seed con esempi di articolo e set ads per un workspace `APP_VARIANT=all`, e2e Playwright per blog e ads (oltre a quelli social esistenti, che devono restare verdi), screenshot in `docs/screenshots/blog-*` e `docs/screenshots/ads-*`, README con le tre varianti e i compose di produzione per `blog.heili.cloud` e `ads.heili.cloud` (stessa immagine, `APP_VARIANT` diverso).
