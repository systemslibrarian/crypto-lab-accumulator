/**
 * The guided path — four beats, ninety seconds, real operations only.
 *
 * Everything below this panel is a reference lab: correct, thorough, and long.
 * This panel exists so a first-time visitor can answer the four questions that
 * matter — why one digest can stand for a growing set, how absence is proved,
 * what revocation breaks, and why the trusted setup is load-bearing — by
 * changing state and watching the real verifier respond.
 *
 * There is no parallel simulation here. Every beat drives the same shared
 * `state` and the same accumulator functions the detailed exhibits use, so the
 * panels further down always agree with the story.
 *
 * Beats are re-entered by REPLAY rather than by undo: `applyThrough(n)` resets
 * the lab and re-runs beats 1..n. That makes Back, Reset and the `?step=` deep
 * link all the same code path, and makes the whole story deterministic.
 */

import { modPow, modInv, mod1 } from '../core/bigint'
import { hashToPrime } from '../core/hashToPrime'
import {
  nonMembershipProofBytes,
  verifyMembership,
  verifyNonMembership,
} from '../accumulator/accumulator'
import type { MembershipWitness, NonMembershipWitness } from '../accumulator/types'
import { add, el, button, clear, elide, expert, hexBlock, hexOf, stat, verdict } from './dom'
import { state } from './state'

/** The certificate the whole story is about. */
export const TOUR_SUBJECT = 'cert:SN-0xD4A9'
/** Two certificates revoked during beat 1, so the set visibly grows. */
const TOUR_ADDITIONS = ['cert:SN-0x7E31', 'cert:SN-0x9AC0']
/** A certificate that is never revoked — the trapdoor lies about this one. */
const FORGE_TARGET = 'cert:SN-0xF00D'

type HeldProof =
  | { kind: 'absence'; subject: string; witness: NonMembershipWitness; version: number }
  | { kind: 'forged'; subject: string; witness: MembershipWitness; version: number }

interface Beat {
  /** Headline for the state the visitor is now looking at. */
  title: string
  /** One or two short sentences. Never more — depth lives in the exhibits. */
  text: string
  /** Label of the action that moves to the next beat. */
  action: string
}

const BEATS: Beat[] = [
  {
    title: 'Is this certificate revoked?',
    text: `A browser just received ${TOUR_SUBJECT} and has to decide whether to trust it. The usual answers: download every revocation ever issued, or phone a server and tell it which site you are visiting.`,
    action: 'Build the revocation set',
  },
  {
    title: 'One digest for the whole list',
    text: 'Two more certificates were revoked. The set grew; the published digest changed and stayed exactly the same size. It will stay that size for a million more.',
    action: `Prove ${TOUR_SUBJECT} is not on it`,
  },
  {
    title: 'Proof of absence, verified',
    text: 'A short witness, checked against the published digest alone. The verifier never saw the list, never learned another certificate on it, and never contacted anybody.',
    action: `Now revoke ${TOUR_SUBJECT}`,
  },
  {
    title: 'Revoked — and the cached proof dies with it',
    text: 'The digest moved. The proof is still perfectly valid against the digest it was minted for, and worthless against the current one. Those are two separate checks, and a verifier has to make both.',
    action: 'Break it with the trapdoor',
  },
  {
    title: 'The maths held. The setup did not.',
    text: `This page knows the factorisation of its own modulus, so it can mint a proof that ${FORGE_TARGET} was revoked when it never was — and the same verifier accepts it. That is the price of an RSA accumulator, and no amount of careful coding pays it.`,
    action: 'Explore all ten exhibits',
  },
]

