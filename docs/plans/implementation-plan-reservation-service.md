# Implementation Plan: ReservationService — get-or-create resume, delta-adjust, stamped `atpEffect`

**Date**: 2026-08-26
**Status**: Ready for Review (revised after `/pre-implement` + `/tech-review`)
**Issue**: #2344 (OMS Wave 2, stream S1, backlog slug `W2-7`)
**Depends on**: #2343 (ledger table + `ReservationRepositoryPort`), #2283 (line diff), #2321 (`IAvailabilityService` seam)
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: Put an application service over the #2343 ledger so that ingesting an order records OpenLinker's own advisory holds — idempotently on replay, delta-adjusted on a source amendment, and with `atpEffect` stamped by the caller that actually knows the routing outcome.

**Context**: Two of design §4.2's three R1 correctness amendments land here.

- **(2) Reserve is get-or-create, never reject-on-retry.** Without it, an ingestion crash after `claimHeld` wedges the order forever behind a false "insufficient stock". #2343 already made the *repository* behave this way (`ON CONFLICT DO NOTHING` + re-select, desired-total-not-delta). This issue is what makes the ingestion path use it, and — critically — what does NOT add a quantity pre-read in front of it. **The check IS the reserve.**
- **(1) `atpEffect` is a stamped column, not a cross-context read.** #2345's ATP subtraction must be a local column test (`WHERE status='held' AND atpEffect='published'`). That is only possible if the value is written at creation. There is no read-time inference and there must never be one — an `inventory → fulfillment` read on the publish path is precisely what ADR-061 decision 1 exists to prevent.

Plus §6I's **multi-position gate**: a reserve rejects **loudly** when a variant resolves to more than one non-stale position and no explicit position was supplied. `findAvailabilityByVariantIds` SUMs across every position for a variant while a reserve `UPDATE … WHERE id = $1` takes exactly one — so silently picking one is an oversell with every counter internally consistent.

**Classification**: CORE (Application layer, `inventory`), plus one call-site wiring edit in `orders`.

---

## 2. Scope & Non-Goals

### In Scope

- `IReservationService` + `ReservationService` in `libs/core/src/inventory/application/`.
- Variant → inventory-position resolution, and the ambiguity gate over it.
- **The terminal-state gate (D7)** — the correctness hole this issue must close, not defer.
- Two new intra-context reads: one on `InventoryRepositoryPort` (live positions), one on `ReservationRepositoryPort` (all-status rows for an order).
- `RESERVATION_SERVICE_TOKEN`, module provider + export, barrel exports.
- `expiresAt` policy (mandatory per ADR-061; a TTL with an env override).
- Wiring one call into `OrderIngestionService`, after `persistOrder` and before destination provisioning.
- Resolving `atpEffect` at that call site from `IFulfillmentRoutingService`.
- Unit tests + integration coverage proving crash-resume and non-resurrection.

### Out of Scope

- **ATP subtraction** — #2345. The `RESERVATION_LEDGER_READER_TOKEN` binding stays `EmptyReservationLedgerReader`; a zero-reservation install must stay byte-identical (Story I1). **This plan does not touch `AvailabilityService` or the reader binding at all.**
- **Release / consume / expire methods.** They land with their own issues on this same interface: #2346 (state-dependent expiry sweep), #2347 (consume as a `Shipment.reservationConsumedAt` claim), #2348 (repointing the ADR-028 cancellation restore). The repository already exposes `releaseHeld` / `listHeldByOrderRecordId` for them.
- **Shortfall as a named order fact** — #2349. This service *reports* what it could not reserve; persisting that onto the order is #2349's.
- Any schema change. See §6 "Database Migrations".

### Constraints

- Node 22 LTS; strict TS; no `any`; `Logger` from `@openlinker/shared/logging`.
- `ReservationRepositoryPort` is deliberately **not** on the `@openlinker/core/inventory` barrel — imported relatively, from inside the context only.
- A service must implement an interface (`scripts/check-service-interfaces.mjs`).

