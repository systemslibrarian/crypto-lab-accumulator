import { el, panel, expert } from './dom'

/**
 * The plain-language on-ramp (§2: "a plain-language what-is-X / why-it-matters
 * intro on every demo — the single highest-leverage fix"). Zero math, zero hex,
 * before anything else on the page.
 */
export function mountIntro(root: HTMLElement): void {
  const p = panel('intro', 'What is an accumulator?')

  p.appendChild(
    el(
      'p',
      {},
      'Suppose you have to publish a list — every revoked credit card, every ',
      'stolen certificate, every banned key — and millions of people need to check it. ',
      'Publishing the whole list is expensive and it keeps growing. Publishing a hash of ',
      'the list is small, but then nobody can check anything without downloading the list ',
      'anyway.',
    ),
  )
  p.appendChild(
    el(
      'p',
      {},
      'A ',
      el('strong', { text: 'cryptographic accumulator' }),
      ' is a third option: a single fixed-size number that stands for the whole set. Three ',
      'items or three million, it is the same number of bytes. Anyone holding a short ',
      el('strong', { text: 'witness' }),
      ' can prove to you that their item is in the set — or, and this is the part a Merkle ',
      'tree struggles with, that their item is ',
      el('em', { text: 'not' }),
      ' in it.',
    ),
  )
  p.appendChild(
    el(
      'p',
      {},
      'That second ability is what certificate revocation actually needs. Your browser does ',
      'not want to know which certificates were revoked. It wants to know that ',
      el('em', { text: 'this one' }),
      ' was not. On this page you can build the set, watch the digest change without growing, ',
      'produce both kinds of proof against the real arithmetic, and then try to forge them.',
    ),
  )

  const glossary = el('dl', { class: 'glossary' })
  const terms: Array<[string, string]> = [
    ['Set', 'The things being accumulated. Here: certificate serial numbers on a revocation list.'],
    [
      'Digest (A)',
      'The one number that commits to the whole set. Constant size — 512 bits on this page — no matter how many elements it holds.',
    ],
    [
      'Witness',
      'The short proof one party keeps about one element. A membership witness proves "I am in the set"; a non-membership witness proves "I am not".',
    ],
    [
      'Prime representative',
      'Elements are text; the maths needs numbers. Each label is hashed to a distinct odd prime, and the digest is the generator raised to the product of those primes.',
    ],
    [
      'Trapdoor',
      'The factorisation of the modulus. Whoever knows it can forge any witness, which is why real deployments must generate the modulus so that nobody keeps it.',
    ],
  ]
  for (const [term, def] of terms) {
    glossary.appendChild(el('dt', { text: term }))
    glossary.appendChild(el('dd', { text: def }))
  }

  p.appendChild(expert('Jargon, defined before it is used', glossary))

  p.appendChild(
    el(
      'p',
      { class: 'honesty' },
      el('strong', { text: 'Not production cryptography.' }),
      ' Every number below is genuinely computed — no simulated maths anywhere — but the ',
      'modulus is a 512-bit toy chosen so the page stays instant, and this page knows its own ',
      'factorisation. Both of those would be fatal in a real deployment, and both are ',
      'demonstrated rather than glossed over further down.',
    ),
  )

  root.appendChild(p)
}
