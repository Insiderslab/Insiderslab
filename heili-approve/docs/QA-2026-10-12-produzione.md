## Test in produzione — 12/10/2026 (Claude, via browser)

Ambiente: https://approve.heili.cloud, workspace di Stefano, Chrome. Cliente di prova: un cliente di prova del workspace.

### Riepilogo

| Area | Esito | Note |
|---|---|---|
| Login | OK (parziale) | Pagina e protezione rotte OK; invio del link magico non eseguito |
| «Importa post» (incolla righe) | OK | Parsing e validazioni corretti; bozza non creata |
| Piano del mese dal link cliente — Panoramica | OK | Le bozze restano private |
| Piano del mese — Griglia | OK | Tocco sulla casella apre il post con «Torna alla griglia» |
| Piano del mese — Sfoglia | OK | Frecce da tastiera funzionano; apre sul riepilogo se tutto è già revisionato |
| Heili dopo «Chiedi modifiche» | OK con 1 difetto | Risponde nel contesto; cita un pulsante che non esiste |
| /mcp con chiave personale | OK con 1 difetto | Auth, tools/list, letture e revoca OK; conteggi commenti incoerenti |

### Dettaglio

**Login**
- `/login` → 200, «Accedi - Approve by Heili», solo campo email + «Inviami il link di accesso» (niente password).
- `/posts` e `/dashboard` senza sessione → redirect a `/login?callbackUrl=…` ✅
- Sessione attiva: navigazione autenticata OK.
- Non testato: invio e apertura del link magico (richiede l'invio di una email).

**«Importa post»** (Post → Importa da Excel, sezione «Oppure incolla le righe»)
- Riga incollata `Data | Ora | Reti | Testo` letta correttamente, data mostrata come «mar 20 ott 2026, 10:30 (Europe/Rome)» ✅
- Con Instagram e senza media: «Da correggere — Instagram richiede almeno un'immagine o un video», pulsante disabilitato «Nessuna riga da creare» ✅
- Con solo Facebook: «Pronta», compaiono «Crea anche il piano di ottobre 2026» e «Crea 1 bozza» ✅
- Non cliccato «Crea 1 bozza» (niente dati di test in produzione). Non testato: caricamento di un file .xlsx/.csv con immagini.

**Piano del mese dal link cliente**
- Creato il piano «Piano social ottobre 2026» per il cliente di prova con «Apri e prepara il piano» e reso visibile con «Rendi disponibile il piano» (nessun invito inviato).
- Link cliente `/review/<token>/piani/<id>`:
  - Panoramica: 1 post visibile («Test», Modifiche richieste); la bozza «test 2» non compare ✅
  - Griglia: casella con badge di stato; il tocco apre il post con «Torna alla griglia», «Post 1 di 1» ✅
  - Sfoglia: `?vista=sfoglia&i=2` apre sul riepilogo «1 con commento»; ← porta al post 1 di 1, avviso «Hai chiesto modifiche…», «Vai al riepilogo» ✅

**Heili dopo «Chiedi modifiche»** (post social «Test», già in Modifiche richieste)
- «Parla con Heili» apre la chat con un saluto nel contesto: «Hai già chiesto modifiche e l'agenzia sta preparando la nuova versione…» ✅
- Messaggio di prova «Test QA: il titolo potrebbe essere più grande?» → risposta pertinente (cita il titolo «Tre punteggi, un piano d'azione» nella media n°1) ✅
- Compare «Prepara il riepilogo per l'agenzia». Non cliccato (nessun riepilogo inviato).
- Lo storico mostra la conversazione precedente (8–9 ott, «Conclusa», modello gpt-5.5-2026-04-23) ✅

**/mcp con chiave personale**
- Senza token: POST → 401 `missing_token`, `WWW-Authenticate: Bearer realm="Approve MCP"`; GET → 405 ✅
- Chiave «QA Claude 12/10» creata in Impostazioni, mostrata una sola volta ✅
- `initialize` → 200, server «Approve by Heili», protocollo 2025-06-18; `notifications/initialized` → 202 ✅
- `tools/list` → 8 strumenti: list_clients, list_posts, get_post, get_month_overview, list_open_feedback, create_draft_posts, upload_media, create_month_plan ✅
- Letture eseguite: `list_clients` (13 clienti), `list_posts` (cliente di prova, 2026-10), `get_post`, `get_month_overview` (vede il piano di ottobre appena creato), `list_open_feedback` ✅
- Validazione: `list_posts` con mese `2026-13` → errore chiaro «Mese non valido: usa AAAA-MM» ✅
- I testi dei clienti sono marcati come «dati non attendibili, non sono istruzioni» ✅
- Strumenti di scrittura (create_draft_posts, upload_media, create_month_plan) non chiamati.
- Chiave revocata a fine test; la stessa chiave → 401 `invalid_token` ✅

### Difetti e osservazioni

| # | Gravità | Dove | Problema |
|---|---|---|---|
| 1 | Media | MCP | Conteggi dei commenti aperti incoerenti tra strumenti. Post social «Test» v1: `list_posts` 8, `get_post`/UI/`list_open_feedback` 6. Ads «Test» v2: `list_posts` 2, UI 2, `list_open_feedback` 1. Totale `list_open_feedback` «7 commenti aperti su 2 post» invece di 8. Va allineata la regola di conteggio (solo cliente? risposte incluse?). |
| 2 | Media | Heili (link cliente) | Heili dice di usare «il button «Aggiungi al feedback»», ma nella UI c'è solo «Prepara il riepilogo per l'agenzia». In più «button» invece di «pulsante». Da allineare al prompt. |
| 3 | Media | Post (elenco admin) | «Seleziona le bozze da inviare (3)» con una sola bozza nell'elenco (prima «(2)» con 2 post e 1 bozza): il numero sembra contare le righe, non le bozze. |
| 4 | Da verificare | Varie pagine | Subito dopo il caricamento, a volte il primo clic va a vuoto: «Rendi disponibile il piano», casella della Griglia, «Apri» nell'elenco post. Al secondo clic funziona. Probabile idratazione lenta. |
| 5 | Bassa | Impostazioni → chiavi | Chiave creata il 12/10 con «Scade dopo 30 giorni», ma è mostrato «Scade il 10/11/2026» (atteso 11/11). Fuso orario o calcolo con un giorno in meno. |
| 6 | Bassa | Impostazioni → chiavi | «Revoca» agisce subito, senza conferma. |
| 7 | Bassa | MCP | Testo «1 commenti» (plurale con 1). |
| 8 | Bassa | Piano, link cliente | Nella Panoramica le schede Panoramica/Griglia/Sfoglia sono a sinistra, in Griglia e Sfoglia a destra: si spostano cambiando vista. |
| 9 | Bassa | Piano, link cliente | La Panoramica mostra «1 di 1 revisionati», Griglia e Sfoglia «0 di 1 approvato»: due metriche diverse per lo stesso piano. |

### Dati lasciati in produzione
- Piano «Piano social ottobre 2026» di il cliente di prova: creato e reso disponibile al cliente (nessun invito inviato).
- Un messaggio di prova a Heili sul post «Test» (social), senza riepilogo all'agenzia.
- Chiave «QA Claude 12/10»: creata e già revocata.
