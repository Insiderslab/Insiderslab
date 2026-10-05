# Guida passo passo — sbloccare Meta per il CRM WhatsApp (5 ottobre 2026)

> **Aggiornamento 5/10 sera — letto il report dal pannello (`REPORT-META-2026-10-05.md`), che corregge tre punti di questa guida:**
> `7017461864988773` è il portfolio **Ristorante Lumii** (FUSION TASTE SRL), non Socialinsiders; l'app `609974691965875` appartiene a **Insiderlabs Business** (`404240226745821`, verificato il 27/6/2026); `283406984860632` è un secondo WABA di Lumii, non un account di fatturazione. Il numero 0432 di Lumii è usato da **Clientify**, il 389 da Cooperto/SparkinWeb: Lumii non è il primo cliente del CRM. Esiste già un **numero nostro registrato** (+1 555 779 6249, WABA "Insiderslab Team") sull'app Live: è la base per il test end-to-end. I checkpoint sotto restano validi come procedura, ma gli ID e gli stati vanno letti dal report.

**Limite di questo ambiente:** la rete blocca `facebook.com`, `business.facebook.com` e `developers.facebook.com` (proxy 403). Non posso aprire Meta al posto tuo: la guida va eseguita da te, e a ogni checkpoint mi riporti cosa vedi (screenshot o testo). Nessun segreto (token, password, codici) va incollato in chat.

**Fonti:** email Meta ricevute su `stefano@insiderslab.it` e `stefano.finoti@gmail.com` (lette oggi), documentazione nei repo `vocero-crm`, `wapi`, `heili-dm`.

## 0. Cosa risulta già dalle email (stato al 5/10)

| Elemento | Stato | Evidenza |
|---|---|---|
| Business Manager **Socialinsiders** (ID `7017461864988773`) | Esiste, proprietario delle risorse WhatsApp | tutte le notifiche WhatsApp puntano a questo business_id |
| Account WhatsApp Business **"Ristorante Lumii"** (WABA `1113982134244922`) | Attivo; numero `+39 0432 174 2374` abilitato a 1.000 clienti/giorno dal 26/10/2025 | email "Inizia a inviare messaggi" |
| Account di fatturazione WhatsApp `283406984860632` | Addebiti mensili regolari (7–23 €) su MasterCard ····4001, ultimo il 1/10 | ricevute mensili |
| **Avviso "messaggi non consegnati"** per problema di configurazione account o pagamenti | Ricevuto ogni mese da marzo ad agosto 2026, link al Billing Hub (wizard "aggiungi metodo di pagamento") | 8 email identiche |
| **Metodo di pagamento per i "messaggi di servizio"** (nuovo regime Meta dal 1/10/2026) | Mancante sul WABA Ristorante Lumii: oltre 1.000 messaggi di servizio al mese per numero non vengono consegnati | 4 email 3/9, 17/9, 26/9, 29/9 |
| **Nome visualizzato** del numero | Rifiutato 2 volte: "Ristorante Lumii Reana" (10/2025) e "Lumii Cooperto" (5/2026) | email WhatsApp Manager |
| Template approvati sul WABA | `supporto`, `wa_prenotazione…`, `wa_fidelity_card`, `wa_sondaggio`, `test_cooperto`, `cooperto_annive…`, `hello_world`, più alcuni in spagnolo (`salute`, `botella`, `diciembre_24`, `hollewen`, `mercolebrink`) | email approvazione template |
| App Meta **"Whatpp Business Insiderslab"** (App ID `609974691965875`) | **Live dal 7/7/2026** | avviso sviluppatori |
| App Meta **"Dm Heili"** (App ID `3536853626479911`, Instagram) | Live dal 30/8/2026, funzionante | PROGETTO-STATO di heili-dm |
| **Verifica dell'azienda** di Socialinsiders / InsidersLab | **Nessuna email di esito**. Decine di email "Verifica la tua e-mail di lavoro" (set 2025 → set 2026): la procedura risulta avviata più volte ma non c'è conferma di completamento | ricerca Gmail |
| Verifica azienda "Catamaranes de Venezuela CA" | Respinta il 27/6/2026 (documento indirizzo non valido). Business diverso | email |
| Account pubblicitario GTSOUND PUBBLICITA' (`279743339895462`) | Disabilitato per pagamento rifiutato (13/8, 15/8, 25/9). Non c'entra con WhatsApp ma è nello stesso Billing Hub | email |
| Pixel Salusvita | Categoria con restrizioni (salute). Solo ads, non c'entra | email 3/10 |

