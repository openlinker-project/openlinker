# Implementation Plan: `fulfillment` context + `FulfillmentWork` vocabulary leaf (#2391 / `W3a-2`)

**Date**: 2026-08-30
**Status**: Ready for Review
**Estimated Effort**: ~0.5–1 day
**Branch**: `2391-fulfillment-context` (from `origin/oms-programme-wave-3a`)
**Epic**: #2412 (Wave 3a, stream S1 — critical path: #2390 → **#2391** → #2392 → #2395 → …)

---

## 1. Task Summary

**Objective**: create the core bounded context `libs/core/src/fulfillment/` and publish the
`FulfillmentWork` vocabulary — the unit of fulfilment assignment — as a **zero-sibling-value-edge
vocabulary leaf**, registered in every place a new leaf must be registered, and pinned by a boot
integration test that proves the ADR-053 no-injection invariant on a real Nest container.

**Context**: ADR-054 makes `FulfillmentWork` the unit of assignment because OL cannot split a
commercial order (`identifier_mappings` is a bijection per connection, ADR-044) — so the *work* is
split and the order is left alone. Everything in Wave 3a stream S1 sits on this vocabulary: #2392
persists it, #2395 creates it in one transaction, #2406 projects it, #2410 renders it.

**Classification**: CORE / Domain.

---

## 2. Scope & Non-Goals

### In scope

- `libs/core/src/fulfillment/domain/types/*.types.ts` — the two orthogonal state axes, the work
  aggregate, its lines, its ref, and the action vocabulary.
- `libs/core/src/fulfillment/fulfillment.tokens.ts` + `index.ts` barrel.
- Registration: `barrel-purity.spec.ts` (`CONTEXT_BARRELS` + `ZERO_SIBLING_EDGE_LEAVES`),
  `libs/core/package.json` `exports`, `libs/core/src/index.ts` docblock (prose only — the leaf is
  **not** re-exported), `docs/architecture-overview.md`, `docs/engineering-standards.md`.
- `scripts/check-no-injection-contracts.mjs` — the `NO_INJECTION_CONTRACTS` entry #2390 armed.
- A boot integration test pinning the one-way edge (ADR-041 F3 precedent).
- Unit specs per types file (`as const` totality, guard narrowing, pure derivations).

### Out of scope (named, with owner)

| Deferred | Owner |
|---|---|
| `fulfillment_works` / `_lines` / `_holds` tables + repository | #2392 |
| `FulfillmentRouterPort`, `RoutingInput` / `RoutingPlan` / `RoutingExplanationStep` | #2393 |
| `routing_decisions` intent row | #2394 |
| `selectPrimaryFulfillmentRouter` + the #2047 four-part gate | #2395 |
| `FulfillmentExecutorPort` / `FulfillmentStatusSource` | #2398 |
| `assignmentAttempt` counter semantics, the handshake | #2399 |
| `IFulfillmentProgressService`, `'fulfillment'` inbound domain | #2400 |
| `supportedActions` **computation** + the optimistic-concurrency `version` field it is gated by | #2406 |
| `shipment_lines.fulfillmentWorkId` (the 1:N shipment linkage) | #2402 |
| Any UI | #2410 / #2411 |
| A2/A3 authority-resolution services (ADR-053 places them in this context) | later in Wave 3a |

### Constraints

