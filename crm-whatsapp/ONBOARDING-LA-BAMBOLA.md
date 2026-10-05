# Onboarding primo cliente sul CRM WhatsApp — La Bambola (modo diretto)

**Perché La Bambola:** è già un'organizzazione nel CRM in produzione (`docs/ops/rilascio-c1.md` del branch C1) e ha già un portfolio Meta proprio ("La Bambola Morrocoy") con un'app "La bambolaChatbot" (REPORT-META §10). Il modello è quello giusto per oggi: WABA e app nel portfolio **del cliente**, credenziali incollate nel CRM, nessuna review Meta per noi.

## 1. Da chiedere al cliente (30 min di call)
- [ ] Chi ha accesso admin al portfolio Meta "La Bambola Morrocoy" e all'app "La bambolaChatbot". Se non è Stefano, farsi aggiungere come **Amministratore** del portfolio e dell'app.
- [ ] Il portfolio è **verificato**? (Impostazioni → Centro per la sicurezza). Se no: visura/documento della società + email di dominio. 2–5 giorni lavorativi.
- [ ] **Numero** da usare: nuovo (consigliato, SIM o numero fisso che riceve SMS/chiamata) oppure migrazione del numero attuale dall'app WhatsApp Business del telefono (si perde l'uso sull'app e le chat sul telefono: va detto in chiaro).
- [ ] **Nome visualizzato** = ragione sociale o insegna così come appare su sito e Google, senza aggiunte.
- [ ] **Chi risponde** quando l'AI passa a un umano: nome, orari, numero personale per l'avviso.
- [ ] **Contenuti per la base di conoscenza:** listino, orari, indirizzo, servizi, domande frequenti, cosa NON dire (prezzi non ufficiali, promesse mediche, ecc.), tono (tu/lei, lingua IT/ES).
- [ ] **Metodo di pagamento** Meta del cliente (carta) per il suo WABA: paga lui le conversazioni.
- [ ] Consenso scritto al trattamento dei messaggi tramite il CRM e l'AI (clausola nel contratto; DPA se il cliente lo chiede).

## 2. Lato Meta, nel portfolio del cliente (45 min, con il cliente o con accesso admin)
1. WhatsApp Manager → *Aggiungi numero* → verifica via SMS → nome visualizzato → categoria.
2. Utente di sistema del cliente → assegna app "La bambolaChatbot" + WABA → token permanente con `whatsapp_business_messaging` + `whatsapp_business_management`. Il token lo incolla chi fa il setup direttamente nel CRM.
3. Nell'app del cliente: webhook → URL del CRM (`https://crm.heili.cloud/api/webhooks/wa/<token-istanza>`, la stessa per tutte le organizzazioni: il CRM instrada per Phone Number ID) + campi `messages`, `message_template_status_update`; iscrivi il WABA all'app.
   - Attenzione: `META_APP_SECRET` del CRM è **uno per istanza**. Con app diverse per cliente la firma può essere verificata per una sola app. Opzioni: (a) il cliente aggiunge come amministratore la **nostra** app `609974691965875` al suo WABA tramite condivisione del WABA con Insiderlabs Business come partner, così l'app è unica; (b) si lascia la URL segreta come unica protezione per le app dei clienti. Decisione da prendere prima del secondo cliente; per il primo va bene (a) se il cliente accetta la condivisione, altrimenti (b).
4. Metodo di pagamento sul WABA del cliente.
5. 2–3 template in approvazione: riapertura conversazione (utility), promemoria appuntamento (utility), promo mensile (marketing, con opt-out).

## 3. Lato CRM (1 ora)
1. `/admin` (super-admin): organizzazione "La Bambola" esiste già; se manca, crearla con il primo utente del cliente (owner).
2. Entrare nell'organizzazione → **Impostazioni → WhatsApp** → WABA ID, Phone Number ID, token → Prova connessione → Salva.
3. **Agente**: nome, tono, istruzioni, regole di escalation; base di conoscenza dal materiale del punto 1 (coppie domanda/risposta + blocchi liberi).
4. **Laboratorio**: corsa completa; correggere la base di conoscenza finché score e rilievi sono accettabili (nessuna allucinazione sui prezzi, escalation corretta). Conservare il report come evidenza per il cliente.
5. **Pipeline**: adattare le fasi al cliente (es. Nuovo → In conversazione → Appuntamento fissato → Cliente → Perso).
6. **Tag + automazioni** (facoltativo al primo giro): un tag "da ricontattare" e una regola "ogni 7 giorni template X" solo quando il template è approvato.
7. **Team**: utente per chi risponde in handoff; mostrare come riattivare l'IA.
8. **Chiavi**: se un bot esterno o n8n deve leggere i dati, chiave `vbk_`/`vex_` **della sola organizzazione La Bambola** (dopo il rilascio C1/C2), mai la chiave d'istanza.

## 4. Go-live e prima settimana
- [ ] Messaggio di prova dal telefono del cliente; risposta AI; handoff; template.
- [ ] Il cliente pubblica il numero (sito, Google Business, bio Instagram, link `wa.me`).
- [ ] Giorno 1–7: controllo quotidiano dell'inbox da parte nostra, revisione delle risposte AI, aggiunta delle domande mancanti alla base di conoscenza, nuova corsa del Laboratorio a fine settimana.
- [ ] Metriche da riportare al cliente: conversazioni, tempo medio di prima risposta, % gestite dall'AI senza handoff, lead entrati in pipeline.

## 5. Prerequisiti lato nostro (prima di toccare il cliente)
- Test end-to-end riuscito sul nostro numero (`RUNBOOK-TEST-E2E.md`).
- Rilascio C1/C2 (chiavi per organizzazione) o, finché non è rilasciato, **nessuna** chiave bot/export d'istanza in uso con due organizzazioni.
- Backup giornaliero del database del CRM fuori dal VPS.
