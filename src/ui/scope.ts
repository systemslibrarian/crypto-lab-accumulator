/**
 * Honest scoping (§0.2). What is real, what is a toy, what this page does not
 * prove, and what it deliberately does not build.
 */

import { el, panel, expert, refs, SOURCES } from './dom'

export function mountScope(root: HTMLElement): void {
  const p = panel('scope', 'What is real here, and what is not')

  const grid = el('div', { class: 'grid-2' })

  const real = el('div', { class: 'cell' })
  real.appendChild(el('h3', { text: 'Real' }))
  real.appendChild(
    list([
      'Every modular exponentiation, modular inverse and extended-Euclid run is genuine BigInt arithmetic, hand-written in src/core/ so you can read it.',
      'The accumulator, both witness types and all four witness-update rules are the published constructions — Benaloh–de Mare 1993, Baric–Pfitzmann 1997, Camenisch–Lysyanskaya 2002, Li–Li–Xue 2007.',
      'Hash-to-prime is SHA-256 with a domain-separated counter, and the primes it returns are Miller-Rabin tested.',
      'The Merkle comparison is a real RFC 6962 sorted-leaf tree with real inclusion and absence proofs; the sizes and timings in that table are measured on this page, not quoted.',
      'The forgeries are fed to the same verifier the honest panels use. Nothing is special-cased.',
      'The safe-prime generator really searches for safe primes. The counter is the real number of candidates it drew.',
    ]),
  )

  const notReal = el('div', { class: 'cell' })
  notReal.appendChild(el('h3', { text: 'Toy — and why' }))
  notReal.appendChild(
    list([
      'The modulus is 512 bits. RSA-512 was factored in 1999 and falls in hours today. It is this small so every exponentiation on the page finishes instantly; a realistic 3072-bit modulus is roughly two hundred times slower.',
      'This page knows p and q, because it generated them. Soundness of an RSA accumulator requires that nobody does. The forgery panel demonstrates exactly what that costs.',
      'Prime representatives are 64 bits, so a birthday collision is only about 2³² work — and a collision is a forgery. Real systems use around 256 bits.',
      'Nothing here is constant-time or side-channel hardened. It does not need to be — every input is public — but do not lift this code.',
      'There is no network, no server and no persistence. The set lives in this tab and dies with it.',
    ]),
  )

  grid.append(real, notReal)

  const doesNot = el('div', { class: 'cell' })
  doesNot.appendChild(el('h3', { text: 'What this page does NOT prove' }))
  doesNot.appendChild(
    list([
      'That RSA accumulators are secure. Their soundness rests on the Strong RSA assumption, which is an assumption; watching correct arithmetic is not evidence for it.',
      'That a witness is fresh. A proof is about a digest, not about a moment in time. Freshness still needs a signature and a validity window, exactly as CRLs do.',
      'That an accumulator is the right choice for your problem. The comparison panel shows several axes where a Merkle tree is simply better.',
      'Anything about zero knowledge. Witnesses here reveal that a specific element is or is not in a specific set, and a membership witness is a function of every other member.',
    ]),
  )

  p.append(grid, doesNot)

  p.appendChild(
    expert(
      'Deliberately not built',
      list([
        'Pairing-based accumulators (Nguyen 2005 and descendants) — constant-size proofs with no trapdoor-holding manager needed for updates, but they need a bilinear pairing and their own trusted setup with a size bound fixed in advance.',
        'Batched updates and batched proofs (Boneh–Bünz–Fisch 2019), which make witness maintenance and multi-element proofs practical at scale, and are what make accumulators interesting for stateless blockchain clients.',
        'Zero-knowledge accumulator proofs — proving membership without revealing which element, the form used in anonymous credential revocation.',
        'Any real key or certificate parsing. The "certificates" here are strings.',
      ]),
    ),
  )

  p.appendChild(
    expert(
      'Every construction on this page, with sources',
      refs([
        SOURCES.benaloh,
        SOURCES.baric,
        SOURCES.camenisch,
        SOURCES.li,
        SOURCES.bbf,
        SOURCES.rfc6962,
        SOURCES.fips180,
      ]),
    ),
  )

  p.appendChild(
    el(
      'p',
      { class: 'honesty' },
      el('strong', { text: 'Not production cryptography.' }),
      ' This is a teaching demo. It is correct about the mathematics and dishonest about ',
      'nothing, but the parameters are chosen for a browser tab and the trapdoor is sitting ',
      'right there in the source.',
    ),
  )

  root.appendChild(p)
}

function list(items: string[]): HTMLElement {
  const ul = el('ul', { class: 'rules' })
  for (const i of items) ul.appendChild(el('li', { text: i }))
  return ul
}
