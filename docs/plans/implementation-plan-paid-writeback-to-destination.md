# Implementation Plan: Mirror a late payment to destination shops (#3963)

**Date**: 2026-11-05
**Status**: Ready for Review
**Estimated Effort**: 4-5 days (core 1.5, adapters 1, API 0.5, frontend 1.5, e2e 0.5)
**Issue**: #3963
**Mockup**: `docs/plans/mockups/paid-writeback-to-destination.html` (states: `today`, `later`, `retrying`, `stopped`, `cod`, `cancelled`, `first`, `list`, `settings`)

---

## 1. Task Summary

**Objective**: when a buyer pays after the order was already created in a destination shop, mark that shop order as paid, once per shop, and show the operator per shop whether it worked.

**Context**: `OrderSyncService.createOrderIdempotently` skips an order that is already mapped at the destination and has no update path, and the lifecycle relay has no `paid` event. So a payment that arrives after creation never reaches PrestaShop, WooCommerce, Shoper or Shopify. The full evidence (code paths, sources, risks, market research) is in the issue body.

**Classification**: CORE (application + persistence) + Integration (four adapters) + Interface (API) + Frontend.

---

## 2. Scope & Non-Goals

### In Scope
- A new `paid` member of the lifecycle relay, and an `OrderStatusWriteback` arm for it in PrestaShop, WooCommerce, Shoper and Subiekt GT.
- Per-destination outcome, persisted in a new `order_records.paymentWriteback` jsonb column. That column is also the at-most-once claim.
- A dedicated job `order.paymentWriteback.push`, enqueued by ingestion. Retries use the runner's ladder, and on the last attempt the outcome becomes `not-sent`.
- Guards: paid, not cash on delivery, not cancelled, no refund record, and the destination was created unpaid.
- Allegro reports a partial payment as `awaiting`, not `paid`.
- A per-connection setting, `Connection.config.paymentWriteback`.
- API:
  - the order DTO carries `paymentWriteback`;
  - a list filter `paymentNotSent=true`, plus a count;
  - Retry (single and bulk);
  - Mark as handled (single and bulk).
- Frontend:
  - a Payment panel on the order detail page;
  - on the order list, a filter chip, an inline marker on problem rows and bulk actions;
  - a connection setting section.
- The mockup committed to `docs/plans/mockups/`.
- An e2e run before and after the fix (Allegro sandbox to PrestaShop and WooCommerce).

