# Heili CRM nell'ecosistema: cosa vogliamo fare, dove i pezzi si incrociano, cosa pulire

**Data:** 10/10/2026 · **Per:** Stefano · **Basato su:** codice di `vocero-crm` (main e branch), `wapi`, `heili-dm`, `heili-platform`; documenti `docs/visione/crm-multicanale-multicliente.md` (tua direzione del 9/10), `docs/piani/PIANO-CRM-MULTICANALE.md` e `docs/adr/0001-livello-canali.md` (branch `claude/keen-ptolemy-l0kv8g`), `ECOSISTEMA-HEILI.md` (branch keen di heili-platform), `MIGLIORIE-ROADMAP.md` di DM by Heili (Drive, 31/8).
**Non verificato:** produzione (container, commit in linea), pannelli Meta dopo il 6/10.

---

## 1. La visione in tre frasi

1. **Heili CRM è il prodotto che vendiamo alle aziende**: un'unica casella per WhatsApp, poi Instagram, Facebook ed email, con un agente AI, per molte aziende nello stesso CRM. Un cliente nuovo si collega in meno di 15 minuti, con un pulsante e il login ufficiale di Meta.
2. **Il resto dell'ecosistema Heili gli sta intorno, ma non lo blocca.** Core (la memoria aziendale), Work, Margin e Approve sono prodotti a parte. Si collegheranno al CRM più avanti; oggi non servono per far lavorare un cliente.
3. **Un solo "cervello" per ogni numero e un solo modo di parlare con Meta.** Oggi il modo è il CRM direttamente. Wapi rientra in gioco solo quando servirà davvero (§4).

## 2. I pezzi e il loro ruolo

| Pezzo | Cosa fa oggi | Ruolo nella visione | Decisione |
|---|---|---|---|
| **Heili CRM** (repo `vocero-crm`, `crm.heili.cloud`) | Inbox WhatsApp, contatti, pipeline, agente AI, Laboratorio, più organizzazioni. Riceve i messaggi veri dal 9/10 | **Il centro.** Diventa multicanale (piano M0→M5) | Si lavora qui |
| **Wapi / Whapi** (`wapi`) | Gateway WhatsApp: numeri, inoltro dei webhook, pannello. La sua app Meta è in sviluppo e quindi non riceve traffico vero | "Tubo" verso Meta, utile solo se più prodotti o più CRM useranno gli stessi numeri | **Congelato** fino a metà novembre (§4) |
| **DM by Heili** (`heili-dm`, `dm.heili.cloud`) | Instagram: commento → DM, inbox DM. Ha la sua app Meta ("Dm Heili") | Strumento di **acquisizione** su Instagram. Il suo codice per collegare Instagram si **riusa** nel CRM | Nessuna funzione nuova; solo sicurezza |
| **Heili Core** (`heili-platform`) | Memoria aziendale, connettori, MCP. Nessun codice WhatsApp o Instagram | Più avanti: il CRM gli passa conversazioni e clienti, e lui dà all'agente la conoscenza aziendale | Fuori dalla corsia del CRM (ci lavora Codex) |
| **Heili Approve** (`approve.heili.cloud`) | Approvazione dei contenuti per i clienti | Prodotto a parte | Va messo in un repo suo (§5) |
| **Clientify** | CRM esterno dell'agenzia, partner su alcuni WABA | Non fa parte di Heili, ma **condivide i numeri** | Va deciso per ogni numero chi risponde (§3.2) |

## 3. Dove i pezzi si incrociano (e dove no)

### 3.1 App Meta: il vero punto di incrocio
Ogni app Meta ha **un solo indirizzo webhook**, quindi chi possiede l'app decide dove arrivano i messaggi. Oggi le app sono tre:

| App | ID | Stato | Chi la usa | Decisione proposta |
|---|---|---|---|---|
| **Whatpp Business Insiderslab** | 609974691965875 | Live | **CRM** (webhook su `crm.heili.cloud` dal 9/10) | **L'app del CRM per tutti i canali**: WhatsApp ora, Instagram e Messenger dopo l'App Review. Qui si crea il collegamento guidato v4 |
| **Whapi by Heili** | 1017740407963024 | In sviluppo | Wapi | Si ferma. Non chiedere review su questa app |
| **Dm Heili** | 3536853626479911 | Live, accesso standard | DM by Heili (Instagram) | Resta di DM by Heili. Lo stesso account Instagram può essere collegato a due app: commenti→DM su "Dm Heili", conversazioni nel CRM sull'app del CRM, quando ci sarà l'adattatore |

Così ogni prodotto ha la sua app e i webhook non si pestano i piedi.

