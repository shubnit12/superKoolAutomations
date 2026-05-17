#!/usr/bin/env bash
#
# Daily profile-update runner.
#
# Drives `dist/index.js` (compiled) when available, falling back to
# `ts-node src/index.ts` if the build is missing. Logs go to logs.txt
# in the repo root AND to stdout, so this works equally well from cron
# and from a manual invocation.
#
# Cron entry (8:30 AM IST = 03:00 UTC):
#   0 3 * * *  /home/ubuntu/naukri/scripts/run-profile.sh

# `-u` catches typos in env-var names; `pipefail` so we see the real
# exit code through the tee pipe. We deliberately do NOT use `-e` —
# we want to capture the Node exit code and log it cleanly.
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
  echo "[$(date -u +%FT%TZ)] starting profile-update (HEADLESS=${HEADLESS} node=$(node --version 2>/dev/null || echo '?'))"

  if [ -f dist/index.js ]; then
    node dist/index.js
  else
    ./node_modules/.bin/ts-node src/index.ts
  fi
  CODE=$?

  echo "[$(date -u +%FT%TZ)] profile-update finished (exit=${CODE})"
  exit "${CODE}"
} 2>&1 | tee -a "${LOG_FILE}"

# Forward Node's exit code through the tee pipe so cron / callers see
# the real status (not tee's success).
exit "${PIPESTATUS[0]}"
