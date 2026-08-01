/**
 * WCAG 2.1 A/AA gate, run by axe against the production build in BOTH themes.
 *
 * Axe only checks what is in the DOM, so an unscanned state is an ungated
 * state. This spec therefore drives the whole page rather than scanning the
 * landing view: every panel is walked into its post-interaction state, and each
 * theme is scanned twice — once with the "healthy" results on screen (proofs
 * verifying, forgeries rejected) and once with the failure results on screen
 * (stale witnesses, a revoked certificate, an accepted forgery), because those
 * two sets of result regions use different colours and different live regions.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Freeze motion and reveal anything collapsed or hidden before a scan. */
async function reveal(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important}`,
  })
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true))
    document.querySelectorAll<HTMLElement>('[hidden],[role="tabpanel"]').forEach((el) => {
      el.removeAttribute('hidden')
      el.style.display = ''
      el.classList.add('active', 'is-active', 'open')
    })
  })
}

async function scan(page: Page, label: string): Promise<void> {
  await reveal(page)
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map((v) => ({
      state: label,
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    })),
  ).toEqual([])
}

/**
 * Pass 1 — the healthy states. Everything on screen verifies.
 */
async function driveHealthy(page: Page): Promise<void> {
  // The guided tour FIRST: every beat replays from a reset, so driving it after
  // the panels below would undo their state. Beats 1 and 2 leave a proof card
  // in its verifying state.
  await page.getByRole('button', { name: 'Build the revocation set' }).click()
  await page.getByRole('button', { name: /^Prove cert:/ }).click()
  await expect(page.locator('.proof-card .verdict-ok').first()).toBeVisible()

  // The prediction challenge, revealed — its outcome column only exists then.
  await page.getByRole('button', { name: 'Run all ten and reveal' }).click()
  await expect(page.locator('#forge .predict-verdict').first()).toBeVisible()

  // Every deployment control, so the recommendation renders each of its shapes.
  await page.locator('#cmp-size').selectOption('10000000')
  await page.locator('#cmp-setup').selectOption('no')
  await page.locator('#cmp-churn').selectOption('high')
  await expect(page.locator('.recommend-head')).toBeVisible()

  // The headline stepper, walked forward, back, and to the end.
  await page.getByRole('button', { name: 'Multiply in the next element' }).click()
  await page.getByRole('button', { name: 'Multiply in the next element' }).click()
  await page.getByRole('button', { name: 'Step back' }).click()
  await page.getByRole('button', { name: 'Jump to the full set' }).click()
  await page.getByRole('button', { name: '+10 elements' }).click()
  await expect(page.locator('#mechanism .statrow').last()).toBeVisible()

  // Membership: honest proof, then the fail-closed path.
  await page.getByRole('button', { name: 'Build witness and verify' }).first().click()
  await expect(page.locator('#membership .verdict-ok').first()).toBeVisible()
  await page.getByRole('button', { name: 'Try to build a witness' }).click()

  // Non-membership: honest absence proof.
  await page.getByRole('button', { name: 'Build witness and verify' }).last().click()
  await expect(page.locator('#nonmembership .verdict-ok').first()).toBeVisible()

  // Dynamic set: mint witnesses so the "still verifies" cards render.
  await page.getByRole('button', { name: 'Mint both witnesses now' }).click()
  await expect(page.locator('#dynamics .verdict-ok').first()).toBeVisible()

  // Both deletion paths, side by side.
  await page.getByRole('button', { name: 'Delete the last element both ways' }).click()

  // Revocation: fetch a proof for a certificate that is NOT revoked.
  await page.getByRole('button', { name: 'Fetch a proof for this certificate' }).click()
  await expect(page.locator('#revocation .verdict-ok').first()).toBeVisible()

  // Forgery: exercise every attack in the list, then leave a rejected one up.
  const attack = page.locator('#forge-attack')
  for (const value of await attack.locator('option').evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).value),
  )) {
    await attack.selectOption(value)
  }
  await attack.selectOption('w-eq-a')
  await expect(page.locator('#forge .verdict-ok').first()).toBeVisible()

  // Comparison: the measured table plus both chart parameter settings.
  await page.locator('#cmp-params').selectOption('3072')
  await page.locator('#cmp-rep').selectOption('256')
  await expect(page.locator('#compare .chart')).toBeVisible()

  // Restoring parameters populates the setup panel's live region.
  await page.getByRole('button', { name: 'Restore the shipped parameters' }).click()
}

/**
 * Pass 2 — the failure states. Stale witnesses, a revoked certificate, an
 * accepted forgery. Different colours, different live regions, so they need
 * their own scan.
 */
async function driveFailures(page: Page): Promise<void> {
  // Run the tour to its end first (it replays from a reset). Beat 3 leaves a
  // stale proof card with the three-line freshness readout; beat 4 leaves an
  // accepted forgery rendered as an alarm.
  await page.getByRole('button', { name: /^Now revoke cert:/ }).click()
  await expect(page.locator('.proof-card')).toContainText('is stale')
  await page.getByRole('button', { name: 'Break it with the trapdoor' }).click()
  await expect(page.locator('.proof-card .verdict-alarm').first()).toContainText('FORGERY ACCEPTED')

  // The revocation panel, driven through its own healthy → revoked cycle.
  await page.getByRole('button', { name: 'Un-revoke it' }).click()
  await page.getByRole('button', { name: 'Fetch a proof for this certificate' }).click()
  await page.getByRole('button', { name: 'Revoke this certificate' }).click()
  await expect(page.locator('#revocation .verdict-alarm').first()).toBeVisible()

  // Mint, break and repair the held witnesses in the dynamic-set panel.
  await page.getByRole('button', { name: 'Mint both witnesses now' }).click()
  await page.getByRole('button', { name: 'Add to the set' }).click()
  await expect(page.locator('#dynamics .verdict-alarm').first()).toBeVisible()
  await page.getByRole('button', { name: 'Update both witnesses (public data only)' }).click()

  // Remove through the set editor so the delete path is exercised too.
  await page.getByRole('button', { name: /^Remove cert:/ }).first().click()

  // Try to prove absence of something that is present — the impossible case.
  await page.locator('#nonmem-el').fill('cert:SN-0xD4A9')
  await page.getByRole('button', { name: 'Build witness and verify' }).last().click()

  // A forgery that actually succeeds, rendered as an alarm.
  await page.locator('#forge-attack').selectOption('trapdoor')
  await expect(page.locator('#forge .verdict-alarm').first()).toBeVisible()

  // A typed witness, exercising the custom-input control.
  await page.locator('#forge-attack').selectOption('w-custom')
  await page.locator('#forge-custom').fill('c0ffee')
  await page.getByRole('button', { name: 'Run it against the real verifier' }).click()

  // Real safe-prime generation, at the fastest size so CI is not held up. If
  // the search is unlucky we scan whatever the progress region shows instead —
  // the region is populated either way.
  await page.locator('#setup-size').selectOption('256')
  await page.getByRole('button', { name: 'Search for fresh safe primes now' }).click()
  await page
    .locator('#setup')
    .getByText('Your browser now holds the trapdoor')
    .waitFor({ state: 'visible', timeout: 45_000 })
    .catch(() => {})
}

test('no WCAG A/AA violations — dark theme', async ({ page }) => {
  await page.goto('.')
  await driveHealthy(page)
  await scan(page, 'dark / healthy')
  await driveFailures(page)
  await scan(page, 'dark / failures')
})

test('no WCAG A/AA violations — 390px viewport', async ({ page }) => {
  // The narrow layout swaps the exhibit navigator for a menu and stacks the
  // guided stage, so it is a genuinely different DOM to scan.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('.')
  await page.locator('.labnav-select').selectOption('compare')
  await driveHealthy(page)
  await scan(page, 'mobile / healthy')
})

test('no WCAG A/AA violations — light theme', async ({ page }) => {
  await page.goto('.')
  await page.locator('#cl-theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await driveHealthy(page)
  await scan(page, 'light / healthy')
  await driveFailures(page)
  await scan(page, 'light / failures')
})
