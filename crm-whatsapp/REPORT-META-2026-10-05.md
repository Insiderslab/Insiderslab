# Report Meta / WhatsApp — stato reale al 5 ottobre 2026

**Modalità:** sola lettura. Nessuna modifica a webhook, template, numeri, pagamenti. Nessun messaggio inviato. Nessun token generato o letto.
**Strumento:** il connettore *WhatsApp Business Tools* (`whatsapp_biz_*`) **non è disponibile** in questa sessione (non risulta tra i connettori installati né nel registro: c'è solo "Meta Ads MCP", non collegato). L'analisi è stata fatta leggendo direttamente i pannelli Meta nel Chrome di Ste (già loggato): Meta for Developers, Business Suite → Impostazioni, WhatsApp Manager, Billing Hub. Ogni evidenza sotto indica la pagina da cui viene.

---

## 0. Tre correzioni al contesto di partenza (importanti)

1. **`7017461864988773` non è "Socialinsiders".** È il portfolio **"Ristorante Lumii"**, ragione sociale **FUSION TASTE SRL**, Reana del Rojale, **verificato il 5 mag 2026**. *Evidenza:* Business Suite → Informazioni business (`business_id=7017461864988773`).
2. **L'app "Whatpp Business Insiderslab" (`609974691965875`) appartiene a "Insiderlabs Business" (`404240226745821`)**, non a Socialinsiders né al portfolio di Lumii. *Evidenza:* developers.facebook.com/apps → riga dell'app "Azienda: Insiderlabs Business"; URL del pannello app con `business_id=404240226745821`.
3. **`283406984860632` non è un account di fatturazione: è un WABA** ("Ristorante Lumii Reana del Rojale", numero diverso). È lì che stanno i template `cooperto_*` e `wa_*`, non sul WABA `1113982134244922`. *Evidenza:* Impostazioni → Account WhatsApp e WhatsApp Manager → Modelli.

---

## 1. Business e ruoli (punto 1 e 8)

| Portfolio | ID | Verifica azienda | Ruolo di Ste | Evidenza |
|---|---|---|---|---|
| **Insiderlabs Business** (INSIDERSLAB **SAS** di Finoti Stefano & C., Via Argentina 25 Udine) | 404240226745821 | **Verificato, 27 giu 2026**. "Access verification" (Tech Provider): **non avviata** ("Avvia verifica") | Accesso completo | Informazioni business; Persone |
| **Ristorante Lumii** (FUSION TASTE SRL) | 7017461864988773 | **Verificato, 5 mag 2026** | Accesso completo (+ Finanza gestione) | Informazioni business; Persone |
| Socialinsiders | non individuato | non verificato in questa sessione | — | Compare solo come proprietario dell'app "Gestione Campagne" |

Altri portfolio visibili nel selettore (tra cui Hair Extensions Clinic, La Bambola Morrocoy, Avant Costruzioni, Ginial, Elpidios…): non analizzati.

**App 609974691965875 — ruoli:** Amministratori **Stefano Finoti Araya** e **Manik Roy**. *Evidenza:* App → Ruoli. Da confermare che Manik Roy debba avere ancora quel ruolo.

**Termini Cloud API:** il pannello non li mostra. Il fatto che su Insiderlabs Business ci sia un numero **registrato** sulla Cloud API (sotto) indica che sono stati accettati, ma è una deduzione. Si leggono in WhatsApp Manager → Panoramica dell'account.

---

## 2. Account WhatsApp e numeri (punto 2)

### Portfolio Ristorante Lumii (7017461864988773)

| WABA | ID | Numero | Nome visualizzato | Stato | Qualità | Partner con controllo completo | Pagamento | Evidenza |
|---|---|---|---|---|---|---|---|---|
| **Ristorante Lumii** | 1113982134244922 | **+39 0432 174 2374** (Phone ID 827727510422871) | "Ristorante Lumii Reana" → **Rifiutato**; banner "Lumii Cooperto rifiutato" | Collegato | Alta | **Clientify** | Billing Hub: MasterCard ····4001, nessuna spesa recente, saldo 0 €. Riepilogo WABA: "Nessun metodo di pagamento trovato" (in contrasto, vedi §4) | Impostazioni → Account WhatsApp; WhatsApp Manager → Numeri |
| Ristorante Lumii Reana del Rojale *(App WhatsApp Business)* | 283406984860632 | +39 389 059 3069 | "Ristorante Lumii Reana de…" | Collegato | Alta | **SparkinWeb srl** | MasterCard ····4001, saldo 2,84 € | idem |
| Lumii Whatsapp | 812296977938877 | +39 389 059 3069 (stesso numero) | "Lumii" | **Non verificato** | — | nessuno | MasterCard ····4001 | idem |

**Limite di messaggistica del +39 0432 174 2374:** **2.000** conversazioni avviate dall'azienda / 24 h; prossimo livello 10.000. **133 conversazioni con clienti unici negli ultimi 7 giorni** (quindi il numero è in uso attivo). *Evidenza:* WhatsApp Manager → Limiti di messaggi, aggiornato 5 ott 23:10.

**Quale app usa il numero di Lumii:** il pannello non mostra l'app per nome. Mostra però che il WABA `1113982134244922` è condiviso con **Clientify** (controllo completo) e non è visibile nell'app 609974691965875. Quindi oggi **non è nostro in senso operativo**: lo usa Clientify. I template Cooperto e il partner SparkinWeb srl stanno sull'altro WABA (`283406984860632`, numero 389). Il sospetto "Cooperto" va quindi spostato: **0432 → Clientify; 389 → SparkinWeb/Cooperto (coexistence con l'app WhatsApp Business)**.

