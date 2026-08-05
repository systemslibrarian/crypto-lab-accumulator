# Accumulator

**RSA accumulator · dynamic membership · non-membership proofs**

A cryptographic accumulator commits an entire set to one fixed-size number and lets anyone prove
that an element is in it — or, crucially, that an element is **not** in it — with a short witness.
This demo builds a real RSA accumulator in the browser, produces and verifies both kinds of proof,
keeps witnesses alive across additions and deletions, tries to forge them, and measures the whole
thing against a real Merkle tree.

## What It Is

The construction is the RSA accumulator lineage, implemented rather than described:

- **Benaloh–de Mare (EUROCRYPT 1993)** — the original: `A = g^(e₁·e₂·…·eₙ) mod N`, where a
  membership witness is the same product with your own factor omitted.
- **Baric–Pfitzmann (EUROCRYPT 1997)** — collision-freeness requires the accumulated values to be
  **primes**, so elements are mapped through a hash-to-prime function. The demo shows what breaks
  without it.
- **Camenisch–Lysyanskaya (CRYPTO 2002)** — the dynamic accumulator: adding and deleting elements,
  and the public rules for repairing an outstanding witness after either.
- **Li–Li–Xue (ACNS 2007)** — the *universal* accumulator: a non-membership witness `(a, d)` derived
  from the Bézout identity `a·u + b·x = 1`, verified as `A^a · d^x ≡ g (mod N)`.

**Security model.** Soundness rests on the **Strong RSA assumption** *and* on nobody knowing the
factorisation of `N`. This page knows the factorisation, because this page generated it — and the
forgery panel demonstrates precisely what that buys an attacker. Elements are represented by 64-bit
primes and the modulus is 512 bits. Both are chosen so every operation finishes instantly in a tab.

**This is not production cryptography.** It is a teaching demo. The mathematics is real and
unsimplified; the parameters are a toy and the trapdoor is printed on the page on purpose.

## Exhibits

**Start with the guided demo.** It is four beats, about ninety seconds, and it drives the same
shared state and the same accumulator functions every panel below uses — there is no parallel
simulation. Beats are re-entered by replay rather than undo, so Back, Restart and the
`?tour=revocation&step=N` deep link are all one deterministic code path.

0. **Guided demo** — build a revocation set and watch the digest change without growing; fetch and
   verify a proof that a certificate is *not* revoked; revoke it and watch the cached proof turn
   stale; then forge one with the trapdoor and watch the same verifier accept it. A persistent
   set → digest → proof stage carries the state throughout, with each proof stamped with the digest
   version it was minted against.

Then the full lab, reachable from the sticky exhibit navigator (every section keeps a plain `#id`
anchor, so any of them can be linked from a class or a slide):

1. **What is an accumulator?** — a plain-language on-ramp with no maths, plus a glossary of every
   term the page later uses.
2. **The point: revocation without the list** — the byte costs of a full CRL, an OCSP response and
   a witness, side by side, and the full fetch → revoke → reject cycle.
3. **The exponent grows. The digest does not.** — the headline mechanism, stepped one real modular
   exponentiation at a time, with two meters diverging: the product of the primes climbing without
   bound while the digest stays pinned at 64 bytes. A scale test accumulates up to 1,000 extra
   elements for real and reports the measured sizes.
4. **Membership proof** — build `w = g^(u/e)`, then compute `w^e mod N` and compare it against the
   digest hex digit by hex digit. Includes the fail-closed case: asking for a witness for a
   non-member, and seeing that `u/e` is simply not an integer.
5. **Non-membership proof** — the Bézout identity shown as an identity (the actual `a` and `b`),
   then reduced and hidden in the exponent, then verified. Ask about an element that *is* in the
   set and watch the proof become impossible rather than merely fail.
6. **A living set — and the witnesses that go stale** — two witnesses are held on your behalf, go
   stale on every change, and are repaired by the published update rules using public data only.
   Deletion is run both ways — recompute over the set, and the one-exponentiation trapdoor
   shortcut — and the results compared.
7. **Accumulator vs Merkle tree** — describe your deployment (modulus, representative size, set
   size, whether a trusted setup is available, how many witness holders and how much churn) and get
   a plain recommendation, backed by a measured table against a real RFC 6962 sorted-leaf tree and
   a scaling chart with the crossover points marked.
