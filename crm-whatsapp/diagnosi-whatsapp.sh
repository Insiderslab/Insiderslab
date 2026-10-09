#!/usr/bin/env bash
# Diagnosi CRM WhatsApp (Heili CRM / vocero) — da lanciare sul VPS.
#   bash diagnosi-whatsapp.sh            -> solo lettura, nessuna modifica
#   bash diagnosi-whatsapp.sh --iscrivi  -> in più iscrive il WABA all'app (POST subscribed_apps)
# Non stampa mai segreti: App Secret, token WhatsApp e token del webhook restano in variabili
# e vengono passati a curl via stdin (-K -), quindi non finiscono in cronologia né in `ps`.
set -u

DIR=/opt/vocero
APP_CTR=vocero-app
PG_CTR=vocero-postgres
HOST=https://crm.heili.cloud
META_APP=609974691965875           # Whatpp Business Insiderslab (Live)
OTHER_APPS="1017740407963024 3536853626479911"   # Whapi by Heili, Dm Heili
PNID=671133866076775                # +1 555 779 6249
WABA=1027272492350148               # Insiderslab Team
GV=v25.0
ISCRIVI=0; [ "${1:-}" = "--iscrivi" ] && ISCRIVI=1

PROBLEMI=()
ok() { echo "  [OK] $*"; }
ko() { echo "  [KO] $*"; PROBLEMI+=("$*"); }
info() { echo "       $*"; }
unesc() { sed 's#\\/#/#g'; }
redact() { unesc | sed -E 's#(/api/webhooks/wa/)[^"\\ ]+#\1<token>#g; s#("access_token"|"verify_token")[^,}]*#\1:"<nascosto>"#g'; }
graph() { # graph METHOD PATH TOKEN [extra-config-lines]
  local m="$1" p="$2" t="$3"
  { printf 'url = "https://graph.facebook.com/%s/%s"\n' "$GV" "$p"
    printf 'request = "%s"\n' "$m"
    printf 'header = "Authorization: Bearer %s"\n' "$t"; } | curl -s -K -
}

cd "$DIR" 2>/dev/null || { echo "Cartella $DIR non trovata"; exit 1; }
echo "Diagnosi WhatsApp — $(date -u '+%Y-%m-%d %H:%M UTC')"

echo; echo "== 1. Container"
for c in "$APP_CTR" "$PG_CTR"; do
  s=$(docker ps --filter "name=^${c}$" --format '{{.Status}}')
  [ -n "$s" ] && ok "$c: $s" || ko "$c non in esecuzione"
done

echo; echo "== 2. App Secret (META_APP_SECRET)"
S=$(docker exec "$APP_CTR" printenv META_APP_SECRET 2>/dev/null || true)
if [ -z "$S" ]; then
  ko "META_APP_SECRET vuoto nel container: la firma non viene verificata (il webhook accetta tutto)"
