/**
 * The use case the whole construction is pointed at.
 *
 * Your browser does not want the revocation list. It wants one answer about one
 * certificate. This panel plays that out end to end: fetch a proof of absence,
 * cache it, revoke the certificate, and watch the cached proof stop verifying
 * against the real arithmetic.
 */

import { hashToPrime } from '../core/hashToPrime'
import {
  membershipWitness,
  nonMembershipProofBytes,
  verifyMembership,
  verifyNonMembership,
} from '../accumulator/accumulator'
import type { NonMembershipWitness } from '../accumulator/types'
import { el, panel, button, clear, expert, hexBlock, hexOf, liveRegion, meter, stat, verdict } from './dom'
import { state } from './state'

/** A plausible real-world revocation population and DER entry size. */
const REAL_CRL_ENTRIES = 250_000
const CRL_ENTRY_BYTES = 40

export function mountRevocation(root: HTMLElement): void {
  const p = panel(
    'revocation',
    'The point: revocation without the list',
    'You are a browser. A server just handed you a certificate. Is it revoked? Three ways to find out, with the bytes each one costs.',
  )

  const SUBJECT = 'cert:SN-0xD4A9'
  let cached: { witness: NonMembershipWitness; version: number } | null = null

  const sizes = el('div', { class: 'sizes' })
  const status = liveRegion('Certificate status')
  const controls = el('div', { class: 'controls' })

  const fetchBtn = button('Fetch a proof for this certificate', () => {
    const wit = state.mintNonMembership(SUBJECT)
    if (!wit) {
      cached = null
      render()
      return
    }
    cached = { witness: wit.witness, version: state.version }
    render()
  })

  const revokeBtn = button('Revoke this certificate', () => {
    try {
      state.add(SUBJECT)
    } catch {
      /* already revoked — render() reports it */
    }
    render()
  }, 'btn-danger')

  const unrevokeBtn = button('Un-revoke it', () => {
    try {
      state.remove(SUBJECT)
    } catch {
      /* not present */
    }
    render()
  }, 'btn-quiet')

  const clearBtn = button('Forget the cached proof', () => {
    cached = null
    render()
  }, 'btn-quiet')

  controls.append(fetchBtn, revokeBtn, unrevokeBtn, clearBtn)

  function renderSizes(): void {
    clear(sizes)
    const witnessBytes = state.modulusBytes + 8
    const crlBytes = REAL_CRL_ENTRIES * CRL_ENTRY_BYTES
    sizes.append(
      el('h3', { text: `What each answer costs, for a CA with ${REAL_CRL_ENTRIES.toLocaleString()} revoked certificates` }),
      meter('Download the whole CRL', crlBytes, crlBytes, 'bytes'),
      meter('OCSP: one signed response', 1_500, crlBytes, 'bytes'),
      meter('Accumulator non-membership witness', witnessBytes, crlBytes, 'bytes'),
      el(
        'p',
        { class: 'note' },
        `The CRL bar is ${(crlBytes / 1024 / 1024).toFixed(1)} MB. The witness bar is ${witnessBytes} bytes — too thin to see at this scale, which is the point. `,
        'But size is not the only axis: OCSP is small too, and its problem is different. ',
        'It tells the responder which site you are visiting, and it needs the responder to be ',
        'online and reachable at the moment you connect. A witness is a static object the ',
        'server can staple to its own handshake, so nobody learns anything and nothing has to ',
        'be up.',
      ),
    )
  }

  function render(): void {
    renderSizes()
    clear(status)

    const revoked = state.has(SUBJECT)
    const x = hashToPrime(SUBJECT).prime

    status.appendChild(
      el(
        'div',
        { class: 'statrow' },
        stat('Certificate', SUBJECT),
        stat('Revocation set', `${state.labels.length} entries`),
        stat('Digest version', `#${state.version}`),
        stat('Cached proof', cached ? `minted at #${cached.version}` : 'none', cached ? 'idle' : 'warn'),
      ),
    )

    if (!cached) {
      status.append(
        verdict('warn', 'No proof held', 'fetch one — until then the browser knows nothing about this certificate'),
      )
    } else {
      const result = verifyNonMembership(state.params, state.A, cached.witness)
      status.append(
        el('h3', { text: 'Verifying the cached proof against the live digest' }),
        hexBlock(hexOf(cached.witness.d, state.modulusBytes), 'Cached witness element d'),
        result.ok
          ? verdict('ok', 'NOT REVOKED — connection may proceed', `${nonMembershipProofBytes(state.params, cached.witness)} bytes of proof, verified in one pass, no list downloaded`)
          : verdict(
              'alarm',
              'PROOF REJECTED — do not trust this certificate',
              revoked
                ? 'the certificate has been revoked since this proof was minted, and no updated proof of absence can exist'
                : 'the set changed and this proof is stale — refetch before trusting it',
            ),
      )
      if (!result.ok && revoked) {
        const proof = membershipWitness(state.params, state.primes, x)
        const positive = verifyMembership(state.params, state.A, proof)
        status.append(
          el('h3', { text: 'And the CA can now prove the opposite' }),
          hexBlock(hexOf(proof.w, state.modulusBytes), 'Proof of revocation'),
          positive.ok
            ? verdict('alarm', 'Proof of revocation verifies', 'membership in the revocation set is exactly what "revoked" means')
            : verdict('warn', 'Unexpected', 'the revocation proof did not verify'),
          el('p', {
            class: 'note',
            text: 'Note the asymmetry the learner should take away: absence can be re-proved after an addition is undone, but while the certificate is in the set there is no witness of absence for anyone to find — not for an attacker, and not for the CA either.',
          }),
        )
      }
    }

    revokeBtn.disabled = revoked
    unrevokeBtn.disabled = !revoked
    clearBtn.disabled = cached === null
  }

  p.append(
    sizes,
    controls,
    status,
    expert(
      'What this does not solve',
      el(
        'p',
        {},
        'Freshness. A witness proves a statement about ',
        el('em', { text: 'some' }),
        ' digest; it says nothing about whether that digest is current. The CA still has to sign ',
        'the digest with a validity window, and a client still has to notice when the one it ',
        'holds has expired — exactly the problem CRLs and OCSP have. What changes is the ',
        'bandwidth and the privacy, not the trust model.',
      ),
      el(
        'p',
        {},
        'Distribution, too. Every relying party holding a witness must be told about every ',
        'change to the set or its witness quietly rots. For revocation that is tolerable — the ',
        'server stapling the witness is also the party that would notice — but it is real work ',
        'that a CRL does not require.',
      ),
      el('p', {
        class: 'note',
        text: 'Deployed revocation today mostly uses neither: CRLite compresses the whole CRL set into a filter cascade the browser ships, and short-lived certificates sidestep revocation altogether. Accumulators remain the cleanest cryptographic answer, not the most deployed one.',
      }),
    ),
  )

  root.appendChild(p)
  state.subscribe(render)
  render()
}