export function mountTour(root: HTMLElement): void {
  let step = 0
  let proof: HeldProof | null = null
  /** Last version the stage drew, so the digest flashes on change only. */
  let drawnVersion: number | null = null

  const section = el('section', {
    class: 'tour',
    id: 'tour',
    'aria-labelledby': 'tour-h',
  })
  const head = el('div', { class: 'tour-head' })
  const stage = el('div', { class: 'tour-stage' })
  const controls = el('div', { class: 'tour-controls' })
  const live = el('div', {
    class: 'tour-live',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Guided tour result',
  })

  // -- the beats, as real operations ----------------------------------------

  function performBeat(n: number): void {
    if (n === 1) {
      for (const label of TOUR_ADDITIONS) if (!state.has(label)) state.add(label)
    } else if (n === 2) {
      const held = state.mintNonMembership(TOUR_SUBJECT)
      proof = held
        ? { kind: 'absence', subject: TOUR_SUBJECT, witness: held.witness, version: held.version }
        : null
    } else if (n === 3) {
      if (!state.has(TOUR_SUBJECT)) state.add(TOUR_SUBJECT)
    } else if (n === 4) {
      proof = forgeWithTrapdoor()
    }
  }

  /** Beat 4: mint a membership witness using the group order. Real, and fatal. */
  function forgeWithTrapdoor(): HeldProof | null {
    const trapdoor = state.params.trapdoor
    if (!trapdoor) return null
    const x = hashToPrime(FORGE_TARGET).prime
    const order = ((trapdoor.p - 1n) / 2n) * ((trapdoor.q - 1n) / 2n)
    const w = modPow(state.A, modInv(mod1(x, order), order), state.params.N)
    return { kind: 'forged', subject: FORGE_TARGET, witness: { e: x, w }, version: state.version }
  }

  /** Reset and replay 1..n. Every navigation goes through here. */
  function applyThrough(n: number): void {
    proof = null
    state.reset()
    for (let i = 1; i <= n; i++) performBeat(i)
    step = n
    writeDeepLink()
    render()
    state.notify()
  }

  function writeDeepLink(): void {
    try {
      const url = new URL(window.location.href)
      if (step === 0) url.searchParams.delete('step')
      else url.searchParams.set('step', String(step))
      url.searchParams.set('tour', 'revocation')
      window.history.replaceState(null, '', url)
    } catch {
      /* deep links are a nicety; never let them break the demo */
    }
  }

  // -- rendering -------------------------------------------------------------

  function render(): void {
    const beat = BEATS[step]!
    clear(head)
    clear(controls)
    clear(live)

    const dots = el('ol', { class: 'tour-dots', 'aria-label': 'Tour progress' })
    for (let i = 0; i < BEATS.length; i++) {
      dots.appendChild(
        el(
          'li',
          { class: `tour-dot ${i < step ? 'is-done' : ''} ${i === step ? 'is-current' : ''}`.trim() },
          el('span', { class: 'sr-only', text: `Beat ${i + 1}${i === step ? ', current' : i < step ? ', done' : ''}` }),
          el('span', { 'aria-hidden': 'true', text: String(i + 1) }),
        ),
      )
    }

    add(
      head,
      el(
        'div',
        { class: 'tour-headrow' },
        el('p', { class: 'tour-eyebrow', text: `Guided demo · ${step + 1} / ${BEATS.length}` }),
        dots,
      ),
      el('h2', { id: 'tour-h', class: 'tour-title', text: beat.title }),
      el('p', { class: 'tour-text', text: beat.text }),
    )

    const primary = button(
      beat.action,
      () => {
        if (step === BEATS.length - 1) {
          document.getElementById('intro')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
        applyThrough(step + 1)
      },
      'btn-tour',
    )
    add(
      controls,
      primary,
      button('Back', () => applyThrough(Math.max(0, step - 1)), 'btn-quiet'),
      button('Restart the demo', () => applyThrough(0), 'btn-quiet'),
      el('a', { class: 'tour-skip', href: '#intro', text: 'Skip to the full lab' }),
    )
    ;(controls.querySelector('.btn-quiet') as HTMLButtonElement).disabled = step === 0

    renderStage()
  }

  function renderStage(): void {
    clear(stage)
    const width = state.modulusBytes

    // --- column 1: the set --------------------------------------------------
    const setCol = el('div', { class: 'stage-col stage-set' })
    const chips = el('ul', { class: 'chips', 'aria-label': 'Revoked certificates' })
    for (const label of state.labels) {
      const isNew = state.lastChange?.kind === 'add' && state.lastChange.label === label
      const isSubject = label === TOUR_SUBJECT
      chips.appendChild(
        el(
          'li',
          { class: `chip ${isNew ? 'chip-new' : ''} ${isSubject ? 'chip-subject' : ''}`.trim() },
          el('span', { text: label }),
          isNew ? el('span', { class: 'chip-tag', text: 'newest' }) : null,
        ),
      )
    }
    add(
      setCol,
      el('h3', { class: 'stage-label', text: 'Revocation set' }),
      chips,
      el('p', { class: 'stage-note', text: `${state.labels.length} revoked · grows without bound` }),
    )

    // --- column 2: the digest ----------------------------------------------
    const digestCol = el('div', { class: 'stage-col stage-digest' })
    const changed = drawnVersion !== null && drawnVersion !== state.version
    drawnVersion = state.version
    const rail = el(
      'div',
      { class: `digest-rail ${changed ? 'is-fresh' : ''}`.trim() },
      el('span', { class: 'digest-version', text: `digest #${state.version}` }),
      el('span', { class: 'digest-hex', text: elide(hexOf(state.A, width), 18, 12) }),
    )
    add(
      digestCol,
      el('h3', { class: 'stage-label', text: 'Published digest' }),
      rail,
      el(
        'p',
        { class: 'stage-note' },
        `${width} bytes, always. `,
        el('span', { class: 'tag-toy', text: 'TOY SIZE' }),
      ),
      expert(
        'Inspect values',
        hexBlock(hexOf(state.A, width), `Digest number ${state.version} in full`),
        el('p', {
          class: 'note',
          text: `A = g^(∏ eᵢ) mod N, over ${state.labels.length} prime representatives. This 512-bit modulus is a teaching toy; production parameters are 3072 bits, so a real digest is 384 bytes — still fixed, just bigger.`,
        }),
      ),
    )

    // --- column 3: the held proof ------------------------------------------
    const proofCol = el('div', { class: 'stage-col stage-proof' })
    add(proofCol, el('h3', { class: 'stage-label', text: 'The proof you are holding' }))
    if (!proof) {
      add(
        proofCol,
        el('div', { class: 'proof-card proof-empty' }, el('p', { text: 'Nothing yet. Fetch one and the card appears here, stamped with the digest version it was minted against.' })),
      )
    } else {
      add(proofCol, renderProofCard(proof, width))
    }

    add(stage, setCol, arrow(), digestCol, arrow(), proofCol)
  }

  function renderProofCard(held: HeldProof, width: number): HTMLElement {
    const card = el('div', { class: 'proof-card' })
    const mintedAgainst = state.digestAt(held.version)
    const behind = state.versionsBehind(held.version)

    const validThen =
      mintedAgainst === null
        ? false
        : held.kind === 'absence'
          ? verifyNonMembership(state.params, mintedAgainst, held.witness).ok
          : verifyMembership(state.params, mintedAgainst, held.witness).ok
    const validNow =
      held.kind === 'absence'
        ? verifyNonMembership(state.params, state.A, held.witness).ok
        : verifyMembership(state.params, state.A, held.witness).ok

    const bytes =
      held.kind === 'absence' ? nonMembershipProofBytes(state.params, held.witness) : width

    add(
      card,
      el(
        'p',
        { class: 'proof-kind' },
        held.kind === 'absence' ? 'Proof that it is NOT revoked' : 'Forged proof that it IS revoked',
      ),
      el('p', { class: 'proof-subject mono', text: held.subject }),
      el(
        'div',
        { class: 'statrow' },
        stat('Size', `${bytes} bytes`, 'idle', true),
        stat('Minted against', `digest #${held.version}`),
        stat('Live digest', `#${state.version}`, behind > 0 ? 'warn' : 'idle'),
      ),
    )

    // The two questions, kept visibly separate — this is the operational truth
    // an accumulator demo usually blurs.
    if (held.kind === 'forged') {
      add(
        card,
        validNow
          ? verdict('alarm', 'FORGERY ACCEPTED', `the verifier is satisfied that ${held.subject} was revoked, and it never was`)
          : verdict('ok', 'Forgery rejected'),
      )
    } else if (behind === 0 && validNow) {
      add(
        card,
        verdict('ok', `Proof valid against digest #${held.version}`, 'and that is the current digest'),
        verdict('ok', 'NOT REVOKED — connection may proceed'),
      )
    } else {
      add(
        card,
        validThen
          ? verdict('ok', `Proof valid against digest #${held.version}`, 'the maths was never wrong')
          : verdict('alarm', `Proof invalid even against digest #${held.version}`),
        verdict(
          'warn',
          `Digest #${held.version} is stale`,
          `the latest published digest is #${state.version}, ${behind} change${behind === 1 ? '' : 's'} later`,
        ),
        validNow
          ? verdict('ok', `Proof valid against current digest #${state.version}`)
          : verdict(
              'alarm',
              `Proof invalid against current digest #${state.version}`,
              state.has(held.subject)
                ? `${held.subject} is now in the revoked set, so no proof of absence can exist for anyone`
                : 'refetch before trusting it',
            ),
      )
    }

    add(
      card,
      expert(
        'How this was computed',
        held.kind === 'absence'
          ? el(
              'div',
              {},
              el('p', { class: 'note', text: 'a·u + b·x = 1 solved by extended Euclid, then published as (a, d = g^b mod N).' }),
              el('p', { class: 'note', text: `Verified as A^a · d^x mod N == g, with a = ${held.witness.a}.` }),
              hexBlock(hexOf(held.witness.d, width), 'Witness element d'),
            )
          : el(
              'div',
              {},
              el('p', { class: 'note', text: 'w = A^(e⁻¹ mod p′q′) mod N — one modular inverse, available only to whoever knows p and q.' }),
              el('p', { class: 'note', text: 'Verified as w^e mod N == A, by exactly the verifier the honest panels use.' }),
              hexBlock(hexOf(held.witness.w, width), 'Forged witness w'),
            ),
      ),
    )
    return card
  }

  function arrow(): HTMLElement {
    return el('div', { class: 'stage-arrow', 'aria-hidden': 'true' }, el('span', { text: '→' }))
  }

  add(section, head, controls, stage, live)
  root.appendChild(section)

  // Deep link: ?tour=revocation&step=N replays the story to that beat.
  let initial = 0
  try {
    const params = new URLSearchParams(window.location.search)
    const requested = Number(params.get('step'))
    if (Number.isInteger(requested) && requested >= 0 && requested < BEATS.length) initial = requested
  } catch {
    /* ignore */
  }

  // The navigator's presenter-facing Reset sends the story back to beat 1.
  window.addEventListener('accumulator:reset-tour', () => applyThrough(0))

  // Other panels can mutate the set too; the stage must follow along.
  state.subscribe(renderStage)
  if (initial > 0) applyThrough(initial)
  else render()
}
