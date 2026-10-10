# Approve by Heili

Piattaforma per far **rivedere e approvare ai clienti i post social** preparati
dall'agenzia. Quando il cliente approva, il post viene **programmato in automatico
su Metricool**.

**Importazione con Codex o Claude:** [guida Excel/CSV/JSON](docs/AGENT-IMPORT.md),
[contratto API](docs/AUTOMATION-API.md) e [modello CSV apribile in Excel](docs/templates/approve-posts.csv).
Le chiavi personali si creano in Impostazioni; l'importatore crea bozze con controllo preventivo e protezione dai duplicati.

- L'agenzia (InsidersLab) prepara i post nel pannello: testo, immagini, video e
  Reel, reti, data e ora.
- Il cliente riceve un **link personale** (niente password) e apre il post dal
  telefono. Vede l'anteprima com'è sulla rete. Può commentare un punto
  dell'immagine o un momento del video ("al secondo 0:07…"), poi **approva**
  oppure **chiede modifiche**.
- Ogni modifica dopo l'invio crea una **nuova versione**. Il cliente vede "cosa è
  cambiato" e approva sempre esattamente la versione che ha davanti.
- Dopo l'approvazione un worker invia il post a Metricool con il fuso orario del
  cliente, la copertina del Reel, il primo commento e le opzioni di ogni rete.