### 3.2 Numeri WhatsApp: un numero, un cervello
| Numero | Dove sta | Chi risponde oggi | Decisione proposta |
|---|---|---|---|
| +1 555 779 6249 (Insiderslab Team) | Cloud API, app del CRM. Clientify è partner sul WABA | CRM (org "Negocio de Stefano Finoti") | **Numero di prova** del CRM, per sempre. Su Clientify nessun bot su questo numero |
| +39 347 718 5235 (InsidersLab) | App WhatsApp Business sul telefono, "Non in linea" su Meta | Tu, dal telefono | **Coexistence**: app sul telefono + CRM (org "InsidersLab"). §6 |
| +39 0432 174 2374 (Lumii) | Cloud API con Clientify | Clientify (133 conversazioni in 7 giorni) | Non si tocca |
| +39 389 059 3069 (Lumii) | Coexistence con SparkinWeb/Cooperto | Cooperto | Non si tocca |
| La Bambola | Da definire (il +58 è offline) | — | Collegato dal CRM con lo stesso pulsante, nel portfolio di La Bambola |

### 3.3 Login e aziende: separati, e va bene così per ora
Ci sono quattro login diversi:
- CRM: Better Auth con le organizzazioni;
- DM by Heili: link via email;
- Core: OIDC;
- Approve: link via email.

Ognuno ha anche il suo modello di "azienda". L'accesso unico (OIDC del Core) è una proposta e **non serve per il primo cliente**: va dopo il pilota.

### 3.4 Conoscenza e AI
L'agente del CRM ha la sua base di conoscenza (`kbEntry`). Il Core ha la memoria aziendale. **Oggi non sono collegati**, e non serve farlo per La Bambola. Il collegamento CRM → Core (pacchetto C5) arriva dopo il pilota.

### 3.5 Dove NON si incrociano
- Commenti→DM di Instagram: restano solo in DM by Heili.
- Margin, Work, Meetings, Legal: nessun legame col CRM.
- Il Laboratorio e la pipeline del CRM: niente da condividere.

## 4. Wapi: utile o no?

**Oggi no, e metterlo in mezzo rallenterebbe.** I motivi, verificati nel codice:
- su `master`, se il CRM non risponde, il messaggio **si perde**: nessuna coda, nessun nuovo tentativo;
- i token di Meta sono salvati **in chiaro**, mentre nel CRM sono cifrati;
- non ha il collegamento guidato di Meta e scarta gli avvisi `account_update`, che servono alla coexistence;
- gestisce una sola app Meta, e la sua app è in sviluppo;
- la produzione gira un commit che non è su `master`.

Tutto quello che Wapi fa per WhatsApp, il CRM in modalità diretta lo fa già, e in più ha il collegamento guidato e la coexistence.

**Quando diventerebbe utile:**
1. se un **secondo prodotto** deve usare gli stessi numeri WhatsApp (es. DM by Heili che manda su WhatsApp);
2. se ci saranno **più installazioni** del CRM;
3. se vogliamo un **gestore centrale dei token** di Meta per tutti i prodotti ("Heili Channels").

Prima di uno di questi casi è lavoro senza ritorno. Per renderlo pronto per la produzione servono circa **7–10 giorni**:
- coda affidabile, già su un branch ma con tre difetti da correggere;
- token cifrati;
- gestione degli eventi a livello WABA;
- consegna dei token dal CRM;
- prova su un ambiente separato.

**Proposta:** Wapi **congelato**. Resta acceso ma nessuno lo usa, e il CRM resta con `WAPI_BASE_URL` vuoto. La chiave Wapi per organizzazione (C3, già sul branch keen) si tiene: non fa danni ed è pronta se un giorno serve. **Si decide a metà novembre**, guardando i tre casi sopra.

## 5. Il disordine e come pulirlo

