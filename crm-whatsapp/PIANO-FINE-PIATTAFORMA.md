# Piano per finire la piattaforma (scritto la notte del 10/10/2026)

**Obiettivo di domani (11/10):** provare insieme il CRM completo su due fronti, in una mattinata:
- l'**assistente interno** sul +1 555, che risponde solo al team;
- il **+39 347 di InsidersLab** in coexistence, usato sia dall'app del telefono sia dal CRM.

Instagram, Facebook e il sito di La Bambola arrivano nei giorni successivi (vedi §4).

## 1. Stato stasera

| Cosa | Stato |
|---|---|
| CRM in produzione su `e23332e`: più aziende, ruoli, coexistence nel codice | ✅ rilasciato il 10/10 alle 19:50 UTC |
| Assistente interno sul +1 555 (profilo + 22 voci, chiave OpenRouter con credito) | ✅ risponde |
| PR #7, livello canali (fondazione invisibile per Instagram/Facebook) | unita, **non ancora in produzione** |
| PR #8, assistente interno: accesso riservato, rimozione demo, rinomina, pagina Agente corretta, `max_tokens` | ✅ unita (`0bc731e`) dopo revisione e 9 correzioni, **non ancora in produzione** |
| Pulsante «Collega con Meta» per il +39 347 | il codice c'è; manca il **Configuration ID v4** da Meta |
| App Secret | da **reimpostare** (era finito in chat) |

## 2. Stanotte: cosa è stato fatto (niente in produzione)

