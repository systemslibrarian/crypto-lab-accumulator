/**
 * Accumulator vs Merkle tree — measured, not asserted.
 *
 * The left column is computed from the live accumulator on this page. The right
 * column is computed from a real RFC 6962 sorted-leaf Merkle tree built over the
 * same set, with real inclusion proofs and real absence proofs. Where a number
 * is a formula rather than a measurement (the scaling chart beyond a few
 * thousand leaves) the formula is checked against the real implementation first
 * and the panel says so.
 *
 * Honesty note that this panel exists to make: the accumulator does NOT win
 * everything. At this page's toy 512-bit modulus a Merkle root is half the size
 * of the digest, and at realistic parameters the accumulator's proofs are only
 * smaller once the set passes a few thousand elements. The chart shows exactly
 * where the lines cross instead of hiding it.
 */

import { hashToPrime } from '../core/hashToPrime'
import {
  membershipProofBytes,
  membershipWitness,
  nonMembershipProofBytes,
  nonMembershipWitness,
  verifyMembership,
  verifyNonMembership,
} from '../accumulator/accumulator'
import {
  absenceProof,
  absenceProofBytes,
  compareEntries,
  inclusionProof,
  inclusionProofBytes,
  merkleRoot,
  verifyAbsence,
  verifyInclusion,
  HASH_BYTES,
} from '../merkle/merkle'
import { DEFAULT_NON_MEMBER } from '../accumulator/params'
import { add, el, panel, clear, expert, labelledSelect, liveRegion, refs, SOURCES, verdict } from './dom'
import { state } from './state'

const SVG_NS = 'http://www.w3.org/2000/svg'

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

/** Path length of an RFC 6962 audit path for a tree of n leaves. */
function pathLength(n: number): number {
  return n <= 1 ? 0 : Math.ceil(Math.log2(n))
}

