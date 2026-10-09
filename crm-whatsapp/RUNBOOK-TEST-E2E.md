# Runbook — test end-to-end del CRM con il numero InsidersLab (+1 555 779 6249)

**Obiettivo:** un messaggio WhatsApp reale inviato da un telefono al +1 555 779 6249 compare nell'inbox di `crm.heili.cloud`, l'agente AI risponde, lo stato passa a consegnato/letto. Modo diretto (CRM ↔ Meta), senza Wapi.
**Chi:** Stefano nel pannello Meta e nel CRM; la sessione Claude con Chrome può eseguire i passi Meta 1–5 uno per volta con conferma prima di ogni salvataggio. Nessun token in chat.
**Dati (dal `REPORT-META-2026-10-05.md`):** portfolio Insiderlabs Business `404240226745821` · app "Whatpp Business Insiderslab" `609974691965875` (Live) · WABA "Insiderslab Team" `1027272492350148` · Phone Number ID `671133866076775` · numero +1 555 779 6249 · utente di sistema `WhatsappBot` (Admin, nessuna risorsa).

## Prima di iniziare (2 controlli)
- [ ] **n8n:** `https://insiderslab.app.n8n.cloud` → workflow con trigger Webhook sul percorso attualmente impostato nell'app Meta. Se è attivo e serve, **fermati**: spostare il callback lo spegne. Se è un test vecchio, disattivalo e prosegui.
- [ ] **Clientify:** il WABA Insiderslab Team ha Clientify come partner con controllo completo. In Clientify → Comunicazioni → canali: se c'è un canale WhatsApp API su +1 555 779 6249 con bot o risposte automatiche, mettilo in pausa per la durata del test (altrimenti rispondono in due).

