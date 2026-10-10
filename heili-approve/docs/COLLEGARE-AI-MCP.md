# Collegare Claude, ChatGPT e Codex ad Approve (MCP)

> Guida per il titolare. Spiega cosa può (e non può) fare l'assistente AI quando
> è collegato ad Approve, quali garanzie ci sono, come si collega ogni client e
> cosa va configurato su Auth0 e sul server. Non contiene segreti: solo
> segnaposto ⟨…⟩. I valori veri si leggono sul tenant Auth0 e nel `.env` del
> VPS, mai nel repository.
>
> Modellata su `heili-platform/docs/GATE-REGISTRAZIONE-MCP.md` e
> `docs/COLLEGARE-CLIENT-AI.md` (il server MCP di Heili): stesso approccio,
> stesso tenant Auth0, API e permessi propri di Approve.

---

## 1. Cosa fa e cosa non fa

Il server MCP di Approve è `POST https://approve.heili.cloud/mcp` (Streamable
HTTP, senza sessione). Un assistente collegato lavora **come la persona che l'ha
collegato**: vede soltanto i workspace e i clienti di cui quella persona è
membro, esattamente come nel pannello.

| Strumento | Permesso | Cosa fa |
|---|---|---|
| `list_clients` | `approve:read` | Clienti accessibili: id, nome, servizi, reti, fuso orario |
| `list_posts` | `approve:read` | Post con filtri (cliente, mese AAAA-MM, stato, tipo), a pagine: titolo, data, reti, stato, versione, commenti aperti, link al pannello |
| `get_post` | `approve:read` | Contenuto della versione corrente, media, cronologia degli stati, commenti con posizione (n° del media, punto sull'immagine, momento del video, variante, frase dell'articolo) |
| `get_month_overview` | `approve:read` | Il mese di un cliente: post per stato, stato del piano, avanzamento |
| `list_open_feedback` | `approve:read` | Commenti dei clienti non ancora risolti, per preparare le correzioni |
| `create_draft_posts` | `approve:draft` | Crea fino a 20 **bozze** di post social per chiamata, con `source_id` obbligatorio (idempotenza); `validate_only` per sola verifica |
| `upload_media` | `approve:draft` | Carica un'immagine o un video passato in base64 (max 20 MB per chiamata) e restituisce l'`asset_id` da usare nelle bozze |
| `create_month_plan` | `approve:draft` | Apre il piano del mese di un cliente (o restituisce quello esistente) e ci raccoglie le bozze. **Non lo invia** |

**Non esiste nessuno strumento per:** approvare, inviare al cliente o in
revisione, programmare, pubblicare, annullare o cancellare, cambiare
impostazioni, revisori, inviti o credenziali, usare Metricool. L'AI propone, la
decisione resta a una persona (l'agenzia invia, il cliente approva: regola 5 di
`docs/CONTRATTO.md`). Lo dice anche il testo che ogni client riceve da
`initialize`.

Esempi di richieste che funzionano bene:

- «Quali post di Caffè Aurora di ottobre hanno commenti aperti? Riassumili e proponi le modifiche.» (`list_open_feedback`, `get_post`)
- «Prepara dieci bozze per Studio Verde a novembre a partire da questo elenco; mostrami prima il controllo.» (`create_draft_posts` con `validate_only`, poi senza)
- «Apri il piano di novembre per Caffè Aurora con queste bozze.» (`create_month_plan`)

## 2. Garanzie di sicurezza

- **Stesso perimetro del pannello.** Ogni lettura e scrittura filtra per i workspace di cui l'utente è membro. L'id di un cliente o di un post di un altro workspace risponde «non trovato», identico a un id inesistente. Il ruolo (titolare, amministratore, membro) non cambia nulla: come nel pannello, tutti i membri possono preparare bozze.
- **Solo bozze.** `create_draft_posts` usa lo stesso codice di «Importa post» del pannello e dell'API di automazione (`lib/automation/drafts.ts` + `validateForNetworks`): stesse regole di validazione (data non nel passato, lunghezze per rete, Instagram richiede un media, reti abilitate per il cliente…), stessa chiave di idempotenza, stesso tetto giornaliero (`AUTOMATION_DAILY_DRAFT_LIMIT`, predefinito 1.000 al giorno per workspace). Il post nasce `DRAFT`: il cliente non lo vede e nessuna email parte.
- **Nessun utente creato.** Chi entra con OAuth deve essere già un utente di Approve, membro di almeno un workspace: non viene creato nessun account o workspace e nessun invito viene accettato. Vale anche la lista `ALLOWED_EMAILS` del login.
- **Nessun download da URL.** `upload_media` accetta solo byte in base64: il server non scarica mai file da indirizzi dati dall'AI (protezione SSRF). I tipi veri sono riconosciuti dal contenuto, non dal nome; stesso controllo di spazio dell'API di automazione.
- **Testi di terzi = dati.** Didascalie, titoli e commenti dei clienti sono segnalati come dati non attendibili: gli strumenti lo ripetono e il testo di `initialize` vieta di seguire istruzioni lì dentro.
- **Audit.** Ogni chiamata a uno strumento scrive una riga di log strutturata (chi, workspace, strumento, esito, durata, id creati). Le bozze create hanno l'evento «Creato» nella cronologia del post con `source: "mcp"` (più la chiave usata o l'app AI). Vedi §7.
- **Limiti.** 120 richieste al minuto per utente/chiave (`MCP_RATE_LIMIT_PER_MINUTE`), 20 bozze per chiamata, 20 MB per upload.
- **Interruttore.** `MCP_ENABLED=false` spegne tutto (404). Revocare una chiave personale o togliere un membro dal workspace interrompe l'accesso subito.

