import { test, expect } from '@playwright/test';

test('scaffolding sanity check', async ({ page }) => {
  console.log('[naukri-automation] Playwright is wired up correctly.');

  await page.goto('https://example.com');
  const title = await page.title();

  console.log('[naukri-automation] loaded example.com — title:', title);
  await expect(page).toHaveTitle(/Example Domain/);
});
