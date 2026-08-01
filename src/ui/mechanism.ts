/**
 * THE headline mechanism, stepped rather than asserted (§2).
 *
 * The single idea this demo exists to teach is: the exponent grows without
 * bound, the digest does not. So the panel walks g → g^e₁ → g^(e₁e₂) → … one
 * real modular exponentiation at a time, with two meters side by side: the
 * product of the primes climbing, and the digest flat at 512 bits forever.
 *
 * Motion only happens when you press a button. Nothing here loops or idles.
 */

import { modPow, bitLength } from '../core/bigint'
import { hashToPrime } from '../core/hashToPrime'
import { accumulate, exponentProduct } from '../accumulator/accumulator'
import { el, panel, button, clear, hexBlock, meter, stat, expert, liveRegion } from './dom'
import { state } from './state'

export function mountMechanism(root: HTMLElement): void {
  const p = panel(
    'mechanism',
    'The exponent grows. The digest does not.',
    'One real modular exponentiation per step. Watch the two meters diverge — that divergence is the entire idea.',
  )

  let step = 0

  const controls = el('div', { class: 'controls' })
  const chainBox = el('div', { class: 'chain', role: 'group', 'aria-label': 'Accumulation chain' })
  const readout = el('div', { class: 'grid-2' })
  const live = liveRegion('Accumulation step')

  const stepBtn = button('Multiply in the next element', () => {
    if (step < state.labels.length) step++
    render()
  })
  const backBtn = button(
    'Step back',
    () => {
      if (step > 0) step--
      render()
    },
    'btn-quiet',
  )
  const allBtn = button(
    'Jump to the full set',
    () => {
      step = state.labels.length
      render()
    },
    'btn-quiet',
  )
  const resetBtn = button(
    'Back to g',
    () => {
      step = 0
      render()
    },
    'btn-quiet',
  )
  controls.append(stepBtn, backBtn, allBtn, resetBtn)

  // --- the scale demonstration: real, measured, not projected ---------------
  const scaleBox = el('div', { class: 'subpanel' })
  const scaleOut = liveRegion('Scale test result')
  scaleBox.appendChild(
    el('h3', { text: 'Does it really not grow? Accumulate a crowd and measure.' }),
  )
  scaleBox.appendChild(
    el('p', {
      class: 'note',
      text: 'These buttons hash that many extra labels to primes and run every exponentiation for real, then report the measured sizes. Nothing is estimated.',
    }),
  )
  const scaleControls = el('div', { class: 'controls' })
  for (const n of [10, 100, 1000]) {
    scaleControls.appendChild(button(`+${n} elements`, () => runScale(n), 'btn-quiet'))
  }
  scaleBox.append(scaleControls, scaleOut)

  function runScale(n: number): void {
    clear(scaleOut)
    scaleOut.appendChild(el('p', { class: 'note', text: `Hashing ${n} labels to primes…` }))
    // Let the "working" message paint before the synchronous crunch.
    setTimeout(() => {
      const t0 = performance.now()
      const primes = [
        ...state.primes,
        ...Array.from({ length: n }, (_, i) => hashToPrime(`crowd:${n}:${i}`).prime),
      ]
      const u = exponentProduct(primes)
      const A = accumulate(state.params, primes)
      const ms = performance.now() - t0

      clear(scaleOut)
      const row = el('div', { class: 'statrow' })
      row.append(
        stat('Elements', primes.length.toLocaleString()),
        stat('Exponent u', `${bitLength(u).toLocaleString()} bits`, 'warn'),
        stat('Digest A', `${bitLength(A).toLocaleString()} bits`, 'ok'),
        stat('Raw list', `${primes.length * 8} bytes`, 'warn'),
        stat('Computed in', `${ms.toFixed(0)} ms`),
      )
      scaleOut.appendChild(row)
      scaleOut.appendChild(
        el('p', {
          class: 'note',
          text: `The product of ${primes.length.toLocaleString()} sixty-four-bit primes is a ${bitLength(u).toLocaleString()}-bit integer. Raising g to it — which is what "accumulating" means — lands back inside the ${state.params.bits}-bit modulus, where it stays no matter how many more you add.`,
        }),
      )
      scaleOut.appendChild(hexBlock(A.toString(16).padStart(state.modulusBytes * 2, '0'), `Digest over ${primes.length} elements`))
    }, 0)
  }

  function render(): void {
    step = Math.min(step, state.labels.length)
    clear(chainBox)
    clear(readout)
    clear(live)

    const labels = state.labels.slice(0, step)
    const primes = labels.map((l) => hashToPrime(l).prime)
    const u = exponentProduct(primes)
    const A = modPow(state.params.g, u, state.params.N)

    // --- the chain: g, then one arrow per element multiplied in ------------
    chainBox.appendChild(
      el(
        'div',
        { class: `chain-node ${step === 0 ? 'chain-current' : ''}` },
        el('span', { class: 'chain-name', text: 'g' }),
        el('span', { class: 'chain-note', text: 'the generator' }),
      ),
    )
    for (let i = 0; i < state.labels.length; i++) {
      const done = i < step
      const label = state.labels[i]!
      const rep = hashToPrime(label)
      chainBox.appendChild(
        el(
          'div',
          { class: `chain-arrow ${done ? 'chain-done' : 'chain-pending'}` },
          el('span', { class: 'chain-op', 'aria-hidden': 'true', text: '→' }),
          el('span', { class: 'chain-exp', text: `^ ${rep.prime}` }),
          el('span', { class: 'chain-label', text: label }),
          el('span', { class: 'sr-only', text: done ? ' (multiplied in)' : ' (not yet)' }),
        ),
      )
      chainBox.appendChild(
        el(
          'div',
          { class: `chain-node ${i + 1 === step ? 'chain-current' : ''} ${done ? '' : 'chain-pending'}` },
          el('span', { class: 'chain-name', text: `A${i + 1}` }),
          el('span', {
            class: 'chain-note',
            text: done ? `still ${state.modulusBytes} bytes` : 'not computed yet',
          }),
        ),
      )
    }

    // --- meters -------------------------------------------------------------
    const fullU = exponentProduct(state.primes)
    const maxBits = Math.max(bitLength(fullU), state.params.bits, 1)
    const left = el('div', { class: 'cell' })
    left.append(
      el('h3', { text: 'Exponent  u = ∏ eᵢ' }),
      meter('bits in u', bitLength(u), maxBits, 'bits'),
      el('p', {
        class: 'note',
        text:
          step === 0
            ? 'Empty product: u = 1, so A = g.'
            : `${step} prime${step === 1 ? '' : 's'} multiplied together. This number grows by ~64 bits per element and is never transmitted to anyone.`,
      }),
      hexBlock(u.toString(), 'Exponent u in decimal', 'hexblock-tall'),
    )

    const right = el('div', { class: 'cell' })
    right.append(
      el('h3', { text: 'Digest  A = g^u mod N' }),
      meter('bits in A', bitLength(A), maxBits, 'bits'),
      el('p', {
        class: 'note',
        text: `Capped by the modulus at ${state.params.bits} bits — ${state.modulusBytes} bytes — forever. This is the only value that gets published.`,
      }),
      hexBlock(A.toString(16).padStart(state.modulusBytes * 2, '0'), 'Digest A in hex', 'hexblock-tall'),
    )
    readout.append(left, right)

    live.appendChild(
      el('p', {
        class: 'note',
        text:
          step === 0
            ? 'At step 0 the set is empty and the digest is just the generator g.'
            : `Step ${step} of ${state.labels.length}: multiplied in ${state.labels[step - 1]}. Exponent is now ${bitLength(u)} bits; digest still fits in ${state.modulusBytes} bytes.`,
      }),
    )

    stepBtn.disabled = step >= state.labels.length
    backBtn.disabled = step === 0
    allBtn.disabled = step >= state.labels.length
    resetBtn.disabled = step === 0
  }

  p.append(
    controls,
    chainBox,
    readout,
    live,
    expert(
      'Why raising to a product, rather than hashing a list?',
      el(
        'p',
        {},
        'Because exponentiation is associative in the exponent: (g^a)^b = g^(ab). That means the ',
        'accumulator manager can add an element to a digest it has already published without ',
        'rebuilding anything, and — the crucial part — anyone holding g^(u/e) can reconstruct the ',
        'digest by raising it to their own e. A hash has no such structure: to check anything ',
        'against SHA-256 of a list, you need the list.',
      ),
      el(
        'p',
        {},
        'The cost of that structure is the modulus. A Merkle root needs nothing but a hash ',
        'function; this needs an RSA modulus whose factorisation nobody knows. That trade is ',
        'measured in the comparison panel and attacked in the forgery panel.',
      ),
    ),
    scaleBox,
  )

  root.appendChild(p)
  state.subscribe(() => {
    step = Math.min(step, state.labels.length)
    render()
  })
  render()
}