- Facoltativo: un **assistente AI** aiuta il cliente indeciso ("mmh, non mi
  convince") a trasformare l'impressione in richieste precise per l'agenzia.

La stessa piattaforma gestisce anche **articoli di blog** e **creatività ads**
(internamente, senza Metricool), **organizzati per cliente**: ogni cliente ha i
suoi servizi e un solo portale con tutto quello che deve approvare. Vedi
[Servizi per cliente](#servizi-per-cliente).

Usa la stessa tecnologia di **DM by Heili**: Next.js 16, Prisma 7 e Postgres 16,
NextAuth con link via email, BullMQ e Redis, Tailwind 4, Docker.

---

## Il flusso

```
Agenzia                         Cliente (link personale)          Sistema
───────                         ────────────────────────          ───────
Bozza ──"Invia in revisione"──▶ email "Nuovo post da approvare"
                                apre /review/<token> dal telefono
                                ├─ commento (pin su immagine,
                                │  momento del video, generale)
                                ├─ "Chiedi modifiche" ──────────▶ email all'agenzia
Modifica → versione 2 ◀─────────┘
"Invia in revisione" ─────────▶ vede "Cosa è cambiato"
                                └─ "Approva" (versione esatta) ─▶ coda BullMQ
                                                                  worker → Metricool
                                                                  SCHEDULED + ID Metricool
                                                                  email "programmato"
```

Stati del post: `Bozza → In revisione → (Modifiche richieste ↺) → Approvato →
In programmazione → Programmato`. Ci sono anche `Errore` (Metricool ha rifiutato
il post: si corregge e si usa "Riprova") e `Annullato`.

- **Il cliente non vede mai le bozze** né i post annullati. Se apre il post di un
  altro cliente, o un post che non esiste, riceve un 404.
- **L'approvazione vale per una versione.** Se l'agenzia cambia qualcosa mentre il
  cliente guarda, l'approvazione viene rifiutata e il cliente vede "ricarica".
- **Cambiare un post già approvato** (contenuto, data o reti) lo riporta in Bozza:
  il cliente dovrà approvarlo di nuovo.
- **Solleciti automatici** per i post fermi in revisione: escono dalle 8 alle 20
  nel fuso del cliente, al massimo uno ogni 24 ore e tre per invio.

### Video e Reel

- Il lettore ha controlli propri: ±1 secondo, fotogramma per fotogramma, velocità
  0,5×. Il pulsante grande **"Commenta a 0:07"** mette in pausa e apre il commento
  con quel momento già impostato. Si può indicare un intervallo con "fino a…" e
  mettere un pin sul fotogramma.
- L'agenzia vede i commenti come **marcatori sulla barra del video** e nella lista
  **"Note sul video"**. Toccando un marcatore il video salta a quel momento.
- Nell'editor si sceglie la **copertina del Reel** da un fotogramma. Viene
  inviata a Metricool come `videoCoverMilliseconds`. Cambiare la copertina crea
  una nuova versione.

## Servizi per cliente

Una sola piattaforma su **`approve.heili.cloud`** (una sola istanza, un solo
database) con **`APP_VARIANT=all`**: post social, articoli e creatività convivono
e si organizzano **per cliente**.

| Servizio | Cosa si approva | Dopo l'approvazione |
|---|---|---|
| **Post social** | testo, foto, video, Reel, per rete | il worker programma su **Metricool** |
| **Articoli** | articoli in Markdown, con immagine in evidenza e campi SEO | export **Markdown** o **HTML per WordPress**, poi «Segna come pubblicato» |
| **Creatività** | set di creatività con varianti A/B/C (foto o video, testi, CTA, URL, posizionamenti) | **pacchetto ZIP** delle varianti approvate, poi «Segna come consegnato» |

- **Servizi del cliente.** Nella scheda del cliente (nuovo o modifica) si
  spuntano i **Servizi**: almeno uno. Brand Metricool, reti social e
  programmazione automatica compaiono solo se è spuntato *Post social*. I
  clienti già esistenti sono stati configurati dalla migrazione
  `client_services`: i tipi di contenuto che avevano già, più *Post social* se
  avevano reti o un brand Metricool (mai vuoto: *Post social*).
- **Scheda cliente.** Un riquadro per servizio con i numeri *Da approvare*,
  *Modifiche richieste*, *Approvati* e *Programmati* / *Pubblicati* /
  *Consegnati* (ognuno apre l'elenco filtrato), più bozze ed errori di
  programmazione, e il pulsante «Nuovo post» / «Nuovo articolo» / «Nuova
  creatività».
- **Nuovo contenuto.** Si sceglie prima il cliente, poi solo i suoi servizi (se
  ne ha uno solo si va diretti all'editor). Con il tipo già scelto, l'elenco dei
  clienti mostra solo quelli con quel servizio. Il server rifiuta comunque di
  creare un tipo non attivo: «Il servizio «Articoli» non è attivo per questo
  cliente».
- **Togliere un servizio** non cancella nulla: i contenuti già creati restano
  visibili e modificabili, per l'agenzia e per il cliente; non se ne possono
  creare di nuovi.
- **Portale del cliente unificato.** Un solo link per referente. In alto il nome
  del cliente e una riga come «I tuoi contenuti da approvare: post social,
  articoli e creatività». Se il cliente ha più di un servizio, i pulsanti
  **Tutti · Post social · Articoli · Creatività** (solo i suoi) filtrano
  l'elenco, ognuno con il numero di contenuti che aspettano la sua risposta;
  la sezione *Da approvare* viene sempre prima, con tutti i tipi insieme. Le
  pagine dei singoli contenuti sono quelle di ogni tipo.
- **Email.** Una sola email per referente anche quando l'invio mescola i tipi:
  «2 post social e 1 articolo da approvare per Le Querce».

Le regole di versione e di approvazione sono le stesse per tutti i tipi.

### Blog

- **Agenzia:** editor Markdown con barra (titoli, grassetto, elenchi, link,
  citazioni, immagini caricate), anteprima «come sul sito», contatori, slug,
  meta title e meta description, parola chiave, categorie e tag, e un pannello
  di **controlli SEO** (parola chiave nel titolo e nel primo paragrafo,
  lunghezze, alt dell'immagine, link, H2, frasi lunghe, leggibilità).
- **Cliente (dal telefono):** legge l'articolo, **seleziona una frase** e tocca
  «Commenta questa frase»; i passaggi commentati restano evidenziati e numerati,
  anche se il testo cambia leggermente nella versione successiva. Alla nuova
  versione vede **le parole aggiunte e tolte** e approva o chiede modifiche.
- **Export:** `GET /api/export/blog/<id>?format=md|html` (pulsanti nella scheda).
  Markdown con front matter (titolo, slug, data, meta, tag, immagine) oppure HTML
  pulito da incollare in WordPress. Entrambi sono **sanificati** come la pagina
  vista dal cliente (niente script, attributi `on…`, link `javascript:`; link
  esterni con `rel="noopener noreferrer"`). Prima dell'approvazione il file è
  segnato «non approvato».

### Ads

- **Agenzia:** dati della campagna (piattaforma Meta, Google, TikTok, LinkedIn,
  obiettivo, budget, pubblico) e varianti con media, testi, CTA e posizionamenti.
  Anteprime sobrie per posizionamento (feed, Storie/Reels 9:16 con **zone di
  sicurezza**, TikTok, Google display, LinkedIn) e **controlli delle specifiche**
  in tempo reale (rapporto d'aspetto, risoluzione, durata, limiti di testo, CTA,
  URL https).
- **Cliente:** una scheda per variante: **«Approva variante» o «Scarta»** (la nota
  è obbligatoria), commenti con pin sull'immagine o al **momento del video**,
  confronto affiancato, poi **«Invia le mie decisioni»**. Il set diventa
  *Approvato* se almeno una variante è approvata; se sono tutte scartate torna
  all'agenzia come *Modifiche richieste* con le note.
- **Pacchetto:** `GET /api/export/ads/<id>` → ZIP con **solo i file delle varianti
  approvate**, rinominati `<cliente>_<campagna>_<variante>_<posizionamenti>.<ext>`,
  `copy.csv` (separatore `;` per Excel in italiano) e `README.txt` con tutte le
  decisioni e le note del cliente, anche delle varianti scartate.
- **Google Ads:** oltre al Display, i posizionamenti **Ricerca** (annuncio
  adattivo: 3–15 titoli da 30 caratteri, 2–4 descrizioni da 90, percorsi URL) e
  **Performance Max** (titoli, titoli lunghi, descrizioni, nome attività,
  immagini 1,91:1 / 1:1 / 4:5, loghi, video facoltativo). Sezione «Google Ads:
  titoli, descrizioni e parole chiave» con contatori, **parole chiave** con
  corrispondenza generica / "a frase" / [esatta] (anche incollate una per riga) e
  parole escluse. Anteprime Ricerca, Display, YouTube, Gmail e Discover; il
  cliente commenta il singolo titolo o la singola parola chiave. Nel pacchetto
  anche `google-ads-rsa.csv`, `google-ads-keywords.csv` e
  `google-ads-pmax-assets.csv`, da importare in Google Ads Editor.

### Cliente attivo e link per il cliente

- **Cliente attivo:** nel menu principale si sceglie il cliente su cui si lavora;
  dashboard, elenchi, calendario e «Nuovo contenuto» mostrano solo lui («Tutti i
  clienti» per vedere tutto). La scelta resta per persona e per workspace.
- **Link per il cliente:** in cima alla scheda cliente c'è il link personale di
  ogni referente con «Copia link», «Invia su WhatsApp», «Condividi» (telefono),
  anteprima e QR. L'**email è facoltativa**: un referente si crea anche solo con
  il nome e riceve il link da chi gestisce il cliente. Su ogni contenuto in
  revisione, «Condividi con il cliente» dà il link diretto a quel contenuto.

### Piano del mese

Per i clienti con i **post social** l'agenzia presenta il **piano mensile**
tutto insieme («Piano social ottobre 2026»), invece di mandare i post uno alla
volta.

- **Agenzia — «Piani» nel menu** (solo con i post social attivi): elenco per
  cliente e mese (rispetta il cliente scelto nel menu) con stato, avanzamento
  «8 di 12 approvati», data di invio e scadenza. «Apri il piano del mese» crea il
  piano di un cliente per un mese, oppure apre quello che c'è già (uno per
  cliente e mese). Ci si arriva anche dal **calendario** («Prepara il piano di
  ottobre» / «Piano di ottobre» con il cliente scelto), dall'elenco dei post
  filtrato per cliente e dalla scheda cliente («Piani»).
- **Pagina del piano:** calendario del mese con le miniature, **griglia del
  profilo Instagram** (tre colonne, dal post più recente) per vedere la
  coerenza visiva, elenco dei post con il loro stato, messaggio per il cliente
  (strategia, note del mese), scadenza e **«Invia il piano al cliente»**: tutte
  le bozze e i post con modifiche richieste partono insieme (stessi controlli
  dell'invio singolo) e ogni referente riceve **una sola email** per tutto il
  piano, con il link alla pagina del piano. Poi compare il **link del piano**
  con «Invia su WhatsApp» («Ciao Chiara, ecco il piano social di ottobre per
  Agriturismo Le Querce: 12 post da rivedere. …»). I post del mese creati dopo
  l'apertura del piano si aggiungono con «Aggiungi al piano» (o entrano da soli
  al prossimo invio).
- **Cliente — `/review/<token>/piani/<id>`:** «Piano social di ottobre», il
  messaggio dell'agenzia, «3 di 12 approvati», la griglia Instagram e i post in
  ordine di calendario; ogni post apre la solita pagina di revisione, che per i
  post di un piano ha «Post precedente / successivo» e «Torna al piano».
  **«Approva tutto il piano»** approva in un passaggio tutti i post che
  aspettano il cliente, ognuno nella versione mostrata (stesse regole e stessa
  programmazione su Metricool dell'approvazione singola); i post con un
  commento aperto o con modifiche richieste restano fuori e sono elencati nella
  conferma. C'è anche un «Commento sul piano» generale. La home del portale
  mette in evidenza il piano da rivedere.
- **Cliente — vista del mese (`?vista=panoramica|griglia|sfoglia`):** sulla
  pagina del piano un selettore «Panoramica · Griglia · Sfoglia» (lo stato è
  nell'URL; su telefono c'è anche «Rivedi in modalità veloce»). **Griglia**: tutti
  i post del mese nella griglia a tre colonne, dal più recente, con il chip di
  stato e l'icona di video/carosello; un tocco apre il post (con «Torna alla
  griglia»). **Sfoglia**: una scheda per post con la vera anteprima, data, reti e
  due pulsanti, **Approva** (stessa azione e stesse regole del post singolo:
  versione mostrata, Metricool) e **Commenta** (apre la pagina del post con
  `?da=sfoglia&i=3`, e «Torna a Sfoglia» riporta alla stessa scheda); dopo
  ogni approvazione compare il prossimo post ancora da decidere. Scorrimento a
  dito, frecce a schermo e ← → da tastiera; barra «8 di 12 approvati»; in fondo
  il riepilogo («10 approvati, 2 con commenti») con **«Approva i rimanenti»** (la
  stessa «Approva tutto il piano»: restano fuori i post con commenti o modifiche
  richieste, che si decidono dalla loro pagina). Un post con commenti già lasciati
  mostra «Decidi dal post» invece di «Approva».
- **Mese senza piano — `/review/<token>/mese/<YYYY-MM>`:** con almeno due post
  social in attesa nello stesso mese (fuso del cliente) e fuori da un piano, la
  home del portale offre «Rivedi tutto <mese> insieme». La pagina ha Griglia e
  Sfoglia sugli stessi componenti; «Approva i rimanenti» usa le stesse esclusioni
  del piano. Solo i post visibili del cliente del link (mai bozze o annullati);
  un mese vuoto, di un altro cliente o malformato risponde 404.
- **Notifiche all'agenzia:** una email per «Approva tutto» (non una per post) e
  una sola, quando il cliente ha risposto su tutti i post inviati: «Piano di
  ottobre: 10 approvati, 2 con modifiche».
- **Regole:** il cliente vede solo i piani già inviati del suo cliente (gli
  altri rispondono 404) e mai le bozze. Il mese è salvato come `YYYY-MM` e vale
  nel **fuso del cliente** (un post alle 23:30 del 31 ottobre a Roma è di
  ottobre). Lo stato del piano (bozza, in revisione, modifiche richieste,
  approvato) si ricava dai suoi post. Migrazione `20261007130000_content_plans`
  (`ContentPlan`, `ContentPlanComment`, `Post.planId`).
- **Seed:** Caffè Aurora ha il piano del mese prossimo con sei post in
  revisione (chiave `plan` in `SEED_JSON`, link stampati dal seed).

### Istanze separate per tipo (facoltativo, avanzato)

La variabile **`APP_VARIANT`** (letta all'avvio; un valore sbagliato ferma il
server con un messaggio chiaro) limita un'istanza a un solo tipo:

| `APP_VARIANT` | Prodotto | Tipi |
|---|---|---|
| `all` | Approve by Heili | tutti e tre (**produzione**, default di `docker-compose.prod.yml`) |
| `social` | Approve by Heili | solo post social (default del codice se la variabile manca) |
| `blog` | Approve by Heili — Blog | solo articoli |
| `ads` | Approve by Heili — Ads | solo creatività |

Un'istanza a tipo singolo non mostra né accetta gli altri tipi (i servizi
rifiutano di crearli, i link rispondono 404) e, senza post social, non mostra
nulla di Metricool. I servizi dei clienti restano salvati: su un'istanza `blog`
la scheda cliente mostra solo il servizio *Articoli* e non tocca gli altri.

Non serve per l'uso normale. Se un giorno servisse un'istanza a parte (es. un
dominio dedicato solo agli articoli), lo stesso `docker-compose.prod.yml`
avvia uno **stack Docker separato** (database, Redis, media e porta propri) con
un suo file d'ambiente:

```
# .env.blog
COMPOSE_PROJECT_NAME=approve-blog
APP_VARIANT=blog
APP_PORT=3201
ENV_FILE=.env.blog
NEXTAUTH_URL=https://blog.heili.cloud
PUBLIC_BASE_URL=https://blog.heili.cloud
POSTGRES_PASSWORD=<nuova password>
DATABASE_URL=postgresql://postgres:<nuova password>@postgres:5432/approve
# + segreti nuovi (NEXTAUTH_SECRET, CRON_SECRET, ENCRYPTION_KEY), email…
```

```bash
docker compose --env-file .env.blog -f docker-compose.prod.yml up -d --build
curl -s http://127.0.0.1:3201/api/health
```

Ogni comando su quell'istanza va lanciato con il suo `--env-file` (anche `ps`,
`logs`, `exec`, `down`); poi un blocco Caddy `blog.heili.cloud { reverse_proxy
localhost:3201 }` e un record DNS. I dati di un'istanza separata non sono
condivisi con `approve.heili.cloud`.

---

## Avvio in locale

Prerequisiti: Node 24 (come l'immagine Docker), Postgres 16 e Redis 7. Per Postgres e Redis
basta `docker compose up -d` con il `docker-compose.yml` incluso.

```bash
cp .env.example .env        # poi metti i valori locali (vedi sotto)
npm ci
npx prisma migrate deploy   # crea le tabelle (oppure: npx prisma db push)
npm run db:seed             # dati demo + sessione di login + link dei clienti
npm run dev                 # http://localhost:3000
METRICOOL_FAKE=1 npm run worker   # in un altro terminale
```

Valori minimi del `.env` locale:

```
NEXTAUTH_URL=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/approve
REDIS_URL=redis://localhost:6379
METRICOOL_FAKE=1
UPLOAD_DIR=          # vuoto = ./uploads
APP_VARIANT=all      # come in produzione (social | blog | ads solo per istanze separate)
```

**Entrare senza email (solo sviluppo).**

- `npm run db:seed` stampa un cookie di sessione fisso. Nel browser su
  `localhost:3000`, apri DevTools → Application → Cookies e aggiungi
  `authjs.session-token` = `dev-session-stefano-insiderslab-0000000001`. Poi apri
  `/dashboard`.
- Il seed stampa anche i link di revisione dei clienti demo: Caffè Aurora
  (collegato al brand Metricool `123456`) e Studio Verde Architetti per il
  social, **Cantina Valdobbia** per il blog (un articolo in revisione e uno con
  un commento su una frase e la versione 2 pronta da reinviare) e **Palestra
  Kinetik** per gli ads (un set Meta con tre varianti: foto 1:1, foto 4:5 e un
  video 9:16 generato con `ffmpeg`), e **Agriturismo Le Querce** con **tutti e tre
  i servizi** e un contenuto per tipo in revisione: il suo link mostra il
  portale unificato con i pulsanti per tipo. Per vederli tutti avvia l'app con
  `APP_VARIANT=all`.
- Il seed si può rilanciare senza problemi: non duplica nulla. Si rifiuta di
  girare con `NODE_ENV=production`.

**Email in sviluppo.** Senza `EMAIL_SERVER` e con una chiave Resend finta, le
email (comprese quelle con i link per i clienti) vengono stampate nella console
del server.

**Metricool finto.** Con `METRICOOL_FAKE=1`:

- non parte nessuna chiamata di rete;
- i brand sono 10, `fake-1001`…`fake-1010`, nella forma dell'elenco reale di Metricool (con logo, reti, un nome con spazio finale e uno senza nome), per provare l'importazione offline;
- il worker stampa nel suo log il payload esatto che avrebbe inviato (`[Metricool fake] payload {...}`);
- un post con `[metricool:fail]` nel testo simula un rifiuto (422).

### Controlli

```bash
npx prisma generate
npx tsc --noEmit --incremental false
npm run lint
npx vitest run            # 574 test unitari
npm run build
```

### Test end-to-end (Playwright)

I test usano l'app vera, avviata con `APP_VARIANT=all`. Tra i file in `e2e/`:

- `approval-flow.spec.mjs` — social (sotto);
- `blog-flow.spec.mjs` — l'agenzia scrive un articolo (Markdown, immagine in
  evidenza, SEO) e lo invia; il cliente a 390 px seleziona una frase, la commenta
  e chiede modifiche; l'agenzia prepara la versione 2; il cliente vede le parole
  cambiate e approva; l'agenzia scarica Markdown e HTML (contenuto e
  sanificazione controllati) e lo segna come pubblicato;
- `ads-flow.spec.mjs` — set con tre varianti (una video); il cliente approva A,
  scarta B con una nota e un commento al secondo 0:03 del video, approva C e
  invia: *Approvato*; l'agenzia vede decisioni e note, scarica lo ZIP (solo i file
  di A e C, `copy.csv`, `README.txt`) e lo segna come consegnato. Un secondo set
  con tutte le varianti scartate torna a *Modifiche richieste*;