| # | Cosa | Proposta | Chi |
|---|---|---|---|
| P1 | **Due sessioni Claude sul CRM in parallelo.** La sessione "orchestratore" (branch `claude/keen-ptolemy-l0kv8g`, PR #3: C1, C2, C3, ruoli, ADR dei canali) e questa sessione (branch `claude/exciting-rubin-mow1yu`: coexistence = parte del pacchetto **K2** del piano). Le due migrazioni `0009` si scontrano, e anche due specifiche hanno il numero 005 | **Ordine: prima PR #3 (keen), poi la coexistence riallineata** sopra (migrazione rinumerata 0012, specifica 006). La coexistence diventa ufficialmente "K2 – parte coexistence" del piano. Da qui una regola: una sessione per repo | Tu decidi; io riallineo |
| P2 | Branch vecchi del CRM: 29 già uniti, `notte-2026-08-21`, PR #1 `feat/wapi-adapter` superato, `claw/us1-inviti` (solo un documento) | Cancellare quelli uniti, chiudere la PR #1, trasformare `us1-inviti` in una issue | Io preparo l'elenco, tu confermi |
| P3 | Nomi: Vocero / Orbit / Heili CRM; Wapi / Whapi; `wapi.` vs `whapi.heili.cloud` | **Nome di prodotto: "Heili CRM"** (il repo resta `vocero-crm` per non rompere i rilasci). **"Whapi"** ovunque, dominio `whapi.heili.cloud` | Io correggo i documenti |
| P4 | Documenti che si contraddicono: `ANALISI-STATO-05/10` dice che le org di produzione sono InsidersLab e La Bambola (falso); `ANALISI-COMPLETA-09/10` è già superata su C3 e Core; il README del CRM dice "una istanza = un negocio" | Questo documento e la mappa `ECOSISTEMA-HEILI.md` sono il riferimento. Le analisi vecchie diventano "fotografie datate" con un avviso in cima | Io |
| P5 | Repo `Insiderslab`: `main` è un README del 2021; `crm-whatsapp/`, `heili-approve/` e altri vivono solo su 14 branch | Unire `crm-whatsapp/` su main; Approve in un repo suo, visto che è in produzione | Tu decidi |
| P6 | DM by Heili: PR #1 di sicurezza aperta; token Instagram valido fino al **29/10** | Unire la PR #1; controllare che il rinnovo automatico del token funzioni prima del 29/10 | Tu (unione) + controllo |
| P7 | Caddy, compose e script del VPS non sono versionati; nessun backup del CRM | Pacchetto M0.4 (backup) **prima** dei dati di La Bambola | Io (script) + tu (spazio) |
| P8 | Tre app Meta, nessun inventario | La tabella §3.1 diventa l'inventario | Fatto qui |

## 6. Il +39 347 in coexistence: quando

Il codice c'è. Mancano quattro cose, tutte brevi:

| Passo | Durata | Dipende da |
|---|---|---|
| 1. Meta: configurazione del collegamento guidato **v4**, dominio del CRM, campi del webhook (`PROMPT-CHROME-TECH-PROVIDER.md`, Parte 2 punti 3–5) | 1 h | Te, in Chrome |
| 2. Unione: PR #3 (keen), poi la coexistence riallineata | 1–2 giorni (riallineamento ½ giorno, poi la tua revisione) | Te |
| 3. Rilascio sul VPS: `META_APP_ID`, `META_ES_CONFIG_ID`, ricostruzione, backup prima del rilascio | 30 min | Te |
| 4. Collegamento con il telefono in mano | 15 min | Te |

**Realisticamente entro la prossima settimana**, cioè 3–5 giorni lavorativi se le unioni vanno lisce.

Ci sono due incognite, che si sciolgono solo al primo tentativo vero:
- che il collegamento funzioni con l'accesso standard per un tuo numero, visto che sei amministratore dell'app;
- che il messaggio finale di Meta abbia la forma attesa. Il codice regge anche le varianti.

Se l'accesso standard non bastasse, servirebbe il Tech Provider, e allora sono settimane di attesa Meta.

## 7. La strada, in ordine

| Quando | Cosa | Pacchetti |
|---|---|---|
| **Questa settimana** (→17/10) | CRM sicuro per più aziende e +39 347 collegato | Unione e rilascio di PR #3 (C1–C3, ruoli), backup M0.4, coexistence riallineata e rilasciata, configurazione v4, token permanente, App Secret reimpostato, pulizia P2–P4 |
| **Settimane 2–3** (→31/10) | La Bambola su WhatsApp dal CRM | Il suo portfolio e numero, collegamento con lo stesso pulsante, agente e base di conoscenza, chi risponde, contratto e DPA; richieste dal sito nella Posta (endpoint nuovo); Instagram intanto con DM by Heili |
| **Novembre** | Il CRM diventa multicanale | Approvare l'ADR dei canali, poi M1 (livello canali, WhatsApp identico); materiale e video per l'App Review (K7) inviati presto, perché l'attesa è lunga; inviti con link e procedura "nuovo cliente" (M2) |
| **Fine novembre / dicembre** | Instagram e Messenger nel CRM, pilota con 3–5 aziende | Adattatori M3 dopo l'approvazione Meta; monitoraggio; decisione su Wapi a metà novembre |
| **Dopo il pilota** | Ecosistema | CRM → Core (conoscenza e memoria), login unico, email (M4) |

## 8. Decisioni che servono da te (6, brevi)

1. **Ordine delle unioni:** prima PR #3 (keen), poi la coexistence. Sì/no?
2. **Wapi congelato** fino a metà novembre, CRM in modalità diretta. Sì/no?
3. **Una sola app Meta per il CRM**: "Whatpp Business Insiderslab" per WhatsApp, Instagram e Messenger. Sì/no?
4. **Numeri:** +1 555 resta il numero di prova; +39 347 in coexistence nell'org "InsidersLab"; su Clientify nessun bot sui numeri Insiderslab. Sì/no?
5. **ADR dei canali** (`docs/adr/0001-livello-canali.md` sul branch keen): è in attesa della tua approvazione, e senza approvazione M1 non parte.
6. **Primo rilascio di La Bambola:** WhatsApp + sito nel CRM, Instagram con DM by Heili (pannello separato), Facebook dopo. Sì/no?
