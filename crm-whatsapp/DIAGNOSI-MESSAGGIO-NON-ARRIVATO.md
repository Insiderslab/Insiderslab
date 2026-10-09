# Diagnosi — il messaggio WhatsApp non arriva nel CRM

**Situazione (9–10/10):** collegamento completato secondo la sessione Chrome; messaggio inviato al +1 555 779 6249; nulla nella Posta del CRM.

## Dove si può fermare un messaggio (dal codice del CRM, branch `claude/keen-ptolemy-l0kv8g`)
Il messaggio deve superare cinque punti, in quest'ordine. I punti 3, 4 e 5 non mostrano nulla nell'interfaccia: lasciano solo una riga nei log del container.

| # | Punto | Se fallisce | Dove si vede |
|---|---|---|---|
| 1 | WhatsApp consegna il messaggio al numero | Una sola spunta grigia sul telefono | Telefono |
| 2 | Meta inoltra l'evento alla nostra app: il WABA deve essere **iscritto all'app 609974691965875** e il campo `messages` attivo | Il CRM non riceve nulla | Graph API Explorer (sotto); log del CRM vuoti |
| 3 | URL e token: il segmento finale della URL deve essere uguale a `META_WEBHOOK_VERIFY_TOKEN` | **404**, nessun effetto | Log Caddy/app |
| 4 | Firma: se `META_APP_SECRET` è impostato deve essere la chiave segreta **dell'app 609974691965875** | **401**, Meta ritenta e poi rinuncia | Log Caddy/app |
| 5 | Instradamento: il `phone_number_id` dell'evento deve essere uguale a quello salvato nel CRM | Scartato in silenzio, log `[webhook] evento para phone_number_id desconocido (...)` (`src/server/inbox/ingest.ts:199-207`) | Log app |

**Sospetto principale:** al punto 5 il Phone Number ID salvato potrebbe essere quello del numero di prova (`1249087948277495`, che la pagina "Passaggio 1" dell'app mostra di default) invece di `671133866076775`. Subito dopo: il WABA non è iscritto alla nostra app ma solo a quella di Clientify (punto 2).

## Controlli in ordine (dal più rapido)
1. **Telefono:** il messaggio ha due spunte? Una sola spunta vuol dire che il problema sta nel numero, prima di Meta.
2. **CRM** (organizzazione "Negocio de Stefano Finoti") → Impostazioni → WhatsApp: mostra "Numero connesso: +1 555 779 6249"? Quale Phone Number ID e WABA ID sono salvati? Attesi `671133866076775` e `1027272492350148`.
3. **Graph API Explorer** `https://developers.facebook.com/tools/explorer/`, app "Whatpp Business Insiderslab", token utente (non copiarlo):
   - `GET 1027272492350148/subscribed_apps` → l'elenco deve contenere l'app `609974691965875` (oltre a Clientify).
   - `GET 671133866076775?fields=display_phone_number,status,platform_type,name_status,webhook_configuration` → `platform_type` = `CLOUD_API`; `webhook_configuration.application` = URL del CRM. Se compare un `whatsapp_business_account` o un `phone_number` con un altro URL, c'è un override che manda gli eventi altrove.
4. **Test di Meta:** app → WhatsApp → Configurazione → Webhook → campo `messages` → "Test". Meta invia un evento finto con `phone_number_id` = `123456123` al callback. Nei log del CRM deve comparire `phone_number_id desconocido (123456123)`: vuol dire che consegna, token e firma funzionano e il problema sta nei punti 2 o 5. Se invece compare un 401, è la firma; se un 404, è il token nella URL.
5. **Log sul VPS** (Stefano), dalla cartella del compose del CRM:
   ```sh
   docker compose logs app --since 30m | grep -iE "webhook|desconocido|401|MetaApiError|error"
   ```
   Se il CRM gira in Coolify, la stessa ricerca va fatta nei log dell'applicazione. Senza nessuna riga `[webhook]` e nessuna POST su `/api/webhooks/wa/` nei log di Caddy, Meta non sta chiamando il CRM (punto 2 o callback sbagliato).

## Rimedi
| Esito | Rimedio |
|---|---|
| Phone Number ID salvato sbagliato | CRM → Impostazioni → WhatsApp: rimetti `671133866076775` e `1027272492350148`, Prova connessione, Salva. Riscrivi "ciao". |
| `subscribed_apps` senza 609974691965875 | Explorer: `POST 1027272492350148/subscribed_apps` (con il token dell'utente di sistema o il tuo). Oppure l'interruttore "Iscriviti ai webhook". Poi riscrivi. |
| Override verso un altro URL | Lo ha impostato Clientify o una prova precedente: `POST 1027272492350148/subscribed_apps` senza `override_callback_uri` dalla nostra app ripristina il callback dell'app. Prima di toccare un override di Clientify, chiedi a Stefano. |
| 401 nei log | `META_APP_SECRET` diverso dalla chiave segreta dell'app 609974691965875: ricopialo, riavvia il container. Per un test rapido si può svuotare la variabile (la firma viene saltata), ma va rimessa subito dopo. |
| 404 nei log | La URL incollata in Meta non è quella copiata dal CRM: ricopiala con il pulsante. |
| Una sola spunta sul telefono | Numero non raggiungibile: verifica in WhatsApp Manager lo stato "Collegato", che il numero non sia in modalità test e che il telefono non sia bloccato dal numero aziendale. |
