# Heili CRM — analisi completa e distanza dal 100% operativo (9 ottobre 2026)

**Perimetro:** il CRM WhatsApp di Heili ("Heili Orbit", repo `vocero-crm`) con il gateway Whapi (`wapi`), i pannelli Meta, l'infrastruttura su VPS e i pezzi dell'ecosistema Heili che lo toccano (`heili-dm`, `heili-platform`).
**Fonti:** repo clonati e aggiornati oggi; audit Heili del 1/10; `REPORT-META-2026-10-05.md`; runbook con registro al 6/10; briefing "Heili CRM" per Mandeep e Juan del 9/10 (Drive); email Meta.
**Non verificato da qui:** stato dei container e del database in produzione (rete bloccata verso `*.heili.cloud`), esito del test end-to-end dopo il 6/10 (nessun registro nuovo), contenuto del VPS. Dove un dato è dichiarato e non provato lo segno con *(dichiarato)*.

---

## 1. Che cosa vuol dire "100% operativo"

Il briefing del 9/10 fissa il traguardo: **primo cliente La Bambola, collegato a sito web, WhatsApp, Instagram e Facebook**, onboarding ripetibile sotto i 60 minuti, isolamento tra organizzazioni, elaborazione affidabile dei messaggi, ripristino provato. Poi un pilota commerciale con 3–5 organizzazioni paganti a inizio dicembre.

Lo divido in due livelli, perché la distanza è molto diversa.

| Livello | Definizione | Distanza stimata |
|---|---|---|
| **L1 — Primo cliente su WhatsApp** | La Bambola riceve e risponde su WhatsApp dal CRM, l'AI risponde con la sua base di conoscenza, handoff umano, template, nessun dato visibile ad altre organizzazioni, backup provato | **~65% fatto · 2–3 settimane** |
| **L1+ — Primo cliente con tutti i canali richiesti il 9/10** | Come sopra più Instagram DM, Facebook Messenger e richieste dal sito nella stessa inbox | **~45% fatto · 5–7 settimane**, perché Instagram e Facebook nel CRM oggi non esistono |
| **L2 — Prodotto commerciale (3–5 organizzazioni)** | Onboarding senza SSH, chiavi e credenziali per organizzazione ovunque, gateway Wapi in produzione, monitoraggio, backup off-site con restore misurato, contratti e privacy, supporto | **~35% fatto · dicembre è plausibile solo se Instagram/Facebook restano fuori dal primo rilascio** |

---

## 2. Mappa del sistema e stato di ogni pezzo