---

## 3. Architecture Mapping

**Target layer**: CORE — `libs/core/src/inventory/application/services/`.

**Ports involved**:
- `ReservationRepositoryPort` (#2343) — `claimHeld`, plus one added read. Relative import.
- `InventoryRepositoryPort` — extended with one read. Relative import.
- `IFulfillmentRoutingService` (`libs/core/src/mappings/application/interfaces/fulfillment-routing.service.interface.ts`, via `@openlinker/core/mappings`) — consumed at the *orders* call site, not by this service.

**New components**: `IReservationService`, `ReservationService`, `AmbiguousReservationPositionError`, reservation-service types, `RESERVATION_SERVICE_TOKEN`, one method each on the two repository ports + their implementations.

**Core vs Integration**: entirely OL-owned. The ledger is OpenLinker's own advisory promise — it is not a master's stock and no adapter can hold it (design §4.2: an authority that cannot hold simply does not implement `AvailabilityHolder`, and OL then holds in its own ledger only). Nothing here can live in an integration.

**Module graph**: `OrdersModule` gains `InventoryModule` in `imports`. Verified acyclic — `InventoryModule` imports `ProductsModule`, `IntegrationsModule`, `IdentifierMappingModule`, `SyncModule`, `EventsModule`, none of which reaches `OrdersModule`; `OrdersModule` already imports four of the five. Same one-way shape as the existing `OrdersModule → InvoicingModule` (F3) edge.

**Standing constraint — the CommonJS require-graph, not just the DI graph** (`docs/lessons.md`, #2154/#2157): a Nest-acyclic graph can still die at `NestFactory.create` on a CJS require cycle, invisible to `type-check`, `lint`, unit specs and `check-cross-context-imports`. Today `libs/core/src/inventory/**` has **zero** `@openlinker/core/orders` imports. Once `orders.module.ts` value-imports `InventoryModule`, that becomes an invariant: **no file reachable from the inventory barrel may top-level value-import `@openlinker/core/orders`.** Proved by a real container boot — `apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts` already resolves from the real `AppModule` and is extended to resolve `RESERVATION_SERVICE_TOKEN`.

---

## 4. Design decisions

### D1 — The service takes the WHOLE order's lines in one call

`reserveForOrder(input)` takes `lines: readonly ReserveOrderLineInput[]` and makes exactly one `claimHeld` call with the whole array.

This is #2343's binding handover and is not a style choice. The sort-by-`inventoryItemId` (the deadlock guarantee — two multi-line orders touching the same positions in opposite order deadlock without it), the single transaction, and the all-or-nothing rollback are all properties of that one call. Splitting into a call per line forfeits all three.

### D2 — Desired total, never a delta; and no quantity pre-read

Each line carries its **desired total** quantity. The repository computes the delta against what is persisted. So an identical replay moves the counter by zero and touches no row (`deltaApplied: 0`, granted); an amended line delta-adjusts under the same guarded UPDATE, never release-then-reserve.

**The service must not read the ledger to decide how much to claim.** A "check availability, then reserve" is an unlocked read-then-act — the exact shape §6I replaces, whose failure mode is an oversell. The check IS the reserve. Note the scope of this rule precisely: it forbids reading to decide a *quantity*. It does not forbid the lifecycle gate in D7, which asks a different question over monotone state.

### D3 — `atpEffect` is required at the type level, resolved by the caller

`ReserveForOrderInput.atpEffect` is a required field with **no default**. A missing value is a programming error, not a fallback — a default here would be a policy decision hidden in a signature, and the wrong default silently subtracts diagnostic holds from a real published quantity. (Same rule `SumReservedInput.atpEffect` already states.) The value is honoured **only on insert** (immutable per ADR-061 decision 1).

**Resolution at the ingestion call site**: `IFulfillmentRoutingService.resolve({ sourceConnectionId: connectionId, sourceDeliveryMethodId: order.shipping?.methodId ?? null })`. That method id is the input that decides the stamp on most orders; `null` resolves the `omp_fulfilled` default.

| resolution | stamp | why |
|---|---|---|
| `processorKind === 'omp_fulfilled'` (rule OR default) | `'diagnostic'` | the marketplace/destination ships; OL does not execute fulfillment, so the hold must never feed published ATP (design §4.2 scoped subtraction; §6I's original kill condition) |
| `processorAvailable === false` (any kind) | `'diagnostic'` | a rule pointing at a non-`active` processor still matches but resolves `processorAvailable: false`. Stamping `published` would assert *OL executes this order* over a route OL demonstrably cannot drive — and the stamp is insert-only, so it would survive the operator re-enabling the connection. |
| `ol_managed_carrier` / `source_brokered`, available | `'published'` | OL executes |
| resolution threw | `'diagnostic'`, warn-logged | see below |

**The failure arm resolves `diagnostic`, never `published`.** Two supports. Structurally the arm is nearly unreachable — `FulfillmentRoutingService.resolve` throws only on a repository fault; every other path returns `defaultResolution()` (`omp_fulfilled`), which maps to `diagnostic` anyway. And the direction is the design's own: ANALYSIS's Wave-5 kill calls over-subtraction *"worse than shipping nothing in its default configuration"* — a seller with 3 units and a buffer of 1 publishing 0 after selling 1, for the whole TTL. `diagnostic` is the arm that subtracts from nothing and therefore changes nothing.

### D4 — The multi-position gate: loud, and before any write

Per line, candidate positions are the **live** (`isStale = false`) `inventory_items` rows matching `(productId, productVariantId ?? NULL)`.

| candidates | behaviour |
|---|---|
| exactly 1 | that position is used |
| **> 1**, no explicit `inventoryItemId` | **`AmbiguousReservationPositionError` is thrown**, naming every ambiguous line and all its candidate ids |
| > 1, explicit `inventoryItemId` supplied | the explicit id is used |
| 0 | **not an error** — the line is reported as skipped, reason `'no-position'` |

**Zero positions is reported, not thrown.** `inventory_items` coverage is not guaranteed: a variant no `InventoryMaster` connection has synced legitimately has no position, and ANALYSIS names throwing here as a *defect* — a `source_deleted` ref hits `WHERE isStale = false`, yields zero rows, and produces "a permanent domain rejection of a real, paid order". Reported on the result so #2349 can name it on the order. (This is in tension with §6I's "zero rows ⇒ roll back the whole order's set" for the *insufficiency* arm; the two arms are different — see A4.)

**Ambiguity throws, and the call site degrades gracefully.** §4.2's "rejects loudly" is honoured: the service refuses rather than guessing, because a guess here is an oversell. But the gate collects **every** ambiguous line and throws **once**, carrying each line's id and candidates — so `OrderIngestionService` catches that error specifically, logs it at `error`, drops exactly those lines, and re-issues once. The rest of the order's holds are kept. Losing an entire order's holds forever over one ambiguous line would be the same outcome the zero-position rule above rejects, and one retry (never a loop) is enough because the throw is exhaustive.

**The gate runs over every line before any claim is issued**, so nothing is written when it fires.

**An explicit `inventoryItemId` is passed straight through, unvalidated by the service.** The repository's guard already discriminates `missing` vs `stale` on the failure path, and its answer is the accurate one; a service-side membership test against the live-candidate set would report a *stale* explicit id as `'missing'`.

### D5 — `expiresAt` is mandatory, with a TTL default

ADR-061 makes `expiresAt` mandatory: an unbounded hold on a system that may never observe the close event is an oversell leak with no floor. The service resolves `now + ttl` when the caller supplies none.

`OL_RESERVATION_TTL_MS`, default **7 days**, clamped to `[1 h, 90 d]` (the `OL_WEBHOOK_SKEW_WINDOW_MS` clamp precedent). A pure coercion helper takes the env record as an argument — the `isTaxRateEnforced` / `readStockSafetyBuffer` precedent for a `*.types.ts` pure rule.

**No design document states any TTL value; 7 days is this plan's choice.** Its blast radius is stamp-dependent and asymmetric: harmless on a `diagnostic` hold, but a 7-day unclosed `published` hold is exactly the "publishes 0 after selling 1" harm above. Because D3 makes `omp_fulfilled` (the default topology) diagnostic, a default install is unexposed; a shop that configures `ol_managed_carrier` rules is the one that should tune it.

The TTL is a *floor under a leak*, not the intended lifetime: #2346's sweep **extends** — never releases — a reservation whose order still carries live OL-executed work. It is not extended as a side effect of re-reserving, because `expiresAt`, like `atpEffect`, is honoured only on insert.

### D6 — The ingestion call is best-effort and never fails the order

Wrapped in try/catch, logged, never rethrown — the same posture as the adjacent Step-6 customer-projection update and the cancellation stock-restore enqueue.

An advisory hold is exactly that: advisory. Losing an order because OL could not record its own optimistic promise inverts the priority — the order is the fact, the hold is our accounting of it. Turning `InsufficientAvailabilityError` into a failed ingestion job would also burn the full retry ladder against a condition retrying cannot change.

**This is a decision, not an inherited rule** — see A4. Design §6I's whole-set-rollback and the Wave-5 note that ingestion "throws so the runner retries" both point the other way. Until #2349 names the shortfall on the order, the only signal is an `error`-level log, which is a stated, temporary cost.

Two call-site guards: skip when the order is `cancelled` (holding stock for an order that arrived dead is noise), and skip when no line resolved a variant.

### D7 — A terminally-closed line is never re-held (the re-poll gate)

**This is the correctness hole the reviews found, and it belongs here because this issue ships the call site.**

`syncOrderFromSource` re-runs on every re-poll of an order (PrestaShop's `date_upd` watermark backstop, Allegro's event journal, webhooks). The ledger's idempotency key is `UNIQUE … WHERE status = 'held'` — so a `released` / `consumed` / `expired` row is **invisible** to `ON CONFLICT` and does not block a fresh insert. Left unguarded, then:

- once #2347 lands, an order ships → rows go `consumed` → the next re-poll mints new `held` rows and re-increments `olReservedQuantity` for stock that has already left the building;
- once #2346 lands, its sweep releases a hold → the next re-poll re-creates it → the sweep releases it again: an unbounded resurrection loop between two services, with counter churn every cycle.

Neither ADR-061, DESIGN §4.2 nor ANALYSIS §6I covers re-reserve after a terminal close — §4.2's get-or-create is scoped verbatim to *"an existing **held** row"*. So:

**Before claiming, the service reads every reservation row for the order (all statuses) and skips any line that already carries a terminal row, reporting reason `'already-closed'`.**

**The gate is keyed on the LINE, not on `(line, position)`** (diff-review finding). A position-scoped key looks tighter and is in fact defeatable: a line's position is not stable across the ladder that shipped in this same programme — #2322's pooled-position repair stales a `locationId IS NULL` row once a located one exists for the same variant, and #2320 deliberately admits coexisting cross-source positions. So a line `consumed` against position X can legitimately re-resolve to position Y on a later re-poll, where a position-scoped key would match nothing and mint a fresh hold for stock that has already shipped — the exact harm this gate exists to prevent. Nothing is lost by the wider key: a line holds against one position at a time, so no legitimate claim is refused.

Why this is not the read-then-act D2 forbids: D2's rule is about *quantity* — the value the guard must decide on atomically. This read asks whether a line is still reservable at all, over **monotone** state: `releaseHeld` guards on `status = 'held'`, and no code path returns a terminal row to `held`. The only race is a concurrent release landing between the read and the claim, whose outcome is identical to the two operations simply happening in the other order.

The conservative direction is deliberate. An order that was cancelled (rows `released`) and later un-cancelled will not re-hold, which is a *missing advisory hold* — strictly less harmful than a double hold, and recoverable by #2346's sweep semantics. Ledger history is never deleted (#2343), so this gate is durable.

### D8 — A kill switch, default ON

Recording a hold is additive and nothing subtracts from the ledger until #2345 — but it IS new **unconditional** work on the hottest path in the system: a fulfillment-routing resolve plus two reads and a write transaction, re-run on every re-poll of an order. The repo's precedent for adding recurring behaviour that no surface reads yet is a switch (`OL_TAX_RATE_STRICT_ENABLED`, `OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED`, both Erli status tasks), and the failure modes here land on order ingestion, so an operator whose latency regresses needs an escape hatch that is not a redeploy.

`OL_RESERVATIONS_ENABLED`, read at the ingestion call site, **defaults to `true`** — deliberately not opt-in, because #2345's ATP subtraction cannot subtract from a ledger nothing populated. Off, ingestion is byte-identical to its pre-#2344 behaviour.

---

## 5. Questions & Assumptions

### Open questions
- **None blocking**, but one design contradiction is being *resolved* here rather than reported clean: DESIGN §13.1's sequence puts `reserve lines` **before** `selectPrimaryFulfillmentRouter → route()`, while §4.2 requires the ingestion caller to already hold the routing outcome in order to stamp `atpEffect`. This plan resolves it by calling `IFulfillmentRoutingService.resolve` at ingestion, ahead of the reserve (A1 explains why the *caller*, not the service, must do it). Recorded so a future reader does not "fix" the ordering back.

### Assumptions
- Every source's ingestion reaches `OrderIngestionService.syncOrderFromSource`, so one call site covers Erli / Allegro / WooCommerce / PrestaShop (issue's own stated assumption).
- **`OrderItem.id` is stable across re-polls of the same order.** This is the premise of the entire idempotency key, not an incidental mapping detail — ANALYSIS names an unstable line id as a live oversell bug on a path that retries by design. #2068 largely closed it; the residual is `prestashop-order.mapper.ts`, whose `resolveOrderRowId(row, index, orderId)` retains an `index`-derived fallback over a line read that carries no `sort`. An order whose lines change order between polls would therefore mint a second hold. Out of scope to fix here; named so it is not rediscovered as a mystery.
- `Order.id` (`internalOrderId`) is the `orderRecordId`.
- `OrderItem.variantId` is optional; a product-level line resolves against the `productVariantId IS NULL` position. Both shapes supported.

---

## 6. Proposed Implementation Plan

### Phase 1 — Domain surface (`inventory`)

1. **`domain/exceptions/ambiguous-reservation-position.error.ts`** — `AmbiguousReservationPositionError(ambiguities: readonly AmbiguousReservationPosition[])`, each `{ orderLineId, productId, productVariantId, candidateInventoryItemIds }`. Message names every candidate: the operator's remediation is choosing one. Plural by construction so one throw is exhaustive and the call site's retry is single-pass (D4).

2. **`domain/types/reservation-expiry.types.ts`** — `RESERVATION_TTL_MS_DEFAULT / _MIN / _MAX`, `readReservationTtlMs(env)`, `resolveReservationExpiry(now, ttlMs)`. Pure; env passed in.

3. **`domain/ports/inventory-repository.port.ts`** — add `findLivePositionsByProductIds(productIds, productVariantIds)` returning `readonly InventoryPositionCandidate[]` (`{ productId; productVariantId: string | null; inventoryItemId; locationId: string | null }` in `inventory.types.ts`). Product-keyed so one bound-parameter query serves the order, **narrowed by `("productVariantId" IN (…) OR "productVariantId" IS NULL)`** so a 500-SKU apparel product does not return 500 rows for a 1-line order — variant count per product, not order size, was otherwise the growth axis. `isStale = false` only. Empty input → `[]`, no round trip. Mirrors `findStockAggregatesByProductIds`.

4. **`infrastructure/persistence/repositories/inventory.repository.ts`** — implement it. **Sole implementer of the port** — no test double breaks (every existing mock is a `Pick<>` or a cast).

5. **`domain/ports/reservation-repository.port.ts`** — add `listByOrderRecordId(orderRecordId): Promise<readonly Reservation[]>` (**all statuses**, unlike the existing `listHeldByOrderRecordId`). Docblock states it exists for D7's lifecycle gate and must not be used to decide a quantity.

6. **`infrastructure/persistence/repositories/reservation.repository.ts`** — implement it.

### Phase 2 — The service

7. **`application/types/reservation-service.types.ts`**
   `ReserveOrderLineInput { orderLineId; productId; productVariantId: string | null; quantity; inventoryItemId? }`,
   `ReserveForOrderInput { orderRecordId; atpEffect; lines; expiresAt?; now? }`,
   `SkippedReservationReasonValues = ['no-position', 'already-closed'] as const` (as-const so #2349 adds a reason without a shape change),
   `SkippedReservationLine { orderLineId; reason }`,
   `ReserveForOrderResult { granted: readonly ReservationClaimOutcome[]; skipped: readonly SkippedReservationLine[] }`.

8. **`application/services/reservation.service.interface.ts`** — `IReservationService.reserveForOrder`. Docblock states get-or-create, insert-only `atpEffect`/`expiresAt`, the no-quantity-pre-read rule, D7's gate, and that release/consume/expire land here with #2346–#2348.

9. **`application/services/reservation.service.ts`** — `@Injectable`, `implements IReservationService`.
   Flow: reject non-positive/non-integer quantities (before any I/O) → `listByOrderRecordId` (D7) → `findLivePositionsByProductIds` → group → per-line gate (D4), collecting ambiguities → throw once if any → one `claimHeld` → `{ granted, skipped }`. Zero claimable lines returns early with no `claimHeld` call.

10. **`inventory.tokens.ts`** — `RESERVATION_SERVICE_TOKEN = Symbol('IReservationService')`.

11. **`inventory.module.ts`** — provide + `useExisting` + export. **`RESERVATION_LEDGER_READER_TOKEN` stays bound to `EmptyReservationLedgerReader`** (#2345 owns that swap).

12. **`libs/core/src/inventory/index.ts`** — export the interface, class, error, and new types. `ReservationRepositoryPort` stays off the barrel.

### Phase 3 — Ingestion wiring (`orders`)

13. **`orders.module.ts`** — add `InventoryModule` to `imports`. `MappingsModule` is already imported.

14. **`order-ingestion.service.ts`** — inject `RESERVATION_SERVICE_TOKEN` + `FULFILLMENT_ROUTING_SERVICE_TOKEN`, **appended last** (ctor goes 14 → 16 deps, matching how `productsService` / `taxRateJournal` were added). Private `reserveOrderInventory(order, connectionId)` called immediately after `persistOrder`: resolves `atpEffect` (D3), builds lines from `order.items`, calls the service, retries once on `AmbiguousReservationPositionError` with those lines dropped (D4), logs the outcome. Whole body in try/catch, never rethrows (D6).

### Phase 4 — Tests + docs

15. `libs/core/src/inventory/application/services/__tests__/reservation.service.spec.ts` — repeat claim granted with `deltaApplied: 0`; delta-adjust; `InsufficientAvailabilityError` propagates; two live positions + no explicit id → the throw, naming both; two + explicit id → claims it; zero positions → `skipped: 'no-position'`, other lines still claimed; **terminal row → `skipped: 'already-closed'`, no claim for that line (D7)**; a `held` row is NOT skipped; single `claimHeld` call carrying every claimable line; non-positive quantity rejected before any repository call; `atpEffect` forwarded verbatim; `expiresAt` default resolution.
16. `libs/core/src/inventory/domain/types/reservation-expiry.types.spec.ts` — the coercion matrix (colocated, the `sales-documents` / `order-lifecycle` precedent).
17. `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts` — the positional 16-arg ctor + two new mocks; `omp_fulfilled` ⇒ `diagnostic`; `ol_managed_carrier` ⇒ `published`; `processorAvailable: false` ⇒ `diagnostic`; routing throw ⇒ `diagnostic` + warn; reserve throw ⇒ ingestion still succeeds; ambiguity ⇒ one retry without those lines; cancelled order ⇒ no reserve.
18. `apps/api/test/integration/reservations-ledger.int-spec.ts` — reached via `RESERVATION_SERVICE_TOKEN` from the barrel (not the spec's local port re-declaration): a crash simulated between insert and commit leaves the order re-reservable; a second identical `reserveForOrder` creates no second row; **a released row is not resurrected**.
19. `apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts` — additionally resolve `RESERVATION_SERVICE_TOKEN` from the real `AppModule`, proving the §3 require-graph constraint on a real boot.
20. `docs/architecture-overview.md § 3 Inventory` — one paragraph.

### Database Migrations

**None.** This is an application layer over the table #2343 shipped (migration `1850000000000`). Both persistence changes are **reads**. The allocated slot `1854000000000` is **not used** and remains free. (Note `docs/lessons.md`: integration schema is built by `synchronize`, not migrations — nothing here depends on a constraint that exists only in the migration.)

### Configuration

`OL_RESERVATION_TTL_MS` (optional; default 7 d, clamped `[1 h, 90 d]`) and `OL_RESERVATIONS_ENABLED` (default `true`, D8), both documented in `apps/api/.env.example` and `apps/worker/.env.example`.

### Events

None emitted or consumed.

---

## 7. Alternatives Considered

**A1 — Resolve `atpEffect` inside `ReservationService`.** Rejected: it moves a *fulfillment* read into `inventory`, creating the `inventory → fulfillment` edge ADR-061 decision 1 exists to eliminate — the same edge, relocated from read time to write time.

**A2 — Throw on zero positions, like the ambiguity gate.** Rejected: uncovered variants are routine, and ANALYSIS names the throw as a defect producing "a permanent domain rejection of a real, paid order". Ambiguity differs in kind — it is the one case where continuing means guessing.

**A3 — Read the existing held row first, then decide insert vs update.** Rejected: unlocked read-then-act on a quantity. D7's read is a different question over monotone state (see D2/D7).

**A4 — Fail ingestion on `InsufficientAvailabilityError`.** Rejected — **and this rejection resolves an open question rather than applying a settled rule.** ANALYSIS §6I actually rules the other way for this arm: *"Zero rows ⇒ insufficient ATP or a stale row ⇒ domain rejection, roll back the whole order's set"*, and the Wave-5 note has ingestion throw so the runner retries. The design's "shortfall-is-a-fact" language is about a **different** arm — a *post-hoc* fact where the master later drops `availableQuantity` below `olReservedQuantity`, which is why there is deliberately no `CHECK (olReserved <= available)`. The reasons to reject anyway are practical and stated in D6: an advisory hold must not lose a paid order, and the retry ladder cannot change the condition. Revisit alongside #2349, which gives the refusal somewhere to be seen.

**A5 — One `claimHeld` per line.** Rejected: forfeits the deadlock ordering, the transaction and the all-or-nothing rollback in one move.

**A6 — Defer the terminal-state gate to #2346/#2347.** Rejected: this issue ships the call site that creates the hazard, and each of those two issues would reasonably assume the other handled it. See D7.

---

## 8. Validation & Risks

### Compliance
- ✅ Hexagonal; service implements a sibling `*.service.interface.ts`; Symbol token in `<ctx>.tokens.ts`; barrel `export *`.
- ✅ `check-cross-context-imports`: `IReservationService` and `RESERVATION_SERVICE_TOKEN` match allow-shapes; `ReservationRepositoryPort` stays off the barrel (imported relatively). **No ALLOW_LIST entry is added.**
- ✅ `barrel-purity.spec.ts`: `inventory` carries only the smoke assertion; the strict zero-sibling-edge rule covers other contexts.
- ✅ No `any`, no `console.log`, `as const` unions.

### Risks

| Risk | Mitigation |
|---|---|
| A `RESERVATION_LEDGER_READER_TOKEN` swap slipping in would change every published quantity | Untouched here; separately pinned by #2345's Story-I1 test. |
| An ambiguous variant loses that line's hold | Reported loudly + the other lines still hold (D4). Multi-location is latent today (WooCommerce hardcodes `locationId: undefined`, PrestaShop ignores `_locationId`), so the gate should be unreachable — note that `inventory_items`' partial unique indexes include the **nullable** `locationId`, and Postgres treats NULLs as distinct, so those indexes do not themselves prevent two `locationId IS NULL` rows; what prevents duplicates is the master-sync upsert's provenance-scoped lookup (#2320). |
| `OrdersModule → InventoryModule` CJS require cycle | §3 constraint + the boot spec at Phase 4 item 19. |
| Unstable `orderLineId` mints a second hold | Named in §5 (residual PrestaShop `index` fallback); out of scope, not a surprise. |
| node-postgres `[rows, affectedCount]` tuple regression | The service issues no raw SQL; #2343's dual-reply-shape unit coverage is untouched. |

### Backward compatibility

Additive. No existing behaviour changes for a caller that does not reserve, and reservations do not yet feed any published number (#2345).

---

## 9. Testing Strategy & Acceptance Criteria

Unit specs mock the **ports**, never the concrete repositories. Integration additions run on real Postgres via `--runTestsByPath`.

Acceptance criteria (from the issue):
- [ ] A repeated `reserve` for the same `(order, line, position)` returns granted and creates no second row
- [ ] An amended quantity delta-adjusts under the guarded UPDATE; an insufficient delta raises `InsufficientAvailabilityError` and leaves the original row intact
- [ ] `atpEffect` is required at the call boundary (type-level) and never mutated afterwards (test)
- [ ] A two-position variant with no explicit position raises `AmbiguousReservationPositionError`, naming both positions
- [ ] A crash simulated between insert and commit leaves the order re-reservable (integration test)
- [ ] Tests added; no boundary violations

Added by review: a terminally-closed line is never re-held (D7), unit + integration — including that the gate holds when the line re-resolves to a *different* position, and that it does not leak across lines of the same order; that the ambiguity retry is genuinely single-pass over a MULTI-line order and that a throw from the retry still does not fail ingestion; and that the D8 kill switch suppresses the hold while leaving ingestion otherwise unchanged.

---

## 10. Alignment Checklist

- [x] Hexagonal architecture
- [x] CORE vs Integration boundary respected
- [x] Existing patterns reused (insert-then-recover, guarded UPDATE, best-effort side effect, pure `*.types.ts` rule)
- [x] Idempotency is the central property — including across terminal closes (D7)
- [x] Error handling: four named domain errors reachable, all documented
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] Execution-ready

---

## Related Documentation

- ADR-061 — advisory reservations and `AvailabilityAuthority`; ADR-058 — multi-location positions
- `docs/plans/analysis/DESIGN-oms-authority-model.md` §4.2, §13.1
- `docs/plans/analysis/ANALYSIS-1032-oms-module.md` §6I
- `docs/plans/implementation-plan-reservation-ledger.md` (#2343)
