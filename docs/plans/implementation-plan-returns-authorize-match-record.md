# Implementation Plan: `return.authorize`, orphan match, and operator-authored returns (#2372)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Branch**: `2367-returns-custody` (body E, on top of #2371 / `65eeec860`)
**Migration slot**: `1860000000000` (reserved for this issue; 1849–1859 are held elsewhere)

---

## 1. Task Summary

**Objective**: ship the three returns writes Wave 2 story T2/T3 needs —

1. `return.authorize` — an ADR-044 proposal **restricted to `origin: 'operator_authored'`**, reusing the `order_changes` table (#2333). No second proposal mechanism.
2. `matchOrphanToOrder(returnId, internalOrderId)` — an operator attributes an orphan, which unblocks every downstream money/goods trigger.
3. `recordReturn(...)` — an operator opens a return in OL against an order OL already knows, for a source with no returns surface at all.

**Context**: story T3's asymmetry — OL *declines* where the platform allows it (#2333), but *authorizes* only returns it authored, because the model must not pretend OL decides what the marketplace already decided (ADR-060). Story T2's orphans (#2332) need an operator-driven way out of the bucket; the background reconcile only resolves orphans whose order OL later ingests under the same connection.

**Classification**: CORE (application + domain), with one additive migration.

---

## 2. Scope & Non-Goals

### In scope
- `OrderChangeKind` widened with `'return.authorize'` (one-line edit, as #2333's docblock anticipated).
- `ReturnAuthorizeService` + interface + token.
- `IReturnsService.matchOrphanToOrder` and `IReturnsService.recordReturn` (both on the existing service — see § 3).
- Two additive nullable columns on `returns` (`matchedAt`, `matchedByUserId`) + migration `1860000000000`.
- `ReturnRepositoryPort.claimAuthorizedAt`; `claimAttribution` widened with an **optional** match-provenance argument.
- Three named domain errors, each with a closed reason union.
- `'authorize'` added to `ReturnDownstreamTriggerValues`.
- Unit tests for every branch; barrel exports.

### Out of scope (declined, with reasons — see § 7)
- Re-running **line resolution** on a match. Nothing in the tree populates `ReturnLine.resolvedOrderLineId`; it is a by-value reference into the order snapshot's jsonb and `order_records` has no lines table. There is no resolution to re-run, and inventing one here would be a second, undesigned mapping.
- Narrowing `REFUND_ATTEMPTABLE_MONEY_STATES`. See § 5, decision D1.
- Any HTTP surface — that is #2376.
- Any refund-side change. `assertAttributedForTrigger` runs before the lock and before any write in `ReturnRefundService`, so filling `internalOrderId` unblocks refunds with no edit there.

### Constraints
- Migration slot `1860000000000` only.
- An operator-authored return has **no source** and must never pretend to have one: `externalReturnId` stays `NULL` (that is why `UQ_returns_source_external` is partial). Core does not synthesise a key; only a *source adapter* may, for its own platform.
- Never let OL's clock stand in for a channel-reported fact. `authorizedAt` for an operator action, `matchedAt`, and an operator-authored `openedAt` are all OL's own acts, so OL's clock is authoritative there — and nowhere else.
- Every refusal is a named domain error with a closed reason union; callers branch on a value, never a message.

---

## 3. Architecture Mapping

**Target layer**: `libs/core/src/returns/**` (domain types/errors/port, application services) + `apps/api/src/migrations`.

**Capabilities involved**: none new. Authorization of an operator-authored return crosses **no** adapter boundary — there is no source to ask.

**Existing services reused**
- `IOrderChangeService` (#2333) — the ADR-044 proposal record, already a module edge (`OrderChangesModule`).
- `IReturnsService.assertAttributedForTrigger` (#2332) — the single orphan-guard seam. No service writes its own `internalOrderId === null` check.
- `IIdentifierMappingService.getInternalId` / `getExternalIds` — already injected into `ReturnsService`.
- `ReturnRepositoryPort.claimAttribution` (the `claimWaybillRelay` conditional-UPDATE shape) and `ReturnRepositoryPort.create` (shipped in #2327, **no production caller until now**).

**New components**
| Layer | File | Purpose |
|---|---|---|
| domain/types | `return-authorize.types.ts` | `AuthorizeReturnInput` / `AuthorizeReturnOutcome` / `AuthorizeReturnResult` |
| domain/types | `return.types.ts` (extend) | `RecordReturnInput`, `RecordReturnLineInput`, `MatchOrphanToOrderInput` |
| domain/types | `return-trigger.types.ts` (extend) | `'authorize'` |
| domain/exceptions | `return-authorize-refused.error.ts` | closed reasons `['source-ingested']` |
| domain/exceptions | `return-match-refused.error.ts` | closed reasons `['already-attributed', 'unknown-order']` |
| domain/exceptions | `return-record-refused.error.ts` | closed reasons `['unknown-order', 'order-not-on-connection', 'no-lines', 'invalid-quantity']` |
| domain/ports | `return-repository.port.ts` (extend) | `claimAuthorizedAt`; `claimAttribution` optional 3rd arg |
| application | `return-authorize.service{,.interface}.ts` | the ADR-044 authorize action |
| application | `returns.service{,.interface}.ts` (extend) | `matchOrphanToOrder`, `recordReturn` |
| infra | `return.orm-entity.ts`, `return.repository.ts` | the two columns + the two claims |
| migration | `1860000000000-add-return-match-provenance.ts` | additive, nullable, no backfill |

**Why `matchOrphanToOrder` / `recordReturn` sit on `ReturnsService` and `authorize` gets its own service.**
`ReturnsService` already owns attribution (`resolveInternalOrderId`) and creation-from-observation, and both new methods need exactly the two dependencies it already injects (repository + identifier mapping) — a third service would inject the same two things to hold two methods. `authorize`, by contrast, needs `IOrderChangeService` and the attribution guard, i.e. `ReturnDeclineService`'s dependency set, and it is a *proposal action* rather than an attribution/creation concern; giving it its own service keeps `ReturnsService` off the `OrderChangesModule` edge and mirrors `decline` one-for-one.

**No new module edge.** `OrderChangesModule`, `IdentifierMappingModule` and `IntegrationsModule` are already imported by `ReturnsModule`.

---

## 4. Design

### 4.1 `return.authorize`

```
assertAttributedForTrigger(returnId, 'authorize')   // orphan → ReturnNotAttributedError
  → refuse origin !== 'operator_authored'           // ReturnAuthorizeRefusedError('source-ingested')
  → short-circuit authorizedAt !== null             // outcome 'already-authorized'
  → orderChanges.openOrReuse({ kind: 'return.authorize', targetRef: returnId, ... })
  → orderChanges.confirm(change.id, `operator:${actorUserId ?? 'system'}`)
  → if (claimApplied) repository.claimAuthorizedAt(returnId, now)
  → outcome 'authorized'
```

Four properties are decisions, not detail.

1. **The origin guard comes before anything is written**, and it is the whole point of the slice: ADR-060 reserves `return.authorize` for returns OL authored. A `source_ingested` return is refused with a *named* error, never a silent no-op — the marketplace already decided, and OL restating that decision would be OL putting words in its mouth.
2. **`authorizedAt` is stamped from OL's clock, and that is correct here.** The #2336/#2367/#2371 rule is that OL's clock may not stand in for a *channel-reported* fact. An operator authorizing a return OL itself authored is OL's own act with OL as the sensor — the same side of the line as `ReturnLineEvent.occurredAt`.
3. **A reused open proposal does NOT abort the action** — deliberately unlike `decline`. The ADR-044 slot exists to stop a duplicate *remote request*; this action makes none, so there is nothing to duplicate, and refusing would let one crash between `openOrReuse` and `confirm` wedge the return behind a full TTL for no safety gain. The at-most-once guarantee is `claimAuthorizedAt`'s `WHERE "authorizedAt" IS NULL`, exactly as `claimDeclinedAt` is for decline: **the conditional UPDATE is the guard, not the lock and not the slot.** The reuse is logged.
4. **No guard on `declinedAt` or `closedAt`.** ADR-044/ADR-060: the four timestamps are four independent facts and none excludes another. A guard here would quietly re-introduce the status ladder the model refuses. (In practice a `declinedAt` on an operator-authored return is unreachable anyway — `decline` requires a source-native id, which such a return has not got.)

`claimAuthorizedAt` is claim-only with no release, mirroring `claimDeclinedAt`: once authorized, that does not become untrue.

### 4.2 `matchOrphanToOrder`

```
findById → ReturnNotFoundError
  → !isOrphan()                       → ReturnMatchRefusedError('already-attributed')
  → getExternalIds(Order, orderId).length === 0 → ReturnMatchRefusedError('unknown-order')
  → claimAttribution(id, orderId, { at: now, actorUserId })   // WHERE "internalOrderId" IS NULL
  → false ⇒ a concurrent writer won  → ReturnMatchRefusedError('already-attributed')
  → re-read and return the aggregate
```

- **Existence is proved through `identifier_mappings`, not through `orders`.** An internal order id exists in that table iff OL minted it while ingesting the order, so a non-empty `getExternalIds` is a sound existence proof — and it costs no `orders` module edge, which the `ReturnsModule` docblock explicitly warns against manufacturing (`orders` must never import `returns` back; adding `OrdersModule` here for a single read would make the documented one-way rule a real cycle risk). It proves an id was *minted*, not that an `order_records` row still stands — the same by-value posture `internalOrderId` already has (there is deliberately no FK).
- **Any connection's mapping counts.** One of the documented orphan causes is an order ingested under a *different* connection, so scoping the proof to `record.sourceConnectionId` would refuse precisely the case the action exists for.
- **Attribution stays monotonic.** `claimAttribution`'s `IS NULL` predicate can only fill the value in, never change one — an operator can never re-point a return at a different order, and the losing side of a race against the #2332 reconcile learns it lost.
- **Provenance is the timeline entry.** OL's order timeline is *derived* from persisted facts (the #1689 / #2100 precedent — no order-event table exists). `internalOrderId` becoming non-null carries no *who* and no *when*, so two additive nullable columns record the act. They are NULL for an ingestion-attributed return and for a reconcile-attributed one, which is what makes "an operator matched this" a distinguishable fact rather than an inference. The reconcile's own call site is unchanged — the argument is optional.
- The act is **not** written to `return_line_events`: that ledger is per-line and its rows sum back to the counters (a spec asserts it). A header-level attribution has no line and no quantity, and adding a fourth kind would put a row in the ledger that sums to nothing.

### 4.3 `recordReturn`

```
lines.length === 0                                   → 'no-lines'
any line quantityAdvised <= 0 or non-integer         → 'invalid-quantity'
getExternalIds(Order, internalOrderId) → []          → 'unknown-order'
  → no entry for sourceConnectionId                  → 'order-not-on-connection'
  → repository.create({ origin: 'operator_authored', externalReturnId: null,
                        externalOrderId: <the matched mapping's externalId>,
                        openedAt: now, authorizedAt: null, ... })
```

- **`externalReturnId` is `NULL`, always.** `UQ_returns_source_external` is partial precisely so a source that mints no id writes NULL; core does not invent one. (`ReturnsService.upsertFromObservation` refusing a blank key is the *ingestion* rule and does not apply — nothing will ever re-sync this row from a source.)
- **`sourceConnectionId` is required and validated, not guessed.** The column is `uuid NOT NULL`, so the row must name a connection; the operator names the channel the order came from, and OL checks the order actually maps there. That check also *derives* `externalOrderId` factually from the winning mapping rather than accepting an operator-typed string, which keeps the row legible to the #2332 reconcile and to a human debugging it.
- **`openedAt` = OL's clock** (the operator opened it here, OL is the sensor). **`authorizedAt` = `null`** — recording and authorizing are two acts, which is the entire premise of ADR-044/ADR-060's "authorization is an ACTION, not a state". A return that arrived already authorized would leave `return.authorize` with no job.
- Lines land with the schema defaults: `custodyState: 'advised'`, `moneyState: 'not_refundable'`, `disposition: null`, counters at 0. That is *literally* the acceptance criterion "participates in custody and money exactly like an ingested one".

---

## 5. Questions, Assumptions & Recorded Decisions

**D1 — the initial `moneyState` for an operator-authored return: leave it at the column default `not_refundable`; `REFUND_ATTEMPTABLE_MONEY_STATES` does NOT narrow.**

The handover notes that the set contains `not_refundable` only because it is #2327's default, and that a slice setting `pending` at creation narrows it to `pending | denied` with no call-site change. This slice deliberately does not take that step:

- Narrowing is only sound once **every** writer sets `pending`. Source-ingested lines — every existing row in every install — would still carry `not_refundable`, so a narrowed set makes them permanently unrefundable. That is a silent money defect discovered one refund at a time.
- Setting `pending` for operator-authored lines *only* buys nothing and costs consistency: `isRefundAttemptable` treats the two identically, so the sole observable effect is two origins carrying different defaults for no operator-visible reason.
- The acceptance criterion asks that an operator-authored return participate in money *exactly like an ingested one*. Sharing the default is the literal reading.

**Follow-up recorded for whoever narrows it**: it needs one change to the shipped ingestion path (`ReturnsService.upsertFromObservation` / `upsertFromSource` writing `pending` on insert), a backfill migration for existing `not_refundable` rows, and only then the one-line edit to `REFUND_ATTEMPTABLE_MONEY_STATES`. All three in one commit, or the set is half-narrowed.

**Assumptions**
- A1 — the operator supplies `sourceConnectionId` for `recordReturn`; the UI has it from the order it is standing on. Deriving it silently when the order maps to several connections would pick one for the operator.
- A2 — `actorUserId` is `string | null` throughout, matching `CreateOrderChangeInput.requestedBy` and `CreateReturnLineEventInput.actorUserId`, so a future non-interactive writer stays expressible.
- A3 — no ADR is required. ADR-044 and ADR-060 already decide everything here; this slice implements them and widens one union each in the way both documents anticipate in writing.

---

## 6. Implementation Steps

### Phase 1 — vocabulary
1. `libs/core/src/orders/domain/types/order-change.types.ts` — add `'return.authorize'` to `OrderChangeKindValues`, and replace the "deliberately ABSENT … no writer" paragraph with the shipped rule (restricted to `operator_authored`). *Acceptance*: `isOrderChangeKind('return.authorize')` is true; no migration (the column is a plain `varchar(64)` with no CHECK, by #2333's design).
2. `return-trigger.types.ts` — add `'authorize'`; extend the docblock's flow list.
3. `return-authorize.types.ts` (new) + `return.types.ts` (extend) — the input/result shapes.
4. The three error classes under `domain/exceptions/`, each with an exported `*ReasonValues` `as const`.

### Phase 2 — persistence
5. `return.orm-entity.ts` — `matchedAt: timestamptz null`, `matchedByUserId: text null`, with the docblock stating they mean *the orphan-match act specifically*.
6. `apps/api/src/migrations/1860000000000-add-return-match-provenance.ts` — `ADD COLUMN IF NOT EXISTS` ×2, `down()` drops both. No backfill: NULL correctly means "not matched by an operator".
7. `return-repository.port.ts` + `return.repository.ts` — `claimAuthorizedAt(id, at)` (copy `claimDeclinedAt`); `claimAttribution(id, internalOrderId, match?)` writing the two columns only when `match` is supplied. Both wrapped in `ReturnPersistenceError` like their neighbours.

### Phase 3 — application
8. `return-authorize.service.interface.ts` + `.service.ts` per § 4.1; token `RETURN_AUTHORIZE_SERVICE_TOKEN`.
9. `returns.service{,.interface}.ts` — `matchOrphanToOrder` (§ 4.2) and `recordReturn` (§ 4.3).
10. `returns.module.ts` — register + export the new service; docblock note that no new module edge is added.
11. `index.ts` — export the new types, errors, reason-value arrays and the service interface.

### Phase 4 — tests + docs
12. `__tests__/return-authorize.service.spec.ts` — refuses `source_ingested`; refuses an orphan through the shared guard; idempotent on `authorizedAt`; proceeds on a reused proposal; stamps only when `claimApplied` wins; opens `kind: 'return.authorize'` against `targetRef = returnId`.
13. `returns.service.spec.ts` — match: not-found / already-attributed / unknown-order / lost-race / success-writes-provenance; record: each refusal reason, plus asserts `externalReturnId === null`, `authorizedAt === null`, and `externalOrderId` taken from the mapping.
14. A grep-style spec asserting **no second proposal mechanism**: the only table any returns write proposes into is `order_changes`, i.e. `libs/core/src/returns/**` contains no `*proposal*` entity/ORM/repository file and `RETURN_*` tokens name no proposal store. (AC: "asserted by review + grep test".)
15. `docs/architecture-overview.md § 22 Returns` — one paragraph covering the three writes, the origin restriction, the provenance columns, and D1.

---

## 7. Alternatives Considered

- **A new `return_authorizations` table.** Rejected outright: the issue and #2333's own docblock both say `order_changes` is built once and reused. A second proposal mechanism is the failure mode the AC names.
- **Calling the source on authorize.** There is no source. An operator-authored return exists precisely because the platform has no returns surface; a call would have to be invented and would then be the fiction ADR-060 forbids.
- **Recording the match in `return_line_events`.** Rejected — see § 4.2; the ledger is per-line and sums to the counters.
- **Reading `IOrderRecordService` to verify the order.** Rejected — it forces `OrdersModule` into `ReturnsModule`'s graph against that module's own documented warning, to learn something `identifier_mappings` already answers with a dependency this context already has.
- **Refusing `authorize` when a proposal is already open** (decline's behaviour). Rejected — see § 4.1 property 3.
- **Setting `moneyState: 'pending'` at creation.** Rejected — see D1.

---

## 8. Risks & Edge Cases

| Risk | Handling |
|---|---|
| Two operators match the same orphan concurrently | `claimAttribution`'s `IS NULL` predicate; the loser gets `already-attributed`, never a silent overwrite |
| Match races the #2332 reconcile | Same predicate; the reconcile already counts a lost claim as `alreadyAttributed` (a success), unchanged |
| Operator matches the wrong order | Attribution is monotonic and there is **no unmatch**. Stated in the interface docblock so #2376 renders a confirm rather than a bare button. Correcting a mis-match is a deliberate, unbuilt operation. |
| `authorize` reaches a `source_ingested` return via the API | Named error with a closed reason → #2376 maps it to a 409/422 with a distinguishable code |
| Crash between `openOrReuse` and `confirm` | The retry proceeds through the reused proposal (§ 4.1); `claimAuthorizedAt` keeps the stamp at-most-once |
| Migration ordering | `1860000000000` is strictly greater than the current tail (`1859000000000`), satisfying `check-migration-timestamps.mjs` rule 3 |
| Backward compatibility | Both columns nullable with no default change; both new union members are additions; `claimAttribution`'s new argument is optional, so the reconcile call site is untouched |

---

## 9. Testing Strategy & Acceptance

- Unit tests per § Phase 4, mocking ports only (`ReturnRepositoryPort`, `IOrderChangeService`, `IIdentifierMappingService`, `IReturnsService`).
- Full `pnpm lint` / `pnpm type-check` / `pnpm test` before commit (targeted runs have missed contract regressions this wave).
- AC mapping: `authorize` refused on `source_ingested` with an explaining error → step 12; matching unblocks money triggers + records provenance → steps 9/13 (the refund path needs no edit — `assertAttributedForTrigger` runs before its lock and before any write); operator-authored participates in custody and money identically → step 9 + D1; no second proposal mechanism → step 14; tests + no boundary violations → `check:invariants`.

---

## 10. Alignment Checklist

- [x] Hexagonal layering respected; domain stays framework-free
- [x] CORE only; no adapter, no integration change
- [x] Reuses `order_changes`, `claimAttribution`, `assertAttributedForTrigger`, `repository.create` — no new abstraction
- [x] Idempotency: conditional UPDATEs are the guards (`claimAuthorizedAt`, `claimAttribution`)
- [x] Every refusal is a named error with a closed reason union
- [x] Naming + file structure per engineering-standards.md; tokens in `returns.tokens.ts`; types in `*.types.ts`
- [x] Migration slot `1860000000000`, additive and reversible
- [x] Execution-ready

---

## 11. Pre-implement gate findings (absorbed)

**Verdict: READY.** Every artifact called NEW is confirmed absent repo-wide; every
artifact called reusable is confirmed present and fit (`order_changes` +
`IOrderChangeService`, `claimAttribution`, `assertAttributedForTrigger`,
`ReturnRepositoryPort.create` — the last of which has had *no production caller* since
#2327 and is exactly the operator-authored create path). Slot `1860000000000` is free
and strictly greater than the `1859000000000` tail.

**BC-1 (Warning, absorbed into Phase 2/3).** The two provenance columns must reach the
`ReturnRecord` domain entity — otherwise they are write-only and #2376 cannot render the
timeline entry. That constructor is **positional with six call sites** (`toDomain` plus
five specs) and its own docblock warns that adjacent `string | null` parameters make a
mis-ordered call type-check. So the two fields are appended **after `lines`**, both
`= null`-defaulted:

```ts
public readonly lines: readonly ReturnLine[],
public readonly matchedAt: Date | null = null,
public readonly matchedByUserId: string | null = null
```

Appending after the one non-nullable trailing parameter is what makes it safe — a
missing argument cannot bind to the wrong slot, and all five spec call sites keep
compiling untouched. **Inserting them beside the other timestamps is forbidden**: that is
precisely the silent mis-binding the entity docblock names.

**Confirmed no-breaks** (checked, not assumed): no `assertNever` closes over
`ReturnDownstreamTrigger` (the context's only one is over `ReturnCustodyState`);
`return-refusal-identity.spec.ts` asserts `toContain('decline')`, not an exact set; there
is no frontend mirror of the trigger union (`apps/web` mirrors `ReturnOriginValues` only)
and no `scripts/check-*-mirror.mjs` covers returns; `claimAttribution`'s new third
argument is optional, so both existing call sites stay source-compatible (the #2219
optional-page precedent); `order_changes.kind` is `varchar(64)` with no CHECK, so the
`'return.authorize'` widening needs **no** migration; and the integration truncate list
already carries all four affected tables.

---

## 12. Plan tech-review findings (applied)

Verdict: **Approve with changes** — no BLOCKING issues, four IMPORTANT items folded in.

1. **Type placement corrected.** `return-authorize.types.ts` is **deleted from the plan**. Authorize crosses no
   adapter boundary, so it has no domain-types half to own; all three input/result shapes go in their
   **service-interface** files (`return-authorize.service.interface.ts` for authorize;
   `returns.service.interface.ts` for `RecordReturnInput` / `RecordReturnLineInput` /
   `MatchOrphanToOrderInput`), mirroring `DeclineReturnInput` / `DeclineReturnResult` one-for-one.
   `return-decline.types.ts` holds only the neutral *adapter* command/result — that is the distinction, and
   this slice has no adapter call.
2. **Every outcome / reason union ships its `as const` runtime array** (`AuthorizeReturnOutcomeValues`,
   `ReturnAuthorizeRefusalReasonValues`, `ReturnMatchRefusalReasonValues`,
   `ReturnRecordRefusalReasonValues`), exported as VALUES from the barrel — the `DeclineReturnOutcomeValues`
   precedent, because #2376 enumerates them in a response DTO.
3. **The duplicate-`recordReturn` question is answered explicitly, not left to be discovered.** Two calls create
   two returns: `externalReturnId` is NULL by design and `UQ_returns_source_external` is partial, so nothing
   dedups them. That is **accepted** — an operator may legitimately open two returns against one order, and
   synthesising a key to prevent it would breach this plan's own constraint. It is stated in the interface
   docblock so #2376 can decide whether its route wants a confirm.
4. **`claimAttribution`'s widening carries a no-regression assertion**: with `match` absent the statement is
   byte-identical to today's (same predicate, same `SET` list). The existing
   `return-reattribution.repository.spec.ts` assertions stay untouched; the two new columns are asserted only
   on the 3-argument path.

Also applied: a docblock tripwire in `ReturnAuthorizeService` recording that the confirm-after-reuse branch works
only because `openOrReuse` opens rows through `insertRequested` (status `'requested'`) and `confirm` guards on
exactly that status — **verified in the tree**; a future `'pending'` open would silently stop the confirm while
still stamping. Standard file headers on all new files. And `'already-attributed'`'s docblock states that
attribution is monotonic with no unmatch, since that is the error an operator hits after a mis-match.
