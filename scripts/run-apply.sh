#!/usr/bin/env bash
#
# Daily auto-apply runner.
#
# Drives `dist/apply.js` (compiled) when available, falling back to
# `ts-node src/apply.ts`. The script also self-heals when the Naukri
# session has expired — `apply.ts` calls `refreshAuth()` internally
# and retries once before giving up.
#
# Override the apply cap with `MAX_APPLIES=20 ./scripts/run-apply.sh`.
#
# Cron entry (10:00 AM IST = 04:30 UTC):
#   30 4 * * * /home/ubuntu/naukri/scripts/run-apply.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${REPO_ROOT}/logs.txt"

# IMPORTANT: pin to the same Node version the developer uses interactively
# (nvm's v24.13.0). When this script previously did
#   export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
# it accidentally promoted Homebrew's `/usr/local/bin/node` (v25.4.0) ahead
# of nvm's node, and Naukri's anti-bot handling reacts badly to Node 25's
# fetch/TLS stack — every Apply tile silently "no observable outcome",
# zero applications go through. Load nvm first so this script behaves the
# same whether invoked from your shell, from cron, or from a launchd job.
if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  export NVM_DIR="${HOME}/.nvm"
  # shellcheck disable=SC1090,SC1091
  . "${NVM_DIR}/nvm.sh" >/dev/null 2>&1
  # Use the `.nvmrc` if present; otherwise fall back to whatever nvm
  # considers the default. Either way we end up on the same Node version
  # used by `npm run apply` in your interactive shell.
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
export MAX_APPLIES="${MAX_APPLIES:-10}"

cd "${REPO_ROOT}"

{
  echo "===================================================="
  echo "[$(date -u +%FT%TZ)] starting auto-apply (HEADLESS=${HEADLESS} MAX_APPLIES=${MAX_APPLIES} node=$(node --version 2>/dev/null || echo '?'))"

  if [ -f dist/apply.js ]; then
    npm run apply
  else
    npm run apply
  fi
  CODE=$?

  echo "[$(date -u +%FT%TZ)] auto-apply finished (exit=${CODE})"
  exit "${CODE}"
} 2>&1 | tee -a "${LOG_FILE}"

exit "${PIPESTATUS[0]}"
