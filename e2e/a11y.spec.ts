import { test } from '@playwright/test';
import { boot, driveAllStates, expectBaselineNotStale, NARROW } from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven the way a visitor drives it and scanned after every single
 * step: all five tour beats plus Back and Restart, the revocation cycle through
 * fetch → revoke → un-revoke → forget, the accumulation stepper forward, back
 * and to the end, both witness panels including their empty and impossible
 * cases, the dynamic set broken and repaired, the comparison at each
 * recommendation it can reach, all ten forgeries one at a time, the prediction
 * scoreboard hidden and revealed, a real safe-prime search, and every one of
 * the thirteen `<details class="expert">` disclosures opened by clicking its
 * summary. Every resulting state is scanned in both themes at desktop and phone
 * width.
 *
 * See `gate.ts` for why nothing is injected into the page, why no `<details>`
 * is forced open from script, why the drive asserts this lab's defaults instead
 * of assuming them, why every step is scanned rather than only the last, and
 * why `violations` is not the whole oracle.
 */

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expectBaselineNotStale();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expectBaselineNotStale();
  });
}
