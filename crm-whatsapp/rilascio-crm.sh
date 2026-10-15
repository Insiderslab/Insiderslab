#!/usr/bin/env bash
# Rilascio del CRM (Heili CRM / vocero-crm) sul VPS — 3° rilascio, 15/10/2026.
#
#   bash rilascio-crm.sh                      → rilascio di main @ TARGET (PR #9 sicurezza webhook, #15 collegamento WhatsApp guidato)
#   bash rilascio-crm.sh attiva-pulsante ID   → aggiunge META_APP_ID e META_ES_CONFIG_ID (=ID) e riavvia
#
# Si ferma al primo controllo che non torna e spiega cosa fare. Non stampa
# mai segreti. Non tocca Meta. Il backup del database si fa SEMPRE prima.
set -euo pipefail

APP_DIR=${RILASCIO_APP_DIR:-/opt/vocero}
TARGET=${RILASCIO_TARGET:-db6f4268ce0b7b1a5553f9aa684b93a29fcccc41}   # main dopo le PR #9 e #15
PREV=65f06f37c6ccbdd54400379f7f7d7853eec7aa9b        # rilascio del 13/10 (per tornare indietro)
MIG_EXPECTED=17                                      # 0000–0016
APP_ID=609974691965875                               # app Meta del CRM (non segreto)
PG=vocero-postgres
APP=vocero-app
HEALTH=https://crm.heili.cloud/api/health
BACKUP_DIR=${RILASCIO_BACKUP_DIR:-/root/backup}
DIAG=${RILASCIO_DIAG:-/root/heili-diag/diagnosi-whatsapp.sh}

ok()   { printf '\033[32m  OK\033[0m %s\n' "$*"; }
info() { printf '  .. %s\n' "$*"; }
stop() { printf '\n\033[31m  STOP\033[0m %s\n' "$*"; printf '  Niente è stato rotto: incolla questo output a Claude.\n\n'; exit 1; }
psqlq() { docker exec "$PG" psql -U postgres -d vocero -At -c "$1"; }

wait_health() {
  for _ in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH" || true)
    [ "$code" = "200" ] && return 0
    sleep 3
  done
  return 1
}

