# superKoolAutomations
This repository is definitely not 100% vibe coded
# Naukri Automation

Two automations against [naukri.com](https://www.naukri.com), both running as
plain Node + Playwright scripts triggered by `cron` entries on an AWS EC2
instance:

1. **Daily profile update** (`npm start`) — re-uploads the latest resume and
   nudges the profile headline so the profile keeps appearing near the top of
   recruiter searches.
2. **Auto-apply** (`npm run apply`) — walks the *Recommended jobs* page, opens
   each job in a popup, submits the application, and auto-answers the
   recruiter's chatbot questionnaire using values from `.env`.

No queues, no databases — output is appended to a local `logs.txt` file.

---

## Project status

- [x] Phase 0 — Scaffolding
- [x] Phase 1 — Resume fetcher + Naukri Playwright flow
- [x] Phase 2 — Headless run + cookie persistence (`auth.json`)
- [x] Phase 3 — Cron-ready Node script (`src/index.ts`)
- [x] Phase 4 — Auto-apply with keyword-driven chatbot answers
      (`src/jobs.ts`, `src/apply.ts`, `src/qa-defaults.ts`)
- [ ] Phase 5 — Telegram notifications (later)

---

## Tech stack

| Concern        | Choice                                 |
| -------------- | -------------------------------------- |
| Language       | TypeScript (Node.js 20)                |
| Browser driver | Playwright (Chromium)                  |
| HTTP client    | native `fetch` (Node.js 20+)           |
| Config         | dotenv                                 |
| Scheduler      | `cron` on Ubuntu EC2 (added in Phase 3)|
| Logs           | `logs.txt` (appended by cron)          |

---

## Local setup

```bash
# 1. install dependencies
npm install

# 2. make sure Google Chrome is installed on the machine
#    (we deliberately use real Chrome, not Playwright's bundled
#    Chromium, because Naukri detects the latter as a bot)

# 3. copy env template and fill in your credentials
cp .env.example .env
#    fill NAUKRI_EMAIL, NAUKRI_PASSWORD, RESUME_URL,
#    and the NAUKRI_* chatbot answers (used by `npm run apply`).

# 4. one-time interactive login → saves auth.json
npm run login
#    A headed Chrome window opens with your creds pre-filled.
#    Click Login (handle captcha / OTP if any), then the script
#    auto-detects success and saves the session.

# 5. run the daily profile flow once to verify everything works
npm start

# 6. run the auto-apply flow once (HEADED so you can watch the first time)
HEADLESS=false MAX_APPLIES=1 npm run apply
```

The daily flow runs **headless** end-to-end in ~9 seconds and reports
`resume present + profile marked "updated Today"` on success.

The auto-apply flow opens the Recommended Jobs page, iterates each
`<article data-job-id=...>` tile (Naukri's per-job layout), submits the
application, and drives the chatbot questionnaire via
[`src/qa-defaults.ts`](src/qa-defaults.ts).

To watch either run live in a visible browser:

```bash
HEADLESS=false npm start          # profile update
HEADLESS=false npm run apply       # auto-apply
```

---

## Repository layout

```
NaukriAutomation/
├── src/
│   ├── naukri.ts           # shared profile flow: login() + runDailyUpdate()
│   ├── login.ts            # one-time helper → creates auth.json
│   ├── index.ts            # cron entry: daily profile update
│   ├── apply.ts            # cron entry: auto-apply to recommended jobs
│   ├── jobs.ts             # apply flow + chatbot driver
│   ├── qa-defaults.ts      # keyword → env-var rules for chatbot answers
│   ├── refresh-auth.ts     # headless re-login → overwrites auth.json
│   ├── resume.ts           # downloads the resume from RESUME_URL
│   └── debug-jobs.ts       # one-off DOM-inspection helper (kept for tuning)
├── scripts/
│   ├── run-profile.sh      # cron wrapper for profile update
│   ├── run-apply.sh        # cron wrapper for auto-apply
│   └── refresh-auth.sh     # standalone wrapper for manual auth refresh
├── tests/
│   ├── naukri.spec.ts      # full-flow Playwright test (uses live login)
│   ├── apply.spec.ts       # auto-apply test (uses auth.json)
│   └── setup.spec.ts       # scaffolding sanity check
├── playwright.config.ts
├── tsconfig.json
├── package.json
├── .env.example            # template (commit-safe)
├── .env                    # real creds + chatbot answers (gitignored)
├── auth.json               # persisted session (gitignored)
├── .gitignore
└── README.md
```

---

## NPM scripts

| Script                | What it does                                                |
| --------------------- | ----------------------------------------------------------- |
| `npm run login`            | One-time interactive login → writes `auth.json` (HEADED, you handle captcha) |
| `npm run refresh-auth`     | Headless re-login using `.env` creds → overwrites `auth.json`. Auto-called by cron when cookies expire. |
| `npm start`                | Daily profile flow via `ts-node` (uses `auth.json`)         |
| `npm run apply`            | Auto-apply flow via `ts-node` (uses `auth.json`)            |
| `npm run build`            | Compiles `src/` → `dist/`                                   |
| `npm run start:prod`       | Runs the compiled `dist/index.js` (faster cold start)       |
| `npm run apply:prod`       | Runs the compiled `dist/apply.js`                           |
| `npm run refresh-auth:prod`| Runs the compiled `dist/refresh-auth.js` (cron-safe)        |
| `npm test`            | Runs Playwright tests headless (uses live login, not auth)  |
| `npm run test:headed` | Same, but shows the browser window                          |
| `npm run test:debug`  | Runs with the Playwright inspector                          |
| `npm run clean`       | Removes `dist/`, reports and test results                   |

### Runtime env overrides

| Var            | Default | Used by                    | Notes                                                  |
| -------------- | ------- | -------------------------- | ------------------------------------------------------ |
| `HEADLESS`     | `true`  | `start`, `apply`, `refresh-auth` | Set to `false` to watch the browser.            |
| `MAX_APPLIES`  | `10`    | `apply`                    | Cap on tiles inspected per run (cron-friendly limit).  |

---

## Auth lifecycle (self-healing on EC2)

```
.env (NAUKRI_EMAIL/PASSWORD)
        │
        ├─ npm run login          (HEADED, manual, handles captcha) ────┐
        └─ npm run refresh-auth   (HEADLESS, automatic on cron) ────────┤
                                                                        ▼
                                                                   auth.json
                                                                        │
                            ┌───────────────────────────────────────────┤
                            ▼                                           ▼
                       npm start (daily 8:30 IST)            npm run apply (daily 10 IST)
                            │                                           │
                            └─── on failure with /nlogin redirect ──────┤
                                                                        │
                                                          calls refreshAuth()
                                                                        │
                                                                  retry once
```

- **First time**: run `npm run login` locally, `scp` `auth.json` to EC2.
- **Daily**: cron jobs reuse `auth.json` and save back the rotated cookies after every successful run, so the session keeps living indefinitely.
- **On expiry**: `index.ts` and `apply.ts` detect the `/nlogin` bounce, call `refreshAuth()` (which re-logs in using `.env` creds headlessly), then retry the failed flow once. `auth.json` is overwritten automatically.
- **If captcha or OTP is required during refresh**: the refresh fails and the cron exits 1 — your only manual step is to run `npm run login` locally and `scp` the new `auth.json`. Same as before, just rarer now.

The two cron flows **never type your password** during a normal day; only the `refresh-auth` path does, and only on cookie expiry.

---

## Chatbot answers

Naukri's per-job questionnaire is driven by the keyword-rule list in
[`src/qa-defaults.ts`](src/qa-defaults.ts). Each rule maps a regex pattern
(matched against the current bot message) to a `.env` variable and an input
kind (`text` or `radio`).

Values used by the default rule set:

| Env var                         | Example      | Asked when…                                          |
| ------------------------------- | ------------ | ---------------------------------------------------- |
| `NAUKRI_CURRENT_LOCATION`       | `Gurugram`   | "What is your current location?"                     |
| `NAUKRI_PREFERRED_LOCATION_OK`  | `Yes`        | "Are you willing to relocate to <city>?" (radio)     |
| `NAUKRI_CURRENT_ORG`            | `Cognizant`  | "What is your current organisation?"                 |
| `NAUKRI_TOTAL_EXPERIENCE`       | `3.6`        | "Total years of experience?"                         |
| `NAUKRI_RELEVANT_EXPERIENCE`    | `3.5`        | "How many years of experience in <skill>?"           |
| `NAUKRI_CURRENT_CTC`            | `6.5`        | "What is your current CTC in LPA?"                   |
| `NAUKRI_DESIRED_CTC`            | `9`          | "Expected CTC?"                                      |
| `NAUKRI_NOTICE_PERIOD_OPTION`   | `15 Days or less` (default) | "What is your notice period?" — radio with 6 buckets, we pick the shortest unless overridden |
| `NAUKRI_PAN_CARD`               | `XXXPS1234A` | "What is your PAN?"                                  |
| `NAUKRI_PF_UAN_CLEARED`         | `Yes`        | "Have you cleared PF / UAN issues?" (radio)          |

### Positive-default radios (no env needed)

In addition to the env-driven answers above, the rule list ships with
opinionated **"Yes"** defaults for the availability / willingness questions
recruiters ask to filter out hesitant candidates. These work out of the box;
override per-rule by setting the matching env var to `No`.

| Built-in default → `Yes`                                   | Env override                  |
| ---------------------------------------------------------- | ----------------------------- |
| "Are you available for an interview today/tomorrow?"       | `NAUKRI_AVAILABLE_FOR_INTERVIEW` |
| "Can you join immediately / within 30 days?"               | `NAUKRI_OK_JOIN_IMMEDIATELY`  |
| "Are you currently serving notice?"                        | `NAUKRI_SERVING_NOTICE`       |
| "Are you interested in this role?"                         | `NAUKRI_INTERESTED_IN_ROLE`   |
| "Are you OK with work-from-office / 5 days a week onsite?" | `NAUKRI_OK_WFO`               |
| "Are you OK with hybrid / remote work?"                    | `NAUKRI_OK_WFH`               |
| "Are you OK with night / rotational shifts?"               | `NAUKRI_OK_SHIFTS`            |
| "Are you comfortable with travel / on-call?"               | `NAUKRI_OK_TRAVEL_ONCALL`     |
| "Do you have a personal laptop / broadband?"               | `NAUKRI_HAS_EQUIPMENT`        |
| "Have you completed B.Tech / graduation?"                  | `NAUKRI_IS_GRADUATE`          |
| "Do you have experience in `<skill>`?" (Yes/No)            | `NAUKRI_HAS_SKILL_EXPERIENCE` |

### Skip fallback for unknown questions

When the chatbot asks a question that **no rule matches**, the script tries
Naukri's built-in **"Skip this question"** button before giving up. This lets
us still submit applications when one or two oddball questions show up.

- Cap: `maxSkipsPerJob` (default **3**) — exceeding it bails on the job and
  increments `skippedUnknownQuestion`.
- The first unknown question per job is also dumped to
  `/tmp/naukri-chatbot-unknown-question-<timestamp>.{html,png}` so you can
  add a rule in [`src/qa-defaults.ts`](src/qa-defaults.ts) for next time.
- The summary line prints `applied: N (of which K used skip)` so you can
  spot when too many recent applies are leaning on Skip.

---

## EC2 deployment

```bash
# on a fresh Ubuntu 22.04 EC2 instance
sudo apt update
sudo apt install -y nodejs npm xvfb

# install Google Chrome (real Chrome, not Chromium — Naukri detects Chromium)
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo 'deb http://dl.google.com/linux/chrome/deb/ stable main' \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable

# clone and install
git clone <this-repo> naukri && cd naukri
npm install
cp .env.example .env   # fill in real creds + chatbot answers
npm run build

# scp auth.json from your local machine into the project root
# (because `npm run login` needs a display — generate locally, ship the file)

# crontab — point at the helper scripts in scripts/ so PATH, logging,
# and dist→ts-node fallback are handled uniformly:
crontab -e
# 0  3 * * *  /home/ubuntu/naukri/scripts/run-profile.sh    # 8:30 AM IST profile refresh
# 30 4 * * *  /home/ubuntu/naukri/scripts/run-apply.sh      # 10:00 AM IST auto-apply
# (refresh-auth.sh is run on demand, not from cron — apply.sh and
#  run-profile.sh self-heal when cookies expire.)
```

Note: `xvfb` is installed as a fallback in case Chrome's headless mode
stops working reliably; you can swap any cron line to use `xvfb-run -a
node dist/<entry>.js` if needed.

---

## Debugging the auto-apply flow

If Naukri changes the Recommended Jobs DOM and the auto-apply script can't
find tiles or chatbot messages, run:

```bash
npx ts-node src/debug-jobs.ts
```

It opens a headed Chrome with your saved session, probes a battery of
candidate selectors against the page, dumps the first 50 KB of `#root`
innerHTML to `/tmp/naukri-jobs.html`, and saves a full-page screenshot to
`/tmp/naukri-jobs.png`. Use those to update the selector strings in
`src/jobs.ts`.
