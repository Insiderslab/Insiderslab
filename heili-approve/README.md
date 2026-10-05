# Approve by Heili

Piattaforma per far **rivedere e approvare ai clienti i post social** preparati
dall'agenzia. Quando il cliente approva, il post viene **programmato in automatico
su Metricool**.

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

---

## Avvio in locale

Prerequisiti: Node 20 o più recente, Postgres 16 e Redis 7. Per Postgres e Redis
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
```

**Entrare senza email (solo sviluppo).**

- `npm run db:seed` stampa un cookie di sessione fisso. Nel browser su
  `localhost:3000`, apri DevTools → Application → Cookies e aggiungi
  `authjs.session-token` = `dev-session-stefano-insiderslab-0000000001`. Poi apri
  `/dashboard`.
- Il seed stampa anche i link di revisione dei due clienti demo (Caffè Aurora,
  collegato al brand Metricool `123456`, e Studio Verde Architetti).
- Il seed si può rilanciare senza problemi: non duplica nulla. Si rifiuta di
  girare con `NODE_ENV=production`.

**Email in sviluppo.** Senza `EMAIL_SERVER` e con una chiave Resend finta, le
email (comprese quelle con i link per i clienti) vengono stampate nella console
del server.

**Metricool finto.** Con `METRICOOL_FAKE=1`:

- non parte nessuna chiamata di rete;
- i brand sono `fake-1001` e `fake-1002`;
- il worker stampa nel suo log il payload esatto che avrebbe inviato (`[Metricool fake] payload {...}`);
- un post con `[metricool:fail]` nel testo simula un rifiuto (422).

### Controlli

```bash
npx prisma generate
npx tsc --noEmit --incremental false
npm run lint
npx vitest run            # 238 test unitari
npm run build
```

### Test end-to-end (Playwright)

Il test copre tutto il flusso con l'app vera, in quest'ordine:

1. L'agenzia crea un post con un'immagine caricata.
2. Il cliente, su uno schermo da 390 px, mette un pin e chiede modifiche.
3. L'agenzia prepara la versione 2.
4. Il cliente vede "cosa è cambiato" e approva.
5. Il worker programma il post su Metricool finto.
6. Si controllano i casi di accesso negato: link sbagliato, bozza, post di un altro cliente, assistente nascosto senza chiave.
7. Un Reel: commento a 0:05, copertina e `videoCoverMilliseconds` nel payload.

```bash
npm run build
PORT=3000 METRICOOL_FAKE=1 npm run start &
METRICOOL_FAKE=1 npm run worker > /tmp/worker.log 2>&1 &
E2E_WORKER_LOG=/tmp/worker.log npm run test:e2e
```

- Playwright non è una dipendenza del progetto. `e2e/run.sh` usa l'installazione
  globale (`npm i -g playwright && npx playwright install chromium`).
- Gli screenshot finiscono in `docs/screenshots/`.
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
4. Crea i clienti e aggiungi i referenti: ognuno riceve il suo link.

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

1. Su Metricool, apri **Impostazioni account → API** (serve il piano Advanced o
   superiore) e copia il **token API**. Lo **userId** è il numero nell'URL
   dell'app (`…?userId=1234567`). Puoi incollare anche l'URL intero: l'app tiene
   solo il numero.
2. In Approve: **Impostazioni → Metricool**, inserisci userId e token, poi
   **Prova connessione**.
   - Il token viene salvato cifrato (AES-256-GCM con `ENCRYPTION_KEY`) e non lascia
     mai il server.
   - Solo titolari e amministratori possono cambiarlo.
3. Per ogni cliente, nella sua scheda, scegli il **brand Metricool** dall'elenco
   (diventa il `blogId`). Imposta anche il fuso orario e le reti abilitate.
4. Con **"Programma automaticamente dopo l'approvazione"** attivo, un post approvato parte subito verso
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
