# Implementation Plan: Erli Order Status & Fulfillment Writeback (#997)

**Date**: 2026-06-16
**Status**: Draft / Ready for Review
**Estimated Effort**: ~2–3 days (adapter + tests); the cancellation→stock-restore half is **partly blocked** — see §5 and §8.
**Branch / worktree**: `997-erli-writeback` (stacked on the full Erli chain: #994 mapper, #993 OrderSource, #995 normalizer, #996 webhooks)
**Realises**: Product spec #978 User story 6; lands the [ADR-025](../architecture/adrs/025-erli-marketplace-adapter.md) §4a cancel-restore *mechanism* (the *trigger* remains a core follow-up — see §6 Documentation Gaps).

---

## 0. TL;DR — the two halves and their honest status

#997 is **two distinct writebacks** with very different readiness:

| Half | Seam status | Trigger status | #997 can deliver? |
|---|---|---|---|
| **A. Dispatch / fulfillment writeback** (mark sent + push tracking back to Erli) | ✅ **Seam EXISTS** — `OrderDispatchNotifier` sub-capability of `OrderSourcePort` (`libs/core/src/orders/domain/ports/capabilities/order-dispatch-notifier.capability.ts:30-48`). | ⚠️ **Trigger EXISTS but is UNWIRED** — `ShipmentDispatchNotificationService.notifySource` (`libs/core/src/shipping/application/services/shipment-dispatch-notification.service.ts:135-180`) resolves the source `OrderSource` adapter, narrows with `isOrderDispatchNotifier`, and calls `notifyDispatched(...)`, but **no call-site fires the service yet** (header line 28 "Unwired in #837 (no trigger)"). Wiring is #837/#769's job, in-progress. | **ADAPTER METHOD, tested** — implement `notifyDispatched` on the Erli OrderSource adapter, mirroring Allegro. It plugs into the existing orchestration with zero core changes; end-to-end dispatch writeback goes live once the #837 trigger wiring lands. |
| **B. Cancellation → stock-restore compensating write** | ⚠️ **Mechanism exists** (`ErliOfferManagerAdapter.updateOfferQuantity`, #984/#1066) but **no marketplace-source cancel/observe hook exists in core**. | ❌ **Trigger DOES NOT EXIST** — OL is *inbound-only for order status*. It ingests `cancelled` and persists it, but emits **no domain event** and offers **no outbound hook** on an order-status transition (`OrderProcessorManagerPort` has only `createOrder`; no `OrderStatusChangedEvent`, no event-bus publish in `OrderIngestionService`). | **PARTIAL** — implement the restore *mechanism* (a thin adapter method that calls `updateOfferQuantity`) and unit-test it in isolation, but **the trigger that detects cancellation and calls it must be flagged as a missing core hook** (dependency/follow-up), not fabricated. |

**Bottom line:** **Both halves ship a tested adapter method awaiting a core wiring that is someone else's issue.** Half A ships `notifyDispatched` (tested), plugging into the existing `ShipmentDispatchNotificationService`; that service's own live wiring is in-progress under #837/#769. Half B ships the stock-restore *mechanism* (tested), but its cancellation *trigger* does not exist as an issue yet — it is a core order-lifecycle hook proposed as a follow-up (Q-T2). The plan implements what it can and explicitly scopes both gaps.

---

## 1. Task Summary

**Objective**: Push fulfilment status (and tracking, where applicable) back to the Erli marketplace as OpenLinker processes an order, and — on cancellation — issue the stock-restore compensating write that Erli does not perform itself.

**Sub-objectives**:
1. Map OL order/shipment lifecycle → Erli statuses (`pending` / `purchased` / `cancelled`), in reverse of the #994 ingest mapper where sensible.
2. **Tracking inversion (omit-on-absence)**: omit `trackingNumber` when it is absent — the natural case, an Erli-managed / `omp_fulfilled` shipment produces no OL-side waybill (Erli generates and sets it server-side); attach `trackingNumber` when present — a non-Erli carrier (OL-issued / brokered) with a real waybill. (Not a marketplace-platformType check — see §5.4.)
3. On cancellation, trigger the **stock-restore** compensating write via `updateOfferQuantity` (ADR-025 §4a, mechanism from #984/#1066).

**Context**: Erli auto-decrements stock on purchase but **does not restore it on cancellation** (ADR-025 Context bullet 5). Erli also generates its own shipment/waybill for Erli-managed deliveries, so blindly echoing a tracking number would conflict with Erli's own assignment. #993's review concluded the cancel-restore was deferred because "core has no order-cancellation orchestration yet" — #997 must resolve the seam question rather than assume the trigger.

**Classification**: **Integration / Adapter** (primary) + **flagged CORE dependency** (the missing cancellation-observe hook — out of scope to *build*, in scope to *document as a blocker*).

---

## 2. Scope & Non-Goals

### In Scope
- **A.** Implement `OrderDispatchNotifier.notifyDispatched(...)` on the Erli `OrderSource` adapter (the #993 `ErliOrderSourceAdapter`), mirroring `AllegroOrderSourceAdapter.notifyDispatched` (`libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:82-116`).
  - Mark the order sent on Erli (status writeback).
  - **Tracking inversion (omit-on-absence)**: omit `trackingNumber` when absent (Erli-managed / `omp_fulfilled` shipment produces no OL waybill); attach it when present (non-Erli carrier with a real waybill).
- **B-mechanism.** Implement an Erli stock-restore method (thin: resolve/own the `updateOfferQuantity` call to write the pre-purchase quantity back) and unit-test it over authored fixtures. Wire it to **whatever cancellation signal exists**; if none, expose it behind a clearly-named adapter method and **flag the missing trigger**.
- Reverse status-mapping table (OL → Erli) co-located in the provisional Erli order/fulfillment types.
- `#992-PROVISIONAL` isolation of the Erli status-update endpoint, payload shape, and status vocabulary (single reconciliation point — extend `erli-order.types.ts` or add `erli-fulfillment.types.ts`). (No "Erli-managed detection" predicate — the inversion is a direct omit-on-absence of `trackingNumber`; see §5.4.)
- Unit tests over authored fixtures: status push per lifecycle, tracking included-vs-omitted, cancellation→restore.

### Out of Scope (explicit non-goals)
- **Building a new core order-lifecycle / cancellation-observe hook or domain event.** This is the central gap (§5, §8). #997 documents it as a dependency; it does not invent it. (Wiring the `ShipmentDispatchNotificationService` *itself* into a live trigger is also out of scope — that is #837/#769's responsibility.)
- Confirming the real Erli API (endpoint, payload, status values, frozen-detection) — blocked on #992 sandbox; everything is provisional.
- Reconciliation reads of Erli order/fulfillment status (the snapshot-poll backstop is #996/#989 territory, not this issue).
- Refund/return writeback (Erli `cancelled` carries no refund signal in v1 — see #994 mapper `derivePaymentStatus` returning `undefined` for cancelled).
- Any FE/admin surface.

### Constraints
- **#992 unconfirmed**: Erli's status-update endpoint, payload shape, and status value set are all UNCONFIRMED. Build provisionally behind `#992-PROVISIONAL` with a single reconciliation point. (The tracking inversion itself is not #992-dependent — it is a direct omit-on-absence of `trackingNumber`, §5.4.)
- **Stacked branch**: depends on #993 (`ErliOrderSourceAdapter` exists), #994 (`erli-order.mapper.ts` + `erli-order.types.ts`), #984/#1066 (`ErliOfferManagerAdapter.updateOfferQuantity`). The plan assumes those land first in the chain.
- No production code / no PR from this planning step. Single-PR (plan + implementation share the branch).

---

## 3. Architecture Mapping

**Target Layer**: **Integration** (`libs/integrations/erli/`), implementing **existing core ports** — no new core port required for Half A.

**Capabilities Involved**:
- `OrderSourcePort` + `OrderDispatchNotifier` sub-capability (Half A — the writeback seam). Definitions:
  - `libs/core/src/orders/domain/ports/order-source.port.ts` (base port)
  - `libs/core/src/orders/domain/ports/capabilities/order-dispatch-notifier.capability.ts:30-54` (sub-capability + `isOrderDispatchNotifier` guard)
- `OfferManagerPort` + `updateOfferQuantity` (Half B mechanism) — `ErliOfferManagerAdapter.updateOfferQuantity` (#984, post-#1066: `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts:293-308`).
- `DispatchCarrierHint` — `libs/core/src/orders/domain/types/dispatch-carrier-hint.types.ts:15-25` (`{ platformType: string }`), passed into `notifyDispatched`.

**Existing Services Reused (the trigger orchestration — Half A)**:
- `ShipmentDispatchNotificationService` (`libs/core/src/shipping/application/services/shipment-dispatch-notification.service.ts`) — already resolves the source adapter, narrows with `isOrderDispatchNotifier` (line 163), and calls `notifyDispatched` (lines 168-172) with `trackingNumber: shipment.trackingNumber ?? undefined` and the resolved `carrier` hint. **Erli's adapter slots in here with zero core change.**
- `FulfillmentRoutingResolution` / `FulfillmentProcessorKind` (`libs/core/src/mappings/domain/types/fulfillment-routing.types.ts:36-55`) — the canonical "who manages the shipment" signal (`omp_fulfilled` | `ol_managed_carrier` | `source_brokered`). Not consumed by #997: the omit-on-absence inversion needs no routing signal. Threading it into `notifyDispatched` would be the prerequisite for any future belt-and-braces suppression — a CORE wiring change out of scope here (see §5.4 / Q-T1).

**New Components Required** (all in `libs/integrations/erli/`):
- `notifyDispatched` method on the Erli OrderSource adapter (#993's `ErliOrderSourceAdapter`) — declares `implements OrderSourcePort, OrderDispatchNotifier`.
- `erli-fulfillment.types.ts` (or an extension of `erli-order.types.ts`) — provisional status-update endpoint, payload, OL→Erli status map. **Single `#992-PROVISIONAL` reconciliation point.** (No Erli-managed detection predicate — the inversion is omit-on-absence at the attach site, §5.4.)
- A stock-restore helper/method (Half B mechanism) — owns the `updateOfferQuantity` call for restore.
- Unit specs.

**Core vs Integration Justification**:
- **Half A belongs in the integration.** The writeback seam (`OrderDispatchNotifier`) and the trigger (`ShipmentDispatchNotificationService`) already exist in core and are platform-neutral. Erli only contributes the adapter method — exactly the Allegro pattern. Core stays unchanged.
- **Half B mechanism belongs in the integration** (it's an Erli-specific compensation per ADR-025 §4a — "the adapter owns two Erli-specific compensations"). **Half B's missing trigger is a CORE gap** that #997 must not build (it would be a cross-context order-lifecycle observation feature, not an Erli detail) — see §5 / §8.

---

## 4. External / Domain Research (with file:line citations)

### 4.1 The marketplace-source writeback seam — IT EXISTS (Half A)
`#993`'s review (and the task brief) hypothesised "no core order-cancel/observe hook" and asked whether Allegro has a marketplace-side writeback capability. **It does**, for the *dispatch/fulfillment* axis:

- **Capability port**: `OrderDispatchNotifier` — `libs/core/src/orders/domain/ports/capabilities/order-dispatch-notifier.capability.ts:30-48`:
  ```ts
  export interface OrderDispatchNotifier {
    notifyDispatched(input: {
      externalOrderId: string;
      trackingNumber?: string;
      carrier?: DispatchCarrierHint;
    }): Promise<void>;
  }
  ```
  It is an **optional sub-capability of `OrderSourcePort`** (#837), narrowed via `isOrderDispatchNotifier(adapter)` (lines 50-54). The header (lines 4-13) states it is *not* Allegro-specific: "any marketplace source that supports a mark-shipped + push-tracking write implements it."
- **Allegro implementation (the mirror target)**: `AllegroOrderSourceAdapter.notifyDispatched` — `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:82-116`:
  - `PUT /order/checkout-forms/{id}/fulfillment` with `{ status: 'SENT' }` (lines ~90-93) — the **status writeback**.
  - `POST /order/checkout-forms/{id}/shipments` with `{ carrierId, waybill, carrierName? }` **only when a tracking number is present** (lines ~108-111) — the **tracking attach**.
  > This is the exact shape #997 mirrors for Erli, with the **tracking inversion** applied: omit the tracking attach when `trackingNumber` is absent (the Erli-managed / `omp_fulfilled` case), attach it when present (§5.4).
- **The trigger orchestration**: `ShipmentDispatchNotificationService.notifySource` — `libs/core/src/shipping/application/services/shipment-dispatch-notification.service.ts:135-180`. It:
  1. resolves the order's `sourceConnectionId` from the `OrderRecord` (line 140);
  2. resolves the source external id via `identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Order, …)` (lines 143-149);
  3. resolves the `OrderSource` capability adapter (lines 156-159);
  4. narrows with `isOrderDispatchNotifier` (line 163), skipping gracefully if absent;
  5. calls `adapter.notifyDispatched({ externalOrderId, trackingNumber: shipment.trackingNumber ?? undefined, carrier })` (lines 168-172).
  - **Status-gate** (lines 95-98): only fires for a `generated` shipment → at-most-once notify.
  - **Caveat**: the header (line 28) says *"Unwired in #837 (no trigger), exactly as #835 shipped `dispatch()`"* — i.e. the *service exists but no live call-site invokes it yet*. That wiring is #837/#769's responsibility; #997 only supplies the Erli adapter method that the service will call once wired.

### 4.2 The cancellation → stock-restore trigger — IT DOES NOT EXIST (Half B)
- **Inbound-only for order status.** OL ingests cancellation as a feed event type (`order-feed.types.ts:20` → `['created','updated','cancelled','paid']`) and Allegro maps source events to it (`allegro-order-source.adapter.ts` `mapAllegroEventType` → `if (t.includes('CANCEL')) return 'cancelled'`). The cancelled status is hydrated by `OrderIngestionService.syncOrderFromSource` and persisted to the `OrderRecord` snapshot (`order-record.orm-entity.ts` `orderSnapshot` JSONB).
- **No outbound observation hook.** Exhaustive search found **no** `OrderStatusChangedEvent`, **no** event-bus publish on status change in `OrderIngestionService`/`OrderSyncService`, and **no** worker job type for order-status-change observation (only `marketplace.orders.poll` and `marketplace.order.sync`, registered at `apps/worker/src/sync/handlers/handler-registration.service.ts:59-60`). `OrderProcessorManagerPort` has only `createOrder` (`libs/core/src/orders/domain/ports/order-processor-manager.port.ts:54`).
- **The only status-driven writeback path is shipment→shipped** (`OrderFulfillmentUpdater.updateFulfillment`, `libs/core/src/orders/domain/ports/capabilities/order-fulfillment-updater.capability.ts:38`) — driven by a *shipment dispatch* event, **not** by an order *cancellation*. There is no analogous "shipment cancelled / order cancelled → restore stock" trigger.
- **Conclusion**: the stock-restore *mechanism* is buildable today; the *trigger that detects cancellation and calls it* is a missing core hook. #997 must flag it, not fabricate it (see §8 / Q-T2).

### 4.3 The restore mechanism — `updateOfferQuantity` (Half B mechanism)
- `ErliOfferManagerAdapter.updateOfferQuantity` (#984, post-#1066: `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts:293-308`, now fronted by the `isStockFrozenCached` guard):
  ```ts
  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    if (await this.isStockFrozenCached(cmd.offerId)) {
      // #1066: skip the push for a seller-frozen offer (cache-miss fails open)
      return;
    }
    const body: ErliProductPatchBody = { stock: cmd.quantity };
    await this.httpClient.patch(this.productPath(cmd.offerId), body);
  }
  ```
  This is a `PATCH … { stock }` against the Erli product (now fronted by the `isStockFrozenCached` guard, #1066 — `:293-308`). It is **absolute-set** (`{ stock: cmd.quantity }`), so the restore must compute an **absolute target**, not a delta. The restore flow resolves the **OfferManager** adapter for the Erli connection (via `getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')`), computes the target from OL's authoritative master inventory, and calls `updateOfferQuantity`. The product-id interpolation in `productPath` uses the fail-closed `ERLI_PRODUCT_ID_PATTERN` allowlist (`:400-408`) — the restore keys on an `ol_variant_*` offerId, so the allowlist applies (distinct from the encode-only `erliOrderPath` used by the Half-A status push). (ADR-025 §4a names this mechanism.)
- **Authoritative restore-quantity source**: OL's **master inventory** — `IInventoryQueryService.getAvailabilityByVariantIds` (#823, variant-keyed). Because Erli auto-decremented on purchase and `updateOfferQuantity` sets an absolute value, the restore writes the master-authoritative available quantity for the variant. **Do NOT read back Erli stock** and add to it: Erli's ~20-min cache lag (ADR-025) makes a read-back unreliable, and a stale read repeated across retries double-counts. Master is the single source of truth.

### 4.4 Status mapping (reverse of #994) and the shipping/tracking model
- **#994 ingest mapper** (worktree 993: `erli-order.mapper.ts:93-104`): Erli→OL is `purchased→processing`, `cancelled→cancelled`, `pending→pending`. Erli's confirmed three-status set is `'pending' | 'purchased' | 'cancelled'` (`erli-order.types.ts:34`, `#992`-provisional vocabulary).
- **#997 needs OL→Erli (reverse)** — see the table in §6 Implementation Details.
- **Shipping / "who manages the shipment"**:
  - `Shipment` entity carries `trackingNumber: string | null` (`shipment.entity.ts:40`) and `carrier: string | null` (`shipment.entity.ts:71`), plus `providerShipmentId: string | null` (`:38`).
  - **The definitive "who manages" signal** is `FulfillmentProcessorKind` (`fulfillment-routing.types.ts:36-55`): `omp_fulfilled` (no OL label, `providerShipmentId == null`) vs `ol_managed_carrier` / `source_brokered` (OL/broker issued a label, has a tracking number).
  - The `ShipmentDispatchNotificationService` already passes `trackingNumber: shipment.trackingNumber ?? undefined` (`:170`) — so **when OL issued no label, `trackingNumber` is already absent**. This is the natural hook for the Erli inversion: an **Erli-managed** delivery is one where Erli itself owns the waybill, so OL has no `trackingNumber` to push, and the adapter simply omits the attach. (Note: `carrier.platformType` here is the *shipping carrier* connection's type, never `'erli'` — see §5.4.) See §5.4.

---

## 5. The central design resolution

### 5.1 What seam pushes status/fulfillment BACK to Erli (the OrderSource marketplace)?
**`OrderDispatchNotifier`, a sub-capability of `OrderSourcePort`** — it already exists and is platform-neutral (`order-dispatch-notifier.capability.ts:30-48`). Erli's `OrderSource` adapter (#993) declares `implements OrderSourcePort, OrderDispatchNotifier` and supplies `notifyDispatched`. **No core addition required for Half A.** Mirror `AllegroOrderSourceAdapter.notifyDispatched` (`allegro-order-source.adapter.ts:82-116`).

### 5.2 What triggers the writeback?
`ShipmentDispatchNotificationService.notifySource` (`shipment-dispatch-notification.service.ts:135-180`), fired when a `Shipment` reaches `generated` status. It resolves the Erli `OrderSource` adapter, narrows with `isOrderDispatchNotifier`, and calls `notifyDispatched`. **This trigger exists** — though the service is itself awaiting a live call-site (#837/#769); that wiring is not #997's job. #997's deliverable is the adapter method that the trigger invokes.

### 5.3 The cancellation → stock-restore trigger specifically
**It does not exist in core** (§4.2). OL learns of cancellation by *ingesting* it (feed event `cancelled` → persisted to the order snapshot), but emits **no event and exposes no hook** on that transition. Therefore #997:
- **Delivers**: the Erli stock-restore *mechanism* (a thin adapter method that resolves the absolute target from OL **master inventory** — `IInventoryQueryService.getAvailabilityByVariantIds`, #823 — and calls the absolute-set `updateOfferQuantity`; never a read-back-and-increment of Erli stock, which double-counts under Erli's cache lag) + isolated unit tests.
- **Flags as a dependency / follow-up (BLOCKED)**: the core order-lifecycle observation hook that would *detect* the cancellation and *call* the restore. See §8 Q-T2 for the proposed minimal core seam (a domain event on order-status transition, or a dedicated `order.cancelled` writeback orchestration mirroring `ShipmentDispatchNotificationService`). #997 should **not** build this; it should land the mechanism and open a follow-up issue.

> **Honest scope statement**: Half A ships the `notifyDispatched` adapter method (tested); end-to-end dispatch writeback awaits the #837/#769 trigger wiring (the orchestration service exists but is itself unwired). Half B's restore *mechanism* lands and is tested, but is **not end-to-end functional** until a core cancellation-observe hook exists (no issue yet; Q-T2 proposes it). Both halves are tested adapter methods awaiting a core wiring owned by another issue. The PR must state this plainly and not wire a fake trigger.

### 5.4 Tracking inversion — omit-on-absence, attach-when-present
**Rule**: **omit `trackingNumber` from `notifyDispatched` when it is absent; attach it when present.** This is the natural case, not a marketplace-platformType check:
- An Erli-managed / `omp_fulfilled` shipment produces **no OL-side waybill**, so `shipment.trackingNumber` is already `null`/`undefined` when the orchestration calls `notifyDispatched` (it passes `trackingNumber: shipment.trackingNumber ?? undefined` at `shipment-dispatch-notification.service.ts:170`). The adapter omits the tracking attach — Erli generates and owns the waybill server-side.
- A **non-Erli carrier with a real waybill** (OL-issued / brokered, e.g. inpost/dpd) yields a present `trackingNumber`; the adapter attaches it. This mirrors Allegro's "tracking present ⇒ attach" guard (`allegro-order-source.adapter.ts:108`).

This fails toward the safe direction: when OL holds no waybill there is nothing to conflict with Erli's own assignment, and when OL *does* hold a real carrier waybill it propagates it.

**No `carrier.platformType === 'erli'` guard.** `DispatchCarrierHint.platformType` is the **shipping carrier** connection's platformType (inpost/dpd/…), sourced from `resolveCarrierHint(shipment.connectionId)` (`shipment-dispatch-notification.service.ts:119-121`) — Erli is the order **source**, not a carrier, so this value is **never** `'erli'`. A platformType-based suppression guard would be dead code keyed on an input the real orchestration never produces. A genuine belt-and-braces suppression (OL holds a waybill but it must not reach Erli) would require threading `FulfillmentProcessorKind` / the routing resolution into `notifyDispatched` — a CORE wiring change this issue does **not** make. Deferred; not built here.

---

## 6. Questions & Assumptions

### Open Questions
- **Q-992-1 (endpoint)**: What is Erli's order status-update endpoint and HTTP verb? (Allegro uses `PUT …/fulfillment` + `POST …/shipments`.) **Provisional**: a `PATCH /orders/{id}` (or `…/fulfillment`) carrying a status field; pinned in `erli-fulfillment.types.ts`.
- **Q-992-2 (status vocabulary + direction)**: Does Erli accept a "sent/dispatched" status on writeback, and what is the exact token? The ingest set is `pending|purchased|cancelled` (`erli-order.types.ts:34`) — there is **no confirmed "shipped/sent" value**. **Provisional**: assume a `dispatched`/`sent` writeback token distinct from the ingest set; pin in the reconciliation file. If Erli has no sent-status writeback at all, Half A degrades to tracking-attach only (or no-op) — flag at sandbox.
- **Q-992-3 (payload shape)**: tracking field name(s) on the writeback (waybill / carrier id / carrier name)? **Provisional**: `{ trackingNumber, carrier? }`.
- **Q-992-4 (Erli-managed detection)**: How is an "Erli-managed shipment" identified? **Resolution**: purely the **absence of an OL-issued waybill** — `trackingNumber` is `undefined` when Erli owns the delivery, present when a non-Erli carrier issued a real waybill. No platformType check (the carrier hint is the *shipping carrier* type, never `'erli'` — §5.4). No `isErliManagedShipment` predicate is needed; the omit-on-absence rule is a direct `trackingNumber == null` check at the attach site.
- **Q-992-5 (restore quantity source)**: For stock-restore, what absolute quantity does OL write back? **Resolution (authoritative)**: resolve the target from OL's **master inventory** — `IInventoryQueryService.getAvailabilityByVariantIds` (#823) — and set it absolutely via `updateOfferQuantity`. **Do NOT** read back Erli stock and increment: `updateOfferQuantity` is absolute-set, Erli's ~20-min cache lag (ADR-025) makes a read-back stale, and a stale read repeated across retries double-counts. Master inventory is the single source of truth; the absolute-set is naturally re-runnable.
- **Q-T1 (trigger richness)**: Does the dispatch trigger need the `FulfillmentRoutingResolution` to distinguish Erli-managed, or is `trackingNumber` absence sufficient? **Assumption**: absence is sufficient for v1. A genuine belt-and-braces suppression (OL holds a real waybill that must not reach Erli) would require threading `FulfillmentProcessorKind` into `notifyDispatched` — a CORE wiring change not made here; deferred (§5.4).
- **Q-T2 (the cancellation hook — the blocker)**: There is no core hook that fires on an order-status transition to `cancelled`. **What is the intended core seam?** Two candidates: (a) a domain event `OrderStatusChangedEvent` emitted by `OrderIngestionService` when a re-ingested order transitions to `cancelled`, consumed by a new `OrderCancellationWritebackService`; or (b) a dedicated orchestration service mirroring `ShipmentDispatchNotificationService` that resolves the source `OfferManager` adapter and calls the restore. **#997 does not build either** — it flags this for a follow-up issue and ships the restore mechanism behind a tested adapter method.

### Assumptions
- #993 (`ErliOrderSourceAdapter`), #994 (`erli-order.mapper.ts` + `erli-order.types.ts`), and #984/#1066 (`ErliOfferManagerAdapter.updateOfferQuantity`) are merged into this stacked branch before #997 implementation begins.
- The `ShipmentDispatchNotificationService` orchestration is the canonical dispatch trigger; #997 does not change it and does not wire it (that is #837/#769).
- Erli accepts `source:"allegro"`-tagged ids elsewhere; writeback uses the **external order id** Erli already knows (resolved upstream by the orchestration — the adapter does no identifier mapping, per the capability header line 40-41).
- Reverse status map reuses #994's decisions: OL `shipped`/`processing` writes back as Erli "dispatched/sent" (provisional); OL `cancelled` is the restore trigger, not a status push (Erli already knows it cancelled — it cancelled it).

### Documentation Gaps
- ADR-025 §4a says cancel-restore is "deferred to #993 … core has no order-cancellation orchestration yet." That **#993** reference is now reassigned: the cancel-restore **mechanism** lands in **#997**, and its **trigger** is a separate core follow-up (Q-T2, not yet an issue). #997 should update ADR-025 §4a (or add a short note) recording the mechanism→#997 / trigger→follow-up split — keeping the ADR honest.

---

## 7. Proposed Implementation Plan

### Phase 1 — Provisional reconciliation surface (`#992-PROVISIONAL`)
**Goal**: one file owns every unconfirmed Erli writeback detail.

1. **Create `erli-fulfillment.types.ts`** (or extend `erli-order.types.ts` if cohesion is better)
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-fulfillment.types.ts`
   - **Action**: define, all marked `#992-PROVISIONAL`:
     - the status-update endpoint path + verb constants (Q-992-1);
     - `ErliFulfillmentStatus` writeback token(s) + the **OL→Erli reverse status map** (Q-992-2);
     - the dispatch/tracking payload body type (Q-992-3);
     - a header comment naming this the single reconciliation point.
   - **Path hygiene**: the status-update path interpolates the Erli-issued `externalOrderId` via `erliOrderPath` (`erli-inbox.types.ts:79-85`), which is `encodeURIComponent`-**only** — NOT the fail-closed regex allowlist `productPath` uses (`erli-offer-manager.adapter.ts:400-408`). Encoding blocks path-traversal/injection and the order id is Erli-issued (not operator-controlled), so encode-only is acceptable here. (The Half-B restore path keys on an `ol_variant_*` offerId and DOES go through `productPath`'s allowlist — keep that.)
   - **Acceptance**: adapter imports all wire shapes/constants only from here; grep for `#992` finds one cohesive block.
   - **Dependencies**: #994's `erli-order.types.ts` (for `ErliOrderStatus` reuse).

### Phase 2 — Half A: dispatch / fulfillment writeback (adapter method ships tested; live writeback awaits #837 wiring)
**Goal**: Erli `OrderSource` adapter marks orders sent and pushes tracking back, with the inversion.

2. **Add `notifyDispatched` to the Erli OrderSource adapter**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-order-source.adapter.ts` (#993)
   - **Action**: declare `implements OrderSourcePort, OrderDispatchNotifier`; implement `notifyDispatched({ externalOrderId, trackingNumber, carrier })`:
     - status writeback: PATCH/PUT the Erli order to the provisional "sent/dispatched" status (Q-992-2);
     - tracking attach: **only when `trackingNumber` is present** (§5.4) — mirror Allegro's "tracking present ⇒ attach" guard verbatim. No platformType-based suppression (the carrier hint is never `'erli'`).
   - **Acceptance**: `isOrderDispatchNotifier(erliOrderSourceAdapter)` returns `true`; a present `trackingNumber` (non-Erli carrier with a real waybill) → one status write + one tracking attach; an absent `trackingNumber` (Erli-managed / `omp_fulfilled`) → status write only, **no** tracking attach.
   - **Dependencies**: Phase 1; #993 adapter present.

3. **Surface the capability in the plugin manifest / dispatch**
   - **File**: `libs/integrations/erli/src/erli-plugin.ts` + the Erli adapter factory (#993/#984 wiring)
   - **Action**: ensure `OrderSource` capability already includes the dispatch-notifier (no new capability name needed — `OrderDispatchNotifier` is a sub-capability narrowed by guard, not a separate registry capability). Confirm the factory returns an `OrderSourcePort` instance that *also* implements `OrderDispatchNotifier`.
   - **Acceptance**: `getCapabilityAdapter<OrderSourcePort>(erliConnectionId, 'OrderSource')` returns an adapter that passes `isOrderDispatchNotifier`.
   - **Dependencies**: Step 2.

### Phase 3 — Half B: stock-restore mechanism (lands; trigger flagged blocked)
**Goal**: a tested Erli stock-restore method; the cancellation trigger documented as a missing core hook.

4. **Implement the stock-restore mechanism**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts` (#984) — add a thin `restoreStock(...)` (or reuse `updateOfferQuantity` directly) helper, OR a small Erli-side orchestration helper that computes the restore target and calls `updateOfferQuantity`.
   - **Action**: given the cancelled order's line items, resolve each Erli offer/product and call `updateOfferQuantity` with the restore target quantity. **Q-992-5 strategy: resolve the absolute target from OL master inventory (`IInventoryQueryService.getAvailabilityByVariantIds`, #823) and set absolute — NOT a read-back of Erli stock + increment (Erli's ~20-min cache lag would double-count under retry).**
   - **Method header (REQUIRED)**: the restore method's JSDoc header MUST announce that it is **wired to NO live trigger** — core has no order-cancellation-observe hook (§4.2, Q-T2) — so a future reader does not assume it is live. Match the offer-adapter precedent (`erli-offer-manager.adapter.ts:45-49`, the existing "Stock-restore-on-cancel … DEFERRED … no trigger is wired here" note).
   - **Acceptance**: unit test asserts `updateOfferQuantity` is called with the master-derived absolute target per line item; no-op when the order has no Erli offer mapping.
   - **Dependencies**: #984/#1066 `updateOfferQuantity`; `IInventoryQueryService.getAvailabilityByVariantIds` (#823).

5. **Document the missing trigger (no fabrication)**
   - **File**: code header on the restore method + the PR description + an ADR-025 note + a new follow-up issue.
   - **Action**: state plainly that the restore mechanism is wired to NO live trigger because core has no order-cancellation-observe hook (§4.2, Q-T2); propose the minimal core seam (domain event or dedicated writeback orchestration) as the follow-up. Do **not** add a placeholder/fake call-site.
   - **Acceptance**: reviewer can see exactly what is functional vs blocked; the follow-up issue captures the core hook (Q-T2 candidates a/b).
   - **Dependencies**: Step 4.

### Implementation Details

**OL → Erli reverse status map** (provisional `#992`, reverse of #994's `mapStatus` `erli-order.mapper.ts:93-104`):

| OL lifecycle | Erli writeback action | Notes |
|---|---|---|
| `processing` (Erli `purchased` ingested) | no status push | already `purchased` on Erli; nothing to write |
| `shipped` (shipment `generated`/`dispatched`) | status → Erli "dispatched/sent" (Q-992-2) + tracking attach **when `trackingNumber` present** (omit on absence) | this is the Half-A `notifyDispatched` path |
| `delivered` | (v1) no push | capability header line 20-22: v1 carries no status arg beyond "dispatched"; "delivered" is a future field |
| `cancelled` | **no status push**; trigger **stock-restore** (absolute-set `updateOfferQuantity` to the master-inventory target, #823) | Erli already knows it cancelled (it cancelled it); the action is the compensating stock write — **blocked on trigger (Q-T2)** |
| `refunded` / `returned` | out of scope (no refund signal in v1) | #994 `derivePaymentStatus` returns `undefined` for cancelled |

**Tracking-inversion rule**: attach `trackingNumber` ⇔ `trackingNumber` is present (a non-Erli carrier with a real waybill); omit it when absent (an Erli-managed / `omp_fulfilled` shipment produces no OL-side waybill — Erli generates and sets it server-side). This is omit-on-absence, **not** a marketplace-platformType check; the `carrier` hint is the shipping carrier's type and is never `'erli'` (§5.4).

**Configuration / migrations / events**: none. No new env var, no DB schema change, no new domain event (the *absence* of one is the Half-B blocker, not something #997 introduces).

**Error handling**: reuse the Erli exception hierarchy (`erli-api.exception.ts`, `erli-authentication.exception.ts`, etc.) already in the package; `notifyDispatched` lets the orchestration's per-source try/catch classify failures (the orchestration logs + leaves `generated` for retry on failure — `shipment-dispatch-notification.service.ts:174-178`).

**Log hygiene (required)**: neither `notifyDispatched` nor the restore path may log `trackingNumber` or `externalOrderId` at info/warn — a waybill is minor PII. Error logs are message-only (the exception message, no payload values). This is an acceptance criterion (§11).

**Idempotency / retry**: the dispatch trigger's status-gate (only `generated` shipments) gives at-most-once notify; the Erli 202-async model (ADR-025) means writeback is fire-and-reconcile — do not read-after-write to confirm. Restore writes are absolute-set (Q-992-5) to be re-runnable.

---

## 8. Honest delivery vs blocked (the trigger-hook gap)

| Deliverable | Status | Why |
|---|---|---|
| `OrderDispatchNotifier.notifyDispatched` on Erli (status writeback) | ✅ Deliverable | Seam + trigger both exist (`order-dispatch-notifier.capability.ts`, `shipment-dispatch-notification.service.ts`). |
| Tracking inversion (omit when `trackingNumber` absent) | ✅ Deliverable | Omit-on-absence at the attach site; no core change, no platformType guard. |
| OL→Erli reverse status map | ✅ Deliverable | Provisional, reverse of #994 mapper. |
| Stock-restore **mechanism** (`updateOfferQuantity` call) | ✅ Deliverable + unit-tested | `ErliOfferManagerAdapter.updateOfferQuantity` (#984/#1066) can set stock. |
| Stock-restore **trigger** (detect cancellation → call restore) | ❌ **BLOCKED** | Core is inbound-only for order status; **no** order-status-change event or outbound hook exists (§4.2). Requires a new core seam (Q-T2) — explicitly a follow-up, not #997. |
| Live wiring of the dispatch trigger itself | ⚠️ Out of scope | `ShipmentDispatchNotificationService` is "Unwired in #837 (no trigger)" — wiring is #837/#769, not #997. #997 only supplies the adapter method it calls. |

**What #997 actually ships**: a tested Erli dispatch/tracking writeback adapter method (`notifyDispatched`) that plugs into the existing shipment-dispatch orchestration — end-to-end dispatch writeback goes live once the #837/#769 trigger wiring lands — plus a tested stock-restore mechanism that is **ready to be called** the moment a core cancellation-observe hook lands. Both halves ship a tested adapter method awaiting a core wiring owned by another issue; the only asymmetry is that Half A's wiring (#837/#769) is in-progress while Half B's trigger does not yet exist as an issue (Q-T2 proposes it). The plan does not fake either missing trigger.

---

## 9. Alternatives Considered

### Alt 1 — Add a brand-new core "marketplace order-status writeback" port for #997
- **Description**: define a new `OrderStatusWriter` capability port in core for Erli.
- **Why rejected**: `OrderDispatchNotifier` already *is* that seam for the dispatch axis, and it's platform-neutral. Adding a parallel port duplicates the contract and violates "prefer reusing existing abstractions." The only genuinely-missing core seam is the **cancellation-observe trigger** (Q-T2), which is an order-lifecycle concern, not a per-marketplace writeback port.
- **Trade-off**: none lost — Erli mirrors Allegro exactly.

### Alt 2 — Wire the cancellation trigger now (build the core hook in #997)
- **Description**: emit an `OrderStatusChangedEvent` from `OrderIngestionService` and consume it in a new core service that calls Erli's restore.
- **Why rejected**: that is a cross-context CORE feature (order-lifecycle observation) affecting every source/destination, with its own design surface (event shape, idempotency, who-restores-what). Bolting it onto #997 would over-scope an integration issue and risk a half-baked core abstraction. Better as a deliberate follow-up.
- **Trade-off**: #997's Half B is mechanism-only until the follow-up — accepted and clearly flagged (§8).

### Alt 3 — Always echo `trackingNumber` to Erli (no inversion)
- **Description**: skip the Erli-managed detection and always attach tracking.
- **Why rejected**: directly contradicts the issue and ADR-025 — Erli generates its own waybill for Erli-managed shipments; echoing a number would conflict with Erli's server-side assignment.
- **Trade-off**: none — the inversion is the point of the issue.

---

## 10. Validation & Risks

### Architecture Compliance
- ✅ Integration implements existing core ports (`OrderSourcePort` + `OrderDispatchNotifier`); core unchanged for Half A. Mirrors Allegro precisely.
- ✅ No domain-layer framework deps; provisional types in a `*.types.ts` file (engineering-standards §Type Definitions in Separate Files).
- ✅ Adapter narrowed via the existing `is*` guard pattern; no string platform-matching in core.

### Naming Conventions
- ✅ `erli-fulfillment.types.ts` (types file), method `notifyDispatched` (mirrors capability + Allegro), adapter stays `*-adapter.ts` / `Erli{Capability}Adapter`.

### Existing Patterns
- ✅ Reuses `ShipmentDispatchNotificationService` orchestration and `isOrderDispatchNotifier` guard verbatim; reuses Erli exception hierarchy and `#992-PROVISIONAL` single-reconciliation-point convention (matches `erli-order.types.ts`/`erli-product.types.ts`).

### Risks
- **R1 — #992 vocabulary wrong**: Erli may have no "sent" writeback status at all. *Mitigation*: provisional reconciliation file; if absent, Half-A degrades to tracking-attach-only/no-op with a sandbox flag. Single-file fix.
- **R2 — Restore quantity races Erli cache lag** (Q-992-5): a read-back-and-increment over a ~20-min-stale Erli read double-counts under retry. *Mitigation*: set the absolute target from OL **master inventory** (`getAvailabilityByVariantIds`, #823), never a read-back of Erli stock; the absolute-set is naturally re-runnable.
- **R3 — Trigger never lands**: Half B mechanism sits unused if the core hook follow-up is deprioritised. *Mitigation*: explicit follow-up issue + ADR-025 note; mechanism is cheap and correct in isolation.
- **R4 — Losing a real waybill**: omitting tracking when OL *did* issue a waybill loses it on Erli. *Mitigation*: the rule omits **only** when `trackingNumber` is genuinely absent and attaches whenever it is present, so a real OL-issued waybill is always propagated. (The inverse risk — pushing a waybill Erli shouldn't see — does not arise via the carrier hint, which is never `'erli'`; suppressing a present waybill would need the deferred routing-signal wiring, §5.4.)

### Edge Cases
- Order with no Erli offer mapping at cancellation → restore is a no-op (tested).
- `notifyDispatched` for an order with no source external id → orchestration returns `absent` and skips (existing behaviour, `shipment-dispatch-notification.service.ts:150-152`).
- Erli-managed shipment that *does* carry an OL tracking number (rare) → out of scope for #997: the omit-on-absence rule attaches a present number, and suppressing it would need the deferred routing-signal wiring (§5.4 / Q-T1). Not a real path under current orchestration (Erli-managed deliveries produce no OL waybill).

### Backward Compatibility
- ✅ Additive only. Adding `notifyDispatched` to the Erli adapter and a restore method changes no existing behaviour; no migrations.

---

## 11. Testing Strategy & Acceptance Criteria

**Approach**: unit tests over **authored fixtures** (no live Erli; #992 unconfirmed). Mock `ErliHttpClient` / the OfferManager port; assert request shape and call counts.

### Unit Tests
- **File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order-source.adapter.spec.ts` (extend #993's spec)
  - `notifyDispatched` with a present `trackingNumber` and a `carrier` hint for a real shipping platform (e.g. `platformType: 'inpost'`) → one status write + one tracking attach with the waybill. (Drive the input the real orchestration produces — `carrier` is a shipping-platform hint, never `'erli'`.)
  - `notifyDispatched` with `trackingNumber` absent (Erli-managed / `omp_fulfilled`, the orchestration passing `trackingNumber: undefined`) → status write only, **no** tracking attach.
  - `isOrderDispatchNotifier(adapter) === true`.
- **File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-offer-manager.adapter.spec.ts` (extend #984's spec)
  - stock-restore calls `updateOfferQuantity` with the **master-inventory-derived absolute target** (`getAvailabilityByVariantIds`) per line item — assert the master read drives the value, never a read-back of Erli stock.
  - no Erli offer mapping → no `updateOfferQuantity` call.
- **File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-fulfillment.types.spec.ts` (optional)
  - OL→Erli reverse status-map coverage (each OL lifecycle → expected writeback action).

### Integration Tests
- None required for #997 (no DB/HTTP-real surface beyond the already-tested `ErliHttpClient`; the dispatch orchestration is core-tested elsewhere). The cancellation end-to-end test is **deferred with the trigger follow-up** (can't integration-test a path with no trigger).

### Mocking Strategy
- Mock `ErliHttpClient` (assert PATCH/PUT/POST paths + bodies). Mock the `OfferManagerPort` for restore. Never mock core orchestration in the adapter unit tests — test the adapter method in isolation against the capability contract.

### Acceptance Criteria
- [ ] Erli `OrderSource` adapter implements `OrderDispatchNotifier`; `isOrderDispatchNotifier` returns true.
- [ ] Status writeback fires per the OL→Erli reverse map (provisional).
- [ ] Tracking **attached** when `trackingNumber` present (non-Erli carrier with a real waybill); **omitted** when absent (Erli-managed / `omp_fulfilled`). Test inputs match what the real orchestration produces — `carrier` is a shipping-platform hint, never `'erli'`.
- [ ] Stock-restore mechanism calls `updateOfferQuantity` with the master-inventory-derived absolute target; no-op without an Erli mapping.
- [ ] **Log hygiene**: `notifyDispatched` and the restore path NEVER log `trackingNumber` or `externalOrderId` at info/warn (a waybill is minor PII); error logs are message-only (no payload values). Verified by inspecting every log call on both paths.
- [ ] All `#992`-unconfirmed details live in the single reconciliation file.
- [ ] The missing cancellation-trigger is documented (code header + PR + ADR-025 note + follow-up issue) — **no fabricated call-site**.
- [ ] `pnpm lint && pnpm type-check && pnpm test` green.

---

## 12. Alignment Checklist

- [x] Follows hexagonal architecture (integration implements existing core ports)
- [x] Respects CORE vs Integration boundaries (no core change for Half A; the one genuine core gap is flagged, not built)
- [x] Uses existing patterns (mirrors Allegro `notifyDispatched`; reuses `OrderDispatchNotifier` + `ShipmentDispatchNotificationService`)
- [x] Idempotency considered (status-gate at-most-once; absolute-set restore; 202 fire-and-reconcile)
- [x] Event-driven patterns: N/A for Half A; Half B's missing event is the documented blocker
- [x] Rate limits & retries addressed (reuses `ErliHttpClient` retry/backoff + exception classifiers)
- [x] Error handling comprehensive (orchestration try/catch + Erli exception hierarchy)
- [x] Testing strategy complete (authored-fixture unit tests; integration deferred with trigger)
- [x] Naming conventions followed
- [x] File structure matches standards (`*.types.ts` reconciliation point, `*-adapter.ts`)
- [x] Plan is execution-ready (for everything not blocked on Q-T2)
- [x] Plan is saved as markdown file

---

## Related Documentation
- [ADR-025: Erli marketplace adapter](../architecture/adrs/025-erli-marketplace-adapter.md) (§4a cancel-restore deferral this plan partly closes)
- [Architecture Overview](../architecture-overview.md) (OrderSourcePort, capability sub-capabilities, fulfillment routing)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
