import * as fs from 'fs';
import * as path from 'path';
import { type Page, type Locator, type BrowserContext } from 'playwright';
import { findAnswer } from './qa-defaults';

/**
 * Auto-apply flow for Naukri's "Recommended jobs" page.
 *
 * Actual UX (May 2026):
 *  - The recommended-jobs listing is NOT a per-card Apply layout. There
 *    is a single bulk-apply "Apply" button at the top that only fires
 *    after the user ticks checkboxes (max 5 selections).
 *  - The per-job path is: click a job tile → a new browser tab opens
 *    with the job detail page → click the Apply button there → either
 *    instant success OR a chatbot questionnaire drawer slides in.
 *
 * This module implements the per-job path because it lets us answer
 * Naukri's questionnaire ourselves (the bulk-apply path skips jobs that
 * require answers).
 *
 * Strategy per job:
 *   1. Click the next unvisited tile on the listing page.
 *   2. Wait for the resulting popup (new page).
 *   3. In the popup, find and click "Apply".
 *   4. Race three outcomes:
 *        - success-text  ("Applied to ...", "Application sent")
 *        - chatbot drawer opens                    → answer loop
 *        - new tab opens to a company site         → skip
 *   5. Close the popup and move on.
 *
 * Selectors are kept text-/role-based where possible. Where we have to
 * use IDs (Naukri's chatbot uses dynamic ID suffixes), we anchor on the
 * stable PREFIX via `[id^="..."]`.
 */

export const NAUKRI_RECOMMENDED_JOBS_URL =
  'https://www.naukri.com/mnjuser/recommendedjobs';

export interface ApplyStats {
  /** Jobs we successfully applied to in this run. */
  applied: number;
  /** Subset of `applied` where we used "Skip this question" at least once. */
  appliedWithSkips: number;
  /**
   * Subset of `applied` where we committed a fallback guess
   * (last radio option / "NA" text) for at least one unknown question.
   * Useful for spotting jobs whose answers may be inaccurate.
   */
  appliedWithFallbacks: number;
  /** Skipped because the tile opened a company-site redirect. */
  skippedExternal: number;
  /** Skipped because the popup showed the job was already applied. */
  skippedAlready: number;
  /** Jobs where the chatbot asked a question we don't have an answer for. */
  skippedUnknownQuestion: number;
  /** Cards that errored during processing (logged but non-fatal). */
  failed: number;
  /** Total tiles we clicked through. */
  inspected: number;
}

export interface ApplyOptions {
  /** Hard cap on attempts (successful + skipped). Default 10. */
  maxApplies?: number;
  /** Max ms to wait for the popup tab to open after clicking a tile. Default 10s. */
  popupTimeoutMs?: number;
  /** Max ms to wait for any outcome after clicking the Apply button. Default 12s. */
  applyOutcomeTimeoutMs?: number;
  /**
   * Max ms to wait for the popup's Apply button to become visible.
   * Naukri's job-detail page often shows a full-page skeleton loader
   * for a few seconds before the JD content (and Apply button) actually
   * render. 10s covers all real loads without making no-op tiles drag.
   * Default 10s.
   */
  applyButtonWaitMs?: number;
  /**
   * Max ms to wait for the popup to reach `domcontentloaded` before
   * probing for badges/buttons. Kept short and independent of the
   * button-wait timeout so dead tiles fail fast. Default 6s.
   */
  popupReadyTimeoutMs?: number;
  /** Max chatbot questions we'll loop through per job. Default 15. */
  maxQuestionsPerJob?: number;
  /**
   * How many times we'll click "Skip this question" within a single job's
   * chatbot session before giving up. Skipping lets us still apply when
   * the bot asks one or two questions our rules don't know about, while
   * the cap stops us blindly skipping everything. Default 3.
   */
  maxSkipsPerJob?: number;
  /**
   * How many times we'll commit a fallback guess (last radio option /
   * "NA" text) for unknown questions in a single job before giving up.
   * Fallback runs BEFORE Skip when both are available, since the user
   * prefers a complete-but-imperfect application over a partial one.
   * Default 3.
   */
  maxFallbacksPerJob?: number;
}

/**
 * Runs the full apply flow. Assumes `page` is on a Naukri origin and
 * already authenticated (storageState loaded by the caller).
 */