8. **Forge a proof** — predict which of ten attacks the verifier will accept, *then* reveal. Eight
   fail on the arithmetic. One succeeds because the element map was bypassed. One succeeds because
   the trapdoor exists, and cannot be made to fail.
9. **The parameters — and who holds the keys to them** — the modulus, generator and both safe
   primes, plus a real in-browser safe-prime search with a live candidate counter.
10. **What is real here, and what is not** — the honest-scoping panel, with sources.

## When to Use It

**Use an accumulator when** the set is large and changing, the question you need answered is about
one element at a time, and — above all — when you need **non-membership**: revocation checks,
allow/deny lists, stateless blockchain clients proving a UTXO was never spent, anonymous credential
systems proving a credential is not revoked.

**Do NOT use one when** any of these hold:

- **You cannot run a trusted setup.** An RSA accumulator whose modulus was generated by one party is
  forgeable by that party, full stop. Use a Merkle tree, or class groups, or an MPC ceremony.
- **You need post-quantum security.** Shor's algorithm factors `N` and the accumulator falls with
  it. A hash-based Merkle tree does not.
- **Witness holders cannot be kept up to date.** Every change invalidates every outstanding witness.
  If your clients cannot be reached to update them, the logarithmic refetch of a Merkle path is a
  far simpler operational story.
- **The set is small.** At realistic parameters the accumulator's proofs only become smaller than a
  Merkle tree's somewhere past a few thousand elements. The comparison panel plots where.

## Live Demo

**<https://systemslibrarian.github.io/crypto-lab-accumulator/>**

The guided demo is the first thing on the page and the first control is on screen without
scrolling, on desktop and on a 390px phone. Jump straight to any beat with
`?tour=revocation&step=3`, or to any exhibit with its anchor (`#compare`, `#forge`, …). A
persistent **Reset demo** control in the navigator restores the deterministic starting set,
parameters and digest from anywhere on the page, so the story can be rehearsed and repeated
without hunting for the set editor.

Beyond the tour you can step the accumulation one exponentiation at a time, build and verify both
kinds of witness, watch cached proofs go stale and repair them, predict and then run ten forgery
attempts against the real verifier, get a deployment recommendation from measured proof sizes and
witness-update bandwidth, and generate a fresh modulus by searching for safe primes in your own
browser.

## What Can Go Wrong

- **A composite representative forges membership.** If an element can be represented by `e₁·e₂` for
  two real members, the honest verifier accepts it — the equation `w^e = A` is satisfied by any
  divisor of the exponent product. Primality of the representatives is the defence, and it lives in
  the element map, not in the verifier. Runnable in the forgery panel.
- **The trapdoor forges everything.** Knowing `p` and `q` means knowing the group order, which means
  being able to take `e`-th roots at will. There is no coding discipline that repairs this; the
  parameters have to be generated so that nobody holds them.
- **A collision in hash-to-prime is a forgery.** At the 64 bits used here that is roughly 2³² work.
  Real deployments use around 256-bit representatives.
- **A stale witness is a rejected witness.** Every add and every delete breaks every outstanding
  witness. The update rules repair them from public data, but somebody has to actually run them.
- **A witness says nothing about freshness.** It proves a statement about *a* digest, not about the
  current one. The digest still needs a signature and a validity window, exactly as a CRL does.
- **Witnesses are not zero-knowledge.** A membership witness is a function of every other member of
  the set.

## Real-World Usage

Accumulators are the cryptographic answer to revocation, and they show up wherever a short proof
about a large changing set is needed: anonymous credential systems (Idemix and the Camenisch–
Lysyanskaya credential family use accumulator-based revocation), stateless blockchain clients, and
research designs for certificate revocation.

Deployed certificate revocation today, it should be said, mostly uses something else: CRLite
compresses the entire revocation set into a filter cascade that ships with the browser, and
short-lived certificates sidestep revocation altogether. The accumulator remains the cleanest
cryptographic answer to the problem rather than the most widely deployed one — largely because of
the trusted setup this demo makes you look at.