### Portfolio Insiderlabs Business (404240226745821)

| WABA | ID | Numero | Nome | Stato | Qualità | Partner | Pagamento |
|---|---|---|---|---|---|---|---|
| **Insiderslab Team** | 1027272492350148 | **+1 555 779 6249** (Phone ID 671133866076775) | "Insiderlabs", visibile ai clienti | **Collegato, Registrato** | Alta | Clientify | **Nessun metodo di pagamento** |
| Insiderslab *(App WhatsApp Business)* | 2780653498731208 | +39 347 718 5235 | "Insiderslab" | **Non in linea** | — | nessuno | — |
| Insiderslab | 1569747938189603 | nessun numero | — | — | — | nessuno | nessuno |
| Test WhatsApp Business Account | 2153322095219505 | +1 555 615 0255 (numero di prova Meta) | Test Number | Collegato | Alta | nessuno | — |

*Evidenza:* Impostazioni → Account WhatsApp (tab Numeri, Partner, Riepilogo); App 609974691965875 → Casi d'uso → WhatsApp → Passaggio 1 e Passaggio 2.

**Utenti di sistema di Insiderlabs Business:** `WhatsappBot` (Admin, **nessuna risorsa assegnata**), `Openclaw` (Employee), `Employee` (Employee). *Evidenza:* Impostazioni → Utenti di sistema. Non ho generato né letto token.

---

## 3. Verifica dell'azienda (punto 3)

- **Insiderlabs Business: verificata (27/6/2026).** Il pannello dell'app al Passaggio 3 dice "Approvata". Attenzione: la ragione sociale registrata è ancora **"INSIDERSLAB SAS"**; se la forma è cambiata in SNC, va aggiornata (e Meta può chiedere di rifare la verifica).
- **Ristorante Lumii: verificata (5/5/2026).**
- Il testo "Puoi aggiungere fino a 2 numeri… dopo la verifica fino a 20" nel Passaggio 2 è un messaggio generico: con la verifica già approvata il tetto dovrebbe essere 20. Da confermare aggiungendo il terzo numero quando servirà.
- **Mancante per il modello agenzia:** la **verifica dell'accesso (Tech Provider)** di Insiderlabs Business, mai avviata.

---

## 4. Pagamenti (punto 4)

