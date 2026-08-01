/**
 * Non-membership — the thing a Merkle root cannot do cheaply, and the reason
 * this construction exists for revocation.
 *
 * The panel shows the Bezout identity as an identity: the actual integers a and
 * b such that a·u + b·x = 1, then the same statement evaluated in the exponent
 * where the verifier can check it without ever learning u.
 */

import { bitLength, egcd, gcd } from '../core/bigint'
import { hashToPrime } from '../core/hashToPrime'
import {
  exponentProduct,
  nonMembershipProofBytes,
  nonMembershipWitness,
  verifyNonMembership,
} from '../accumulator/accumulator'
import {
  el,
  panel,
  button,
  clear,
  elide,
  expert,
  hexBlock,
  hexDiff,
  hexOf,
  labelledInput,
  liveRegion,
  refs,
  SOURCES,
  stat,
  toySizeNote,
  verdict,
} from './dom'
import { DEFAULT_NON_MEMBER } from '../accumulator/params'
import { state } from './state'

export function mountNonMembership(root: HTMLElement): void {
  const p = panel(
    'nonmembership',
    'Non-membership proof — “I am NOT in the set”',
    'Two integers, a and b, with a·u + b·x = 1. That equation can only be solved when x shares no factor with the product — which is precisely the claim being proved.',
  )

  const { wrap, input } = labelledInput(
    'nonmem-el',
    'Prove absence of',
    DEFAULT_NON_MEMBER,
    { size: '28', 'aria-describedby': 'nonmem-hint' },
  )
  const hint = el('p', {
    id: 'nonmem-hint',
    class: 'note',
    text: 'Any text works — it gets hashed to a prime. Try a serial that is in the set to see the proof become impossible.',
  })
  const out = liveRegion('Non-membership proof result')
  const controls = el('div', { class: 'controls' }, wrap, button('Build witness and verify', run))
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') run()
  })

  function run(): void {
    clear(out)
    const label = input.value.trim()
    if (!label) {
      out.appendChild(verdict('warn', 'Type something to prove absent'))
      return
    }
    const rep = hashToPrime(label)
    const x = rep.prime
    const primes = state.primes
    const u = exponentProduct(primes)
    const common = gcd(x, u)
    const width = state.modulusBytes

    const facts = el(
      'div',
      { class: 'statrow' },
      stat('Element', label),
      stat('Prime x', x.toString()),
      stat('gcd(x, u)', common.toString(), common === 1n ? 'ok' : 'alarm'),
    )
    out.appendChild(facts)

    if (common !== 1n) {
      out.append(
        verdict(
          'ok',
          'No proof of absence exists',
          `x divides u, so "${label}" is in the set — the maths refuses to lie about it`,
        ),
        el('p', {
          class: 'note',
          text: `Bezout needs gcd(x, u) = 1. Here the gcd is ${common}, i.e. x itself. There are no integers a and b with a·u + b·x = 1, so no witness can be constructed by anyone — including someone holding the trapdoor.`,
        }),
      )
      return
    }

    const bez = egcd(u, x)
    const witness = nonMembershipWitness(state.params, primes, x)
    const result = verifyNonMembership(state.params, state.A, witness)

    out.append(
      el('h3', { text: 'Step 1 — solve  a·u + b·x = 1  over the integers' }),
      el(
        'div',
        { class: 'identity' },
        el('p', { class: 'identity-line', text: `a = ${elide(bez.x.toString(), 30, 20)}` }),
        el('p', { class: 'identity-line', text: `b = ${elide(bez.y.toString(), 30, 20)}` }),
        el('p', {
          class: 'note',
          text: `Extended Euclid, run on the real ${bitLength(u)}-bit product. Checked: a·u + b·x = ${(bez.x * u + bez.y * x).toString()}.`,
        }),
      ),
      el('h3', { text: 'Step 2 — hide it in the exponent' }),
      el('p', {
        class: 'note',
        text: `The witness is (a, d) with d = g^b mod N. a is reduced into [0, x) so it fits in ${Math.ceil(bitLength(witness.a) / 8)} bytes; the overflow is absorbed by d. The verifier gets these two values and nothing else — u is never transmitted.`,
      }),
      el(
        'div',
        { class: 'statrow' },
        stat('a (reduced)', witness.a.toString(), 'ok'),
        stat('d', `${width}-byte group element`, 'ok', true),
        stat('Proof size', `${nonMembershipProofBytes(state.params, witness)} bytes`, 'ok', true),
        stat('u withheld', `${bitLength(u)} bits never sent`),
      ),
      hexBlock(hexOf(witness.d, width), `Non-membership witness element d for ${label}`),
      el('h3', { text: 'Step 3 — verify  A^a · d^x mod N  ==  g' }),
      hexDiff(hexOf(result.lhs, width), hexOf(result.rhs, width), 'A^a · d^x mod N', 'generator g'),
      result.ok
        ? verdict('ok', 'Verified absent', `"${label}" is provably not in the accumulated set`)
        : verdict('alarm', 'Rejected', 'the identity did not close'),
      el('p', {
        class: 'note',
        text: 'Substitute A = g^u and d = g^b and the left-hand side is g^(a·u + b·x) = g¹. The verifier is checking Bezout without being able to see either coefficient’s effect on u.',
      }),
      toySizeNote(),
    )
  }

  p.append(
    controls,
    hint,
    out,
    expert(
      'Why this is the interesting half',
      el(
        'p',
        {},
        'A Merkle tree proves membership beautifully and proves absence badly. To show that x ',
        'is missing from a Merkle set you must keep the leaves sorted, then produce inclusion ',
        'proofs for the two leaves that bracket x and argue they are adjacent — two logarithmic ',
        'paths, plus the neighbours themselves, plus a total order the set may not naturally ',
        'have, plus the privacy cost of revealing two real members. The comparison panel ',
        'measures all of that against the fixed-size pair above.',
      ),
      el(
        'p',
        {},
        'Li, Li and Xue called an accumulator that answers both questions ',
        el('em', { text: 'universal' }),
        ' (ACNS 2007), building on the dynamic accumulator of Camenisch and Lysyanskaya ',
        '(CRYPTO 2002). The membership side goes back to Benaloh and de Mare (EUROCRYPT 1993).',
      ),
      refs([SOURCES.li, SOURCES.camenisch, SOURCES.benaloh]),
    ),
  )
  root.appendChild(p)
  state.subscribe(run)
  run()
}
