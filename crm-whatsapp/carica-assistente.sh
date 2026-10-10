#!/usr/bin/env bash
# Carica l'assistente interno (profilo + base di conoscenza) nell'organizzazione
# del +1 555, senza passare dalla pagina Agente.
#   bash carica-assistente.sh                       → organizzazione "Negocio de Stefano Finoti"
#   bash carica-assistente.sh "InsidersLab · Interno" → dopo la rinomina
# Prima fa una copia di profilo e base di conoscenza attuali; tutto in una transazione.
set -euo pipefail
ORG_NAME="${1:-Negocio de Stefano Finoti}"
PG=vocero-postgres
DIR=/root/heili-diag
BK=/root/backup
RAW=https://raw.githubusercontent.com/Insiderslab/Insiderslab/claude/exciting-rubin-mow1yu/crm-whatsapp

ok()   { printf '\033[32m  OK\033[0m %s\n' "$*"; }
stop() { printf '\n\033[31m  STOP\033[0m %s\n  Niente è stato modificato.\n\n' "$*"; exit 1; }
psqlq() { docker exec "$PG" psql -U postgres -d vocero -At -v ON_ERROR_STOP=1 "$@"; }

mkdir -p "$DIR" "$BK"
curl -fsSL "$RAW/assistente-interno.sql" -o "$DIR/assistente-interno.sql" || stop "non riesco a scaricare assistente-interno.sql"
grep -q 'Heili · Asistente interno' "$DIR/assistente-interno.sql" || stop "file SQL scaricato non valido"

# Il nome viene da questo script o dal primo argomento: apici raddoppiati per l'SQL.
ORG_SQL_NAME=${ORG_NAME//\'/\'\'}
N=$(psqlq -c "select count(*) from organization where name = '$ORG_SQL_NAME';")
[ "$N" = "1" ] || stop "organizzazioni con nome «$ORG_NAME»: $N (atteso 1)"
ORG=$(psqlq -c "select id from organization where name = '$ORG_SQL_NAME';")
ok "organizzazione «$ORG_NAME»"
echo "     ruoli dei membri: $(psqlq -c "select coalesce(string_agg(role||'='||n, ' '), 'nessuno') from (select role, count(*) n from member where organization_id = '$ORG' group by role) x;")"

TS=$(date -u +%Y%m%dT%H%M%SZ)
psqlq -c "copy (select * from agent_profile where organization_id = '$ORG') to stdout with csv header" > "$BK/agente-pre-$TS.csv"
psqlq -c "copy (select * from kb_entry where organization_id = '$ORG') to stdout with csv header" > "$BK/kb-pre-$TS.csv"
ok "copia di sicurezza: $BK/agente-pre-$TS.csv e $BK/kb-pre-$TS.csv ($(($(wc -l < "$BK/kb-pre-$TS.csv") - 1)) voci di prima)"

docker exec -i "$PG" psql -U postgres -d vocero -q -v ON_ERROR_STOP=1 -v org="$ORG" -1 < "$DIR/assistente-interno.sql" || stop "caricamento fallito (transazione annullata)"
ok "caricato: $(psqlq -c "select name || ' · agente ' || case when enabled then 'ACCESO' else 'spento' end from agent_profile where organization_id = '$ORG';")"
ok "base di conoscenza: $(psqlq -c "select string_agg(kind||'='||n, ' ') from (select kind, count(*) n from kb_entry where organization_id = '$ORG' group by kind order by kind) x;")"
echo
echo "  Ora: CRM → Agente (ricarica la pagina) e prova nel Laboratorio, poi scrivi al +1 555 dal telefono."
