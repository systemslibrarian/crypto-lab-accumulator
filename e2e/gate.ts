import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Four rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The gate this replaces
 *     pushed `*{animation:none!important;transition:none!important}` through
 *     `addStyleTag`, then forced `open = true` on every `<details>`, stripped
 *     every `[hidden]` attribute, and added `.active/.is-active/.open` to
 *     everything it could find. That is a document no visitor can produce: this
 *     lab has fourteen collapsed `<details class="expert">` blocks, and
 *     `#forge-custom`'s wrapper is `[hidden]` until the "witness you type"
 *     attack is selected. Worse, suppressing motion with a style tag BYPASSES
 *     the lab's own `@media (prefers-reduced-motion: reduce)` block instead of
 *     exercising it, so the one defect that block could contain — an element
 *     whose only route to its visible state is an animation the block cancels
 *     without restoring the end state — was structurally unreachable. Here the
 *     preference is emulated at the browser, asserted from inside the page, and
 *     every collapsed region is opened by clicking its `<summary>`.
 *
 *  2. IT DROVE THE WHOLE LAB AND SCANNED TWICE, AT THE END OF EACH PASS. Ten
 *     exhibits were walked — the tour, the revocation cycle, the stepper, both
 *     witness panels, the dynamic set, the comparison, all ten forgeries, the
 *     parameter generator — and then a single axe pass ran on whatever happened
 *     to be on screen last. Every intermediate rendering it built was destroyed
 *     by the next click before anything measured it. Worse, the ten forgery
 *     attacks were selected in a `for` loop with no scan between them, so nine
 *     of the ten result renderings never existed for the oracle at all. Here
 *     every step is scanned in its own right.
 *
 *  3. ASSERT THE DEFAULTS, NEVER ASSUME THEM. `boot` pins down what this lab
 *     actually ships with — the tour on beat 1 of 5, three certificates in the
 *     set, digest #0, no proof held, no `<details>` open, the prediction
 *     scoreboard unrevealed, and every comparison control on its "this page"
 *     setting rather than its realistic one. A gate that assumes the wrong half
 *     scans the wrong half.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 */