[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || stop "script non ancora pronto (manca il commit da rilasciare): aspetta il messaggio di Claude"
cd "$APP_DIR" || stop "cartella $APP_DIR non trovata"

# ---------------------------------------------------------------------------
if [ "${1:-}" = "attiva-pulsante" ]; then
  CFG="${2:-}"
  [[ "$CFG" =~ ^[0-9]{6,25}$ ]] || stop "manca il Configuration ID (solo cifre): bash rilascio-crm.sh attiva-pulsante 1234567890"
  grep -q "META_APP_ID: \${META_APP_ID" docker-compose.yml || stop "docker-compose.yml non passa META_APP_ID: il rilascio non è ancora stato fatto"
  if grep -q '^META_APP_ID=' .env; then info "META_APP_ID già presente nel .env"; else echo "META_APP_ID=$APP_ID" >> .env; ok "META_APP_ID aggiunto"; fi
  if grep -q '^META_ES_CONFIG_ID=' .env; then
    sed -i "s/^META_ES_CONFIG_ID=.*/META_ES_CONFIG_ID=$CFG/" .env; ok "META_ES_CONFIG_ID aggiornato"
  else
    echo "META_ES_CONFIG_ID=$CFG" >> .env; ok "META_ES_CONFIG_ID aggiunto"
  fi
  docker compose up -d app >/dev/null 2>&1
  wait_health || stop "il CRM non risponde 200 dopo il riavvio: docker compose logs app --since 5m | tail -40"
  got=$(docker exec "$APP" sh -c 'echo "${META_APP_ID:+si}/${META_ES_CONFIG_ID:+si}/${META_APP_SECRET:+si}"')
  [ "$got" = "si/si/si" ] || stop "nel container mancano delle variabili (APP_ID/CONFIG_ID/APP_SECRET = $got)"
  ok "pulsante attivo: Impostazioni → WhatsApp → «Collega con Meta» (solo owner/admin)"
  exit 0
fi

echo "== 0. Controlli =="
[ -z "$(git status --porcelain --untracked-files=no)" ] || { git status --short --untracked-files=no; stop "ci sono file modificati nel repo: non li tocco"; }
CUR=$(git rev-parse HEAD)
if [ "$CUR" = "$TARGET" ]; then info "il codice è già a ${TARGET:0:7}: rifaccio solo build e controlli"; fi
docker ps --format '{{.Names}}' | grep -qx "$PG" || stop "container $PG non in esecuzione"
info "organizzazioni: $(psqlq "select string_agg(name, ' | ' order by created_at) from organization;")"
for v in BOT_API_KEY EXPORT_API_KEY; do
  if grep -qE "^$v=.+" .env; then
    stop "$v è impostata nel .env. Con 2 organizzazioni smetterà di funzionare dopo il rilascio (è voluto): prima servono le chiavi per organizzazione (docs/ops/rilascio-c1.md)."
  fi
done
grep -qE '^META_APP_SECRET=.+' .env || stop "META_APP_SECRET manca nel .env: con questo rilascio il webhook rifiuterebbe TUTTI i messaggi (503). Prima: bash correggi-app-secret.sh"
if grep -qE '^WAPI_BASE_URL=.+' .env; then stop "WAPI_BASE_URL è impostata: Wapi è congelato, toglila o chiedi prima di procedere"; fi
ok "nessuna chiave d'istanza in uso, Wapi spento"
NMSG=$(psqlq "select count(*) from message;")
[ "$NMSG" -lt 2000000 ] || stop "$NMSG messaggi: oltre 2 milioni il primo avvio del livello canali è troppo lungo (docs/ops/rilascio-canali.md)"
ok "messaggi nel database: $NMSG (primo avvio stimato: pochi secondi)"
long_tx() { psqlq "select count(*) from pg_stat_activity where datname = 'vocero' and xact_start is not null and pid <> pg_backend_pid() and now() - xact_start > interval '10 seconds';"; }
[ "$(long_tx)" = "0" ] || stop "c'è una transazione aperta da più di 10 secondi sul database (pg_dump o psql?): chiudila e rilancia"
ok "nessuna transazione lunga sul database"

echo "== 1. Backup =="
mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$BACKUP_DIR/vocero-pre-rilascio-$TS.dump"
docker exec "$PG" pg_dump -U postgres -d vocero -Fc > "$DUMP"
[ -s "$DUMP" ] || stop "backup vuoto"
docker exec -i "$PG" pg_restore --list < "$DUMP" > /dev/null || stop "il backup non si legge"
MIG_BEFORE=$(psqlq "select count(*) from drizzle.__drizzle_migrations;")
ok "backup $DUMP ($(du -h "$DUMP" | cut -f1)), migrazioni applicate: $MIG_BEFORE"

echo "== 2. Codice =="
git fetch -q origin main
git merge-base --is-ancestor "$TARGET" origin/main || stop "${TARGET:0:7} non è su origin/main"
git checkout -q main 2>/dev/null || git checkout -q -B main origin/main
git merge -q --ff-only "$TARGET" || stop "non riesco ad avanzare main fino a ${TARGET:0:7} senza merge"
[ "$(git rev-parse HEAD)" = "$TARGET" ] || stop "HEAD diverso da ${TARGET:0:7}"
ok "codice a $(git log --oneline -1)"

echo "== 3. Build e avvio (qualche minuto) =="
docker compose build --build-arg SOURCE_COMMIT="$TARGET" app > /tmp/rilascio-build.log 2>&1 || { tail -30 /tmp/rilascio-build.log; stop "build fallita (log completo: /tmp/rilascio-build.log). Il CRM vecchio è ancora acceso."; }
ok "build"
[ "$(long_tx)" = "0" ] || stop "c'è una transazione lunga sul database: chiudila e rilancia (il CRM vecchio è ancora acceso)"
docker compose up -d app > /dev/null 2>&1   # ricrea il container: ferma il vecchio, poi avvia il nuovo (stop-first)
if ! wait_health; then
  docker compose logs app --since 5m | tail -40
  stop "il CRM non risponde 200. Per tornare indietro (sicuro, senza backup): git checkout $PREV && docker compose build app && docker compose up -d app"
fi
if docker compose logs app --since 10m 2>&1 | grep -q "\[migrate\].*fall"; then
  docker compose logs app --since 10m | grep "\[migrate\]" | tail -10
  stop "migrazione fallita: backup in $DUMP"
fi
MIG_AFTER=$(psqlq "select count(*) from drizzle.__drizzle_migrations;")
[ "$MIG_AFTER" = "$MIG_EXPECTED" ] || stop "migrazioni applicate: $MIG_AFTER (attese $MIG_EXPECTED)"
psqlq "select restrict_to_allowlist, error_reply from agent_profile limit 1;" > /dev/null || stop "colonne nuove di agent_profile mancanti"
psqlq "select agent_retry_at from conversation limit 1;" > /dev/null || stop "colonna agent_retry_at mancante"
psqlq "select count(*) from instance_setting;" > /dev/null || stop "tabella instance_setting mancante"
SA=$(grep -E '^SUPERADMIN_EMAILS=' .env | cut -d= -f2- | tr 'A-Z' 'a-z' | tr -d ' "' | sed "s/,/','/g")
if [ -n "$SA" ]; then info "account con email superadmin (controllo, sola lettura): $(psqlq "select coalesce(string_agg(email || ' creato ' || to_char(created_at,'YYYY-MM-DD'), ' | '), 'nessuno') from \"user\" where lower(email) in ('$SA');")"; fi
ok "CRM acceso (200), migrazioni $MIG_BEFORE → $MIG_AFTER"

