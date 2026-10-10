# Rilascio del CRM sul VPS — PR #3, #4, #5 (10/10/2026)

**Cosa va in produzione:** `main` di `Insiderslab/vocero-crm` al commit `126d20a` (oggi gira `2f4338d`):
- isolamento tra clienti con chiavi per organizzazione (C1, C2, C3) e ruoli (PR #3);
- coexistence con il pulsante "Collega con Meta" (PR #4);
- `docker-compose.yml` con le variabili mancanti, volume degli allegati e agente senza conferme di prenotazione (PR #5).

**Modifiche al database:** 4 nuove, da `0009` a `0012`. Sono solo aggiunte e partono da sole all'avvio. Le ho provate su un database con la struttura di oggi e dati di esempio: tutte applicate, la connessione WhatsApp esistente resta "manuale", i messaggi sono intatti.

**Durata:** circa 30 minuti. **Chi:** Stefano, sul VPS, un blocco alla volta. Se un controllo non dà l'atteso, fermati e incollami l'output.

---

## 0. Controlli prima di iniziare (sola lettura)
```bash
cd /opt/vocero
git status --short | head            # atteso: vuoto o solo file tuoi locali (es. docker-compose.override.yml)
git log --oneline -1                 # atteso: 2f4338d
docker exec vocero-postgres psql -U postgres -d vocero -At -c "select name from organization order by created_at;"
grep -E '^(BOT_API_KEY|EXPORT_API_KEY|WAPI_BASE_URL)=' .env | sed 's/=.*/=<impostata>/'
```
- **Se `BOT_API_KEY` o `EXPORT_API_KEY` risultano `<impostata>`:** fermati e dimmelo. Con 2 organizzazioni, dopo il rilascio quelle chiavi smettono di funzionare (è voluto, per sicurezza). Prima va creata una chiave per ogni organizzazione (`docs/ops/rilascio-c1.md` nel repo del CRM).
- Se non compare niente: nessun bot o export usa le chiavi, si procede.

## 1. Backup (obbligatorio)
```bash
mkdir -p /root/backup && TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec vocero-postgres pg_dump -U postgres -d vocero -Fc > /root/backup/vocero-pre-rilascio-$TS.dump
ls -l /root/backup/vocero-pre-rilascio-$TS.dump                                         # dimensione > 0
docker exec -i vocero-postgres pg_restore --list < /root/backup/vocero-pre-rilascio-$TS.dump | head -5   # si legge
docker exec vocero-postgres psql -U postgres -d vocero -At -c "select count(*) from drizzle.__drizzle_migrations;"   # annota il numero (atteso 9)
```
Poi copia il file **fuori dal VPS**: dal tuo PC, `scp root@186.241.16.46:/root/backup/vocero-pre-rilascio-*.dump .`. Finché il backup automatico non c'è, questa è l'unica copia di sicurezza.

## 2. Codice nuovo
```bash
cd /opt/vocero
git fetch origin main
git checkout main
git pull --ff-only                     # atteso: aggiornamento fino a 126d20a
git log --oneline -1
```
Se `git pull` si lamenta di modifiche locali, **non forzare**: incollami l'output.

## 3. Build e avvio
```bash
docker compose build --build-arg SOURCE_COMMIT=$(git rev-parse HEAD) app
docker compose up -d app
sleep 40
docker compose logs app --since 3m | grep -E "\[migrate\]|\[boot\]|rror" | head -20
curl -s -o /dev/null -w '%{http_code}\n' https://crm.heili.cloud/api/health      # atteso 200
docker exec vocero-postgres psql -U postgres -d vocero -At -c "select count(*) from drizzle.__drizzle_migrations;"   # atteso 13
docker exec vocero-postgres psql -U postgres -d vocero -At -c "select onboarding_mode, count(*) from meta_credentials group by 1;"   # atteso: manual|1
```
Atteso nei log: `[migrate]` senza `falló`.

## 4. Verifica che WhatsApp funzioni ancora
```bash
cd /root/heili-diag && bash diagnosi-whatsapp.sh
```
Atteso: tutto OK come il 9/10. Poi manda "prova rilascio" dal telefono al **+1 555 779 6249**: deve comparire nella Posta di "Negocio de Stefano Finoti".

Nel CRM controlla anche:
- `https://crm.heili.cloud/settings/api-keys` si apre (pagina nuova delle chiavi);
- `https://crm.heili.cloud/privacy` mostra la bozza delle pagine legali.

## 5. App Secret nuovo
È il momento giusto per reimpostarlo, visto che quello vecchio è finito in chat:
1. Su Meta, app **Whatpp Business Insiderslab** → Impostazioni → Di base → App Secret → **Reimposta**.
2. Subito dopo:
   ```bash
   cd /root/heili-diag && bash correggi-app-secret.sh && bash diagnosi-whatsapp.sh
   ```

## 6. Attivare il pulsante "Collega con Meta"
Prima lancia su Chrome `PROMPT-CHROME-TECH-PROVIDER.md` (Parte 2, punti 3–5) per avere il **Configuration ID** della configurazione v4. Poi:
```bash
cd /opt/vocero
grep -q '^META_APP_ID=' .env || echo 'META_APP_ID=609974691965875' >> .env
read -rp "Configuration ID: " CFG && grep -q '^META_ES_CONFIG_ID=' .env || echo "META_ES_CONFIG_ID=$CFG" >> .env
docker compose up -d app && sleep 30
docker exec vocero-app sh -c 'echo "META_APP_ID=${META_APP_ID:+presente} META_ES_CONFIG_ID=${META_ES_CONFIG_ID:+presente}"'
```
Il Configuration ID non è segreto e lo puoi incollare liberamente. Atteso: `META_APP_ID=presente META_ES_CONFIG_ID=presente`. In **Impostazioni → WhatsApp** compare il riquadro "Collega il numero dell'app WhatsApp Business".

## 7. Collegare il +39 347 (InsidersLab)
Segui `PERCORSO-COEXISTENCE.md`, passi 4–6:
1. `/admin` → crea l'organizzazione **InsidersLab**;
2. entra in InsidersLab → spegni l'agente IA;
3. Impostazioni → WhatsApp → **Collega con Meta**, con il telefono in mano.

## Se qualcosa va storto
- **Il CRM non parte o dà errori:** torna al codice di prima. Le modifiche al database sono solo aggiunte, il codice vecchio le ignora.
  ```bash
  cd /opt/vocero && git checkout 2f4338d && docker compose build app && docker compose up -d app
  ```
- **Il database è incoerente** (molto improbabile): ripristina il backup del punto 1. Si perdono i messaggi arrivati dopo il backup.
  ```bash
  docker compose stop app
  docker exec -i vocero-postgres pg_restore -U postgres -d vocero --clean --if-exists < /root/backup/vocero-pre-rilascio-<TS>.dump
  docker compose start app
  ```
