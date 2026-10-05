#!/usr/bin/env sh
# Runs the Playwright end-to-end test against an app that is ALREADY running
# (npm run build && PORT=3000 METRICOOL_FAKE=1 npm run start, plus
# METRICOOL_FAKE=1 npm run worker > $E2E_WORKER_LOG).
#
# Playwright is not a dependency of the project: this uses a local install if
# there is one, otherwise the global one (npm i -g playwright && npx playwright
# install chromium). E2E_WORKER_LOG must point at the worker's stdout, which is
# where the fake Metricool client prints the payload it would have sent.
set -eu
cd "$(dirname "$0")/.."

if [ -f node_modules/playwright/cli.js ]; then
  PW_DIR="$(pwd)/node_modules/playwright"
else
  PW_DIR="$(npm root -g)/playwright"
fi
if [ ! -f "$PW_DIR/cli.js" ]; then
  echo "Playwright non trovato: installalo con 'npm i -g playwright && npx playwright install chromium'." >&2
  exit 1
fi

export PLAYWRIGHT_TEST_MODULE="$PW_DIR/test.js"
exec node "$PW_DIR/cli.js" test --config e2e/playwright.config.mjs "$@"
