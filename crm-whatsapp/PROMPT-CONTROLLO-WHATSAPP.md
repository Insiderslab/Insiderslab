# Prompt — controllo WhatsApp e chiusura dei passi aperti (sessione con Chrome)

Da incollare nella sessione Claude che lavora nel Chrome di Stefano, già loggato su Meta.

---

Controlla che su WhatsApp sia tutto a posto e aiutami a chiudere quello che manca. Lingua: italiano.

**Regole**
- Fase 1 è solo lettura. Nella fase 2, prima di ogni clic che salva, modifica, invia o paga: fermati e chiedimi "ok".
- Token, App Secret, token di verifica e codici: mai scritti in chat. Quando compaiono dimmi solo "copialo ora" e aspetta.
- Nessun messaggio WhatsApp inviato a numeri reali di clienti.
- Ogni affermazione con la pagina da cui viene.

**Contesto (repo Insiderslab/Insiderslab, branch claude/exciting-rubin-mow1yu, cartella crm-whatsapp/):** leggi `ANALISI-COMPLETA-2026-10-09.md`, `RUNBOOK-TEST-E2E.md` (soprattutto il "Registro di esecuzione" del 5/10 e 6/10) e `REPORT-META-2026-10-05.md`. ID utili:
- Portfolio Insiderlabs Business `404240226745821` · app "Whatpp Business Insiderslab" `609974691965875` (Live) · app "Whapi by Heili" `1017740407963024` (in sviluppo)
- WABA Insiderslab Team `1027272492350148` · numero +1 555 779 6249 · Phone Number ID `671133866076775`
- Utente di sistema `WhatsappBot` `61572964465934`
- CRM: `https://crm.heili.cloud`, organizzazione InsidersLab

## Fase 1 — Controllo (sola lettura), poi tabella riassuntiva
1. **Account Meta**: Centro gestione account → Dati personali → Contatti: qual è l'email principale. Password e sicurezza: c'è un'app di autenticazione o un telefono? (Serve a sbloccare il token permanente: il 6/10 il codice email non arrivava.)
2. **Utente di sistema WhatsappBot**: elenco risorse assegnate. Attese solo l'app 609974691965875 e il WABA 1027272492350148; il 6/10 ne erano state aggiunte 5 in più per errore (Pixel/Dataset, 2 WABA "Insiderslab", Test WABA). Riporta quali ci sono ancora. Ci sono token attivi?
3. **App 609974691965875 → WhatsApp → Configurazione → Webhook**: URL di callback attuale (n8n o CRM?), campi iscritti, WABA Insiderslab Team iscritto sì/no.
4. **WhatsApp Manager → Insiderslab Team**: stato del numero, qualità, limite di messaggi, nome visualizzato, metodo di pagamento, modelli (quanti, stato).
5. **Partner del WABA Insiderslab Team**: Clientify ha ancora il controllo completo? Altri partner?
6. **CRM**: Impostazioni → WhatsApp dell'organizzazione InsidersLab: numero connesso sì/no, `token …last4`, eventuale avviso "token scaduto o revocato", sezione Webhook con URL mostrata sì/no. Impostazioni → Modelli: cosa vede. Agente: c'è l'avviso "Manca la chiave IA dell'istanza"?
7. **CRM, organizzazione La Bambola**: WhatsApp connesso sì/no (solo lettura).
8. **Portfolio La Bambola Morrocoy** (se ho accesso): verificato sì/no; account WhatsApp e numeri presenti; app "La bambolaChatbot" e il suo webhook.

Consegna la fase 1 come tabella `Voce | Atteso | Trovato | OK / Da fare`, poi la lista "Da fare" in ordine di priorità. Fermati e aspetta il mio "vai".

## Fase 2 — Chiudere i passi aperti (uno alla volta, "ok" prima di ogni salvataggio)
Esegui solo quelli risultati "Da fare", in quest'ordine:
1. **Token permanente** per WhatsappBot (app 609974691965875, scadenza Mai, `whatsapp_business_messaging` + `whatsapp_business_management`). Se la verifica email blocca ancora, fermati e dimmi quale metodo alternativo Meta propone.
2. **Rimuovere da WhatsappBot** le risorse in più (lasciare solo app + WABA Insiderslab Team).
3. **App Secret**: Impostazioni → Di base → Mostra → "copialo ora" e aspetta (serve come `META_APP_SECRET` nel CRM, lo imposto io).
4. **Webhook verso il CRM**: copia la URL dal CRM (Impostazioni → WhatsApp → Webhook, con il pulsante). Se il CRM non la mostra, fermati: manca `META_WEBHOOK_VERIFY_TOKEN` in produzione. Altrimenti compila nell'app: URL, token di verifica = segmento finale della URL, campi `messages` + `message_template_status_update`. Mostrami il form, aspetta l'ok, poi "Verifica e salva". Se fallisce, riporta l'errore esatto senza riprovare.
5. **Iscrivi il WABA** Insiderslab Team all'app.
6. **CRM → Impostazioni → WhatsApp**: WABA `1027272492350148`, Phone Number ID `671133866076775`, token → "Prova connessione" (atteso "Token valido per +1 555 779 6249") → Salva dopo l'ok.
7. **Modelli**: Sincronizza; se non ce n'è nessuno, prepara un modello Utility "Ciao {{1}}, riprendiamo la conversazione quando vuoi." e invialo in approvazione dopo l'ok.
8. **Test**: io scrivo "ciao" al +1 555 779 6249 da un telefono; tu guardi l'inbox e compili la tabella C del runbook (arrivo in inbox, risposta AI, risposta manuale, handoff, finestra 24 h).

## Consegna finale
Resoconto con **FATTO / NON FATTO / AZIONI PER STEFANO**, come il 6/10. Lo incollo nella sessione cloud che aggiorna il registro nel repo.
