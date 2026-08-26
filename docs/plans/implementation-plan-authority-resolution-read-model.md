# Implementation Plan: Authority resolution read model + the first operator-settable authority flag

**Issue**: #2351 (`W2-14`, OMS Wave 2, stream S1, size M)
**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: Give the OMS authority model its first *computed answer*. Ship a pure
`resolveAuthorities(input)` in the `fulfillment-authority` leaf that answers the seven
operator-facing questions of Wave-2 product spec §3.3, each as `{ question, state, answer, why, source }`,
plus the registry vocabulary (`ReturnsAuthority`) that Wave 2 needs in order to *express* the
authority it now resolves.

**Context**: The design's §2 resolution layer exists on paper. #2304 (`W1a-1`) shipped the
vocabulary — kinds, scopes, `selectAuthorityHolder`, `parseAuthorityConfig`, the block-outcome
unions — and explicitly shipped it with **no production caller**. Nothing computes an answer.
The roadmap (REVIEW P4, verdict A) is explicit that the authority-status surface and its presets
ship **together with** the first operator-settable authority flag, because a settable flag with no
surface is a configuration trap.

**Classification**: CORE (Domain — pure functions in the vocabulary leaf) + DX (a new mirror script).

---

## 2. Scope & Non-Goals

### In Scope

1. `AuthorityQuestion` — a **new seven-member** question vocabulary, deliberately *not* `AuthorityKind`.
2. `resolveAuthorities(input)` — the pure read model, and its answer/why/source/state types.
3. `ReturnsAuthority` into `CoreCapabilityValues` (9 → 10) with **three pinned mirrors** and a new
   `scripts/check-core-capability-mirror.mjs` wired into `check:invariants`.
4. The ADR-056 pointer line in `docs/architecture-overview.md` § Capability Abstractions.
5. Tests: zero-config completeness, inert ambiguity, purity, A6 non-assignability, row order.

### Out of Scope (with reasons)

- **HTTP surface** — `GET /fulfillment-authority/status`, preset preview/apply are #2353. This issue
  ships no controller, module, DTO or token.
- **Presets** — the two preset cards and the preset→config write are #2353/#2354/#2355. This issue
  makes them *possible* (see §6, "What #2352–#2357 may rely on") but ships none of them.
- **Operator-facing English copy** — owned by #2354/#2357 (see Decision D1).
- **The inert-state reason unions** (A1-U, A2-A, A3-X, UF-L, RS-S, A5-A, RB-L, OR-P) and their
  persisted columns — that is #2352 in the same leaf.
- **`AvailabilityAuthority` / `FulfillmentRouter` / `FulfillmentExecutor` in `CoreCapabilityValues`** —
  explicitly deferred to `W3a-14` by the issue. Nothing in Wave 2 resolves them *by connection id
  through `getCapabilityAdapter`*, which is the stated rule for entering the registry.
- **The FE `authority-kind.ts` mirror** currently declared `pending: 'W2-14'` in
  `check-authority-kind-mirror.mjs` — see Decision D5.
