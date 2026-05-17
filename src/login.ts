import * as path from 'path';
import * as dotenv from 'dotenv';
import { chromium, devices } from 'playwright';
import { NAUKRI_LOGIN_URL } from './naukri';

/**
 * One-time helper: opens a headed Chromium, waits for you to log into
 * Naukri (handles captcha / 2FA naturally because you're driving), then
 * saves the resulting session to `auth.json` at the repo root.
 *
 * The daily cron script (`src/index.ts`) then reuses that file via
 * Playwright's `storageState` so it doesn't have to log in again.
 *
 * Run it with `npm run login`.
 */

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const AUTH_FILE = path.resolve(__dirname, '..', 'auth.json');
const EMAIL = process.env.NAUKRI_EMAIL ?? '';
const PASSWORD = process.env.NAUKRI_PASSWORD ?? '';

async function main(): Promise<void> {
  console.log('[login] opening Chrome...');
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  // Use the same Desktop Chrome profile that `src/index.ts` uses so the
  // saved session looks identical when replayed by the cron script.
  const context = await browser.newContext({ ...devices['Desktop Chrome'] });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  await page.goto(NAUKRI_LOGIN_URL);

  // Pre-fill creds if we have them — saves typing. You can still edit.
  if (EMAIL) {
    await page.getByRole('textbox', { name: 'Enter Email ID / Username' }).fill(EMAIL);
  }
  if (PASSWORD) {
    await page.getByRole('textbox', { name: 'Enter Password' }).fill(PASSWORD);
  }

  console.log('[login] please click Login in the browser (and handle any captcha / OTP).');
  console.log('[login] waiting up to 5 minutes for successful redirect...');

  // Successful login takes us away from /nlogin/...
  await page.waitForURL((url) => !url.pathname.startsWith('/nlogin'), {
    timeout: 5 * 60 * 1000,
  });

  console.log('[login] login detected — saving session to auth.json');
  await context.storageState({ path: AUTH_FILE });

  await browser.close();
  console.log(`[login] saved to ${AUTH_FILE}`);
  console.log('[login] you can now run `npm start` for daily updates.');
}

main().catch((err) => {
  console.error('[login] FAILED:', err);
  process.exit(1);
});
