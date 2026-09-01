# Implementation Plan: Fulfilment worklist read model — `supportedActions` + optimistic token + 409

**Date**: 2026-08-31
**Status**: Ready for Review
**Issue**: #2406 (`W3a-19`), epic #2412 (Wave 3a, stream S1)
**Estimated Effort**: ~1.5 days

---

## 1. Task Summary

**Objective**: ship the read model an operator worklist is driven by — `GET /fulfillment/works`
(filterable) and `GET /fulfillment/works/:workId`, each returning the work, its counter-bearing
lines, its active holds, a server-derived `supportedActions[]` and a `version` optimistic token —
plus the token-guarded action endpoint that answers **409 carrying the refreshed action set** when
the token is stale.

**Context**: DESIGN §5.2 + REVIEW C10. *"The read model returns `supportedActions` with the
resource — the server tells the client what is legal next, which kills client-side state-machine
drift across heterogeneous executors … and actionable only with an optimistic-concurrency token:
an action against a stale version answers 409 with the refreshed set (R1)."*

Two consequences, neither optional:

1. **`supportedActions` is derived server-side and never mirrored in the FE.** #2391 shipped the
   action vocabulary and deliberately did **not** put `supportedActions` on the aggregate, *"a
   field here would invite a client to recompute legality locally, which is precisely the
   client-side state-machine drift 'actions yes, states no' exists to kill."* This plan does not
   add that field; it derives the value in the read.
2. **Without the token those actions go stale and a second operator double-ships.**

**Classification**: CORE (application + domain) + Interface (`apps/api/src/fulfillment/**`).

---

## 2. Scope & Non-Goals

### In scope

- Pure derivation `deriveSupportedActions` over the two orthogonal axes + active-hold count.
- `IFulfillmentWorklistService` — `list`, `get`, `applyAction`.
- Repository: a bounded `listWorks` query and **one** conditional version-claim UPDATE.
- `apps/api/src/fulfillment/` — controller, request DTOs, explicit-allowlist response DTOs,
  409 mapping.
- A `check:invariants` guard proving the FE holds no copy of the derivation.

### Out of scope (with owners)

- **Any FE.** #2410 (desktop worklist), #2411 (order-detail panel) consume this.
- **`submit` / `request_cancellation` endpoint wiring.** Both are *legal operator intents* and the
  pure function derives them, but executing either needs a resolved `FulfillmentExecutorPort`
  (`IFulfillmentHandshakeService.dispatch` / `.requestCancellation` both take `executor` as an
  argument — the caller resolves it). Executor resolution is #2409's. See §5 for the decision and
  why they are filtered from the exposed set rather than exposed-and-refused.
- **The four holder-side replies** (`accept`, `reject`, `accept_cancellation`,
  `reject_cancellation`). Structurally not operator actions — they are the executor's answers,
  recorded by #2399's `recordAcceptance` / `recordRejection`. Excluded by construction.