- WABA Lumii `1113982134244922`: in Billing Hub ha MasterCard ····4001 e "Non hai spese recenti"; il riepilogo del WABA in Impostazioni dice invece "Nessun metodo di pagamento trovato". Il campo specifico **"metodo per i messaggi di servizio"** non è esposto in nessuna delle due pagine. Billing Hub chiede inoltre di **verificare le informazioni fiscali** (P.IVA non inserita). *Evidenza:* Billing Hub → Account WhatsApp Business → Ristorante Lumii → Visualizza dettagli.
- WABA Insiderslab Team `1027272492350148`: **nessun metodo di pagamento** (Impostazioni → Riepilogo; App → Passaggio 2 "Aggiungi il pagamento" non completato).
- Nessuna modifica fatta.

---

## 5. Template (punto 5)

**WABA 1113982134244922 (Ristorante Lumii, +39 0432…)** — 5 template attivi su 5, tutti Marketing, lingua dichiarata **Spanish** ma testo in italiano, 0 invii negli ultimi 7 giorni: `salute` (15/1/2026), `diciembre_24`, `botella` (12/12/2025), `hollewen` (17/10/2025), `mercolebrink` (16/10/2025). **Nessun `cooperto_*`.**

**WABA 283406984860632 (Reana del Rojale, +39 389…)** — 17 attivi, tutti Italian, stato "Attivo – Qualità in sospeso":
- **Non nostri (Cooperto):** `cooperto_degustazione_lumiii_x_terre_petrussa_22_luglio`, `cooperto_degustazione_lumiii_x_terre_petrussa_def`, `cooperto_degustazione_lumiii_x_terre_petrussa` (16/7/2026), `cooperto_anniversario_lumii_secondo_anno_`, `cooperto_anniversario_lumii_` (5/5/2026), `test_cooperto`.
- Probabilmente del sistema Cooperto/SparkinWeb (stessa data 4/5/2026, prefisso `wa_`): `wa_fidelity_card`, `wa_menu`, `wa_modulo_prenotazione`, `wa_sondaggio`, `wa_coupon` (Marketing); `supporto`, `wa_qr_3`, `wa_prenotazione_respinta_2`, `wa_prenotazione_accettata_2`, `test_con_immagini`, `utility_solo_testo` (Utility).

**WABA Insiderslab Team:** template non letti (da fare quando si decide di usarlo).

*Evidenza:* WhatsApp Manager → Gestisci modelli, filtro predefinito "8 opzioni", ultimi 7 giorni.

---

## 6. Webhook (punto 6)

| App | Modalità | URL di callback attuale | Campi iscritti | WABA visti dall'app |
|---|---|---|---|---|
| **Whatpp Business Insiderslab** 609974691965875 | Live | **`https://insiderslab.app.n8n.cloud/webhook/…`** (n8n cloud, percorso omesso) | solo **`messages`** (v25.0) | Insiderslab Team (+1 555 779 6249) e numero di test. Accanto al WABA c'è il pulsante "Iscriviti ai webhook": **probabilmente il WABA non è sottoscritto** all'app |
| **Whapi by Heili** 1017740407963024 | **In sviluppo** | **`https://whapi.heili.cloud/api/webhook`** | solo `messages` (v26.0) | Insiderslab Team (+1 555 779 6249) |

**Confronto con i nostri endpoint:**
- Gateway Wapi (`whapi.heili.cloud`): configurato, ma **sull'app sbagliata per la produzione** ("Whapi by Heili" è in sviluppo; un'app in sviluppo non riceve i webhook dei numeri reali, solo test).
- CRM diretto (`crm.heili.cloud/api/webhooks/wa/…`): **non configurato su nessuna app**.
- L'app Live punta a **n8n**: prima di cambiarla va capito se quel flusso n8n è ancora in uso.
- In entrambe le app mancano `message_template_status_update` (serve al CRM per sapere se un template è approvato) e, per i numeri in coexistence, `smb_message_echoes`.

*Evidenza:* App → Casi d'uso → WhatsApp → Passaggio 2 → Configura webhook (URL letto dal campo, token di verifica non letto).

---

## 7. Livello di accesso (punto 7)

App 609974691965875 → Autorizzazioni e funzioni:
- `whatsapp_business_messaging`: **"Pronta per il test" = accesso standard** (1 requisito aperto).
- `whatsapp_business_management`: **"Pronta per il test" = accesso standard** (1 requisito aperto).
- `business_management`: standard.
- Business dell'app: **verificato** (vedi §3).

