# CRM WhatsApp (Heili Orbit + Whapi) — stato reale e tempi al 5 ottobre 2026

> ⚠️ **Fotografia datata.** Il riferimento aggiornato è `VISIONE-ECOSISTEMA-CRM.md` (10/10/2026).

> Correzione: le organizzazioni di produzione sono "Negocio de Stefano Finoti" e "Hair extension Clinic", non InsidersLab e La Bambola.

**Modalità:** sola lettura. Nessun deploy, nessun segreto letto, nessuna modifica ai repo del CRM.
**Fonti:** repo `Insiderslab/vocero-crm`, `Insiderslab/wapi`, `Insiderslab/heili-dm`, `Insiderslab/heili-platform` (clonati oggi); audit "Heili — stato reale" del 1/10 su Drive; specifiche `specs/custom-heili/*`; branch di lavoro di oggi `claude/keen-ptolemy-l0kv8g`; Fireflies 19/8 e 14/9; Clientify (capacità account).
**Non verificato:** i servizi live (`crm.heili.cloud`, `whapi.heili.cloud`) non sono raggiungibili da questo ambiente (proxy 403). Tutto ciò che riguarda la produzione viene dai documenti, non da una prova dal vivo.

## 1. Risposta breve

- **Bozza dimostrativa in qualche ora: sì.** Il CRM è completo come prodotto v1 e ha i dati demo integrati. In mezza giornata si creano le organizzazioni dei clienti, si carica la base di conoscenza, si configura l'agente AI e si fa girare il Laboratorio con i clienti simulati. Tutto senza toccare WhatsApp reale.
- **Clienti operativi su WhatsApp reale in qualche ora: no**, salvo che esista già un numero Meta collegato in produzione (dato non verificabile da qui). Il collo di bottiglia non è il codice ma Meta: numero, WABA, token, verifica dell'azienda, template approvati.
- **Stima realistica per 2–3 clienti operativi:** 1–2 settimane di calendario, con circa 4–6 giornate di lavoro nostro. La parte Meta (verifica business e review) può durare da 2 giorni a 2 settimane e non dipende da noi.

## 2. Che cosa esiste (verificato sul codice)

| Componente | Cosa fa | Stato |
|---|---|---|
| `vocero-crm` (fork MIT di kevinrivm, "Heili Orbit") | Inbox WhatsApp in tempo reale, pipeline kanban, agente AI con base di conoscenza, Laboratorio di auto-valutazione, template Meta, media, multi-utente, multi-organizzazione, tag, API di export, automazioni (tag + cadenza + template), API per bot esterni | Codice completo. Gate locale eseguito oggi: typecheck ok, lint ok, **268 test su 268 verdi** (36 file). Deploy dichiarato su `crm.heili.cloud` con 2 organizzazioni (InsidersLab, La Bambola) |
| `wapi` ("Whapi by Heili") | Gateway Meta Cloud API multi-cliente: credenziali per numero, proxy Graph, webhook inbound con firma, inoltro al CRM | Codice presente, ~55 test, **nessuna CI**. In produzione gira da un commit non su `master` (audit P5) |
| Fase 4 (CRM → Wapi) | Adattatore nel trasporto Graph (`src/lib/meta/client.ts`), variabili `WAPI_*` | Implementata e testata (E2E 87/87 + 40/40 con mock). **Mai deployata in produzione** secondo la spec 003 |
| Fasi 1–3 custom | Admin multi-org, tag, export API, automazioni | Deployate il 20/8 (commit `38bdc65`) |
| `heili-dm` | Instagram commento → DM | Operativo dal 30/8, test end-to-end riuscito. Non c'entra con WhatsApp ma dimostra che la pipeline Meta app → produzione è già stata fatta una volta |

Il lavoro di oggi (branch `claude/keen-ptolemy-l0kv8g`, 9 commit, non ancora in `main`): chiavi bot ed export **per organizzazione** (pacchetti C1 e C2 del mandato del 2/10), 302 test verdi, procedura di rilascio scritta in `docs/ops/rilascio-c1.md`. È security-critical e aspetta revisione e merge dell'owner.

Sempre oggi, su `wapi`, lo stesso branch `claude/keen-ptolemy-l0kv8g` (7 commit, non in `master`) aggiunge la CI minima (lint, typecheck, test, build, audit), il limite ai tentativi di login e l'aggiornamento di Next a 16.3.8, e registra la revisione di `phase-0`.

## 3. Che cosa blocca i "clienti operativi"

In ordine di gravità.

1. **Meta WhatsApp Cloud API per ogni cliente.** Servono WABA, Phone Number ID e token permanente. Due strade:
   - *Modo diretto*: il cliente ha la propria app Meta e incolla le credenziali nel wizard del CRM. Zero review per noi, ma ogni cliente deve avere un account Meta Business verificato e un numero libero.
   - *Modo agenzia (Whapi)*: una sola app Meta nostra, numeri dei clienti sotto di essa. Richiede verifica dell'azienda su Meta e accesso avanzato ai permessi WhatsApp. Tempi Meta: da 2 giorni a 2 settimane.
   In entrambi i casi il numero del cliente **non può restare sull'app WhatsApp Business del telefono** come oggi, salvo coexistence (che richiede l'Embedded Signup, non implementato in Wapi). Questa è la decisione più delicata da prendere con ogni cliente.
