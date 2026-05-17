import { type Page, type Locator } from 'playwright';

/**
 * Core Naukri automation flow — shared between the Playwright test and the
 * standalone cron script (`src/index.ts`).
 *
 * The flow is split into two functions so production runs can skip the
 * login form by loading a persisted `auth.json` (Playwright's
 * storageState), while tests can exercise the full flow including login.
 */

export const NAUKRI_LOGIN_URL = 'https://www.naukri.com/nlogin/login';
export const NAUKRI_PROFILE_URL = 'https://www.naukri.com/mnjuser/profile';

/**
 * Logs into Naukri using the given credentials.
 *
 * Used by:
 *  - the Playwright test (which logs in fresh on every run)
 *  - the one-time `src/login.ts` helper (which then saves `auth.json`)
 *
 * The cron entry point `src/index.ts` does NOT call this — it loads the
 * persisted `auth.json` instead.
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto(NAUKRI_LOGIN_URL);

  await page.getByRole('textbox', { name: 'Enter Email ID / Username' }).fill(email);
  await page.getByRole('textbox', { name: 'Enter Password' }).fill(password);

  // wait for the redirect triggered by the Login click — needed for timing,
  // not as an assertion. If login truly failed, the next steps fail with a
  // much clearer "element not found" error than any URL check would give.
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/nlogin'), { timeout: 15_000 }),
    page.getByRole('button', { name: 'Login', exact: true }).click(),
  ]);
}

/**
 * Runs the daily profile refresh end-to-end: headline toggle + fresh
 * resume upload + server-side update verification.
 *
 * Assumes the page is on a Naukri origin and already authenticated (either
 * via {@link login} or by loading a `storageState` with valid cookies).
 *
 * Idempotent: handles both "resume present" and "no resume yet" states.
 * Fails loudly if the profile is left without a resume.
 */
export async function runDailyUpdate(page: Page, resumePath: string): Promise<void> {
  // ── Navigate directly to the profile editor ───────────────────────────
  await page.goto(NAUKRI_PROFILE_URL);

  // Diagnostic: if we got bounced to /nlogin, the persisted session
  // expired. Throw a clear, actionable error so the cron log tells us
  // exactly what to do, instead of a cryptic "element not found".
  if (page.url().includes('/nlogin')) {
    throw new Error(
      'Naukri session expired (redirected to login page). ' +
        'Run `npm run login` to refresh auth.json.',
    );
  }

  // ── Toggle the trailing dot on the headline so Naukri sees a change ───
  await page.locator('#lazyResumeHead').getByText('editOneTheme').click();

  const headlineBox = page.getByRole('textbox', { name: 'Minimum 5 words. Sample' });
  await headlineBox.click();
  const currentHeadline = await headlineBox.inputValue();
  const updatedHeadline = currentHeadline.endsWith('.')
    ? currentHeadline.slice(0, -1)
    : `${currentHeadline}.`;
  console.log(
    `[naukri] headline: "${currentHeadline.slice(0, 40)}…" → toggled trailing dot`,
  );
  await headlineBox.fill(updatedHeadline);
  await page.getByRole('button', { name: 'Save' }).click();

  // Best-effort wait for the success indicator. The "Profile updated
  // successfully" banner doesn't always appear — Naukri seems to skip it
  // on rapid re-saves / rate-limited no-ops. We don't fail the run on its
  // absence; the safety net at the end ("Profile last updated - Today")
  // is what actually proves the server registered the change.
  try {
    await page.getByText('Profile updated successfully').waitFor({
      state: 'visible',
      timeout: 5_000,
    });
    console.log('[naukri] save acknowledged ("Profile updated successfully")');
  } catch {
    console.log('[naukri] no success banner — continuing (safety net will verify)');
  }

  // Dismiss the Pro promo modal if it appeared. The modal layer
  // (`.ltLayer.open`) blocks every subsequent click on the profile page
  // until it's closed.
  await dismissPromoModalIfPresent(page);

  // ── Delete the existing resume (only if one is uploaded) ──────────────
  // Skipping when no resume is present makes the test idempotent: works
  // whether the previous run left a resume in place or not.
  const deleteIcon = page.locator('span').filter({ hasText: /^deleteOneTheme$/ });
  if ((await deleteIcon.count()) > 0) {
    await deleteIcon.click();
    await page.getByRole('button', { name: 'Delete' }).click();
    console.log('[naukri] existing resume deleted');
  } else {
    console.log('[naukri] no existing resume — skipping delete');
  }

  // ── Upload the freshly downloaded resume ──────────────────────────────
  await page.getByText('ResumeAdd 10%70% of').click();

  // The "Upload" link opens a native file chooser. Intercept it with
  // page.waitForEvent('filechooser') instead of trying to call
  // setInputFiles on `body` (which is what codegen records but isn't a
  // real <input type="file">).
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Already have a resume? Upload').click(),
  ]);
  await fileChooser.setFiles(resumePath);

  // ── SAFETY NET: resume MUST be present before we exit ─────────────────
  // If a previous run was interrupted between delete and upload, the
  // profile is left without a resume. We must never let *this* run finish
  // in that state — a failure here surfaces clearly in cron logs so the
  // next run can recover (and so Telegram pings us once that's wired up).
  await page.locator('#lazyAttachCV').getByText('Resume', { exact: true }).click();
  await assertVisible(
    page.locator('#lazyAttachCV:has-text("downloadOneTheme")'),
    'resume is not visible on the profile — the upload step silently failed',
  );

  // ── Verify Naukri SERVER registered the update ────────────────────────
  // The header shows "Profile last updated - Today" only when the server
  // accepted the changes. Asserting it here catches the case where the UI
  // briefly looks updated but the server silently dropped the change.
  await assertVisible(
    page.getByText(/Profile last updated\s*[-–]\s*Today/i),
    'Naukri did not mark the profile as "updated Today" — changes may not have persisted server-side',
  );

  console.log(
    '[naukri] resume present + profile marked "updated Today" — daily run complete',
  );
}

