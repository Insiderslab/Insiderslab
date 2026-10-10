# Percorso coexistence — dal codice al +39 347 718 5235 collegato (app + CRM)

**Aggiornato:** 10/10/2026 · Sostituisce la "Strada 1 (Clientify)" del `PIANO-COEXISTENCE-INSIDERSLAB.md`: il collegamento guidato ora è nel nostro CRM.

## Stato
| Pezzo | Stato |
|---|---|
| Codice CRM: pulsante "Collega con Meta", import di storico e rubrica, avviso di scollegamento | ✅ Fatto. Repo `Insiderslab/vocero-crm`, branch `claude/exciting-rubin-mow1yu`, commit `ebea4b5`. Controlli tutti verdi: tipi, lint, 284 test, build, prova completa 111/111. **Non unito a `main`, non in produzione.** |
| Specifica | `vocero-crm/specs/custom-heili/005-coexistence-embedded-signup.md` |
| Meta: configurazione del collegamento guidato, dominio, campi webhook | ⏳ Da fare con il prompt `PROMPT-CHROME-TECH-PROVIDER.md` |
| Meta: Tech Provider | ⏳ Serve **solo per i clienti**. Per il numero di InsidersLab basta che Stefano abbia un ruolo nell'app (accesso standard) |

## Passi in ordine

### 1. Meta (Chrome, con il tuo ok a ogni clic)
Lancia `PROMPT-CHROME-TECH-PROVIDER.md`. Per il +39 347 servono solo questi tre punti della Parte 2:
- **3.** Configurazione "WhatsApp Embedded Signup" → annota il **Configuration ID**.
- **4.** `crm.heili.cloud` tra i domini consentiti per l'SDK JavaScript.
- **5.** Campi webhook: `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`, `message_template_status_update`.

Il resto (verifica dell'azienda, App Review, verifica dell'accesso) è per i clienti e può andare avanti in parallelo.

### 2. Revisione e unione del codice (decide Stefano)
Regola di Heili: niente unione a `main` senza il titolare. Consiglio una revisione indipendente con Codex (prompt qui sotto), poi l'unione.

**Attenzione:** anche il branch C1/C2 (`claude/keen-ptolemy-l0kv8g`) porta una migrazione `0009`. Quello che si unisce per secondo deve rigenerare la sua migrazione (`pnpm db:generate`), mai modificarla a mano.

### 3. Rilascio sul VPS (dopo l'unione)
```
cd /opt/vocero
git pull --ff-only
# aggiungi a .env (non sono segreti):
#   META_APP_ID=609974691965875
#   META_ES_CONFIG_ID=<Configuration ID del passo 1>
docker compose build app && docker compose up -d app   # la migrazione 0009 parte da sola all'avvio
docker compose logs app --since 5m | tail -20
curl -s -o /dev/null -w '%{http_code}\n' https://crm.heili.cloud/api/health   # atteso 200
```
`META_APP_SECRET` c'è già. Se l'hai reimpostato, prima rilancia `bash /root/heili-diag/correggi-app-secret.sh`.

### 4. Organizzazione InsidersLab nel CRM
`https://crm.heili.cloud/admin` → crea l'organizzazione **InsidersLab** con te come proprietario. Il numero di prova +1 555 resta in "Negocio de Stefano Finoti".

Agente IA **spento** su InsidersLab finché il test non è chiuso: va su `/agent`, interruttore off.

### 5. Collegamento del +39 347 (5 minuti, telefono in mano)
1. Sul telefono: aggiorna **WhatsApp Business** all'ultima versione e aprila.
2. Nel CRM, organizzazione InsidersLab: **Impostazioni → WhatsApp → "Collega con Meta"**.
3. Nella finestra di Meta: entra con Facebook, scegli **Insiderlabs Business**, scegli il numero **+39 347 718 5235** dell'app WhatsApp Business.
4. Sul telefono: conferma (codice QR o avviso nell'app). Alla domanda sullo storico: **condividi** (fino a 6 mesi).
5. Il CRM mostra: "Numero … collegato (app + CRM)" e l'etichetta **App + CRM**.

### 6. Verifiche
- VPS: `docker compose logs app --since 30m | grep -E "agenda de la app|historial de la app|coexistence"`. Atteso: righe `agenda … N cambios` e `historial … importado — N mensajes nuevos` (arrivano entro qualche minuto).
- Da un altro telefono scrivi al +39 347: il messaggio arriva **sia** sull'app **sia** nella Posta del CRM.
- Rispondi **dall'app del telefono**: nel CRM compare come risposta manuale e l'IA di quella chat si mette in pausa.
- Rispondi **dal CRM**: arriva al cliente e si vede anche sull'app.

### 7. Regole da ricordare
- Apri l'app sul telefono **almeno ogni 13 giorni**, altrimenti Meta scollega il numero dal CRM: compare un banner rosso e va ripetuto il passo 5.
- Gruppi, messaggi effimeri e liste broadcast non passano al CRM.
- Rubrica e storico si possono chiedere **una volta sola**, entro circa 24 ore dal collegamento.

### 8. Per i clienti (dopo)
Il video per l'App Review si può registrare proprio con il passo 5. Dopo l'approvazione e la verifica dell'accesso, lo stesso pulsante funziona per i portfoli dei clienti, La Bambola compresa.

## Rischi
- Alcuni dettagli di Meta li ho presi da fonti di terzi, perché la documentazione ufficiale da qui non si apre. Se Meta li manda diversi, si vedono nei log e il resto continua a funzionare:
  - i nomi degli eventi di scollegamento;
  - se il messaggio finale della finestra di Meta contiene anche l'ID del numero (il codice funziona anche senza).
- Se l'organizzazione condivide l'account WhatsApp (WABA) con altri numeri, l'avviso di scollegamento vale per tutta la WABA.

## Prompt per Codex (revisione indipendente)
```
Repo Insiderslab/vocero-crm, branch claude/exciting-rubin-mow1yu (commit ebea4b5), base main 2f4338d.
Revisione indipendente della feature "coexistence" (spec specs/custom-heili/005-coexistence-embedded-signup.md).
Controlla in particolare: sicurezza del canje del code (src/lib/meta/client.ts exchangeEmbeddedSignupCode, nessun segreto in log/risposte),
permessi owner/admin su POST /api/settings/whatsapp/embedded-signup, isolamento per organization_id nei nuovi handler
(src/server/inbox/coexistence.ts), idempotenza dello storico, effetti collaterali assenti (finestra 24 h, non letti, lead, IA),
migrazione 0009 (conflitto di numerazione con claude/keen-ptolemy-l0kv8g), validazione origine del postMessage in
src/components/settings/coexistence-connect.tsx.
Gate: pnpm typecheck && pnpm lint && pnpm test && pnpm build, più scripts/e2e-selftest.mjs con mocks e META_APP_ID/META_ES_CONFIG_ID/META_APP_SECRET impostati.
Nessun merge, nessun deploy. Consegna: elenco dei problemi con file:riga e gravità, e patch proposte su un branch codex/review-coexistence.
```