## 3. Due modi di collegarsi

| | Chiave personale | Accesso con account (OAuth) |
|---|---|---|
| Per chi | Codex, Claude Code, script | Claude (app/web), ChatGPT, qualunque client con login |
| Serve Auth0 | No | Sì, una tantum (§5) |
| Come | Impostazioni → «Importa con Codex o Claude» → *Crea chiave* (`approve_auto_…`, 30 giorni) | Il client apre il login dello stesso tenant di Heili |
| Workspace raggiunti | Solo quello della chiave | Tutti i workspace di cui l'utente è membro |
| Permessi | Entrambi (`approve:read` + `approve:draft`) | Quelli concessi nel token |

Se le variabili `MCP_JWT_*` mancano, OAuth è semplicemente spento: le chiavi
personali funzionano lo stesso e la scheda in Impostazioni mostra «non
configurato». `GET /.well-known/oauth-protected-resource` risponde allora 404
con una spiegazione e `/.well-known/mcp.json` dichiara `authentication.oauth:
false`.

## 4. Collegare i client

L'indirizzo è nella scheda **Impostazioni → «Collega la tua AI (MCP)»** (con il
pulsante *Copia*): `https://approve.heili.cloud/mcp`.

### Claude (app o web) — con OAuth
1. Impostazioni → **Connettori** → **Aggiungi connettore personalizzato**.
2. Nome «Approve», URL `https://approve.heili.cloud/mcp`.
3. Accedi con il tuo account Heili e consenti. Prova: «Usa Approve e dimmi i post in bozza di ⟨cliente⟩».

### ChatGPT — con OAuth
1. Impostazioni → Connettori → *Impostazioni avanzate* → attiva la **modalità sviluppatore** (se il workspace lo consente).
2. Crea un connettore/app personalizzata con URL `https://approve.heili.cloud/mcp` e autenticazione **OAuth**.
3. Accedi con il tuo account. I nomi esatti dei menu cambiano spesso: leggili nell'interfaccia al momento.

### Codex
- Con OAuth: `codex mcp add approve --url https://approve.heili.cloud/mcp`, poi completa il login quando richiesto.
- Con chiave personale: metti la chiave in una variabile d'ambiente (es. `APPROVE_KEY`) e in `~/.codex/config.toml`:

  ```toml
  [mcp_servers.approve]
  url = "https://approve.heili.cloud/mcp"
  bearer_token_env_var = "APPROVE_KEY"
  ```

### Claude Code
- Con OAuth: `claude mcp add --transport http approve https://approve.heili.cloud/mcp`, poi `/mcp` per accedere.
- Con chiave personale: `claude mcp add --transport http approve https://approve.heili.cloud/mcp --header "Authorization: Bearer ⟨la tua chiave⟩"`.

La chiave non va mai incollata in chat né salvata in un file del repository. Si
revoca da Impostazioni in qualsiasi momento.

### MCP Inspector (per provare)
`npx @modelcontextprotocol/inspector` → URL `https://approve.heili.cloud/mcp`,
Transport *Streamable HTTP*, header `Authorization: Bearer ⟨chiave⟩` (oppure il
flusso OAuth). Deve mostrare 8 strumenti.

## 5. Checklist Auth0 (una tantum, ~45 minuti)

Stesso **tenant** di Heili (stesso *issuer*). Si crea **una nuova API** per
Approve: non si riusa quella di Heili (audience e permessi sono diversi). Come
nel documento di Heili, la strategia è **client pre-registrato** (Auth0 non
espone la registrazione dinamica aperta sul piano attuale): nessun codice nuovo,
funziona su qualsiasi piano. La registrazione dinamica (DCR, RFC 7591) si valuta
dopo, a flusso funzionante.

