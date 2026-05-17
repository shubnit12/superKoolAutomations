import { test } from '@playwright/test';
import { downloadResume } from '../src/resume';
import { login, runDailyUpdate } from '../src/naukri';

/**
 * End-to-end test for the daily Naukri profile update.
 *
 * The actual flow lives in `src/naukri.ts` so the production cron script
 * (`src/index.ts`) can reuse the same code paths. This test exists to
 * verify that flow against the real Naukri site whenever we change
 * selectors or behavior.
 */

const NAUKRI_EMAIL = requireEnv('NAUKRI_EMAIL');
const NAUKRI_PASSWORD = requireEnv('NAUKRI_PASSWORD');
const RESUME_URL = requireEnv('RESUME_URL');

let resumePath: string;

test.beforeAll(async () => {
  resumePath = await downloadResume(RESUME_URL);
  console.log('[test] resume saved to:', resumePath);
});

test('naukri daily update', async ({ page }) => {
  test.setTimeout(90_000);

  await login(page, NAUKRI_EMAIL, NAUKRI_PASSWORD);
  await runDailyUpdate(page, resumePath);
});

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required env var: ${key}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}
