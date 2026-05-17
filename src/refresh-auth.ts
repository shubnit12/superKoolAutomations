import * as path from 'path';
import * as dotenv from 'dotenv';
import { chromium, devices } from 'playwright';
import { login } from './naukri';

/**
 * Self-healing auth helper.
 *
 * Re-establishes a Naukri session using NAUKRI_EMAIL / NAUKRI_PASSWORD
 * from `.env`, then writes the resulting cookies + localStorage to
 * `auth.json`. Used by:
 *
 *   1. The two cron entry points (`src/index.ts`, `src/apply.ts`) when
 *      they detect a redirect to /nlogin — they call `refreshAuth()`,
 *      then retry the failed flow once.
 *   2. The user manually via `npm run refresh-auth` when they want to
 *      proactively rotate the session.
 *
 * Caveats:
 *   - If Naukri shows a captcha or OTP challenge, this run WILL fail
 *     because no human is around to solve it. In that case the cron
 *     just logs the failure and you should run `npm run login` (HEADED)
 *     locally and `scp` the new auth.json up.
 *   - Defaults to HEADLESS so cron can call it unattended. Set
 *     HEADLESS=false to watch it run once locally.
 */

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const AUTH_FILE = path.resolve(__dirname, '..', 'auth.json');
const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const EMAIL = process.env.NAUKRI_EMAIL ?? '';
const PASSWORD = process.env.NAUKRI_PASSWORD ?? '';

/**
 * Programmatic API. Throws on misconfiguration or if Naukri does not
 * complete the login redirect (e.g. unsolvable captcha) within the
 * `login()` helper's own 15s timeout.
 *
 * @returns the absolute path of the auth.json file we just wrote.
 */
export async function refreshAuth(): Promise<string> {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'NAUKRI_EMAIL or NAUKRI_PASSWORD missing from .env — cannot auto-relogin.',
    );
  }

  console.log(`[refresh-auth] starting fresh login for ${EMAIL}`);

  // Same stealth setup as src/index.ts and src/apply.ts so Naukri
  // sees a consistent browser fingerprint across login + reuse.
  const browser = await chromium.launch({
    headless: HEADLESS,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      ...devices['Desktop Chrome'],
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    await login(page, EMAIL, PASSWORD);

    await context.storageState({ path: AUTH_FILE });
    console.log(`[refresh-auth] saved fresh auth.json → ${AUTH_FILE}`);
    return AUTH_FILE;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Returns true when an error matches our "session expired" signal —
 * the message thrown by `runDailyUpdate` / `applyToRecommendedJobs`
 * when the persisted cookies bounce us back to /nlogin.
 *
 * Used by the cron entry points to decide whether a failure should
 * trigger an auto-refresh-and-retry.
 */
export function isSessionExpiredError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /Naukri session expired|redirected to login page/i.test(err.message);
}

/**
 * CLI entry: `npm run refresh-auth`.
 * Exits 1 on failure so cron can detect via the standard `$?` check.
 */
async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] refresh-auth starting`);
  await refreshAuth();
  console.log(`[${new Date().toISOString()}] refresh-auth complete`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[refresh-auth] FAILED:', err);
    process.exit(1);
  });
}
