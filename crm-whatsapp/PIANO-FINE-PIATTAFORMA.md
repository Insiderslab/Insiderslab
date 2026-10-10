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
| PR #8, assistente interno: accesso riservato, rimozione demo, rinomina, pagina Agente corretta, `max_tokens` | aperta; revisione senza bloccanti; correzioni in corso |
| Pulsante «Collega con Meta» per il +39 347 | il codice c'è; manca il **Configuration ID v4** da Meta |
| App Secret | da **reimpostare** (era finito in chat) |

## 2. Stanotte (lo faccio io, niente in produzione)

1. **PR #8:**
   - finire le correzioni della revisione: numeri con `+` obbligatorio; accesso anche per i contatti con identificativo nuovo di Meta; la demo non cancella più la tua base di conoscenza; niente lettere perse durante il salvataggio;
   - ripetere tutte le prove (unità, golden, e2e, sabotaggi), poi **unirla**.
2. **Script di rilascio unico** (`rilascio-crm.sh` aggiornato):
   - porta la produzione a main con le PR #7 e #8 (migrazioni attese **14**);
   - backup prima, controlli del livello canali in modalità «avvisa»;
   - provato su una copia locale come quello di ieri.
3. **Richieste dal sito nella Posta** (per La Bambola e per i clienti con un sito):
   - un indirizzo per organizzazione con chiave propria; il modulo del sito crea contatto e conversazione nella Posta;
   - spec, test e PR separata. Lo unisco solo se passa tutte le prove, altrimenti resta pronto per lunedì.
4. **Guida di prova di domani** con l'elenco di cosa controllare, punto per punto (§3.3).

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