echo "== 3b. Livello canali =="
RIEP=$(docker compose logs app --since 15m 2>&1 | grep -o "canali (avvisa): V1=.*" | tail -1)
VSUM=$(psqlq "select coalesce(sum(anomalie), -1) from channels_legacy_check();")
FASEB=$(psqlq "select (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname in ('contact_org_id_uq','message_org_channel_ext_uq') and i.indisvalid) || '/' || (select count(*) from pg_constraint where conname in ('contact_identity_contact_fk','message_channel_ck','conversation_channel_account_fk') and convalidated);")
info "riepilogo avvio: ${RIEP:-non trovato nel log}"
CANALI_OK=si
[ "$VSUM" = "0" ] || CANALI_OK=no
[ "$FASEB" = "2/3" ] || CANALI_OK=no
case "$RIEP" in *"V1=0 V2=0 V3=0 V4=0 V5=0 V6=0 V7=0"*) ;; *) CANALI_OK=no;; esac
if [ "$CANALI_OK" = si ]; then ok "livello canali allineato (V1–V7 = 0, indici e vincoli validi)"
else printf '\033[33m  ATTENZIONE\033[0m livello canali: anomalie V=%s, indici/vincoli=%s (attesi 0 e 2/3). Il CRM funziona lo stesso (legge le colonne vecchie): incolla questo output a Claude.\n' "$VSUM" "$FASEB"; fi

echo "== 4. WhatsApp =="
if [ -f "$DIAG" ]; then
  bash "$DIAG" 2>&1 | tail -25
else
  info "diagnosi-whatsapp.sh non trovato in /root/heili-diag: salto"
fi

printf '\n\033[32m== RILASCIO FATTO ==\033[0m\n'
echo "  1. Manda \"prova rilascio\" al +1 555 779 6249: deve arrivare nella Posta e l'assistente deve rispondere."
echo "  2. Ora l'App Secret: su Meta (app 609974691965875 → Impostazioni → Di base → Chiave segreta) premi Reimposta, e SUBITO dopo qui:"
echo "       cd /root/heili-diag && curl -fsSLO https://raw.githubusercontent.com/Insiderslab/Insiderslab/claude/exciting-rubin-mow1yu/crm-whatsapp/correggi-app-secret.sh && bash correggi-app-secret.sh"
echo "     Poi Impostazioni → WhatsApp: «Firma del webhook» deve diventare «Verificata» al prossimo messaggio."
echo "  3. Configuration ID: incollalo in crm.heili.cloud/admin → Piattaforma → Meta (niente più comandi)."
echo "  4. Copia il backup sul tuo PC: scp root@186.241.16.46:$DUMP ."
