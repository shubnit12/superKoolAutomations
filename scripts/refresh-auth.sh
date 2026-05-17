#!/usr/bin/env bash
#
# Standalone auth-refresh runner.
#
# Re-logs into Naukri using NAUKRI_EMAIL / NAUKRI_PASSWORD from .env
# and overwrites auth.json with a fresh session. Two ways to invoke:
#
#   1. Manually, when you know the cookie has died and you want to
#      preempt the next cron failure:
#        ./scripts/refresh-auth.sh
#
#   2. Indirectly — `run-profile.sh` and `run-apply.sh` already call
#      `refreshAuth()` internally on a /nlogin redirect, so most
#      cookie-expiry recoveries happen without needing this script.
#
# IF Naukri shows a captcha / OTP, this run will fail because no human
# is around to solve it — drop back to `npm run login` locally.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${REPO_ROOT}/logs.txt"

# IMPORTANT: pin to nvm's node version (see run-apply.sh for the full
# story — Node 25 from /usr/local/bin breaks Naukri's anti-bot handling).
if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  export NVM_DIR="${HOME}/.nvm"
  # shellcheck disable=SC1090,SC1091
  . "${NVM_DIR}/nvm.sh" >/dev/null 2>&1
  if [ -f "${REPO_ROOT}/.nvmrc" ]; then
    nvm use --silent >/dev/null 2>&1 || true
  else
    nvm use --silent default >/dev/null 2>&1 || true
  fi
fi
# Append common system paths LAST so PATH isn't empty under cron, but
# don't let them shadow nvm's node.
export PATH="${PATH:-}:/usr/local/bin:/usr/bin:/bin"
export HEADLESS="${HEADLESS:-true}"

cd "${REPO_ROOT}"

{
  echo "===================================================="
  echo "[$(date -u +%FT%TZ)] starting refresh-auth (HEADLESS=${HEADLESS} node=$(node --version 2>/dev/null || echo '?'))"

  if [ -f dist/refresh-auth.js ]; then
    node dist/refresh-auth.js
  else
    ./node_modules/.bin/ts-node src/refresh-auth.ts
  fi
  CODE=$?

  echo "[$(date -u +%FT%TZ)] refresh-auth finished (exit=${CODE})"
  exit "${CODE}"
} 2>&1 | tee -a "${LOG_FILE}"

exit "${PIPESTATUS[0]}"