- **A migration.** Confirmed none: authority assignment is `Connection.config` jsonb in v1
  (DESIGN §3 adjudication 3), the read model is derived not stored (ADR-059's principle), and
  `ReturnsAuthority` enters a TypeScript `as const` array, not a column. The reserved synthetic
  timestamp **1853000000000 is therefore not used**.

### Constraints

- **Zero sibling-context edges.** `libs/core/src/__tests__/barrel-purity.spec.ts:155` gives
  `fulfillment-authority` an **empty** `authorizedTypeOnlySpecifiers` array — stricter than every
  other context. Not even a `import type { Connection }` is permitted. Every input must be
  structural and supplied by the caller.
- **Pure, never a port call.** R1 finding G6 deleted `getAuthorityScopes()` from the port precisely
  so selection stays lazy-compatible and infallible. Resolution must issue no I/O, construct no
  adapter, and never throw.
- **Capability-driven, never `platformType`.** Enforced repo-wide.
- **Ambiguity is inert and reported, never a boot failure** (R1 retired the A5 boot-failure clause).

---

## 3. Architecture Mapping

**Target layer**: `libs/core/src/fulfillment-authority/domain/types/` — the existing vocabulary leaf.

**Why the leaf and not an owning context**: ADR-053 places *enforcement* resolution in the context
that owns each write (A1 → `inventory`, A5 → `returns`, …). This is not enforcement — it is a
**read model over the same pure inputs**, feeding one operator surface that spans all seven rows.
Placing it in any single owning context would force that context to import five siblings; placing
it in the leaf keeps the graph acyclic and is exactly what makes #2353's in-memory preset preview
possible. It resolves nothing that a write path then acts on, so it cannot become a second
authority for a question an owning context already owns.

**Why `*.types.ts` and not a service**: `engineering-standards.md § The pure-rule exception` permits
runtime functions in a `*.types.ts` when they are pure, *are* the rule for the type they sit with,
and change together with it. `resolveAuthorities` satisfies all three, and matches the four cited
precedents (`pricing-rule.types.ts`, `stock-safety-buffer.types.ts`, `offer-lifecycle.types.ts`,
`offer-validation-problem.types.ts`) as well as the leaf's own `selectAuthorityHolder` /
`parseAuthorityConfig`. A NestJS service would force a module + tokens file onto a leaf whose
documented posture is to have neither until it needs one.

**Existing components reused (all from #2304, none modified)**:
`AuthorityKindValues` · `AUTHORITY_KIND_DESCRIPTORS` · `AuthorityScope` · `authorityScopeKey`
· `AuthorityHolderCandidate` · `selectAuthorityHolder` · `AuthorityAmbiguityReason`
· `parseAuthorityConfig` / `AuthorityConfigClaim`.

**New components**: two type files, one mirror script, one docs fence, one docs pointer line.

---

## 4. Key Design Decisions

### D1 — `answer` and `why` are **codes**, not English copy. *(the biggest contract choice)*

**Decision**: `resolveAuthorities` returns a structured `AuthorityAnswer` (a discriminated union)
and an `AuthorityWhy` (D12). It emits **no operator-facing English**. Copy is owned by the frontend
(#2354 for the default why-lines, #2357's copy module for the ambiguity bodies).

**Why**:
1. **It is the repo's stated precedent.** `bulk-blocker-copy.ts` (#2240): *"Copy lives in one
   `bulk-blocker-copy.ts` per id … so no marketplace name enters the host-neutral chip map."*
   #2357 (`W2-20`) explicitly establishes the same FE-copy-module + mirror-script shape for the
   sibling reason union — core-emitted English would make the two halves of one surface
   architecturally inconsistent within the same wave.
2. **Core-emitted English would bypass the vocabulary gate.** `scripts/check-ui-vocabulary.mjs`
   (already wired into `check:invariants`) scans `apps/web/src/features/fulfillment-authority`
   for the closed nine-term banned list. A sentence assembled in `libs/core` and rendered verbatim
   is never scanned — the gate would pass while the banned term reached the operator.
3. **The ambiguous-row rule needs a discriminator, not a string.** Spec §3.3: when a row resolves
   ambiguous its why-line is *replaced* by the §4.2 body copy for the matching state. A code lets
   the FE tell "default why-line" from "ambiguity body" mechanically; a pre-rendered string forces
   the FE to re-derive that decision it was just handed the answer to.
4. **`why` cannot simply be derived FE-side** from `(question, state)`: #2352 will extend the
   ambiguity half with its own reason values, and a derived rule would have to be edited in two
   places when it does.

5. **Core-emitted English is permanently unlocalisable.** `docs/frontend-architecture.md`
   § Internationalization migrates strings per-feature to `t(key, fallback)`. A sentence assembled
   in `libs/core` and rendered verbatim can never enter that seam — this is not merely a
   vocabulary-gate bypass, it is a one-way door.
6. **It would make #2354's own AC unsatisfiable by construction.** That issue is required to have
   its copy pass the `W2-46a` gate; copy it does not own cannot pass a gate it is not scanned by.

**Cost accepted, stated plainly**: the AC's wording is *"returns a concrete answer **and a why
line**"*. This plan reads "why line" as *the identity of the line*, not its rendered bytes — and
satisfies the AC by asserting that **every** question returns a non-null `why` on a zero-config
install (a total function into a closed union), so no row can render without one. If a reviewer
reads the AC strictly as English-in-core, D1 is the decision to reverse, and it is a one-file
change (add a copy map beside the codes) rather than a reshape.

### D2 — The question space is seven; `AuthorityKindValues` stays six.

`authority-kind.types.ts` says, in the file: *"Do not 'fix' the count to seven."* A7
(invoicing/fiscalization) has an owning context already — `sales-documents` (ADR-041, #2161/#2170) —
so it carries no `AuthorityKind`. But the operator asks seven questions. Therefore:

- `AuthorityQuestionValues` is a **new, separate** seven-member array, written one member per line
  (no `...AuthorityKindValues` spread — the mirror script family parses these arrays *textually*,
  and a computed array would be unreadable to it and to a future mirror).
- `AUTHORITY_QUESTION_DESCRIPTORS` maps each question to `{ kind: AuthorityKind | null, matrixRow }`.
  `kind: null` for `'sales-documents'` alone.
- A spec asserts the six non-null `kind`s are exactly `AuthorityKindValues`, in order — so adding a
  seventh authority kind later cannot silently leave a question unmapped.

### D3 — The badge is derivable from `(state, source, answer.kind)`, with no question literal in the FE.

Spec §3.3's six badges are a *rendering* of this read model. The mapping is fixed here so #2354
cannot invent a second one:

| Badge (spec §3.3) | Derivation |
|---|---|
| `Elsewhere` | `source === 'delegated'` |
| `Always` | `source === 'fixed-by-design'` |
| `Nothing is deciding` | `answer.kind === 'cannot-tell'` (⇔ `state === 'ambiguous'`) |
| `Nothing to route` | `answer.kind === 'nobody-to-route'` |
| `Chosen` | `state === 'resolved'` (and `source === 'operator-config'`) |
| `Default` | `state === 'default'` |

`source` exists in the issue's own `{answer, source, why, state}` shape and earns its place here:
it is what lets `Always` and `Elsewhere` be derived **without** the FE testing
`question === 'refund-trigger'`. `state` says *how well resolved*; `source` says *by what
authority the answer was reached*. Neither is redundant.

### D4 — Six answer kinds, including a compound and a "by hand".

Spec §3.3 requires shapes a naive `selected | none | ambiguous` cannot express:

- **Compound** — *"Who picks and ships?"* legitimately answers `My shop · Allegro`. A compound is
  **routine, never attention-worthy**, and must be structurally distinct from ambiguity. Hence
  `{ kind: 'holders', holders: [...] }` with one *or many* entries: one holder is not a special case.
  It is produced by **D10's per-scope fold**, not by any per-row special case.
- **"Nothing decides yet — you handle returns by hand"** — `{ kind: 'manual' }`, spec-backed for
  **A5 only**. Without it, a zero-config install would have to answer `openlinker` (false — OL does
  not decide disposition) or `cannot-tell` (false — that means two systems claim it), and §2.3
  forbids an empty state.
- **"Today's behaviour, unchanged"** — `{ kind: 'default-today' }`, the A3 zero-config answer
  (see D11).

### D10 — Resolve **per claimed scope and fold**; never at a single `global` scope. *(review BLOCKING #1)*

A first draft called `selectAuthorityHolder(candidates, { kind: 'global' })` once per authority.
That silently discards every scoped claim. Trace the shipped rule with `requestedScope = global`:
`exact` keeps only claims whose key is `'global'`, and `enclosing` is `[]` *by construction*
(`requestedScope.kind === 'global' ? [] : …`). So a `channel`- or `location`-scoped claim lands in
neither tier and returns `{ kind: 'none' }`.

That is not a corner case. DESIGN §2.1: *"A2/A5 configuration hangs on the **source connection**"* —
channel-scoped claims are the **designed** shape for two of the five resolvable rows, and A1's
`scopes` array is this issue's headline flag. The page built to show an operator their configuration
would have reported `Default` about a claim that exists.

**The rule**: group each authority's claims by `authorityScopeKey`, run `selectAuthorityHolder`
**once per distinct claimed scope** (plus `global`), then fold:

| Per-scope outcomes | Row answer | `state` |
|---|---|---|
| no claims anywhere | the row's default answer | `default` |
| all `selected`, one distinct holder | `holders: [one]` | `resolved` |
| all `selected`, several distinct holders | `holders: [...]` — the **compound**, routine | `resolved` |
| any `ambiguous` | `cannot-tell` + that reason + its `candidateIds` | `ambiguous` |

This is the only shape satisfying spec §3.3's three rules at once: a compound is routine, ambiguity
is per-scope, and a scoped claim is visible. `selectAuthorityHolder` is **composed, never modified**.

### D11 — A3's default is `default-today`; core does not name the shipping parties. *(review BLOCKING #2)*

A first draft derived A3's default as `holders` over `OrderProcessorManager`-declaring claimants.
That is **provably wrong on the spec's own worked example**: on the canonical 1-shop + Allegro
install, PrestaShop declares `OrderProcessorManager` and Allegro does not (its manifest is
`['OrderSource', 'OfferManager']`), so the rule yields `My shop` where spec §3.3 states
`My shop · Allegro`. The draft's `manual` fallback for A3 was also unfounded — `manual` is an **A5**
value; A3's list is `My shop · My marketplace · OpenLinker · My 3PL · compound · can't tell`, with
no by-hand member.

**Decision**: A3's zero-config answer is `{ kind: 'default-today' }` — the ADR-052 matrix default
(*"today's destination create + shipping dispatch"*), whose why-line is already spec'd as *"Whoever
the order lands with, as it works today."* #2354 renders the party list from connection data it
already holds. This is honest about what Wave 2 can observe (it cannot tell which orders are
marketplace-fulfilled) and keeps `holders` reserved for **actual claims**, which is what D10's fold
produces. Naming the parties in core would require a stated two-role rule that Wave 2 cannot
validate — exactly what gets unwound later.

### D5 — Do not create the FE `authority-kind.ts` mirror; re-point its `pending` attribution.

`scripts/check-authority-kind-mirror.mjs:84` declares a pending mirror at
`apps/web/src/features/orders/lib/authority-kind.ts` owned by `'W2-14'` — this issue. That
attribution is wrong in the same way #2335's three `SCAN_ROOTS` attributions were (the script's own
comments record that correction). #2351 is a CORE issue whose file scope is `libs/core/**`; the
first frontend consumer of the authority vocabulary is **#2354** (`W2-17`), the "Who decides what"
page, and it will live under `features/fulfillment-authority`, not `features/orders`.

**Action (narrowed during implementation)**: the `pending` field is re-attributed to
#2354 / `W2-17`. The `file` path is **not** moved: #2441's own parent-directory guard fails the
build on a declared path whose directory does not exist, and `features/fulfillment-authority/lib`
does not exist until #2354 creates it. Moving it here would have traded a wrong attribution for a
red build, so the entry now carries the correct owner plus an explicit instruction to #2354 to
re-point the path in the commit that creates the file. Creating an unused FE file here to satisfy a mis-attributed declaration would be worse
than fixing the declaration. The script passes either way (an absent pending mirror is announced,
not failed) — so this is an honesty fix, not a build fix, and it is called out for review rather
than done silently.

### D6 — The new capability mirror script is genuinely in scope (but narrower than first thought).

The AC demands *"a deliberate drift in any one of the three failing the build"*. Verified today:

| Mirror | Drift caught today? |
|---|---|
| Core `CoreCapabilityValues` | ✅ the exact-array spec in `adapter.types.spec.ts` |
| FE `CORE_CAPABILITY_VALUES` + `CAPABILITY_HELP` | ⚠️ **partially** — `CAPABILITY_HELP: Record<CoreCapability, string>` makes a *missing help entry* a type error, but **failing to add the member to the FE union at all fails nothing** |
| `docs/capabilities.md` | ❌ nothing |

So two of three drifts are silent, and `scripts/check-core-capability-mirror.mjs` is required —
built on the mechanic of `check-authority-kind-mirror.mjs` (zero-dependency, textual, exported pure
parsers, `--self-check` over deliberately-drifted fixtures, a fenced docs block).

**Correction from the pre-implement gate**: one script *does* already parse `CoreCapabilityValues`
textually — `scripts/check-plugin-guide-quotes.mjs`, which mirrors it into the plugin author guide.
The new script must therefore be scoped to the three genuine gaps (FE union, `CAPABILITY_HELP`,
`docs/capabilities.md`) and must **not** duplicate the guide check. See **C1** below, which is a
hard build break the first draft of this plan missed.

**Extra drift points found**: `docs/capabilities.md` enumerates the closed set a **second** time in
the prose paragraph *"Open-world capability vocabulary (#576)"* (`:40-43`). The fence is placed so
that paragraph **reads from the fenced list instead of restating it** — one list, not two.

### D7 — `ReturnsAuthority` belongs in the closed set *because it is written, not merely read*.

Two Wave-1c docblocks state what reads like the opposite rule:

- `returns/application/services/returns.service.ts:71` — `ReturnSourceReader` / `ReturnDecliner` are
  *"deliberately string literals rather than members of `CoreCapabilityValues`"*.
- `orders/domain/ports/capabilities/return-decliner.capability.ts:31` — *"that closed list is pinned
  by a spec and is `@IsIn`-validated on both connection DTOs, so an advertised-without-dispatch name
  there would be both wrong and **unwritable**."*

**Not a contradiction — the distinguishing property is decisive, and the plan must say so** or the
next reader will read it as one. Those two names are read off an adapter **manifest** and never
written by anyone. `ReturnsAuthority` is the inverse: A5's holder is named by an **operator enabling
it on a connection**, i.e. written into `enabledCapabilities`, which both connection DTOs
`@IsIn`-validate against `CoreCapabilityValues`. Keeping it out would make it *unwritable* — the
docblock's own word, pointing the other way — and A5 could then never resolve to a non-OL holder.

**Actions**: the `adapter.types.ts` comment states this distinction; and a spec pins that Wave 2
never passes `ReturnsAuthority` to `getCapabilityAdapter` / `listCapabilityAdapters` (the
`resolve_category` precedent — a spec that *breaks* when a later wave wires dispatch, rather than a
comment that rots).

### D8 — The capability gate reads the **union** of both declaration lists.

Not `enabledCapabilities` alone, and the reason is forced rather than stylistic:

- **A5** (`ReturnsAuthority`) is operator-enabled ⇒ lives in `enabledCapabilities`.
- **A1** (`AvailabilityAuthority`) is deliberately **not** entering `CoreCapabilityValues` in this
  issue (deferred to `W3a-14`), so it can never appear in `enabledCapabilities` — the DTO `@IsIn`
  rejects it. Gating A1 on `enabledCapabilities` would make this issue's own *"first
  operator-settable authority flag"* unresolvable by construction.

An adapter may still advertise `AvailabilityAuthority` in `supportedCapabilities` (open-world #576 —
that field is bare `string[]`). So the gate tests `supportedCapabilities ∪ enabledCapabilities`,
which is correct for both rows today and needs no revisit when `W3a-14` promotes the other names.

### D12 — `AuthorityWhy` is a two-arm discriminated union, not a flat list. *(review IMPORTANT)*

A flat `AuthorityWhyCode` would make D1's own load-bearing distinction — "default why-line" vs
"§4.2 ambiguity body" — a **string-prefix convention** (`ambiguous-*`), which is the
restate-the-rule-elsewhere failure the pure-rule exception's condition 3 warns about. Worse,
#2352 adds eight inert-state reasons under a **different issue with a different mirror script**
(#2357), so a flat list would end at ~22 members mixing two vocabularies with two owners.

`AuthorityWhy` therefore has a `default` arm (`AuthorityDefaultWhyCode`, owned here) and an
`ambiguous` arm carrying the **already-shipped** `AuthorityAmbiguityReason`. #2352 widens the
ambiguity arm without touching the default one. The placeholder code
`'ambiguous-two-systems-claim-it'` is deleted — it stood in for a union that already exists.

### D13 — `state` is derived, kept, and pinned by a spec. *(review IMPORTANT)*

`state` is fully determined by `(source, answer.kind)`: `delegated → unavailable`;
`fixed-by-design → resolved`; `operator-config → resolved`; `default → default`;
`answer.kind === 'cannot-tell' → ambiguous`. So the four-field shape carries a derivable field.

It is **kept** — the issue mandates the shape, and shipping a derived value so consumers need not
re-derive it is the `OrderInvoiceProjectionDto.blocksIssuanceElsewhere` precedent (#2100). But a
derived field with no guard is two sources of truth, so a spec asserts the invariant across all
seven rows on both the zero-config and the ambiguous fixture. One test; closes the only real cost.

### D14 — An **inactive** connection's claim is reported, never eligible, and never silently dropped.

`AuthorityClaimantInput` carries `isActive`, and **the caller passes every connection regardless of
status**. This follows the `analytics-trust` lesson directly: that read had to opt into
`includeAllStatuses` because the default active-only filter silently dropped exactly the
connections the surface existed to warn about.

- **Not eligible to hold**: an inactive connection cannot exercise the authority — `getCapabilityAdapter`
  is active-only, which is why the leaf already ships the `holder-connection-unresolvable`
  unresolved reason. So it does not enter `selectAuthorityHolder`'s candidate list and cannot create
  or break an ambiguity.
- **Reported**: its id appears in `AuthorityAnswerView.inactiveClaimantConnectionIds`, so #2353/#2354
  can surface *"a disabled connection claims this"* without it changing `answer` or `state`.

#2353 is told this explicitly: pass all connections, not the active ones.

### D15 — The `core-capabilities` fence is a **table**, matching the mirror script it copies.

`check-authority-kind-mirror.mjs` parses a markdown table by backticked first cell; the
plugin-guide check parses a fenced code block. The new script copies the **former**, so the fence
holds a two-column table (`| Capability | What it does |`) with the capability name backticked in
column 1. Stated here so the script and the doc are not written against different shapes.

### D16 — The `CAPABILITY_HELP` sentence, drafted for review rather than improvised.

```
ReturnsAuthority: 'Decides what happens to goods a customer sends back — whether they go back on
sale, and who approves that.'
```

Operator-facing, no model vocabulary, and consistent in voice with the existing entries.
(`features/connections` is not a `check-ui-vocabulary.mjs` SCAN_ROOT, so this is unconstrained by
the banned-term gate — it is written to the same standard anyway.)

### D9 — The two *port* tables get the row too, with an explicit "no port yet".

`docs/capabilities.md:28-38` and `docs/plugin-author-guide.md:96-107` both enumerate the nine with a
**port file** column. `ReturnsAuthority` has no `*Port` in Wave 2. Omitting it is truthful about
ports but leaves each table one row short of the closed-set list on the same page — precisely the
drift the new mirror exists to prevent. **Decision**: add the row to both, with `—` in the port cell
and a "no port yet — Wave 3a; resolved from capability declarations" note. Every enumeration stays
complete and the absence is *stated* rather than inferred from a gap. Decided once, identically in
both files.

---

## 5. Exported Surface (the contract six issues build on)

**New file** `libs/core/src/fulfillment-authority/domain/types/authority-question.types.ts`:

```ts
export const AuthorityQuestionValues = [
  'availability',            // A1 — How much stock can we promise?
  'sourcing',                // A2 — Where does an order ship from?
  'fulfillment-execution',   // A3 — Who picks and ships?
  'order-lifecycle',         // A4 — What state is an order in?
  'returns-disposition',     // A5 — What happens to returned goods?
  'refund-trigger',          // A6 — Who issues refunds?
  'sales-documents',         // A7 — Who issues invoices and receipts?
] as const;
export type AuthorityQuestion = (typeof AuthorityQuestionValues)[number];

export interface AuthorityQuestionDescriptor {
  /** The authority this question resolves, or `null` for A7 (owned by `sales-documents`). */
  readonly kind: AuthorityKind | null;
  /** ADR-052 matrix row label, for cross-referencing the design. */
  readonly matrixRow: 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7';
}
export const AUTHORITY_QUESTION_DESCRIPTORS:
  Readonly<Record<AuthorityQuestion, AuthorityQuestionDescriptor>>;

export function isAuthorityQuestion(value: unknown): value is AuthorityQuestion;
```

**New file** `libs/core/src/fulfillment-authority/domain/types/authority-resolution.types.ts`:

```ts
/** Structural claimant — NEVER a `Connection` (the leaf has an empty cross-context allow-set). */
export interface AuthorityClaimantInput {
  readonly connectionId: string;
  /** `connection.status === 'active'`. Inactive claimants are reported, not eligible (D14). */
  readonly isActive: boolean;
  /** What the adapter's manifest advertises. */
  readonly supportedCapabilities: readonly string[];
  /** What the operator enabled on the connection. */
  readonly enabledCapabilities: readonly string[];
  /** Raw, untrusted `Connection.config` jsonb — coerced here by `parseAuthorityConfig`. */
  readonly config: unknown;
}

export interface AuthorityResolutionInput {
  readonly claimants: readonly AuthorityClaimantInput[];
}

export const AuthorityStateValues = ['resolved', 'default', 'ambiguous', 'unavailable'] as const;
export type AuthorityState = (typeof AuthorityStateValues)[number];

export const AuthoritySourceValues = [
  'default',            // nobody claimed it; today's shipped behaviour answers
  'operator-config',    // an operator claim in `Connection.config` decided it
  'fixed-by-design',    // A6 — never assignable (ADR-056)
  'delegated',          // A7 — answered by `sales-documents`
] as const;
export type AuthoritySource = (typeof AuthoritySourceValues)[number];

export interface AuthorityAnswerHolder {
  readonly connectionId: string;
  readonly scope: AuthorityScope;
}

export type AuthorityAnswer =
  | { readonly kind: 'openlinker' }
  | { readonly kind: 'holders'; readonly holders: readonly AuthorityAnswerHolder[] }
  | { readonly kind: 'manual' }
  | { readonly kind: 'default-today' }
  | { readonly kind: 'nobody-to-route' }
  | { readonly kind: 'cannot-tell';
      readonly reason: AuthorityAmbiguityReason;
      readonly candidateConnectionIds: readonly string[] }
  | { readonly kind: 'configured-elsewhere'; readonly surface: 'sales-documents' };

/** The DEFAULT arm only. The ambiguity arm reuses the shipped `AuthorityAmbiguityReason`. */
export const AuthorityDefaultWhyCodeValues = [
  'a1-computed-from-master-minus-buffer',
  'a1-claimed-by-connection',
  'a2-single-origin-nothing-to-choose',
  'a2-claimed-by-connection',
  'a3-lands-where-it-does-today',
  'a3-claimed-by-connection',
  'a4-derived-from-observed-facts',
  'a4-claimed-by-connection',
  'a5-nothing-decides-yet-handled-by-hand',
  'a5-claimed-by-connection',
  'a6-only-ol-holds-payment-credentials',
  'a7-configured-under-sales-documents',
] as const;
export type AuthorityDefaultWhyCode = (typeof AuthorityDefaultWhyCodeValues)[number];

/**
 * Two arms, not one flat list (D12). Spec §3.3: an ambiguous row's why-line is
 * *replaced* by the §4.2 body copy, so the FE must tell the two apart
 * mechanically rather than by a string-prefix convention.
 */
export type AuthorityWhy =
  | { readonly kind: 'default'; readonly code: AuthorityDefaultWhyCode }
  | { readonly kind: 'ambiguous'; readonly reason: AuthorityAmbiguityReason };

export interface AuthorityAnswerView {
  readonly question: AuthorityQuestion;
  /** Derived from `(source, answer.kind)`; the invariant is pinned by a spec (D13). */
  readonly state: AuthorityState;
  readonly answer: AuthorityAnswer;
  readonly why: AuthorityWhy;
  readonly source: AuthoritySource;
  /**
   * Connections that claim this authority but are NOT active, so they were not
   * eligible to hold it (D14). Reported, never silently dropped; does not change
   * `answer` or `state`.
   */
  readonly inactiveClaimantConnectionIds: readonly string[];
}

/**
 * Pure. No I/O, not async, constructs no adapter, never throws, never mutates its input.
 * Returns exactly seven rows in `AuthorityQuestionValues` order — the spec §3.3 table order.
 */
export function resolveAuthorities(
  input: AuthorityResolutionInput,
): readonly AuthorityAnswerView[];
```

**Barrel**: both files appended to `libs/core/src/fulfillment-authority/index.ts`.

### The flag: storage and semantics

**The first operator-settable authority flag is `Connection.config.availabilityAuthority`** (A1),
whose `scopes` array is what R1's G6 moved off the port and into config.

- **Storage**: `Connection.config` **jsonb**. No column, no table, no migration
  (DESIGN §3 adjudication 3).
- **Shape** (already coerced by the shipped `parseAuthorityConfig`, unchanged by this issue):
  `true` / `'true'` → claimed, unscoped, not primary; or
  `{ enabled, isPrimary?, scopes?: AuthorityScope[] }`. Malformed scopes are dropped
  **individually**; anything unrecognised at the top level yields *unheld*.
- **Semantics**: unheld ⇒ A1 answers `openlinker` / `default`. One claimant ⇒ `resolved`
  regardless of `isPrimary` (the #2047 zero-config rule). Two claimants on one scope ⇒
  `cannot-tell` / `ambiguous` — **inert**: this function reports, and nothing here acts.
- **What this issue adds** is not the parser (shipped) but the fact that the claim is now
  **honoured, resolved and reportable**. The write path is #2353.

### What #2352–#2357 may rely on

| Issue | May rely on |
|---|---|
| #2352 | `AuthorityWhyCode` is an **extensible** closed union — its ambiguity half (`ambiguous-*`) is where the eight inert-state reasons attach. `resolveAuthorities` is unchanged by that extension. |
| #2353 | `resolveAuthorities` takes **all** inputs as plain arguments ⇒ preset *preview* is "mutate a copy of the claimant configs in memory, re-run, diff". No resolution logic reaches `apps/api`. The 422-on-ambiguity check is `answers.some(a => a.state === 'ambiguous')`, and `answer.candidateConnectionIds` names the conflicting connections the AC requires. |
| #2354 | Exactly seven rows, always, in table order; every row has a non-null `answer` **and** `why`; the badge mapping in D3 is fixed and needs no question literal. |
| #2355 | The before/after diff is two `AuthorityAnswerView[]` compared row-wise by `question`. |
| #2356 | `state === 'ambiguous'` is the attention-worthy predicate; every other state is routine. A compound (`holders.length > 1`) is **routine** — D4. |
| #2357 | `AuthorityWhyCodeValues` is a textually-parseable `as const` array, mirror-script-ready in the `check-sales-document-reason-mirror.mjs` shape. |

---

## 6. Implementation Plan

### Phase 1 — The question vocabulary

1. **`authority-question.types.ts`** — the seven values, descriptors, guard. File header cites
   #2351 / ADR-052 and states *why seven here and six there* (D2), so the next reader does not
   "fix" one to match the other.
   *Acceptance*: `AUTHORITY_QUESTION_DESCRIPTORS`'s six non-null kinds equal `AuthorityKindValues` in order.
2. **`authority-question.types.spec.ts`** — exact-array assertion (7 members, in order); the
   kind-mapping assertion above; `'sales-documents'` is the only `kind: null`; guard rejections.

### Phase 2 — The read model

3. **`authority-resolution.types.ts`** — the types in §5 plus `resolveAuthorities`. Internal shape:
   one small pure `resolveQuestion(question, claimants)` walked over `AuthorityQuestionValues`, so
   the seven-row totality is structural (a `map` over the values array) rather than seven
   hand-written rows that could drift.
   - A6 returns its fixed row **before** any claimant is consulted.
   - A7 returns its delegated row **before** any claimant is consulted.
   - A1/A2/A3/A4/A5 build `AuthorityHolderCandidate[]` from `parseAuthorityConfig` + a capability
     check + `isActive` (D14), then **resolve per claimed scope and fold** per D10 — group by
     `authorityScopeKey`, call `selectAuthorityHolder` once per distinct claimed scope (plus
     `global`), and combine with the four-outcome table. Never a single `{ kind: 'global' }` request.
   - A claimant whose parsed claim has **no** scopes is treated as claiming `{ kind: 'global' }`
     (`parseAuthorityConfig` documents empty-scopes as an unnarrowed claim).
   - **Capability gating (D8)**: a claimant is eligible only when the authority's descriptor
     `capability` is `'config-only'` **or** the claimant declares that capability in the **union**
     of `supportedCapabilities` and `enabledCapabilities` — never `platformType`, which the input
     does not even carry (structurally impossible to get wrong).
4. **`authority-resolution.types.spec.ts`** — see §7.

### Phase 3 — `ReturnsAuthority` and its three mirrors

5. `libs/core/src/integrations/domain/types/adapter.types.ts` — append `'ReturnsAuthority'` with a
   comment citing ADR-052/#2351 in the style of the `Invoicing` / `Fiscalization` entries.
6. `…/__tests__/adapter.types.spec.ts` — extend the exact-array spec to 10 members.
7. `apps/web/src/features/connections/api/connections.types.ts` — add to `CORE_CAPABILITY_VALUES`.
8. `apps/web/src/features/connections/lib/capability-metadata.ts` — add the `CAPABILITY_HELP` entry.
   (`features/connections` is **not** a `check-ui-vocabulary.mjs` SCAN_ROOT — verified — so the
   sentence is unconstrained by the banned-term gate. It will still avoid model vocabulary.)
9. `docs/capabilities.md` — add a fenced `<!-- core-capabilities:start/end -->` list of the ten
   registry capabilities; rewrite the "#576" prose paragraph (`:40-43`) to point at the fence
   instead of restating the set (D6); add the `ReturnsAuthority` row to the `## Capability ports`
   table with an explicit "no port yet" cell (D9).

### Phase 3b — **C1: the lint-enforced plugin-guide mirror** *(missed by the first draft; `pnpm lint` fails without it)*

`scripts/check-plugin-guide-quotes.mjs` is chained into `check:invariants` and pins the array **by
line range** (`sourceStart: 23, sourceEnd: 42, guideLinkSubstring: 'adapter.types.ts:23-42'`).
A 10th member extends the array past line 42, so all four of these change in the same commit:

9a. `docs/plugin-author-guide.md` — the fenced verbatim copy of the array gains the member.
9b. `docs/plugin-author-guide.md:72` — the link text `adapter.types.ts:23-42` → the new end line.
9c. `docs/plugin-author-guide.md:72` — the anchor `#L23-L42` → likewise. **Same line, two
    occurrences**: a single-replace edit silently fixes only one, so verify both.
9d. `scripts/check-plugin-guide-quotes.mjs` — `sourceEnd` and `guideLinkSubstring`.
9e. `docs/plugin-author-guide.md:96-107` — the second (unenforced) capability table gains its row,
    per D9.

*Acceptance*: `node scripts/check-plugin-guide-quotes.mjs` passes, and the guide's quoted block is
byte-identical to the new source range.

### Phase 4 — The mirror script

10. **`scripts/check-core-capability-mirror.mjs`** — copied in mechanic from
    `check-authority-kind-mirror.mjs`: exported pure parsers (`parseCapabilityValues`,
    `parseDocsCapabilities`, `diffCapabilities`), three mirrors (core ↔ FE union, core ↔
    `CAPABILITY_HELP` keys, core ↔ docs fence), `--self-check` over synthetic fixtures **including
    deliberately drifted ones** (member missing from FE, member missing from docs, reordered,
    row outside the fence, unclosed fence).
    **Scope boundary (D6)**: it does **not** check the plugin guide — `check-plugin-guide-quotes.mjs`
    already owns that mirror, and duplicating it would give one fact two guards that can disagree.
11. **`package.json`** — chain `--self-check` then the real run into `check:invariants`, positioned
    beside the other capability/vocabulary checks.
12. **`check-authority-kind-mirror.mjs`** — re-point the mis-attributed pending mirror (D5).

### Phase 5 — Documentation

13. `docs/architecture-overview.md` § Capability Abstractions — the **ADR-056 pointer line**
    (refund/fiscal authority stays in OL permanently), placed with the "Capability is open at the
    registry boundary (#576)" paragraph, and naming this issue as ADR-056's first implementer via
    the hard-coded A6 row.
14. `docs/capabilities.md` — a short note under the authority-kinds fence that the *questions* are
    seven while the *kinds* are six, pointing at `AuthorityQuestionValues`.

---

## 7. Testing Strategy

All unit (`*.types.spec.ts`, co-located — the leaf's established convention). No integration test:
there is no I/O, no module and no route to boot.

**Acceptance-criteria coverage, one test per AC:**

| AC | Test |
|---|---|
| Every one of the seven questions returns a concrete answer **and a why line** on a zero-config install | `resolveAuthorities({ claimants: [] })` → 7 rows; every row has a `why` in `AuthorityWhyCodeValues`; **no row's answer is a "nothing to show" shape** (asserted positively, kind-by-kind, so §2.3's no-empty-state rule is proven, not assumed) |
| Two claims on one scope resolve `ambiguous` and change no behaviour | Two claimants both claiming `availabilityAuthority` with `scope: global` → A1 is `state: 'ambiguous'`, `answer.kind: 'cannot-tell'`, both ids in `candidateConnectionIds`; **the other six rows are byte-identical to the zero-config run** (that is what "changes no behaviour" means here); nothing throws |
| Resolution is pure — issues no I/O and constructs no adapter | (a) a deep-frozen input still resolves (no mutation); (b) the returned value is not `Promise`-like; (c) a static spec asserting the module's import list contains no `@openlinker/*` specifier — the leaf's empty allow-set made structural (also belt-and-braces for `barrel-purity.spec.ts`) |
| A6 is not assignable through any input | A claimant with `refundTrigger: true`, another with `{ enabled: true, isPrimary: true }`, and a third with `scopes` → A6 is **still** `openlinker` / `fixed-by-design` / `resolved`, and never `cannot-tell` even with two claimants (the case a naive implementation would get wrong) |
| `CoreCapabilityValues` gains exactly one member, drift in any of three fails the build | The extended exact-array spec; plus the script's own `--self-check` fixtures, one per drift direction |

**Also covered**: row order equals `AuthorityQuestionValues` order; a claimant declaring the config
key but **not** the gating capability is not eligible (A1/A5); a single claimant wins with
`isPrimary` absent (the #2047 zero-config property); a garbage `config` (`null`, `[]`, a string)
yields the default row rather than a throw.

---

## 8. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| **D1 reversed in review** (core should emit English) | Localised: add a copy map beside the codes. No shape change. Flagged explicitly rather than buried. |
| **A3's zero-config answer over-reaches** — deriving "My shop · Allegro" needs a marketplace-fulfilled distinction Wave 2 cannot observe | Superseded by **D11**: A3 defaults to `{ kind: 'default-today' }` and core names no shipping parties at all. `holders` stays reserved for actual claims. |
| Adding `ReturnsAuthority` ripples into routing/DTO int-specs | Per the standing lesson (manifest-capability changes ripple), run the **full** `pnpm test`. Gate audit found exactly one exhaustive `Record<CoreCapability, …>` (`CAPABILITY_HELP`), one full-list equality spec, no `toHaveLength(9)`, no mapped type, no exhaustive switch. The four `@IsIn` / `@ApiProperty({enum})` DTO sites **auto-widen** — no edit, and the widening is the intent. |
| **Setup wizards will now offer `ReturnsAuthority` as a checkbox** | `woocommerce-setup.schema.ts:56` / `prestashop-setup.schema.ts:80` use `z.enum(CORE_CAPABILITY_VALUES)`, and the two forms + `ConnectionCapabilitiesPanel` narrow with `.includes()` — all widen automatically. This is a **user-visible change the issue does not mention**. Judged correct and left as-is: a shop genuinely can hold returns disposition (A5's candidates are "OL · the marketplace · my other system"), and suppressing it would need a per-platform denylist, which is the `platformType` dispatch the architecture forbids. Verify the rendering is sane during implementation; if it must not be offered, that is a deliberate follow-up, not a silent omission. |
| `CAPABILITY_EXCLUSIVITY_PAIRS` | A list, not a `Record` — no compile break. Decided explicitly: `ReturnsAuthority` conflicts with nothing, so the list is **left untouched**. |
| The docs fence rewrite touches a paragraph other issues may edit concurrently | Fence is additive; the prose edit is one sentence. Re-fetch `origin/main` before committing. |
| `AuthorityWhyCode` grows in #2352 and the FE mirror lags | #2357 builds exactly that mirror script; the union is written textually-parseable from day one so #2357 needs no reshape. |

**Backward compatibility**: fully additive. No existing export changes shape; no runtime path gains
a caller (nothing imports `resolveAuthorities` until #2353). A zero-config install is byte-identical.

---

## 9. Alternatives Considered

1. **Put `resolveAuthorities` in a NestJS service in a new `fulfillment-authority` module.**
   Rejected: forces a module + tokens file onto a leaf whose documented posture (ADR-053) is to have
   neither until a DI binding exists; and a service could not be re-run in-memory by #2353's preview
   without instantiating a container.
2. **Extend `AuthorityKindValues` to seven and reuse it as the question space.**
   Rejected: the file forbids it in terms, and for a real reason — A7's answer belongs to
   `sales-documents`, so a seventh kind would invite a second resolver for a resolved question.
3. **Return `Record<AuthorityQuestion, AuthorityAnswerView>` instead of an ordered array.**
   Rejected: the surface is a *table* with a specified row order; a Record makes order the FE's
   problem and invites two orders. The array's totality is asserted directly.
4. **Reuse `AuthorityHolderSelection` as the answer type.**
   Rejected: it cannot express a compound (D4), `manual`, `nobody-to-route`, or `configured-elsewhere` —
   four of the six shapes spec §3.3 requires.
5. **Skip the new mirror script and rely on review discipline for the FE union + docs.**
   Rejected: the AC demands a build failure, and two of the three drifts are silent today (D6).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (domain-layer pure functions; no framework import)
- [x] Respects CORE vs Integration boundaries (no adapter, no platform name)
- [x] Uses existing patterns — `selectAuthorityHolder` / `parseAuthorityConfig` reused, not re-derived
- [x] Zero sibling-context edges preserved (empty allow-set honoured; asserted by a spec)
- [x] Capability-driven, never `platformType` (the input carries no platform field at all)
- [x] Idempotency / retries — N/A: a pure function with no side effect
- [x] Error handling — never throws by contract; malformed input yields the safe default row
- [x] No migration required, and the reason is recorded (§2)
- [x] Testing strategy maps one test to each acceptance criterion
- [x] Naming + file structure per `engineering-standards.md` (incl. the pure-rule exception)
- [x] Execution-ready

---

## Related Documentation

- `docs/plans/analysis/DESIGN-oms-authority-model.md` §2, §2.1, §2.2
- `docs/plans/analysis/REVIEW-oms-authority-model.md` (R1: G6, H6, P4, P5, P9)
- `docs/specs/product-spec-oms-wave2-operator-experience.md` §2.1, §2.3, §3.2, §3.3, §4.2
- ADR-052 (authority matrix), ADR-053 (the leaf + resolution placement), ADR-056 (A6/A7 never leave OL)
- `docs/architecture-overview.md`, `docs/engineering-standards.md`, `docs/testing-guide.md`
