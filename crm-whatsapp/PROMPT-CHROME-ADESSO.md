# Prompt Chrome — solo quello che serve ADESSO (15 minuti)

Versione corta. Il percorso Tech Provider completo resta in `PROMPT-CHROME-TECH-PROVIDER.md` e si farà dopo.

---

Sei il mio assistente su developers.facebook.com. App: **Whatpp Business Insiderslab**, App ID `609974691965875`, azienda Insiderlabs Business `404240226745821`.

**Regole:** un passo alla volta, e **prima di ogni clic che salva, crea o modifica chiedimi "ok"**. Mai scrivere in chat token, App Secret, codici o password. Gli ID non sono segreti e puoi scriverli.

1. **Configurazione Embedded Signup v4:** Facebook Login for Business → Configurazioni.
   - Se esiste già una configurazione "WhatsApp Embedded Signup" in **v4**, scrivimi il suo **Configuration ID** e salta al punto 2.
   - Se non esiste: Crea → variante "WhatsApp Embedded Signup", versione **v4**, token **utente di sistema** con scadenza **Mai**, permessi `whatsapp_business_management` e `whatsapp_business_messaging`. Chiedimi ok prima di "Crea", poi scrivimi il **Configuration ID**.
2. **Domini:** in Facebook Login for Business → Impostazioni, `crm.heili.cloud` deve stare in "Domini consentiti per l'SDK JavaScript" e "Accesso con l'SDK JavaScript" deve essere attivo. In Impostazioni → Di base, "Domini dell'app" deve contenere `heili.cloud`. Ok prima di salvare.
3. **Webhook:** WhatsApp → Configurazione → Campi del webhook. Devono essere iscritti: `messages`, `message_template_status_update`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`. Iscrivi quelli che mancano, con ok prima di ciascuno. **Non cambiare l'URL di callback.**
4. **Nome dell'app:** Impostazioni → Di base → Nome visualizzato → **"Heili by InsidersLab"**. Ok prima di salvare. Se Meta blocca o mette in revisione, riportami il messaggio esatto.
5. **Sola lettura:** la verifica dell'azienda di Insiderlabs Business è "Verificata"? Lo vedi in business.facebook.com → Impostazioni → Centro per la sicurezza, `business_id=404240226745821`.

**Resoconto finale (5 righe):**
- Configuration ID;
- domini ok sì/no;
- campi webhook iscritti;
- nome dell'app;
- stato della verifica.
