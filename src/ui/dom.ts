/** Tiny DOM helpers. No framework — the crypto is the interesting part. */

type Attrs = Record<string, string | number | boolean | undefined>
type Child = Node | string | null | undefined | Child[]

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (k === 'class') node.className = String(v)
    else if (k === 'text') node.textContent = String(v)
    else if (k === 'html') node.innerHTML = String(v)
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  append(node, children)
  return node
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined) continue
    if (Array.isArray(c)) append(parent, c)
    else parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
}

/** Append children to an existing node, skipping null/undefined. */
export function add(parent: Node, ...children: Child[]): void {
  append(parent, children)
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

/** A titled panel. Every exhibit is one of these. */
export function panel(id: string, heading: string, lede?: string): HTMLElement {
  const section = el('section', { class: 'panel', id, 'aria-labelledby': `${id}-h` })
  section.appendChild(el('h2', { id: `${id}-h`, text: heading }))
  if (lede) section.appendChild(el('p', { class: 'panel-lede', text: lede }))
  return section
}

/** Collapsed depth for the expert reader — progressive disclosure, §2.3. */
export function expert(summary: string, ...children: Child[]): HTMLDetailsElement {
  const d = el('details', { class: 'expert' })
  d.appendChild(el('summary', { text: summary }))
  append(d, children)
  return d
}

/**
 * A monospace big-number display. Scrollable regions get tabindex + role +
 * label because axe (rightly) fails a keyboard-unreachable scroll container.
 */
export function hexBlock(text: string, label: string, extra = ''): HTMLElement {
  return el(
    'div',
    {
      class: `hexblock ${extra}`.trim(),
      tabindex: '0',
      role: 'group',
      'aria-label': label,
    },
    el('span', { class: 'hex', text }),
  )
}

/**
 * State readout. WCAG 1.4.1: never colour alone — every verdict is
 * icon + word + colour, and the icon is aria-hidden so the word carries it.
 *
 * `tone` tracks SYSTEM INTEGRITY, not the boolean: a forgery that the verifier
 * *accepted* is `alarm`, even though the function returned true.
 */
export type Tone = 'ok' | 'alarm' | 'warn' | 'idle'

const ICONS: Record<Tone, string> = { ok: '✓', alarm: '✗', warn: '!', idle: '·' }

export function verdict(tone: Tone, label: string, detail?: string): HTMLElement {
  return el(
    'p',
    { class: `verdict verdict-${tone}` },
    el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: ICONS[tone] }),
    el('strong', { text: label }),
    detail ? el('span', { class: 'verdict-detail', text: ` — ${detail}` }) : null,
  )
}

/**
 * The toy-parameter marker.
 *
 * Every size this page reports is real, and every one of them is measured at
 * parameters chosen for a browser tab rather than for security. A bare "72
 * bytes" reads as a deployment claim, so any figure that would change at
 * production parameters carries this badge and the sentence below it.
 */
export const TOY_SIZE_TITLE =
  'Measured at this page’s toy parameters: a 512-bit modulus and 64-bit prime representatives. ' +
  'Production parameters (3072-bit modulus, 256-bit representatives) make every group element 384 bytes.'

export function toyTag(): HTMLElement {
  return el('span', { class: 'tag-toy', title: TOY_SIZE_TITLE, text: 'TOY' })
}

/** The standard one-liner, so the caveat is worded identically everywhere. */
export function toySizeNote(): HTMLElement {
  return el(
    'p',
    { class: 'note' },
    'Every size in this panel is measured at this page’s toy parameters — a 512-bit modulus and ' +
      '64-bit prime representatives (marked ',
    toyTag(),
    '). At production parameters a group element is 384 bytes and a representative 32: the proofs ' +
      'stay fixed-size, they are just bigger. The comparison panel switches between the two.',
  )
}

/**
 * A small labelled fact. Used everywhere for "u is 217 bits" style readouts.
 * Pass `toy` for any value that would change at production parameters.
 */
export function stat(label: string, value: string, tone: Tone = 'idle', toy = false): HTMLElement {
  return el(
    'div',
    { class: `stat stat-${tone}` },
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value' }, value, toy ? ' ' : null, toy ? toyTag() : null),
  )
}

/** A labelled proportional bar. `max` is the 100% reference. */
export function meter(label: string, value: number, max: number, unit: string): HTMLElement {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return el(
    'div',
    { class: 'meter' },
    el(
      'div',
      { class: 'meter-head' },
      el('span', { class: 'meter-label', text: label }),
      el('span', { class: 'meter-value', text: `${value.toLocaleString()} ${unit}` }),
    ),
    el(
      'div',
      {
        class: 'meter-track',
        role: 'img',
        'aria-label': `${label}: ${value.toLocaleString()} ${unit} of ${max.toLocaleString()} ${unit} shown`,
      },
      el('div', { class: 'meter-fill', style: `width:${pct}%` }),
    ),
  )
}

/** A live region for async / on-click results. */
export function liveRegion(label: string): HTMLElement {
  return el('div', {
    class: 'live',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': label,
  })
}

export function button(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `btn ${extra}`.trim(), text: label })
  b.addEventListener('click', onClick)
  return b
}

export function labelledInput(
  id: string,
  labelText: string,
  value: string,
  attrs: Attrs = {},
): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { type: 'text', id, value, ...attrs })
  const wrap = el('div', { class: 'ctl' }, el('label', { class: 'ctl-label', for: id, text: labelText }), input)
  return { wrap, input }
}

