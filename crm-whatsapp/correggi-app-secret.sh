#!/usr/bin/env bash
# Corregge META_APP_SECRET del CRM (vocero) sul VPS. Da lanciare in /opt/vocero.
# 1) chiede l'App Secret senza mostrarlo  2) verifica con Meta che sia quello dell'app 609974691965875
# 3) fa una copia di .env, scrive il valore  4) ricrea il container app  5) ricontrolla.
set -u
DIR=/opt/vocero; APP_CTR=vocero-app; META_APP=609974691965875; GV=v25.0
cd "$DIR" || { echo "Cartella $DIR non trovata"; exit 1; }

echo "Dove è definito oggi META_APP_SECRET (valori nascosti):"
grep -n "META_APP_SECRET" .env docker-compose.yml docker-compose.override.yml 2>/dev/null | sed -E 's/(META_APP_SECRET[[:space:]]*[:=]).*/\1 <nascosto>/'
if grep -qE '^[[:space:]]*-?[[:space:]]*META_APP_SECRET[[:space:]]*[:=][[:space:]]*[^$[:space:]]' docker-compose.override.yml 2>/dev/null; then
  echo
  echo "ATTENZIONE: docker-compose.override.yml contiene un valore scritto direttamente e vince su .env."
  echo "Apri il file (nano docker-compose.override.yml), cancella la riga META_APP_SECRET indicata sopra, salva e rilancia questo script."
  exit 1
fi

echo
echo "Copia la chiave da: https://developers.facebook.com/apps/$META_APP/settings/basic/ -> Chiave segreta dell'app -> Mostra"
read -rsp "Incollala qui (non verrà mostrata) e premi Invio: " NEW; echo
NEW=$(printf '%s' "$NEW" | tr -d '[:space:]"'"'")
if ! [[ "$NEW" =~ ^[0-9a-f]{32}$ ]]; then echo "Formato non valido (servono 32 caratteri 0-9 a-f, ne ho ricevuti ${#NEW}). Nessuna modifica."; unset NEW; exit 1; fi
R=$(printf 'url = "https://graph.facebook.com/%s/%s?fields=id,name&access_token=%s%%7C%s"\n' "$GV" "$META_APP" "$META_APP" "$NEW" | curl -s -K -)
if ! printf '%s' "$R" | grep -q '"name"'; then echo "Meta non riconosce questa chiave per l'app $META_APP. Nessuna modifica."; unset NEW; exit 1; fi
echo "Meta conferma: chiave dell'app $(printf '%s' "$R" | sed -E 's/.*"name":"([^"]*)".*/\1/')."

B=".env.bak-$(date +%Y%m%d-%H%M%S)"; cp .env "$B" && echo "Copia di sicurezza: $B"
grep -v '^META_APP_SECRET=' .env > .env.tmp && printf 'META_APP_SECRET=%s\n' "$NEW" >> .env.tmp && cat .env.tmp > .env && rm -f .env.tmp
unset NEW
echo "Righe META_APP_SECRET in .env: $(grep -c '^META_APP_SECRET=' .env)"

echo "Ricreo il container app (le variabili si rileggono solo così)..."
docker compose up -d app
sleep 8
L=$(docker exec "$APP_CTR" printenv META_APP_SECRET | tr -d '\n' | wc -c)
[ "$L" = "32" ] && echo "OK: il container ora ha un segreto di 32 caratteri. Scrivi 'ciao' al +1 555 779 6249 e lancia diagnosi-whatsapp.sh." \
                || echo "Il container ha ancora un segreto di $L caratteri: il valore arriva da un'altra parte (vedi l'elenco in alto). Ripristino: cp $B .env && docker compose up -d app"