/**
 * Wait for the page to hold still: no running animations, and no scrolling.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 *
 * Scroll position is part of "held still" here because this lab scrolls itself.
 * The exhibit navigator's links, its `<select>`, its Reset button and the
 * tour's final "Explore all ten exhibits" all call
 * `scrollIntoView({ behavior: 'smooth' })`, which is a JS-initiated scroll and
 * therefore keeps animating regardless of the reduced-motion preference — and
 * it does not appear in `document.getAnimations()`. Measuring contrast while
 * the document is still moving reads rects that are stale by the time the
 * ancestor walk uses them.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number; __lastY?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      const still = running.length === 0 && w.__lastY === window.scrollY;
      w.__lastY = window.scrollY;
      w.__quietFrames = still ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * has exactly one animation, `digest-flip` on `.digest-rail.is-fresh`, and its
 * reduced-motion block sets `animation: none` on it. That is the risky form,
 * not the safe one: a cancelled animation loses its end state. It is safe here
 * only because the keyframes animate `background-color` from an accent tint TO
 * the value `.digest-rail` already declares, so cancelling lands on the same
 * paint — and that is a fact about this stylesheet, checked by this assertion
 * on every scan, not an assumption.
 *
 * `aria-hidden` subtrees are excluded. The cost of that exclusion is stated
 * plainly: text removed from the accessibility tree AND painted at zero opacity
 * is not checked here.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert this lab's real starting state before anything is driven.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page: an emulation that silently did nothing would
 * leave the gate certifying a different rendering than the one it claims to.
 *
 * The default assertions below are not decoration. Every one of them fixes a
 * fact the drive depends on — that the tour has not been advanced by a `?step=`
 * left in the URL, that the shared set is the shipped three certificates rather
 * than something a previous test grew, that the prediction scoreboard is hidden
 * (its revealed form uses entirely different colours), and that the comparison
 * controls sit on the toy parameters rather than the realistic ones. Three
 * times in this fleet a lab turned out to ship with the opposite default from
 * the one its gate assumed, and scanned the wrong half of its own palette.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  // The whole page is built by `src/main.ts` into `#tourhost`, `#labnav` and
  // `#exhibits`, and it computes the digest and both held witnesses on load —
  // so unlike most labs in this fleet there IS real content at first paint.
  await expect(page.locator('#exhibits .panel')).toHaveCount(10);
  await expect(page.locator('.labnav-link')).toHaveCount(11);

  // The guided tour, on its opening beat with nothing performed yet.
  await expect(page.locator('.tour-eyebrow')).toHaveText('Guided demo · 1 / 5');
  await expect(page.locator('.proof-card.proof-empty')).toBeVisible();
  await expect(page.locator('.tour-stage .chip')).toHaveCount(3);
  await expect(page.locator('.digest-version')).toHaveText('digest #0');

  // Nothing is expanded and nothing is force-revealed. If either of these ever
  // fails, the gate is scanning a document a visitor cannot reach.
  await expect(page.locator('details.expert')).toHaveCount(14);
  await expect(page.locator('details.expert[open]')).toHaveCount(0);
  await expect(page.locator('#forge-custom')).toBeHidden();
  await expect(page.locator('#forge .predict-verdict')).toHaveCount(0);

  // The steppers and cycles start at their beginnings, not part-way through.
  await expect(page.getByRole('button', { name: 'Step back' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Un-revoke it' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Forget the cached proof' })).toBeDisabled();
  await expect(page.locator('#revocation')).toContainText('No proof held');

  // The comparison controls ship on this page's TOY parameters. Their realistic
  // settings render different numbers and a different recommendation, and the
  // gate drives both rather than trusting whichever it happened to load.
  for (const [id, value] of [
    ['#cmp-params', '512'],
    ['#cmp-rep', '64'],
    ['#cmp-size', '1000'],
    ['#cmp-setup', 'yes'],
    ['#cmp-churn', 'low'],
    ['#setup-size', '512'],
  ] as const) {
    await expect(page.locator(id)).toHaveValue(value);
  }

  // Both witness panels have already produced a real, verifying proof.
  await expect(page.locator('#membership .verdict-ok').first()).toBeVisible();
  await expect(page.locator('#nonmembership .verdict-ok').first()).toBeVisible();

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender at 380px: it prints 128-hex-digit group elements and
 * 200-digit decimal exponents, a five-track `grid-template-columns: 1fr auto
 * 1fr auto 1fr` tour stage, an eleven-link sticky navigator, two wide data
 * tables and a 760-unit-wide SVG chart.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow-x: auto` wrapper has a huge bounding rect
    // but is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. That
    // cost a run elsewhere in this fleet, and this lab is full of the same
    // decoy: every `.hexblock`, every `.tablewrap` and `.labnav-scroll` is a
    // scroller wrapped around content far wider than the viewport by design.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    // Prefer an unclipped culprit; fall back to the widest clipped one rather
    // than reporting nothing, so the message always names something to look at.
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This is the assertion most likely to catch a regression in this lab, because
 * its scrollers only overflow once the content is long enough: a `.hexblock`
 * holding the 512-bit digest overflows at every width, but `.labnav-scroll`
 * overflows only on a narrow viewport, and `.hexblock-tall` around the exponent
 * u only once enough elements have been multiplied in.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the
 * committed workflow, and a run with it set fails at the end via
 * `reportCollected`, so a green collection run cannot be mistaken for a green
 * gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything.
 *
 * Without this a collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function softly(run: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return run();
  try {
    await run();
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

/**
 * Scan the page as it currently stands.
 *
 * Six assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — `expectNotBlank`, above.
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters more here than in most labs, since
 *    every tinted surface on the page is a `color-mix()` axe declines to
 *    resolve. Everything else in that bucket is a real result axe simply could
 *    not finish — including `aria-prohibited-attr`, which is where an
 *    `aria-label` on a role-less `<div>` hides, a defect that never reaches the
 *    violations array at all. This lab hangs `aria-label` on a lot of divs
 *    (`.hexblock`, `.tablewrap`, `.chain`, `.meter-track`, every live region),
 *    every one of them paired with an explicit `role`; this assertion is what
 *    keeps that pairing honest.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  await softly(() => expectScrollersReachable(page, label));
  await softly(() => expectNoHorizontalOverflow(page, label));
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Four things shape the order:
 *
 *  - THE GUIDED TOUR REPLAYS FROM A RESET. `applyThrough(n)` calls
 *    `state.reset()` and re-runs beats 1..n, so every Back, Restart and deep
 *    link is the same code path — and so driving the tour after the exhibits
 *    would silently throw away everything they built. It goes first.
 *
 *  - THE TEN FORGERIES OVERWRITE EACH OTHER. Selecting an attack re-runs it
 *    into one shared live region. The gate this replaces selected all ten in a
 *    `for` loop with no scan between them, so nine of the ten renderings were
 *    destroyed before anything measured them — and the two that ACCEPT (the
 *    composite representative and the trapdoor) render as red alarms while the
 *    other eight render as green, so the loop threw away one of the two colour
 *    treatments entirely. Each is scanned in its own right here.
 *
 *  - THE FAILURE STATES ARE WHERE THE COLOURS CHANGE. A stale witness, a
 *    revoked certificate, a rejected proof, an accepted forgery and a refused
 *    prover each use `--alarm-text`/`--alarm-bg` or `--warn-text`/`--warn-bg`
 *    rather than the `--ok-*` pair the happy path uses. Both halves are driven.
 *
 *  - EVERY `<details class="expert">` IS OPENED BY CLICKING ITS `<summary>`,
 *    one at a time, and scanned open. Their bodies are `--surface-2` panels
 *    holding reference lists, rule tables and the second comparison table, and
 *    none of that is measured while they are shut.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);
  const byName = (name: string | RegExp) => page.getByRole('button', { name });
  // Every panel writes its results into a `liveRegion`, and several panels own
  // more than one, so results are addressed by the region's own accessible
  // name rather than by "the first verdict in the panel" — which quietly picks
  // up whichever neighbouring region happens to render first.
  const live = (name: string) => page.locator(`[aria-label="${name}"]`);

  await scanAt('first paint');

  await page.locator('a.cl-skip-link').focus();
  await scanAt('skip link focused');

  // ── The guided tour, beat by beat ────────────────────────────────────────
  await byName('Build the revocation set').click();
  await expect(page.locator('.tour-stage .chip')).toHaveCount(5);
  await expect(page.locator('.chip-new')).toBeVisible();
  await scanAt('tour beat 2 — set grown, digest the same size');

  await byName(/^Prove cert:/).click();
  await expect(page.locator('.proof-card .verdict-ok').first()).toBeVisible();
  await scanAt('tour beat 3 — proof of absence verified');

  await byName(/^Now revoke cert:/).click();
  await expect(page.locator('.proof-card .verdict-warn')).toContainText('is stale');
  await expect(page.locator('.proof-card .verdict-alarm')).toBeVisible();
  await scanAt('tour beat 4 — revoked, cached proof now stale');

  await byName('Break it with the trapdoor').click();
  await expect(page.locator('.proof-card .verdict-alarm')).toContainText('FORGERY ACCEPTED');
  await scanAt('tour beat 5 — forgery accepted by the real verifier');

  // The proof card only grows its "How this was computed" disclosure once a
  // proof is held, so this is the first point at which it exists to open.
  await page.locator('.proof-card summary').click();
  await expect(page.locator('.proof-card details[open]')).toBeVisible();
  await scanAt('forged proof, derivation expanded');

  await page.locator('.tour-controls').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.tour-eyebrow')).toHaveText('Guided demo · 4 / 5');
  await scanAt('tour stepped back to beat 4');

  await byName('Restart the demo').click();
  await expect(page.locator('.tour-eyebrow')).toHaveText('Guided demo · 1 / 5');
  await expect(page.locator('.proof-card.proof-empty')).toBeVisible();
  await scanAt('tour restarted');

  await page.locator('.stage-digest summary').click();
  await expect(page.locator('.stage-digest details[open]')).toBeVisible();
  await scanAt('digest inspector expanded');

  // ── The revocation cycle, which is the point of the whole construction ───
  await byName('Fetch a proof for this certificate').click();
  await expect(live('Certificate status').locator('.verdict-ok')).toBeVisible();
  await scanAt('revocation — proof cached, NOT REVOKED');

  await byName('Revoke this certificate').click();
  await expect(live('Certificate status').locator('.verdict-alarm').first()).toContainText(
    'PROOF REJECTED'
  );
  await expect(page.locator('#revocation')).toContainText('And the CA can now prove the opposite');
  await scanAt('revocation — revoked, cached proof rejected, revocation proved');

  await byName('Un-revoke it').click();
  await expect(live('Certificate status').locator('.verdict-ok')).toBeVisible();
  await scanAt('revocation — un-revoked, the same cached proof verifies again');

  await byName('Forget the cached proof').click();
  await expect(live('Certificate status').locator('.verdict-warn')).toContainText('No proof held');
  await scanAt('revocation — cache cleared, empty state');

  // ── The headline stepper ─────────────────────────────────────────────────
  await byName('Multiply in the next element').click();
  await expect(page.locator('.chain-current .chain-name')).toHaveText('A1');
  await scanAt('mechanism — one element multiplied in');

  await byName('Jump to the full set').click();
  await expect(byName('Jump to the full set')).toBeDisabled();
  await scanAt('mechanism — whole set accumulated');

  await byName('Step back').click();
  await expect(page.locator('.chain-pending').first()).toBeVisible();
  await scanAt('mechanism — stepped back, pending nodes dashed');

  await byName('Back to g').click();
  await expect(byName('Back to g')).toBeDisabled();
  await scanAt('mechanism — back to the generator');

  // The scale test hashes a thousand real labels to primes and runs every
  // exponentiation, behind a `setTimeout(0)` so its "Hashing…" message paints
  // first. Wait on the measured statrow, which only exists once the crunch has
  // finished — never on a fixed delay.
  await byName('+1000 elements').click();
  await expect(live('Scale test result').locator('.statrow')).toBeVisible({ timeout: 180_000 });
  await expect(live('Scale test result')).toContainText('1,003');
  await scanAt('mechanism — a thousand extra elements accumulated and measured');

  // ── Membership, including the fail-closed path ───────────────────────────
  await page.locator('#mem-el').selectOption({ index: 2 });
  await expect(live('Membership proof result').locator('.verdict-ok')).toBeVisible();
  await scanAt('membership — third element proved');

  await page.locator('#mem-try').fill('cert:SN-0xD4A9');
  await byName('Try to build a witness').click();
  await expect(live('Non-member witness attempt').locator('.verdict-ok')).toContainText(
    'Fails closed'
  );
  await scanAt('membership — witness refused for a non-member');

  await page.locator('#mem-try').fill('cert:SN-0xA31F');
  await byName('Try to build a witness').click();
  await expect(live('Non-member witness attempt').locator('.verdict-warn')).toContainText(
    'That element IS in the set'
  );
  await scanAt('membership — asked about an element that is present');

  await page.locator('#mem-try').fill('');
  await byName('Try to build a witness').click();
  await expect(live('Non-member witness attempt').locator('.verdict-warn')).toContainText(
    'Type a label first'
  );
  await scanAt('membership — empty input');

  // ── Non-membership, including the case where no proof can exist ──────────
  const proveAbsence = page
    .locator('#nonmembership')
    .getByRole('button', { name: 'Build witness and verify' });

  await page.locator('#nonmem-el').fill('cert:SN-0xA31F');
  await proveAbsence.click();
  await expect(live('Non-membership proof result').locator('.verdict-ok')).toContainText(
    'No proof of absence exists'
  );
  await scanAt('non-membership — absence of a present element is unprovable');

  await page.locator('#nonmem-el').fill('');
  await proveAbsence.click();
  await expect(live('Non-membership proof result').locator('.verdict-warn')).toBeVisible();
  await scanAt('non-membership — empty input');

  await page.locator('#nonmem-el').fill('cert:SN-0xD4A9');
  await proveAbsence.click();
  await expect(live('Non-membership proof result').locator('.verdict-ok')).toContainText(
    'Verified absent'
  );
  await scanAt('non-membership — absence verified');

  // ── The dynamic set: break the held witnesses, then repair them ──────────
  const held = page.locator('#dynamics .grid-2');

  await byName('Add to the set').click();
  await expect(page.locator('.setitem')).toHaveCount(4);
  await expect(page.locator('#dynamics .hexdiff-unequal')).toBeVisible();
  await scanAt('dynamics — element added, digest moved without growing');

  await byName('Mint both witnesses now').click();
  await expect(live('Witness repair result')).toContainText('Witnesses minted');
  await expect(held.locator('.verdict-ok')).toHaveCount(2);
  await scanAt('dynamics — both witnesses minted and fresh');

  await page.locator('#dyn-add').fill('cert:SN-0xBEEF');
  await byName('Add to the set').click();
  await expect(held.locator('.verdict-alarm').first()).toContainText('Stale — rejected');
  await scanAt('dynamics — set changed, held witnesses stale');

  // Adding the same label twice is the refusal branch, and the only state in
  // which the set editor's own error region renders at all.
  await page.locator('#dyn-add').fill('cert:SN-0xBEEF');
  await byName('Add to the set').click();
  await expect(live('Set change result').locator('.verdict-warn')).toContainText('Not added');
  await scanAt('dynamics — duplicate refused');

  await byName('Update both witnesses (public data only)').click();
  await expect(held.locator('.verdict-ok')).toHaveCount(2);
  await scanAt('dynamics — witnesses repaired from public data alone');

  await byName('Delete the last element both ways').click();
  await expect(live('Deletion comparison result')).toContainText('Identical results');
  await scanAt('dynamics — recompute and trapdoor deletion compared');

  await page.locator('.setitem button.btn-icon').last().click();
  await expect(page.locator('.setitem')).toHaveCount(4);
  await scanAt('dynamics — element removed through the set editor');

  await byName('Reset the set').click();
  await expect(page.locator('.setitem')).toHaveCount(3);
  await scanAt('dynamics — set reset');

  // ── The comparison, driven to each recommendation it can actually reach ──
  await page.locator('#cmp-params').selectOption('3072');
  await page.locator('#cmp-rep').selectOption('256');
  expect(await page.locator('#chart-desc').textContent()).toContain('384 bytes');
  await expect(page.locator('.recommend-head')).toHaveText('Use the accumulator.');
  await scanAt('comparison — realistic parameters, accumulator recommended');

  await page.locator('#cmp-size').selectOption('10000000');
  await page.locator('#cmp-churn').selectOption('high');
  await expect(page.locator('.recommend-head')).toContainText('bigger bill');
  await scanAt('comparison — smaller proof, larger witness-update bill');

  await page.locator('#cmp-setup').selectOption('no');
  await expect(page.locator('.recommend-head')).toHaveText('Use a Merkle tree.');
  await scanAt('comparison — no trusted setup available');

  await page.locator('#cmp-setup').selectOption('yes');
  await page.locator('#cmp-params').selectOption('512');
  await page.locator('#cmp-rep').selectOption('64');
  await page.locator('#cmp-size').selectOption('1000');
  await page.locator('#cmp-churn').selectOption('low');
  expect(await page.locator('#chart-desc').textContent()).toContain('64 bytes');
  await scanAt('comparison — back to this page’s toy parameters');

  // ── All ten forgeries, each measured before the next replaces it ─────────
  for (const [value, label] of [
    ['w-eq-a', 'forge — w = A, rejected'],
    ['w-eq-g', 'forge — w = g, rejected'],
    ['w-eq-1', 'forge — w = 1, rejected'],
    ['w-random', 'forge — random group element, rejected'],
    ['w-steal', 'forge — a real member’s genuine witness, rejected'],
    ['w-perturb', 'forge — one bit flipped, rejected'],
    ['nm-random', 'forge — random Bezout pair, rejected'],
    ['composite', 'forge — composite representative, ACCEPTED'],
    ['trapdoor', 'forge — trapdoor, ACCEPTED'],
  ] as const) {
    await page.locator('#forge-attack').selectOption(value);
    await expect(live('Forgery attempt result').locator('.verdict')).toBeVisible();
    await scanAt(label);
  }

  // The typed-witness attack is the only state that reveals `#forge-custom`,
  // which carries the `[hidden]` attribute everywhere else — the gate this
  // replaces stripped that attribute from script rather than reaching the
  // state that clears it.
  await page.locator('#forge-attack').selectOption('w-custom');
  await expect(page.locator('#forge-custom')).toBeVisible();
  await page.locator('#forge-custom').fill('c0ffee');
  await byName('Run it against the real verifier').click();
  await expect(live('Forgery attempt result').locator('.verdict-ok')).toBeVisible();
  await scanAt('forge — a witness typed by hand');

  await page.locator('#forge-custom').fill('not-hex');
  await byName('Run it against the real verifier').click();
  await expect(live('Forgery attempt result').locator('.verdict-ok')).toBeVisible();
  await scanAt('forge — unparseable input falls back to zero');

  await byName('Run all ten and reveal').click();
  await expect(page.locator('#forge .predict-verdict').first()).toBeVisible();
  await scanAt('forge — prediction scoreboard revealed');

  await byName('Hide the answers and try again').click();
  await expect(page.locator('#forge .predict-verdict')).toHaveCount(0);
  await scanAt('forge — scoreboard hidden again');

  // ── The parameters, generated for real in this tab ───────────────────────
  await page.locator('#setup-size').selectOption('256');
  await byName('Search for fresh safe primes now').click();
  // A real safe-prime search over real candidates. Wait on its own terminal
  // verdict rather than on a clock: success repaints every panel in the new
  // parameters, an unlucky search renders the warn treatment, and both are
  // states worth scanning.
  await expect(live('Parameter generation progress').locator('.verdict')).toBeVisible({
    timeout: 300_000,
  });
  await scanAt('setup — fresh parameters generated in this tab');

  await byName('Restore the shipped parameters').click();
  await expect(live('Parameter generation progress').locator('.verdict-ok')).toContainText(
    'Shipped parameters restored'
  );
  await scanAt('setup — shipped parameters restored');

  // ── Every remaining disclosure, opened by clicking its own summary ───────
  const summaries = page.locator('#exhibits details.expert > summary');
  const total = await summaries.count();
  for (let i = 0; i < total; i++) {
    await summaries.nth(i).click();
    await expect(page.locator('#exhibits details.expert[open]')).toHaveCount(i + 1);
    await scanAt(`expert disclosure ${i + 1} of ${total} open`);
  }

  // ── The exhibit navigator, in whichever form this viewport shows ─────────
  const menu = page.locator('.labnav-select');
  if (await menu.isVisible()) {
    await menu.selectOption('compare');
    await scanAt('navigator — comparison reached through the narrow-viewport menu');
  } else {
    await page.locator('.labnav-link[href="#compare"]').click();
    await expect(page.locator('.labnav-link.is-current')).toBeVisible();
    await scanAt('navigator — comparison link followed, current link marked');
  }

  await byName('Reset demo').click();
  await expect(page.locator('.setitem')).toHaveCount(3);
  await expect(page.locator('.tour-eyebrow')).toHaveText('Guided demo · 1 / 5');
  await scanAt('lab reset from the navigator');

  reportCollected();
}
