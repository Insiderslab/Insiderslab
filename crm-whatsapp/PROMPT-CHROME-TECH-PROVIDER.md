# Prompt per Claude in Chrome — stato Tech Provider e richiesta

Da incollare nella sessione Chrome già collegata a Meta con l'account di Stefano.

---

Sei il mio assistente su Meta (business.facebook.com e developers.facebook.com). Obiettivo: capire se l'app **"Whatpp Business Insiderslab"** (App ID `609974691965875`, azienda **Insiderlabs Business** `404240226745821`) è già **Tech Provider** di WhatsApp. Se non lo è, avviare la richiesta. Serve per il collegamento guidato (Embedded Signup) con la **coexistence** nel nostro CRM: il cliente collega il numero della sua app WhatsApp Business senza toglierla dal telefono.

## Regole (non negoziabili)
- Vai un passo alla volta. **Prima di ogni clic che salva, invia, accetta termini o modifica qualcosa, fermati e chiedimi "ok"**. Leggere e aprire pagine si può fare senza chiedere.
- **Mai scrivere in chat** token, App Secret, codici di verifica, password, dati di carte. App ID e Configuration ID non sono segreti e si possono scrivere.
- Non inviare **App Review** (revisione dell'app) senza il mio ok esplicito. Probabilmente servirà un video del flusso funzionante nel CRM, che ancora non esiste: per ora prepariamo e basta.
- Non toccare il portfolio "Ristorante Lumii" (`7017461864988773`), i WABA di Lumii e quelli dei clienti.
- Per ogni dato riporta **dove l'hai visto** (pagina e sezione).

## Parte 1 — Sola lettura
1. **Verifica dell'azienda** di Insiderlabs Business: `https://business.facebook.com/settings/security?business_id=404240226745821` → Centro per la sicurezza → stato (Verificata / In corso / Non avviata / Rifiutata). Se manca, annota quali documenti chiede.
2. **App Dashboard** `https://developers.facebook.com/apps/609974691965875/`:
   - modalità (Live/Sviluppo), tipo di app, azienda collegata;
   - **Casi d'uso → WhatsApp** (o "Connetti con i clienti tramite WhatsApp"): c'è una sezione o un banner "**Diventa un Tech Provider**" / "Become a Tech Provider" / "Onboarding Tech Provider"? Riporta i passi elencati e lo stato di ognuno (di solito: verifica dell'azienda, App Review con accesso avanzato, **verifica dell'accesso** / Access Verification);
   - c'è la dicitura "Tech Provider" o "Solution Partner" da qualche parte (Impostazioni → Di base, Avvisi, Casi d'uso)?
3. **Autorizzazioni e funzioni** (App Review → Autorizzazioni e funzioni, oppure Casi d'uso → Personalizza): livello di accesso (Standard / Avanzato) e stato per `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`.
4. **Verifica dell'accesso** (Access Verification): `https://developers.facebook.com/apps/609974691965875/` → Impostazioni → Di base, oppure sezione "Verifica" / "Verification": stato.
5. **Facebook Login for Business → Configurazioni**: esiste già una configurazione per WhatsApp Embedded Signup? Se sì: nome e **Configuration ID**.
6. **WhatsApp → Configurazione → Webhook**: URL di callback (scrivi solo `https://crm.heili.cloud/api/webhooks/wa/…`, **senza il token**) e campi iscritti. Mi interessano `messages`, `message_template_status_update`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.

Alla fine della Parte 1 dammi una tabella: elemento · stato · dove l'hai visto · cosa manca. Poi fermati.

## Parte 2 — Se NON è Tech Provider: avviare la richiesta (con il mio ok a ogni passo)
Segui il percorso che Meta mostra nell'App Dashboard ("Diventa un Tech Provider"). Ordine tipico:
1. **Verifica dell'azienda** Insiderlabs Business, se non è già verificata. Prepara la lista dei documenti richiesti e **chiedimi** prima di caricare qualsiasi cosa.
2. **Termini**: se compaiono i termini per Tech Provider / WhatsApp Business Solution, mostrameli riassunti e aspetta l'ok.
3. **Configurazione Embedded Signup**, se non esiste: Facebook Login for Business → Configurazioni → Crea → modello/variante **"WhatsApp Embedded Signup"**, **versione v4** (Meta dismette v2/v3 intorno al 15/10/2026: non scegliere una versione precedente; se il pannello offre solo "v4-public-preview", dimmelo prima di creare). Tipo di token: **System-user access token** (token utente di sistema), scadenza **Mai** se disponibile. Asset: account WhatsApp, permessi `whatsapp_business_management` e `whatsapp_business_messaging`. Chiedi ok prima di "Crea", poi scrivimi il **Configuration ID**.
4. **Dominio consentito per l'SDK JavaScript**: in Facebook Login for Business → Impostazioni, aggiungi `crm.heili.cloud` a "Domini consentiti per l'SDK JavaScript" e attiva "Accesso con l'SDK JavaScript" (ok prima di salvare). In Impostazioni → Di base, controlla che "Domini dell'app" contenga `heili.cloud` (ok prima di salvare).
5. **Campi webhook**: aggiungi `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`, `message_template_status_update` se mancano. Non cambiare l'URL di callback. Ok prima di ogni iscrizione.
6. **App Review / accesso avanzato**: apri la pagina, elenca cosa chiede per `whatsapp_business_management` e `whatsapp_business_messaging` (descrizione dell'uso, video, istruzioni per il revisore) e **fermati**. Non inviare.
7. **Verifica dell'accesso** (Access Verification): se è già disponibile, riporta cosa chiede e fermati prima di inviare.

## Resoconto finale
- Tabella di stato aggiornata (Parte 1 + cosa è stato fatto nella Parte 2).
- **App ID** e **Configuration ID** (non segreti), da inserire nel CRM come `META_APP_ID` e `META_ES_CONFIG_ID`.
- Elenco di cosa resta e chi lo deve fare (io, Meta, sviluppo CRM), con le attese che Meta indica.
