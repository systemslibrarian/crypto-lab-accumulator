/**
 * Parameters and the trusted-setup problem.
 *
 * The shipped modulus is precomputed so the page is instant. This panel runs
 * the real safe-prime search in your tab so the cost is visible rather than
 * described — and, more importantly, so it is obvious that whoever runs that
 * search ends up holding the factors.
 */

import { bitLength } from '../core/bigint'
import { generateParams } from '../accumulator/accumulator'
import { add, el, panel, button, clear, elide, expert, hexBlock, hexOf, labelledSelect, liveRegion, stat, verdict } from './dom'
import { SHIPPED_PARAMS } from '../accumulator/params'
import { state } from './state'

export function mountSetup(root: HTMLElement): void {
  const p = panel(
    'setup',
    'The parameters — and who holds the keys to them',
    'N = p·q with p and q safe primes, and g a quadratic residue. Everything on this page is computed in these parameters.',
  )

  const facts = el('div', { class: 'cell' })
  const { wrap: sizeWrap, select: sizeSelect } = labelledSelect('setup-size', 'Modulus to generate', [
    { value: '256', text: '256-bit — about a second' },
    { value: '384', text: '384-bit — a few seconds' },
    { value: '512', text: '512-bit — same as shipped, 1–10 s' },
  ])
  sizeSelect.value = '512'
  const genOut = liveRegion('Parameter generation progress')
  const controls = el('div', { class: 'controls' }, sizeWrap)

  let running = false
  const genBtn = button('Search for fresh safe primes now', async () => {
    if (running) return
    running = true
    genBtn.disabled = true
    const bits = Number(sizeSelect.value)
    clear(genOut)
    const line = el('p', { class: 'note', text: 'Drawing candidates…' })
    genOut.appendChild(line)
    const t0 = performance.now()
    let candidates = 0
    try {
      const fresh = await generateParams(bits, {
        onProgress: (pr) => {
          candidates = pr.candidates
          line.textContent = `Drawing candidates… ${pr.candidates.toLocaleString()} tried, ${pr.tested.toLocaleString()} survived trial division and reached Miller-Rabin.`
        },
      })
      const ms = performance.now() - t0
      state.useParams(fresh)
      clear(genOut)
      genOut.append(
        el(
          'div',
          { class: 'statrow' },
          stat('Modulus', `${bitLength(fresh.N)} bits`, 'ok'),
          stat('Candidates drawn', candidates.toLocaleString()),
          stat('Elapsed', `${(ms / 1000).toFixed(2)} s`),
        ),
        verdict(
          'alarm',
          'Your browser now holds the trapdoor',
          'it just generated p and q, so it can forge any witness on this page — try the trapdoor attack in the forgery panel',
        ),
        el('p', {
          class: 'note',
          text: 'Every panel above has been recomputed in the new parameters, and every witness was reminted. Safe primes are rare — roughly one candidate in a few thousand at this size — which is why the counter climbs so far before it stops.',
        }),
      )
    } catch (err) {
      clear(genOut)
      genOut.appendChild(verdict('warn', 'Generation failed', (err as Error).message))
    } finally {
      running = false
      genBtn.disabled = false
    }
  })
  controls.appendChild(genBtn)

  const restoreBtn = button(
    'Restore the shipped parameters',
    () => {
      state.useParams(SHIPPED_PARAMS)
      clear(genOut)
      genOut.appendChild(verdict('ok', 'Shipped parameters restored', 'the page is back to its published 512-bit modulus'))
    },
    'btn-quiet',
  )
  controls.appendChild(restoreBtn)

  function render(): void {
    clear(facts)
    const params = state.params
    const width = state.modulusBytes
    add(
      facts,
      el(
        'div',
        { class: 'statrow' },
        stat('Modulus N', `${params.bits} bits`),
        stat('Provenance', params.provenance === 'shipped' ? 'shipped with the page' : 'generated in this tab'),
        stat('Trapdoor', params.trapdoor ? 'known to this page' : 'not held', params.trapdoor ? 'alarm' : 'ok'),
      ),
      el('h3', { text: 'N' }),
      hexBlock(hexOf(params.N, width), 'Modulus N in hex'),
      el('h3', { text: 'g — a quadratic residue mod N' }),
      hexBlock(hexOf(params.g, width), 'Generator g in hex'),
      params.trapdoor
        ? el(
            'div',
            {},
            el('h3', { text: 'p and q — printed on purpose' }),
            el('p', { class: 'note', text: `p = ${elide(params.trapdoor.p.toString(), 40, 20)}` }),
            el('p', { class: 'note', text: `q = ${elide(params.trapdoor.q.toString(), 40, 20)}` }),
            el('p', {
              class: 'note',
              text: 'A demo that hid these would be pretending to a trusted setup it does not have. Both are safe primes: (p−1)/2 and (q−1)/2 are prime too, which is what keeps the quadratic-residue subgroup free of small factors.',
            }),
          )
        : null,
    )
  }

  p.append(
    facts,
    controls,
    genOut,
    expert(
      'How a real deployment escapes this',
      el(
        'p',
        {},
        'Two routes. Either N is generated by a multi-party computation in which no participant ',
        'ever learns p or q — the same machinery as a zk-SNARK ceremony, with the same "at ',
        'least one participant was honest" caveat — or the RSA group is abandoned for a ',
        el('strong', { text: 'class group' }),
        ' of an imaginary quadratic field, where the group order is not efficiently computable ',
        'even by whoever chose the parameters. There is nothing to lose because there is no ',
        'secret to begin with.',
      ),
      el(
        'p',
        {},
        'Both are out of scope here, and neither is free: MPC ceremonies are operationally ',
        'heavy, and class-group arithmetic is substantially slower with less mature ',
        'implementations. Naming them is the honest alternative to implying the problem does ',
        'not exist.',
      ),
      el('p', {
        class: 'note',
        text: 'On size: 512 bits was factored in 1999. Anything real needs 3072 bits or more, which makes every exponentiation on this page roughly two hundred times slower — the reason the shipped modulus is a toy.',
      }),
    ),
  )

  root.appendChild(p)
  state.subscribe(render)
  render()
}
