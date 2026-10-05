#!/bin/sh
# Scheduler for the periodic jobs under /api/cron.
#
# A self-hosted instance has no Vercel crons, so without this container the
# jobs never run — silently. The one that hurts is sweep: an approved post
# whose job was lost (Redis restart, worker down) would never reach Metricool.
#
# Run as its own container from the app image (see the compose file), so the
# jobs live with the app they belong to.

set -u

BASE_URL="${CRON_BASE_URL:-http://web:3000}"
# Same fallback as the routes themselves: they accept either secret.
SECRET="${CRON_SECRET:-${NEXTAUTH_SECRET:-}}"

if [ -z "$SECRET" ]; then
  echo "[cron] neither CRON_SECRET nor NEXTAUTH_SECRET is set — the routes would answer 401" >&2
  exit 1
fi

call() {
  route="$1"
  stamp=$(date -u '+%Y-%m-%d %H:%M:%S')

  if body=$(wget -q -O- --timeout=180 \
      --header="Authorization: Bearer $SECRET" \
      "$BASE_URL/api/cron/$route" 2>&1); then
    echo "[cron] $stamp $route ok $body"
  else
    # A failure is worth shouting about: these jobs have no user watching them.
    echo "[cron] $stamp $route FAILED ${body:-no response}" >&2
  fi
}

echo "[cron] scheduler started, target $BASE_URL"

last_slot=""
last_hour=""

while true; do
  now=$(date -u '+%Y-%m-%d %H:%M')
  hhmm=${now#* }
  minute=${hhmm#*:}
  hour_slot=${now%:*}

  # sweep every 5 minutes: approved posts left behind and lost jobs reach
  # Metricool within minutes, well before their publication time.
  case "$minute" in
    00|05|10|15|20|25|30|35|40|45|50|55)
      if [ "$last_slot" != "$hhmm" ]; then
        last_slot="$hhmm"
        call sweep
      fi
      ;;
  esac

  # reminders hourly: the route itself enforces max one per post per 24 h and
  # only sends during the client's working hours, so hourly is just the grain.
  if [ "$last_hour" != "$hour_slot" ]; then
    last_hour="$hour_slot"
    call reminders
  fi

  # Half a minute: short enough never to skip a slot, long enough to stay idle.
  sleep 30
done
