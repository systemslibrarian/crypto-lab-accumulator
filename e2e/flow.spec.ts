/**
 * Functional coverage of the golden flow.
 *
 * The accessibility spec walks the page too, but it does so in order to feed
 * axe — its clicks are setup, not assertions. This file protects the same
 * interactions for their *meaning*, so a regression that leaves the page
 * perfectly accessible while quietly breaking the story still fails CI.
 *
 * It also covers the two things a reviewer actually sees first: that the first
 * interactive control is on screen without scrolling, and that nothing
 * overflows horizontally on a phone.
 *
 * Screenshots are written as artefacts rather than compared against golden
 * images on purpose: font rasterisation differs between a local macOS run and
 * the Linux CI runner, and a pixel-diff gate that cries wolf every commit is
 * worse than no gate. The layout assertions below are the part that must hold.
 */

import { expect, test, type Page } from '@playwright/test'

const SUBJECT = 'cert:SN-0xD4A9'
const SHOTS = 'test-results/shots'

async function digestVersion(page: Page): Promise<string> {
  return (await page.locator('.digest-version').first().innerText()).trim()
}

test.describe('guided revocation story', () => {
  test('runs the four beats against the real verifier', async ({ page }) => {
    await page.goto('.')

    // Beat 1 — the set grows, the digest does not.
    const digestBefore = await page.locator('.digest-hex').first().innerText()
    await page.getByRole('button', { name: 'Build the revocation set' }).click()
    await expect(page.locator('.chip')).toHaveCount(5)
    const digestAfter = await page.locator('.digest-hex').first().innerText()
    expect(digestAfter).not.toBe(digestBefore)
    expect(digestAfter.length).toBe(digestBefore.length)
    await expect(page.locator('.stage-note').first()).toContainText('5 revoked')

    // Beat 2 — the initial non-membership proof verifies.
    await page.getByRole('button', { name: `Prove ${SUBJECT} is not on it` }).click()
    await expect(page.locator('.proof-card .verdict-ok').first()).toBeVisible()
    await expect(page.locator('.proof-card')).toContainText('NOT REVOKED')
    const mintedAgainst = await digestVersion(page)

    // Beat 3 — revocation moves the digest and kills the cached proof, while
    // the proof stays valid against the digest it was minted for. Both must be
    // stated: that separation is the operational lesson.
    await page.getByRole('button', { name: `Now revoke ${SUBJECT}` }).click()
    expect(await digestVersion(page)).not.toBe(mintedAgainst)
    await expect(page.locator('.proof-card')).toContainText('is stale')
    await expect(page.locator('.proof-card .verdict-alarm')).toContainText('Proof invalid against current digest')
    await expect(page.locator('.proof-card .verdict-ok')).toContainText('Proof valid against digest')

    // Beat 4 — the trapdoor forgery is accepted, and rendered as an alarm.
    await page.getByRole('button', { name: 'Break it with the trapdoor' }).click()
    await expect(page.locator('.proof-card .verdict-alarm').first()).toContainText('FORGERY ACCEPTED')

    await page.screenshot({ path: `${SHOTS}/desktop-beat4.png`, fullPage: false })
  })

  test('Back and Reset return to a deterministic state', async ({ page }) => {
    await page.goto('.')
    const opening = await page.locator('.digest-hex').first().innerText()

    await page.getByRole('button', { name: 'Build the revocation set' }).click()
    await page.getByRole('button', { name: `Prove ${SUBJECT} is not on it` }).click()
    await expect(page.locator('.chip')).toHaveCount(5)

    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.locator('.chip')).toHaveCount(5)

    await page.getByRole('button', { name: 'Restart the demo' }).click()
    await expect(page.locator('.chip')).toHaveCount(3)
    expect(await page.locator('.digest-hex').first().innerText()).toBe(opening)

    // The presenter control in the navigator does the same from anywhere.
    await page.getByRole('button', { name: 'Build the revocation set' }).click()
    await expect(page.locator('.chip')).toHaveCount(5)
    await page.getByRole('button', { name: 'Reset demo' }).click()
    await expect(page.locator('.chip')).toHaveCount(3)
  })

  test('a deep link replays the story to that beat', async ({ page }) => {
    await page.goto('./?tour=revocation&step=3')
    await expect(page.locator('.tour-eyebrow')).toContainText('4 / 5')
    // Step 3 is the revocation, so the subject must be in the set and the
    // cached proof must already be failing.
    await expect(page.locator('.chip', { hasText: SUBJECT })).toBeVisible()
    await expect(page.locator('.proof-card')).toContainText('is stale')
  })
})