**Lettura d'insieme.** I template `cooperto_*` e il nome "Lumii Cooperto" indicano che il numero di Lumii è usato tramite **Cooperto** (software per ristoranti), non tramite Whapi/CRM. Il WABA è intestato al nostro Business Manager ma rappresenta un cliente: per questo Meta rifiuta il nome visualizzato. È lo stesso problema che avremo con ogni cliente se mettiamo i loro numeri sotto il nostro WABA senza il modello "Tech Provider".

## 1. Checkpoint, in ordine

Esegui e riportami l'esito di ciascuno prima di passare al successivo.

### CP1 — Accesso e portfolio giusto (2 min)
1. Apri `https://business.facebook.com/settings/?business_id=7017461864988773` con l'account che riceve le email (`stefano@insiderslab.it` o il profilo Facebook "Stefano Finoti Araya").
2. Conferma che il portfolio si chiami **Socialinsiders** e che tu sia **Amministratore**.
3. Dal selettore in alto, elenca gli altri portfolio a cui hai accesso (ci aspettiamo almeno "Insiderlabs Business", quello dell'app Dm Heili).

**Riporta:** nome dei portfolio e il tuo ruolo in ciascuno.

### CP2 — Verifica dell'azienda (5 min, è il blocco principale)
1. `https://business.facebook.com/settings/security?business_id=7017461864988773` → sezione **Verifica dell'azienda**.
2. Leggi lo stato: *Non avviata* / *In sospeso* / *Servono altre informazioni* / *Verificata*.
3. Se non è Verificata: clicca "Avvia la verifica". Dati da usare, identici tra loro e ai documenti: ragione sociale **INSIDERSLAB SNC DI FINOTI STEFANO & C.**, indirizzo della visura, telefono aziendale, sito `insiderslab.it`, email su dominio `@insiderslab.it`. Documento: **visura camerale recente** (meglio di 90 giorni) oppure certificato di attribuzione P.IVA; se chiedono anche l'indirizzo, bolletta o estratto conto intestati alla società con lo stesso indirizzo.
4. Metodo di conferma: scegli **email di dominio** (`…@insiderslab.it`): le email "Verifica la tua e-mail di lavoro" arrivano già lì.

**Riporta:** lo stato esatto e, se in sospeso, la data di invio. Senza verifica: niente nome visualizzato approvato, limite messaggi fermo, niente accesso avanzato per l'app, niente modello agenzia.

### CP3 — Billing Hub WhatsApp (5 min)
1. `https://business.facebook.com/billing_hub/accounts?business_id=7017461864988773`.
2. Trova la riga **WhatsApp — Ristorante Lumii** (asset `283406984860632`). Controlla: metodo di pagamento valido (la MasterCard ····4001 viene addebitata, quindi esiste), nessun badge "Azione necessaria", **sezione "Messaggi di servizio"** con metodo di pagamento collegato (è la novità dal 1/10 e la causa delle email di settembre).
3. Mentre sei lì: account pubblicitario **GTSOUND PUBBLICITA'** (`279743339895462`) ha un saldo rifiutato → paga o aggiorna carta, altrimenti resta disabilitato.

**Riporta:** cosa vedi nella riga WhatsApp (badge, metodo, "messaggi di servizio") e se GTSOUND è ancora disabilitato.

### CP4 — WhatsApp Manager: numero, nome, qualità, app collegata (10 min)
1. `https://business.facebook.com/wa/manage/home/?business_id=7017461864988773` → account **Ristorante Lumii**.
2. **Numeri di telefono** → `+39 0432 174 2374`: stato (Connesso / Offline / In attesa), **valutazione qualità** (verde/giallo/rosso), **limite di messaggistica** (atteso 1.000/giorno), **nome visualizzato** (atteso: rifiutato o "in revisione").
3. Nome visualizzato: proponi esattamente il nome dell'attività come appare su sito e Google, senza aggiunte: **"Ristorante Lumii"**. Le due bocciature avevano parole in più ("Reana", "Cooperto"). Se Meta chiede prove, servono sito o insegna con quel nome.
4. **Impostazioni del numero → app/partner collegati** (o "Panoramica account → App"): annota **quale app** usa il numero. Se compare Cooperto o un partner esterno, il numero oggi è loro: non si può registrarlo in Wapi/CRM senza toglierlo da lì (e Lumii perderebbe Cooperto). Se compare "Whatpp Business Insiderslab", è nostro.
5. **Modelli di messaggio**: annota quanti sono approvati, in che lingua e di chi sono (quelli `cooperto_*` non sono nostri).

**Riporta:** stato numero, qualità, limite, nome visualizzato, app collegata, elenco template.

### CP5 — App "Whatpp Business Insiderslab" su developers.facebook.com (10 min)
1. `https://developers.facebook.com/apps/609974691965875/` → Dashboard. Conferma **Modalità: Live**.
2. Menu **WhatsApp → Configurazione API**: quali **WABA e numeri** vede l'app (se c'è solo il numero di test di Meta, l'app non è collegata a Lumii né ad altri).
3. Menu **WhatsApp → Configurazione → Webhook**: **URL di callback** attuale e campi iscritti. Per il nostro stack deve essere uno di questi, con `messages` e `message_template_status_update` iscritti (e `smb_message_echoes` se il cliente continua a usare l'app WhatsApp Business sul telefono):
   - modo gateway: `https://whapi.heili.cloud/api/webhook` (verify token = `WEBHOOK_VERIFY_TOKEN` di Wapi);
   - modo diretto: `https://crm.heili.cloud/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>` (il CRM lo mostra in Impostazioni → WhatsApp).
   Attenzione: il dominio corretto è **whapi.** (il `.env.example` del CRM dice `wapi.`, che non esiste nel DNS).
4. Menu **Revisione dell'app → Autorizzazioni e funzioni**: cerca `whatsapp_business_messaging` e `whatsapp_business_management`. Annota se sono ad **Accesso standard** o **Accesso avanzato**. Standard basta per i WABA del nostro portfolio; **avanzato serve per i WABA dei clienti** (modello agenzia). L'avanzato richiede CP2 completata.
5. Menu **Impostazioni → Di base**: la **Verifica dell'azienda** dell'app deve risultare collegata al portfolio verificato; URL privacy e cancellazione dati presenti.

**Riporta:** WABA/numeri visti dall'app, URL webhook e campi, livello di accesso delle due autorizzazioni.

### CP6 — Utente di sistema e token (5 min, solo se CP4 dice che il numero è nostro)
1. `https://business.facebook.com/settings/system-users?business_id=7017461864988773`.
2. Deve esistere un utente di sistema **Amministratore** (es. "wapi" o "heili") con **risorsa assegnata: il WABA** e **l'app** "Whatpp Business Insiderslab".
3. "Genera nuovo token" → app Whatpp Business Insiderslab → scadenza **Mai** → autorizzazioni `whatsapp_business_messaging` e `whatsapp_business_management`. **Non incollarlo in chat**: va solo nel pannello admin di Wapi (numero → token) o nel wizard del CRM (Impostazioni → WhatsApp → Prova connessione → Salva).

**Riporta:** esiste l'utente di sistema? ha il WABA tra le risorse? (sì/no, niente token)

## 2. Decisione che ne esce (da prendere insieme dopo CP4 e CP5)

- **Se il numero di Lumii è di Cooperto**: Lumii non è il primo cliente del CRM. Si parte con un cliente nuovo (La Bambola o il salone/clinica del gruppo), con numero dedicato.
- **Per ogni nuovo cliente, modello consigliato finché l'app non ha l'accesso avanzato: WABA nel portfolio del cliente** (così il nome visualizzato è il suo e viene approvato), creato dal suo Business Manager; il cliente verifica la sua azienda, poi **condivide il WABA con Socialinsiders come partner** (Impostazioni → Partner → aggiungi `7017461864988773` → assegna il WABA) oppure crea un utente di sistema nel suo portfolio e ci consegna il token. Si incolla nel wizard del CRM (modo diretto) o in Wapi.
- **Numero del cliente:** nuovo numero (SIM o virtuale che riceva SMS/chiamata) oppure migrazione del numero esistente dall'app WhatsApp Business, che richiede la cancellazione dell'account dall'app e fa perdere le chat sul telefono. Va detto chiaramente al cliente.
- **Pagamenti:** ogni WABA deve avere il metodo di pagamento e, dal 1/10, quello per i messaggi di servizio (CP3).

## 3. Cosa non ho potuto verificare
- Nessuna pagina Meta aperta da qui (rete bloccata): tutti gli stati sopra vengono dalle email, non dai pannelli.
- Se la verifica dell'azienda sia stata completata senza email di conferma.
- Quale app o partner usa oggi il numero di Lumii.
