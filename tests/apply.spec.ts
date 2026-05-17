import * as fs from 'fs';
import * as path from 'path';
import { test, chromium, devices } from '@playwright/test';
import { applyToRecommendedJobs } from '../src/jobs';

/**
 * End-to-end test for the Naukri auto-apply flow.
 *
 * The actual flow lives in `src/jobs.ts` so the production cron script
 * (`src/apply.ts`) and this test share the same code path.
 *
 * Why we build our own browser/context instead of using `{ page }`:
 *   - The production apply script uses installed Google Chrome (not
 *     Playwright's bundled Chromium), `--disable-blink-features=
 *     AutomationControlled`, and a `navigator.webdriver=undefined`
 *     init script. Naukri's bot detection rejects sessions that don't
 *     match this fingerprint. Doing the same here keeps the test
 *     representative of production.
 *   - We load `auth.json` via storageState so we don't have to do an
 *     interactive login each time you press `--debug`.
 *
 * How to run:
 *   npx playwright test apply              # headed by default (apply test only)
 *   npx playwright test apply --debug      # Playwright Inspector, step through
 *   MAX_APPLIES=3 npx playwright test apply --debug   # try 3 jobs in a row
 */

const AUTH_FILE = path.resolve(__dirname, '..', 'auth.json');
// Matches the cron default so test runs reflect real-world behavior.
// Override with `MAX_APPLIES=1` for a quick single-job debug session.
const MAX_APPLIES = Number(process.env.MAX_APPLIES ?? '10');

test('naukri auto-apply', async () => {
  // The chatbot can take 25s per question × up to 15 questions × multiple
  // tiles, plus tile-load + popup-load overhead. 10 minutes is enough
  // headroom for MAX_APPLIES up to ~10.
  test.setTimeout(10 * 60_000);

  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      `auth.json not found at ${AUTH_FILE}.\n` +
        'Run `npm run login` first to create it.',
    );
  }

  const browser = await chromium.launch({
    // Always headed for debug visibility. Override by exporting
    // HEADLESS=true (rarely useful for a debug-targeted test).
    headless: (process.env.HEADLESS ?? 'false').toLowerCase() === 'true',
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

    const stats = await applyToRecommendedJobs(page, { maxApplies: MAX_APPLIES });

    // Refresh cookies so subsequent runs don't get logged out.
    await context.storageState({ path: AUTH_FILE });

    console.log(
      `[test] applied=${stats.applied} ` +
        `(of which ${stats.appliedWithSkips} used skip), ` +
        `skippedExternal=${stats.skippedExternal}, ` +
        `skippedAlready=${stats.skippedAlready}, ` +
        `skippedUnknownQuestion=${stats.skippedUnknownQuestion}, ` +
        `failed=${stats.failed}, ` +
        `inspected=${stats.inspected}`,
    );
  } finally {
    await browser.close();
  }
});