- `client-services.spec.mjs` — servizi per cliente: il portale di Agriturismo Le
  Querce (tre servizi) a 390 px mostra i pulsanti «Tutti · Post social · Articoli ·
  Creatività» con i conteggi e il filtro funziona; un cliente con un solo servizio
  non ha i pulsanti; la scheda cliente ha un riquadro per servizio; «Nuovo
  contenuto» propone solo i servizi del cliente; un nuovo cliente con il solo
  servizio *Articoli* nasconde Metricool; il servizio rifiuta di creare un tipo che
  il cliente non ha (`e2e/support/create-content.ts`);
- `monthly-plan.spec.mjs` — piano del mese: un cliente nuovo con quattro
  bozze il mese prossimo (una alle 23:30 dell'ultimo giorno); l'agenzia apre il
  piano dal calendario, controlla griglia e ordine, scrive il messaggio e lo
  invia; il cliente a 390 px apre il piano, commenta un post (navigazione del
  piano), «Approva tutto il piano» approva gli altri tre ed elenca quello
  commentato; il worker li programma; l'ultimo approvato da solo chiude il
  piano; il link di un altro cliente risponde 404;
- `month-review.spec.mjs` — vista del mese a 390 px: interruttore e «Rivedi in
  modalità veloce», Sfoglia (approva, commenta e ritorno alla stessa scheda,
  swipe, frecce, movimento ridotto, riepilogo e «Approva i rimanenti», worker
  che programma), Griglia con i chip di stato, il mese senza piano dalla home e
  i 404 (altro cliente, mese vuoto o malformato);
- `variant-gating.spec.mjs` — avvia un secondo server con `APP_VARIANT=blog`
  (porta `E2E_BLOG_PORT`, default 3101), controlla che il menu abbia solo
  «Articoli», che non ci sia Metricool e che una creatività ads non si possa
  aprire né creare, poi lo ferma.

Il test social copre tutto il flusso, in quest'ordine:

1. L'agenzia crea un post con un'immagine caricata.
2. Il cliente, su uno schermo da 390 px, mette un pin e chiede modifiche.
3. L'agenzia prepara la versione 2.
4. Il cliente vede "cosa è cambiato" e approva.
5. Il worker programma il post su Metricool finto.
6. Si controllano i casi di accesso negato: link sbagliato, bozza, post di un altro cliente, assistente nascosto senza chiave.
7. Un Reel: commento a 0:05, copertina e `videoCoverMilliseconds` nel payload.

```bash
npm run build
PORT=3000 METRICOOL_FAKE=1 APP_VARIANT=all npm run start &
METRICOOL_FAKE=1 APP_VARIANT=all npm run worker > /tmp/worker.log 2>&1 &
E2E_WORKER_LOG=/tmp/worker.log npm run test:e2e              # tutti
E2E_WORKER_LOG=/tmp/worker.log npm run test:e2e -- blog-flow # uno solo
```

- Playwright non è una dipendenza del progetto. `e2e/run.sh` usa l'installazione
  globale (`npm i -g playwright && npx playwright install chromium`).
- Gli screenshot finiscono in `docs/screenshots/` (`blog-*.png`, `ads-*.png`,
  `portale-unificato-mobile.png` e `agenzia-cliente-servizi.png`).
- Le immagini di prova `ad-square.png` (1:1) e `blog-featured.png` (16:9) sono
  generate con `ffmpeg -f lavfi -i testsrc2=s=1080x1080 -frames:v 1 ad-square.png`
  e `ffmpeg -f lavfi -i smptebars=s=1600x900 -frames:v 1 blog-featured.png`.
- Il video di prova `e2e/fixtures/reel-test.mp4` è codificato in VP9 dentro MP4.
  Il Chromium di Playwright non ha il codec H.264, mentre i telefoni veri sì.
  Per rigenerarlo:
  `ffmpeg -f lavfi -i testsrc=duration=12:size=540x960:rate=30 -pix_fmt yuv420p -c:v libvpx-vp9 -b:v 400k reel-test.mp4`.

---

## Deploy sul VPS Hostinger (accanto a DM by Heili)

L'app gira in Docker sullo stesso VPS di DM by Heili, con il suo Postgres, il suo
Redis e il suo volume per i media. Caddy, già presente, pubblica il dominio.

| Servizio | Cosa fa |
|---|---|
| `postgres` | database `approve` (volume `pgdata`) |
| `redis` | coda dei job verso Metricool (volume `redisdata`) |
| `web` | Next.js. All'avvio applica le migrazioni (`prisma migrate deploy`). Esposto solo su `127.0.0.1:3200` |
| `worker` | `npm run worker`: invia i post approvati a Metricool |
| `cron` | `scripts/cron.sh`: ogni 5 minuti `sweep` (riaccoda i post approvati rimasti indietro), ogni ora `reminders` |

`web` e `worker` montano lo stesso volume `uploads` su `/data/uploads` (`UPLOAD_DIR`).

### 1. DNS

Crea un record **A** per `approve.heili.cloud` verso l'IP del VPS (lo stesso di DM).

### 2. Codice e configurazione

```bash
ssh root@<vps>
git clone <repo> /opt/heili-approve && cd /opt/heili-approve/heili-approve
cp .env.example .env && nano .env
```

Nel `.env` di produzione:

- `NEXTAUTH_URL=https://approve.heili.cloud` e `PUBLIC_BASE_URL=https://approve.heili.cloud`
- `NEXTAUTH_SECRET`, `CRON_SECRET`, `ENCRYPTION_KEY`: segreti nuovi, generati con `openssl rand`
- `POSTGRES_PASSWORD`, la stessa password dentro `DATABASE_URL` (host `postgres`)
- `REDIS_URL=redis://redis:6379`
- `RESEND_API_KEY` (oppure `EMAIL_SERVER`) e `EMAIL_FROM`
- `ALLOWED_EMAILS`: le email del team che possono entrare
- `METRICOOL_FAKE=0`
- `APP_VARIANT=all` (oppure nessuna riga `APP_VARIANT`: il compose usa già `all`).
  Se il `.env` arriva da una versione precedente con `APP_VARIANT=social`,
  cambialo in `all`, altrimenti l'istanza resta solo social
- per l'assistente: `REVIEW_ASSISTANT_PROVIDER=openai`, `OPENAI_API_KEY`
  (la stessa chiave ChatGPT già usata sui server Heili) e `OPENAI_MODEL`

### 3. Avvio

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:3200/api/health      # {"status":"ok"}; i dettagli (database, redis, coda, worker)
                                              # solo con -H "Authorization: Bearer $CRON_SECRET"
```

### 4. Caddy

Aggiungi al `Caddyfile` del VPS, accanto al blocco di DM by Heili:

```caddy
approve.heili.cloud {
	encode zstd gzip
	# Video fino a 300 MB
	request_body {
		max_size 320MB
	}
	reverse_proxy localhost:3200
}
```

Poi `caddy reload` (oppure `docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile`).
Caddy ottiene da solo il certificato HTTPS.

Se Caddy gira in un container, `localhost` non è l'host. In quel caso usa
`reverse_proxy host.docker.internal:3200` (con `extra_hosts:
["host.docker.internal:host-gateway"]`), oppure metti i due compose sulla stessa
rete Docker e usa il nome del servizio.

### 5. Primo accesso

1. Apri `https://approve.heili.cloud/login` e inserisci la tua email.
2. Al primo login viene creato il workspace: rinominalo e invita il team da **Impostazioni**.
3. Collega Metricool (sezione successiva).
4. Crea i clienti, scegli i loro **servizi** (post social, articoli, creatività)
   e aggiungi i referenti: ognuno riceve un solo link con tutto quello che deve
   approvare.

### Aggiornamenti e backup

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build   # le migrazioni girano da sole
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U postgres approve > backup.sql
docker run --rm -v heili-approve_uploads:/data -v $PWD:/b alpine tar czf /b/uploads.tgz /data
```

Le nuove migrazioni si creano in sviluppo con `npx prisma migrate dev --name <nome>`.
Un database locale creato con `db push` va segnato una volta con
`npx prisma migrate resolve --applied 20261005000000_init`.

---

## Collegare Metricool

1. In Approve apri **Impostazioni → Metricool**: c'è una breve guida in tre passi.
   Su Metricool vai in **Impostazioni dell'account → API** (serve un piano che
   include le API): **token** e **ID utente** sono nella stessa pagina.
2. Incolla il token e l'ID utente (puoi incollare anche l'URL di Metricool: l'app
   tiene solo il numero) e premi **Collega e verifica**. Le credenziali vengono
   salvate **solo se** la chiamata di prova riesce; poi compare «Collegato: N brand
   trovati» con i primi loghi.
   - Il token viene salvato cifrato (AES-256-GCM con `ENCRYPTION_KEY`), non lascia
     mai il server e non viene mai mostrato di nuovo (solo le ultime 4 cifre).
   - Solo titolari e amministratori possono cambiarlo.
3. Premi **Importa i clienti da Metricool** (o **Clienti → Importa da Metricool**,
   pagina `/clients/import`). Ogni brand è una riga con logo, reti e fuso orario;
   per ciascuno scegli **Crea nuovo cliente**, **Collega a cliente esistente** o
   **Ignora**. Se il nome coincide con un cliente che hai già (senza badare a
   maiuscole, accenti e spazi) il collegamento è già proposto. I brand già
   collegati sono saltati, quindi si può rifare senza creare doppioni. Un cliente
   creato prende nome, logo, fuso e reti dal brand, con servizio *Post social* e
   programmazione automatica; un cliente esistente prende solo il brand e, se
   mancano, logo e reti (il suo fuso orario non cambia). Solo titolari e
   amministratori possono importare.
4. Poi, nella scheda di ogni cliente, aggiungi chi approva e copia il suo link.
   Un cliente si può collegare anche a mano: nella scheda, il **brand Metricool**
   si sceglie da un elenco con ricerca (logo, nome, reti); in un cliente nuovo,
   scrivendo il nome compare «Trovato su Metricool» e il brand è già scelto.
5. Con **"Programma automaticamente dopo l'approvazione"** attivo, un post approvato parte subito verso
   Metricool. Se è disattivata, resta "Approvato" finché l'agenzia non preme
   **Programma ora**.

Metricool scarica le immagini e i video da `PUBLIC_BASE_URL/media/...`, quindi in
produzione l'indirizzo deve essere pubblico e in HTTPS.

Il worker ritenta da solo gli errori temporanei: timeout, 429, 5xx. Se Metricool
rifiuta il post, per esempio un Reel senza video o una data passata, il post va
in **Errore** con il messaggio in italiano. Si corregge e si preme **Riprova**.

---

## Assistente AI di revisione

Il cliente indeciso apre "**Non sei sicuro? Parlane con l'assistente**". Può
scrivere o dettare a voce (dettatura in italiano del browser).

- L'assistente fa **una domanda alla volta** finché il feedback non è
  concreto: quale immagine, quale frase, quale momento del video. Per i video
  c'è il chip "Usa il momento attuale (0:07)".
- Alla fine prepara un **riepilogo con l'elenco delle modifiche**, che il cliente
  può correggere prima di inviarlo.
- Le richieste legate a un momento del video diventano marcatori sulla barra del
  video dell'agenzia. L'agenzia legge anche la conversazione completa.
- **Non approva mai da solo**: l'approvazione richiede sempre il clic del cliente.
- Senza chiave API il pulsante non compare e il portale funziona normalmente.
  Se il provider non risponde, il cliente vede "L'assistente non è disponibile al
  momento" e può comunque approvare o chiedere modifiche.

**Motore.**

- Predefinito: **OpenAI** (`OPENAI_API_KEY`, modello `OPENAI_MODEL`, di base `gpt-5.5`).
- Alternativa: **Claude di Anthropic**, con `REVIEW_ASSISTANT_PROVIDER=anthropic`,
  `ANTHROPIC_API_KEY` e `REVIEW_ASSISTANT_MODEL` (di base `claude-opus-5-5`).
- I due motori usano lo stesso prompt, gli stessi schemi di risposta e gli stessi limiti.
- Le immagini del post vengono passate al modello come URL pubblici HTTPS. I video
  non vengono mandati al modello: il cliente li descrive.

**Limiti** (per contenere i costi):

- 30 messaggi per conversazione;
- 5 conversazioni per post e per referente;
- 150 messaggi per referente in 24 ore;
- 2.000 caratteri per messaggio.

**Quanto costa, a spanne.** Una conversazione tipica ha 4–6 scambi più il
riepilogo. Il contesto (istruzioni, testo del post, immagini e storico) viene
rimandato a ogni turno, per un totale di circa **30–60 mila token in ingresso e
3–6 mila in uscita**.

- Con **Claude Opus 5.5** (4 $ per milione di token in ingresso, 20 $ in uscita,
  0,20 $ le letture da cache) fanno circa **0,15–0,30 $ a conversazione**. La
  cache del prompt è attiva e abbassa la parte in ingresso.
- Con **OpenAI** l'ordine di grandezza è simile: moltiplica i token qui sopra per
  il listino attuale del modello scelto in `OPENAI_MODEL`.
- Si usa solo quando il cliente apre l'assistente. Con 200 conversazioni al mese
  si spende sui 30–60 $, e molto meno se gran parte dei post viene approvata
  direttamente.

---

## Limiti noti

- **Notifiche solo via email.** Niente push e niente WhatsApp. I link dei referenti
  non scadono: si possono rigenerare ("Nuovo link") o disattivare.
- **Caricamento multipart in memoria.** L'editor usa già lo streaming. Un client
  esterno che manda un file multipart da 300 MB lo tiene tutto in memoria.
- **Nessun poster generato per i video.** Le miniature usano il video stesso a 0,5 s.
- **Testo alternativo dei media.** Metricool non documenta il formato, quindi
  `mediaAltText` viene inviato vuoto.
- **Copertina con più reti.** È inviata se almeno una delle reti scelte la
  supporta. Se Metricool rifiutasse un abbinamento (per esempio Reel + X), la
  regola va resa più stretta in `lib/metricool/payload.ts`.
- **Spostare la data di un post approvato** lo riporta in Bozza senza creare una
  versione. L'azione resta tracciata solo come cambio di stato, perché manca un
  evento dedicato "modificato".
- **Errore nel layout del portale.** Se il database non risponde mentre si apre
  un link cliente, compare la pagina di errore generica di Next.js e non quella
  del portale.
- **Gli inviti al team** si condividono copiando il link dalle Impostazioni: non
  parte nessuna email. Le API dei membri, ereditate da DM, rispondono in inglese,
  ma il pannello mostra i messaggi tradotti.
- **Metricool reale non provato.** I test usano solo il Metricool finto. Prima di
  andare in produzione, prova un post vero su un brand di test.
- **Servizi e istanze separate.** Su un'istanza a tipo singolo (`blog`, `ads`) i
  clienti senza quel servizio non compaiono nell'editor; il portale e la scheda
  cliente mostrano solo i tipi dell'istanza.
- **Blog e ads: messaggi d'errore generici.** Alcuni errori dei servizi dicono
  ancora «post» per ogni tipo (per esempio «Post non trovato»).
- **Selezione del testo su un telefono vero** (blog) e riproduzione dei video
  nelle schede ads sono provate solo nel Chromium di Playwright (selezione
  simulata, video VP9), non su iOS/Android reali.
- **Pacchetto ads oltre 1 GB:** la route risponde 413 in JSON; il pulsante del
  pannello è un semplice link, quindi il messaggio compare come testo grezzo.
