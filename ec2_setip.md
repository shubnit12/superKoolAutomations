# Running NaukriAutomation on an EC2 instance

This guide takes a brand-new EC2 box from zero to "applies jobs on a daily
cron, logs are easy to read". It exists because the project is more reliable
on a long-running cloud VM than on a laptop (which has to be open at cron
time) or GitHub-hosted Actions (whose Azure IPs trip Naukri's bot detection
more often).

The shell scripts in `scripts/` are already cron-friendly — they `tee` to
`logs.txt`, source nvm so `node` resolves under cron's minimal PATH, and
self-heal expired sessions via `refreshAuth()`. You'll mostly be wiring
them into `crontab`.

## Table of contents

1. [Pick the instance](#1-pick-the-instance)
2. [First-time system setup](#2-first-time-system-setup)
3. [Deploy the code + secrets](#3-deploy-the-code--secrets)
4. [Smoke-test the runs](#4-smoke-test-the-runs)
5. [Schedule via cron](#5-schedule-via-cron)
6. [Reading the logs](#6-reading-the-logs)
7. [When `auth.json` cookies die](#7-when-authjson-cookies-die)
8. [Cost & housekeeping](#8-cost--housekeeping)
9. [Troubleshooting cheat-sheet](#9-troubleshooting-cheat-sheet)

---

## 1. Pick the instance

| Setting             | Recommendation                                              | Why                                                                                          |
| ------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **AMI**             | Ubuntu Server 22.04 LTS                                     | Long-term support, well-tested with Playwright/Chrome.                                       |
| **Instance type**   | `t3.small` (2 vCPU, 2 GB RAM)                               | Chrome alone needs ~1.5 GB. `t2.micro` (1 GB) OOM-kills the browser mid-run.                 |
| **Region**          | `ap-south-1` (Mumbai)                                       | Same geo as your Naukri account → no "unusual login location" CAPTCHA challenges.            |
| **Storage**         | 20 GB gp3                                                   | Chrome + npm cache + logs comfortably fit; logs.txt grows ~1 MB/week.                        |
| **Security group**  | Inbound SSH (22) **only from your IP**, no other open ports | Nothing needs to be reachable from outside; this is a pure outbound automation worker.       |
| **Key pair**        | Generate a new one, save the `.pem` somewhere safe          | You'll use it to `ssh` and `scp` from your Mac.                                              |

> **Optional:** assign an **Elastic IP** so the instance keeps the same public
> address across stop/start cycles. Naukri seems to be OK with periodic IP
> changes within `ap-south-1`, but a stable IP avoids surprises if you ever
> need to whitelist it somewhere.

---

## 2. First-time system setup

SSH in once the instance is running:

```bash
ssh -i your-key.pem ubuntu@<ec2-public-ip>
```

Then on the EC2 box:

```bash
# 2.1 — Patch the system
sudo apt-get update && sudo apt-get -y upgrade

# 2.2 — Toolchain we need
sudo apt-get install -y curl git build-essential

# 2.3 — Google Chrome STABLE (NOT chromium — the codebase uses
#        chromium.launch({ channel: 'chrome' }), which expects the
#        Google-signed build.)
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y ./google-chrome-stable_current_amd64.deb
rm google-chrome-stable_current_amd64.deb

# 2.4 — nvm + Node 24.13.0 (matches .nvmrc in the repo).
#        Why pinned: Node 25.x has subtle TLS / fetch behaviour
#        changes that make Naukri's Apply flow silently no-op.
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 24.13.0
nvm alias default 24.13.0

# 2.5 — Sanity check
node --version            # expected: v24.13.0
google-chrome --version   # any recent stable build is fine
```

If `node --version` shows anything other than `v24.13.0`, fix it before
moving on — the scripts will refuse to run on the wrong version (the
log line tells you which one was picked up).

---

## 3. Deploy the code + secrets

### 3.1 Clone the repo

```bash
# On EC2
cd ~
git clone https://github.com/<your-user>/NaukriAutomation.git
cd NaukriAutomation
npm ci
npx playwright install-deps chrome   # one-time system libs for Chrome
```

> Private repo? Use a [GitHub deploy key](https://docs.github.com/en/developers/overview/managing-deploy-keys)
> on the instance — safer than copying a PAT.

### 3.2 Copy your local secrets up

The `.env` file and `auth.json` are gitignored (they contain credentials
and session cookies), so you transfer them out-of-band:

```bash
# Run these FROM YOUR MAC, not from EC2.
scp -i your-key.pem .env       ubuntu@<ec2-ip>:~/NaukriAutomation/.env
scp -i your-key.pem auth.json  ubuntu@<ec2-ip>:~/NaukriAutomation/auth.json
```

Both files should land at `/home/ubuntu/NaukriAutomation/`. Permissions
will be `0600` by default, which is what you want.

### 3.3 Verify they're in place

```bash
# On EC2
ls -la ~/NaukriAutomation/.env ~/NaukriAutomation/auth.json
# Both should show -rw------- and a non-zero size.
```

---

## 4. Smoke-test the runs

Before wiring cron, confirm each script works interactively:

```bash
cd ~/NaukriAutomation

# Profile update first — verifies auth.json and resume upload.
./scripts/run-profile.sh

# Then auto-apply — the moment of truth.
./scripts/run-apply.sh
```

### What "good" looks like

Each script's first log line should include `node=v24.13.0`. If it
prints `v25.x.x`, the nvm pinning isn't working — see
[Troubleshooting](#9-troubleshooting-cheat-sheet).

A healthy `run-apply.sh` run ends with something like:

```
[jobs] summary — applied: 7 (of which 0 used skip, 2 used fallback), \
       skipped-external: 0, skipped-already: 2, skipped-unknown-q: 1, \
       failed: 0, inspected: 10
```

If you see `applied: 0` and lots of `no Apply button visible` or `no
observable outcome`, your cookies are stale → run
`./scripts/refresh-auth.sh` (or follow [section 7](#7-when-authjson-cookies-die)).

---

## 5. Schedule via cron

EC2's clock is **UTC** by default. The cron entries below match the IST
times the project was designed for.

```bash
crontab -e
```

Paste:

```cron
# Daily profile update — 08:30 AM IST = 03:00 UTC
0 3 * * *  /home/ubuntu/NaukriAutomation/scripts/run-profile.sh

# Daily auto-apply — 10:00 AM IST = 04:30 UTC
30 4 * * *  /home/ubuntu/NaukriAutomation/scripts/run-apply.sh

# Weekly cookie refresh — Sunday 07:30 AM IST = 02:00 UTC
0 2 * * 0  /home/ubuntu/NaukriAutomation/scripts/refresh-auth.sh
```

Save and exit. Confirm cron picked it up:

```bash
crontab -l
```

> **Why the scripts work under cron now**: each one sources `~/.nvm/nvm.sh`
> at the top, so even with cron's stripped PATH they resolve the right
> `node` (v24.13.0 from nvm) instead of falling through to a system
> binary or — worse — failing with `node: command not found`.

---

## 6. Reading the logs

All three scripts `tee -a logs.txt` in the repo root, so every run is
appended to one rolling file.

```bash
# Last 100 lines
tail -n 100 ~/NaukriAutomation/logs.txt

# Live-follow while a run is in progress (Ctrl+C to exit)
tail -f ~/NaukriAutomation/logs.txt

# Only today's runs
grep "$(date -u +%FT)" ~/NaukriAutomation/logs.txt

# Apply summaries from the last 7 days
grep -E 'naukri-apply (done|complete)' ~/NaukriAutomation/logs.txt | tail -10

# Most recent unknown-question debug dumps (HTML + screenshot)
ls -lt /tmp/naukri-chatbot-*.html /tmp/naukri-chatbot-*.png 2>/dev/null | head -20
```

### Remote tail from your Mac (no need to SSH interactively)

```bash
ssh -i your-key.pem ubuntu@<ec2-ip> 'tail -f ~/NaukriAutomation/logs.txt'
```

### Copy a debug dump back to your Mac

When a chatbot question fails and the script logs a path like
`/tmp/naukri-chatbot-unknown-question-…html`, pull it down to inspect:

```bash
# From your Mac
scp -i your-key.pem 'ubuntu@<ec2-ip>:/tmp/naukri-chatbot-unknown-question-*.html' ~/Downloads/
```

---

## 7. When `auth.json` cookies die

Cookies are good for ~30–60 days; they also die early if Naukri detects
unusual activity. Two recovery paths:

### Path A — self-heal worked

The scripts call `refreshAuth()` automatically on a `/nlogin` redirect.
If it succeeds, `auth.json` is replaced in-place and the run continues.
You don't need to do anything.

### Path B — refresh hit a CAPTCHA / OTP

EC2 has no human to solve those. Symptoms:
- Several days in a row of `applied: 0` in the summary line.
- `logs.txt` mentions "captcha detected" or "OTP required".

Fix:

```bash
# 1. On your MAC, run a HEADED login so you can solve any challenge.
HEADLESS=false npm run login

# 2. After the browser closes successfully, push the fresh auth.json up.
scp -i your-key.pem auth.json ubuntu@<ec2-ip>:~/NaukriAutomation/auth.json
```

The very next scheduled run will pick up the new cookies.

---

## 8. Cost & housekeeping

### Indicative cost (ap-south-1, on-demand, May 2026 pricing)

| Item                            | Approx ₹/month   | Approx $/month |
| ------------------------------- | ---------------- | -------------- |
| `t3.small` running 24×7         | ~₹1,400          | ~$17           |
| 20 GB gp3 storage               | ~₹130            | ~$1.5          |
| Outbound data (negligible)      | <₹50             | <$0.5          |
| **Total**                       | **~₹1,580**      | **~$19**       |

A 1-year reserved instance brings the compute line down to ~₹900/month.

### Keep logs.txt from growing forever

Add to your `crontab`:

```cron
# Truncate logs every Sunday at 00:00 UTC (after the weekly refresh runs)
0 0 * * 0  : > /home/ubuntu/NaukriAutomation/logs.txt
```

> Use `:` (the no-op) + `>` rather than `truncate -s 0` — it works
> identically without depending on coreutils-from-cron.

### Auto-upgrade Chrome safely

```bash
# Once a month is plenty.
sudo apt-get update && sudo apt-get install -y --only-upgrade google-chrome-stable
```

Chrome major-version bumps occasionally need a matching Playwright update
(`npm i playwright@latest`); usually the existing one keeps working.

---

## 9. Troubleshooting cheat-sheet

| Symptom in `logs.txt`                                                 | Likely cause                                              | Fix                                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `node=v25.x.x` in the startup line                                    | nvm not sourced; system Node ahead in PATH                | `which -a node` from cron context; ensure `~/.nvm/nvm.sh` exists and is readable                     |
| `Cannot find module ...` errors                                       | `npm ci` was never run after `git clone`/`git pull`        | `cd ~/NaukriAutomation && npm ci`                                                                    |
| `Error: Browser closed` / `Failed to launch`                          | Playwright deps missing OR OOM                            | `npx playwright install-deps chrome`; check `dmesg | tail` for OOM-killer; upgrade `t3.small` → `t3.medium` if you keep OOM-ing |
| `no Apply button visible after 20000ms` on EVERY tile                 | Cookies dead and auto-refresh hit a CAPTCHA                | Follow [section 7 Path B](#7-when-authjson-cookies-die)                                              |
| `no observable outcome after Apply` on every tile                     | Same as above, or Naukri rate-limited the IP               | Sleep the cron for 24 h, refresh cookies, try again. Consider a fresh EIP if it persists.            |
| Cron isn't firing                                                     | Cron service not running                                   | `sudo systemctl status cron` → `sudo systemctl enable --now cron`                                    |
| Cron runs but nothing happens                                         | Script not executable                                      | `chmod +x ~/NaukriAutomation/scripts/*.sh`                                                            |
| Different output between manual run and cron run                      | Cron's minimal env vs. interactive shell                   | Already mitigated — scripts source nvm. If you add new env vars to `.env`, dotenv loads them.        |

---

## What's intentionally not covered here

- **Notifications** (Slack/email on summary line): add a `mail` / `curl`
  call at the bottom of each script. Skipped here because everyone's
  notification preferences differ.
- **CloudWatch / log aggregation**: stdout `tee` to `logs.txt` is usually
  enough for a single instance. Add CW Agent if you grow to multiple
  workers.
- **Auto-update from `git pull`**: deliberately omitted. You want to
  review changes before they run unattended on your job-search.

---

*Last updated: May 2026. If the project's `.nvmrc`, package.json, or shell
scripts change materially, update this doc in the same PR.*
