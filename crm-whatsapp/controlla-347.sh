#!/usr/bin/env bash
# Controllo del +39 347 718 5235 prima di collegarlo a Heili — SOLA LETTURA, sul VPS.
#   bash controlla-347.sh
# Usa il token WhatsApp già salvato nel CRM (quello del +1 555, utente di sistema di
# Insiderlabs Business) per chiedere a Meta: il numero è in coexistence (app sul telefono
# + API)? Di chi è l'account? Quali app ricevono i suoi messaggi? Il token lo vede?
# Non modifica niente, non stampa segreti (token passato a curl via stdin).
set -u
APP_CTR=vocero-app
PG_CTR=vocero-postgres
GV=v25.0
PNID_347=265807564634942          # +39 347 718 5235 (dalla lista numeri di Insiderlabs Business)
ACCOUNTS="2780652498731208 745402748557550"   # account WhatsApp del 347 (id di messaggistica e id account)
PNID_555=671133866076775          # +1 555: da qui si prende il token salvato

unesc() { sed 's#\\/#/#g'; }
redact() { unesc | sed -E 's#(/api/webhooks/wa/)[^"\\ ]+#\1<token>#g; s#("access_token"|"verify_token")[^,}]*#\1:"<nascosto>"#g'; }
graph() { { printf 'url = "https://graph.facebook.com/%s/%s"\n' "$GV" "$1"; printf 'header = "Authorization: Bearer %s"\n' "$2"; } | curl -s -K -; }

CRED=$(docker exec "$PG_CTR" psql -U postgres -d vocero -At -F $'\n' -c "select token_cipher, token_iv, token_tag from meta_credentials where phone_number_id = '$PNID_555' limit 1;" 2>/dev/null)
TOK=$(printf '%s\n' "$CRED" | docker exec -i "$APP_CTR" node -e '
  const c=require("crypto");const [a,b,t]=require("fs").readFileSync(0,"utf8").trim().split("\n");
  const d=c.createDecipheriv("aes-256-gcm",Buffer.from(process.env.ENCRYPTION_KEY,"base64"),Buffer.from(b,"base64"));
  d.setAuthTag(Buffer.from(t,"base64"));
  process.stdout.write(Buffer.concat([d.update(Buffer.from(a,"base64")),d.final()]).toString("utf8"));' 2>/dev/null || true)
[ -n "$TOK" ] || { echo "Token del CRM non leggibile: incolla questo output a Claude."; exit 1; }

echo "== 1. Il numero +39 347 718 5235"
graph "$PNID_347?fields=display_phone_number,verified_name,status,platform_type,is_on_biz_app,code_verification_status,name_status,quality_rating,webhook_configuration" "$TOK" | redact; echo
echo
for A in $ACCOUNTS; do
  echo "== 2. Account $A: proprietario e app che ricevono i messaggi"
  graph "$A?fields=name,owner_business_info,on_behalf_of_business_info" "$TOK" | redact; echo
  graph "$A/subscribed_apps" "$TOK" | redact; echo
  graph "$A/phone_numbers?fields=id,display_phone_number" "$TOK" | redact; echo
  echo
done
echo "== 3. Organizzazioni del CRM e numeri già collegati"
docker exec "$PG_CTR" psql -U postgres -d vocero -At -F ' | ' -c "select o.name, coalesce(m.display_phone_number,'(nessun numero)'), coalesce(m.onboarding_mode::text,'-') from organization o left join meta_credentials m on m.organization_id = o.id order by o.created_at;" | sed 's/^/  /'
unset TOK
echo
echo "Incolla tutto l'output a Claude. Niente è stato modificato."
