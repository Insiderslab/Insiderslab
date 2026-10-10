# API di automazione v1

Interfaccia comune per Codex, Claude e altri client HTTP. Il flusso completo e i comandi sono in [AGENT-IMPORT.md](AGENT-IMPORT.md).

## Autenticazione

In Impostazioni ogni membro può creare una propria chiave (30 giorni dalla UI, massimo 10 attive). Il token `approve_auto_…` viene mostrato una volta; il database conserva soltanto SHA-256. Inviare `Authorization: Bearer <token>` tramite HTTPS. La chiave è limitata al workspace di creazione e perde accesso quando scade, viene revocata o il membro viene rimosso. Le sessioni browser e i token cliente non autenticano questi endpoint.

## Contratto HTTP

| Metodo | Percorso | Risposta `data` |
|---|---|---|
| GET | `/api/automation/v1/clients?q=nome&limit=50&cursor=id` | `{workspaceId, clients:[{id,name,timezone,services,networks}], nextCursor}`; massimo 100 per pagina |
| GET | `/api/automation/v1/posts/{id}` | `{post}` con stato e ultima versione, solo del proprio workspace |
| POST | `/api/automation/v1/posts/validate` | `{valid:true, externalId, post}`; validazione in sola lettura |
| POST | `/api/automation/v1/posts` | `{post:{id,status}, replayed}`; 201 nuovo, 200 già presente |
| POST | `/api/automation/v1/media` | `{asset, media}`; 201, media pronto da includere nella bozza |

Successo: `{ "success": true, "data": ... }`.
Errore: `{ "success": false, "code": "IMPORT_CONFLICT", "error": "Messaggio leggibile" }`.
Tutte le risposte sono `private, no-store`. Non interpretare un errore di rete come prova che una scrittura non sia avvenuta.

## Bozze

```json
{
  "externalId": "cliente-ottobre-001",
  "post": {
    "clientId": "ID_DA_CLIENTS",
    "title": "Post del 15 ottobre",
    "publishAt": "2026-10-15T10:30:00+02:00",
    "kind": "SOCIAL_POST",
    "networks": ["instagram", "facebook"],
    "text": "Testo completo del post",
    "firstCommentText": "Primo commento opzionale",
    "media": [],
    "networkOptions": {}
  }
}
```

Il corpo JSON è limitato a 1 MiB, 20 livelli di annidamento e 50.000 nodi. Le date richiedono un offset esplicito. Usare gli ID dei clienti restituiti dall'API e reti abilitate per quel cliente. Le proprietà non previste sono rifiutate, incluso `status`: un import non può approvare o programmare. Blog e ads non sono supportati nella v1.

Per i media usare gli oggetti `media` restituiti dall'upload, con `assetId`. Il servizio rivalida l'appartenenza al workspace e ricostruisce URL/tipo dal database. Non sono accettati media esterni senza asset caricato. Una bozza può avere `media: []`; questo non significa che sia già pronta per la pubblicazione.

Ripetere un `externalId` con gli stessi dati restituisce il post esistente senza aggiornamenti, anche se nel frattempo il post ha proseguito il suo workflow. Dati differenti generano `409 IMPORT_CONFLICT`. Il vincolo univoco PostgreSQL protegge anche richieste concorrenti. Conservare il manifest degli upload per mantenere gli stessi riferimenti ai media nei retry.

Le nuove bozze importate sono limitate a 1.000 per workspace nelle ultime 24 ore, con controllo atomico anche tra chiavi diverse; `AUTOMATION_DAILY_DRAFT_LIMIT` consente da 1 a 10.000. Il replay di una bozza esistente non consuma il limite. Il superamento restituisce `429 RATE_LIMITED`. Gli endpoint di lettura/validazione non scrivono contatori: il rate limit delle richieste HTTP va configurato anche all'ingresso per proteggere da traffico anomalo.

## Upload

Inviare il file come corpo binario, `Content-Type: image/*` oppure `video/*`, `Content-Length` quando noto e `X-File-Name` codificato con percent-encoding. `X-Duration-Sec` è facoltativo per i video. L'upload controlla formato reale e limite di 300 MB in streaming. Nessun URL remoto viene scaricato dal server.

Il canale di automazione riserva atomicamente spazio prima dell'upload: massimo tre trasferimenti simultanei per workspace, capacità complessiva predefinita 5 GiB inclusi i media esistenti. `AUTOMATION_STORAGE_LIMIT_BYTES` permette un limite tra 300 MB e 1 TiB. Un trasferimento non può continuare a scrivere dopo 15 minuti; una prenotazione abbandonata scade dopo 30 minuti. La quota riguarda il canale API: gli upload manuali esistenti non sono stati rifattorizzati. Gli asset orfani rimangono conteggiati; la loro raccolta automatica richiede un intervento separato.

## Limiti dell'assistente di revisione

Ogni chiamata al modello, inclusi retry, fallimenti e riepiloghi, consuma un tentativo persistente. I default sono 100 tentativi per referente e 1.000 per workspace nelle ultime 24 ore, con almeno 3 secondi fra tentativi dello stesso referente. Configurazione: `REVIEW_ASSISTANT_REVIEWER_DAILY_ATTEMPTS`, `REVIEW_ASSISTANT_WORKSPACE_DAILY_ATTEMPTS`, `REVIEW_ASSISTANT_ATTEMPT_COOLDOWN_MS`. Il raggiungimento del limite non blocca commenti e approvazioni normali.

## Rilascio

Applicare entrambe le migration nuove di questa revisione prima di avviare il codice, rigenerare Prisma e costruire l'immagine Node 24. La migration dell'automazione è additiva. Verificare in staging creazione/revoca chiavi, isolamento di due workspace, import e ripetizione dello stesso file, scadenza dei limiti e worker/cron. Le prove locali con database simulato non sostituiscono il test PostgreSQL/Redis/SMTP/Metricool reale.
