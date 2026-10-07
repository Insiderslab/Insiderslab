# Importazione post da Excel, CSV e JSON

`scripts/approve_import.py` è l'interfaccia locale e senza dipendenze per creare bozze in Approve. È pensata per essere usata allo stesso modo da una persona, Codex, Claude o un'automazione controllata.

L'importatore crea esclusivamente post in stato `DRAFT`. Non invia piani al cliente, non approva post e non programma pubblicazioni. L'accesso ai clienti dipende dal token: l'API mostra e modifica solo i workspace e i clienti consentiti a quel token.

Ogni membro crea la propria chiave personale dalla sezione **Impostazioni → Importa con Codex/Claude**. La chiave dura 30 giorni, può essere revocata e smette di funzionare se il membro perde l'accesso al workspace. Non condividere la chiave tra membri.

## Configurazione

Servono Python 3.11 o successivo e due variabili d'ambiente. Non mettere il token nel file Excel, nei prompt, nei log o nel repository.

PowerShell:

```powershell
$env:APPROVE_BASE_URL = "https://approve.example.com"
$env:APPROVE_API_TOKEN = "approve_auto_..."
python C:\percorso\heili-approve\scripts\approve_import.py doctor
```

Bash:

```bash
export APPROVE_BASE_URL="https://approve.example.com"
export APPROVE_API_TOKEN="approve_auto_..."
python /percorso/heili-approve/scripts/approve_import.py doctor
```

L'URL deve usare HTTPS. HTTP è accettato soltanto per `localhost`, `127.0.0.1` e `::1` durante lo sviluppo.

Ogni comando scrive un unico documento JSON su standard output e restituisce codice `0` in caso di successo, `2` per errori attesi e `1` per errori inattesi. Questo rende il risultato facile da leggere e verificare per un agente.

## Flusso consigliato per Codex e Claude

1. Verificare l'accesso con `doctor`.
2. Cercare il cliente e copiare il suo `id`.
3. Compilare il file, mantenendo un `source_id` stabile per ogni post.
4. Eseguire il dry-run e correggere tutte le righe non valide.
5. Riportare il riepilogo alla persona responsabile, distinguendo errori e campi ambigui.
6. Usare `--commit` quando la creazione delle bozze è autorizzata dalla richiesta. Una richiesta esplicita di importare i post in bozza costituisce già autorizzazione; la sola analisi del foglio no.
7. Conservare il manifest se sono presenti media e si vuole poter riprendere l'operazione.

Comandi:

```powershell
python scripts/approve_import.py clients --query "Nome cliente"
python scripts/approve_import.py resolve "Nome cliente"
python scripts/approve_import.py post POST_ID
python scripts/approve_import.py template --output .\approve-posts.csv

# Dry-run: valida tutte le righe. Non carica media e non crea post.
python scripts/approve_import.py import .\approve-posts.xlsx --timezone Europe/Rome

# Forma esplicita equivalente al default.
python scripts/approve_import.py import .\approve-posts.xlsx --timezone Europe/Rome --dry-run

# Commit esplicito: carica i media e crea soltanto bozze.
python scripts/approve_import.py import .\approve-posts.xlsx --timezone Europe/Rome --commit

# Percorso alternativo per lo stato di ripresa.
python scripts/approve_import.py import .\approve-posts.xlsx --timezone Europe/Rome --commit --manifest .\approve-upload-manifest.json
```

Il comando `validate` è un sinonimo più restrittivo del dry-run e non espone `--commit`:

```powershell
python scripts/approve_import.py validate .\approve-posts.csv
```

## Colonne

