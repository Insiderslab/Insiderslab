#!/usr/bin/env bash
# Diagnosi dell'agente IA: perché non risponde? SOLA LETTURA, non stampa segreti.
#   bash diagnosi-agente.sh                         → organizzazione "Negocio de Stefano Finoti"
#   bash diagnosi-agente.sh "InsidersLab · Interno"
set -uo pipefail
ORG_NAME="${1:-Negocio de Stefano Finoti}"
PG=vocero-postgres
APP=vocero-app
psqlq() { docker exec "$PG" psql -U postgres -d vocero -At -F ' | ' -c "$1"; }

echo "== 1. Configurazione IA nel container =="
docker exec "$APP" sh -c 'echo "  token: ${OPENROUTER_API_TOKEN:+presente}${OPENROUTER_API_TOKEN:-MANCANTE}"; echo "  base: ${OPENROUTER_BASE_URL:-?}"; echo "  modello: ${OPENROUTER_MODEL:-MANCANTE}"; echo "  giudice: ${OPENROUTER_JUDGE_MODEL:-MANCANTE}"' \
  | sed 's/token: presente.*/token: presente/'

echo "== 2. Prova del provider (OpenRouter) =="
docker exec "$APP" node -e '
const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api";
const h = { Authorization: "Bearer " + (process.env.OPENROUTER_API_TOKEN || "").trim(), "Content-Type": "application/json" };
(async () => {
  try {
    const r = await fetch(base + "/v1/key", { headers: h });
    const j = await r.json().catch(() => ({}));
    const d = j.data || {};
    console.log("  chiave: HTTP " + r.status + " · uso $" + d.usage + " · limite " + d.limit + " · rimanente " + d.limit_remaining + " · free " + d.is_free_tier);
    if (!r.ok) console.log("  errore: " + JSON.stringify(j.error || j).slice(0, 200));
  } catch (e) { console.log("  chiave: errore di rete " + e.message); }
  try {
    const r = await fetch(base + "/v1/chat/completions", { method: "POST", headers: h,
      body: JSON.stringify({ model: process.env.OPENROUTER_MODEL, max_tokens: 5, messages: [{ role: "user", content: "di solo: ok" }] }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) console.log("  risposta del modello: HTTP 200 «" + ((j.choices || [])[0]?.message?.content || "").trim() + "»");
    else console.log("  risposta del modello: HTTP " + r.status + " " + JSON.stringify(j.error || j).slice(0, 300));
  } catch (e) { console.log("  modello: errore di rete " + e.message); }
})();
'

echo "== 3. Log dell'agente (ultime 3 ore) =="
docker logs "$APP" --since 3h 2>&1 | grep -E "\[agente\]|\[agent\]|\[lab\]|\[ai\]|\[webhook\]|\[pipeline\]|openrouter|OpenRouter|allowlist|riservat" | tail -20 | cut -c1-300 || true
echo "  (fine log)"

echo "== 4. Stato conversazioni =="
ORG_SQL_NAME=${ORG_NAME//\'/\'\'}
ORG=$(psqlq "select id from organization where name = '$ORG_SQL_NAME' limit 1;")
[ -n "$ORG" ] || { echo "  organizzazione «$ORG_NAME» non trovata"; exit 0; }
echo "  agente: $(psqlq "select name || ' · ' || case when enabled then 'ACCESO' else 'SPENTO' end from agent_profile where organization_id = '$ORG';")"
echo "  accesso riservato: $(psqlq "select case when restrict_to_allowlist then 'ACCESO (numeri in lista: ' || coalesce(array_length(allowed_identities, 1), 0) || ')' else 'spento' end from agent_profile where organization_id = '$ORG';" 2>/dev/null || echo '?')"
echo "  test | IA conv | handoff | motivo | ultimo entrante (UTC) | ultimo messaggio"
psqlq "select c.is_test, c.ai_enabled, coalesce(to_char(c.handoff_at,'MM-DD HH24:MI'),'-'), coalesce(c.handoff_reason::text,'-'),
              coalesce(to_char(c.last_inbound_at,'MM-DD HH24:MI'),'-'),
              coalesce((select m.direction || ' ' || to_char(m.created_at,'MM-DD HH24:MI') from message m where m.conversation_id = c.id order by m.created_at desc limit 1),'-')
       from conversation c where c.organization_id = '$ORG' order by c.updated_at desc nulls last limit 8;" | sed 's/^/  /'
echo
echo "  Incolla tutto l'output a Claude."