The active research direction is batching: **Boneh–Bünz–Fisch (CRYPTO 2019)** showed how to batch
witness updates and aggregate proofs, and moved the construction into **class groups of imaginary
quadratic fields**, where there is no trapdoor to lose because the group order is not efficiently
computable by anyone.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-accumulator.git
cd crypto-lab-accumulator
npm install
npm run dev            # http://localhost:5173/crypto-lab-accumulator/
```

Other scripts:

```bash
npm test               # unit tests + known-answer tests
npm run build          # typecheck, then production build into dist/
npm run preview        # serve the production build on port 4295
npm run test:a11y      # full browser gate: axe WCAG 2.1 A/AA + the functional flow
npm run test:flow      # just the functional flow, for a faster loop
```

## Related Demos

- [crypto-lab-key-mirror](https://systemslibrarian.github.io/crypto-lab-key-mirror/) — Merkle logs
  and consistency proofs doing the *membership* job at scale, in key transparency.
- [crypto-lab-credential-veil](https://systemslibrarian.github.io/crypto-lab-credential-veil/) —
  BBS+ selective disclosure and status-list revocation, the credential side of the same problem.

## Build & Verify

- **116 unit tests** across 8 files, all colocated in `src/` as `*.test.ts`.
- **53 known-answer vectors** in `src/fixtures/kat.json`, covering SHA-256 (FIPS 180-4 published
  digests), modular exponentiation, extended Euclid, hash-to-prime, and a full end-to-end
  accumulator instance with its membership and non-membership witnesses.

  There is no RFC and no NIST vector suite for RSA accumulators, so claiming "spec KATs" would be
  dishonest. Instead every vector was produced by an **independent CPython implementation**
  (`hashlib` plus CPython's bignum `pow`/`math.gcd`) and is re-derived byte for byte by the
  TypeScript at test time. The primality tests are additionally gated on published adversarial
  inputs: 10 Carmichael numbers and 8 strong pseudoprimes to base 2, all of which must be rejected.
- **Adversarial tests** in `src/accumulator/adversarial.test.ts` cover every attack the forgery
  panel offers — including the two that succeed, which are asserted to succeed.
- **A 12-step random churn test** carries one membership and one non-membership witness through
  interleaved adds and deletes, re-verifying both after every single step.
- **Replay-determinism and digest-history tests** in `src/ui/state.test.ts` protect the guided
  path: reset must restore a byte-identical digest, and a held witness must stay valid against the
  digest it was minted for while failing against the current one. Collapsing those two into one
  answer is the operational mistake accumulators invite, so it is tested.
- **15 browser tests** in `e2e/`, all run by `npm run test:a11y` and all gating the deploy:
  - **3 axe scans** for zero WCAG 2.1 A/AA violations — dark, light, and a 390px viewport — each
    driven through both the healthy states (proofs verifying, forgeries rejected) and the failure
    states (stale witnesses, a revoked certificate, an accepted forgery), because an unscanned
    state is an ungated state.
  - **12 functional tests** that protect the golden flow for its *meaning* rather than incidentally
    as axe setup: the four beats against the real verifier, replay determinism, the deep link,
    public witness repair, the attack reveal, the recommendation changing when no trusted setup is
    available, explicit layout assertions (first action on screen at 1440×900 and at 390×844, no
    horizontal overflow at 320, 390, 768 or 1440 px), and a **size-honesty gate**: no readout that
    would change at production parameters may ship without the `TOY` marker, and every panel that
    reports a size must state what it would be in production.

  Screenshots are written to `test-results/shots/` as artefacts rather than compared against golden
  images: font rasterisation differs between a local macOS run and the Linux CI runner, and a
  pixel-diff gate that cries wolf every commit is worse than none. The layout assertions above are
  the part that must hold.

```bash
npm test && npm run build && npm run test:a11y
```

## Performance

All timings on the shipped 512-bit modulus with 64-bit representatives, measured in-page:

| Operation | Cost |
|---|---|
| Verify a membership witness | ~9 µs (one modular exponentiation) |
| Verify a non-membership witness | ~18 µs (two exponentiations and a multiply) |
| Add an element | one exponentiation on the digest |
| Delete an element | `n` exponentiations, or one with the trapdoor |
| Accumulate 1,000 elements from scratch | ~1 s, dominated by hash-to-prime |
| Generate a fresh 512-bit modulus | typically 0.1–3 s; safe primes are rare |

A realistic 3072-bit modulus is roughly two hundred times slower per exponentiation, which is why
the shipped parameters are a toy. The panel that generates parameters in your browser lets you feel
the real cost of the safe-prime search.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