Con l'accesso standard l'app lavora solo sui WABA del **proprio** portfolio (Insiderlabs Business). Per i WABA dei clienti (es. Lumii, in un altro portfolio) servono **accesso avanzato** (App Review) e **verifica Tech Provider**.
Dove leggerlo tu: `https://developers.facebook.com/apps/609974691965875/use_cases/customize/permissions/?use_case_enum=WHATSAPP_BUSINESS_MESSAGING`

---

## 8. Tabella riassuntiva

| # | Voce | Stato | Evidenza |
|---|---|---|---|
| 1 | Accesso ai business (Insiderlabs, Lumii) come admin | **Sbloccato** | Persone: "Accesso completo" in entrambi |
| 1 | Connettore `whatsapp_biz_*` | **Non sbloccato** | assente da connettori e registro |
| 1 | Business "Socialinsiders" | **Da chiarire** | l'ID dato è di Ristorante Lumii; Socialinsiders non c'entra con WhatsApp |
| 2 | Numero nostro registrato su Cloud API (+1 555 779 6249, Insiderslab Team) | **Sbloccato** | Collegato, Registrato, qualità Alta |
| 2 | Numero Lumii +39 0432 174 2374 utilizzabile da noi | **Non sbloccato** | WABA in un altro portfolio, partner Clientify, 133 conversazioni/7 gg in corso |
| 2 | Nome visualizzato Lumii | **Non sbloccato** | "Ristorante Lumii Reana" Rifiutato |
| 2 | Numero +39 347 718 5235 (Insiderslab, app WA Business) | **Non sbloccato** | Non in linea |
| 3 | Verifica azienda Insiderlabs Business | **Sbloccato** | Verificato 27/6/2026 |
| 3 | Verifica Tech Provider | **Non sbloccato** | "Avvia verifica" |
| 3 | Ragione sociale verificata = forma attuale (SNC) | **Da chiarire** | registrata come SAS |
| 4 | Pagamento WABA Insiderslab Team | **Non sbloccato** | "Nessun metodo di pagamento" |
| 4 | Pagamento/servizio WABA Lumii | **Da chiarire** | Billing Hub carta presente; riepilogo WABA "nessun metodo"; campo messaggi di servizio non esposto; info fiscali mancanti |
| 5 | Template nostri approvati | **Non sbloccato** | nessun template nostro; quelli presenti sono di Lumii/Cooperto |
| 6 | Webhook verso CRM o Wapi in produzione | **Non sbloccato** | app Live → n8n; app Wapi in sviluppo |
| 6 | WABA Insiderslab Team sottoscritto all'app | **Da chiarire** | pulsante "Iscriviti ai webhook" visibile |
| 7 | Accesso avanzato `whatsapp_business_*` | **Non sbloccato** | "Pronta per il test" |
| 8 | Ste admin dell'app 609974691965875 | **Sbloccato** | Ruoli: Amministratore (con Manik Roy) |
| 8 | Termini Cloud API | **Da chiarire** (probabile sì) | numero registrato; pagina non letta |
| — | Utente di sistema con WABA + app assegnati | **Non sbloccato** | WhatsappBot: nessuna risorsa assegnata |

---

## 9. Azioni, in ordine

### Le faccio io (Claude) dopo il tuo "ok" per il singolo passo
Il connettore `whatsapp_biz_*` non c'è, quindi questi passi li eseguirei nel tuo Chrome, uno per volta, con conferma prima di ogni clic che salva:
1. Leggere i template del WABA Insiderslab Team e la pagina Panoramica (Termini Cloud API) — sola lettura, nessun ok necessario.
2. Sottoscrivere il WABA Insiderslab Team all'app 609974691965875 ("Iscriviti ai webhook").
3. Aggiungere al webhook dell'app i campi `message_template_status_update` (e `smb_message_echoes` se servirà la coexistence).
4. Cambiare l'URL di callback dell'app Live da n8n all'endpoint scelto (vedi §10) — **solo dopo** che mi confermi che il flusso n8n non serve più. Il token di verifica lo incolli tu.
5. Preparare 2–3 template di prova sul WABA Insiderslab Team (riapertura conversazione, promemoria) e inviarli in approvazione.