| Componente | Cosa fa | Stato verificato | Ruolo per il CRM |
|---|---|---|---|
| **vocero-crm** (`main` 23/8, v1.2.0 live su `crm.heili.cloud`, health 200 *(dal briefing 9/10)*) | Inbox WhatsApp, contatti, pipeline, lead, tag, template, finestra 24 h, agente AI, Laboratorio, handoff, multi-organizzazione, automazioni, API bot ed export | Codice completo per WhatsApp; gate verde (typecheck, lint, 268 test su `main`); 2 organizzazioni in produzione (InsidersLab, La Bambola) *(dichiarato)* | Il prodotto |
| **vocero-crm** branch `claude/keen-ptolemy-l0kv8g` (ultimo commit 5/10 sera, `bd5802c`) | C1 chiavi bot per organizzazione, C2 chiavi export per organizzazione, pagina "Chiavi API" per owner/admin, procedura di rilascio, Leggi di Heili | ~350 test *(dichiarato nel registro)*; **non rivisto da un secondo agente, non unito, non rilasciato** | Chiude la falla di isolamento P3 |
| **wapi** ("Whapi by Heili", `master` 26/8; produzione da commit fuori da master) | Gateway Meta multi-numero: credenziali per numero, proxy Graph, webhook con firma, inoltro al CRM | Inoltro senza coda (messaggi persi se il CRM è giù); fix su `codex/phase-0-webhook-inbox` (27/9) non unito; CI e rate limit login su branch `claude/keen-ptolemy` non uniti; app Meta "Whapi by Heili" **in sviluppo**, quindi oggi non riceve traffico reale | Necessario solo per il modello agenzia (L2). Per L1 si va in modo diretto |
| **Meta** | Insiderlabs Business 404240226745821 verificata; app "Whatpp Business Insiderslab" 609974691965875 Live, accesso **standard**; WABA Insiderslab Team 1027272492350148 con +1 555 779 6249 registrato; webhook dell'app ancora su n8n; Tech Provider non avviato; token permanente bloccato dalla verifica email (6/10), in uso un token temporaneo | Canale funzionante per il nostro numero; per i clienti serve il loro portfolio (modo diretto) o accesso avanzato + Tech Provider (modo agenzia) | Il canale |
| **heili-dm** (`dm.heili.cloud`, operativo dal 30/8) | Instagram: commento → DM, inbox DM con risposta nella finestra 24 h, link tracciati, workspace multi-cliente | Funziona, 163 test, app Meta "Dm Heili" Live. **Solo Instagram, nessun Messenger**, nessun collegamento al CRM | Candidato per coprire Instagram nel primo rilascio senza scrivere un adattatore |
| **heili-platform** (Heili Core, `main` 6/9) | Memoria aziendale, connettori, MCP | Nessun commit da settembre; PR impilate; nessuna integrazione col CRM (C5/C6 non fatti) | Fuori perimetro per il CRM operativo (lo dice anche il briefing) |
| **Infrastruttura** | Un VPS Hostinger, un Caddy, Docker Compose per ogni modulo; deploy a mano via SSH | Rotte Caddy, compose di produzione e script di backup **non versionati**; nessun backup di CRM e Wapi; nessun monitoraggio; commit in produzione non esposto dall'health | Il punto più fragile per L2 |
| **Clientify** | CRM esterno dell'agenzia; partner con controllo completo sui WABA di Lumii e di Insiderslab Team | Non c'entra con Heili CRM, ma condivide i WABA: va tenuto presente per non avere due bot sullo stesso numero | Rischio di sovrapposizione |

---

## 3. Scorecard per area

Percentuali stimate sul criterio L1 (prima riga) e L2 (seconda), con l'evidenza principale.

