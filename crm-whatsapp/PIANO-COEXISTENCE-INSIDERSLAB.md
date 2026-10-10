# Piano — +39 347 718 5235 (InsidersLab) in coexistence: app WhatsApp Business sul telefono + CRM

> **Aggiornamento 10/10:** la Strada 2 (collegamento guidato nel nostro CRM) è implementata sul branch `claude/exciting-rubin-mow1yu` di `vocero-crm`. La Strada 1 (Clientify) non serve più. Passi operativi: `PERCORSO-COEXISTENCE.md`.

**Data:** 9/10/2026 · **Decisione di Stefano:** il numero resta sull'app del telefono **e** entra nel CRM (coexistence). Niente migrazione "solo API".

## Cosa sappiamo
- Numero: +39 347 718 5235, WABA "Insiderslab" `2780653498731208` di tipo **"App WhatsApp Business"**, portfolio Insiderlabs Business `404240226745821`. Stato al 5/10: **Non in linea**, nessun partner (REPORT-META-2026-10-05.md §2). Probabilmente un collegamento coexistence fatto in passato e poi caduto (l'app non aperta per più di 14 giorni, oppure scollegata).
- C'è già un caso che funziona in Italia: il +39 389 di Lumii è in coexistence con SparkinWeb/Cooperto (WABA `283406984860632`, Collegato).
- Fonti secondarie dicono che la coexistence è aperta in UE/Italia da novembre 2025 e ovunque da maggio 2026. Il changelog di Meta del 15/4/2026 conferma che si sono aperti gli ultimi due paesi (Nigeria e Sudafrica). Da confermare sulla pagina ufficiale "Onboarding Business app users".
- **CRM (main `2f4338d`):**
  - riceve `messages`;
  - gestisce già `smb_message_echoes`: le risposte scritte a mano dal telefono entrano come messaggi in uscita `origin='manual'` e mettono in pausa l'IA (`src/server/inbox/ingest.ts`, processEchoesValue);
  - **non gestisce** `history`, cioè l'import delle chat passate, né `smb_app_state_sync`, cioè la rubrica;
  - **non ha** il collegamento guidato di Meta (Embedded Signup);
  - accetta **un numero per organizzazione**.

## Come si attiva la coexistence
Solo con l'**Embedded Signup** di Meta, scegliendo l'opzione per i numeri dell'app WhatsApp Business. Sul telefono compare un QR o una conferma, si sceglie se condividere la cronologia, e il numero resta sull'app. Requisiti principali:
- app WhatsApp Business ≥ 2.24.17;
- aprire l'app almeno ogni **14 giorni**, se no il collegamento cade;
- con la coexistence alcune funzioni dell'app smettono di funzionare o non vengono sincronizzate: gruppi, messaggi effimeri, visualizza una volta, liste broadcast;
- limite di 20 messaggi al secondo.

## Due strade

### Strada 1 — Collegamento tramite un partner che ha già l'Embedded Signup (giorni) — consigliata per partire
1. Collegare il +39 347 in coexistence con un fornitore che lo offre già. **Clientify** lo offre (blog Clientify) ed è già partner sul WABA Insiderslab Team. Il WABA resta nel **nostro** portfolio, condiviso con il partner.
2. Dalla nostra app `609974691965875`: `POST {waba}/subscribed_apps` sul WABA del 347. Assegnare il WABA a `WhatsappBot` (**non toglierlo**, era tra le "risorse in più") e generare il token.
3. CRM: nuova organizzazione **InsidersLab** → Impostazioni → WhatsApp → WABA ID, Phone Number ID, token → Prova connessione → Salva.
4. Meta, webhook dell'app: aggiungere i campi `smb_message_echoes` (+ `message_template_status_update`).
5. Nel partner: **spegnere bot e risposte automatiche**, se no rispondono in due. Il partner resta solo come "tubo" (oppure come seconda inbox).

**Da verificare prima** (sola lettura):
- (a) il flusso Clientify accetta un numero già registrato come "App WhatsApp Business" ma non in linea?
- (b) dopo il collegamento il WABA risulta nel portfolio Insiderlabs Business, così la nostra app lo vede con l'accesso standard?
- (c) le condizioni di Clientify consentono un'altra app iscritta allo stesso WABA?

### Strada 2 — Embedded Signup nel nostro CRM (settimane) — serve comunque per i clienti
- **Meta:**
  - verifica dell'azienda **Insiderlabs Business** (da controllare: verificato risulta solo Lumii);
  - accesso avanzato per `whatsapp_business_management` e `whatsapp_business_messaging` (App Review);
  - stato di Tech Provider;
  - configurazione "Facebook Login for Business" con la versione attuale dell'Embedded Signup. Secondo una fonte secondaria la v2 viene dismessa il 15/10/2026: usare l'ultima.
- **CRM:**
  - pulsante "Collega WhatsApp" (SDK JS di Meta, scambio del codice per il token, salvataggio cifrato, `subscribed_apps`, niente `register` per i numeri in coexistence);
  - gestione dei webhook `history` e `smb_app_state_sync`;
  - gestione di `account_offboarded` e `account_reconnected` (changelog Meta, febbraio 2026), per mostrare "collegamento caduto, riapri l'app";
  - avviso dei 14 giorni.
- Stima: 1–2 settimane di sviluppo e test, più i tempi di revisione di Meta (non controllabili).

## Rischi
- Doppie risposte, se l'IA del CRM e un bot del partner sono attivi insieme.
- Collegamento che cade se l'app non viene aperta per 14 giorni.
- Le chat passate non entrano nel CRM finché non c'è la gestione di `history`.
- Prima di collegare il numero vero: finire la tabella C del test sul +1 555 (risposta manuale, IA, passaggio all'umano), con l'IA **spenta** sull'organizzazione InsidersLab fino ad allora.