### Le fai tu nel pannello
1. **Utente di sistema:** assegna a `WhatsappBot` il WABA *Insiderslab Team* e l'app *Whatpp Business Insiderslab* (controllo completo), poi "Genera token" → scadenza Mai → `whatsapp_business_messaging` + `whatsapp_business_management`. Il token va solo nel wizard del CRM, non in chat.
   `https://business.facebook.com/latest/settings/system_users?business_id=404240226745821`
2. **Metodo di pagamento** sul WABA Insiderslab Team:
   `https://business.facebook.com/billing_hub/accounts?business_id=404240226745821`
3. **n8n:** verifica se il flusso su `insiderslab.app.n8n.cloud` che riceve i `messages` è ancora attivo e utile.
4. **Ruoli app:** decidi se Manik Roy deve restare amministratore.
   `https://developers.facebook.com/apps/609974691965875/roles/roles/`
5. **Ragione sociale** di Insiderlabs Business (SAS → SNC) se cambiata:
   `https://business.facebook.com/latest/settings/business_info?business_id=404240226745821`
6. **Lumii** (solo se Lumii deve restare su Clientify): nome visualizzato "Ristorante Lumii" senza aggiunte, e info fiscali in Billing Hub.
   `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=7017461864988773&asset_id=1113982134244922`
   `https://business.facebook.com/billing_hub/accounts?business_id=7017461864988773`
7. **Più avanti (modello agenzia):** avvia la verifica Tech Provider ("Access verification") e poi l'App Review per l'accesso avanzato.
   `https://business.facebook.com/latest/settings/business_info?business_id=404240226745821`

---

## 10. Raccomandazione: modo diretto nel CRM

**Collegare i primi clienti in modo diretto nel CRM, non tramite Wapi.** Coerente con la preferenza in `ANALISI-STATO-2026-10-05.md` §4.

**Motivo, dai fatti di oggi:**
- L'app che puntava a Wapi (`Whapi by Heili`) è **in sviluppo**: in produzione non riceve nulla. Portarla Live e poi su clienti esterni richiede accesso avanzato + Tech Provider, che oggi **mancano**.
- Con l'accesso standard un'app lavora solo sui WABA del proprio portfolio. Il modo diretto lo rispetta: **ogni cliente ha WABA e app nel proprio portfolio verificato** (come Lumii, già verificato; c'è già il precedente di "La bambolaChatbot" nel portfolio La Bambola Morrocoy) e incolla le credenziali nel wizard del CRM. Nessuna review Meta per noi.
- Per provare tutta la catena **subito, senza clienti**, c'è già un numero nostro pronto: **+1 555 779 6249** (Insiderslab Team), registrato, qualità alta, su un'app Live.

**Cosa cambia nel webhook:**
- App Live `609974691965875`: callback da `https://insiderslab.app.n8n.cloud/webhook/…` a `https://crm.heili.cloud/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>` (il token lo mostra il CRM in Impostazioni → WhatsApp), campi `messages` + `message_template_status_update`, WABA Insiderslab Team sottoscritto. `META_APP_SECRET` nel CRM = segreto dell'app 609974691965875.
- Per ogni cliente: stessa configurazione sull'app del suo portfolio, con l'URL del CRM della sua organizzazione.
- Wapi (`whapi.heili.cloud/api/webhook`) resta sull'app in sviluppo finché non arrivano Tech Provider, accesso avanzato e la chiave Wapi per organizzazione (C3).

**Lumii non è il primo cliente:** il suo numero 0432 è in uso su Clientify (133 conversazioni in 7 giorni) e il 389 è legato a Cooperto/SparkinWeb. Spostarli interromperebbe servizi attivi.

---

## 11. Non verificato

- Elenco delle app installate sugli utenti di sistema `Openclaw` ed `Employee`.
- Pagina Termini Cloud API e template del WABA Insiderslab Team.
- Il campo specifico "metodo di pagamento per i messaggi di servizio" (non esposto nelle pagine lette).
- Portfolio Socialinsiders.
- Se il WABA Insiderslab Team sia già sottoscritto all'app (il pulsante suggerisce di no).