export function mountCompare(root: HTMLElement): void {
  const p = panel(
    'compare',
    'Accumulator vs Merkle tree',
    'Both structures are built for real over the same set, and both kinds of proof are produced and verified. The numbers below are measurements.',
  )

  const measured = el('div', { class: 'tablewrap', tabindex: '0', role: 'group', 'aria-label': 'Measured comparison for the current set' })
  const checks = liveRegion('Verification cross-check')

  // --- scaling chart --------------------------------------------------------
  const { wrap: paramWrap, select: paramSelect } = labelledSelect('cmp-params', 'Modulus size', [
    { value: '512', text: 'This page — 512-bit toy modulus' },
    { value: '3072', text: 'Realistic — 3072-bit modulus' },
  ])
  const { wrap: repWrap, select: repSelect } = labelledSelect('cmp-rep', 'Prime representatives', [
    { value: '64', text: 'This page — 64-bit representatives' },
    { value: '256', text: 'Realistic — 256-bit representatives' },
  ])
  const { wrap: sizeWrap, select: sizeSelect } = labelledSelect('cmp-size', 'Revoked certificates', [
    { value: '1000', text: '1,000' },
    { value: '100000', text: '100,000' },
    { value: '10000000', text: '10 million' },
  ])
  const { wrap: setupWrap, select: setupSelect } = labelledSelect('cmp-setup', 'Trusted setup', [
    { value: 'yes', text: 'We can run an MPC ceremony' },
    { value: 'no', text: 'Nobody may hold p and q' },
  ])
  const { wrap: churnWrap, select: churnSelect } = labelledSelect('cmp-churn', 'Witness holders × churn', [
    { value: 'low', text: '10 holders, weekly changes' },
    { value: 'mid', text: '10,000 holders, hourly changes' },
    { value: 'high', text: '1 million holders, constant changes' },
  ])
  const chartHost = el('figure', { class: 'chart-figure' })
  const deployControls = el('div', { class: 'controls' }, paramWrap, repWrap, sizeWrap, setupWrap, churnWrap)
  const recommendation = el('div', { class: 'recommend-host' })

  for (const sel of [paramSelect, repSelect, sizeSelect, setupSelect, churnSelect]) {
    sel.addEventListener('change', () => {
      renderChart()
      renderRecommendation()
    })
  }

  const CHURN: Record<string, { holders: number; perDay: number; label: string }> = {
    low: { holders: 10, perDay: 1 / 7, label: '10 holders, about one change a week' },
    mid: { holders: 10_000, perDay: 24, label: '10,000 holders, hourly changes' },
    high: { holders: 1_000_000, perDay: 24 * 60, label: 'a million holders, a change a minute' },
  }

  /**
   * The comparison table is comprehensive; comprehensive is not the same as
   * decided. This turns the same measurements into an answer, with the two
   * inputs people forget — whether a trusted setup is even available, and what
   * it costs to keep every witness holder current — made explicit.
   */
  function renderRecommendation(): void {
    clear(recommendation)
    const modBits = Number(paramSelect.value)
    const repBits = Number(repSelect.value)
    const n = Number(sizeSelect.value)
    const setupAvailable = setupSelect.value === 'yes'
    const churn = CHURN[churnSelect.value] ?? CHURN.low!

    const accBytes = Math.ceil(modBits / 8) + Math.ceil(repBits / 8)
    const merkleBytes = 2 * pathLength(n) * HASH_BYTES + 2 * 14
    // Every change obliges every holder to refresh: the changed prime plus the
    // new digest. A Merkle holder pulls a fresh path only when it needs one.
    const perUpdate = Math.ceil(repBits / 8) + Math.ceil(modBits / 8)
    const bytesPerDay = churn.perDay * churn.holders * perUpdate

    let head: string
    let why: string
    if (!setupAvailable) {
      head = 'Use a Merkle tree.'
      why = `Without a setup nobody can subvert, an RSA accumulator is forgeable by whoever generated the modulus — and that is not a residual risk, it is a total break. Proof size stops being the deciding question. Class groups would remove the trapdoor, at a large performance cost and with far less mature implementations.`
    } else if (merkleBytes <= accBytes) {
      head = 'Use a Merkle tree here too.'
      why = `At ${n.toLocaleString()} certificates a sorted-tree absence proof is ${merkleBytes} bytes against the accumulator's ${accBytes}. The accumulator is not yet buying you anything, and it still costs a ceremony, a number-theoretic assumption and no post-quantum story.`
    } else if (bytesPerDay > 50 * 1024 * 1024) {
      head = 'The accumulator has the smaller proof — and the bigger bill.'
      why = `Its absence proof is ${accBytes} bytes against ${merkleBytes}, a ${(merkleBytes / accBytes).toFixed(1)}× saving per query. But ${churn.label} means roughly ${formatBytes(bytesPerDay)} a day of witness-update traffic, because every change obliges every holder to refresh. Merkle holders pull a path only when they need one. Batched updates (Boneh–Bünz–Fisch) exist precisely for this.`
    } else {
      head = 'Use the accumulator.'
      why = `At ${n.toLocaleString()} certificates its absence proof is ${accBytes} bytes against ${merkleBytes}, it needs no ordering over the set, and it leaks nothing about other members. Witness maintenance costs about ${formatBytes(bytesPerDay)} a day at ${churn.label}, which is affordable at this churn.`
    }

    add(
      recommendation,
      el(
        'div',
        { class: 'recommend' },
        el('span', { 'aria-hidden': 'true', class: 'verdict-icon', text: '▸' }),
        el(
          'div',
          { class: 'recommend-body' },
          el('p', { class: 'recommend-head', text: head }),
          el('p', { class: 'recommend-why', text: why }),
        ),
      ),
    )
  }

  function renderChart(): void {
    clear(chartHost)
    const modBits = Number(paramSelect.value)
    const repBits = Number(repSelect.value)
    const accMember = Math.ceil(modBits / 8)
    const accNonMember = Math.ceil(modBits / 8) + Math.ceil(repBits / 8)
    // A typical revocation entry: a serial number, ~14 bytes.
    const ENTRY_BYTES = 14

    const exps = Array.from({ length: 18 }, (_, i) => i + 3) // 2^3 … 2^20
    const rows = exps.map((k) => {
      const n = 2 ** k
      const path = pathLength(n) * HASH_BYTES
      return {
        k,
        n,
        accMember,
        accNonMember,
        merkleMember: path,
        merkleAbsence: 2 * path + 2 * ENTRY_BYTES,
      }
    })

    const maxY = Math.max(...rows.map((r) => Math.max(r.merkleAbsence, r.accNonMember))) * 1.08
    const W = 760
    const H = 380
    const M = { top: 26, right: 158, bottom: 52, left: 68 }
    const plotW = W - M.left - M.right
    const plotH = H - M.top - M.bottom
    const x = (k: number): number => M.left + ((k - exps[0]!) / (exps.at(-1)! - exps[0]!)) * plotW
    const y = (v: number): number => M.top + plotH - (v / maxY) * plotH

    const s = svg('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'chart',
      role: 'img',
      'aria-labelledby': 'chart-title chart-desc',
    })
    const title = svg('title', { id: 'chart-title' })
    title.textContent = `Proof size against set size, ${modBits}-bit modulus`
    const desc = svg('desc', { id: 'chart-desc' })
    desc.textContent = `Accumulator proofs are flat at ${accMember} bytes for membership and ${accNonMember} bytes for non-membership. Merkle proofs grow with the logarithm of the set size, from ${rows[0]!.merkleMember} bytes at 8 elements to ${rows.at(-1)!.merkleMember} bytes at about a million, and roughly double that for absence proofs. The full numbers are in the table below.`
    s.append(title, desc)

    // grid + axes (recessive)
    const gridStep = niceStep(maxY)
    for (let v = 0; v <= maxY; v += gridStep) {
      s.appendChild(svg('line', { x1: M.left, x2: M.left + plotW, y1: y(v), y2: y(v), class: 'grid' }))
      const t = svg('text', { x: M.left - 10, y: y(v) + 4, class: 'axis-label', 'text-anchor': 'end' })
      t.textContent = String(v)
      s.appendChild(t)
    }
    for (const k of exps) {
      if (k % 3 !== 0) continue
      const t = svg('text', { x: x(k), y: M.top + plotH + 22, class: 'axis-label', 'text-anchor': 'middle' })
      t.textContent = k >= 20 ? '1M' : k >= 10 ? `${2 ** k / 1024}K` : String(2 ** k)
      s.appendChild(t)
    }
    const xTitle = svg('text', { x: M.left + plotW / 2, y: H - 10, class: 'axis-title', 'text-anchor': 'middle' })
    xTitle.textContent = 'elements in the set (log scale)'
    const yTitle = svg('text', {
      x: 16,
      y: M.top + plotH / 2,
      class: 'axis-title',
      'text-anchor': 'middle',
      transform: `rotate(-90 16 ${M.top + plotH / 2})`,
    })
    yTitle.textContent = 'proof size (bytes)'
    s.append(xTitle, yTitle)

    const series: Array<{ key: keyof (typeof rows)[0]; cls: string; dash: string; label: string }> = [
      { key: 'merkleAbsence', cls: 'series-merkle', dash: '7 5', label: 'Merkle absence' },
      { key: 'merkleMember', cls: 'series-merkle', dash: '', label: 'Merkle inclusion' },
      { key: 'accNonMember', cls: 'series-acc', dash: '7 5', label: 'Accumulator absence' },
      { key: 'accMember', cls: 'series-acc', dash: '', label: 'Accumulator membership' },
    ]
    for (const ser of series) {
      const d = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(r.k).toFixed(1)} ${y(r[ser.key] as number).toFixed(1)}`).join(' ')
      s.appendChild(
        svg('path', { d, class: `line ${ser.cls}`, fill: 'none', 'stroke-dasharray': ser.dash }),
      )
    }

    // Direct labels at the line ends, nudged apart so the two flat accumulator
    // lines (64 and 72 bytes here) do not print on top of each other.
    const last = rows.at(-1)!
    const placed = series
      .map((ser) => ({ ser, y: y(last[ser.key] as number) }))
      .sort((a, b) => a.y - b.y)
    const MIN_GAP = 15
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1]!
      const cur = placed[i]!
      if (cur.y - prev.y < MIN_GAP) cur.y = prev.y + MIN_GAP
    }
    for (const { ser, y: ly } of placed) {
      const lbl = svg('text', { x: M.left + plotW + 8, y: ly + 4, class: `series-label ${ser.cls}` })
      lbl.textContent = ser.label
      s.appendChild(lbl)
    }

    // Crossover markers: where the Merkle line first exceeds the flat one. When
    // the accumulator is already ahead at the smallest plotted set, say that
    // instead of silently omitting the annotation.
    const annotated: number[] = []
    for (const [merkleKey, accKey, accValue, what] of [
      ['merkleMember', 'accMember', accMember, 'membership'],
      ['merkleAbsence', 'accNonMember', accNonMember, 'absence'],
    ] as const) {
      const idx = rows.findIndex((r) => (r[merkleKey] as number) > accValue)
      if (idx === -1) continue
      const r = rows[idx]!
      s.appendChild(svg('circle', { cx: x(r.k), cy: y(accValue), r: 5, class: `crossover ${accKey}` }))
      // Stack annotations upward when two land on nearly the same spot.
      let ly = y(accValue) - 12
      while (annotated.some((prev) => Math.abs(prev - ly) < 14)) ly -= 14
      annotated.push(ly)
      const t = svg('text', {
        x: x(r.k) + (idx === 0 ? 8 : 0),
        y: ly,
        class: 'crossover-label',
        'text-anchor': idx === 0 ? 'start' : 'middle',
      })
      t.textContent =
        idx === 0
          ? `${what}: smaller from ${r.n} elements up`
          : `${what}: crosses at ~${r.n.toLocaleString()}`
      s.appendChild(t)
    }

    const legend = el('div', { class: 'legend' })
    for (const ser of series) {
      legend.appendChild(
        el(
          'span',
          { class: 'legend-item' },
          el('span', { class: `legend-swatch ${ser.cls} ${ser.dash ? 'legend-dashed' : ''}`, 'aria-hidden': 'true' }),
          el('span', { text: ser.label }),
        ),
      )
    }

    const table = el('table', { class: 'datatable' })
    const thead = el('tr', {})
    for (const h of ['Elements', 'Accumulator membership', 'Accumulator absence', 'Merkle inclusion', 'Merkle absence']) {
      thead.appendChild(el('th', { scope: 'col', text: h }))
    }
    table.appendChild(el('thead', {}, thead))
    const tbody = el('tbody', {})
    for (const r of rows) {
      if (r.k % 2 !== 1) continue
      tbody.appendChild(
        el(
          'tr',
          {},
          el('th', { scope: 'row', text: r.n.toLocaleString() }),
          el('td', { text: `${r.accMember} B` }),
          el('td', { text: `${r.accNonMember} B` }),
          el('td', { text: `${r.merkleMember} B` }),
          el('td', { text: `${r.merkleAbsence} B` }),
        ),
      )
    }
    table.appendChild(tbody)

    chartHost.append(
      s,
      legend,
      el('figcaption', {
        class: 'note',
        text: `Merkle path length is ⌈log₂ n⌉ × 32 bytes; absence adds a second path plus the two neighbouring entries (~14 bytes each). The formula is checked against the real tree implementation below before it is plotted.`,
      }),
      expert('Show the numbers', el('div', { class: 'tablewrap', tabindex: '0', role: 'group', 'aria-label': 'Proof size table' }, table)),
    )
  }

  // --- measured comparison over the live set --------------------------------
  function renderMeasured(): void {
    clear(measured)
    clear(checks)

    const labels = state.labels
    if (labels.length === 0) {
      measured.appendChild(el('p', { class: 'note', text: 'The set is empty — add an element to compare.' }))
      return
    }
    const sorted = [...labels].sort(compareEntries)
    const root_ = merkleRoot(sorted)

    const member = labels[0]!
    const absent = state.has(DEFAULT_NON_MEMBER) ? `${DEFAULT_NON_MEMBER}-absent` : DEFAULT_NON_MEMBER

    const memWit = membershipWitness(state.params, state.primes, hashToPrime(member).prime)
    const nonWit = nonMembershipWitness(state.params, state.primes, hashToPrime(absent).prime)
    const inc = inclusionProof(sorted, sorted.indexOf(member))
    const abs = absenceProof(sorted, absent)

    const t = (fn: () => unknown, iters = 200): string => {
      const t0 = performance.now()
      for (let i = 0; i < iters; i++) fn()
      return `${(((performance.now() - t0) / iters) * 1000).toFixed(0)} µs`
    }

    const rows: Array<[string, string, string]> = [
      ['Digest published', `${state.modulusBytes} bytes`, `${HASH_BYTES} bytes`],
      [
        'Membership proof',
        `${membershipProofBytes(state.params, memWit)} bytes`,
        `${inclusionProofBytes(inc)} bytes (${inc.path.length} hashes)`,
      ],
      [
        'Non-membership proof',
        `${nonMembershipProofBytes(state.params, nonWit)} bytes`,
        `${absenceProofBytes(abs)} bytes (2 paths + 2 entries)`,
      ],
      [
        'Verify membership',
        t(() => verifyMembership(state.params, state.A, memWit)),
        t(() => verifyInclusion(member, inc, root_)),
      ],
      [
        'Verify non-membership',
        t(() => verifyNonMembership(state.params, state.A, nonWit)),
        t(() => verifyAbsence(absent, abs, root_)),
      ],
      ['Add one element', '1 exponentiation on the digest', 'rebuild ⌈log₂ n⌉ nodes, re-sort if needed'],
      ['Delete one element', 'recompute over the set, or 1 exponentiation with the trapdoor', 'rebuild the path'],
      ['Old proofs after a change', 'all invalid — every holder must update', 'all invalid — but refetching is cheap and stateless'],
      ['Set must be ordered', 'no', 'yes, for absence proofs'],
      ['What a proof reveals', 'nothing beyond the claim', 'two real members, for every absence proof'],
      ['Security assumption', 'Strong RSA', 'collision-resistant hash'],
      ['Trusted setup', 'required — whoever knows p, q forges anything', 'none'],
      ['Post-quantum', 'no — Shor factors N', 'yes, with a suitable hash'],
    ]

    const table = el('table', { class: 'datatable' })
    table.appendChild(
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col', text: `For this set (${labels.length} elements)` }),
          el('th', { scope: 'col', class: 'col-acc', text: 'RSA accumulator' }),
          el('th', { scope: 'col', class: 'col-merkle', text: 'Merkle tree (sorted)' }),
        ),
      ),
    )
    const tbody = el('tbody', {})
    for (const [k, a, b] of rows) {
      tbody.appendChild(
        el('tr', {}, el('th', { scope: 'row', text: k }), el('td', { text: a }), el('td', { text: b })),
      )
    }
    table.appendChild(tbody)
    measured.appendChild(table)

    // Cross-check: both structures really do accept their own proofs, and the
    // path-length formula the chart plots really matches the implementation.
    const bothVerify =
      verifyMembership(state.params, state.A, memWit).ok &&
      verifyNonMembership(state.params, state.A, nonWit).ok &&
      verifyInclusion(member, inc, root_) &&
      verifyAbsence(absent, abs, root_)

    const formulaSizes = [8, 64, 512]
    const formulaOk = formulaSizes.every((n) => {
      const synthetic = Array.from({ length: n }, (_, i) => `e${String(i).padStart(5, '0')}`)
      return inclusionProof(synthetic, 0).path.length === pathLength(n)
    })

    checks.append(
      bothVerify
        ? verdict('ok', 'All four proofs verified', 'the table above is measured from proofs that actually check out')
        : verdict('alarm', 'A proof failed to verify', 'this would be a bug'),
      formulaOk
        ? verdict('ok', 'Path-length formula confirmed', `⌈log₂ n⌉ matches the real tree at n = ${formulaSizes.join(', ')}`)
        : verdict('alarm', 'Formula mismatch', 'the chart would be wrong'),
    )
  }

  const howComputed = expert(
    'How these numbers were produced',
    el(
      'ul',
      { class: 'rules' },
      el('li', {}, 'Proof sizes: the real witnesses, serialised. One group element for membership; a group element plus the reduced Bezout coefficient for absence; ⌈log₂ n⌉ sibling hashes for a Merkle path, doubled plus both neighbouring entries for an absence proof.'),
      el('li', {}, 'Timings: each verifier run 200 times in this tab and averaged, on the live set. They will differ on your machine — that is the point of measuring rather than quoting.'),
      el('li', {}, 'The chart plots ⌈log₂ n⌉ × 32 bytes for Merkle paths, and that formula is re-checked against the real tree at n = 8, 64 and 512 every time this panel renders. If it ever disagreed, the line above would say so.'),
      el('li', {}, 'The recommendation multiplies the per-change update payload (changed prime + new digest) by holders × changes per day. It assumes every holder must be reached; batching changes that number, and is out of scope here.'),
    ),
  )

  p.append(
    el('h3', { text: 'Describe your deployment' }),
    deployControls,
    recommendation,
    measured,
    checks,
    howComputed,
    el('h3', { text: 'How the two scale' }),
    chartHost,
    expert(
      'Reading the crossover honestly',
      el(
        'p',
        {},
        'On this page the accumulator digest is 64 bytes and a Merkle root is 32 — the Merkle ',
        'tree is smaller. Switch the chart to realistic parameters and the accumulator digest ',
        'becomes 384 bytes, and its proofs only overtake Merkle proofs somewhere past a few ',
        'thousand elements. Constant-size beats logarithmic eventually, but "eventually" is a ',
        'real number and it is worth knowing it.',
      ),
      el(
        'p',
        {},
        'Where the accumulator is unambiguously better is the ',
        el('em', { text: 'shape' }),
        ' of the non-membership answer: one small proof, no ordering requirement on the set, ',
        'nothing leaked about other members, and a verifier that never has to reason about ',
        'adjacency. Where it is unambiguously worse is everything around it: a trusted setup, ',
        'a number-theoretic assumption instead of a hash, no post-quantum story, and witnesses ',
        'that every holder must keep updated.',
      ),
      el('p', {
        class: 'note',
        text: 'The Merkle side is a real RFC 6962 implementation with its own unit tests, including a test that a non-adjacent pair of genuine inclusion proofs is rejected as an absence proof.',
      }),
      refs([SOURCES.rfc6962, SOURCES.bbf]),
    ),
  )

  root.appendChild(p)
  state.subscribe(renderMeasured)
  renderMeasured()
  renderChart()
  renderRecommendation()
}

function niceStep(max: number): number {
  const raw = max / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag
  return 10 * mag
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${Math.round(n)} bytes`
}
