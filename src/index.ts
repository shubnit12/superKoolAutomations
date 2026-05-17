import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { chromium, devices } from 'playwright';
import { downloadResume } from './resume';
import { runDailyUpdate } from './naukri';
import { refreshAuth, isSessionExpiredError } from './refresh-auth';

/**
 * Cron entry point — runs once per day.
 *
 * Loads a persisted Naukri session from `auth.json` (created by
 * `npm run login`), downloads the latest resume, then runs the full
 * profile-refresh flow headless.
 *
 * Output is plain stdout/stderr. The crontab will redirect that to a
 * rolling `logs.txt`.
 *
 * Exit codes:
 *   0  — daily run completed successfully
 *   1  — anything failed (cron sees this and we get notified via Telegram
 *        once that's wired up)
 */

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const AUTH_FILE = path.resolve(__dirname, '..', 'auth.json');
const RESUME_URL = process.env.RESUME_URL ?? 'https://api.shubnit.com/resume';
const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] naukri-automation starting`);

  // Bootstrap: if auth.json is missing entirely (first EC2 deploy that
  // forgot to scp it, or someone deleted it), do an initial login using
  // .env credentials. Cron will still need a captcha-free Naukri server
  // for this to succeed unattended.
  if (!fs.existsSync(AUTH_FILE)) {
    console.log('[naukri-automation] auth.json missing — performing initial login');
    await refreshAuth();
  }

  const resumePath = await downloadResume(RESUME_URL);
  console.log(`[naukri-automation] resume downloaded: ${resumePath}`);

  // Try the daily flow up to twice: once with the existing session, and
  // once more after a fresh login if Naukri redirected us to /nlogin.
  // We never retry on non-session errors — those are real bugs.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await runOnce(resumePath);
      break;
    } catch (err) {
      if (attempt === 1 && isSessionExpiredError(err)) {
        console.log(
          '[naukri-automation] session expired — refreshing auth and retrying once',
        );
        await refreshAuth();
        continue;
      }
      throw err;
    }
  }

  console.log(`[${new Date().toISOString()}] naukri-automation complete`);
}

/**
 * One end-to-end attempt at the daily profile flow. Throws the standard
 * "Naukri session expired" error if the persisted cookies are stale —
 * the caller decides whether to retry after refreshing.
 */
async function runOnce(resumePath: string): Promise<void> {
  // Naukri's bot detection sniffs `navigator.webdriver`, the headless UA
  // and a few other automation signals. We launch with the same Desktop
  // Chrome profile that `src/login.ts` uses (matching fingerprint) and
  // override the obvious tells via launch args + an init script. We also
  // prefer installed Google Chrome (`channel: 'chrome'`) over Playwright's
  // bundled Chromium — its modern headless mode is far harder to detect.
  const browser = await chromium.launch({
    headless: HEADLESS,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const context = await browser.newContext({
      ...devices['Desktop Chrome'],
      storageState: AUTH_FILE,
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = await context.newPage();

    await runDailyUpdate(page, resumePath);

    // Persist refreshed cookies so the session keeps living. Naukri
    // rotates auth tokens on every request and they have a sliding TTL —
    // saving here keeps `auth.json` valid as long as we run daily.
    await context.storageState({ path: AUTH_FILE });
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[naukri-automation] FAILED:', err);
  process.exit(1);
});
