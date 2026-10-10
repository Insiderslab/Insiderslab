#!/usr/bin/env bash
# Sostituisce OPENROUTER_API_TOKEN del CRM (vocero) sul VPS, senza mostrarlo.
# 1) chiede la chiave nascosta  2) la verifica con OpenRouter e controlla che l'account abbia credito
# 3) copia .env, scrive il valore  4) ricrea il container app  5) prova una risposta del modello.
set -u
DIR=/opt/vocero; APP_CTR=vocero-app; HEALTH=https://crm.heili.cloud/api/health
cd "$DIR" || { echo "Cartella $DIR non trovata"; exit 1; }
H=$(mktemp); trap 'rm -f "$H"; unset NEW' EXIT; chmod 600 "$H"

echo "Su https://openrouter.ai/settings/keys, entrando con l'account che ha i 10 €, crea una chiave nuova (Create Key, nome: heili-crm) e copiala."
read -rsp "Incollala qui (non verrà mostrata) e premi Invio: " NEW; echo
NEW=$(printf '%s' "$NEW" | tr -d '[:space:]"'"'")
if ! [[ "$NEW" =~ ^sk-or-[A-Za-z0-9_-]{20,}$ ]]; then echo "Formato non valido (deve iniziare con sk-or-, ricevuti ${#NEW} caratteri). Nessuna modifica."; exit 1; fi
printf 'Authorization: Bearer %s\n' "$NEW" > "$H"

R=$(curl -s -H @"$H" https://openrouter.ai/api/v1/key)
printf '%s' "$R" | grep -q '"data"' || { echo "OpenRouter non riconosce questa chiave. Nessuna modifica."; exit 1; }
FREE=$(printf '%s' "$R" | grep -o '"is_free_tier":[a-z]*' | cut -d: -f2)
LIM=$(printf '%s' "$R" | grep -o '"limit_remaining":[^,}]*' | cut -d: -f2)
echo "OpenRouter: chiave valida · account gratuito: $FREE · limite rimanente della chiave: $LIM"
if [ "$FREE" = "true" ]; then
  echo "Questa chiave è ancora di un account SENZA credito acquistato: non è l'account con i 10 €. Nessuna modifica."
  exit 1
fi

# Prova vera con lo stesso modello del CRM e un tetto realistico di token.
MODEL=$(grep -E '^OPENROUTER_MODEL=' .env | cut -d= -f2-)
C=$(curl -s -o /dev/null -w '%{http_code}' -H @"$H" -H 'Content-Type: application/json' \
  -d "{\"model\":\"${MODEL:-anthropic/claude-sonnet-4.5}\",\"max_tokens\":3000,\"messages\":[{\"role\":\"user\",\"content\":\"di solo: ok\"}]}" \
  https://openrouter.ai/api/v1/chat/completions)
[ "$C" = "200" ] || { echo "Il modello risponde HTTP $C con questa chiave (credito insufficiente?). Nessuna modifica."; exit 1; }
echo "Prova del modello ${MODEL}: OK"

B=".env.bak-openrouter-$(date +%Y%m%d-%H%M%S)"; cp .env "$B" && chmod 600 "$B" && echo "Copia di sicurezza: $B"
grep -v '^OPENROUTER_API_TOKEN=' .env > .env.tmp && printf 'OPENROUTER_API_TOKEN=%s\n' "$NEW" >> .env.tmp && cat .env.tmp > .env && rm -f .env.tmp
echo "Righe OPENROUTER_API_TOKEN in .env: $(grep -c '^OPENROUTER_API_TOKEN=' .env)"

echo "Ricreo il container app..."
docker compose up -d app >/dev/null 2>&1
for _ in $(seq 1 40); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH")" = "200" ] && break; sleep 3; done
L=$(docker exec "$APP_CTR" printenv OPENROUTER_API_TOKEN | tr -d '\n' | wc -c)
if [ "$L" = "${#NEW}" ]; then
  echo "OK: il CRM usa la chiave nuova. Ora: Posta → la tua chat → «Riattiva IA», poi scrivi al +1 555 779 6249."
  echo "Poi su openrouter.ai/settings/keys puoi disattivare la chiave vecchia."
else
  echo "Il container ha una chiave di $L caratteri invece di ${#NEW}. Ripristino: cp $B .env && docker compose up -d app"
fi
