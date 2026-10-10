# Onboarding La Bambola — tutti i canali nello stesso CRM (v2, 10/10/2026)

**Sostituisce la v1** (modo diretto con l'app del cliente). Decisioni di Stefano del 10/10:
- **una sola app Meta**, la nostra: 609974691965875, da rinominare **"Heili by InsidersLab"**;
- **niente Wapi**;
- **La Bambola parte con tutti i canali**: WhatsApp, sito, Instagram, Facebook.

L'app "La bambolaChatbot" del portfolio di La Bambola **non si usa più**: con un'app sola la firma dei webhook è una sola, il problema A5 dell'analisi.

**Cliente:** Catamarán La Bambola, Tucacas (Morrocoy, Venezuela). Portfolio Meta "La Bambola Morrocoy" `2451131388356181` (non verificato al 5/10). Instagram `@labambolamorrocoy`, Facebook `/labambolamorrocoy`, WhatsApp pubblicato 0414-432-4032, sito labambolamorrocoy.com.

## Come si collega ogni canale

| Canale | Come | Quando | Cosa serve da Meta |
|---|---|---|---|
| **WhatsApp** | Pulsante **"Collega con Meta"** nel CRM. Se lo 0414-432-4032 è sull'app WhatsApp Business del telefono: **coexistence**, l'app resta e il CRM riceve | Appena la PR #4 è in produzione e la configurazione v4 è creata | Finché non siamo Tech Provider, chi fa il collegamento dal lato La Bambola deve avere un **ruolo nella nostra app**: tester o sviluppatore. Da provare al primo tentativo |
| **Sito** | Modulo del sito → endpoint del CRM `POST /api/inbound/webform`: contatto + conversazione "web" + lead | Da sviluppare: 2–3 giorni | Nessuna |
| **Instagram** | Pulsante "Collega Instagram" (Business Login for Instagram, codice ripreso da DM by Heili) | Dopo M1 (livello canali, approvato il 10/10) e l'adattatore: **fine novembre** | Durante il pilota: l'account Instagram di La Bambola collegato da una persona con ruolo **tester** nella nostra app (accesso standard, niente App Review). Poi App Review |
| **Facebook Messenger** | Pulsante "Collega Facebook": si sceglie la Pagina | Come Instagram | Come Instagram: amministratore della Pagina con ruolo tester; poi App Review |

> Se si preferisce non aspettare fine novembre per tutto: WhatsApp + sito partono appena pronti, Instagram e Facebook entrano nello stesso CRM dopo, senza rifare niente. **Decisione attuale di Stefano: partire con tutto se si chiude in tempo.**

## 1. Da chiedere al cliente (call di 30 min)
- [ ] **Chi è amministratore** del portfolio Meta "La Bambola Morrocoy", della Pagina Facebook e dell'account Instagram. Ci servono **nome e profilo Facebook** di una persona per aggiungerla come **tester** della nostra app.
- [ ] Lo **0414-432-4032** è sull'app **WhatsApp Business** sul telefono (→ coexistence) oppure su un'altra piattaforma o un altro fornitore (→ va staccato prima)? Chi lo usa ogni giorno?
- [ ] **Verifica del portfolio** (Centro per la sicurezza): se manca, documenti della società. Serve per il nome visualizzato e per i limiti di invio.
- [ ] L'Instagram è **professionale** (Business o Creator) e collegato alla Pagina Facebook?
- [ ] **Tutti i dati della sezione 4** di `LA-BAMBOLA-AGENTE-KB.md`: prezzi con data di validità, orari, cosa è incluso, percorso, prenotazione e anticipo, pagamenti, politiche (cancellazione, meteo, minori), cosa portare.
- [ ] **Chi risponde** quando l'IA passa la conversazione a una persona: nome, orari, telefono per l'avviso. Lingue: qualcuno risponde in inglese?
- [ ] **Tono:** tu o usted, emoji sì o no, parole da evitare.
- [ ] **Modulo del sito:** su che piattaforma è fatto il sito (WordPress, Elementor, altro) e chi lo gestisce.
- [ ] **Contratto + DPA** per l'uso dell'IA sulle loro conversazioni (skill business-administration).

## 2. Lato Meta (prompt Chrome: `PROMPT-CHROME-LA-BAMBOLA.md`)
1. Nel portfolio di La Bambola, solo lettura: verifica, WABA e numeri, Pagina, Instagram, app collegate, partner.
2. Nella **nostra** app (con il tuo ok): aggiungere la persona di La Bambola come **tester**; lei accetta l'invito.
3. Metodo di pagamento sulla WABA di La Bambola: lo paga il cliente.
4. Dopo il collegamento: 2–3 modelli Utility in approvazione (riapertura della conversazione, promemoria del tour).

## 3. Lato CRM
1. `/admin` → organizzazione **"La Bambola"** con il primo utente owner del cliente.
2. **Impostazioni → WhatsApp → "Collega con Meta"**, con la persona di La Bambola al telefono. Va fatto entro 24 ore dall'inizio, perché lo storico e la rubrica Meta li dà solo in quella finestra.
3. **Agente:** profilo e base di conoscenza da `LA-BAMBOLA-AGENTE-KB.md`. Si caricano solo le voci **LISTA**; le **CONFIRMAR** dopo l'ok del cliente. **L'agente resta spento** finché il Laboratorio non passa.
4. **Laboratorio:** i 10 scenari della sezione 5. Nessun rosso su prezzi, conferme di prenotazione, iniezioni, reclami e dati di carta.
5. **Pipeline:** Nuovo → In conversazione → Interessato → Prenotazione confermata (solo umano) → Cliente → Perso.
6. **Team:** utente per chi risponde; mostrare come riattivare l'IA dopo il passaggio all'umano.
7. **Chiavi** `vbk_`/`vex_` dell'organizzazione La Bambola, solo se serve un bot esterno.

## 4. Due cose da correggere nel CRM prima del go-live (trovate preparando la base di conoscenza)
- Il prompt di sistema (`src/server/ai/prompts.ts`) **impone lo spagnolo**: un turista che scrive in inglese riceve risposte in spagnolo. Va resa configurabile la lingua per organizzazione, oppure si risponde nella lingua del cliente.
- Lo stesso prompt dice «se c'è intenzione d'acquisto → … e **conferma al cliente**»: rischia di far "confermare" una prenotazione. Va cambiato in «conferma di aver registrato la richiesta». Lo copre anche la regola 1 delle istruzioni di La Bambola.

## 5. Go-live e prima settimana
- [ ] Prova dal telefono di un collaboratore: messaggio, risposta dell'IA, passaggio all'umano, risposta dall'app del telefono (eco nel CRM, IA in pausa).
- [ ] Modulo del sito → lead nella Posta.
- [ ] Giorni 1–7: revisione quotidiana della Posta, domande nuove nella base di conoscenza, Laboratorio a fine settimana.
- [ ] Metriche per il cliente: conversazioni, tempo della prima risposta, % gestite dall'IA, lead in pipeline.

## 6. Prerequisiti lato nostro
- PR #3 ✅ unita (10/10). PR #4 (coexistence) in revisione, poi unione e **rilascio** (backup prima).
- Configurazione Embedded Signup v4 sulla nostra app, campi webhook, dominio dell'SDK.
- Backup giornaliero del database fuori dal VPS (M0.4).
- Prova dal vivo del +39 347 InsidersLab in coexistence (stesso flusso di La Bambola, fatto prima su noi).