### Fase 0 — Decisioni (5 min)
- [ ] Ogni persona entra col **proprio** account Heili: l'accesso a Approve è per email verificata (fase 5 e fase 2).
- [ ] Tenant: ⟨dominio del tenant Auth0 di Heili, es. `https://⟨tenant⟩.eu.auth0.com/`⟩ (copiarlo dal `.env` del servizio Heili: `JWT_ISSUER`).

### Fase 1 — Creare l'API (10 min)
- [ ] **Applications → APIs → Create API**: nome «Approve MCP», **Identifier** `https://approve.heili.cloud/mcp`, algoritmo di firma **RS256**. L'Identifier deve coincidere *esattamente* con `MCP_JWT_AUDIENCE` (o con `PUBLIC_BASE_URL` + `/mcp` se non imposti la variabile).
- [ ] Sull'API → Settings: **Enable RBAC = ON** e **Add Permissions in the Access Token = ON** (senza, gli scope non compaiono nel token e ogni chiamata dà 403).
- [ ] **Permissions → Add**: `approve:read` («Leggere clienti, post e commenti») e `approve:draft` («Creare bozze, caricare media, aprire il piano del mese»).
- [ ] Sull'API → *Access Settings*: **Allow Offline Access = ON** (refresh token: il collegamento non scade a ogni ora).

### Fase 2 — L'email nel token (10 min)
Auth0 non mette l'email negli access token: serve una **Action** (Actions →
Library → Build Custom → trigger *Login / Post Login*, poi aggiungerla al flow
*Login*):

```js
exports.onExecutePostLogin = async (event, api) => {
  const ns = "https://approve.heili.cloud";
  // Solo email verificate: se non lo è, il claim non c'è e Approve rifiuta il token.
  if (event.user.email && event.user.email_verified) {
    api.accessToken.setCustomClaim(`${ns}/email`, event.user.email);
    api.accessToken.setCustomClaim(`${ns}/email_verified`, true);
  }
};
```

- [ ] Action creata, **deployata** e aggiunta al flow *Login*.
- [ ] Se il namespace scelto è diverso da `${PUBLIC_BASE_URL}`, imposta `MCP_JWT_EMAIL_CLAIM=⟨namespace⟩/email` sul server. Il codice prova, in quest'ordine: `MCP_JWT_EMAIL_CLAIM`, `email`, `${PUBLIC_BASE_URL}/email`; se accanto c'è `<claim>_verified` (o `email_verified`) deve valere `true`.

