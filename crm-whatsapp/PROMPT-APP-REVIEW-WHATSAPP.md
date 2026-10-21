# Prompt per Codex in modalità Agente (o Claude in Chrome): richiesta di accesso avanzato WhatsApp (App Review)

Serve perché Meta, al collegamento con «Collega con Meta», risponde: *«L'app partner non dispone delle autorizzazioni avanzate necessarie relative a gestione e messaggi di WhatsApp Business»* (#2655111). La stessa cosa serve per La Bambola e per tutti i clienti.

Il **video** lo registri tu: il copione è in fondo, Parte C. L'agente prepara tutto e **si ferma prima di «Invia»**.

---

Sei il mio assistente su developers.facebook.com e business.facebook.com. Usa il browser.
App Meta: "Whatpp Business Insiderslab", App ID 609974691965875, azienda Insiderlabs Business 404240226745821.

REGOLE
- Se serve il login, fermati e chiedimi di prendere il controllo: il login lo faccio io. Mai chiedere o scrivere password, token, App Secret o codici.
- Prima di ogni clic che salva, crea, modifica o invia, fermati e chiedimi "ok". NON premere mai "Invia per la revisione" / "Submit for review" senza un mio ok esplicito, scritto in quel momento.
- Gli ID non sono segreti.

PARTE A — Stato (solo lettura, riportami tutto)
1. business.facebook.com → Impostazioni → Centro per la sicurezza (business 404240226745821): la verifica dell'azienda è "Verificata"? Se non lo è, dimmi cosa chiede e fermati su questo punto.
2. developers.facebook.com/apps/609974691965875 → l'app è in modalità "Live" (Pubblicata) o "Sviluppo"?
3. "Revisione dell'app" / "App Review" → "Autorizzazioni e funzioni" (oppure "Casi d'uso" → "Personalizza"): livello di accesso attuale (Standard o Avanzato) di whatsapp_business_management, whatsapp_business_messaging e business_management.
4. Impostazioni → Di base: sono compilati "URL dell'informativa sulla privacy", "URL dei termini di servizio", "Cancellazione dei dati" (deve essere l'URL di CALLBACK https://crm.heili.cloud/api/meta/data-deletion, già salvato il 20/10), "Icona dell'app", "Categoria"? Riportami i valori attuali.
5. "Facebook Login for Business" → "Configurazioni": per la configurazione usata dal CRM (il suo ID è in crm.heili.cloud/admin → Piattaforma → Meta), riportami il tipo di accesso, la variante/il tipo di login (per esempio "WhatsApp Embedded Signup"), i prodotti e le autorizzazioni selezionate, e se c'è un'opzione per i numeri dell'app WhatsApp Business ("coexistence" / "WhatsApp Business app onboarding"). Solo lettura: non modificare niente.

PARTE B — Preparare la richiesta (ok prima di ogni salvataggio)
1. Impostazioni → Di base, solo se mancano:
   - Informativa sulla privacy: https://crm.heili.cloud/privacy
   - Termini di servizio: https://crm.heili.cloud/termini
   - Cancellazione dei dati: deve restare l'URL di callback https://crm.heili.cloud/api/meta/data-deletion (non cambiarlo)
   - Categoria: "Business and pages" (o la più vicina, per esempio "Affari e pagine")
2. Per whatsapp_business_management e per whatsapp_business_messaging: "Richiedi accesso avanzato" / "Request advanced access". Compila i campi così (in inglese, incolla esattamente):

   App description / descrizione del prodotto:
   "Heili CRM is a messaging CRM for businesses. A business connects its own WhatsApp Business account, and then its team reads and answers customer conversations from a single shared inbox, organizes contacts and sales opportunities, and can optionally turn on an AI assistant that drafts replies. Each business sees only its own data. Data received from Meta is used only to provide these functions to the business that connected the account."

   whatsapp_business_management — "How will your app use this permission?":
   "Heili CRM uses whatsapp_business_management to read and manage the WhatsApp Business assets that the business shares with us through the official Meta Embedded Signup flow (including WhatsApp Business app coexistence). After the business completes Embedded Signup with its own account, the app reads the connected WhatsApp Business Account (WABA) ID, the phone number ID and display number, and the message templates of that account, and subscribes the WABA to our webhook so incoming messages and template status changes reach the business's inbox. The business can also create message templates from the app and see their approval status. The permission is used only on the account the business itself connected, only to configure its workspace, list its templates and track their status."

   whatsapp_business_messaging — "How will your app use this permission?":
   "Heili CRM uses whatsapp_business_messaging so a business can receive and answer WhatsApp conversations with its own customers from the connected business phone number. Inbound customer messages arrive through the webhook and appear in the business's shared inbox. Team members reply from the inbox: free-form replies inside the 24-hour customer service window, and approved message templates when the window is closed. The app enforces the 24-hour window: outside it, only approved templates can be sent. Delivery and read statuses are shown in the inbox. Messages are sent only from the phone number the business connected, and only for the business's own customer conversations."

   Istruzioni per il revisore ("Testing instructions"):
   "Open https://crm.heili.cloud/login and sign in with the test account provided below. The organization 'Meta Review' is connected to a WhatsApp test number. Settings → WhatsApp shows the connected number and the 'Connect with Meta' Embedded Signup button. Settings → Templates lists and creates message templates (whatsapp_business_management). Inbox shows customer conversations; you can reply inside the 24-hour window and send approved templates outside it (whatsapp_business_messaging). The screencast shows the full flow with a real phone."
   Credenziali del revisore: NON scriverle tu. Fermati e chiedimi di inserirle io nel campo.
3. Video: fermati e chiedimi di caricare io il file del video (Parte C).
4. Riepilogo finale: dimmi cosa manca per poter inviare. NON inviare.

---

## Parte C — Copione del video (lo registri tu, 3–4 minuti, interfaccia del CRM in inglese)

Prima di registrare:
- in `/admin` crea l'organizzazione **«Meta Review»** con un utente di prova: le sue credenziali vanno solo nel campo del modulo Meta, mai in chat;
- collega a «Meta Review» il **+1 555** (numero di prova) da «Avanzate»;
- tieni pronto un modello già approvato (per esempio `hello_world`) e un telefono per i messaggi.

Registra lo schermo, con il telefono inquadrato quando serve:
1. Pagina `crm.heili.cloud/privacy`, poi login con l'utente di prova. Lingua del CRM in **EN**.
2. **Settings → WhatsApp**: si vedono numero, WABA e firma verificata. Premi **«Connect with Meta»**: si apre la finestra ufficiale di Meta. Mostra la schermata di login e la scelta dell'account. Se si blocca per l'accesso avanzato, si vede comunque il flusso ufficiale.
3. **Settings → Templates**: elenco dei modelli. Crea un modello UTILITY, che va in «Pending». Mostra un modello «Approved».
4. **Dal telefono** scrivi al numero: il messaggio compare nella **Inbox**.
5. **Rispondi dall'Inbox**: la risposta arriva sul telefono. Mostra le spunte di consegna e lettura.
6. Apri una conversazione con più di 24 ore: il campo libero è bloccato e resta solo il modello approvato. Invialo: arriva sul telefono.
7. Pagina `crm.heili.cloud/cancellazione-dati`.

Voce o sottotitoli in inglese: le frasi pronte sono in `vocero-crm/docs/meta/app-review/copioni-video.md` (Video 1). Non mostrare mai token o chiavi: la sezione «Avanzate» va tenuta chiusa.
