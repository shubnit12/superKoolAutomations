import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { chromium, devices } from 'playwright';

/**
 * One-off diagnostic for the Recommended Jobs page.
 *
 * Opens the page in HEADED Chrome with the stored session, waits a bit
 * for the UI to settle, then dumps signals we need to pick the right
 * tile selector:
 *   - final URL (to catch silent /nlogin redirects)
 *   - counts of common selector candidates
 *   - first 5 anchor hrefs that contain a digit (most job-tile anchors do)
 *   - HTML snippet of the first jobs-container we can find
 *   - screenshot to /tmp/naukri-jobs.png
 *
 * Run with:  npx ts-node src/debug-jobs.ts
 *
 * Safe to delete after we lock in the production tile selector.
 */

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const AUTH_FILE = path.resolve(__dirname, '..', 'auth.json');
const RECOMMENDED = 'https://www.naukri.com/mnjuser/recommendedjobs';

async function main(): Promise<void> {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error('auth.json missing — run `npm run login` first.');
  }

  const browser = await chromium.launch({
    headless: false,
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

    console.log(`[debug] opening ${RECOMMENDED}`);
    await page.goto(RECOMMENDED, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    console.log(`[debug] final URL: ${page.url()}`);

    // Give React some breathing room to hydrate.
    await page.waitForTimeout(3_000);

    // ── Probe candidate selectors ─────────────────────────────────────
    const probes = [
      'a[href*="/job-listings/"]',
      'a[href*="job-listings"]',
      'a[target="_blank"]',
      '[class*="jobTuple"]',
      '[class*="jobTitle"]',
      '[class*="job-tile"]',
      '[class*="JobCard" i]',
      'article',
      '[data-job-id]',
      '[data-testid*="job" i]',
    ];
    for (const sel of probes) {
      const c = await page.locator(sel).count();
      console.log(`[probe] ${sel.padEnd(40)} → ${c}`);
    }

    // ── First 10 anchors with hrefs ───────────────────────────────────
    const hrefs = await page.$$eval('a[href]', (els) =>
      els.slice(0, 30).map((a) => (a as HTMLAnchorElement).href),
    );
    console.log(`\n[debug] first ${hrefs.length} anchor hrefs:`);
    for (const h of hrefs) console.log(`  ${h}`);

    // ── Dump HTML of the main content for offline grep ────────────────
    const html = await page.locator('#root').innerHTML().catch(() => '');
    const snippet = html.slice(0, 50_000);
    fs.writeFileSync('/tmp/naukri-jobs.html', snippet, 'utf8');
    console.log(`\n[debug] wrote first 50KB of #root innerHTML → /tmp/naukri-jobs.html`);

    // ── Screenshot for visual reference ───────────────────────────────
    await page.screenshot({ path: '/tmp/naukri-jobs.png', fullPage: true });
    console.log(`[debug] full-page screenshot → /tmp/naukri-jobs.png`);

    console.log('\n[debug] keeping browser open for 30s so you can inspect…');
    await page.waitForTimeout(30_000);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[debug] FAILED:', err);
  process.exit(1);
});