### Out of Scope
- The Shopify `orderMarkAsPaid` arm. It lands with the Shopify adapter (#3928).
- Reversing a payment in the shop (refund writeback). The guard only prevents marking refunded orders paid.
- An operator surface for "paid after cancellation" beyond the order banner. The refund itself stays on the marketplace.
- Cancellation arriving as a plain update without a relay. That is a separate, related gap and gets a follow-up issue.

### Constraints
- No change to orders that were paid before creation. They are created paid exactly as today and get no extra write.
- Source-compatible port changes only: new union members are additive, and adapters compiled against the old shape keep working because the relay treats an unknown event as `unsupported`.
- Local quality gate: `pnpm lint` + `pnpm type-check`. CI runs the tests.

---

## 3. Architecture Mapping

**Target Layers**: CORE `libs/core/src/orders`, Integrations, `apps/api` (orders HTTP), `apps/worker` (job handler), `apps/web`.

**Capabilities Involved**:
- `OrderStatusWriteback` (`libs/core/src/orders/domain/ports/capabilities/order-status-writeback.capability.ts`): gains the `paid` event. No new capability.
- `OrderLifecycleRelayService`: reused unchanged except for the new switch arm. `onlyConnectionIds` (#3540) narrows the fan-out to the destinations that still need the write.

**Existing Services Reused**:
- `OrderIngestionService` (trigger point after the sync settlement loop).
- `IOrderRecordService` + `OrderRecordRepositoryPort` (narrow writers).
- `SyncJobQueuePort` (enqueue).
- The `SyncJobRunner` retry ladder (ADR-007).
- `IOrderRefundService` (refund existence).
- The config-coercer precedent `readStockSafetyBuffer`.

**New Components**:
- Domain:
  - `payment-writeback.types.ts` (outcome union, entry shape, pure `decidePaymentWriteback` rule);
  - `payment-writeback-config.types.ts` (`readPaymentWritebackConfig`).
- Application:
  - `PaymentWritebackService` (+ interface);
  - the worker handler `OrderPaymentWritebackHandler`.
- Infrastructure: repository methods `claimPaymentWriteback`, `recordPaymentWriteback`, `markPaymentWritebackHandled`, and the list-filter predicate; migration.
- Interface: DTO field, list query param, two endpoints.

**Core vs Integration Justification**:
- **Core**: deciding *whether* to mark paid (COD, cancellation, refund, created-paid, claim) is platform-neutral policy. Duplicating it per adapter is exactly how COD would end up marked paid.
- **Integration**: *how* each shop expresses paid (an order state, `set_paid`, a paid amount) stays in its adapter behind `OrderStatusWriteback.write`.

---

## 4. External / Domain Research

### Destination platforms
- **PrestaShop**:
  - "Paid" is an order state with the `paid` flag (default id 2, "Payment accepted").
  - The write is `POST order_histories` via `applyOrderStateTransition`, the path `updateFulfillment('processing')` already uses (`prestashop-order-processor-manager.adapter.ts` ~L1305).
  - Moving to a paid state records an OrderPayment for the remainder. That is PS core behaviour and needs verifying in e2e.
- **WooCommerce**:
  - `PUT /orders/{id}` with `set_paid: true` calls `payment_complete()`, which stamps `date_paid` and moves Pending payment to Processing.
  - A private note goes through `POST /orders/{id}/notes` (`customer_note: false`).
  - `WooCommerceOrderUpdateRequest` (`woocommerce-order.types.ts:95`) has only `status` and must be widened.
- **Shoper**:
  - The order has a writable `paid` amount and a read-only `is_paid`.
  - `ShoperOrderStatusUpdate` is `{status_id}` only.
  - Whether `PUT /orders/:id {paid}` is accepted must be verified live on trial shop sklep729770 before coding the arm.
- **Subiekt GT**: a ZK has no payment state, so it answers `unsupported`.

### Internal patterns
- **At-most-once claim by conditional UPDATE**: `claimShippedNotification` (`order-record.repository.ts:2588`) and `waybill-relay.ts` (claim, release on zero targets, release on transient failure).
- **jsonb partial update without read-modify-write**: the #2352 `omsAttention` writer (one in-Postgres `jsonb_set`, keyed by producer).
- **Orthogonal list axis**: `salesDocumentBlocked` / `omsAttention`, an explicit filter ANDed with health, never a health bucket.
- **Config coercer**: `readStockSafetyBuffer` and `readStockLocationOverride`, pure and read once per call.
- **Job with lane**: `fulfillment.work.dispatch` (realtime lane, `assertFullLaneCoverage`).

---

## 5. Questions & Assumptions

### Open Questions
1. Shoper: is the `paid` amount writable via `PUT /orders/:id`? The live check is step 3.3. If it is not writable, Shoper answers `unsupported` and the issue is updated.
2. PrestaShop: does moving to "Payment accepted" through `order_histories` create the OrderPayment row on PS 9.0.2? Verified in e2e (phase 7). If it does not, we accept the state change alone and note it.

### Assumptions
- One shop's outcome must not block another's, so the claim is per destination (a jsonb entry), not per order.
  - This replaces the `paidRelayedAt` column named in the issue; one column carries both the claim and the outcome.
  - The issue body is updated to match.
- "Created unpaid" is decided by OpenLinker's own record, `paymentWriteback[dest]` absent plus `syncStatus[dest]` synced while the order was not paid.
  - To know this, `syncOrder` reports `created: true` for a create in this run.
  - A create that happens while the order is paid writes `created-paid` and never qualifies.
- Retry: 8 attempts on the runner ladder (about 6 hours). After that the outcome becomes `not-sent`, the order shows the banner and appears under the filter.
- COD is decided by `paymentMethod === 'cash_on_delivery'` or `paymentStatus === 'cod'` on either the current or the stored snapshot. Once COD, always COD for this purpose.
- Default setting is `mark-paid`. `leave` writes the outcome `skipped-by-setting`, which never counts as a problem.
- Payment after cancellation: if the order is cancelled when the payment arrives, every destination gets `not-sent` with reason `cancelled`, and the order shows the "Paid after cancellation" banner.

### Documentation Gaps
- None blocking. `docs/architecture-overview.md` § Orders gets a short bullet for the new event and column.

---

## 6. Proposed Implementation Plan

### Phase 0: Mockup committed
1. **Commit the mockup**
   - **File**: `docs/plans/mockups/paid-writeback-to-destination.html`, assembled from the scratch build with a `data-state` attribute on the app root per state.
   - **Acceptance**: opens from `file://`; every state named in the header resolves by `#state`.

### Phase 1: Core domain
1. **Lifecycle event**
   - **File**: `libs/core/src/orders/domain/types/order-lifecycle-event.types.ts`
   - **Action**: add `'paid'` to `OrderLifecycleEventTypeValues` and the arm `{ type: 'paid'; externalOrderId: string; amount: number; currency: string; paidAt: string | null; sourcePlatformLabel: string }`.
     - The amount and the source label exist so an adapter can write a human note.
     - `paidAt` is the source's instant or `null`, never `new Date()`, per the #2336 rule.
   - **Acceptance**: `pnpm type-check` fails in the relay switch and in every adapter `write` until each handles or declines `paid`. That is the intended compile break.
2. **Payment writeback types + rule**
   - **File**: `libs/core/src/orders/domain/types/payment-writeback.types.ts` (types + pure rule, per the `*.types.ts` pure-rule exception).
   - **Action**:
     - `PaymentWritebackStateValues = ['sending','paid-in-shop','created-paid','retrying','not-sent','cod','not-tracked','skipped-by-setting','handled']`.
     - `PaymentWritebackEntry { state; at; attempts; reason?: 'cancelled'|'refunded'|'retries-exhausted'|'rejected'; detail?: string }`.
     - `PaymentWriteback = Record<destinationConnectionId, PaymentWritebackEntry>`.
     - `readPaymentWriteback(raw)` coerces the stored column.
     - `isPaymentWritebackProblem(entry)` is true for `not-sent` with any reason except `cancelled`, and for nothing else.
     - `decidePaymentWriteback({ order, storedPaymentMethod, isCancelled, hasRefund, destinations })` returns per-destination `send | record(state) | none`.
   - **Acceptance**: unit spec covers every case in the issue's acceptance criteria table (COD both ways, cancelled, refunded, created-paid, setting `leave`, already-paid entry untouched).
3. **Config coercer**
   - **File**: `libs/core/src/identifier-mapping/domain/types/payment-writeback-config.types.ts` (next to the `readStockSafetyBuffer` precedent).
   - **Action**: `readPaymentWritebackConfig(config)` returns `{ mode: 'mark-paid' | 'leave'; paidStateId: string | null }`. Default `mark-paid`. A malformed value warns and falls back to the default.
   - **Acceptance**: unit spec; exported from the barrel.

### Phase 2: Core persistence + services
1. **ORM column + migration**
   - **Files**: `order-record.orm-entity.ts`, `apps/api/src/migrations/<next-synthetic>-add-order-payment-writeback.ts`
   - **Action**:
     - Add `paymentWriteback jsonb NULL`. Exclude it from `toOrm`, which is the single-writer rule.
     - Add a partial index `IDX_order_records_payment_not_sent` on `("updatedAt") WHERE "paymentWriteback" @? '$.* ? (@.state == "not-sent" && @.reason != "cancelled")'`. A plain GIN index on `paymentWriteback` is the fallback if jsonpath index support proves awkward.
     - Next free synthetic timestamp, per `docs/migrations.md`.
   - **Acceptance**: `migration:show` clean; `check-migration-timestamps` passes; down drops both.
2. **Repository writers**
   - **File**: `order-record.repository.ts` + port.
   - **Action**:
     - `claimPaymentWriteback(orderId, destId, now)`: one conditional `UPDATE ... SET "paymentWriteback" = jsonb_set(coalesce(...), {destId}, entry('sending'))`. Allowed only when the entry is absent, `retrying`, or `sending` older than 15 min (a stale crashed claim). Returns `boolean`.
     - `recordPaymentWriteback(orderId, destId, entry)`: an unconditional per-key `jsonb_set`, the only other writer.
     - `markPaymentWritebackHandled(orderIds[])`: flips `not-sent` entries to `handled`.
     - List filter predicate `paymentNotSent` and a count in the summary aggregate (the `omsAttention` shape).
   - **Acceptance**: an int-spec with two overlapping claims for the same (order, destination) yields exactly one `true` against real Postgres.
3. **Sync result reports `created`**
   - **Files**: `order-sync.service.interface.ts`, `order-sync.service.ts`
   - **Action**: add `created?: boolean` to the `success` arm and pass the existing flag through (L379-L395). Optional, so no other caller changes.
   - **Acceptance**: the existing sync spec still passes; a new assertion covers `created`.
4. **`PaymentWritebackService`** (+ `payment-writeback.service.interface.ts`)
   - **Action**:
     - `planAfterSync(order, existing, syncResults)`, called by ingestion. It records `created-paid`, `cod`, `skipped-by-setting` and `not-sent(cancelled)` directly. For destinations needing a write it enqueues `order.paymentWriteback.push` with the idempotency key `payment:{orderId}:{destId}` (one key per destination, stable across re-ingestion).
     - `push(orderId, destIds, attempt, isLastAttempt)`, called by the worker handler:
       - claim each destination;
       - relay `paid` with `onlyConnectionIds = claimed`;
       - map each target result: `applied` or `already-paid` becomes `paid-in-shop`; `no-capability` becomes `not-tracked`; a transient result becomes `retrying`, or `not-sent(retries-exhausted)` on the last attempt;
       - return whether anything is still retrying.
     - `retry(orderIds)`: re-enqueue with a fresh key `payment:{orderId}:{destId}:manual:{epoch}`.
     - `markHandled(orderIds)`.
   - **Acceptance**: unit specs with mocked relay, repository and queue covering each mapping branch; an error in the service never fails ingestion (best-effort, logged).
5. **Ingestion hook**
   - **File**: `order-ingestion.service.ts`, after the settlement loop (~L922) and before the auto-issue trigger.
   - **Action**: call `paymentWriteback.planAfterSync(...)` inside a try/catch that logs and continues. It reads the refund existence through `IOrderRefundService`.
   - **Acceptance**: unit spec (unpaid then paid re-ingest enqueues once per destination; the same paid event again enqueues nothing new because the job key dedups; a retry after the snapshot was already saved still enqueues, because the rule is level-triggered on the column and not on a diff).
6. **Allegro partial payment**
   - **File**: `libs/integrations/allegro/src/.../allegro-payment-status.ts`
   - **Action**: `paidAmount > 0` but below the order total gives `awaiting`.
   - **Acceptance**: unit spec for partial, full and overpaid.

### Phase 3: Integrations
1. **PrestaShop**: `write()` `paid` arm.
   - Read the current state. If it is shipped, delivered, cancelled or refunded, return `unsupported` with the detail "order already past payment". If it already has the paid flag, return `applied` with the detail "already paid".
   - Otherwise transition to `readPaymentWritebackConfig(connection.config).paidStateId`, or to the lowest state with the paid flag.
   - Unit spec for each branch.
2. **WooCommerce**: widen `WooCommerceOrderUpdateRequest` with `set_paid?: boolean`, then the `paid` arm.
   - `cancelled`, `refunded` or `failed` returns `unsupported`.
   - `date_paid` already set returns `applied` (already paid).
   - Otherwise `PUT {set_paid: true}` plus a private note: "Marked paid by OpenLinker. {label} payment {amount} {currency}." A note failure is logged and does not fail the write.
   - Unit spec.
3. **Shoper**: live check first. Record the request and response in the PR description.
   - If `paid` is writable, the `ShoperOrderStatusWriter` `paid` arm does `PUT /orders/:id { paid: <sum> }`, with a guard on cancelled/refunded statuses and already `is_paid`.
   - If it is not writable, `unsupported` with a code comment citing the check.
   - Unit spec.
4. **Subiekt GT**: `paid` returns `unsupported` with "Subiekt GT sales orders have no payment status". Unit spec.
5. **Allegro / Erli (sources)**: their `write` gains `case 'paid': return unsupported`. A source is never a target here (it is the origin), but the switch must stay exhaustive.

### Phase 4: Worker
1. **Job type + handler**
   - **Files**: `JobTypeValues` + payload type; `apps/worker/src/sync/handlers/order-payment-writeback.handler.ts`; registered in the `realtime` lane (a warehouse waits on the shop's paid state).
   - **Action**: call `push`. If anything is still `retrying` and this is not the last attempt, throw a retryable `SyncJobExecutionError` so the runner backs off. Otherwise return `ok`.
   - **Acceptance**: `assertFullLaneCoverage` passes at boot; unit spec for the throw / no-throw split.

### Phase 5: API
1. **DTO**: `OrderRecordResponseDto.paymentWriteback` (per destination: state, at, reason, detail), mapped from the entity.
2. **List**: query param `paymentNotSent=true` and summary count `paymentNotSent`, ANDed like `salesDocumentBlocked`.
3. **Endpoints**:
   - `POST /orders/payment-writeback/retry {internalOrderIds[]}`
   - `POST /orders/payment-writeback/handled {internalOrderIds[]}`

   Both are `@Roles('admin','operator')`, validated with class-validator, and limited to 200 ids.
4. **Connection config**: validate `paymentWriteback` in `ConnectionService.create/update` (mode union, `paidStateId` string or null), using the neutral bounds-check shape of `validateRateLimitConfig`.
5. **Acceptance**: controller specs; `route-authorization-coverage.spec.ts` stays green.

### Phase 6: Frontend (`apps/web`)
1. **Types + hooks**:
   - `orders.types.ts` gains `paymentWriteback`;
   - `useRetryPaymentWritebackMutation` and `useMarkPaymentWritebackHandledMutation` invalidate the order and list keys.
2. **Payment panel**: `features/orders/components/order-payment-panel.tsx` + `lib/payment-writeback.copy.ts`.
   - The panel shows:
     - the headline;
     - the amount and time;
     - "N of N shops updated" (shops whose state is `not-tracked` are left out of N);
     - one row per shop with a dot and a sentence-case word, plus a helper;
     - for `retrying`, a "Retry now" ghost button;
     - a footnote for `not-tracked`.
   - A warning `Alert` appears only when some entry is a problem.
   - Shown on `order-detail-page.tsx` only when `paymentWriteback` has entries. The "Payment" Summary row is removed when the panel is shown.
   - Tests: loading, each state, the banner only on a problem, retry click.
3. **List**: a chip "Payment not sent to shop (N)" bound to the URL param, and an inline marker in the order identity cell for problem rows. When the filter is active, a bar offers "Retry" and "Mark as handled" for the filtered rows. Tests.
4. **Connection settings**: `features/connections/components/payment-writeback-section.tsx` next to `StockAndPricingSection`.
   - Two radios and the paid-state select, fed by the existing PrestaShop/Shoper order-state options read; the select is hidden when the platform has none. Below them, three facts.
   - Zod schema fragment; tests.
5. **Copy**: all strings in `*.copy.ts` so `check-ui-vocabulary` scans them.

### Phase 7: Verification
1. `pnpm lint` + `pnpm type-check` (local); unit + integration suites in CI.
2. **E2E, before and after, on one clean stack** (Allegro sandbox source; PrestaShop + WooCommerce destinations):
   - create an unpaid order and record both shops' states (before);
   - check out the fix, pay on Allegro, re-ingest, and record both shops' states (after);
   - check that a COD order stays unpaid.

   Results go into the PR description and an issue comment.

---

## 7. Alternatives Considered

### A. Update path on re-ingestion (an `OrderProcessorManager` sub-capability like `refreshOrderContact`)
- **Why rejected**: it duplicates participant resolution, per-target outcomes and `unsupported` semantics that the relay already has, for one field. It would also run on every re-ingestion of every order rather than once.

### B. One order-level claim column (`paidRelayedAt`), as the issue first proposed
- **Why rejected**: one slow shop would re-drive every shop (the #861 all-or-nothing problem), and the per-shop outcome would need a second column anyway. The per-destination jsonb entry is both the claim and the outcome.

### C. Fire the relay inline from ingestion
- **Why rejected**: a slow shop would stall ingestion, and a transient failure would need its own retry bookkeeping. A dedicated job reuses the runner's ladder, dead-letter row and lane accounting.

### D. Do not push unpaid orders at all (the Linnworks / ChannelEngine default)
- **Why rejected**: it changes current behaviour for every install, delays stock reservation at the shop, and is a different product decision. It stays possible later as a separate setting.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Policy in core, platform expression in adapters, behind the existing `OrderStatusWriteback` port.
- ✅ No new cross-context edge: refunds and records are both in `orders`.

### Naming Conventions
- ✅ `*.types.ts`, `*.service.ts` + `*.service.interface.ts`, `*.handler.ts`, and kebab-case FE components with `use-*.ts` hooks.

### Risks
- **Marking a COD order paid**: the guard reads the method from both snapshots and is sticky. A unit spec pins the PrestaShop/WooCommerce `cod` to `paid` flip.
- **Moving a shop order backwards**: every adapter arm reads the current state first and declines past-payment states.
- **Double write under a poll/webhook race**: the per-destination conditional claim; the int-spec has two overlapping claims.
- **Stale `sending` after a crash**: re-claimable after 15 minutes, which is longer than the job's attempt timeout.
- **Shoper `paid` not writable**: it falls back to `unsupported`. The live check happens before coding.
- **The new event breaks out-of-tree adapters at compile time**: intended, and documented in the changelog. At runtime an adapter without the arm hits its own `default` and answers `unsupported`, which the relay already maps to `no-capability`.

### Edge Cases
- **Held or router-filtered order**: no destination mapping, so no target. Nothing is enqueued and nothing is recorded; the shop is created paid after release.
- **Destination create retried after payment**: `created: true` while paid gives `created-paid`.
- **Payment then cancellation before the job runs**: the job re-reads the order. If it is cancelled, it records `not-sent(cancelled)` and sends nothing.
- **Operator sets `leave` after a failure**: existing `not-sent` entries stay until "Mark as handled".

### Backward Compatibility
- ✅ The column is nullable with no backfill. Existing orders show no panel and behave as today.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `payment-writeback.types.spec.ts` (the rule).
- `payment-writeback-config.types.spec.ts`.
- `payment-writeback.service.spec.ts`.
- `order-ingestion.service.spec.ts` (hook).
- `order-lifecycle-relay.service.spec.ts` (the `paid` arm).
- Each adapter's `write` spec.
- `allegro-payment-status.spec.ts`.
- The worker handler spec.
- API controller specs.
- FE component and hook tests.

### Integration Tests
- `apps/api/test/integration/orders/payment-writeback-claim.int-spec.ts`: overlapping claims, list filter predicate and count against real Postgres.

### Mocking Strategy
- Relay, queue and repositories are mocked in service specs. Each adapter's HTTP client is mocked in adapter specs. The real Postgres runs in the int-spec.

### Acceptance Criteria
These are the issue's criteria; each maps to the steps above.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (relay, claim, jsonb writer, coercer, job lane)
- [x] Idempotency considered (per-destination claim + job key)
- [x] Event-driven patterns used where applicable (ingestion enqueues a job)
- [x] Rate limits & retries addressed (runner ladder, bounded, then `not-sent`)
- [x] Error handling comprehensive (best-effort in ingestion, typed outcomes)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file