### Fase 3 — Un'applicazione per ogni client AI (15 min)
Un client alla volta: prima Claude, poi ChatGPT, solo quando il primo è verde.
- [ ] **Applications → Create Application**, tipo **Native**, nome «Claude (Approve)». Grant types: **Authorization Code** e **Refresh Token** (PKCE è automatico).
- [ ] **Allowed Callback URLs**: il redirect che Claude mostra quando si crea il connettore (di solito `https://claude.ai/api/mcp/auth_callback`: **leggerlo nell'interfaccia di Claude al momento**, non dalla memoria).
- [ ] Application → *APIs*: autorizzare l'applicazione sull'API «Approve MCP» con gli scope `approve:read` e `approve:draft`.
- [ ] Lasciare l'app *first-party* (Settings → Advanced) per saltare la schermata di consenso.
- [ ] ChatGPT: seconda applicazione «ChatGPT (Approve)», callback `https://chatgpt.com/connector_platform_oauth_redirect` (anche questa da verificare nell'interfaccia di ChatGPT).
- [ ] Il client chiede di inserire *Client ID* (e, se richiesto, il segreto) nella sua schermata «Autenticazione avanzata» del connettore: Client ID dall'app Auth0.
- [ ] Punto aperto da verificare al primo test (come in Heili, punto 7): la specifica MCP manda il parametro `resource` (RFC 8707), Auth0 storicamente usa `audience`. Se il flusso si ferma qui, cerca nelle impostazioni avanzate del tenant l'opzione di compatibilità col parametro `resource` (nome da verificare nell'interfaccia) o segnala il problema: non blocca la configurazione.

### Fase 4 — Server (5 min, sul VPS)
Nel `.env` di produzione (accanto a `docker-compose.prod.yml`):

| Variabile | Valore | Note |
|---|---|---|
| `MCP_JWT_ISSUER` | ⟨issuer del tenant, con `https://` e `/` finale⟩ | Obbligatoria per OAuth. Solo https |
| `MCP_JWT_JWKS_URL` | ⟨issuer⟩`.well-known/jwks.json` | Obbligatoria per OAuth. Solo https |
| `MCP_JWT_AUDIENCE` | `https://approve.heili.cloud/mcp` | Facoltativa: predefinito `PUBLIC_BASE_URL` + `/mcp` |
| `MCP_JWT_EMAIL_CLAIM` | ⟨namespace⟩`/email` | Facoltativa (vedi fase 2) |
| `MCP_ENABLED` | `true` | `false` spegne l'endpoint |
| `MCP_RATE_LIMIT_PER_MINUTE` | `120` | Per utente/chiave |
| `MCP_MAX_UPLOAD_BYTES` | `20971520` | Tetto di `upload_media` (mai oltre 300 MB) |
| `MCP_ALLOWED_ORIGINS` | ⟨origini extra, separate da virgola⟩ | Facoltativa: oltre a `claude.ai`/`chatgpt.com` per client nel browser |

Poi `docker compose -f docker-compose.prod.yml up -d web`. Verifica:

```bash
curl -s https://approve.heili.cloud/.well-known/oauth-protected-resource/mcp   # resource, authorization_servers, scopes
curl -si -X POST https://approve.heili.cloud/mcp -d '{}' | grep -i www-auth       # 401 con resource_metadata
```

Caddy non richiede modifiche: `/mcp` e `/.well-known/*` passano dal
`reverse_proxy` già configurato (il limite di 320 MB del corpo copre anche gli
upload in base64).

### Fase 5 — Chi entra (per persona)
- [ ] La persona ha già un account Approve (ha fatto login almeno una volta) ed è membro del workspace dell'agenzia, con la **stessa email** del suo account Heili/Auth0. Non c'è nessun provisioning automatico: senza account il token è rifiutato con 403.
- [ ] L'email è in `ALLOWED_EMAILS` (se la lista è usata).

### Fase 6 — Prova con MCP Inspector (prima di Claude)
- [ ] OAuth completato, `initialize`, `tools/list` = 8 strumenti, `list_clients` mostra i clienti giusti.
- [ ] Test negativi obbligatori:
  - [ ] token senza `approve:read`/`approve:draft` → **403**;
  - [ ] email non verificata o non presente nel token → **403**;
  - [ ] email senza account/workspace Approve → **403**;
  - [ ] audience o issuer sbagliati, token scaduto → **401**;
  - [ ] un id cliente/post di un altro workspace → «non trovato».

### Fase 7 — Claude e poi ChatGPT
- [ ] Connettore personalizzato in Claude (§4); prova di lettura e di una bozza con `validate_only`.
- [ ] Solo dopo, ChatGPT.

## 6. Prova locale (senza Auth0)
1. `npm run db:seed`, avvia l'app (README, «Avvio in locale»).
2. Impostazioni → *Importa con Codex o Claude* → crea una chiave.
3. `curl -s -X POST http://localhost:3000/mcp -H "Authorization: Bearer ⟨chiave⟩" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`.
4. Test automatici: `npx vitest run __tests__/mcp-*.test.ts` e `sh e2e/run.sh e2e/mcp.spec.mjs`.

## 7. Controlli e audit
- **Chi ha creato una bozza:** nella cronologia del post, evento «Creato» con `metadata.source = "mcp"`, l'utente, `tokenId` (chiave personale) o `via` (app OAuth, claim `azp`).
- **Chi ha chiamato cosa:** `docker compose -f docker-compose.prod.yml logs web | grep mcp.tools_call`. Ogni riga è JSON: `user_id`, `token_id`/`oauth_client`, `workspace_ids`, `tool`, `outcome` (`ok`/`error`/`denied`), `duration_ms`, `created_post_ids`, `created_media_ids`, `created_plan_ids`. Mai argomenti, testi o token. `mcp.auth_rejected` e `mcp.rate_limited` registrano i rifiuti.
- **Revoca:** chiave personale → Impostazioni → *Revoca*; account → togliere il membro dal workspace o disattivare l'utente su Auth0.

## 8. Limiti noti e passi successivi
- **Mapping per email, non per `sub`.** Heili collega `(issuer, sub)` a un utente con una tabella esplicita; Approve non ha quella tabella e usa l'email verificata del token. È sicuro finché il tenant emette l'email solo se verificata (la Action sopra) e solo ad account del tuo dominio di fiducia. Alternativa più rigida: tabella `(issuer, sub) → userId` come in Heili.
- **Rate limit in memoria**, per processo: esatto con un solo container `web` (oggi), per replica altrimenti. Il tetto giornaliero delle bozze è invece su database e vale per tutti.
- **Nessun upload da URL.** Per ora i media si caricano in base64 (max 20 MB) o dal pannello. Un caricamento da URL richiede una lista di host consentiti e controlli SSRF: da progettare a parte.
- **Solo post social.** Articoli e creatività ads si leggono (`list_posts`, `get_post`) ma non si creano via MCP.
- **Nessun client reale ancora certificato.** Il contratto è implementato e testato in locale; Claude, ChatGPT e Codex vanno provati sullo staging (fasi 6-7) prima di usare dati veri.
