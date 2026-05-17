import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { chromium, devices } from 'playwright';
import { applyToRecommendedJobs, type ApplyStats } from './jobs';
import { refreshAuth, isSessionExpiredError } from './refresh-auth';

/**
 * Auto-apply entry point — runs the Recommended Jobs flow.
 *
 * Independent of the daily profile update (`src/index.ts`), so it can
 * have its own crontab schedule.
 *
 * Exit codes:
 *   0 — flow completed (even if zero jobs were applied)
 *   1 — fatal error (auth expired, page broken, etc.)
 */

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const AUTH_FILE = path.resolve(__dirname, '..', 'auth.json');
const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
// Default to 10. Naukri's bulk-apply UI advertises "select upto 5 jobs"
// per session but the per-job apply path used here has no such limit;
// 10 strikes a balance between throughput and Naukri's invisible daily
// quota. Already-applied jobs are auto-detected and skipped, so re-runs
// stay idempotent regardless of this cap.
const MAX_APPLIES = Number(process.env.MAX_APPLIES ?? '10');

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] naukri-apply starting`);

  // Bootstrap: create auth.json on first ever run (or after an explicit
  // delete), using the .env credentials. Captcha-prone but worth trying
  // before giving up.
  if (!fs.existsSync(AUTH_FILE)) {
    console.log('[naukri-apply] auth.json missing — performing initial login');
    await refreshAuth();
  }

  // Run the apply flow up to twice. The second attempt only fires if
  // the first one bounced to /nlogin (cookies expired) — every other
  // failure surfaces immediately so we don't mask real bugs.
  let stats: ApplyStats | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      stats = await runOnce();
      break;
    } catch (err) {
      if (attempt === 1 && isSessionExpiredError(err)) {
        console.log(
          '[naukri-apply] session expired — refreshing auth and retrying once',
        );
        await refreshAuth();
        continue;
      }
      throw err;
    }
  }

  // The retry loop guarantees stats is non-null on success.
  if (!stats) throw new Error('naukri-apply: unreachable — stats not assigned');

  console.log(
    `[naukri-apply] done — applied=${stats.applied} ` +
      `(skips=${stats.appliedWithSkips}, fallbacks=${stats.appliedWithFallbacks}), ` +
      `skippedExternal=${stats.skippedExternal}, ` +
      `skippedAlready=${stats.skippedAlready}, ` +
      `skippedUnknownQuestion=${stats.skippedUnknownQuestion}, ` +
      `failed=${stats.failed}, ` +
      `inspected=${stats.inspected}`,
  );

  console.log(`[${new Date().toISOString()}] naukri-apply complete`);
}

/**
 * One end-to-end attempt at the apply flow. Throws the standard
 * "Naukri session expired" error if the persisted cookies are stale —
 * the caller decides whether to retry after refreshing.
 */
async function runOnce(): Promise<ApplyStats> {
  // Same stealth setup as src/index.ts — must match exactly so the
  // session fingerprint stays consistent with what `npm run login` saved.
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

    const stats = await applyToRecommendedJobs(page, { maxApplies: MAX_APPLIES });

    // Refresh cookies the same way the daily script does.
    await context.storageState({ path: AUTH_FILE });

    return stats;
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[naukri-apply] FAILED:', err);
  process.exit(1);
});
