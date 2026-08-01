/**
 * Membership proof: compute both sides and compare, never assert (§2).
 * The panel prints w^e mod N and A as two hex strings with differing nibbles
 * marked, so equality is something you can see rather than something the page
 * claims.
 */

import { bitLength } from '../core/bigint'
import { hashToPrime } from '../core/hashToPrime'
import {
  exponentProduct,
  membershipProofBytes,
  membershipWitness,
  verifyMembership,
} from '../accumulator/accumulator'
import {
  el,
  panel,
  button,
  clear,
  hexBlock,
  hexDiff,
  hexOf,
  labelledInput,
  labelledSelect,
  liveRegion,
  stat,
  verdict,
  expert,
  refs,
  SOURCES,
} from './dom'
import { state } from './state'

export function mountMembership(root: HTMLElement): void {
  const p = panel(
    'membership',
    'Membership proof — “I am in the set”',
    'The witness is the same product with your own factor left out. Putting it back has to reproduce the digest exactly.',
  )

  const { wrap: selWrap, select } = labelledSelect('mem-el', 'Prove membership of', [])
  const controls = el('div', { class: 'controls' }, selWrap)
  const out = liveRegion('Membership proof result')

  controls.appendChild(button('Build witness and verify', run))
  select.addEventListener('change', run)

  function run(): void {
    clear(out)
    const label = select.value
    if (!label) {
      out.appendChild(verdict('warn', 'Set is empty', 'add an element in the dynamic-set panel first'))
      return
    }
    const rep = hashToPrime(label)
    const primes = state.primes
    const u = exponentProduct(primes)

    let witness
    try {
      witness = membershipWitness(state.params, primes, rep.prime)
    } catch (err) {
      out.appendChild(
        verdict('ok', 'No witness exists', (err as Error).message + ' — the library refused to invent one'),
      )
      return
    }

    const result = verifyMembership(state.params, state.A, witness)
    const width = state.modulusBytes

    out.append(
      el(
        'div',
        { class: 'statrow' },
        stat('Element', label),
        stat('Prime e', rep.prime.toString()),
        stat('Cofactor u/e', `${bitLength(u / rep.prime)} bits`),
        stat('Witness size', `${membershipProofBytes(state.params, witness)} bytes`, 'ok'),
        stat('Verify cost', '1 modular exponentiation'),
      ),
      el('h3', { text: 'The witness  w = g^(u/e) mod N' }),
      hexBlock(hexOf(witness.w, width), `Membership witness for ${label}`),
      el('h3', { text: 'The check  w^e mod N  ==  A' }),
      hexDiff(hexOf(result.lhs, width), hexOf(result.rhs, width), 'w^e mod N', 'digest A'),
      result.ok
        ? verdict('ok', 'Verified', `every one of the ${width * 2} hex digits matches — ${label} is provably in the set`)
        : verdict('alarm', 'Rejected', 'the recomputed value is not the published digest'),
      el('p', {
        class: 'note',
        text: `The verifier used only the published digest, the element label, and ${membershipProofBytes(state.params, witness)} bytes of witness. It never saw the set, and it never saw u (${bitLength(u)} bits of it).`,
      }),
    )
  }

  // --- fail-closed demonstration -------------------------------------------
  const tryBox = el('div', { class: 'subpanel' })
  const { wrap: tryWrap, input: tryInput } = labelledInput(
    'mem-try',
    'Ask for a membership witness for something that is NOT in the set',
    'cert:SN-0xD4A9',
  )
  const tryOut = liveRegion('Non-member witness attempt')
  tryBox.append(
    el('h3', { text: 'What happens when the element is not there?' }),
    el('div', { class: 'controls' }, tryWrap, button('Try to build a witness', tryRun, 'btn-quiet')),
    tryOut,
  )

  function tryRun(): void {
    clear(tryOut)
    const label = tryInput.value.trim()
    if (!label) {
      tryOut.appendChild(verdict('warn', 'Type a label first'))
      return
    }
    const rep = hashToPrime(label)
    const u = exponentProduct(state.primes)
    try {
      const w = membershipWitness(state.params, state.primes, rep.prime)
      const r = verifyMembership(state.params, state.A, w)
      tryOut.appendChild(
        verdict(
          r.ok ? 'warn' : 'alarm',
          r.ok ? 'That element IS in the set' : 'Unexpected',
          r.ok ? 'so of course a witness exists — pick something absent' : 'this should not happen',
        ),
      )
    } catch (err) {
      tryOut.append(
        verdict('ok', 'Fails closed', (err as Error).message),
        el('p', {
          class: 'note',
          text: `The witness would have to be g^(u/e), and u/e is not an integer: e = ${rep.prime} does not divide u. There is nothing to round off and nothing to approximate — the honest prover simply cannot produce one.`,
        }),
        el('p', {
          class: 'note',
          text: `u mod e = ${(u % rep.prime).toString()}, and it would have to be 0.`,
        }),
      )
    }
  }

  p.append(
    controls,
    out,
    expert(
      'Where does the security come from?',
      el(
        'p',
        {},
        'From the Strong RSA assumption: given a random group element A and a prime e, it is ',
        'hard to find any w with w^e = A unless you already know an e-th root — which the ',
        'honest prover does, because they hold g^(u/e) and e divides u. Baric and Pfitzmann ',
        'showed in 1997 that this is exactly what makes the accumulator collision-free, and ',
        'why every element must map to a ',
        el('em', { text: 'prime' }),
        '. The forgery panel below lets you break it by handing the verifier a composite.',
      ),
      el(
        'p',
        {},
        'Note what the witness does ',
        el('em', { text: 'not' }),
        ' hide: it is g raised to the product of everyone else’s primes, so two members who ',
        'compare witnesses learn something about each other. Accumulators are commitments, ',
        'not zero-knowledge proofs. Layering ZK on top is a real construction and an explicit ',
        'non-goal here.',
      ),
      refs([SOURCES.baric, SOURCES.benaloh]),
    ),
    tryBox,
  )
  root.appendChild(p)

  function refresh(): void {
    const previous = select.value
    clear(select)
    for (const label of state.labels) {
      select.appendChild(el('option', { value: label, text: label }))
    }
    if (state.labels.includes(previous)) select.value = previous
    run()
  }

  state.subscribe(refresh)
  refresh()
}
