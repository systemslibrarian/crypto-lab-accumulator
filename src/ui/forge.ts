/**
 * Break it yourself (§2). Every attack here is handed to the SAME verifier the
 * honest panels use — nothing is special-cased, nothing is simulated.
 *
 * VISUAL SEMANTICS: the colour tracks system integrity, not the return value.
 * A forgery the verifier REJECTS is green, because the system did its job. The
 * two attacks that succeed are red, and they succeed because they break a
 * stated assumption rather than the arithmetic.
 */

import { modInv, mod1, randBelow, gcd } from '../core/bigint'
import { modPow } from '../core/bigint'
import { hashToPrime } from '../core/hashToPrime'
import {
  exponentProduct,
  membershipWitness,
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
  hexDiff,
  hexOf,
  labelledInput,
  labelledSelect,
  liveRegion,
  refs,
  SOURCES,
  stat,
  verdict,
} from './dom'
import { state } from './state'

interface Attack {
  id: string
  name: string
  /** What the attacker is claiming. */
  claim: string
  /**
   * Why this attempt ends the way it does — the grouping the reveal teaches:
   * `maths` is stopped by the arithmetic, `contract` slips past because the
   * input contract (hash-to-prime) was bypassed, `assumption` succeeds because
   * the security assumption itself is gone.
   */
  reason: 'maths' | 'contract' | 'assumption'
  run: (target: string, custom: string) => AttackResult
}

interface AttackResult {
  /** Did the real verifier accept? */
  accepted: boolean
  /** Was acceptance the *correct* outcome (i.e. is this not actually a forgery)? */
  legitimate?: boolean
  lhs: bigint
  rhs: bigint
  lhsLabel: string
  rhsLabel: string
  explain: string
  facts: Array<[string, string]>
}