- **ADR-053 no-injection invariant** (epic #2412 § Boundary rule): this context injects **no**
  `orders` / `inventory` service. Order data enters as arguments; type needs go through
  `@openlinker/core/orders/types`.
- No `synchronize: true`; this slice adds no ORM entity and therefore no migration.
- REVIEW P9: *authority* / *posture* / *FulfillmentWork* must never reach operator-facing copy. No
  UI ships here; no user-visible string is introduced. The ban is on **strings**, not identifiers.

---

## 3. Architecture Mapping

**Target layer**: CORE domain (`libs/core/src/fulfillment/domain/types/`).

**Core vs Integration**: `FulfillmentWork` **crosses the port** to third-party executors (design
§3 adjudication 6: "`FulfillmentWork` lives in core … the OMS plugin owns only its private working
state (`oms_*` tables)"). It cannot live in `libs/oms`, which is one implementer among several
(a 3PL adapter and an enterprise DOMS adapter are the others).

**Leaf posture** (ADR-053): types-and-pure-functions, following `sales-documents` (#2100),
`fulfillment-authority` (#2304) and `order-lifecycle` (#2305). The load-bearing property is **zero
sibling-core-context value edges**, not framework-freedom — the latter ends the day the context
needs a binding (#2392), and ADR-053 says so explicitly.

**Existing vocabulary consumed, never redeclared** (see § 5, findings F1/F2).

---

## 4. Design

### 4.1 Two orthogonal state axes (ADR-054, design §5.2)

```ts
// domain/types/fulfillment-work-status.types.ts
export const FulfillmentWorkStatusValues = [
  'open', 'scheduled', 'on_hold', 'in_progress', 'closed', 'cancelled', 'incomplete',
] as const;

// domain/types/fulfillment-request-status.types.ts
export const FulfillmentRequestStatusValues = [
  'unsubmitted', 'submitted', 'accepted', 'rejected',
  'cancellation_requested', 'cancellation_accepted', 'cancellation_rejected',
] as const;
```

Collapsing them yields the "cancel is a command" bug — cancelling *accepted* work is a
**negotiation**, not an order (ADR-054 § Alternatives, mirroring ADR-007's status-vs-outcome split).
Each ships with a co-located `is*` narrowing guard, per the `AuthorityKind` precedent.

### 4.2 Lines carry COUNTERS, not statuses

```ts
export interface FulfillmentWorkLine {
  readonly id: string;
  readonly orderLineId: string;        // by-value reference into the order snapshot
  readonly productVariantId: string;
  readonly totalQuantity: number;
  readonly fulfilledQuantity: number;
  readonly cancelledQuantity: number;
}
```

"3 of 5 shipped" is not a status (design §5.2). The invariant
`fulfilledQuantity + cancelledQuantity <= totalQuantity` becomes the DB `CHECK` in **#2392**; here
it is expressed as one **pure read-only derivation** (`isFulfillmentWorkLineWithinCapacity`) under
the ADR-011 allowance, plus `remainingQuantity`. No mutation method, no `async`, no cross-aggregate
reach — ADR-011's anemic-by-default rule.

### 4.3 The aggregate, its ref, and the action vocabulary

```ts
export interface FulfillmentWorkRef {          // what an executor is handed
  readonly workId: string;
  readonly connectionId: string;
}

export const FulfillmentWorkActionValues = [
  'submit', 'accept', 'reject', 'request_cancellation',
  'accept_cancellation', 'reject_cancellation', 'hold', 'release_hold',
  'mark_in_progress', 'close', 'force_cancel',
] as const;

export interface FulfillmentWork {
  readonly id: string;
  readonly orderId: string;                    // plain internal id — NOT an `Order`
  readonly locationId: string | null;
  readonly deliveryMethod: string | null;
  readonly assignedConnectionId: string | null;
  readonly status: FulfillmentWorkStatus;
  readonly requestStatus: FulfillmentRequestStatus;
  readonly assignmentAttempt: number;
  readonly cancellationReason: FulfillmentCancellationReason | null;
  readonly lines: readonly FulfillmentWorkLine[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

`orderId` is a **plain string**, which is what keeps the no-injection invariant cheap: the context
never needs an `Order`, so it never needs `@openlinker/core/orders/types` either.

`supportedActions` is deliberately **not** a field here. Design §5.2 computes it *server-side on the
read model*, gated by an optimistic-concurrency token — that is #2406's, and putting it on the
aggregate would invite a client to compute it locally, which is the state-machine drift the design
exists to kill. This slice ships only the closed action **vocabulary** those two consume.

---

## 5. Findings & decisions (the parts a reviewer should look at first)

### F1 — `FulfillmentCancellationReasonValues` already exists. Do not redeclare. → **one-entry allow-set**

The issue body asks this leaf to declare it (REVIEW H14: "`operator_forced` was referenced by no
union"). **Wave 1a already closed that**: it ships at
`libs/core/src/fulfillment-authority/domain/types/fulfillment-cancellation-reason.types.ts` (#2304),
with five members and an `is*` guard.

`FulfillmentWork.cancellationReason` needs it (ADR-054: force-close lands on `cancelled` "with
reason `operator_forced` — a member of the declared union"). Two options:

| Option | Cost |
|---|---|
| **(a) type-only import** from `@openlinker/core/fulfillment-authority`, registered as this leaf's single `authorizedTypeOnlySpecifiers` entry | one deliberate allow-set line |
| (b) omit the field this slice; #2392 adds it with the column | the aggregate cannot express *why* work was cancelled — the exact distinction ADR-054 calls load-bearing |

**Recommend (a).** The alternative to a one-entry allow-set here is not an empty allow-set — it is
**two spellings of one union**, which is precisely the drift the leaves exist to prevent (ADR-053
§ Alternatives: "Vocabulary duplicated per context: the FE/SQL mirrors and the selection rule would
drift"). It is safe for the same reason `order-lifecycle`'s carve-out is: the import is **type-only**
(erased at build time, so no runtime edge) *and* the target is itself a leaf with an empty
allow-set, so no cycle is reachable even in principle. It must be spelled `import type { … }` — the
walker classifies inline `import { type X }` as a value import and fails.

### F2 — `HoldReason` already exists. Do not redeclare, and do not import it either.

The issue body lists `HoldReason` as leaf content. Wave 2 shipped it in `order-lifecycle` (#2305),
per design adjudication #4 ("one hold-reason vocabulary, two hold grains… living in the
`order-lifecycle` leaf, used by both `order_holds` and `fulfillment_holds`"), and its own docblock
forbids re-prefixing it. This slice ships **no** `fulfillment_holds` type (holds are first-class
rows landing with #2392's schema), so it needs no import either — allow-set stays at one entry.

### F3 — `fulfillment.tokens.ts` conflicts with the shipped standard. **Ship it anyway, empty.**

`engineering-standards.md § Symbol DI Token Re-export Convention` states in as many words that for a
vocabulary-only concern "an empty `<ctx>.tokens.ts` would be ceremony", and **neither** shipped leaf
carries one. But #2391's AC overrides the exemption explicitly ("the `.tokens.ts` **exemption does
not apply** here"), and the override is coherent: the exemption is for a concern that is
*vocabulary-only*, and `fulfillment` is known not to be — #2392 lands
`FULFILLMENT_WORK_REPOSITORY_TOKEN` in the very next issue, and ADR-053 places the A2/A3 resolution
services here too.

**Decision**: ship the file with a header stating it is empty-until-#2392, plus the sub-barrel
`export *` line so #2392 cannot forget it. `export *` from a module with no exports is legal and
widens the barrel with nothing. Flagged for `/tech-review` to overrule; if overruled, defer the file
to #2392 and record the deviation from the AC in the PR body.

### F4 — the `no-injection` guard is **necessary but insufficient**, and its complement is a boot test

The script is a source-text scan; it cannot see `ModuleRef.get(TOKEN, { strict: false })`, an idiom
already live in this codebase (`InvoiceService` uses exactly it). The complement is the ADR-041 F3
precedent: `apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts`, which observes the
**resolved provider graph** rather than the import text.

### F5 — `libs/oms` must NOT be registered in the no-injection contract

ADR-055 designs the plugin to **receive** those services as factory deps
(`createOmsPlugin({inventoryQuery, orderRecords, …})`). The contract constrains a **core context**.
#2390's script header records that #2405 would have to delete such a contract in its first commit.

---

## 6. Implementation plan

### Phase 1 — the leaf (files)

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/fulfillment/domain/types/fulfillment-work-status.types.ts` | `FulfillmentWorkStatusValues` + type + `isFulfillmentWorkStatus`, per-member JSDoc citing design §5.2 | 7 members, `as const`, no `enum` |
| 2 | `.../fulfillment-request-status.types.ts` | same shape, 7 members | negotiation axis documented as orthogonal |
| 3 | `.../fulfillment-work-action.types.ts` | closed action vocabulary + guard; docblock states #2406 computes *which* are legal | no `supportedActions` computation |
| 4 | `.../fulfillment-work.types.ts` | `FulfillmentWorkRef`, `FulfillmentWorkLine`, `FulfillmentWork`, + the two pure derivations | ADR-011: pure, sync, no I/O, no params beyond own fields |
| 5 | `libs/core/src/fulfillment/fulfillment.tokens.ts` | empty, header per F3 | Symbol-only (vacuously) |
| 6 | `libs/core/src/fulfillment/index.ts` | leaf-style docblock (`@module`, `@see` ADR-053 + ADR-054), types-first `export *`, then `export * from './fulfillment.tokens'` | barrel purity passes |

Specs colocated per file (`*.types.spec.ts`), following both leaf precedents.

### Phase 2 — registration

| # | File | Action |
|---|---|---|
| 7 | `libs/core/src/__tests__/barrel-purity.spec.ts` | `'fulfillment'` into `CONTEXT_BARRELS` (alphabetical, after `'events'`); `{ context: 'fulfillment', authorizedTypeOnlySpecifiers: ['@openlinker/core/fulfillment-authority'] }` into `ZERO_SIBLING_EDGE_LEAVES`; one docblock bullet stating F1's reason |
| 8 | `libs/core/package.json` | `"./fulfillment"` exports entry beside the other three leaves |
| 9 | `scripts/check-no-injection-contracts.mjs` | the `NO_INJECTION_CONTRACTS` entry (**already applied + verified red-first**, § 8) |
| 10 | `libs/core/src/index.ts` | docblock prose names the fourth leaf; **no** `export *` |
| 11 | `docs/architecture-overview.md` | new `### 26. Fulfillment` section; leaf count three → four; cross-context map note |
| 12 | `docs/engineering-standards.md` | the tokens-exemption paragraph names `fulfillment` as the concern that does **not** hold it, with F3's reason |

### Phase 3 — the boot test

| # | File | Action |
|---|---|---|
| 13 | `apps/worker/test/integration/fulfillment-no-injection-boot.int-spec.ts` | boot the real container; assert nothing reachable from the fulfillment barrel resolves an `orders`/`inventory` service |

**Verify it red first** by temporarily injecting an `orders` service into a provider under
`libs/core/src/fulfillment/` — a *realistic* removal, not an unused-import deletion (#2390's first
R10 attempt went red on `TS6133` with `Tests: 0 total`, which is a false pass).

**Placement caveat**: `pnpm test:integration` runs `@openlinker/api` only (#2670), so a worker
int-spec is **not** executed by it and must be run explicitly. That worker suite is also
order-dependent (only 4 of 25 specs set `OL_PII_HASH_SALT`).

---

## 7. Alternatives considered

1. **`FulfillmentWork` in `libs/oms`** — rejected: it crosses the port to third-party executors
   (design adjudication 6). A 3PL adapter would have to depend on the OL-OMS plugin.
2. **One merged state axis** — rejected by ADR-054: yields "cancel is a command".
3. **Per-line status instead of counters** — rejected by design §5.2: a status cannot express
   "3 of 5 shipped", and partial fulfilment is the whole point of the grain.
4. **Redeclaring the cancellation union locally to keep an empty allow-set** — rejected per F1:
   trades one reviewed allow-set line for two drifting spellings of one union.
5. **`supportedActions` on the aggregate** — rejected: #2406 computes it server-side with a
   concurrency token; a field here invites client-side recomputation.

---

## 8. Validation & risks

### Already verified (red-first, before any code — see PR body)

| Step | Expectation | Result |
|---|---|---|
| dir absent | green | `OK (0 contract(s) … 1 watched, 0 present)`, exit 0 |
| dir exists, unregistered | **red (R1)** | `exists but has no entry in NO_INJECTION_CONTRACTS`, exit **1** |
| contract registered | green | `OK (1 contract(s) … 1 present)`, exit 0 |
| file imports `@openlinker/core/orders` | **red (R3)** | `imports '@openlinker/core/orders', which this context's no-injection contract forbids`, exit **1** |
| file imports `@openlinker/core/orders/types` | green (R3 escape hatch) | exit 0 |
| `--self-check` | green | `self-check OK (10 cases)` |

### Risks

| Risk | Mitigation |
|---|---|
| Barrel-purity walker asserts `files.length > 0` — an empty leaf directory **fails** | phase 1 lands files before phase 2 registers the leaf |
| Inline `import { type X }` is classified as a **value** import and fails the walker | use `import type { … }`; asserted by the spec |
| Vocabulary drift with #2392's DB `CHECK` | the pure derivation is the single expression of the invariant; #2392's migration mirrors it |
| P9 vocabulary leak | no UI, no user-visible string; identifiers are exempt by the rule's own text |
| Docs claim a count that goes stale | phrase leaf counts as *"after this change"* rather than *"now"* |

### Backward compatibility

Additive only. No existing file changes behaviour; the four doc/registration edits are declarative.
No migration (no ORM entity). No `synchronize: true`.

---

## 9. Testing strategy & acceptance

**Unit** (`libs/core`): per-types-file specs — union totality (`as const`, member list), guard
narrowing including a negative case, and the two pure derivations at their boundaries
(`fulfilled + cancelled === total`, and one over).

**Structural**: `barrel-purity.spec.ts` covers the new leaf automatically once registered.

**Invariants**: `pnpm check:invariants` (expected count **35** after #2390) — including
`check-no-injection-contracts`, `check-cross-context-imports`, `check-service-interfaces`.

**Integration**: the boot spec of Phase 3, verified red first.

### Acceptance criteria (mirrors #2391)

- [ ] Every union is `as const` + derived type; no TS `enum`
- [ ] Barrel-purity spec covers the new context; H13 conformance satisfied (package `exports`,
      architecture-overview map entry, ADR pointer lines)
- [ ] `fulfillment.tokens.ts` present with sub-barrel `export *` (F3)
- [ ] `synchronize: true` not introduced
- [ ] No import of `@openlinker/core/orders` or `@openlinker/core/inventory` in `domain/**`
- [ ] Boot integration test pins the one-way edge, seen red first
- [ ] `pnpm lint` / `type-check` / `test` / `test:integration` green

---

## 10. Questions & assumptions

**Assumptions**
- A1 — Wave 1a/1b/2 entry criteria are merged on `oms-programme-wave-3a`. Verified: both leaves and
  `HoldReason` are present on the base.
- A2 — `orderId` / `locationId` / `productVariantId` are plain internal-id strings. This is what
  keeps the no-injection invariant free of an `orders/types` import.
- A3 — `deliveryMethod` is an opaque string at this grain; ADR-020's neutral delivery intent is the
  shipping layer's and is not subsumed here (ADR-054 § Consequences).

**Open questions (non-blocking)**
- Q1 — F3's tokens file: ship-empty vs defer to #2392. Recommendation: ship. `/tech-review` rules.
- Q2 — Should `FulfillmentWorkLine` carry `sku`? Deferred: #2392 owns the columns, and a field with
  no writer is a permanently-null property.

---

## 11. Gate resolutions (`/pre-implement` + `/tech-review`, applied)

Both gates ran against this plan before implementation. Verdicts: **GO WITH CHANGES** and
**Request changes**. Every finding below is applied in the shipped diff.

### BLOCKING

- **B1 — empty tokens file would not compile.** A `.ts` file with no export statement is not a
  module, so `export * from './fulfillment.tokens'` fails `TS2306`. **Applied**: the file carries
  `export {};` plus its header.
- **B2 — the boot test as specified was vacuous.** This slice ships no `@Module` / `@Injectable` /
  provider, so a container-graph assertion has no subject, and the only red demonstration would be
  against a provider that never merges — the #2390 R10 false-pass shape. **Applied**: the spec
  asserts a fact that is true *today* (no Nest decorator exists anywhere under
  `libs/core/src/fulfillment/`, so no container path can exist) **and** arms the provider-graph
  assertion automatically the day one appears. It cannot pass vacuously after #2392.

### Resolved conflict between the gates

`/pre-implement` required dropping `fulfillment.tokens.ts`; `/tech-review` required shipping it.
**Shipping it.** `engineering-standards.md:818` conditions the exemption on a concern being
vocabulary-**only**, and :820 fixes its expiry at "the day the concern needs a binding" — which is
nameable here (#2392's `FULFILLMENT_WORK_REPOSITORY_TOKEN`; ADR-053 also places the A2/A3
resolution services in this context). The two shipped leaves hold the exemption because on their
ship day nobody could name their first binding. This is the standard applied, not deviated from —
so `engineering-standards.md:822` gains `fulfillment` as the concern that does **not** hold it,
with that reason.

### Applied changes

1. `FulfillmentWorkActionValues` gains `schedule` — nothing in the eleven-member draft reached the
   `scheduled` state, and a closed vocabulary that cannot express a transition into one of its own
   declared states is the drift a leaf exists to prevent. `incomplete` is documented as entered by
   a `short_picked` progress event (design §5.4), **not** by an action.
2. Every action member carries DESIGN-VERBATIM / INFERRED provenance with its deriving sentence,
   copying `fulfillment-cancellation-reason.types.ts`'s discipline verbatim.
3. ADR-059's "actions yes, states no" is ruled on in the action docblock rather than left implicit.
4. `barrel-purity.spec.ts`'s docblock is amended: its ":148-152" sentence declares a main
   `@openlinker/core/<ctx>` barrel authorization impossible, and this leaf's entry is the first.
   The amendment states the **condition** that makes it safe (type-only **and** the target is
   itself registered in `ZERO_SIBLING_EDGE_LEAVES` exporting no NestJS module) so the justification
   cannot silently expire if `fulfillment-authority` later gains a module.
5. `scripts/check-no-injection-contracts.mjs`'s docblock said the directory "does not exist yet"
   and the list is "EMPTY TODAY" — both false once this lands; corrected in the same commit.
6. Two structural assertions, not one: the walker's non-empty check **and** `CONTEXT_BARRELS`'
   `Object.keys(mod).length > 0` (a barrel of pure `interface`/`type` exports would fail it; the
   `*Values` arrays and `is*` guards satisfy it).
7. The pure derivations cite the `*.types.ts` **pure-rule exception** as their authority, not
   ADR-011 — the shapes are readonly `interface`s, so ADR-011 (entity methods) is not engaged; it
   is cited only as the reason no method hangs off the shape.
8. Namespaced exports: `readFulfillmentWorkLineRemainingQuantity` and
   `checkFulfillmentWorkLineCapacity` (the `checkRequiredToSell` precedent) — a bare
   `remainingQuantity` on a public subpath is a collision hazard, and an `is*` prefix is reserved
   for narrowing guards.
9. `locationId` / `deliveryMethod` document their producer and what `null` means, since they define
   the grain and are the two fields with neither a vocabulary nor a writer in this slice.
10. `FulfillmentWorkRef.connectionId` is documented as the holder connection **at the time the ref
    was minted**, which is why it is not merely `assignedConnectionId` re-read.
11. `routingDecisionId` (#2395) and `acceptedAt` (#2399) named in §2's out-of-scope table — both
    are work-row fields ADR-054 names, and leaving them unlisted invites re-litigation.
12. Doc scope widened: the cross-context **mermaid graph** (`fulfillment --> fulfillment-authority`),
    the zero-outbound-edge-leaf enumerations in §20/§21/§22, `libs/core/src/index.ts:9-11` and
    `engineering-standards.md:822`. `docs/plans/oms-backlog-overview.md` was checked and needs no
    edit — it carries no per-issue entry for `W3a-2`, only the dependency chain.
13. Counts are stated as **35 distinct scripts / 61 invocations** and phrased *"after this change"*,
    never as a bare "now".
14. Placement caveat corrected: worker int-specs are skipped only by the **root** `pnpm
    test:integration` script (which filters to `@openlinker/api`); CI runs them
    (`.github/workflows/ci.yml:322`).

15. The documented `@openlinker/core/orders/types` escape hatch is qualified in all three places
    that state it (`fulfillment/index.ts`, architecture-overview § 26, the guard's docblock): it is
    permitted by the no-injection SCRIPT's exact-specifier match, but `barrel-purity.spec.ts`
    rejects every `@openlinker/core/*` specifier absent from the leaf's own allow-set, type-only
    included. Left unqualified, #2392/#2398 would follow a stated route into a red build. It is
    deliberately NOT pre-registered — a carve-out must stay a deliberate one-line act.

### Rejected

- Deferring the boot test wholesale to #2392 (pre-implement's option a). The AC asks for it and a
  fail-closed, self-arming spec satisfies it honestly.
- Moving the boot spec into `libs/core` as a unit test so `pnpm test` covers it (the arming arm
  otherwise fires only in CI's worker job, since the root `test:integration` filters to
  `@openlinker/api` — #2670). Epic #2412 asks specifically for a boot **integration** test, and
  #2392 — which adds the first provider and so trips the arm — will need a real container anyway.
  The coverage caveat is recorded rather than resolved by relocating a mandated artefact.
- Registering `libs/oms` in the no-injection contract — ADR-055 designs it to *receive* those
  services; #2405 would delete the contract in its first commit.

---

## Related documentation

- [ADR-052](../architecture/adrs/052-independently-assignable-fulfillment-authorities.md),
  [ADR-053](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md),
  [ADR-054](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md),
  [ADR-055](../architecture/adrs/055-oms-as-credentialless-connection-plugin.md),
  [ADR-011](../architecture/adrs/011-domain-entity-behavior.md)
- `docs/plans/analysis/DESIGN-oms-authority-model.md` §5.2 / §5.5 / §9
- `docs/plans/analysis/REVIEW-oms-authority-model.md` (H13, H14, P9)
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md)