- No migration. `fulfillment_works.version` already exists (#2392).

### Constraints

- ADR-053 no-injection invariant: the `fulfillment` context injects **no** `orders` / `inventory`
  service. Nothing in this plan does.
- `FulfillmentWorkRepositoryPort` stays **off** the barrel (deny pattern in
  `check-cross-context-imports.mjs`). Sibling access is via `I*Service` only.
- `fulfillment.tokens.ts` rule 6: Symbol declarations only.

---

## 3. Architecture Mapping

| Layer | Component |
|---|---|
| CORE domain | `deriveSupportedActions` (pure), `FulfillmentWorkVersionConflictError`, `UnsupportedFulfillmentWorkActionError` |
| CORE application | `IFulfillmentWorklistService` + `FulfillmentWorklistService`, view types |
| CORE infrastructure | `FulfillmentWorkRepository.listWorks`, `.claimWorkVersion` |
| Interface | `apps/api/src/fulfillment/http/fulfillment-work.controller.ts` + DTOs |

**Reused**: `FulfillmentWorkRepositoryPort` (`findById`, `listActiveHolds`, `transitionStatus`,
`cancel`, `placeHold`, `releaseHold`, `applyGuardedUpdate`), the `FulfillmentWorkStatus` /
`FulfillmentRequestStatus` / `FulfillmentWorkAction` vocabulary leaves (#2391), `JwtAuthGuard`.

**Why CORE**: legality over the two axes is domain logic shared by the HTTP surface and (later)
by MCP/worker callers. Only the transport lives in `apps/api`.

---

## 4. The derivation

New file `libs/core/src/fulfillment/domain/types/fulfillment-supported-actions.types.ts` —
domain-layer, pure, framework-free, qualifying for the `engineering-standards.md` **pure-rule
exception** (pure; it *is* the rule for the vocabulary it derives over; both halves change
together).

It is a **new file, not an edit to #2391's `fulfillment-work-action.types.ts`** — that file is a
live sibling-conflict surface, and the vocabulary and its legality rule are separately owned.

```ts
export interface SupportedActionsInput {
  readonly status: FulfillmentWorkStatus;
  readonly requestStatus: FulfillmentRequestStatus;
  readonly activeHoldCount: number;
  readonly assignedConnectionId: string | null;
}

export function deriveSupportedActions(
  input: SupportedActionsInput
): readonly FulfillmentWorkAction[];
```

Rules (`TERMINAL = ['closed','cancelled','incomplete']`, `held = activeHoldCount > 0`):

| Action | Legal when |
|---|---|
| `schedule` | `status ∈ {open, on_hold}` && `!held` |
| `submit` | `!TERMINAL` && `!held` && `assignedConnectionId !== null` && `requestStatus ∈ {unsubmitted, rejected}` |
| `request_cancellation` | `!TERMINAL` && `requestStatus === 'accepted'` |
| `hold` | `!TERMINAL` && `activeHoldCount < FULFILLMENT_HOLD_ACTIVE_LIMIT` |
| `release_hold` | `held` |
| `mark_in_progress` | `status ∈ {open, scheduled, on_hold}` && `!held` |
| `close` | `status === 'in_progress'` |
| `force_cancel` | `!TERMINAL` |

Two properties the file states in prose and its spec pins:

- **`on_hold` and `incomplete` are never *produced* by an action.** `hold` writes a
  `fulfillment_holds` row (`on_hold` is the consequence); `incomplete` is reached only by a
  `short_picked` progress event (#2400). #2391 records both absences; the derivation must not
  imply otherwise, so `held` suppresses every forward-motion action rather than an action
  targeting `on_hold` existing.
- **The four holder replies are absent by construction**, for the reason in §2.
- **`activeHolds` is the authority on heldness, NOT `status`.** Verified against the tree: nothing
  writes `status = 'on_hold'` — `placeHold` inserts the hold row and does not touch `status`, and
  the per-column writer table names `status`'s writers as `create` / `transitionStatus` / `cancel`
  only; `'on_hold'` appears as a `from` value and never as a `to`. So a held work reads
  `status: 'open'` with a non-empty `activeHolds[]`. The derivation is unaffected (it keys on
  `activeHoldCount`), but the **view ships both to a browser**, so #2410 must render heldness from
  `activeHolds`, not from `status`. Whether `on_hold` should ever be written is #2392/#2400's
  question and is not widened here.
- **`on_hold` is admitted to the `schedule` / `mark_in_progress` antecedents when `!held`** so that
  a work which somehow reaches that status with every hold released is not permanently stranded
  short of forward motion (its only exits would otherwise be `hold` and `force_cancel`). Defensive
  given the paragraph above, and cheap.
- **`close` requires `in_progress`, so observation-only work is never closed by OL.** An
  `omp_fulfilled` work "may never leave `open`" per the status vocabulary, and its only terminal is
  therefore `force_cancel` — which ADR-054 keeps deliberately distinct from completion. Stated as
  intended rather than left as a gap.
- **`hold` is derived legal below `FULFILLMENT_HOLD_ACTIVE_LIMIT` but enforced at write time**, so
  a racing tenth hold can still be refused. Benign, and named here because it is the same "never
  offer a control that would 400" standard the exposure gate is justified by.

### Exposure gate

`OPERATOR_INVOCABLE_ACTIONS` (a `Set`) filters the derived set at the **service** boundary before
it reaches the view — today dropping `submit` and `request_cancellation`. The pure function
derives them and its spec asserts their legality, so the *rule* is written and tested now; only
its *exposure* is gated, and lifting the gate when #2409 lands the executor seam is a one-line
edit. Omission is the safe direction: an operator is never offered a control that would 400.

---

## 5. The optimistic token

`fulfillment_works.version` (#2392) is already bumped by every `applyGuardedUpdate` write.

### Mechanism — `expectedVersion` in the existing guards' own `WHERE`

`fulfillment-work-repository.port.ts:32-35` reserved this by number: *"Input shapes are objects,
deliberately. **#2406 will add an `expectedVersion` precondition to the mutating methods**; an
object shape makes that purely additive instead of a nine-signature widening."*

So: add `readonly expectedVersion?: number` to `TransitionFulfillmentWorkStatusInput`,
`CancelFulfillmentWorkInput`, `PlaceFulfillmentHoldInput`, `ReleaseFulfillmentHoldInput`. Optional
⇒ additive, no caller breaks. When present, `applyGuardedUpdate` gains
`.andWhere('"version" = :expectedVersion')`, so **the state predicate, the version predicate and
the write are one statement**. This is REVIEW C10 as written: *"conditional UPDATE per axis
transition; optimistic-concurrency token required on actions"*.

### Why NOT a standalone `claimWorkVersion` (rejected after review)

An earlier draft used one conditional `UPDATE … SET version = version + 1 WHERE version = :expected`
as a claim, then acted. Three defects, each disqualifying:

1. **It reverses a written contract.** `fulfillment-work.types.ts` on `version`: *"Counts **state
   changes, not writes** … a caller replaying an already-applied action sees 'not applied' against
   an UNCHANGED version, **which must not be reported as a stale-token 409**."* A claim conditioned
   only on the token bumps unconditionally — double-bumping on success and turning every ordinary
   network-timeout replay into a false 409.
2. **It does not close the double-ship window.** Claim and effect are two statements. A claims
   v5→v6 and begins; B re-reads, receives v6 whose action set is *still stale* because A's axis has
   not moved, claims v6→v7, and performs the same action.
3. **Its stated cost was wrong.** "Six signatures to change" is not the cost — the port's object
   shapes exist precisely so the change is additive.

Threading additionally **buys a distinction the claim could not make**, which is what satisfies the
docblock in (1): a write that matched the version but not the state predicate leaves `version`
unchanged, so `expectedVersion === work.version` still holds and the service reports a **state**
refusal (`FulfillmentWorkActionNotLegalError` → 409 *"no longer legal"*), never a stale-token 409.
Distinguishing the two is only possible because the version rides in the same WHERE.

### Hold actions

`placeHold` INSERTs into `fulfillment_holds` and `releaseHold` UPDATEs it — neither has a
`fulfillment_works` UPDATE to hang the predicate on. Both therefore run inside the existing
`runInTransaction`, which first executes a version-guarded bump of the work row
(`SET version = version + 1 WHERE id = :id AND version = :expectedVersion`) and proceeds only if it
affected a row. The bump is **contract-correct here and not in the rejected claim**: placing or
releasing a hold *is* a state change, and it happens in the same transaction as the effect, so
claim-to-effect is serialised rather than merely token-checked.

### Token scope — HEADER ONLY, stated because the tree says so

`fulfillment-work.repository.ts:30-36`, addressed to this issue by number: *"`recordLineProgress`
deliberately does NOT bump the header's `version` … a client holding a version cannot detect that
counters moved underneath it, so **#2406 must not use `version` alone to decide that a work object
is unchanged.**"*

**Decision (a): the token guards HEADER TRANSITIONS ONLY.** `lines[].fulfilledQuantity` /
`cancelledQuantity` are **display-only** in this view and are explicitly not protected by it. This
is safe today because no action in `OPERATOR_INVOCABLE_ACTIONS` reads a counter. The risk an
operator carries is bounded and must be stated in the UI copy (#2410): a count on screen may be
lower than reality if a progress event landed between the read and the click — they may close work
believing less was picked than was.

**The condition that ends this decision, named so it cannot be crossed silently**: the moment any
action's legality depends on a counter (the obvious candidate is making `close` require
`fulfilled + cancelled === total`), a header-only token is no longer sufficient and this must be
re-decided — either `recordLineProgress` bumps (which reverses #2400's stated decision and is not
this issue's call) or the counters leave the view. A spec pins that no member of
`OPERATOR_INVOCABLE_ACTIONS` reads a line counter, so adding one fails the build here.

### The refreshed `version` in the 409 body

Obtained by re-reading via `findById` on the conflict path. That read can itself be stale by the
time it returns, and is **documented as a best-effort snapshot rather than a guarantee**: the
client's retry is guarded by the same token, so a stale refresh costs one additional 409 and can
never produce a wrong write. `applyGuardedUpdateReturning` cannot serve here — on a conflict the
UPDATE affected no row, so it returns nothing to read a version out of.

---

## 6. The projection

`FulfillmentWorkView` is an **explicit allowlist**, never a spread of `FulfillmentWork`. This read
reaches an operator's browser and the context sits one hop from `RoutingShipTo`, which carries
buyer PII (ADR-062). The view embeds no ship-to, no customer, no address.

Pinned by a spec using the distributing helper `type KeysOf<T> = T extends unknown ? keyof T : never`
(`routing-ship-to.types.spec.ts`'s shape) — **not a bare `Extract<keyof …>`**, because `keyof` over
a union is the *intersection* and such an assertion reads `never` and stays green forever
(the trap `fulfillment-execution.types.spec.ts` documents).

Fields: `id`, `orderId`, `locationId`, `deliveryMethod`, `assignedConnectionId`, `status`,
`requestStatus`, `assignmentAttempt`, `cancellationReason`, `externalWorkId`, `version`,
`acceptedAt`, `cancelledAt`, `createdAt`, `updatedAt`, `lines[]` (`id`, `orderLineId`,
`productVariantId`, `totalQuantity`, `fulfilledQuantity`, `cancelledQuantity`), `activeHolds[]`
(`id`, `reason`, `note`, `placedAt`), `supportedActions[]`.

Deliberately excluded: `dispatchRelayedAt` (internal relay hygiene, #2401), `placedByService`
on holds (internal actor), and every ship-to/customer field.

---

## 7. Endpoints

All `@UseGuards(JwtAuthGuard)`; class-validator DTOs.

| Route | Notes |
|---|---|
| `GET /fulfillment/works` | `status`, `requestStatus`, `locationId`, `orderId`, `limit` (1–100, default 25), `offset`. Enum members validated against the vocabulary arrays. |
| `GET /fulfillment/works/:workId` | 404 via `FulfillmentWorkNotFoundError`. |
| `POST /fulfillment/works/:workId/actions/:action` | Body `{ expectedVersion, reason?, note?, holdId?, releaseNote? }`. |

**One action handler, not a route per action** — the token check must not be re-implementable per
route, or one route eventually forgets it (#1487's choke-point rule). `:action` is validated
against `OPERATOR_INVOCABLE_ACTIONS`; anything else is 400 naming the invocable set.

**Boundary error mapping** — every domain error reachable from an exposed action is mapped, or it
surfaces as a 500:

| Error | HTTP |
|---|---|
| `FulfillmentWorkNotFoundError` | 404 |
| `FulfillmentWorkVersionConflictError` | **409**, body carries refreshed `supportedActions` + current `version` |
| `FulfillmentWorkActionNotLegalError` (version matched, state predicate refused) | 409, distinct message — see §5 |
| `UnsupportedFulfillmentWorkActionError` | 400, names the invocable set |
| `FulfillmentHoldLimitExceededError` | 409 |
| `FulfillmentHoldNotFoundError` | 404 |
| `FulfillmentHoldAlreadyReleasedError` | 409 |

The last three are reachable from `hold` / `release_hold`, which this slice exposes; the port
docblock stresses the middle two are *different facts* and they keep different codes.

---

## 8. Steps

### Phase 1 — domain (no wiring)
1. `domain/types/fulfillment-supported-actions.types.ts` + `.spec.ts`. Spec covers every axis pair,
   hold suppression, the `on_hold` exit, the two never-produced states, and `submit` legality (which
   the exposure gate then drops).
2. `domain/exceptions/`: `fulfillment-work-version-conflict.error.ts` (carries the refreshed view),
   `fulfillment-work-action-not-legal.error.ts`, `unsupported-fulfillment-work-action.error.ts`.

### Phase 2 — port + repository
3. `FulfillmentWorkRepositoryPort`: add `listWorks(filter)`, `listActiveHoldsForWorks(workIds)`, and
   `readonly expectedVersion?: number` on `TransitionFulfillmentWorkStatusInput`,
   `CancelFulfillmentWorkInput`, `PlaceFulfillmentHoldInput`, `ReleaseFulfillmentHoldInput`
   (additive — the shapes are objects precisely so this is not a signature change).
4. Implement. `applyGuardedUpdate` call sites gain a conditional `.andWhere('"version" = :expectedVersion')`.
   `listWorks` is bounded (`take`/`skip`, ordered `createdAt DESC, id DESC` for a stable page).
   `listActiveHoldsForWorks` is **one** `In(workIds)` query — batched *before* any loop, the
   `getEarliestOrderDateByConnection` (#2083) precedent — because `listActiveHolds` is per-work and
   a naive loop at `limit=100` is 100 queries.
   Hold actions wrap the version-guarded bump + the hold write in the existing `runInTransaction`.
5. Repository `.spec.ts`: assert the emitted SQL carries the `"version" = :expectedVersion` arm —
   against **the string the real query builder produces**, not a mock's arguments.

### Phase 3 — application
6. `application/types/fulfillment-work-view.types.ts` — view shapes + `OPERATOR_INVOCABLE_ACTIONS`.
7. `application/interfaces/fulfillment-worklist.service.interface.ts` (the `application/interfaces/`
   location, matching #2400/#2401/#2402 — this context is inconsistent, and that is the newer half).
   Its docblock **must state the split from `IFulfillmentWorkQueryService`**, which lives in the same
   folder over the same aggregate and answers the cross-context "what work covers this order"; a
   future caller injecting the wrong one silently gets `resolveLinkForOrder`.
8. `application/services/fulfillment-worklist.service.ts` — `list`, `get`, `applyAction`.
9. `FULFILLMENT_WORKLIST_SERVICE_TOKEN`; provider + **`exports`** entry in `fulfillment.module.ts`;
   `index.ts` re-exports the interface, the view types and `OPERATOR_INVOCABLE_ACTIONS` (the
   controller must read that constant — "one constant, two readers" is unreachable otherwise).
   The repository port stays off the barrel.
10. Service `.spec.ts` incl. the **overlapping** conflict test (§9).

### Phase 4 — interface
11. `apps/api/src/fulfillment/` — class named **`FulfillmentApiModule`**, never `FulfillmentModule`,
    which would collide with the core barrel export (`CatalogTrustApiModule` /
    `SalesDocumentsApiModule` precedent). Controller + DTOs; register in `app.module.ts`.
12. Controller `.spec.ts`; projection allowlist `.spec.ts`.

### Phase 5 — guards & integration
13. `scripts/check-no-supported-actions-mirror.mjs`, modelled on
    **`check-no-injection-contracts.mjs` / `check-contract-suite-not-in-production.mjs`** (the two
    existing *inverse* guards) and **not** on the `*-mirror.mjs` family, which are all positive
    mirrors. It **must** ship `--self-check` and be wired as
    `node scripts/X.mjs --self-check && node scripts/X.mjs`, and it **must strip comments before
    scanning**, or this plan's own prose naming `deriveSupportedActions` trips it.
14. `apps/api/test/integration/fulfillment/fulfillment-worklist.int-spec.ts` — real Postgres,
    overlapping 409 on the pinned action, refreshed action set in the body.
15. Re-run `libs/core/src/__tests__/barrel-purity.spec.ts` — this leaf is in `ZERO_SIBLING_EDGE_LEAVES`
    and the new application service is the first file in the slice that could accidentally
    value-import a sibling.

---

## 9. Testing strategy

### The 409 test must be overlapping AND pinned to `hold`

A sequential test (act, then act again with the now-stale token) passes against **no guard at all**
— #2399's `[1, 2]` precedent. But overlap alone is not sufficient either: for `close` or
`force_cancel` the underlying write's own `WHERE` already excludes the post-state
(`transitionStatus` carries a `from`, `cancel` carries `"status" NOT IN ('cancelled','closed')`), so
two overlapping calls yield one-fulfil / one-reject **with the version guard stubbed out** — the same
vacuity one layer up.

The test is therefore pinned to **`hold`**, the only exposed action whose underlying write genuinely
succeeds twice, and asserts the rejection is `FulfillmentWorkVersionConflictError` **specifically**,
not merely "rejected". Two `applyAction` calls both hold the same starting `expectedVersion`; both
are awaited; exactly one fulfils, exactly one rejects with a refreshed set.

**Red-first**: written against an implementation that ignores `expectedVersion`, this must fail with
*both* calls succeeding and *two* hold rows present — and the red must be that assertion, not a
`TS6133`, not `Tests: 0 total`, and not a container that refused to boot.

### Proof the FE cannot recompute `supportedActions` — one and a half legs, stated honestly

1. **No field on the aggregate.** A type-level spec asserts `'supportedActions'` is not a key of
   `FulfillmentWork`, so #2391's decision stays true and cannot be quietly reversed.
2. **No re-implementation of the named artifacts.** `check-no-supported-actions-mirror.mjs` fails the
   build if `apps/web/**` declares a `deriveSupportedActions`-shaped function or a local copy of
   `FulfillmentWorkActionValues`. Verified clean today: `supportedActions` / `supported_actions`
   have zero hits in `apps/web/src`, and the only fulfilment FE is
   `apps/web/src/features/fulfillment-authority/**` (#2304), a different vocabulary.

**WHAT THIS DOES NOT CATCH** — shipped in the script's own header, following
`check-hold-reason-mirror.mjs`'s precedent of stating limits rather than implying completeness: a
drifting frontend needs neither symbol by name. One `if (status === 'open') showSchedule` inside a
component is the real drift shape, and no static guard in this repo detects it. The guard raises the
cost of the obvious copy; it does not make the defect unreachable. (The earlier draft claimed a
third leg — "`apps/web` cannot import core" — which is not independent evidence: the risk was never
importing, it was retyping, which is leg 2's job.)

### Other coverage

- Derivation spec: every `(status, requestStatus, activeHoldCount)` combination that changes an answer.
- A spec asserting **no member of `OPERATOR_INVOCABLE_ACTIONS` reads a line counter**, so the §5
  header-only token decision fails the build the day that stops being true.
- Projection allowlist spec using the distributing `KeysOf<T>`, never a bare `Extract<keyof …>`.
- Controller spec: guard present, DTO validation, 409 body shape.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Sibling conflicts in `fulfillment.tokens.ts` / `fulfillment.module.ts` / `index.ts` (#2396/#2407/#2408/#2409 live) | Append-only edits; re-fetch base immediately before PR. A past merge on this branch produced **two `exports:` keys** in a module — valid TS that silently drops the first. Grep for duplicate object keys after any merge. |
| `listWorks` unbounded | `limit` capped at 100 in the DTO **and** clamped in the repository — reported === enforced. |
| Derivation drifts from what the endpoint executes | The controller validates `:action` against the same `OPERATOR_INVOCABLE_ACTIONS` set the service filters the view with — one constant, two readers. |
| Version bumped by a failed post-claim action | Documented on `claimWorkVersion`; fails closed. |

---

## 11. Alternatives considered

- **`supportedActions` as a persisted column** — rejected: it would be stale the moment any of the
  five writers of `fulfillment_works` moved an axis, and it re-adds the field #2391 kept off the
  aggregate on purpose.
- **A standalone `claimWorkVersion` claim-then-act** — rejected after review; see §5 for the three
  disqualifying defects. The earlier draft rejected the *threading* option instead, on the false
  ground of "six signatures to change"; the port's input shapes are objects precisely so that change
  is additive, and the port docblock reserves it for this issue by number.
- **A route per action** — rejected: the token guard becomes re-implementable per route.
- **Exposing `submit` / `request_cancellation` and refusing them** — rejected: telling a client an
  action is legal and then refusing it *is* the drift this issue exists to remove.

---

## 12. Alignment checklist

- [x] Hexagonal layering; domain stays framework-free
- [x] CORE ↔ Integration boundary untouched; ADR-053 no-injection holds
- [x] Existing patterns reused (conditional-claim UPDATE, `KeysOf` allowlist spec, pure-rule exception)
- [x] Concurrency: conditional claim, overlapping test
- [x] Errors: domain exceptions, mapped at the boundary
- [x] All endpoints guarded; DTOs validated
- [x] No migration required