1. ✅ **PR #8 unita** (`0bc731e`): 9 correzioni dalla revisione e prove ripetute (unità 1069, golden 107, sabotaggi).
2. ✅ **Script di rilascio pronto**: `rilascio-crm.sh` porta la produzione a `0bc731e` (PR #7 + #8), con migrazioni attese **15**. Prima fa il backup e controlla che non ci siano transazioni lunghe; dopo verifica il livello canali (V1–V7). L'ho provato su un ambiente simulato in tre casi.
3. 🟡 **Richieste dal sito nella Posta**: [PR #10](https://github.com/Insiderslab/vocero-crm/pull/10), **in bozza**. Funziona e passa tutte le prove (unità 1167, golden 132, e2e 193). È **fuori dal rilascio di domani** perché aspetta due tue decisioni:
   - **D1, richieste con solo l'email:** se chi scrive dal sito lascia solo l'email e non è ancora un contatto, per ora la richiesta viene rifiutata. Il modulo chiede quindi il telefono come obbligatorio. Accettare anche solo l'email richiede la fase R2 del livello canali (prossima settimana). **Va bene così per La Bambola?** Consiglio: sì, in Venezuela tutti lasciano il WhatsApp.
   - **D2, nome del canale dei messaggi dal sito:** «web» oppure «form». È solo un'etichetta interna, ma l'ADR dei canali richiede la tua approvazione per ogni valore nuovo. Consiglio: «web».

   Stanotte gira anche una revisione avversaria della PR #10. Dopo le tue risposte la correggo, la unisco e va nel rilascio successivo.
4. ✅ **Guida di prova di domani** (§3.3).

## 2b. Test di usabilità (PDF di Stefano): cosa ne faccio

| Problema del test | Dove si risolve |
|---|---|
| **E1, critico:** l'IA va in errore e il cliente resta senza risposta | La causa di stanotte era il credito OpenRouter, già risolto, e il limite `max_tokens` è nella PR #8. Il resto è nel **pacchetto 009**, in lavorazione stanotte: un secondo tentativo dopo 60 s, un messaggio di cortesia configurabile, il filtro «Assistenza umana» in Posta con queste chat in cima, il pulsante «Riprova risposta IA» e un avviso nel CRM |
| **Punto 4:** dati demo della ferramenta nell'azienda dell'assistente interno | Domattina, `COSA-FARE-ADESSO.md` §D: rinomina dell'azienda, «Rimuovi dati demo» e accesso riservato (PR #8) |
| **E2/E9:** lingue mescolate (fasi, Laboratorio, «Ficha», date, titolo della scheda, valuta MXN) | Pacchetto 009 |
| **E3/E6:** falso «Nessun contatto», primo clic perso | Pacchetto 009 (stati di caricamento e ricerca della causa) |
| **E4:** risposta dell'agente prima della domanda | Pacchetto 009 (ordine deterministico) |
| **E5:** errori 503 nel precaricamento delle pagine | Pacchetto 009: analisi del codice e della configurazione. Se serve una prova dal server, ti preparo i comandi in sola lettura |
| **E7/E8/E10:** rifiniture visive | Pacchetto 009 |
| **Priorità 2–4** (KB modificabile, assegnazione, pagina di sintesi, etichette, inviti, moduli, canali) | Nel piano §4, dopo il 009 e R2 |

Il pacchetto 009 segue lo stesso percorso delle altre PR: prove, revisione separata, correzioni. Va in un rilascio successivo, non in quello di domattina.

## 2c. Notte 11→12/10: cosa è stato unito su main (non ancora in produzione)

| PR | Cosa | Stato |
|---|---|---|
| [#11](https://github.com/Insiderslab/vocero-crm/pull/11) | Pagina **Sintesi** e checklist **Primi passi** (scritta da DeepSeek, corretta da Claude: la Sintesi in produzione non si sarebbe aperta) | ✅ unita |
| [#12](https://github.com/Insiderslab/vocero-crm/pull/12) | Test di usabilità E1–E10: errore dell'IA mai più silenzioso, lingue, caricamenti, ordine dei messaggi, rifiniture | ✅ unita dopo revisione + 8 correzioni |
| [#10](https://github.com/Insiderslab/vocero-crm/pull/10) | Richieste dal sito | 🟡 bozza: in riallineamento, aspetta D1/D2 |
| Kimi (R2) / DeepSeek (Conoscenza, Contatti) | sul PC di Stefano | da rivedere quando consegnano |

**Rilasci:** quello del mattino resta su `0bc731e` (provato). Il **rilascio 3** porterà #11 e #12 (migrazioni attese **16**): script pronto dopo la prova del rilascio 2.

## 2d. Stato al 15/10/2026

| Cosa | Stato |
|---|---|
| Produzione | `65f06f3` dal 13/10: R1 canali, assistente interno, Sintesi, usabilità |
| [PR #9](https://github.com/Insiderslab/vocero-crm/pull/9) sicurezza webhook | ✅ unita; va in produzione **insieme al nuovo App Secret** (rilascio dedicato) |
| [PR #14](https://github.com/Insiderslab/vocero-crm/pull/14) R2: WhatsApp sul contratto dei canali | bozza verificata: revisione senza bloccanti, 6 correzioni (copie rigorose di account e identità, ritentativi del runner); rilascio **dal 20/10** |
| [PR #10](https://github.com/Insiderslab/vocero-crm/pull/10) modulo del sito | bozza: aspetta D1/D2 |
| [PR #13](https://github.com/Insiderslab/vocero-crm/pull/13) ronda del team | bozza: aspetta l'ok (costituzione VIII), il generatore (n8n?) e il modello Meta |
| Instagram (M1.6) | dopo R2; prima vanno decise Q3 (contatti senza WhatsApp) e Q4 (media via URL) |
| +39 347 in coexistence | aspetta il **Configuration ID** da Chrome |

## 3. Domattina (tu, circa 45 minuti, in quest'ordine)

### 3.1 Rilascio (10 minuti, quasi tutti di attesa)
Un comando sul VPS: lo trovi in cima a `COSA-FARE-ADESSO.md`, aggiornato stanotte. Alla fine scrive **RILASCIO FATTO**. Dopo, se vuoi, riavvia il VPS (`reboot`): il messaggio «System restart required» lo chiede da ieri.

### 3.2 Meta e +39 347 (25 minuti)
1. **Chrome**, prompt `PROMPT-CHROME-ADESSO.md`: Configuration ID v4, domini, campi webhook, nome «Heili by InsidersLab».
2. VPS: `bash rilascio-crm.sh attiva-pulsante <ID>`.
3. Meta → App Secret → **Reimposta**, e subito dopo sul VPS `bash correggi-app-secret.sh`.
4. CRM `/admin`:
   - crea l'organizzazione **InsidersLab**;
   - rinomina «Negocio de Stefano Finoti» in **«InsidersLab · Interno»**.
5. In **InsidersLab**: Agente **spento** → Impostazioni → WhatsApp → **Collega con Meta** → +39 347 718 5235 → conferma sul telefono → condividi lo storico.

### 3.3 Prova (10 minuti)

| # | Prova | Risultato atteso |
|---|---|---|
| 1 | Da un altro telefono scrivi al +39 347 | Arriva sia sull'app WhatsApp Business sia nella Posta di InsidersLab |
| 2 | Rispondi dall'app del telefono | La risposta compare anche nel CRM |
| 3 | Rispondi dal CRM | La risposta compare anche sull'app |
| 4 | Storico | Le chat vecchie compaiono nella Posta, nell'ordine giusto |
| 5 | «InsidersLab · Interno» → Agente → **Accesso riservato**: acceso, con i numeri del team con il + davanti | Salvataggio OK, senza perdere niente |
| 6 | Dal tuo numero (in lista) scrivi al +1 555 | Risponde l'assistente |
| 7 | Da un numero **non** in lista scrivi al +1 555 | Nessuna risposta dell'IA (o solo la frase fissa, se l'hai impostata) |
| 8 | Posta → «Rimuovi dati demo» | Spariscono i 7 contatti finti, la tua base di conoscenza resta |

Incollami i risultati: correggo subito quello che non va.

## 4. Dopo domani: cosa manca per «finito»

| Quando | Cosa | Chi |
|---|---|---|
| 12–14/10 | **Allarmi al team**: la ronda delle 8:00 di Vice-Ste arriva sul WhatsApp del team dal +1 555 (serve un modello Utility approvato da Meta) | io il codice, tu l'approvazione del modello |
| 12–17/10 | **R2 del livello canali**: WhatsApp passa sulla struttura comune; le letture si spostano sulle tabelle nuove | io |
| 14–20/10 | **Instagram nel CRM** (M1.6), in modalità sviluppo: i DM di @labambolamorrocoy nella Posta. Servono i ruoli tester per chi gestisce la pagina | io il codice; La Bambola accetta l'invito |
| appena risponde La Bambola | **La Bambola**: organizzazione, numero in coexistence, base di conoscenza dalle loro risposte, modulo del sito → Posta | tu mandi il messaggio di `COSA-FARE-ADESSO.md` §E; io carico tutto |
| novembre | **Facebook Messenger** e **App Review di Meta** (video e materiale) per uscire dalla modalità sviluppo | io preparo, tu invii |
| metà novembre | Decisione su Wapi; pilota con 3–5 aziende | insieme |

## 5. Regole che restano
- Prima di ogni clic che salva o modifica su Meta serve il tuo «ok».
- Token, App Secret e chiavi non si scrivono mai in chat: si incollano solo negli script, che li nascondono.
- Nessun messaggio di prova a numeri di clienti veri.
- Niente in produzione senza un tuo comando: io preparo, verifico e unisco; il rilascio lo lanci tu.