export async function applyToRecommendedJobs(
  page: Page,
  options: ApplyOptions = {},
): Promise<ApplyStats> {
  const maxApplies = options.maxApplies ?? 10;
  const popupTimeoutMs = options.popupTimeoutMs ?? 20_000;
  const applyOutcomeTimeoutMs = options.applyOutcomeTimeoutMs ?? 20_000;
  const applyButtonWaitMs = options.applyButtonWaitMs ?? 20_000;
  const popupReadyTimeoutMs = options.popupReadyTimeoutMs ?? 20_000;
  const maxQuestionsPerJob = options.maxQuestionsPerJob ?? 15;
  const maxSkipsPerJob = options.maxSkipsPerJob ?? 3;
  const maxFallbacksPerJob = options.maxFallbacksPerJob ?? 3;

  const stats: ApplyStats = {
    applied: 0,
    appliedWithSkips: 0,
    appliedWithFallbacks: 0,
    skippedExternal: 0,
    skippedAlready: 0,
    skippedUnknownQuestion: 0,
    failed: 0,
    inspected: 0,
  };

  console.log(`[jobs] opening ${NAUKRI_RECOMMENDED_JOBS_URL}`);
  await page.goto(NAUKRI_RECOMMENDED_JOBS_URL);

  // If we bounced to /nlogin the persisted session is stale.
  if (page.url().includes('/nlogin')) {
    throw new Error(
      'Naukri session expired (redirected to login page). ' +
        'Run `npm run login` to refresh auth.json.',
    );
  }

  // Find job tiles. Naukri renders each recommended job as
  //   <article class="jobTuple ..." data-job-id="<id>"> ... </article>
  // The tile has a React click handler that opens the job-detail page in
  // a new tab. There is NO wrapping <a> — confirmed via debug-jobs.ts.
  // We click the inner `p.title` so we don't accidentally hit the
  // bulk-apply checkbox in the tile's left gutter.
  const tiles = page.locator('article[data-job-id]');
  try {
    await tiles.first().waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    console.log('[jobs] no job tiles visible after 15s — nothing to do.');
    return stats;
  }

  const tileCount = await tiles.count();
  console.log(`[jobs] ${tileCount} job tile(s) visible at start`);

  for (let i = 0; i < tileCount; i++) {
    if (stats.inspected >= maxApplies) {
      console.log(`[jobs] reached maxApplies cap (${maxApplies}) — stopping.`);
      break;
    }

    stats.inspected++;
    console.log(`\n[jobs] ─── tile #${stats.inspected} ───`);

    try {
      await processOneTile(
        page,
        tiles.nth(i),
        {
          popupTimeoutMs,
          applyOutcomeTimeoutMs,
          applyButtonWaitMs,
          popupReadyTimeoutMs,
          maxQuestionsPerJob,
          maxSkipsPerJob,
          maxFallbacksPerJob,
        },
        stats,
      );
    } catch (err) {
      stats.failed++;
      console.error(
        `[jobs] tile #${stats.inspected} failed:`,
        err instanceof Error ? err.message : err,
      );
      // Best-effort: close any stray popup, clear modal state.
      await closeNonMainTabs(page.context()).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  console.log(
    `\n[jobs] summary — applied: ${stats.applied} ` +
      `(of which ${stats.appliedWithSkips} used skip, ` +
      `${stats.appliedWithFallbacks} used fallback), ` +
      `skipped-external: ${stats.skippedExternal}, ` +
      `skipped-already: ${stats.skippedAlready}, ` +
      `skipped-unknown-q: ${stats.skippedUnknownQuestion}, ` +
      `failed: ${stats.failed}, ` +
      `inspected: ${stats.inspected}`,
  );

  return stats;
}

interface TileOptions {
  popupTimeoutMs: number;
  applyOutcomeTimeoutMs: number;
  applyButtonWaitMs: number;
  popupReadyTimeoutMs: number;
  maxQuestionsPerJob: number;
  maxSkipsPerJob: number;
  maxFallbacksPerJob: number;
}

/**
 * Click one tile, drive the resulting popup, update stats. Throws on
 * fundamentally broken state (caller logs + increments `failed`).
 */
async function processOneTile(
  page: Page,
  tile: Locator,
  options: TileOptions,
  stats: ApplyStats,
): Promise<void> {
  // Scroll into view + log job-id and title for traceability.
  await tile.scrollIntoViewIfNeeded();
  const jobId = (await tile.getAttribute('data-job-id').catch(() => null)) ?? 'unknown';
  const titleEl = tile.locator('p.title').first();
  const title =
    (await titleEl.innerText().catch(() => '')).trim() || '(unknown title)';
  console.log(`[jobs] tile job-id=${jobId} title="${title.slice(0, 80)}"`);

  // Subscribe to context-level "page" events BEFORE the click so we
  // don't miss a fast popup.
  const popupPromise = page
    .context()
    .waitForEvent('page', { timeout: options.popupTimeoutMs })
    .catch(() => null);

  // Click the title (not the whole article) so we don't hit the
  // bulk-apply checkbox in the tile's left gutter.
  await titleEl.click();

  const popup = await popupPromise;
  if (!popup) {
    stats.skippedAlready++;
    console.log('[jobs] no popup opened — treating as already-handled tile');
    return;
  }

  try {
    await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await drivePopup(popup, options, stats);
  } finally {
    await popup.close().catch(() => {});
  }
}

/**
 * Drive a job-detail popup: find Apply, click it, handle the outcome.
 */
async function drivePopup(
  popup: Page,
  options: TileOptions,
  stats: ApplyStats,
): Promise<void> {
  // The popup tab often opens with just Naukri's full-page skeleton
  // loader for a few seconds before the JD renders. Probing for the
  // Apply button or "already applied" badge during that gap returns
  // false negatives — every tile would look like "no Apply button".
  // Wait for DOM-content-loaded BEFORE any text/button checks.
  // Kept short (6s default) so dead tiles fail fast — most JDs reach
  // domcontentloaded well under 3s; if it hasn't by 6s, the tile is
  // probably a no-op anyway.
  await popup
    .waitForLoadState('domcontentloaded', { timeout: options.popupReadyTimeoutMs })
    .catch(() => {
      // Don't bail: even a partial render can still expose the button.
      console.log('[jobs] popup did not reach domcontentloaded — proceeding anyway');
    });

  // External-application links usually read "Apply on company site".
  // Detect them BEFORE clicking the generic Apply so we don't open the
  // company tab unnecessarily.
  const externalLink = popup.getByRole('button', {
    name: /apply on company site/i,
  });
  if ((await externalLink.count()) > 0) {
    stats.skippedExternal++;
    console.log('[jobs] popup is an "Apply on company site" job — skipping');
    return;
  }

  // Already-applied indicators on the popup detail page.
  const alreadyApplied = popup.getByText(
    /you have applied|already applied|application sent/i,
  );
  if ((await alreadyApplied.count()) > 0) {
    stats.skippedAlready++;
    console.log('[jobs] popup shows job already applied — skipping');
    return;
  }

  const applyBtn = popup.getByRole('button', { name: /^Apply$/i }).first();
  try {
    await applyBtn.waitFor({ state: 'visible', timeout: options.applyButtonWaitMs });
  } catch {
    stats.skippedAlready++;
    console.log(
      `[jobs] no Apply button visible after ${options.applyButtonWaitMs}ms — skipping`,
    );
    return;
  }

  // Subscribe to a new-tab event BEFORE clicking Apply — some jobs only
  // reveal their external-site nature after the click.
  const nestedTabPromise = popup
    .context()
    .waitForEvent('page', { timeout: 2_500 })
    .catch(() => null);

  await applyBtn.click();

  // Race outcomes: instant success / chatbot drawer / nested-tab open.
  const outcome = await detectApplyOutcome(popup, options.applyOutcomeTimeoutMs, nestedTabPromise);

  switch (outcome.kind) {
    case 'success': {
      stats.applied++;
      console.log(`[jobs] applied (instant) — ${outcome.detail}`);
      return;
    }
    case 'external': {
      stats.skippedExternal++;
      console.log(`[jobs] external redirect after Apply → ${outcome.detail}`);
      // The nested tab is already closed by detectApplyOutcome.
      return;
    }
    case 'chatbot': {
      const result = await runChatbotLoop(
        popup,
        options.maxQuestionsPerJob,
        options.maxSkipsPerJob,
        options.maxFallbacksPerJob,
      );
      if (result.outcome === 'success') {
        stats.applied++;
        if (result.skipsUsed > 0) stats.appliedWithSkips++;
        if (result.fallbacksUsed > 0) stats.appliedWithFallbacks++;
        const tags: string[] = [];
        if (result.skipsUsed > 0) tags.push(`skipped ${result.skipsUsed}`);
        if (result.fallbacksUsed > 0) tags.push(`fallback ${result.fallbacksUsed}`);
        const suffix = tags.length ? ` — ${tags.join(', ')} unknown q` : '';
        console.log(`[jobs] applied (after chatbot)${suffix}`);
      } else if (result.outcome === 'unknown') {
        stats.skippedUnknownQuestion++;
        console.log(
          `[jobs] chatbot bailed (skips=${result.skipsUsed}, fallbacks=${result.fallbacksUsed})`,
        );
      } else {
        stats.failed++;
        console.log(`[jobs] chatbot loop ended without success: ${result.outcome}`);
      }
      return;
    }
    case 'unknown': {
      // Apply clicked but no recognized outcome → could be silently
      // applied, could be in a weird state. Probe for success markers
      // one more time before giving up.
      const success = popup.getByText(/applied to "|application sent|successfully applied/i);
      if ((await success.count()) > 0) {
        stats.applied++;
        console.log('[jobs] applied (success marker found on final probe)');
      } else {
        stats.skippedAlready++;
        console.log('[jobs] no observable outcome after Apply — treating as no-op');
      }
      return;
    }
  }
}

type ApplyOutcome =
  | { kind: 'success'; detail: string }
  | { kind: 'chatbot'; detail: string }
  | { kind: 'external'; detail: string }
  | { kind: 'unknown'; detail: string };

/**
 * Watch the popup for the first thing that fires after Apply: a success
 * toast, the chatbot drawer, or a nested company-site tab.
 */
async function detectApplyOutcome(
  popup: Page,
  timeoutMs: number,
  nestedTabPromise: Promise<Page | null>,
): Promise<ApplyOutcome> {
  const success = popup
    .getByText(/applied to "|application sent|successfully applied|you have applied/i)
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => ({ kind: 'success' as const, detail: 'success-toast' }))
    .catch(() => null);

  const chatbot = popup
    .locator('.chatbot_DrawerContentWrapper, [class*="chatbot_Drawer" i]')
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => ({ kind: 'chatbot' as const, detail: 'drawer-opened' }))
    .catch(() => null);

  const nestedTab = nestedTabPromise.then((tab) =>
    tab ? { kind: 'external' as const, detail: tab.url(), tab } : null,
  );

  const winner = await Promise.race([success, chatbot, nestedTab]);

  if (winner && winner.kind === 'external') {
    await winner.tab.close().catch(() => {});
    return { kind: 'external', detail: winner.detail };
  }
  if (winner) return { kind: winner.kind, detail: winner.detail };
  return { kind: 'unknown', detail: 'no-signal-within-timeout' };
}

interface ChatbotResult {
  outcome: 'success' | 'unknown' | 'timeout';
  /** How many times we clicked "Skip this question" in this session. */
  skipsUsed: number;
  /**
   * How many times we committed a fallback guess (last radio option /
   * "NA" text) for an unknown question in this session.
   */
  fallbacksUsed: number;
}

/**
 * Drive the chatbot questionnaire to completion.
 *
 * Per-iteration strategy:
 *   1. Wait for a NEW `.botMsg` to appear in the chat thread (or for
 *      the success marker). This naturally handles both the welcome-
 *      banner warmup and the inter-question render delay.
 *   2. Read ONLY the text of the latest `.botMsg` — earlier ones are
 *      already-answered Q&A history and would cause stale matches.
 *   3. Match it against qa-defaults.ts and submit the answer. If no rule
 *      matches, click "Skip this question" up to `maxSkips` times before
 *      giving up — most jobs only have one or two oddball questions and
 *      we'd rather submit a mostly-complete application than nothing.
 *
 * Returns `{ outcome, skipsUsed }` where outcome is:
 *   - 'success'  → "Thank you for your responses" / "Applied to..." appeared
 *   - 'unknown'  → ran out of skips on a question we don't know
 *   - 'timeout'  → ran out of iterations before either of the above
 */
async function runChatbotLoop(
  popup: Page,
  maxIterations: number,
  maxSkips: number,
  maxFallbacks: number,
): Promise<ChatbotResult> {
  // Naukri's chatbot can take 15+s to push the first question after the
  // drawer slides open, especially when the listing-page load was slow.
  // Keep this generous; subsequent questions arrive faster but the
  // same budget is fine.
  const perQuestionWaitMs = 25_000;
  // `:visible` filters out hidden / leftover .botMsg nodes that
  // sometimes linger in the popup DOM (e.g., from a previous mid-flow
  // abandonment) — we only want the messages currently shown.
  const botMsgs = popup.locator('.botMsg:visible');

  // We track "messages we've already answered through" in `seenCount`.
  // Starting at 0 means the first iteration reads whatever is currently
  // the LAST .botMsg. That handles two cases at once:
  //   (a) fresh chatbot open: count grows 0 → 1 (welcome) → 2 (first Q),
  //       and waitForNextBotQuestion skips the welcome banner.
  //   (b) resumed mid-conversation: count is already ≥1 with the
  //       unanswered question visible — we read it immediately rather
  //       than waiting forever for a "next" message that won't come.
  let seenCount = 0;
  let skipsUsed = 0;
  let fallbacksUsed = 0;
  // Only dump the first time we encounter an unknown question in this
  // session — multiple dumps per job would just be noise.
  let unknownDumped = false;

  for (let step = 0; step < maxIterations; step++) {
    const polled = await waitForNextBotQuestion(
      popup,
      botMsgs,
      seenCount,
      perQuestionWaitMs,
    );

    if (polled.kind === 'done') {
      return { outcome: 'success', skipsUsed, fallbacksUsed };
    }
    if (polled.kind === 'timeout') {
      await dumpChatbotDebug(popup, 'unknown-question');
      return { outcome: 'unknown', skipsUsed, fallbacksUsed };
    }

    const answer = findAnswer(polled.question);
    if (!answer) {
      console.log(
        `[jobs] chatbot: no qa-defaults rule for question:\n  "${polled.question}"`,
      );
      // ALWAYS dump the first unknown question of a session so future
      // tuning of qa-defaults can use the captured DOM.
      if (!unknownDumped) {
        await dumpChatbotDebug(popup, 'unknown-question');
        unknownDumped = true;
      }

      // Strategy: prefer FALLBACK (commit a guess) over SKIP (leave
      // empty). The user prefers a complete-but-imperfect application
      // over one with skipped questions, since recruiters tend to filter
      // out applications with unanswered fields. Bail only if neither
      // fallback nor Skip succeed.
      let advanced = false;

      if (fallbacksUsed < maxFallbacks) {
        const fb = await applyFallbackAnswer(popup, polled.question);
        if (fb.kind !== 'none') {
          await clickChatbotSave(popup);
          fallbacksUsed++;
          advanced = true;
          const chose =
            fb.kind === 'radio'
              ? `last-option [${fb.label ?? '?'}]`
              : `"${fb.label ?? 'NA'}"`;
          console.log(
            `[jobs] chatbot Q${step + 1}: FALLBACK ${fb.kind} ${chose} ` +
              `(${fallbacksUsed}/${maxFallbacks} fallbacks used)`,
          );
        }
      } else {
        console.log(
          `[jobs] chatbot: reached fallback cap (${maxFallbacks}) — trying Skip`,
        );
      }

      if (!advanced) {
        if (skipsUsed >= maxSkips) {
          console.log(
            `[jobs] chatbot: reached skip cap (${maxSkips}) — bailing on this job`,
          );
          return { outcome: 'unknown', skipsUsed, fallbacksUsed };
        }
        const skipped = await clickChatbotSkip(popup);
        if (!skipped) {
          console.log(
            `[jobs] chatbot: no fallback applied and no "Skip this question" button — bailing`,
          );
          return { outcome: 'unknown', skipsUsed, fallbacksUsed };
        }
        skipsUsed++;
        console.log(
          `[jobs] chatbot Q${step + 1}: SKIPPED (${skipsUsed}/${maxSkips} skips used)`,
        );
      }

      seenCount = polled.botMsgCount;
      continue;
    }

    console.log(
      `[jobs] chatbot Q${step + 1}: "${polled.question.slice(0, 80)}" ` +
        `→ ${answer.label} ← "${answer.text}" (${answer.kind})`,
    );

    const ok = await applyAnswer(popup, answer.text, answer.kind);
    if (!ok) {
      console.log(`[jobs] chatbot: could not enter answer for ${answer.label}`);
      await dumpChatbotDebug(popup, 'apply-answer-failed');
      return { outcome: 'unknown', skipsUsed, fallbacksUsed };
    }
    await clickChatbotSave(popup);

    // Remember how many bot messages we'd seen BEFORE the Save click.
    // The next iteration will wait for this count to increase.
    seenCount = polled.botMsgCount;
  }

  return { outcome: 'timeout', skipsUsed, fallbacksUsed };
}

/**
 * Last-resort answer when no qa-defaults rule matched the question.
 * Tries the LAST visible radio option first, then "NA" into the text
 * input. Returns `'none'` when neither is reachable.
 *
 * Note on "last radio": Naukri's notice-period bucket goes from
 * "15 Days or less" (most permissive) to "Serving Notice Period"
 * (most accommodating); the last option is usually the most flexible
 * for recruiter-side filtering. Yes/No questions become "No" — not
 * ideal, but "applied with one wrong answer" still beats "not applied".
 */
async function applyFallbackAnswer(
  popup: Page,
  questionText: string,
): Promise<{ kind: 'radio' | 'text' | 'none'; label?: string }> {
  // Strategy 0: heuristic for tech-experience questions.
  //
  // Naukri recruiters often phrase a numeric-experience question in
  // ways our explicit rules don't catch (e.g., "Java experience?",
  // "Years on AWS", "Python REST API exp"). When the question
  // (a) mentions a recognised tech keyword AND (b) mentions an
  // experience-related word AND (c) doesn't look like a Yes/No, we
  // fill the text input with the relevant-experience value (env-
  // controlled via NAUKRI_RELEVANT_EXPERIENCE, default "3.5"). This
  // is far more accurate than a blanket "NA".
  if (questionText && looksLikeTechExperienceQuestion(questionText)) {
    const textInput = popup.locator('[id^="userInput__"]').first();
    if ((await textInput.count()) > 0) {
      try {
        await textInput.waitFor({ state: 'visible', timeout: 1_500 });
        const years = (process.env.NAUKRI_RELEVANT_EXPERIENCE ?? '').trim() || '3.5';
        await textInput.fill(years);
        return { kind: 'text', label: `${years} (tech-experience heuristic)` };
      } catch {
        // No reachable text input — fall through to radio strategies.
      }
    }
  }

  // Strategy 1: radio last-option.
  //
  // Naukri's radio DOM looks like:
  //   <div class="ssrc__radio-btn-container">
  //     <input type="radio" id="No" name="radio-button" value="No" />
  //     <label for="No">No</label>
  //   </div>
  //
  // Two previous attempts that didn't work:
  //   v1: clicked the wrapper `<div>` itself — landed in padding, no
  //       click event reached the input, Naukri's chatbot never advanced.
  //   v2: used `input.check({ force: true })` — Naukri's custom radio
  //       handler intercepts direct input clicks AND `check()`'s post-
  //       action verification (which is NOT skipped by `force: true`)
  //       times out, raising and falling through to the text path.
  //
  // What actually works (same as the proven normal-radio path in
  // applyAnswer): click the `<label>` element. Browsers natively
  // dispatch a click on the input whose `id` matches `<label for="...">`,
  // which sails past any custom onclick handler on the input itself.
  const containers = popup.locator('.ssrc__radio-btn-container');
  const containerCount = await containers.count().catch(() => 0);
  if (containerCount > 0) {
    const lastContainer = containers.last();
    // Read the label text up front for clearer logging ("FALLBACK radio
    // last-option [No]" beats just "last-option").
    const label = (await lastContainer.innerText().catch(() => '')).trim();

    // Strategy 1: click the <label> — the proven-working path used by
    // applyAnswer for known radio values.
    try {
      const labelEl = lastContainer.locator('label').first();
      if ((await labelEl.count()) > 0) {
        await labelEl.click({ force: true, timeout: 2_000 });
        return { kind: 'radio', label };
      }
    } catch {
      // Fall through to strategy 2.
    }

    // Strategy 2: click the <input> directly (no label/for in older DOMs).
    // Use `click` not `check` — we don't want check's post-action
    // verification, since Naukri's onChange does its own work.
    try {
      const radioInput = lastContainer.locator('input[type="radio"]').first();
      if ((await radioInput.count()) > 0) {
        await radioInput.click({ force: true, timeout: 2_000 });
        return { kind: 'radio', label };
      }
    } catch {
      // Fall through to text fallback below.
    }
  }

  // Then try the text input.
  const textInput = popup.locator('[id^="userInput__"]').first();
  try {
    await textInput.waitFor({ state: 'visible', timeout: 1_500 });
    await textInput.fill('NA');
    return { kind: 'text', label: 'NA' };
  } catch {
    return { kind: 'none' };
  }
}

/**
 * Click the chatbot's "Skip this question" button if visible.
 * Returns `true` when we managed to click; `false` when the button
 * wasn't present (e.g., the question is non-skippable).
 */
async function clickChatbotSkip(popup: Page): Promise<boolean> {
  const btn = popup.getByRole('button', { name: /^Skip this question$/i });
  try {
    await btn.first().waitFor({ state: 'visible', timeout: 1_500 });
    await btn.first().click();
    return true;
  } catch {
    return false;
  }
}

interface NewQuestionResult {
  kind: 'question';
  question: string;
  botMsgCount: number;
}
type WaitResult = NewQuestionResult | { kind: 'done' } | { kind: 'timeout' };

/**
 * Wait until a bot message AFTER `sinceCount` appears in the chat
 * thread, then return that question's text. If the questionnaire
 * finishes first (success marker visible), return 'done'.
 *
 * The opening "Hi <name>, kindly answer..." banner is also a .botMsg,
 * so we explicitly skip past it via `isWelcomeBanner`.
 */
async function waitForNextBotQuestion(
  popup: Page,
  botMsgs: Locator,
  sinceCount: number,
  timeoutMs: number,
): Promise<WaitResult> {
  const start = Date.now();
  // `skipUntil` is the index of the next bot message we haven't yet
  // classified. We advance it ONLY when we've definitively classified
  // a message as welcome banner / already-answered. Empty text (i.e.,
  // typewriter still rendering) does NOT advance it — we'll re-read
  // the same index on the next poll.
  let skipUntil = sinceCount;

  while (Date.now() - start < timeoutMs) {
    if (await isQuestionnaireDone(popup)) return { kind: 'done' };

    const count = await botMsgs.count().catch(() => 0);
    let madeProgress = false;

    for (let i = skipUntil; i < count; i++) {
      const text = (await botMsgs.nth(i).innerText().catch(() => '')).trim();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (!text) {
        // Mid-render. Stop the inner loop and re-poll after a delay —
        // we want to keep re-reading THIS index until it populates.
        console.log(`[jobs] chatbot: botMsg ${i + 1} empty at +${elapsed}s — waiting for text`);
        break;
      }

      console.log(`[jobs] chatbot: botMsg ${i + 1} at +${elapsed}s → "${text.slice(0, 100)}"`);

      if (isCompletionMarker(text)) return { kind: 'done' };
      if (isWelcomeBanner(text)) {
        skipUntil = i + 1;
        madeProgress = true;
        continue;
      }
      // Real question we should answer.
      return { kind: 'question', question: text, botMsgCount: i + 1 };
    }

    // If we processed nothing (empty thread or last msg still rendering)
    // OR we made progress past welcome banners but no question yet —
    // keep polling.
    void madeProgress;
    await popup.waitForTimeout(400);
  }
  return { kind: 'timeout' };
}

/** Heuristic detector for the chatbot's opening greeting. */
function isWelcomeBanner(text: string): boolean {
  return /hi\s+\w+.*thank you for showing interest|kindly answer all the recruiter/i.test(
    text,
  );
}

/** The bot's "we're done, the recruiter will reach out" sign-off message. */
function isCompletionMarker(text: string): boolean {
  return /thank you for your responses|application.*submitted|applied to "/i.test(text);
}

/**
 * Recognised tech keywords for the heuristic tech-experience fallback.
 *
 * Anchored on `\b` word boundaries so partial matches inside other words
 * don't trigger (e.g., "react" inside "interaction"). The `java(?!script)`
 * negative lookahead keeps "Java" distinct from "JavaScript" so they
 * don't double-match — JavaScript has its own entry.
 *
 * Add more keywords here as new Naukri questions surface; one source of
 * truth keeps maintenance simple.
 */
const TECH_KEYWORDS_REGEX =
  /\b(react(?:\.?js)?|angular|vue|svelte|next\.?js|nuxt|redux|jquery|html|css|sass|tailwind|node\.?js|express(?:\.?js)?|django|flask|spring(?:\s*boot)?|rails|laravel|\.net|php|ruby|python|java(?!script)|javascript|typescript|kotlin|swift|scala|go(?:lang)?|rust|c\+\+|c#|android|ios|flutter|react\s*native|mysql|postgres(?:ql)?|mongo(?:db)?|redis|sql|nosql|dynamodb|oracle|aws|azure|gcp|cloud|devops|docker|kubernetes|k8s|terraform|jenkins|ci\/?cd|api|apis|rest(?:ful)?|graphql|grpc|soap|microservice(?:s)?|tdd|bdd|agile|scrum|backend|frontend|full[\s-]?stack|fullstack|mern|mean|lamp)\b/i;

/** Words that strongly indicate a numeric-experience answer is wanted. */
const EXPERIENCE_REGEX = /\b(experience[ds]?|years?|yrs?|yoe)\b/i;

/**
 * Yes/No question starters. When a question begins with one of these,
 * even if it mentions a tech keyword + "experience", the expected answer
 * is a radio Yes/No, not a numeric text answer.
 */
const YES_NO_STARTER_REGEX =
  /^\s*(do|does|did|have|has|had|are|is|was|were|can|could|will|would|should|may|might|shall)\b/i;

/**
 * True when the question looks like "how many years of X experience"
 * phrased loosely, e.g. "Java experience?" / "Years on React" / "Python
 * REST API exp". Used by the fallback to fill a relevant-experience
 * number instead of "NA".
 */
function looksLikeTechExperienceQuestion(text: string): boolean {
  if (YES_NO_STARTER_REGEX.test(text)) return false;
  return TECH_KEYWORDS_REGEX.test(text) && EXPERIENCE_REGEX.test(text);
}

/**
 * Persist drawer HTML + a screenshot when we bail. Output goes to
 *   /tmp/naukri-chatbot-<tag>-<timestamp>.html
 *   /tmp/naukri-chatbot-<tag>-<timestamp>.png
 * so the next session can read them and extend qa-defaults.ts.
 */
async function dumpChatbotDebug(popup: Page, tag: string): Promise<void> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join('/tmp', `naukri-chatbot-${tag}-${stamp}`);
    const html = await popup.locator('body').innerHTML().catch(() => '');
    if (html) {
      fs.writeFileSync(`${base}.html`, html.slice(0, 200_000), 'utf8');
      console.log(`[jobs] chatbot debug HTML → ${base}.html`);
    }
    await popup.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    console.log(`[jobs] chatbot debug screenshot → ${base}.png`);
  } catch (err) {
    console.log('[jobs] chatbot debug dump failed:', err);
  }
}

async function isQuestionnaireDone(popup: Page): Promise<boolean> {
  const done = popup.getByText(
    /thank you for your responses|applied to "|application sent/i,
  );
  return (await done.count()) > 0;
}

/**
 * Type or click an answer into the chatbot UI.
 * Returns true if we believe the answer was entered.
 */
async function applyAnswer(
  popup: Page,
  value: string,
  kind: 'text' | 'radio',
): Promise<boolean> {
  if (kind === 'radio') {
    // Radio answers live inside `.ssrc__radio-btn-container`. We click
    // the option whose label matches our value.
    const radio = popup
      .locator('.ssrc__radio-btn-container')
      .getByText(value, { exact: true })
      .first();
    if ((await radio.count()) === 0) return false;
    await radio.click({ force: true }).catch(() => {});
    return true;
  }

  // Text input: Naukri uses ids like `userInput__<random>InputBox`.
  // Anchor on the stable prefix so the random suffix doesn't break us.
  const input = popup.locator('[id^="userInput__"]').first();
  if ((await input.count()) === 0) return false;
  await input.click({ force: true }).catch(() => {});
  await input.fill(value);
  return true;
}

/**
 * Click the chatbot's Save button. The id pattern is
 * `sendMsgbtn_container__<random>InputBox` — the visible text is "Save".
 */
async function clickChatbotSave(popup: Page): Promise<void> {
  const saveBtn = popup
    .locator('[id^="sendMsgbtn_container__"]')
    .getByText('Save', { exact: true })
    .first();
  if ((await saveBtn.count()) > 0) {
    await saveBtn.click({ force: true }).catch(() => {});
    return;
  }
  // Fallback: any Save button inside the drawer.
  const fallback = popup.getByText('Save', { exact: true }).last();
  await fallback.click({ force: true }).catch(() => {});
}

/**
 * Close every page in the context except the first one (the main
 * recommended-jobs tab). Used as cleanup after errors so we don't leak
 * popup tabs across iterations.
 */
async function closeNonMainTabs(context: BrowserContext): Promise<void> {
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
}