| Area | L1 | L2 | Cosa c'è | Cosa manca |
|---|---|---|---|---|
| **Funzioni CRM WhatsApp** | 90% | 80% | Tutto il ciclo inbox → pipeline → AI → handoff → template → automazioni | Pagina chiavi API solo sul branch; inviti utente con link (spec 004) non implementati; nessun report/metriche per il cliente |
| **Canale WhatsApp (Meta)** | 60% | 30% | Azienda verificata, app Live, numero nostro registrato | Test end-to-end non chiuso; webhook ancora su n8n; token permanente bloccato; pagamento WABA assente; template nostri zero; Tech Provider e accesso avanzato non avviati (servono per L2 e per Wapi) |
| **Canali Instagram, Facebook, sito** (requisito del 9/10) | 10% | 10% | Instagram DM esiste in heili-dm, separato; nessun Messenger; nessun endpoint per i form del sito | Adattatori nel CRM o integrazione heili-dm → CRM; modello di identità multi-canale (oggi il contatto è `wa_identity`); endpoint di ingresso per il sito |
| **Isolamento multi-organizzazione** | 50% | 40% | Query filtrate per organizzazione; C1/C2 sul branch; chiavi con hash, revoca, pagina admin | C1/C2 non rilasciati; C3 (chiave Wapi per organizzazione) non fatto; `META_APP_SECRET` unico per istanza (con app Meta diverse per cliente la firma si verifica per una sola); nessuna RLS sul database (isolamento solo applicativo); rate limit in memoria |
| **Affidabilità messaggi** | 70% | 40% | Webhook idempotente per `wa_message_id`, stati monotoni, retry sugli invii, `after()` per non bloccare Meta | Nessuna coda durevole (processo in-memory); inoltro Wapi fire-and-forget; nessun dead-letter; nessun alert su webhook falliti |
| **Infra e operazioni** | 40% | 20% | Docker, Caddy, migrazioni automatiche all'avvio, healthcheck | Backup off-site e restore drill; Caddy/compose/script versionati; staging (`vocero-dev` esiste *(dichiarato ad agosto)*, non documentato); commit esposto dall'health; monitoraggio e alert (uptime, errori Meta, scadenza token, qualità numero); deploy riproducibile |
| **Qualità e CI** | 70% | 60% | Vitest, E2E con mock, CI configurata | CI su GitHub con 0 esecuzioni registrate al 1/10; nessun test su Postgres reale; revisione indipendente mancante sul branch C1/C2 |
| **AI** | 60% | 50% | Agente con base di conoscenza, escalation, Laboratorio con giudice, OpenRouter | Chiave e modello in produzione non confermati; nessuna base di conoscenza per nessun cliente; costi non misurati; nessun limite di spesa per organizzazione |
| **Onboarding cliente** | 50% | 30% | `/admin` crea organizzazione e primo utente; wizard WhatsApp con prova connessione; checklist La Bambola scritta | SOP ripetibile < 60 min non provata; guida per il cliente; inviti con link; gestione del portfolio Meta del cliente |
| **Commerciale, legale, supporto** | 20% | 10% | Listino e proposte esistono in agenzia | Contratto e DPA per il servizio CRM+AI; informativa per gli utenti finali su WhatsApp; retention dei messaggi; chi risponde agli handoff e con che SLA; processo di supporto |
| **Team e proprietà** | 40% | 30% | Juan e Mandeep ingaggiati con il briefing del 9/10 | Accesso tramite casella condivisa (attribuzione debole); nessun secondo revisore attivo sul codice; conoscenza operativa (VPS, token, deploy) concentrata su Stefano |

---

## 4. Che cosa manca, in ordine

### A. Blocchi per L1 (senza questi il primo cliente non va in produzione)

