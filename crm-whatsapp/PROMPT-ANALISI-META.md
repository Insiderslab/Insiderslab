# Prompt per la nuova sessione — analisi Meta con il connettore WhatsApp Business Tools

Da incollare in una nuova sessione Claude Code dopo aver collegato il connettore `WhatsApp Business Tools` (https://mcp.facebook.com/whatsapp_business_tools) su claude.ai → Connettori, con login sull'account amministratore di Socialinsiders.

---

Analizza a fondo la nostra situazione Meta/WhatsApp e dimmi cosa è sbloccato, cosa no e cosa fare, in ordine. Usa il connettore **WhatsApp Business Tools** (strumenti `whatsapp_biz_*`). Lingua: italiano.

**Regole**
- Prima solo lettura: nessuna modifica (webhook, template, numeri, pagamenti, messaggi) senza il mio "ok" esplicito per quel singolo passo.
- Non scrivere mai token, chiavi o codici in chat. Per il token di sistema dammi solo il link.
- Ogni affermazione con l'evidenza (output dello strumento o email). Se uno strumento risponde con un errore di prerequisito, riportamelo con il link che fornisce.
- Non inviare messaggi WhatsApp a nessuno.

**Contesto già noto (dal 5/10/2026, repo `Insiderslab/Insiderslab`, branch `claude/exciting-rubin-mow1yu`, cartella `crm-whatsapp/`): leggi `ANALISI-STATO-2026-10-05.md` e `GUIDA-SBLOCCO-META.md` prima di iniziare.**
- Business Manager Socialinsiders: `7017461864988773`.
- WABA "Ristorante Lumii": `1113982134244922`, numero `+39 0432 174 2374`, account di fatturazione WhatsApp `283406984860632`. Sospetto: il numero è usato da Cooperto, non da noi.
- App Meta WhatsApp "Whatpp Business Insiderslab": App ID `609974691965875`, Live dal 7/7/2026.
- App Meta Instagram "Dm Heili": `3536853626479911` (non toccarla).
- Nostri endpoint: gateway Wapi `https://whapi.heili.cloud/api/webhook`; CRM `https://crm.heili.cloud/api/webhooks/wa/<verify-token>`.
- Email Meta recenti: metodo di pagamento per i "messaggi di servizio" mancante sul WABA Lumii; "messaggi non consegnati per configurazione account o pagamenti" ogni mese da marzo ad agosto; nome visualizzato rifiutato due volte; nessuna email di esito della verifica dell'azienda.

**Cosa voglio, in quest'ordine**
1. `whatsapp_biz_businesses`: quali business amministro e quali ho concesso al connettore.
2. Per ogni business: `whatsapp_biz_accounts` e `whatsapp_biz_phone_numbers` con stato, qualità, limite di messaggistica, nome visualizzato e stato di registrazione di ogni numero. Dimmi quale app usa il numero di Lumii, se lo strumento lo mostra.
3. `whatsapp_biz_verify_business`: stato della verifica dell'azienda di Socialinsiders e cosa serve per avviarla o completarla.
4. `whatsapp_biz_configure_payments` in sola lettura: stato dei pagamenti del WABA, compreso il metodo per i messaggi di servizio. Non aggiungere nulla.
5. `whatsapp_biz_list_templates`: template per WABA con stato, lingua e categoria. Segnala quelli non nostri (`cooperto_*`).
6. Webhook attuale dell'app `609974691965875`: URL di callback, campi iscritti, WABA sottoscritti. Confronta con i nostri due endpoint e dimmi quale è configurato oggi.
7. Livello di accesso di `whatsapp_business_messaging` e `whatsapp_business_management` (standard o avanzato) e se il business dell'app risulta verificato. Se lo strumento non lo espone, dimmi dove lo leggo io nel pannello.
8. Prerequisiti: Termini del Cloud API accettati per il business? Sono amministratore sia del business sia dell'app?

**Consegna finale**
- Tabella "sbloccato / non sbloccato / da chiarire" per ogni voce sopra, con evidenza.
- Lista delle azioni da fare, in ordine, divise tra "le fai tu con il connettore dopo il mio ok" e "le faccio io nel pannello" (con URL esatto).
- Raccomandazione secca su come collegare i primi clienti: modo diretto nel CRM oppure gateway Wapi, con motivo e cosa cambia nel webhook. La mia preferenza di partenza è in `ANALISI-STATO-2026-10-05.md` §4.
- Salva il report in `crm-whatsapp/REPORT-META-<data>.md` sullo stesso branch e fai commit e push.