| Colonna | Obbligatoria | Formato |
| --- | --- | --- |
| `source_id` | sì | Identificativo stabile e univoco nel file, massimo 128 caratteri. Deve iniziare con una lettera o cifra; poi accetta lettere, cifre, `_ . : / -`. Riutilizzare lo stesso valore per ripetere in sicurezza una creazione. |
| `client_id` | sì | ID ottenuto con `clients` o `resolve`. Non usare il nome libero del cliente. |
| `title` | sì | Titolo interno della bozza. |
| `publish_at` | sì | ISO 8601 con offset, per esempio `2026-10-15T10:30:00+02:00`. |
| `networks` | sì | Reti separate da `|`, per esempio `instagram|facebook`. In JSON può essere un array; i valori vengono normalizzati in minuscolo. |
| `text` | sì | Testo completo del post. |
| `first_comment` | no | Primo commento. |
| `media_files` | no | Percorsi locali separati da `|`, relativi alla cartella del foglio. |
| `media_durations` | no | Durate in secondi nello stesso ordine dei media, separate da `|`. |
| `kind` | no | In questa versione è ammesso soltanto `SOCIAL_POST`, che è anche il valore predefinito. |
| `network_options` | no | Oggetto JSON con le opzioni specifiche per rete. |

Il [template CSV](templates/approve-posts.csv) è UTF-8. Sono supportati CSV con separatore virgola o punto e virgola, JSON e file `.xlsx` normali. I file `.xls` non sono supportati.

In JSON usare un array di oggetti oppure `{ "posts": [...] }`. I nomi delle proprietà sono identici alle colonne.

## Date e fusi orari

La forma più sicura è sempre una data ISO 8601 con offset esplicito. Le celle data native di Excel non contengono un fuso orario: per usarle è necessario passare `--timezone Europe/Rome` o un'altra timezone IANA.

L'importatore supporta entrambi i sistemi data Excel, 1900 e 1904. Non indovina le ore ambigue o inesistenti durante il cambio dell'ora legale: in quei casi chiede una data ISO con offset esplicito.

Su Windows, dove Python può essere installato senza database IANA, `UTC` e `Europe/Rome` sono comunque supportati direttamente. Le altre timezone richiedono il database IANA del sistema; se non è disponibile, usare una data ISO con offset esplicito.

## Media e ripresa

Per impostazione predefinita, ogni percorso media deve restare dentro la cartella che contiene il foglio. Per usare un'altra cartella, dichiararla esplicitamente:

```powershell
python scripts/approve_import.py import .\dati\posts.xlsx --media-root D:\contenuti\cliente --commit
```

Il controllo usa percorsi risolti e impedisce anche a un collegamento simbolico di uscire dalla cartella consentita. L'importatore non scarica URL remoti.

Nel dry-run i media vengono controllati localmente, ma l'API riceve `media: []`. Il risultato indica `mediaDeferred: true`: significa che l'upload sarà eseguito soltanto nel commit.

Ogni commit salva automaticamente lo stato accanto al foglio, per esempio `approve-posts.xlsx.approve-import-state.json`. `--manifest` permette di scegliere un percorso diverso. Il file registra gli upload completati tramite hash del contenuto e metadati ed è legato a server, token, workspace e cliente. Non contiene il token. Viene aggiornato atomicamente dopo ogni upload. Se appartiene a un altro contesto l'importazione si ferma senza riscriverlo. Media identici sono riutilizzati anche durante la singola esecuzione.

L'endpoint media non offre ancora una chiave di idempotenza. Se il processo si interrompe esattamente dopo che il server ha accettato un file e prima che il manifest venga scritto, al tentativo successivo può essere creato un asset duplicato. Il manifest riduce questa finestra ma non può eliminarla.

## Comportamento sicuro

- Prima di un commit, tutte le righe vengono validate dall'API senza upload. Se una riga non è valida non viene eseguita alcuna scrittura.
- `source_id` duplicati nello stesso file vengono rifiutati prima di contattare l'API.
- La creazione non viene ritentata automaticamente. Una ripetizione esplicita usa lo stesso `source_id` e viene gestita dall'idempotenza dell'API.
- Intestazioni sconosciute, formule, macro, collegamenti esterni e oggetti incorporati negli XLSX vengono rifiutati.
- Il token viene oscurato negli errori e non è mai stampato nell'output.

Per visualizzare tutte le opzioni:

```powershell
python scripts/approve_import.py --help
python scripts/approve_import.py import --help
```
