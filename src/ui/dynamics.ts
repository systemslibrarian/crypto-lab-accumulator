/**
 * Dynamic updates and witness maintenance.
 *
 * This is the break-it-yourself panel for the property people assume
 * accumulators have and they do not: witnesses are NOT stable. Change the set
 * and every outstanding witness stops verifying. The learner causes that
 * failure here, sees the real verifier reject, and then repairs it with the
 * published update rules — which need no secret and no knowledge of the set.
 */

import { bitLength } from '../core/bigint'
import { hashToPrime } from '../core/hashToPrime'
import {
  deleteByRecompute,
  deleteWithTrapdoor,
  exponentProduct,
  verifyMembership,
  verifyNonMembership,
} from '../accumulator/accumulator'
import {
  add,
  el,
  panel,
  button,
  clear,
  expert,
  hexBlock,
  hexDiff,
  hexOf,
  labelledInput,
  labelledSelect,
  liveRegion,
  refs,
  SOURCES,
  stat,
  toySizeNote,
  verdict,
} from './dom'
import { state } from './state'

export function mountDynamics(root: HTMLElement): void {
  const p = panel(
    'dynamics',
    'A living set — and the witnesses that go stale',
    'Add or revoke an element and the digest changes without changing size. Every witness anyone was holding is now worthless until it is updated. Break it, then repair it.',
  )

  // --- set editor -----------------------------------------------------------
  const setBox = el('div', { class: 'subpanel' })
  const setList = el('ul', { class: 'setlist', 'aria-label': 'Accumulated set' })
  const { wrap: addWrap, input: addInput } = labelledInput('dyn-add', 'Add an element', 'cert:SN-0xE112', {
    size: '22',
  })
  const setOut = liveRegion('Set change result')
  const digestBox = el('div', { class: 'cell' })

  const addBtn = button('Add to the set', () => {
    try {
      state.add(addInput.value)
      addInput.value = nextSuggestion()
    } catch (err) {
      clear(setOut)
      setOut.appendChild(verdict('warn', 'Not added', (err as Error).message))
    }
  })
  const resetBtn = button('Reset the set', () => state.reset(), 'btn-quiet')

  setBox.append(
    el('h3', { text: 'The set' }),
    setList,
    el('div', { class: 'controls' }, addWrap, addBtn, resetBtn),
    setOut,
  )

  let suggestionCounter = 0
  function nextSuggestion(): string {
    suggestionCounter++
    return `cert:SN-0x${(0xe112 + suggestionCounter * 0x37).toString(16).toUpperCase()}`
  }

  // --- held witnesses -------------------------------------------------------
  const heldBox = el('div', { class: 'subpanel' })
  const { wrap: memWrap, select: memSelect } = labelledSelect('dyn-mem', 'Hold a membership witness for', [])
  const { wrap: nonWrap, input: nonInput } = labelledInput(
    'dyn-non',
    'Hold a non-membership witness for',
    'cert:SN-0xD4A9',
    { size: '20' },
  )
  const heldOut = el('div', { class: 'grid-2' })
  const repairOut = liveRegion('Witness repair result')

  const mintBtn = button('Mint both witnesses now', () => {
    state.mintHeldWitnesses(memSelect.value || null, nonInput.value.trim() || null)
    clear(repairOut)
    repairOut.appendChild(
      verdict('ok', 'Witnesses minted', 'both verify against the current digest — now change the set'),
    )
    render()
  })
  const repairBtn = button('Update both witnesses (public data only)', () => {
    clear(repairOut)
    const lines: string[] = []
    for (const [name, fn] of [
      ['membership', () => state.repairHeldMembership()],
      ['non-membership', () => state.repairHeldNonMembership()],
    ] as const) {
      try {
        lines.push(`${name}: ${fn()}`)
      } catch (err) {
        lines.push(`${name}: cannot be repaired — ${(err as Error).message}`)
      }
    }
    for (const line of lines) repairOut.appendChild(el('p', { class: 'note', text: line }))
    render()
  })

  heldBox.append(
    el('h3', { text: 'What a relying party is holding' }),
    el('p', {
      class: 'note',
      text: 'Imagine a browser that fetched these two proofs this morning and cached them. Change the set above, then come back here.',
    }),
    el('div', { class: 'controls' }, memWrap, nonWrap, mintBtn),
    heldOut,
    el('div', { class: 'controls' }, repairBtn),
    repairOut,
  )

  // --- deletion cost --------------------------------------------------------
  const delBox = el('div', { class: 'subpanel' })
  const delOut = liveRegion('Deletion comparison result')
  delBox.append(
    el('h3', { text: 'Two ways to delete — and what the fast one costs you' }),
    el('p', {
      class: 'note',
      text: 'Adding is always one exponentiation. Deleting is not: you either recompute from the whole set, or you use the factorisation of N as a shortcut. Both are run below, on the real numbers, and compared.',
    }),
    el('div', { class: 'controls' }, button('Delete the last element both ways', deleteBothWays, 'btn-quiet')),
    delOut,
  )

  function deleteBothWays(): void {
    clear(delOut)
    if (state.labels.length < 2) {
      delOut.appendChild(verdict('warn', 'Need at least two elements', 'add one first'))
      return
    }
    const victim = state.labels[state.labels.length - 1]!
    const e = hashToPrime(victim).prime
    const remaining = state.labels.slice(0, -1).map((l) => hashToPrime(l).prime)

    const t0 = performance.now()
    const viaRecompute = deleteByRecompute(state.params, remaining)
    const t1 = performance.now()
    let viaTrapdoor: bigint | null = null
    let trapdoorError = ''
    try {
      viaTrapdoor = deleteWithTrapdoor(state.params, state.A, e)
    } catch (err) {
      trapdoorError = (err as Error).message
    }
    const t2 = performance.now()
    const width = state.modulusBytes

    add(
      delOut,
      el(
        'div',
        { class: 'statrow' },
        stat('Element removed', victim),
        stat('Recompute', `${remaining.length} exponentiations, ${(t1 - t0).toFixed(2)} ms`),
        stat('Trapdoor', viaTrapdoor === null ? 'unavailable' : `1 exponentiation, ${(t2 - t1).toFixed(2)} ms`, viaTrapdoor === null ? 'warn' : 'alarm'),
      ),
      viaTrapdoor === null
        ? verdict('ok', 'No trapdoor held', trapdoorError)
        : viaTrapdoor === viaRecompute
          ? verdict(
              'alarm',
              'Identical results',
              'the shortcut worked because this page knows p and q — in a real deployment that same knowledge forges any witness it likes',
            )
          : verdict('alarm', 'Mismatch', 'this would be a bug'),
      viaTrapdoor !== null
        ? hexDiff(hexOf(viaRecompute, width), hexOf(viaTrapdoor, width), 'recomputed A′', 'trapdoor A′')
        : null,
      el('p', {
        class: 'note',
        text: 'Nothing was actually removed from the set — this only compares the two ways of computing the new digest. Use the ✕ buttons above to really delete.',
      }),
    )
  }

  // --- render ---------------------------------------------------------------
  function render(): void {
    clear(setList)
    for (const label of state.labels) {
      const rep = hashToPrime(label)
      const li = el(
        'li',
        { class: 'setitem' },
        el('span', { class: 'setitem-label', text: label }),
        el('span', { class: 'setitem-prime mono', text: `→ ${rep.prime}` }),
      )
      li.appendChild(
        button(
          '✕',
          () => {
            try {
              state.remove(label)
            } catch (err) {
              clear(setOut)
              setOut.appendChild(verdict('warn', 'Not removed', (err as Error).message))
            }
          },
          'btn-icon',
        ),
      )
      const rm = li.querySelector('button')!
      rm.setAttribute('aria-label', `Remove ${label} from the set`)
      setList.appendChild(li)
    }
    if (state.labels.length === 0) {
      setList.appendChild(el('li', { class: 'setitem', text: 'The set is empty — the digest is just g.' }))
    }

    clear(digestBox)
    const width = state.modulusBytes
    const change = state.lastChange
    digestBox.append(
      el('h3', { text: 'The digest right now' }),
      el(
        'div',
        { class: 'statrow' },
        stat('Elements', String(state.labels.length)),
        stat('Digest size', `${width} bytes`, 'ok', true),
        stat('Exponent u', `${bitLength(exponentProduct(state.primes))} bits`, 'warn'),
        stat('Set version', `#${state.version}`),
      ),
      change
        ? hexDiff(
            hexOf(change.previousA, width),
            hexOf(state.A, width),
            `before (${change.kind === 'add' ? 'without' : 'with'} ${change.label})`,
            'after',
          )
        : hexBlock(hexOf(state.A, width), 'Current digest A'),
      change
        ? el('p', {
            class: 'note',
            text: `${change.kind === 'add' ? 'Added' : 'Removed'} ${change.label}. Marked digits changed; the length did not.`,
          })
        : el('p', { class: 'note', text: 'Add or remove something to see the digest move.' }),
      toySizeNote(),
    )

    clear(heldOut)
    heldOut.append(renderHeldMembership(), renderHeldNonMembership())

    // Keep the member selector in sync with the live set.
    const previous = memSelect.value
    clear(memSelect)
    for (const label of state.labels) memSelect.appendChild(el('option', { value: label, text: label }))
    if (state.labels.includes(previous)) memSelect.value = previous

    repairBtn.disabled = state.lastChange === null
  }

  function renderHeldMembership(): HTMLElement {
    const cell = el('div', { class: 'cell' })
    const held = state.heldMembership
    cell.appendChild(el('h4', { text: 'Held membership witness' }))
    if (!held) {
      cell.appendChild(verdict('warn', 'None held', 'that element is not in the set, so no witness exists'))
      return cell
    }
    const fresh = verifyMembership(state.params, state.A, held.witness)
    cell.append(
      el(
        'div',
        { class: 'statrow' },
        stat('For', held.label),
        stat('Minted at', `#${held.version}`),
        stat('Live digest', `#${state.version}`),
      ),
      hexBlock(hexOf(held.witness.w, state.modulusBytes), `Held membership witness for ${held.label}`),
      fresh.ok
        ? verdict('ok', 'Still verifies', 'w^e reproduces the live digest')
        : verdict(
            'alarm',
            'Stale — rejected',
            `the set moved ${state.version - held.version} version${state.version - held.version === 1 ? '' : 's'} ago and this witness no longer reproduces A`,
          ),
    )
    return cell
  }

  function renderHeldNonMembership(): HTMLElement {
    const cell = el('div', { class: 'cell' })
    const held = state.heldNonMembership
    cell.appendChild(el('h4', { text: 'Held non-membership witness' }))
    if (!held) {
      cell.appendChild(
        verdict('warn', 'None held', 'that element is in the set, so absence cannot be proved'),
      )
      return cell
    }
    const fresh = verifyNonMembership(state.params, state.A, held.witness)
    cell.append(
      el(
        'div',
        { class: 'statrow' },
        stat('For', held.label),
        stat('a', held.witness.a.toString()),
        stat('Minted at', `#${held.version}`),
      ),
      hexBlock(hexOf(held.witness.d, state.modulusBytes), `Held non-membership witness element for ${held.label}`),
      fresh.ok
        ? verdict('ok', 'Still verifies', 'A^a · d^x still closes to g')
        : verdict('alarm', 'Stale — rejected', 'the identity no longer closes against the live digest'),
    )
    return cell
  }

  p.append(
    setBox,
    digestBox,
    heldBox,
    expert(
      'The update rules, in full',
      el('ul', { class: 'rules' },
        el('li', {}, el('strong', { text: 'Add, membership: ' }), 'w ← w^(e_new). One exponentiation.'),
        el('li', {}, el('strong', { text: 'Delete, membership: ' }),
          'solve a·e + b·e_del = 1, then w ← w^b · A′^a. Camenisch–Lysyanskaya 2002. Needs no secret and no knowledge of the set — only the two primes and the new digest.'),
        el('li', {}, el('strong', { text: 'Add, non-membership: ' }),
          'solve a₀·e_new + r₀·x = 1, then a ← a·a₀ and d ← d · A_old^(a·r₀).'),
        el('li', {}, el('strong', { text: 'Delete, non-membership: ' }), 'a ← a·e_del, d unchanged.'),
      ),
      el('p', {
        class: 'note',
        text: 'All four are unit-tested, including a twelve-step random churn of adds and deletes with both witnesses carried through and re-verified at every step.',
      }),
      el(
        'p',
        {},
        'The operational cost is real: every holder of a witness must learn about every change, ',
        'or ask someone who did. That is the accumulator’s answer to the Merkle tree’s "just ',
        'refetch the path", and it is why batched and delegated witness updates are an active ',
        'area rather than a solved one.',
      ),
      refs([SOURCES.camenisch, SOURCES.li, SOURCES.bbf]),
    ),
    delBox,
  )

  root.appendChild(p)
  state.subscribe(render)
  render()
  addInput.value = nextSuggestion()
  suggestionCounter = 0
  addInput.value = 'cert:SN-0xE112'
}
