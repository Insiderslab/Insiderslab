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
