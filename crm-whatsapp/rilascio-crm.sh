#!/usr/bin/env bash
# Rilascio del CRM (Heili CRM / vocero-crm) sul VPS — 10/10/2026.
#
#   bash rilascio-crm.sh                      → rilascio di main @ e23332e (PR #3–#6)
#   bash rilascio-crm.sh attiva-pulsante ID   → aggiunge META_APP_ID e META_ES_CONFIG_ID (=ID) e riavvia
#
# Si ferma al primo controllo che non torna e spiega cosa fare. Non stampa
# mai segreti. Non tocca Meta. Il backup del database si fa SEMPRE prima.
set -euo pipefail

APP_DIR=${RILASCIO_APP_DIR:-/opt/vocero}
TARGET=${RILASCIO_TARGET:-e23332ed0bc3a087f0ec915d97488aecc42b6304}   # main dopo la PR #6
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
if [ "$CUR" = "$TARGET" ]; then info "il codice è già a e23332e: rifaccio solo build e controlli"; fi
docker ps --format '{{.Names}}' | grep -qx "$PG" || stop "container $PG non in esecuzione"
info "organizzazioni: $(psqlq "select string_agg(name, ' | ' order by created_at) from organization;")"
for v in BOT_API_KEY EXPORT_API_KEY; do
  if grep -qE "^$v=.+" .env; then
    stop "$v è impostata nel .env. Con 2 organizzazioni smetterà di funzionare dopo il rilascio (è voluto): prima servono le chiavi per organizzazione (docs/ops/rilascio-c1.md)."
  fi
done
if grep -qE '^WAPI_BASE_URL=.+' .env; then stop "WAPI_BASE_URL è impostata: Wapi è congelato, toglila o chiedi prima di procedere"; fi
ok "nessuna chiave d'istanza in uso, Wapi spento"

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
git merge-base --is-ancestor "$TARGET" origin/main || stop "e23332e non è su origin/main"
git checkout -q main 2>/dev/null || git checkout -q -B main origin/main
git merge -q --ff-only "$TARGET" || stop "non riesco ad avanzare main fino a e23332e senza merge"
[ "$(git rev-parse HEAD)" = "$TARGET" ] || stop "HEAD diverso da e23332e"
ok "codice a $(git log --oneline -1)"

echo "== 3. Build e avvio (qualche minuto) =="
docker compose build --build-arg SOURCE_COMMIT="$TARGET" app > /tmp/rilascio-build.log 2>&1 || { tail -30 /tmp/rilascio-build.log; stop "build fallita (log completo: /tmp/rilascio-build.log). Il CRM vecchio è ancora acceso."; }
ok "build"
docker compose up -d app > /dev/null 2>&1
if ! wait_health; then
  docker compose logs app --since 5m | tail -40
  stop "il CRM non risponde 200. Per tornare indietro: git checkout 2f4338d && docker compose build app && docker compose up -d app"
fi
if docker compose logs app --since 10m 2>&1 | grep -q "\[migrate\].*fall"; then
  docker compose logs app --since 10m | grep "\[migrate\]" | tail -10
  stop "migrazione fallita: backup in $DUMP"
fi
MIG_AFTER=$(psqlq "select count(*) from drizzle.__drizzle_migrations;")
[ "$MIG_AFTER" = "13" ] || stop "migrazioni applicate: $MIG_AFTER (attese 13)"
psqlq "select onboarding_mode from meta_credentials limit 1;" > /dev/null || stop "colonna onboarding_mode mancante"
ok "CRM acceso (200), migrazioni $MIG_BEFORE → $MIG_AFTER"

echo "== 4. WhatsApp =="
if [ -f "$DIAG" ]; then
  bash "$DIAG" 2>&1 | tail -25
else
  info "diagnosi-whatsapp.sh non trovato in /root/heili-diag: salto"
fi

printf '\n\033[32m== RILASCIO FATTO ==\033[0m\n'
echo "  1. Manda \"prova rilascio\" al +1 555 779 6249: deve arrivare nella Posta (Negocio de Stefano Finoti)."
echo "  2. Copia il backup sul tuo PC: scp root@186.241.16.46:$DUMP ."
echo "  3. Quando hai il Configuration ID da Meta: bash rilascio-crm.sh attiva-pulsante <ID>"