## A. Meta (15 min)
1. **Utente di sistema** `https://business.facebook.com/latest/settings/system_users?business_id=404240226745821` → `WhatsappBot` → *Assegna risorse*: app **Whatpp Business Insiderslab** (controllo completo) e account WhatsApp **Insiderslab Team** (controllo completo). Poi *Genera nuovo token* → app Whatpp Business Insiderslab → scadenza **Mai** → spunta `whatsapp_business_messaging` e `whatsapp_business_management` → copia il token **solo** nel gestore password, lo userai al passo B2.
2. **Metodo di pagamento** `https://business.facebook.com/billing_hub/accounts?business_id=404240226745821` → account WhatsApp *Insiderslab Team* → aggiungi carta e dati fiscali (P.IVA). Senza, i template non vengono inviati; i messaggi di risposta entro 24 h funzionano comunque.
3. **App Secret** `https://developers.facebook.com/apps/609974691965875/settings/basic/` → *Chiave segreta dell'app* → Mostra → copia nel gestore password (serve al passo B3).
4. **Webhook** `https://developers.facebook.com/apps/609974691965875/use_cases/customize/?use_case_enum=WHATSAPP_BUSINESS_MESSAGING` → *Configura webhook*:
   - URL di callback: quello mostrato dal CRM in **Impostazioni → WhatsApp → sezione Webhook** (forma `https://crm.heili.cloud/api/webhooks/wa/<token>`; il `<token>` è il `META_WEBHOOK_VERIFY_TOKEN` dell'istanza). Copialo dal CRM con il pulsante, non riscriverlo.
   - Token di verifica: lo stesso `<token>`.
   - *Verifica e salva*: deve riuscire subito (il CRM risponde alla challenge). Se fallisce: il CRM non è raggiungibile o il token non coincide.
   - Campi: `messages` **e** `message_template_status_update`. (`smb_message_echoes` solo se in futuro un numero resta anche sull'app WhatsApp Business del telefono.)
5. **Sottoscrivi il WABA all'app:** nella stessa pagina, accanto a *Insiderslab Team* → *Iscriviti ai webhook*. (Il CRM lo fa anche da solo al salvataggio del passo B2, con `POST /{waba}/subscribed_apps`, ma farlo a mano rende visibile l'esito.)

## B. CRM (10 min)
1. Entra su `https://crm.heili.cloud` come owner/admin; con il selettore in alto scegli l'organizzazione **InsidersLab** (non La Bambola).
2. **Impostazioni → WhatsApp**: modo diretto → WABA ID `1027272492350148`, Phone Number ID `671133866076775`, token del passo A1 → **Prova connessione** (atteso: "Token valido per +1 555 779 6249") → **Salva**. Il token resta cifrato nel DB; nell'interfaccia si vede solo `…last4`.
3. **Variabile d'ambiente** `META_APP_SECRET` = chiave segreta dell'app (passo A3), nella piattaforma di hosting del CRM (Coolify o `.env` sul VPS) → riavvia il container `app`. Senza, il webhook accetta qualunque payload sulla URL segreta (capa 2 disattivata).
4. **Impostazioni → Modelli → Sincronizza**: devono comparire i template del WABA (se ce ne sono). Se la lista è vuota, crea un template *Utility* di prova ("Ciao {{1}}, riprendiamo la conversazione quando vuoi.") e invialo in approvazione.
5. **Agente**: verifica che l'istanza abbia `OPENROUTER_API_TOKEN` e `OPENROUTER_MODEL` impostati (altrimenti l'inbox mostra l'avviso "Manca la chiave IA dell'istanza"). Nella scheda Agente: nome, tono, 5–10 coppie domanda/risposta su InsidersLab, regola di escalation. Esegui una corsa del **Laboratorio** prima di accendere l'agente.

## C. Test (10 min)
| # | Azione | Atteso |
|---|---|---|
| 1 | Da un telefono qualsiasi scrivi "ciao" al +1 555 779 6249 | Entro 2 s compare contatto + conversazione nell'inbox, stato *Nuovo* in pipeline |
| 2 | Agente acceso | Risposta AI marcata "IA" nel thread, consegnata sul telefono; stati sent → delivered → read |
| 3 | Rispondi a mano dal composer | Arriva sul telefono; nel thread origine "operatore" |
| 4 | Scrivi "voglio parlare con una persona" | Handoff: IA in pausa sulla conversazione, badge visibile |
| 5 | Dopo 24 h senza messaggi del cliente | Composer bloccato sul testo libero; invio template possibile solo se approvato e con metodo di pagamento |
| 6 | Log del container `app` | Nessun `401` sul webhook (firma ok), nessun `MetaApiError` |

## Rollback
- Meta: rimetti l'URL di callback precedente (n8n) e il suo token di verifica; togli l'iscrizione del WABA all'app se serve.
- CRM: Impostazioni → WhatsApp → disconnetti; oppure revoca il token dall'utente di sistema (invalida tutto subito).

## Non verificato da qui
- Che `META_WEBHOOK_VERIFY_TOKEN` sia impostato in produzione (se il CRM non mostra la URL del webhook, va impostato e il container riavviato).
- Che Clientify non abbia automazioni attive sul numero.

## Registro di esecuzione

### 5/10 sera (sessione Chrome, nessuna modifica salvata)
- Webhook app 609974691965875: callback `https://insiderslab.app.n8n.cloud/webhook/942f3c9d-…/webhook`, solo `messages` (v25.0). Token di verifica non leggibile (campo mascherato).
- n8n: login non effettuato, workflow non verificato. **Ricerca da remoto (Slack, Gmail, repo): nessuna traccia di un flusso WhatsApp su n8n in uso** (nessuna email di errore di esecuzione da n8n cloud, nessun messaggio Slack, nessun riferimento nei repo). L'app vede solo il numero +1 555 779 6249 e il numero di prova Meta: un flusso su quel numero non può essere un processo cliente attivo. Conferma definitiva: n8n → workflow con webhook `942f3c9d…` → scheda *Executions*: se nessuna esecuzione negli ultimi 30 giorni, si può spostare il callback.
- Rollback verso n8n: con il token mascherato, il rollback funziona solo se il workflow n8n risponde alla challenge `hub.challenge` con un token che conosciamo. Prima di cambiare il callback, aprire il nodo Webhook in n8n e annotare (fuori chat) il token di verifica che usa; in alternativa accettare che il rollback richieda di impostare un token nuovo in entrambi i posti.
- Clientify: nessun canale WhatsApp API collegato, automazione "Nuovo Lead" non usa WhatsApp. Rischio doppie risposte: basso.
- Nota sul numero: +1 555 779 6249 è un numero fornito da Meta (prefisso 555, non raggiungibile con chiamate o SMS). Va bene per il test; per un cliente serve un numero reale suo.
- A1 in corso: utente di sistema `WhatsappBot` (ID 61572964465934) senza risorse; prossimo clic = assegna app + WABA, poi token "Mai" con i due permessi.

### 6/10 (sessione Chrome, resoconto riportato da Stefano; registro scritto dalla sessione cloud)
**Fatto**
- A1 risorse: a `WhatsappBot` (ID 61572964465934) assegnati con accesso completo l'app 609974691965875 e il WABA 1027272492350148. **Assegnate per errore anche:** Pixel Insiderlabs (come Pixel e come Dataset), i 2 WABA "Insiderslab" senza numero/offline, il Test WhatsApp Business Account. Da rimuovere (minimo privilegio). `Openclaw` resta senza risorse.
- A1 token permanente: generazione avviata (permessi messaging + management; `whatsapp_business_manage_events` aggiunto da Meta) ma **bloccata dalla verifica email**: Meta chiede un codice a stefano@insiderslab.it che non arriva. Controllo dalla sessione cloud su entrambe le caselle (inbox, spam, cestino, ultimi 2 giorni): **nessun codice ricevuto** né su stefano@insiderslab.it né su stefano.finoti@gmail.com. I codici precedenti (23/9, 27/9) erano arrivati da `notification@email.meta.com` su stefano@insiderslab.it, quindi la consegna in sé funziona: probabile che la verifica stia andando a un indirizzo diverso impostato come principale sull'account Meta, oppure al profilo personale "Stefano Finoti Araya". Da controllare in Centro gestione account → Dati personali → Contatti.
- Ripiego: token **temporaneo (24 h)** da app → WhatsApp → Passaggio 1 → "Genera token". Cliccato, campo ancora "Not generated yet" (popup di consenso probabilmente fuori vista). La pagina mostra il numero di prova Meta (+1 555 615-0255, Phone Number ID 1249087948277495, WABA 2153322095219505): **non è il nostro**. Nel CRM vanno usati WABA 1027272492350148 e Phone Number ID 671133866076775; il token temporaneo è dell'utente e vale su tutti i WABA che l'app vede, da confermare con "Prova connessione" (B2).

**Non fatto**
- n8n: login non riuscito; workflow 942f3c9d… non verificato; token di verifica non annotato. **Decisione proposta: procedere senza** (vedi registro del 5/10: nessuna traccia di uso; il numero è di test). Rollback verso n8n = token nuovo in entrambi i posti.
- A2 pagamento: **rinviabile**. Dal 1/10 ogni numero ha 1.000 messaggi di servizio al mese gratis anche senza metodo di pagamento (email Meta del 29/9); i messaggi in entrata e le risposte entro 24 h del test non lo richiedono. Serve solo per i template.
- A3, A4, A5, B, C: da fare.

**Effetti del token temporaneo**
- Dopo 24 h il CRM segna la connessione "da riconnettere" e mette in pausa gli invii. Va sostituito con il token permanente di `WhatsappBot` appena la verifica email di Meta funziona (3 clic: le risorse sono già assegnate).

**Azioni per Stefano**
1. Meta → Centro gestione account → Password e sicurezza: aggiungere app di autenticazione o telefono; verificare quale email è "principale" (è lì che va il codice). Poi rigenerare il token permanente.
2. Togliere a `WhatsappBot` le 5 risorse in più.
3. Decidere su n8n: verificare con il login oppure procedere senza (consigliato).

### 9/10 — Fase 1 del controllo WhatsApp (sessione Chrome, sola lettura; registro scritto dalla sessione cloud)
**Stato trovato**
- Account Meta: email principale stefano@insiderslab.it + telefono; c'è una passkey. "E-mail recenti": **nessuna email di sicurezza inviata nelle ultime 2 settimane** → il codice del 6/10 non è mai partito da Meta. Sull'utente di sistema c'è un banner "Verifica dell'account richiesta" in sospeso.
- `WhatsappBot`: risorse = app 609974691965875, WABA Insiderslab Team + 3 in più (2 WABA "Insiderslab", Test WABA). Pixel/Dataset già rimossi. Nessun token.
- App 609974691965875: webhook ancora su n8n, solo `messages`, WABA Insiderslab Team **non** iscritto.
- WABA Insiderslab Team: numero Collegato, qualità Alta, nome "Insiderlabs" approvato, limite 2.000/24 h, **nessun metodo di pagamento**, **0 modelli**. Partner: solo Clientify (controllo completo).
- **CRM `crm.heili.cloud`: le organizzazioni InsidersLab e La Bambola NON esistono.** L'istanza ha 2 organizzazioni: "Negocio de Stefano Finoti" (slug `principal`, 1 utente, 0 contatti) e "Hair extension Clinic" (1 utente, 8 contatti demo della ferramenta "El Martillo", agente "Martillito" = dati della demo di Vocero). Verificato nel codice: `GET /api/admin/orgs` elenca **tutte** le organizzazioni dell'istanza, quindi non è un problema di account o permessi. Nessuna organizzazione collegata a WhatsApp. URL del webhook mostrata (quindi `META_WEBHOOK_VERIFY_TOKEN` è impostato); avviso "Nessun App Secret configurato". Nessun modello.
- Portfolio La Bambola Morrocoy (2451131388356181): **non verificato** ("Sono necessarie ulteriori informazioni"); WABA 104583859184157 di tipo App WhatsApp Business, numero +58 414-4324032 **non in linea**; app "La bambolaChatbot" 1368958778397072 in sviluppo, webhook vuoto.

**Correzioni ai documenti**
- `vocero-crm/docs/ops/rilascio-c1.md` (branch `claude/keen-ptolemy-l0kv8g`) e `ANALISI-COMPLETA-2026-10-09.md` davano per esistenti in produzione "InsidersLab" e "La Bambola": **falso**. Le 2 organizzazioni reali sono "Negocio de Stefano Finoti" e "Hair extension Clinic". Il rischio di C1/C2 (chiavi d'istanza con 2 organizzazioni) resta identico.
- Il codice non ha endpoint per cancellare un'organizzazione dal pannello: ogni organizzazione creata resta.

**Decisioni per la fase 2 (proposta della sessione cloud)**
- Organizzazione per il test: **"Negocio de Stefano Finoti"** (vuota, owner Stefano, già con pipeline e profilo agente creati alla registrazione). Evita una terza organizzazione non cancellabile. Rinomina in "InsidersLab" facoltativa e successiva.
- Ordine rivisto per non lasciare buchi tra webhook e connessione: token → togli i 3 WABA → App Secret (`META_APP_SECRET` impostato da Stefano + riavvio) → **collega WhatsApp nel CRM e salva** (il wizard iscrive anche il WABA all'app) → webhook dell'app verso il CRM → verifica interruttore "Iscriviti ai webhook" → modello Utility → test.
- Fuori dalla fase 2: pagamento del WABA, Clientify, tutto La Bambola (portfolio da far verificare al cliente, numero da rimettere in linea o sostituire, organizzazione nel CRM da creare quando il numero è pronto), pulizia dei dati demo in "Hair extension Clinic".

### 9–10/10 notte — Messaggio di prova non arrivato: diagnosi sul VPS
**Fatti (output incollato da Stefano dal VPS `srv1899808`, cartella `/opt/vocero`)**
- Container `vocero-app` Up (healthy), riavviato ~1 h prima; `vocero-postgres` Up da 5 settimane.
- **`META_APP_SECRET` nel container è lungo 106 caratteri**: un App Secret Meta è di 32 caratteri esadecimali. La prova con Graph (`access_token=<app_id>|<secret>`) sulle tre app non ha restituito nulla: il valore contiene caratteri che rompono la richiesta. Con questo segreto il CRM risponde **401 a ogni evento di Meta** (`src/server/inbox/webhook.ts:32-38`) e il route **non scrive nulla nel log** in caso di 401/404 → spiega log vuoti e messaggio mai arrivato. **Causa più probabile.**
- Un comando precedente ha copiato quel valore anche in `/opt/vocero/.env` (1 riga `META_APP_SECRET=`). Esiste un `docker-compose.override.yml` non versionato: va controllato se definisce la variabile.
- Log `app` ultimi 60 min: nessuna riga `webhook`/`desconocido`/errore. Caddy (`second-brain-caddy-1`) non ha l'access log attivo: si vedono solo avvisi normali su `/api/events` (SSE della Posta).
- **Produzione gira `38bdc65` (20/8, fasi 1-3)**, non `main`. `origin/main` è ora `2f4338d` (10/10: modelli WhatsApp in italiano, PR #2) — nuovo lavoro di un'altra sessione, non ancora in produzione. Webhook, firma e instradamento in `38bdc65` sono identici a quelli attuali (verificato).

**Strumenti preparati (testati con docker/curl simulati, nessun segreto nell'output)**
- `crm-whatsapp/diagnosi-whatsapp.sh` — solo lettura: container, formato e validità dell'App Secret (con Meta), connessione salvata nel CRM, webhook dall'esterno (GET, POST firmato, POST senza firma), e lato Meta col token salvato nel CRM: numero, `webhook_configuration`, override, `subscribed_apps`. `--iscrivi` iscrive il WABA all'app se manca.
- `crm-whatsapp/correggi-app-secret.sh` — chiede la chiave senza mostrarla, la valida con Meta per l'app 609974691965875, copia `.env`, scrive il valore, ricrea `app`, ricontrolla la lunghezza; si ferma se `docker-compose.override.yml` contiene un valore scritto.

**Prossimo passo (Stefano, ~5 min):** scaricare i due script, lanciare `correggi-app-secret.sh`, scrivere "ciao" al numero, lanciare `diagnosi-whatsapp.sh` e incollare l'esito.

### 9/10 23:36 UTC — Primo messaggio reale ricevuto dal CRM ✅
- Deploy di `main` `2f4338d` in produzione (`git pull --ff-only && docker compose up -d --build --no-deps app`), health 200. Nessuna variabile `WAPI_*`: modo diretto.
- `correggi-app-secret.sh`: chiave confermata da Meta per l'app 609974691965875, `.env` aggiornato (backup `.env.bak-20261009-233612`), container ricreato. **Nota sicurezza:** durante un primo tentativo la chiave è stata incollata nel terminale come comando ed è comparsa in chat e nella cronologia bash → va rigenerata ("Reimposta" in Meta) e riscritta con lo stesso script.
- `diagnosi-whatsapp.sh`: tutte le sezioni OK. Segreto valido (32), connessione `Negocio de Stefano Finoti` / WABA 1027272492350148 / Phone 671133866076775 / connected; GET 200, POST firmato 200, POST senza firma 401; numero CONNECTED, CLOUD_API, nome APPROVED, qualità GREEN; callback dell'app = CRM con token coincidente; app iscritte al WABA: Whatpp Business Insiderslab + Clientify Inbox (735132587797436).
- Database: messaggio in entrata **"Ciao" alle 23:36**, organizzazione "Negocio de Stefano Finoti", `wa_message_id` reale → **la catena Meta → CRM funziona**. Causa del guasto: `META_APP_SECRET` sbagliato (106 caratteri) → 401 silenziosi.
- Nella stessa organizzazione ci sono 16 messaggi della **demo "Ferretería El Martillo"** (seed caricato nelle ultime 24 h): da ripulire prima di usare l'organizzazione per lavoro vero.
- Resta da fare la tabella C: risposta manuale dal composer, risposta AI (agente spento, chiave OpenRouter da verificare), handoff, finestra 24 h; modello Utility da creare; token permanente di `WhatsappBot`; pulizia risorse in eccesso; rigenerazione App Secret.