export function mountForge(root: HTMLElement): void {
  const p = panel(
    'forge',
    'Forge a proof',
    'Ten attempts, all fed to the same verifier the honest panels use. Two of them work. Find out which, and why.',
  )

  const attacks: Attack[] = [
    {
      id: 'w-eq-a',
      reason: 'maths',
      name: 'Claim membership with w = A (the obvious guess)',
      claim: 'the digest itself is my witness',
      run: (target) => memAttack(target, state.A, 'the digest A, used as a witness'),
    },
    {
      id: 'w-eq-g',
      reason: 'maths',
      name: 'Claim membership with w = g',
      claim: 'the generator is my witness',
      run: (target) => memAttack(target, state.params.g, 'the generator g'),
    },
    {
      id: 'w-eq-1',
      reason: 'maths',
      name: 'Claim membership with w = 1',
      claim: 'the identity element is my witness',
      run: (target) => memAttack(target, 1n, 'the identity, 1'),
    },
    {
      id: 'w-random',
      reason: 'maths',
      name: 'Claim membership with a random group element',
      claim: 'this random 512-bit number is my witness',
      run: (target) => memAttack(target, randBelow(state.params.N), 'a fresh random element'),
    },
    {
      id: 'w-custom',
      reason: 'maths',
      name: 'Claim membership with a witness you type',
      claim: 'this specific number is my witness',
      run: (target, custom) => {
        let w: bigint
        try {
          w = mod1(BigInt(custom.trim().startsWith('0x') ? custom.trim() : `0x${custom.trim() || '0'}`), state.params.N)
        } catch {
          w = 0n
        }
        return memAttack(target, w, 'the value you typed')
      },
    },
    {
      id: 'w-steal',
      reason: 'maths',
      name: 'Reuse a real member’s witness for someone else',
      claim: 'a witness is a witness',
      run: (target) => {
        const donor = state.labels[0]
        if (donor === undefined) return emptySetResult()
        const stolen = membershipWitness(state.params, state.primes, hashToPrime(donor).prime)
        return memAttack(target, stolen.w, `${donor}’s genuine witness`)
      },
    },
    {
      id: 'w-perturb',
      reason: 'maths',
      name: 'Take a real witness and change one bit',
      claim: 'close enough',
      run: (target) => {
        const donor = state.labels[0]
        if (donor === undefined) return emptySetResult()
        const real = membershipWitness(state.params, state.primes, hashToPrime(donor).prime)
        return memAttack(donor, real.w ^ 1n, `${donor}’s witness with the low bit flipped`, target)
      },
    },
    {
      id: 'nm-random',
      reason: 'maths',
      name: 'Prove a real member is absent with a random (a, d)',
      claim: 'I am not on the revocation list',
      run: () => {
        const victim = state.labels[0]
        if (victim === undefined) return emptySetResult()
        const x = hashToPrime(victim).prime
        const witness = { x, a: randBelow(x), d: randBelow(state.params.N) }
        const r = verifyNonMembership(state.params, state.A, witness)
        return {
          accepted: r.ok,
          lhs: r.lhs,
          rhs: r.rhs,
          lhsLabel: 'A^a · d^x mod N',
          rhsLabel: 'generator g',
          explain:
            'Guessing a Bezout pair for a number that shares a factor with u is not a hard problem — it is an impossible one. No (a, d) exists, so no amount of guessing finds it.',
          facts: [
            ['Target', victim],
            ['gcd(x, u)', gcd(x, exponentProduct(state.primes)).toString()],
            ['a', witness.a.toString()],
          ],
        }
      },
    },
    {
      id: 'composite',
      reason: 'contract',
      name: 'Use a COMPOSITE representative instead of a prime',
      claim: 'my "element" is e₁·e₂ for two real members',
      run: () => {
        const [l1, l2] = [state.labels[0], state.labels[1]]
        if (l1 === undefined || l2 === undefined) return emptySetResult()
        const fake = hashToPrime(l1).prime * hashToPrime(l2).prime
        const u = exponentProduct(state.primes)
        const w = modPow(state.params.g, u / fake, state.params.N)
        const r = verifyMembership(state.params, state.A, { e: fake, w })
        return {
          accepted: r.ok,
          lhs: r.lhs,
          rhs: r.rhs,
          lhsLabel: 'w^e mod N',
          rhsLabel: 'digest A',
          explain:
            'This works. An element that was never added is now "in the set" — because the verifier only checks w^e = A, and any divisor of u satisfies that. Baric and Pfitzmann fixed it in 1997 by requiring every element to map to a PRIME, which is why hash-to-prime exists on this page. The map is the defence; the verifier cannot be it.',
          facts: [
            ['Fake element', `${l1} × ${l2}`],
            ['e (composite)', fake.toString()],
            ['Is it prime?', 'no — it has two 64-bit factors'],
          ],
        }
      },
    },
    {
      id: 'trapdoor',
      reason: 'assumption',
      name: 'Forge with the trapdoor (the factorisation of N)',
      claim: 'I am the setup authority and I kept p and q',
      run: (target) => {
        const trapdoor = state.params.trapdoor
        const x = hashToPrime(target).prime
        if (!trapdoor) {
          return {
            accepted: false,
            lhs: 0n,
            rhs: 0n,
            lhsLabel: 'n/a',
            rhsLabel: 'n/a',
            explain: 'These parameters carry no factorisation, so the shortcut is unavailable.',
            facts: [['Trapdoor', 'not held']],
          }
        }
        const order = ((trapdoor.p - 1n) / 2n) * ((trapdoor.q - 1n) / 2n)
        const w = modPow(state.A, modInv(mod1(x, order), order), state.params.N)
        const r = verifyMembership(state.params, state.A, { e: x, w })
        return {
          accepted: r.ok,
          lhs: r.lhs,
          rhs: r.rhs,
          lhsLabel: 'w^e mod N',
          rhsLabel: 'digest A',
          explain:
            'This also works, and it always will. Knowing p and q means knowing the group order, which means being able to take e-th roots of anything — so the holder of the trapdoor can mint a membership witness for any element at all, and a matching non-membership witness for anything they have not "added". Soundness rests entirely on nobody having this. Your browser has it, because your browser generated it.',
          facts: [
            ['Target', target],
            ['Group order known', 'yes — p′·q′'],
            ['Work needed', 'one modular inverse'],
          ],
        }
      },
    },
  ]

  const { wrap: attackWrap, select: attackSelect } = labelledSelect(
    'forge-attack',
    'Attack',
    attacks.map((a) => ({ value: a.id, text: a.name })),
  )
  const { wrap: targetWrap, input: targetInput } = labelledInput(
    'forge-target',
    'Element to lie about',
    'cert:SN-0xD4A9',
    { size: '18' },
  )
  const { wrap: customWrap, input: customInput } = labelledInput(
    'forge-custom',
    'Your witness (hex)',
    'deadbeef',
    { size: '18' },
  )
  const out = liveRegion('Forgery attempt result')
  const scoreboard = el('div', { class: 'statrow' })

  function run(): void {
    clear(out)
    const attack = attacks.find((a) => a.id === attackSelect.value) ?? attacks[0]!
    customWrap.hidden = attack.id !== 'w-custom'
    let result: AttackResult
    try {
      result = attack.run(targetInput.value.trim() || 'cert:SN-0xD4A9', customInput.value)
    } catch (err) {
      out.appendChild(
        verdict('ok', 'The prover refused', `${(err as Error).message} — the attack could not even be constructed`),
      )
      return
    }

    const width = state.modulusBytes
    const facts = el('div', { class: 'statrow' })
    for (const [k, v] of result.facts) facts.appendChild(stat(k, v))
    facts.appendChild(
      stat('Verifier said', result.accepted ? 'ACCEPT' : 'REJECT', result.accepted ? 'alarm' : 'ok'),
    )

    add(
      out,
      el('p', { class: 'claim' }, el('strong', { text: 'The claim: ' }), attack.claim),
      facts,
      result.lhsLabel === 'n/a'
        ? null
        : hexDiff(hexOf(result.lhs, width), hexOf(result.rhs, width), result.lhsLabel, result.rhsLabel),
      result.accepted
        ? verdict('alarm', 'FORGERY ACCEPTED', 'the verifier was satisfied by something that is not true')
        : verdict('ok', 'Forgery rejected', 'the system behaved correctly — this is the outcome you want'),
      el('p', { class: 'explain', text: result.explain }),
    )
  }

  function memAttack(target: string, w: bigint, description: string, claimedAs?: string): AttackResult {
    const label = claimedAs ?? target
    const x = hashToPrime(label).prime
    const r = verifyMembership(state.params, state.A, { e: x, w })
    return {
      accepted: r.ok,
      lhs: r.lhs,
      rhs: r.rhs,
      lhsLabel: 'w^e mod N',
      rhsLabel: 'digest A',
      explain:
        'Under the Strong RSA assumption, finding any w with w^e = A for a prime e you do not hold a root for is believed to be as hard as factoring N. Every guess of this shape fails for the same reason: the verifier is asking for an e-th root, and there is exactly one that works.',
      facts: [
        ['Claimed element', label],
        ['In the set?', state.has(label) ? 'yes' : 'no'],
        ['Witness used', description],
      ],
    }
  }

  function emptySetResult(): AttackResult {
    return {
      accepted: false,
      lhs: 0n,
      rhs: 0n,
      lhsLabel: 'n/a',
      rhsLabel: 'n/a',
      explain: 'This attack needs at least two elements in the set. Add some in the dynamic-set panel.',
      facts: [['Set size', String(state.labels.length)]],
    }
  }

  attackSelect.addEventListener('change', run)

  /**
   * The prediction challenge. A list of ten outcomes is a fact sheet; asking
   * the learner to commit to an answer first turns it into a test of their
   * model, and the two surprises land far harder.
   */
  const predictions = new Map<string, 'accept' | 'reject'>()
  let revealed = false

  function renderScoreboard(): void {
    clear(scoreboard)

    const table = el('table', { class: 'datatable' })
    table.appendChild(
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col', text: 'Attempt' }),
          el('th', { scope: 'col', text: 'Your call' }),
          el('th', { scope: 'col', text: revealed ? 'The verifier' : '—' }),
        ),
      ),
    )
    const tbody = el('tbody', {})
    let correct = 0
    for (const attack of attacks) {
      const guess = predictions.get(attack.id) ?? 'reject'
      const row = el('tr', {})
      row.appendChild(el('th', { scope: 'row', text: attack.name }))

      const cell = el('td', {})
      const sel = el('select', { 'aria-label': `Your prediction for: ${attack.name}` })
      for (const [value, text] of [
        ['reject', 'Rejected'],
        ['accept', 'Accepted'],
      ] as const) {
        sel.appendChild(el('option', { value, text, selected: guess === value }))
      }
      sel.value = guess
      sel.disabled = revealed
      sel.addEventListener('change', () => {
        predictions.set(attack.id, sel.value as 'accept' | 'reject')
      })
      cell.appendChild(sel)
      row.appendChild(cell)

      const outcome = el('td', {})
      if (revealed) {
        const accepted = outcomeOf(attack)
        const right = (accepted ? 'accept' : 'reject') === guess
        if (right) correct++
        add(
          outcome,
          el('span', {
            class: `predict-verdict ${right ? 'predict-right' : 'predict-wrong'}`,
            text: accepted ? 'ACCEPTED' : 'REJECTED',
          }),
          el('span', { text: right ? '  ✓ you called it' : '  ✗ you missed this one' }),
        )
      } else {
        outcome.textContent = 'hidden'
      }
      row.appendChild(outcome)
      tbody.appendChild(row)
    }
    table.appendChild(tbody)

    add(
      scoreboard,
      el('p', {
        class: 'note',
        text: revealed
          ? `You called ${correct} of ${attacks.length}. Every one of these was run against the same verifier the honest panels use.`
          : 'Before you look: which of these will the real verifier accept? Commit to an answer, then reveal.',
      }),
      el('div', { class: 'tablewrap', tabindex: '0', role: 'group', 'aria-label': 'Prediction challenge' }, table),
      el(
        'div',
        { class: 'controls' },
        button(
          revealed ? 'Hide the answers and try again' : 'Run all ten and reveal',
          () => {
            revealed = !revealed
            renderScoreboard()
          },
        ),
      ),
      revealed ? revealSummary() : null,
    )
  }

  /** Run an attack purely for its accept/reject bit. */
  function outcomeOf(attack: Attack): boolean {
    try {
      return attack.run(targetInput.value.trim() || 'cert:SN-0xD4A9', customInput.value).accepted
    } catch {
      return false
    }
  }

  function revealSummary(): HTMLElement {
    const byReason = (r: Attack['reason']): number => attacks.filter((a) => a.reason === r).length
    return el(
      'div',
      { class: 'subpanel' },
      el('h3', { text: 'Three different reasons, not one' }),
      el(
        'ul',
        { class: 'rules' },
        el(
          'li',
          {},
          el('strong', { text: `${byReason('maths')} rejected — wrong arithmetic. ` }),
          'These fail on the Strong RSA assumption and would still fail at 3072 bits. The verifier is asking for an e-th root and there is exactly one.',
        ),
        el(
          'li',
          {},
          el('strong', { text: `${byReason('contract')} accepted — the input contract was bypassed. ` }),
          'A composite representative satisfies w^e = A even though nothing was added. Nothing the verifier can check stops this; hash-to-prime is the defence, and it lives before the verifier.',
        ),
        el(
          'li',
          {},
          el('strong', { text: `${byReason('assumption')} accepted — the assumption is gone. ` }),
          'With p and q the group order is known, so e-th roots are free. No implementation choice repairs this. It is an argument about how the parameters were generated, not about code.',
        ),
      ),
    )
  }

  p.append(
    el('div', { class: 'controls' }, attackWrap, targetWrap, customWrap, button('Run it against the real verifier', run)),
    scoreboard,
    out,
    expert(
      'Reading the scoreboard honestly',
      el(
        'p',
        {},
        'Eight of these fail on the arithmetic and would still fail with a 3072-bit modulus and ',
        '256-bit representatives. One — the composite representative — fails only because ',
        'elements are forced through hash-to-prime before they reach the verifier; it is a ',
        'reminder that the verification equation alone is not the security argument. And one — ',
        'the trapdoor — does not fail at all, and cannot be made to fail by any amount of ',
        'careful coding.',
      ),
      el(
        'p',
        {},
        'That last one is the real deployment problem with RSA accumulators. The usual answers ',
        'are a multi-party computation that generates N so that no participant learns the ',
        'factors, or dropping RSA groups entirely for class groups of imaginary quadratic ',
        'fields, which have no trapdoor to lose. Both are out of scope here and neither is free.',
      ),
      el('p', {
        class: 'note',
        text: 'Every attack on this list has a corresponding unit test in src/accumulator/adversarial.test.ts, including the two that succeed.',
      }),
      refs([SOURCES.baric, SOURCES.bbf]),
    ),
  )

  root.appendChild(p)
  state.subscribe(run)
  renderScoreboard()
  customWrap.hidden = true
  run()
}
