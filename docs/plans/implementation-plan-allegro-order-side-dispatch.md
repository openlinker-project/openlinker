# Implementation Plan — #837 Allegro order-side dispatch (mark-sent + waybill + tracking propagation)

**Issue:** [#837](https://github.com/openlinker-project/openlinker/issues/837) (E3 of #732)
**Spec:** `docs/specs/product-spec-732-allegro-delivery-shipment.md` (§3.7 → A8, "dispatch decomposed" step 5, §5 US-5 / AC-5)
**Branch:** `837-allegro-order-side-dispatch`
**Layer:** CORE (two capability ports + orchestration) + Integration (allegro source-notify, prestashop dest-update)
**Effort:** L (two greenfield capabilities + adapter impls + orchestration)

> Design settled via `/grill-me` + repeated deep `/tech-review`. **Designed capability-first** — PrestaShop/Allegro/InPost are *implementations*, not design drivers. See §6 Decision log.

---

## 1. Goal & scope

Implement the spec's **step 5** ("mark order sent on source + OMP") as **two generic, reusable capability ports** plus a branch-agnostic core orchestration service:

- **(A) Order-source dispatch-notify** — the order *source* (marketplace) is told an order's items shipped → it marks the order sent (+ attaches a waybill when one is supplied). Allegro implements it (`PUT …/fulfillment {status:SENT}` + `POST …/shipments`).
- **(B) Destination order-fulfillment update** — the OMP *processor* receives a post-create status + tracking update. PrestaShop implements it.
- **Orchestration** — `ShipmentDispatchNotificationService` (shipping ctx): given a dispatched `Shipment`, resolve the order's source + destination connection(s) from its `OrderRecord`, and drive A + B.

**Per-branch behaviour (spec "dispatch decomposed"):**
- **Branch 2 (InPost / #727):** OL pushes shipped+tracking to Allegro (full A: SENT + waybill from the InPost shipment's synchronous `Shipment.trackingNumber`) **and** the OMP (B).
- **Branch 3 (Allegro Delivery / #833):** Allegro already brokered the shipment → A = `SENT` only (no waybill); B updates the OMP. (No dependency on #838's async waybill.)

**In scope:** capabilities A + B (ports + `is*` guards), Allegro impl of A, the orchestration service (drives both A and B; the destination half degrades to `unsupported` until a B adapter exists), the `Shipment → dispatched` transition, unit + integration tests.

**Out of scope / deferred:**
- **PrestaShop impl of capability B** (`OrderFulfillmentUpdater`) → **focused follow-up issue.** Rationale (settled via deep `/tech-review`, §6 Q7): the *architecture* is the capability port + orchestration (identical whether the PS adapter lands now or next), and OL's established idiom is **port-then-per-adapter-impl** (#763 port→#812 InPost impl; #832 model→#835 dispatch). The PS write is the one genuinely-uncertain piece — it must use PS's intended primitives (`POST /order_histories` for the state transition so the buyer "shipped" side-effects fire + the `order_carriers` association for tracking, **never** the `orders` full-replace) and needs a PrestaShop-Testcontainer verification that is disproportionate to bundle into this PR. The orchestration already degrades gracefully (`destinations[].status = 'unsupported'`), so #837 is not half-built without it.
- The **trigger model** (manual / auto-on-paid / auto-on-shipped, #727 SC-1) — the service ships **trigger-agnostic & unwired**, exactly as #835 shipped `dispatch()` without a live caller; the call-site is #769/#771.
- **B auto-retry** on failure → best-effort in v1 (see §3.4); a per-target notify-state model is the follow-up.
- **Branch-3 (Allegro Delivery) tracking → OMP** — at #837-notify time the Allegro-Delivery waybill is null (issued async), so B propagates `'shipped'` to the OMP **without** tracking; pushing the **backfilled** tracking to the OMP is **#838's** job (it reuses capability B once it polls the carrier waybill). For branch-3 the buyer already sees tracking on Allegro (it brokered the shipment), so OMP-side tracking is secondary. Explicit designed boundary, not a hole.
- **Dynamic `GET /order/carriers`** resolution + persisting carrier on the `Shipment` → not needed in v1 (no migration).
- Dispatch manifest (#831), shipment-status poll (#838).

---

## 2. Research findings (capability-first; verified)

- **Capability homes (sub-capability pattern, ADR-002).** `OrderSourcePort` (read-only) and `OrderProcessorManagerPort` (only `createOrder`) each get a co-located sub-capability under `orders/domain/ports/capabilities/` + an `is*` guard — same shape as `ShipmentCanceller`/`SourceOptionsReader`/`OfferCreator`. **Sub-capabilities are NOT in `manifest.supportedCapabilities`** → no manifest/routing-int-spec ripple (contrast #833).
- **`OrderRecord` is the resolution backbone.** `IOrderRecordService.getOrderRecord(internalOrderId)` → `sourceConnectionId` + `syncStatus[]` (each: `destinationConnectionId` + `externalOrderId`). So the orchestration resolves the **dest** external id directly from `syncStatus`, and the **source** external id via `IdentifierMappingPort.getExternalIds(Order, internalOrderId)` filtered to `sourceConnectionId`.
- **No new status-mapping surface.** `OrderStatusValues` already has `'shipped'`/`'delivered'`; the PS mapper already has `mapOrderStatusToPrestashop(status)` (`prestashop-order.mapper.ts:418`). Capability B carries OL `OrderStatus 'shipped'`; the dest reuses that mapping + adds a tracking write. `StatusMapping` (source-status→dest-state at create) is untouched.
- **Allegro order-side shapes (verified against developer.allegro.pl):** `PUT /order/checkout-forms/{id}/fulfillment` → `{ "status": "SENT" }` (+ optional `checkoutForm.revision` query, 409 on stale); `POST /order/checkout-forms/{id}/shipments` → `{ carrierId, waybill, carrierName?, lineItems? }` where `carrierId` is from the fixed `GET /order/carriers` vocab and `carrierName` is required only for `carrierId='OTHER'`.
- **Module graph verified acyclic:** `OrdersModule` does NOT import `ShippingModule`; `ORDER_RECORD_SERVICE_TOKEN` is exported from `OrdersModule`. So `shipping → orders` (and `shipping → identifier-mapping`) are clean new edges.
- **`IAllegroHttpClient`** has `put`/`post` returning `{ data, status, headers }`. The Allegro order-source adapter is read-only today and does **not** inject identifier-mapping — and won't need to (capabilities take `externalOrderId`, orchestration-resolved).

---

## 3. Design

### 3.1 Capability A — `OrderDispatchNotifier` (orders ctx)
`libs/core/src/orders/domain/ports/capabilities/order-dispatch-notifier.capability.ts` (+ `isOrderDispatchNotifier` guard):
```ts
interface OrderDispatchNotifier {
  /** Tell the order source an order's items have been dispatched: mark it sent,
   *  and attach the waybill when `trackingNumber` is supplied (absent ⇒ the
   *  source already holds it, e.g. source-brokered branch 3). */
  notifyDispatched(input: {
    externalOrderId: string;                 // resolved by the orchestration
    trackingNumber?: string;
    carrier?: DispatchCarrierHint;           // neutral; adapter maps to its own carrier vocab
  }): Promise<void>;
}
```
`DispatchCarrierHint = { platformType: string }` (orders types). Allegro impl: `PUT …/fulfillment {status:'SENT'}` always; `POST …/shipments` iff `trackingNumber` present, resolving `carrierId` from a **static** `platformType → Allegro carrierId` map (`inpost→INPOST`, …) with `OTHER` + humanized `carrierName` fallback.

### 3.2 Capability B — `OrderFulfillmentUpdater` (orders ctx)
`libs/core/src/orders/domain/ports/capabilities/order-fulfillment-updater.capability.ts` (+ `isOrderFulfillmentUpdater` guard):
```ts
interface OrderFulfillmentUpdater {
  /** Update an already-created destination order's status + tracking. */
  updateFulfillment(input: {
    externalOrderId: string;                 // resolved by the orchestration (from OrderRecord.syncStatus)
    status: OrderStatus;                     // v1: 'shipped'
    trackingNumber?: string;
  }): Promise<void>;
}
```
PS impl reuses `mapOrderStatusToPrestashop(status)` + writes tracking (PS order update; exact WS shape an impl detail).

### 3.3 Orchestration — `ShipmentDispatchNotificationService` (shipping ctx)
`libs/core/src/shipping/application/services/` (+ `application/interfaces/…service.interface.ts`). Deps (all via ports/tokens): `SHIPMENT_REPOSITORY_TOKEN`, `INTEGRATIONS_SERVICE_TOKEN`, `ORDER_RECORD_SERVICE_TOKEN`, `IDENTIFIER_MAPPING_*`.
```
notifyDispatched({ shipmentId }):
  shipment = shipments.findById(shipmentId)
  if shipment.status !== 'generated': return { skipped: 'not-generated' }   // status-gate ⇒ A at-most-once
  record  = orderRecord.getOrderRecord(shipment.orderId)
  carrier = { platformType: integrations.getAdapter(shipment.connectionId).metadata.platformType }
  // A — source notify (primary)
  aOutcome = 'absent'
  if record.sourceConnectionId:
    sourceExtId = getExternalIds(Order, shipment.orderId).find(connectionId===sourceConnectionId)
    if sourceExtId:
      src = getCapabilityAdapter<OrderSourcePort>(sourceConnectionId, 'OrderSource')
      if isOrderDispatchNotifier(src):
        try { src.notifyDispatched({ externalOrderId: sourceExtId, trackingNumber: shipment.trackingNumber ?? undefined, carrier }); aOutcome='ok' }
        catch { aOutcome='failed'; log }
  // B — dest update(s), best-effort, per-destination (allSettled)
  for syncStatus entry with externalOrderId:
    dest = getCapabilityAdapter<OrderProcessorManagerPort>(entry.destinationConnectionId, 'OrderProcessorManager')
    if isOrderFulfillmentUpdater(dest):
      try { dest.updateFulfillment({ externalOrderId: entry.externalOrderId, status:'shipped', trackingNumber: shipment.trackingNumber ?? undefined }) } catch { log }
  // transition
  if aOutcome === 'ok' OR aOutcome === 'absent':
    shipments.update(shipmentId, { status:'dispatched', dispatchedAt: now })
  return per-target outcomes
```

### 3.4 Idempotency / partial-failure (the load-bearing semantics)
- **Status-gate** (`notify only if 'generated'`) makes A's `POST …/shipments` run **at most once** — the dup-safety guard (the `POST /shipments` dedup is `needs-sandbox-probe`).
- **`dispatched` set on A-success OR A-absent** (no source / no capability) — so a non-marketplace-sourced shipment still advances; **A-failure leaves `generated`** (→ retriable: next notify retries A *and* B, B being idempotent).
- **B is best-effort** (logged, **not** auto-retried in v1): once A succeeds we set `dispatched`, gating re-notify — so a B failure after A-success is *not* retried. Accepted v1 cut (B = OMP-internal, idempotent, surfaced in logs); a per-target notify-state (à la `OrderRecord.syncStatus`) is the follow-up.
- **Per-call defensiveness:** Allegro "already SENT"/409-stale-`revision` treated as success.
- **Concurrency caveat:** the gate is not atomic — the live call-site (#769/#771) must serialise per order (same caveat `ShipmentDispatchService` documents).
- **Branch-3 tracking timing:** B runs with whatever `Shipment.trackingNumber` exists at notify time. Branch-2 (InPost) has it synchronously; branch-3 (Allegro Delivery) has `null` then → B pushes status only, and #838 propagates the backfilled tracking to the OMP later via the same capability B (see §1 deferred). #837 does not re-run B.

### 3.5 Files
```
libs/core/src/orders/                                          [NEW capabilities + barrel]
  domain/ports/capabilities/order-dispatch-notifier.capability.ts      (+ guard)
  domain/ports/capabilities/order-fulfillment-updater.capability.ts    (+ guard)
  domain/ports/capabilities/__tests__/*.spec.ts                        (guard specs)
  domain/types/dispatch-carrier-hint.types.ts                          (DispatchCarrierHint)
  index.ts                                                             (export new interfaces + guards + type)

libs/core/src/shipping/                                        [NEW service + wiring]
  application/interfaces/shipment-dispatch-notification.service.interface.ts
  application/services/shipment-dispatch-notification.service.ts (+ .spec.ts)
  application/types/shipment-dispatch-notification.types.ts            (result type)
  shipping.tokens.ts                                                   (+ SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN)
  shipping.module.ts                                                   (+ OrdersModule, IdentifierMappingModule; provide service+token)

libs/integrations/allegro/src/                                 [impl A]
  infrastructure/adapters/allegro-order-source.adapter.ts              (implements OrderDispatchNotifier)
  domain/types/allegro-order-fulfillment.types.ts                     (SENT const + carrier map, sandbox-flagged)
  domain/exceptions/allegro-order-dispatch-rejected.exception.ts
  __tests__/…spec.ts

libs/integrations/prestashop/src/                              [impl B — DEFERRED to follow-up]
  (prestashop-order-processor-manager.adapter.ts implements OrderFulfillmentUpdater
   via POST /order_histories + order_carriers; PS-Testcontainer-verified there)

apps/api/test/integration/                                     [int-spec]
  helpers/dispatch-notify-test-stubs.helper.ts                        (source+dest+carrier stubs)
  shipment-dispatch-notification.int-spec.ts                          (orchestration only)
```
**Migration: none.**

---

## 4. Step-by-step

1. **Capability ports + guards + carrier-hint type** (orders) — `OrderDispatchNotifier`, `OrderFulfillmentUpdater`, `is*` guards, `DispatchCarrierHint`; export via `@openlinker/core/orders` barrel; guard specs. *AC:* guards narrow correctly; barrel exports.
2. **Orchestration service** (shipping) — `ShipmentDispatchNotificationService` per §3.3/§3.4 + interface + token + result type; `shipping.module.ts` imports `OrdersModule` + `IdentifierMappingModule`, provides service+token. *AC:* unit spec covers A-ok→dispatched, A-absent→dispatched, A-fail→generated, B per-dest allSettled, B-fail logged-not-fatal, status-gate skip-if-not-generated; implements an `I*Service` (satisfies #852 invariant).
3. **Allegro impl of A** — `AllegroOrderSourceAdapter implements OrderSourcePort, SourceOptionsReader, OrderDispatchNotifier`; `notifyDispatched` (PUT fulfillment SENT + conditional POST shipments + static carrier map + 409/already-sent handling); fulfillment/carrier types + exception; sandbox-flag enum/shapes/carrierId vocab. *AC:* adapter spec (SENT-only, SENT+waybill, carrier map, OTHER fallback, 409→success). **No manifest change.**
4. **PrestaShop impl of B** — **DEFERRED to a focused follow-up** (§1, §6 Q7). The PS `updateFulfillment` must transition state via `POST /order_histories` (so the buyer "shipped" side-effects fire) and write tracking on the **`order_carriers`** association (not via the `orders` full-replace), verified with a PS-Testcontainer int-spec there. The orchestration degrades to `destinations[].status = 'unsupported'` until it lands, so #837 ships complete without it. **No manifest change.**
5. **Integration coverage** — orchestration int-spec (`shipment-dispatch-notification.int-spec.ts`) mirroring `shipments-read.int-spec.ts`: seeds a `generated` shipment (with tracking) through the **real #835 dispatch seam** routed to an in-memory carrier stub, plus **stub** source (`OrderDispatchNotifier`) + dest (`OrderFulfillmentUpdater`) adapters → asserts A+B invoked with the resolved external ids + carrier hint, and `Shipment → dispatched` (read back via `IShipmentQueryService`, off the cross-context-banned `ShipmentRepositoryPort`). Also asserts the status-gate at-most-once on a second notify. Verifies the *orchestration*, not the (deferred) PS write. *AC:* green on the standard harness + full int-suite stays green (#833 lesson).
6. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`; **`pnpm test:integration`** (full — manifest unaffected, but routing/orders int-specs must stay green per the #833 lesson); `migration:show` (expect none pending).

---

## 5. Validation
- **Architecture:** capability-first (ports neutral; no PS/Allegro leakage in core); sub-capability + `is*` guard (ADR-002); cross-context edges `shipping → orders` / `shipping → identifier-mapping` verified acyclic + contract-compliant (`I*Service`/capability-port/token imports only); domain stays framework-free.
- **No manifest/`supportedCapabilities` change** → no routing-int-spec ripple (the #833 lesson); but still run the full int-suite.
- **Naming:** `*.capability.ts` + `is*`, `*.service.ts`/`*.service.interface.ts` (#852-compliant), `*.types.ts`, `*.exception.ts`.
- **Security:** no secrets; vault-resolved OAuth reused; external-id resolution via identifier-mapping.
- **Sandbox caveats (flagged, localized):** Allegro fulfillment `SENT` spelling, `POST …/shipments` body + `carrierId` vocab + `carrierName`-for-OTHER, the `revision`/409 optimistic-lock, `POST /shipments` dedup — each a single named constant / localized branch.
- **Documented v1 cuts:** B best-effort (no auto-retry); `dispatched` on A-success-or-absent; trigger deferred; carrier static-map (no `GET /order/carriers`); no migration.

## 6. Decision log (`/grill-me` + `/tech-review`)
| # | Decision | Why |
|---|---|---|
| Q1 | Branch-3 = Allegro-already-knows (SENT + dest-update, no waybill); branch-2 = full waybill-attach; waybill from `Shipment.trackingNumber` | spec "dispatch decomposed" step 5 + verified Allegro order API; dissolves the #838 async-waybill chicken-and-egg |
| Q2 | Full **A + B**, capability-first | issue AC bundles both; both are generic reusable capabilities |
| Q3 | A `OrderDispatchNotifier` + B `OrderFulfillmentUpdater` as sub-capabilities; both take **`externalOrderId`** (orchestration-resolves) | sub-cap pattern; `createOrder`'s internal-id convention doesn't transfer (operate on *already-mapped* orders); avoids redundant re-resolution (B) + injecting id-mapping into the source adapter (A) |
| Q4 | Reuse OL `OrderStatus 'shipped'` (PS mapper already maps it) | zero new status-mapping surface; keeps #827's three axes honest |
| Q5 | Neutral carrier hint = processor **`platformType`**; Allegro adapter static-maps → recognized `carrierId`, `OTHER`+humanized fallback | a-vs-b is an adapter-internal detail behind the neutral port; `displayName` is operator-arbitrary (rejected); no `GET /order/carriers`, no migration |
| Q6 | `ShipmentDispatchNotificationService` in **shipping** (verified acyclic); `dispatched` on A-success-or-absent; status-gate (A dup-safety) + `allSettled` per-dest B (best-effort); trigger deferred | shipment-driven + owns the `Shipment` update; partial-failure semantics made explicit; mirrors #835 unwired precedent |
| Q7 | **Defer the PrestaShop impl of capability B to a follow-up**; #837 ships the ports + orchestration + Allegro impl of A | The architecture is the port + orchestration (identical whether the PS adapter lands now or next); OL's idiom is port-then-per-adapter-impl (#763→#812, #832→#835); the PS write is the one uncertain piece (must use `POST /order_histories` + `order_carriers`, never the `orders` full-replace) and needs a PS-Testcontainer verification disproportionate to bundle here; orchestration degrades to `unsupported`, so #837 is not half-built |
