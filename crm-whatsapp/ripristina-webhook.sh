#!/usr/bin/env bash
# Rimette il CRM come destinatario dei webhook WhatsApp dell'app Meta 609974691965875.
# Usa l'App Secret e il token di verifica già nel .env del CRM: niente da incollare, niente segreti a video.
# Prima di procedere: disattiva in n8n il flusso con il nodo «WhatsApp Trigger», altrimenti n8n lo cambia di nuovo.
set -u
DIR=/opt/vocero; APP_ID=609974691965875; GV=v25.0; CRM=https://crm.heili.cloud
FIELDS="messages,message_template_status_update,smb_message_echoes,history,smb_app_state_sync,account_update"
cd "$DIR" || { echo "Cartella $DIR non trovata"; exit 1; }
SECRET=$(grep -E '^META_APP_SECRET=' .env | cut -d= -f2- | tr -d '[:space:]"'"'")
VTOKEN=$(grep -E '^META_WEBHOOK_VERIFY_TOKEN=' .env | cut -d= -f2- | tr -d '[:space:]"'"'")
[ ${#SECRET} -eq 32 ] || { echo "META_APP_SECRET non valido nel .env: lancia prima correggi-app-secret.sh"; exit 1; }
[ ${#VTOKEN} -ge 8 ] || { echo "META_WEBHOOK_VERIFY_TOKEN mancante nel .env"; exit 1; }

graph() { # $1 metodo, $2 percorso, resto: coppie chiave=valore (mai a video: passano da curl -K)
  local m=$1 p=$2; shift 2
  { printf 'url = "https://graph.facebook.com/%s/%s"\n' "$GV" "$p"
    printf 'request = "%s"\n' "$m"
    printf 'data-urlencode = "access_token=%s|%s"\n' "$APP_ID" "$SECRET"
    for kv in "$@"; do printf 'data-urlencode = "%s"\n' "$kv"; done
    [ "$m" = GET ] && printf 'get\n'
  } | curl -s -K -
}

echo "== Callback attuale dell'app"
CUR=$(graph GET "$APP_ID/subscriptions")
printf '%s' "$CUR" | grep -o '"object":"whatsapp_business_account"[^}]*"callback_url":"[^"]*"' | sed 's/.*"callback_url":"\([^"]*\)".*/   \1/' | sed -E 's#(/api/webhooks/wa/)[^"/]+#\1<token>#'
echo
echo "Sto per impostare: $CRM/api/webhooks/wa/<token del CRM>"
echo "Campi: $FIELDS"
echo "ATTENZIONE: da questo momento n8n NON riceverà più i messaggi WhatsApp di questa app."
read -rp "Scrivi SI per procedere: " OK
OK=$(printf %s "$OK" | tr -d "[:space:]" | tr "[:lower:]" "[:upper:]"); [ "$OK" = "SI" ] || { echo "Annullato, nessuna modifica."; exit 0; }

R=$(graph POST "$APP_ID/subscriptions" "object=whatsapp_business_account" "callback_url=$CRM/api/webhooks/wa/$VTOKEN" "verify_token=$VTOKEN" "fields=$FIELDS")
if printf '%s' "$R" | grep -q '"success":true'; then
  echo "OK: Meta ha verificato il CRM e salvato il callback."
else
  echo "Meta ha rifiutato: $(printf '%s' "$R" | sed -E 's/access_token=[^&"]*/access_token=<nascosto>/g' | head -c 400)"
  exit 1
fi
echo "== Callback ora"
graph GET "$APP_ID/subscriptions" | grep -o '"object":"whatsapp_business_account"[^}]*"callback_url":"[^"]*"' | sed 's/.*"callback_url":"\([^"]*\)".*/   \1/' | sed -E 's#(/api/webhooks/wa/)[^"/]+#\1<token>#'
unset SECRET VTOKEN
echo
echo "Ora: scrivi 'ciao' al +1 555 779 6249 e lancia bash /root/heili-diag/diagnosi-whatsapp.sh"