else
  info "lunghezza ${#S} (attesa 32)"
  if ! [[ "$S" =~ ^[0-9a-f]{32}$ ]]; then
    ko "META_APP_SECRET non ha il formato di un App Secret (32 caratteri esadecimali): è un altro valore o contiene spazi/virgolette"
  fi
  appcheck() { printf 'url = "https://graph.facebook.com/%s/%s?fields=id,name&access_token=%s%%7C%s"\n' "$GV" "$1" "$1" "$S" | curl -s -K -; }
  R=$(appcheck "$META_APP")
  if printf '%s' "$R" | grep -q '"name"'; then
    ok "il segreto è quello dell'app $META_APP ($(printf '%s' "$R" | sed -E 's/.*"name":"([^"]*)".*/\1/'))"
  else
    ko "il segreto NON è quello dell'app $META_APP: Meta firma con un altro segreto e il CRM risponde 401 a ogni evento"
    info "risposta Meta: $(printf '%s' "$R" | grep -oE '"(code|message)":("[^"]*"|[0-9]+)' | head -2 | tr '\n' ' ')"
    for X in $OTHER_APPS; do
      printf '%s' "$(appcheck "$X")" | grep -q '"name"' && info "...è invece il segreto dell'app $X (app sbagliata)"
    done
  fi
fi

echo; echo "== 3. Connessione salvata nel CRM (tabella meta_credentials)"
ROWS=$(docker exec "$PG_CTR" psql -U postgres -d vocero -At -F ' | ' -c \
  "select o.name, m.waba_id, m.phone_number_id, coalesce(m.display_phone_number,''), m.status from meta_credentials m join organization o on o.id = m.organization_id order by m.created_at;" 2>&1)
if [ -z "$ROWS" ]; then
  ko "nessuna connessione WhatsApp salvata in nessuna organizzazione"
else
  printf '%s\n' "$ROWS" | sed 's/^/       /'
  if printf '%s\n' "$ROWS" | grep -q " $PNID "; then
    ok "Phone Number ID $PNID salvato"
    printf '%s\n' "$ROWS" | grep " $PNID " | grep -q "connected" && ok "stato connected" || ko "stato diverso da connected (token da riconnettere)"
    printf '%s\n' "$ROWS" | grep " $PNID " | grep -q " $WABA " && ok "WABA $WABA salvato" || ko "WABA salvato diverso da $WABA"
  else
    ko "Phone Number ID $PNID NON salvato: il CRM scarta i messaggi di +1 555 779 6249 (phone_number_id sconosciuto)"
  fi
fi
info "messaggi ultime 24 h: $(docker exec "$PG_CTR" psql -U postgres -d vocero -At -c "select coalesce(string_agg(direction||'='||n, ' '),'nessuno') from (select direction, count(*) n from message where created_at > now() - interval '24 hours' group by direction) x;" 2>&1)"

echo; echo "== 4. Webhook del CRM (dall'esterno, come lo chiama Meta)"
T=$(docker exec "$APP_CTR" printenv META_WEBHOOK_VERIFY_TOKEN 2>/dev/null || true)
if [ -z "$T" ]; then
  ko "META_WEBHOOK_VERIFY_TOKEN vuoto"
else
  R=$(printf 'url = "%s/api/webhooks/wa/%s?hub.mode=subscribe&hub.verify_token=%s&hub.challenge=PROVA-OK"\n' "$HOST" "$T" "$T" | curl -s -K -)
  [ "$R" = "PROVA-OK" ] && ok "verifica GET: risponde alla challenge" || ko "verifica GET: risposta inattesa '$(printf '%s' "$R" | head -c 80)'"
  BODY=$(mktemp); printf '%s' '{"object":"whatsapp_business_account","entry":[{"id":"0","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":"123456123"},"messages":[]}}]}]}' > "$BODY"
  SIG=""; [ -n "$S" ] && SIG=$(openssl dgst -sha256 -hmac "$S" < "$BODY" | sed 's/^.* //')
  C1=$({ printf 'url = "%s/api/webhooks/wa/%s"\n' "$HOST" "$T"; [ -n "$SIG" ] && printf 'header = "x-hub-signature-256: sha256=%s"\n' "$SIG"; } \
       | curl -s -o /dev/null -w '%{http_code}' -K - -X POST -H 'content-type: application/json' --data-binary @"$BODY")
  C2=$(printf 'url = "%s/api/webhooks/wa/%s"\n' "$HOST" "$T" | curl -s -o /dev/null -w '%{http_code}' -K - -X POST -H 'content-type: application/json' --data-binary @"$BODY")
  rm -f "$BODY"
  [ "$C1" = "200" ] && ok "POST firmato col segreto del CRM: 200" || ko "POST firmato: $C1 (atteso 200)"
  if [ -n "$S" ]; then [ "$C2" = "401" ] && ok "POST senza firma: 401 (la firma è attiva)" || ko "POST senza firma: $C2 (atteso 401)"; fi
  sleep 2
  docker compose logs app --since 3m 2>&1 | grep -q "desconocido (123456123)" && ok "il CRM ha elaborato l'evento di prova (log 'desconocido (123456123)')" || ko "nel log non compare l'evento di prova"
fi

echo; echo "== 5. Lato Meta, con il token salvato nel CRM"
CRED=$(docker exec "$PG_CTR" psql -U postgres -d vocero -At -F $'\n' -c "select token_cipher, token_iv, token_tag from meta_credentials where phone_number_id = '$PNID' limit 1;" 2>/dev/null)
TOK=""
if [ -n "$CRED" ]; then
  TOK=$(printf '%s\n' "$CRED" | docker exec -i "$APP_CTR" node -e '
    const c=require("crypto");const [a,b,t]=require("fs").readFileSync(0,"utf8").trim().split("\n");
    const d=c.createDecipheriv("aes-256-gcm",Buffer.from(process.env.ENCRYPTION_KEY,"base64"),Buffer.from(b,"base64"));
    d.setAuthTag(Buffer.from(t,"base64"));
    process.stdout.write(Buffer.concat([d.update(Buffer.from(a,"base64")),d.final()]).toString("utf8"));' 2>/dev/null || true)
fi
if [ -z "$TOK" ]; then
  ko "token WhatsApp non leggibile (nessuna connessione per $PNID o ENCRYPTION_KEY diversa): salto i controlli Meta"
else
  R=$(graph GET "$PNID?fields=display_phone_number,verified_name,status,platform_type,name_status,quality_rating,webhook_configuration" "$TOK" | unesc)
  if printf '%s' "$R" | grep -q '"error"'; then
    ko "token rifiutato da Meta: $(printf '%s' "$R" | grep -oE '"message":"[^"]*"' | head -1)"
  else
    ok "token valido"
    info "numero: $(printf '%s' "$R" | redact)"
    printf '%s' "$R" | grep -q '"platform_type":"CLOUD_API"' && ok "numero sulla Cloud API" || ko "platform_type diverso da CLOUD_API"
    WAPP=$(printf '%s' "$R" | grep -oE '"application":"[^"]*"' | head -1)
    case "$WAPP" in
      *crm.heili.cloud/api/webhooks/wa/*)
        SEG=$(printf '%s' "$WAPP" | sed -E 's#.*/api/webhooks/wa/([^"]*)".*#\1#')
        ok "callback dell'app = CRM"
        [ "$SEG" = "$T" ] && ok "il token nella URL di Meta coincide con META_WEBHOOK_VERIFY_TOKEN" || ko "il token nella URL di Meta NON coincide con quello del CRM (il CRM risponde 404)";;
      "") ko "webhook_configuration senza URL dell'app";;
      *) ko "callback dell'app NON è il CRM: $(printf '%s' "$WAPP" | redact)";;
    esac
    printf '%s' "$R" | grep -qE '"(whatsapp_business_account|phone_number)":"' && ko "c'è un override di callback a livello WABA o numero: gli eventi vanno a quell'indirizzo, non all'app (vedi riga 'numero' sopra)"
  fi
  R=$(graph GET "$WABA/subscribed_apps" "$TOK" | unesc)
  info "app iscritte al WABA: $(printf '%s' "$R" | grep -oE '"(name|id)":"[^"]*"' | paste -sd' ' | redact)"
  if printf '%s' "$R" | grep -q "\"$META_APP\""; then
    ok "il WABA è iscritto all'app $META_APP"
  else
    ko "il WABA NON è iscritto all'app $META_APP: Meta non manda gli eventi al CRM"
    if [ "$ISCRIVI" = 1 ]; then
      R2=$(graph POST "$WABA/subscribed_apps" "$TOK")
      printf '%s' "$R2" | grep -q '"success":true' && ok "iscrizione eseguita ora (--iscrivi): riscrivi 'ciao' al numero" || ko "iscrizione fallita: $(printf '%s' "$R2" | redact | head -c 200)"
    else
      info "per correggere: bash $0 --iscrivi"
    fi
  fi
fi
unset S T TOK CRED SIG

echo; echo "== Esito"
if [ ${#PROBLEMI[@]} -eq 0 ]; then
  echo "  Nessun problema trovato lato CRM e configurazione Meta. Se il messaggio non arriva ancora:"
  echo "  controlla le spunte sul telefono e il campo 'messages' attivo nel webhook dell'app."
else
  echo "  ${#PROBLEMI[@]} problema/i, il primo è di solito la causa:"
  for p in "${PROBLEMI[@]}"; do echo "   - $p"; done
fi