test.describe('witness repair', () => {
  test('public update rules restore a witness the set change broke', async ({ page }) => {
    await page.goto('.')
    await page.locator('#dynamics').scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: 'Mint both witnesses now' }).click()
    await expect(page.locator('#dynamics .verdict-ok').first()).toBeVisible()

    // Break them: adding an unrelated element invalidates every witness.
    await page.getByRole('button', { name: 'Add to the set' }).click()
    await expect(page.locator('#dynamics .verdict-alarm').first()).toContainText('Stale')

    // Repair them from public data alone.
    await page.getByRole('button', { name: 'Update both witnesses (public data only)' }).click()
    await expect(page.locator('#dynamics .verdict-alarm')).toHaveCount(0)
    await expect(page.locator('#dynamics .cell .verdict-ok').first()).toContainText('Still verifies')
  })
})

test.describe('attack prediction', () => {
  test('reveals ten real outcomes, two of them accepted', async ({ page }) => {
    await page.goto('.')
    await page.locator('#forge').scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: 'Run all ten and reveal' }).click()
    const accepted = page.locator('#forge .predict-verdict', { hasText: 'ACCEPTED' })
    await expect(accepted).toHaveCount(2)
    await expect(page.locator('#forge')).toContainText('the input contract was bypassed')
    await expect(page.locator('#forge')).toContainText('the assumption is gone')
  })
})

test.describe('deployment recommendation', () => {
  test('changes its answer when a trusted setup is unavailable', async ({ page }) => {
    await page.goto('.')
    await page.locator('#compare').scrollIntoViewIfNeeded()
    await page.locator('#cmp-params').selectOption('3072')
    await page.locator('#cmp-size').selectOption('10000000')
    await page.locator('#cmp-setup').selectOption('yes')
    const withSetup = await page.locator('.recommend-head').innerText()

    await page.locator('#cmp-setup').selectOption('no')
    await expect(page.locator('.recommend-head')).toContainText('Merkle')
    expect(await page.locator('.recommend-head').innerText()).not.toBe(withSetup)
  })
})

test.describe('layout', () => {
  test('the first action is on screen without scrolling on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('.')
    const box = await page.locator('.btn-tour').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(900)
  })

  test('the first action is within one viewport on a 390px phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('.')
    const box = await page.locator('.btn-tour').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    await page.screenshot({ path: `${SHOTS}/mobile-beat0.png`, fullPage: false })
  })

  test('nothing overflows horizontally at any width', async ({ page }) => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('.')
      // Drive the widest content into view: the comparison table and chart.
      await page.locator('#compare').scrollIntoViewIfNeeded()
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }))
      expect(overflow.doc, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(overflow.inner + 1)
    }
  })

  test('the comparison chart renders in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('.')
    await page.locator('#compare').scrollIntoViewIfNeeded()
    await expect(page.locator('#compare .chart')).toBeVisible()
    await page.locator('#compare .chart').screenshot({ path: `${SHOTS}/chart-dark.png` })

    await page.locator('#cl-theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('#compare .chart')).toBeVisible()
    await page.locator('#compare .chart').screenshot({ path: `${SHOTS}/chart-light.png` })
  })
})