/**
 * Naukri sometimes shows a "Power up your profile with Pro" promotional
 * modal after profile updates. It renders as `.ltLayer.open` and blocks all
 * pointer events on the profile page beneath until dismissed.
 *
 * Tries Escape first (works for most Naukri modals); if that doesn't close
 * the layer, falls back to clicking any close-icon candidate inside it.
 */
async function dismissPromoModalIfPresent(page: Page): Promise<void> {
  const layer = page.locator('.ltLayer.open');

  if ((await layer.count()) === 0) {
    console.log('[naukri] no promo modal to dismiss');
    return;
  }

  console.log('[naukri] promo modal detected — dismissing');

  // Strategy 1: press Escape. Works reliably in headed mode; in headless
  // the keyboard event sometimes doesn't reach the page, so we wait a bit
  // and fall through to clicking the X if it didn't take.
  await page.keyboard.press('Escape');
  try {
    await waitForCount(layer, 0, 2_000);
    console.log('[naukri] promo modal closed via Escape');
    return;
  } catch {
    // Escape didn't work — fall through to the click strategy.
  }

  // Strategy 2: click the close-icon (top-right X) inside the open layer.
  // Naukri renders the X as an icon-font glyph whose literal text is
  // "CrossLayer" (same pattern as "editOneTheme" / "deleteOneTheme"
  // elsewhere on the page). The class/attribute selectors are kept as
  // fallbacks in case the markup changes in the future.
  const closeIcon = layer
    .getByText('CrossLayer', { exact: true })
    .or(
      layer.locator(
        '[name="close"], [class*="cross" i], [class*="close" i], [aria-label*="lose" i]',
      ),
    );
  if ((await closeIcon.count()) > 0) {
    await closeIcon.first().click({ force: true });
    await waitForCount(layer, 0, 5_000);
    console.log('[naukri] promo modal closed via close-icon click');
    return;
  }

  throw new Error(
    'Pro promo modal is open but neither Escape nor a close-icon click dismissed it. ' +
      'Capture the X-button selector via `npx playwright codegen` and add it here.',
  );
}

// ─── tiny assertion helpers ──────────────────────────────────────────────
// We deliberately avoid `expect` from `@playwright/test` here so this
// module stays usable from the plain-Node cron script.

/**
 * Waits up to `timeout` ms for `locator` to be visible, throwing a
 * descriptive error if it isn't.
 */
async function assertVisible(
  locator: Locator,
  message: string,
  timeout = 10_000,
): Promise<void> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch (cause) {
    throw new Error(message, { cause: cause as Error });
  }
}

/**
 * Polls `locator.count()` until it equals `expected`, throwing if it
 * doesn't within `timeout` ms. Used for waiting on modal disappearance.
 */
async function waitForCount(
  locator: Locator,
  expected: number,
  timeout = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await locator.count()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Locator did not reach count ${expected} within ${timeout}ms (last count: ${await locator.count()})`,
  );
}