export function labelledSelect(
  id: string,
  labelText: string,
  options: Array<{ value: string; text: string }>,
): { wrap: HTMLElement; select: HTMLSelectElement } {
  const select = el('select', { id })
  for (const o of options) select.appendChild(el('option', { value: o.value, text: o.text }))
  const wrap = el('div', { class: 'ctl' }, el('label', { class: 'ctl-label', for: id, text: labelText }), select)
  return { wrap, select }
}

/** Truncate a very long decimal/hex string for display, middle-elided. */
export function elide(s: string, head = 24, tail = 16): string {
  if (s.length <= head + tail + 3) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

/** Fixed-width hex for a bigint, padded to the modulus width. */
export function hexOf(n: bigint, byteWidth: number): string {
  return n.toString(16).padStart(byteWidth * 2, '0')
}

/**
 * Render two hex strings with the differing nibbles marked. Used for the
 * compute-both-sides-and-compare readouts (§2) — equality is *shown*, not
 * asserted, and the marks are visible in greyscale because they are boxed.
 */
export function hexDiff(a: string, b: string, labelA: string, labelB: string): HTMLElement {
  const width = Math.max(a.length, b.length)
  let differing = 0
  for (let i = 0; i < width; i++) if (a[i] !== b[i]) differing++
  // Marking every nibble when the two values are unrelated turns the whole
  // block into noise, so past a third different we say so in words instead and
  // tint the block as a unit.
  const perNibble = differing > 0 && differing <= width / 3

  const wrap = el('div', { class: 'hexdiff' })
  for (const [text, label] of [
    [a, labelA],
    [b, labelB],
  ] as const) {
    const row = el('div', { class: 'hexdiff-row' })
    row.appendChild(el('span', { class: 'hexdiff-label', text: label }))
    const box = el('div', {
      class: `hexblock ${differing === 0 ? 'hexblock-same' : 'hexblock-differs'}`,
      tabindex: '0',
      role: 'group',
      'aria-label': `${label}, ${text.length * 4} bit value`,
    })
    const span = el('span', { class: 'hex' })
    if (perNibble) {
      const other = text === a ? b : a
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!
        if (other[i] !== ch) span.appendChild(el('mark', { class: 'nib', text: ch }))
        else span.appendChild(document.createTextNode(ch))
      }
    } else {
      span.textContent = text
    }
    box.appendChild(span)
    row.appendChild(box)
    wrap.appendChild(row)
  }
  wrap.appendChild(
    el('p', {
      class: `hexdiff-summary ${differing === 0 ? 'hexdiff-equal' : 'hexdiff-unequal'}`,
      text:
        differing === 0
          ? `Byte for byte identical — all ${width} hex digits match.`
          : `${differing} of ${width} hex digits differ.`,
    }),
  )
  return wrap
}

export interface Reference {
  authors: string
  title: string
  venue: string
  /** A link we are actually confident resolves. */
  href?: string
}

/**
 * Sources at the point of use. A reviewer should be able to check which
 * construction a panel is demonstrating without leaving the page.
 *
 * Where a stable primary link exists (an RFC, an IACR eprint, a NIST DOI) it is
 * given directly. For the LNCS conference papers we link a DBLP title search
 * rather than invent a DOI suffix — a wrong identifier would be worse than an
 * extra click.
 */
export function refs(items: Reference[]): HTMLElement {
  const ul = el('ul', { class: 'refs' })
  for (const item of items) {
    const href = item.href ?? `https://dblp.org/search?q=${encodeURIComponent(item.title)}`
    ul.appendChild(
      el(
        'li',
        {},
        `${item.authors}, `,
        el('cite', { text: item.title }),
        `. ${item.venue}. `,
        el('a', { href, target: '_blank', rel: 'noopener', text: item.href ? 'Read it' : 'Find it (DBLP)' }),
      ),
    )
  }
  return ul
}

export const SOURCES = {
  benaloh: {
    authors: 'J. Benaloh and M. de Mare',
    title: 'One-Way Accumulators: A Decentralized Alternative to Digital Signatures',
    venue: 'EUROCRYPT 1993',
  },
  baric: {
    authors: 'N. Baric and B. Pfitzmann',
    title: 'Collision-Free Accumulators and Fail-Stop Signature Schemes Without Trees',
    venue: 'EUROCRYPT 1997',
  },
  camenisch: {
    authors: 'J. Camenisch and A. Lysyanskaya',
    title: 'Dynamic Accumulators and Application to Efficient Revocation of Anonymous Credentials',
    venue: 'CRYPTO 2002',
  },
  li: {
    authors: 'J. Li, N. Li and R. Xue',
    title: 'Universal Accumulators with Efficient Nonmembership Proofs',
    venue: 'ACNS 2007',
  },
  bbf: {
    authors: 'D. Boneh, B. Bunz and B. Fisch',
    title: 'Batching Techniques for Accumulators with Applications to IOPs and Stateless Blockchains',
    venue: 'CRYPTO 2019',
    href: 'https://eprint.iacr.org/2018/1188',
  },
  rfc6962: {
    authors: 'B. Laurie, A. Langley and E. Kasper',
    title: 'Certificate Transparency',
    venue: 'RFC 6962',
    href: 'https://www.rfc-editor.org/rfc/rfc6962',
  },
  fips180: {
    authors: 'NIST',
    title: 'Secure Hash Standard (SHS)',
    venue: 'FIPS 180-4',
    href: 'https://doi.org/10.6028/NIST.FIPS.180-4',
  },
} as const satisfies Record<string, Reference>