| # | Cosa | Chi | Stima | Fatto quando |
|---|---|---|---|---|
| A1 | **Chiudere il test end-to-end** sul nostro numero: A3–A5, B, C del runbook; sostituire il token temporaneo col permanente (sbloccare la verifica email Meta: email principale dell'account, app di autenticazione) | Stefano + sessione Chrome | 2–3 h | Tabella C del runbook tutta verde; registro aggiornato |
| A2 | **Revisione indipendente e rilascio di C1/C2** (chiavi per organizzazione) con la procedura `docs/ops/rilascio-c1.md`: backup, migrazioni 0009/0010, una chiave per organizzazione, rimozione delle chiavi globali | Codex (revisione) + Stefano (rilascio) | 1 giorno + 2 h | `main` contiene C1/C2; in produzione nessuna `BOT_API_KEY`/`EXPORT_API_KEY` globale con 2 organizzazioni |
| A3 | **Backup off-site + restore provato** per il Postgres e la cartella media del CRM (RPO 24 h, RTO 8 h come da briefing) | Codex (script e doc) + Stefano (storage e drill) | 1 giorno | Un restore su host isolato riuscito e cronometrato |
| A4 | **Portfolio Meta di La Bambola**: numero reale dedicato (non 555), WABA, app "La bambolaChatbot" o la nostra condivisa, token di sistema, webhook, pagamento, nome visualizzato, 2–3 template approvati | Stefano + cliente | 1 giorno di lavoro, 2–5 giorni di attesa Meta | Numero "Collegato", template "Approvato", messaggio di prova nell'inbox dell'organizzazione La Bambola |
| A5 | **Decisione su `META_APP_SECRET`**: oggi è uno per istanza. O tutti i clienti passano dalla nostra app (il cliente condivide il WABA con Insiderlabs Business come partner: da verificare che l'accesso standard lo copra) oppure il CRM verifica la firma per organizzazione (modifica piccola: colonna cifrata accanto al token, lookup per `phone_number_id`) | Stefano decide, Codex implementa | 0,5–1 giorno | Firma verificata per ogni organizzazione attiva, test negativo |
| A6 | **Base di conoscenza, agente e Laboratorio per La Bambola** (tour, prezzi solo se ufficiali, disponibilità mai inventata, escalation a umano per prenotazioni); `OPENROUTER_API_TOKEN` e modello in produzione; budget mensile | Stefano + team + cliente | 1 giorno | Corsa del Laboratorio senza allucinazioni su prezzi/disponibilità, escalation corretta |
| A7 | **Chi risponde**: persona, orari, numero per l'avviso di handoff, regola "l'AI non conferma prenotazioni" | Stefano + cliente | 1 h | Scritto nella scheda cliente e configurato nel CRM |
| A8 | **Contratto, DPA e informativa** per l'uso di AI su WhatsApp, retention dei messaggi, opt-in | Stefano (skill business-administration) | 0,5 giorno | Firmato prima del primo messaggio reale |

### B. Necessario per il perimetro del 9/10 (Instagram, Facebook, sito)

| # | Cosa | Opzioni | Stima |
|---|---|---|---|
| B1 | **Richieste dal sito** `labambolamorrocoy.com` nell'inbox | Endpoint nel CRM `POST /api/inbound/webform` per organizzazione (chiave `vbk_`), che crea contatto + conversazione "web" e lead in pipeline; form Elementor/WP → n8n o diretto. Oggi non esiste | 2–3 giorni |
| B2 | **Instagram DM nell'inbox del CRM** | (a) *Rapido:* usare **DM by Heili** per Instagram (inbox esistente, workspace per cliente, 10 min per collegare l'account): due pannelli, nessuna AI. (b) *Completo:* adattatore Instagram Messaging nel CRM: modello identità multi-canale (oggi `contact.wa_identity`), webhook `instagram` sulla stessa app, invio via Graph `/{ig_id}/messages`, finestra 24 h, niente template, media diversi | (a) 1 giorno · (b) 2–3 settimane |
| B3 | **Facebook Messenger nell'inbox** | Solo (b): adattatore Messenger Platform (`pages_messaging`), stessa app, stesso modello identità; nessuno dei moduli attuali lo copre | 1–2 settimane (dopo B2b, condivide il modello) |
| B4 | **Permessi Meta per IG/FB** del cliente: pagina e account IG Business nel portfolio di La Bambola, app con `instagram_manage_messages` e `pages_messaging`; accesso standard basta se l'app è nel portfolio del cliente, altrimenti App Review | Stefano + cliente | 0,5 giorno + attesa Meta |
| B5 | **Identità unificata** (stessa persona su WhatsApp, Instagram, sito): il briefing chiede di tenerle separate salvo link verificato. Va deciso e, se si unifica, serve una tabella identità per canale | Decisione + Codex | 2–3 giorni |

**Raccomandazione:** primo rilascio = WhatsApp + sito (A + B1), Instagram tramite DM by Heili (B2a), Facebook rinviato. Gli adattatori completi (B2b, B3) diventano il pacchetto successivo, dopo il pilota.

### C. Necessario per L2 (prodotto per 3–5 organizzazioni)

| # | Cosa | Stima |
|---|---|---|
| C1 | **Wapi in produzione come gateway**: merge di `phase-0` (inbox durevole, retry), riallineamento di `master` alla produzione, CI, app "Whapi by Heili" Live, **C3** nel CRM (chiave Wapi per organizzazione), webhook Meta → Wapi | 1–2 settimane |
| C2 | **Tech Provider + accesso avanzato** per l'app (App Review con screencast): senza, ogni cliente deve avere la propria app o condividere il WABA | 2–4 settimane di attesa Meta, 1 giorno di lavoro |
| C3 | **Infra riproducibile**: repo infra con Caddy, compose, script; deploy da CI con tag; health che espone il commit; staging documentato | 3–4 giorni |
| C4 | **Monitoraggio e alert**: uptime, errori del webhook, scadenza/revoca token, qualità del numero, costi AI per organizzazione | 2–3 giorni |
| C5 | **Onboarding < 60 min senza SSH**: SOP provata su un'organizzazione nuova, inviti con link (spec 004), guida cliente, template "pacchetto base" | 3–4 giorni |
| C6 | **Hardening**: RLS o almeno test d'integrazione cross-organizzazione su Postgres reale; rate limit condiviso se più repliche; audit dipendenze sul lockfile del CRM; redazione log | 3–5 giorni |
| C7 | **Metering e fatturazione**: conversazioni, messaggi, token AI per organizzazione; listino CRM+AI; fattura | 3–5 giorni |
| C8 | **Supporto e continuità**: runbook incidenti, rotazione chiavi, secondo amministratore con accesso al VPS, account nominativi per Juan e Mandeep | 1–2 giorni |
| C9 | **Igiene del codice**: C4 del mandato (branch residui del fork, README), merge disciplinato dei branch `claude/*` e `codex/*` fermi | 1 giorno |

### D. Dopo (non serve per essere operativi)
- C5/C6 del mandato: il CRM alimenta il Brain di Heili; identità unica OIDC. Il briefing del 9/10 lo rimanda esplicitamente.
- Pagamenti e sincronizzazione con un sistema di prenotazione per La Bambola: scoping separato.

---

## 5. Sequenza consigliata

| Settimana | Obiettivo | Pacchetti |
|---|---|---|
| **1** (fino al 16/10) | Catena provata sul nostro numero, codice sicuro per 2 organizzazioni | A1, A2, A3, A5; parte Meta di A4 avviata (attese); contratto A8 in bozza |
| **2** (fino al 23/10) | La Bambola riceve e risponde su WhatsApp dal CRM | A4 chiuso, A6, A7; B1 (sito); B2a (Instagram via DM by Heili) |
| **3** (fino al 30/10) | Esercizio con il cliente, correzioni, metriche | Revisione giornaliera dell'inbox; nuova corsa del Laboratorio; C4 minimo (uptime + errori webhook); C8 |
| **4–6** (novembre) | Verso il pilota commerciale | C1, C2 (avvio subito, l'attesa è lunga), C3, C5, C6, C7; decisione su B2b/B3 |
| **Dicembre** | 3–5 organizzazioni, solo se le porte di sicurezza, onboarding, affidabilità e ripristino sono passate | — |

---

## 6. Rischi principali

1. **Scope creep del 9/10.** Instagram e Facebook nel CRM sono 3–5 settimane di sviluppo nuovo: se restano nel primo rilascio, La Bambola non parte prima di fine novembre. Usare DM by Heili per Instagram è il compromesso che non blocca.
2. **Due organizzazioni con chiavi globali.** Finché C1/C2 non sono in produzione, un bot o un export con la chiave d'istanza può leggere l'altra organizzazione. Nessun terzo cliente prima di A2.
3. **Nessun backup.** Un guasto del VPS cancella conversazioni e lead di tutti. A3 va fatto prima di caricare dati del cliente.
4. **Token temporaneo e verifica email Meta.** Se scade senza il permanente, il CRM si ferma e l'unico che può sbloccare è Stefano.
5. **Clientify sugli stessi WABA.** Due automazioni sullo stesso numero rispondono in due. Per ogni numero va scritto chi lo usa.
6. **Dipendenza da una persona.** Accessi VPS, Meta, token, deploy: tutto passa da Stefano. C8 riduce il rischio.

---

## 7. Cosa non ho verificato
- Produzione (container, variabili, versione in linea, numero reale di organizzazioni e utenti).
- Esito del test end-to-end dopo il 6/10.
- Se l'accesso standard dell'app copra un WABA condiviso da un altro portfolio (decisione A5): va provato o letto nella documentazione Meta.
- Il contenuto del branch `codex/phase-0-webhook-inbox` oltre al titolo dei commit (inbox durevole e paginazione).
- Il sito `labambolamorrocoy.com` (CMS, form, backend prenotazioni): il briefing stesso lo lascia da confermare.