2. **Isolamento tra clienti.** Su `main` la Bot API sceglie un'organizzazione arbitraria e la chiave di export legge qualsiasi organizzazione (audit P3). Con un solo cliente non si vede; con due o tre è una fuga di dati. Il fix C1/C2 esiste sul branch di oggi, ma va unito e rilasciato con la procedura (backup, migrazioni 0009/0010, una chiave per organizzazione, rimozione delle chiavi globali). Manca ancora **C3**: una chiave Wapi per organizzazione (oggi `WAPI_API_KEY` è unica).
3. **Wapi non allineato.** Produzione da commit fuori da `master`; inoltro dei webhook al CRM "fire-and-forget" senza coda (audit P7): se il CRM è giù per un minuto, i messaggi dei clienti si perdono. Il fix è sul branch `codex/phase-0-webhook-inbox` (7 commit, 27/9), non unito.
4. **Nessun backup del CRM e di Wapi** (audit P4). Prima di mettere dati di clienti reali serve almeno un `pg_dump` giornaliero fuori dal VPS.
5. **Template Meta.** Fuori dalla finestra di 24 ore si scrive solo con template approvati. L'approvazione richiede da minuti a 24 ore per template. Le automazioni del CRM usano solo template approvati, quindi senza template approvati le automazioni non partono.
6. **Dettagli di configurazione.** `.env.example` del CRM usa `wapi.heili.cloud`, ma il DNS esiste solo per `whapi.heili.cloud`. Il webhook del CRM non è fail-closed senza `META_APP_SECRET` (va impostato uguale al segreto dell'endpoint in Wapi).

## 4. Due percorsi possibili

### Percorso A — bozza oggi, clienti reali in 1–2 settimane (consigliato)

| Quando | Cosa | Chi |
|---|---|---|
| Oggi, 3–4 ore | Creare le organizzazioni dei clienti dal pannello admin; un utente per cliente; base di conoscenza (domande/risposte + blocchi liberi) presa da sito, listino e FAQ; tono e regole di escalation dell'agente; corsa del Laboratorio e correzione finché lo score è accettabile. Tutto in sandbox: nessun messaggio reale | Noi, con il cliente che fornisce i contenuti |
| Giorno 1 | Chiedere a ogni cliente: account Meta Business, numero da dedicare (nuovo o migrato), chi risponde quando l'AI passa a un umano | Noi + cliente |
| Giorno 1–2 | Rilascio C1/C2 con la procedura scritta (backup, migrazione, chiavi per organizzazione). Backup off-site di CRM e Wapi | Owner |
| Giorno 2–3 | C3 (chiave Wapi per organizzazione) oppure, più semplice per partire, **modo diretto** per i primi clienti: ogni organizzazione con le proprie credenziali Meta, senza passare da Wapi. Il codice del modo diretto è quello dell'upstream, il più testato | Noi |
| Giorno 2–5 | Meta: numeri registrati sulla Cloud API, webhook puntato, 2–3 template per cliente inviati in approvazione (riapertura conversazione, promemoria, follow-up) | Noi + Meta |
| Giorno 5–10 | Primo messaggio reale per cliente, verifica stati inviato/consegnato/letto, handoff a umano, una settimana di esercizio con il cliente che guarda l'inbox | Noi + cliente |

Costo nostro stimato: 4–6 giornate. Costo cliente: 1–2 ore per fornire contenuti e accessi Meta.

### Percorso B — operativi in ore, con Clientify

L'account Clientify dell'agenzia ha già il modulo Comunicazioni con **un canale WhatsApp Web attivo**, 788 contatti, 3 pipeline e un'automazione "Nuevo Lead" pubblicata. Si potrebbe mettere un cliente in operatività oggi su Clientify, senza Meta review. Limiti: 1 solo canale WhatsApp Web nel piano, l'addon "API KEY Advanced" non è attivo (la Team Inbox non è automatizzabile via API), nessun agente AI con Laboratorio, e non è il nostro prodotto. È un ponte, non la destinazione.

## 5. Cosa serve dall'owner per partire

1. Conferma se in produzione esiste **almeno un numero Meta già collegato** (in Wapi o nel CRM). Cambia la stima da "settimane" a "giorni" per il primo cliente.
2. Quali clienti per la bozza (il salone/clinica del gruppo è indicato nell'audit come primo cliente CRM+Whapi; La Bambola è già un'organizzazione in produzione).
3. Via libera a: merge e rilascio di C1/C2 (branch di oggi), merge di `phase-0` in Wapi e riallineamento di `master` alla produzione, backup off-site.
4. Decisione modo diretto vs Whapi per i primi clienti (consiglio: diretto per partire, Whapi quando C3 è fatto e Meta ha verificato l'azienda).
5. Chiave OpenRouter e modello scelto per l'agente (oggi la variabile non ha un default).

## 6. Cosa non ho verificato

- Stato dei container, variabili e numeri in produzione (nessun accesso al VPS, rete bloccata).
- Se Meta ha già verificato l'azienda per l'app usata da `heili-dm` (se sì, il modo agenzia è più vicino).
- `pnpm build` del CRM (non eseguito per limiti di memoria dell'ambiente; typecheck, lint e test sì).
- Il task Monday "Avanzare sviluppo CRM cliente H e integrazione WhatsApp" (19/8): l'API Monday ha il limite giornaliero esaurito, non ho potuto leggerne il contenuto.
