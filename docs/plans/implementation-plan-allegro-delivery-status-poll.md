# Implementation Plan — #838 Allegro Delivery shipment-status poll sync (cursor-based)

**Issue:** [#838](https://github.com/openlinker-project/openlinker/issues/838) (branch-3 of #732)
**Spec:** `docs/specs/product-spec-732-allegro-delivery-shipment.md` §3.6 (poll-not-webhook), §5 AC-7
**Branch:** `838-allegro-delivery-status-poll`
**Layer:** CORE (shipping orchestration + a small contract widening) + Integration (Allegro scheduler task + adapter delta) + Worker (job handler). **No migration.**

> Builds on the merged trio: #832 routing model, #833 Allegro Delivery shipping adapter, #837 mark-sent orchestration + capability B port, **#858 PrestaShop capability B impl** (the reason this is unblocked — `OrderFulfillmentUpdater` now actually projects status+tracking onto PS, so #838 can re-push backfilled tracking and have something happen).

---

## 1. Goal & scope

A **cursor-based worker job** that periodically polls Allegro Delivery for shipment status + tracking, advances OL's `Shipment` state, and propagates **backfilled tracking** + status to the destination OMP via capability B (`OrderFulfillmentUpdater`).

The pattern mirrors the **#816 offer-status-sync** job: persisted scan-offset cursor on `connection_cursors` (key `allegro.shipmentStatus.scanOffset`), scheduler-enqueued per-connection job, per-page enumeration of OL's own rows (here: `Shipment`s for the Allegro carrier connection).

**In scope**
- New `IShipmentStatusSyncService` (core/shipping) that scans `Shipment`s for one connection, polls each via the carrier's `ShippingProviderManagerPort.getTracking`, updates `Shipment` on change, and pushes status+tracking to the OMP via capability B (resolved per-destination from `OrderRecord.syncStatus`).
- One contract widening on `TrackingSnapshot`: add `trackingNumber?: string` (the adapter has it; `getTracking` just doesn't expose it today — without this, no backfill is possible).
- One small repository widening on `ShipmentFilters`: add `statuses?: readonly ShipmentStatus[]` (multi-status IN) so the scan can exclude terminal rows at the DB layer rather than in-memory.
- Allegro Delivery adapter delta: populate `trackingNumber` from `AllegroShipmentResource` in `getTracking`. No new port methods.
- Allegro scheduler task `allegro-shipment-status-sync` (default cron `0 */15 * * * *` — every 15 min, env-overridable).
- Worker handler `MarketplaceShipmentStatusSyncHandler` registered as `marketplace.shipment.statusSync`.

**Out of scope / deferred**
- Branch-1 (OMP-fulfilled) status read-back — **#834**.
- Richer in-transit / delivered transitions via `GET /order/carriers/{carrierId}/tracking` (the spec's other poll target). v1 uses the existing `GET /shipment-management/shipments/{id}` shape (which only distinguishes generated / dispatched / cancelled). When richer pickup events are needed, extend the Allegro adapter — not the core contract.
- Durable per-target notify-state — **#861**. v1 accepts re-driving capability B per poll; the #858 adapter is idempotent on both axes (state-skip-if-in-state, tracking-skip-if-unchanged), so re-pushes are safe.
- Webhook ingestion — none exists for Allegro `/shipment-management`.

---

## 2. Research findings (verified against the branch)

- **The mould — #816 offer-status-sync** (`apps/worker/src/sync/handlers/marketplace-offer-status-sync.handler.ts` + `libs/core/src/listings/application/services/offer-status-sync.service.ts`). Job reads cursor → calls service.sync(connectionId, {offset, limit}) → persists `nextOffset`. Cursor on `ConnectionCursorRepositoryPort` (`connection_cursors` table). Scheduler task in `allegro-scheduler-tasks.ts` registers cron + enqueue per active connection. Handler returns `{ outcome: 'ok' }` (status-vs-outcome split, #391/#400).
- **Allegro Delivery adapter** (`libs/integrations/allegro/src/infrastructure/adapters/allegro-delivery-shipping.adapter.ts`) already implements `ShippingProviderManagerPort` + `ShipmentCanceller`. **`getTracking({providerShipmentId})` returns `TrackingSnapshot` with the canonical `status` already mapped** from `AllegroShipmentResource` (in `allegro-shipment.mapper.ts`: waybill-present → `dispatched`, `canceledDate` → `cancelled`, else `generated`). The waybill IS available in the resource (`packages[].transportingInfo[].carrierWaybill`) — but `TrackingSnapshot` carries no `trackingNumber` field today, so the adapter can't propagate it through the existing port shape. Adding it is a small generic improvement.
- **`ShipmentRepositoryPort.findMany(filters, pagination)`** already accepts `connectionId` + `status` + paging; the impl uses TypeORM `where`. Adding `statuses?: readonly ShipmentStatus[]` as a multi-status IN is a one-method-body edit.
- **`Shipment` lifecycle**: `draft → generated → dispatched → in-transit → delivered/failed/cancelled`. `TerminalShipmentStatusValues = ['delivered','failed','cancelled']`. `update(id, patch)` accepts `status`, `trackingNumber`, `dispatchedAt`, `deliveredAt`, etc.
- **Capability B** (`OrderFulfillmentUpdater.updateFulfillment({externalOrderId, status, trackingNumber?})`) is what #837's `ShipmentDispatchNotificationService.updateDestinations` calls per-destination. **That service is NOT reusable for #838** — its at-most-once gate (`if (shipment.status !== 'generated') return skipped-not-generated`, line 96) blocks any later push. #838 invokes capability B directly via the same `getCapabilityAdapter('OrderProcessorManager')` + `isOrderFulfillmentUpdater` pattern.
- **`ConnectionCursorRepositoryPort`** (`libs/core/src/sync/`) — `get/set` keyed on `(connectionId, cursorKey)`. Backed by `connection_cursors`. **No migration** — reusing the existing table.
- **Status-vs-outcome (#391/#400)**: handler returns `{outcome:'ok'}` for clean polls; `'business_failure'` is not needed (per-item snapshot misses + OMP pushes are surfaced via per-call logging, not the outcome axis — same shape as offer-status-sync).
- **Spec §3.6**: explicitly maps onto the "offer-status sync (#816)" pattern. AC-7 covers `/shipments` page surfacing — already addressed by #846/#770; no FE work in #838.

---

## 3. Design

### 3.1 Contract widenings (small, generic, reusable)

**`TrackingSnapshot`** — add the optional tracking number:
```ts
// libs/core/src/shipping/domain/types/tracking-snapshot.types.ts
export interface TrackingSnapshot {
  status: ShipmentStatus;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  trackingNumber?: string;        // NEW — carriers that have it return it here
  providerStatus?: string;
}
```
**Why generic, not Allegro-specific:** InPost already has tracking sync at create; #772 (InPost polling fallback) will populate this same field. So it's a base-port concern, not adapter-internal.

**`ShipmentFilters`** — add multi-status IN:
```ts
// libs/core/src/shipping/domain/types/shipment-query.types.ts
export interface ShipmentFilters {
  // … existing
  /** Combined with AND; takes precedence over `status` when both are set. */
  statuses?: readonly ShipmentStatus[];
}
```
Repo impl: `In([...filters.statuses])` when present.

### 3.2 `ShipmentStatusSyncService` (core/shipping)
```
sync(connectionId, { offset, limit }): { scanned, updated, propagated, notFound, total, nextOffset }
  shipments = shipmentRepo.findMany(
    { connectionId, statuses: ['generated','dispatched','in-transit'] },  // exclude terminal
    { offset, limit }
  )

  for shipment in shipments.items:                                         // per-item try/catch
    if !shipment.providerShipmentId: continue                              // not yet generated by carrier
    carrierAdapter = integrations.getCapabilityAdapter<ShippingProviderManagerPort>(shipment.connectionId, 'ShippingProviderManager')
    snapshot = carrierAdapter.getTracking({ providerShipmentId: shipment.providerShipmentId })

    // 0. Compute the *desired* patch from the snapshot (status, dates, trackingNumber).
    patch = diff(shipment, snapshot)

    // 1. OMP propagation gate — see §3.4 for the two v1 workarounds (→ #861 dissolves both).
    //    (a) Push only when there's a NEW tracking number (was null, now set) and
    //    (b) Shipment is already at `dispatched` or richer — so we don't fire 'shipped'
    //        on the OMP before #837's notifyDispatched has had its turn.
    let trackingForPatch = patch.trackingNumber
    if (patch.trackingNumber !== undefined
        AND shipment.trackingNumber == null
        AND shipment.status IN ['dispatched','in-transit']):
      record = orderRecords.getOrderRecord(shipment.orderId)
      for entry in record.syncStatus where entry.externalOrderId:
        adapter = integrations.getCapabilityAdapter<OrderProcessorManagerPort>(entry.destinationConnectionId, 'OrderProcessorManager')
        if (isOrderFulfillmentUpdater(adapter)):
          try:
            adapter.updateFulfillment({ externalOrderId: entry.externalOrderId, status: 'shipped', trackingNumber: patch.trackingNumber })
          catch e:
            log.warn(per-destination push failed); trackingForPatch = undefined  // ← push-first: drop tracking from patch on push failure → next poll retries
    // status/dates always persist; trackingNumber persists iff the push succeeded
    // (or wasn't gated this round).
    finalPatch = { ...patch, trackingNumber: trackingForPatch }
    if finalPatch is non-empty:
      shipmentRepo.update(shipment.id, finalPatch)

  return stats (caller advances cursor)
```

- **Status mapping (Allegro-side semantics):** the adapter's mapper currently returns `'dispatched'` whenever a carrier waybill exists. This is empirically *close enough* for branch-3 because by the time #838 sees the shipment its OL status is already `dispatched` (from the #835 dispatch + #837 notify flow); the *new* fact #838 discovers is the **trackingNumber**, not the status. Status genuinely transitions only on `cancelled`. Richer in-transit/delivered events come from `GET /order/carriers/{carrierId}/tracking` — explicitly **deferred** to a follow-up adapter pass.
- **Per-item isolation:** wrap each shipment's processing in `try/catch` so one carrier-side error doesn't tank the page; mirror #816's loop (tolerate per-item errors, log, continue, count). The handler re-throws only on unrecoverable infrastructure failures (so the cursor doesn't advance and the next scheduled run retries from the same offset).
- **No identifier-mapping call** from this service — `externalOrderId` is resolved from `OrderRecord.syncStatus` (the same pattern as `ShipmentDispatchNotificationService`).

### 3.3 Allegro Delivery adapter delta
In `getTracking`, populate `trackingNumber` from `AllegroShipmentResource.packages[].transportingInfo[].carrierWaybill` (already available; the `mapShipmentStateToStatus` helper reads from the same field). Single-line semantic addition; no new methods, no Allegro plumbing.

### 3.4 v1 workarounds — both dissolve when #861 lands

The two locally-correct gates in §3.2 are symptoms of one missing core architecture: **per-destination notify-state** (a persisted "OL projected version X of status+tracking onto destination Y at T"). Without it, two services (#837, #838) push to the same OMP without coordination *and* without a durable convergence record. With it, both gates dissolve into a reconciler that's the single owner of capability-B calls and re-drives until notify-state matches `Shipment`.

| Workaround | Why v1 needs it | What replaces it under #861 |
|---|---|---|
| **Push-first, then update `Shipment.trackingNumber`** — drop trackingNumber from the patch if the OMP call throws, so the next poll sees the diff and retries. | Without notify-state, the only thing distinguishing "already projected" from "not yet projected" is the Shipment row itself. A naïve "update then push" loses the backfill on transient OMP failures. | Update `Shipment` unconditionally; the reconciler reads notify-state vs Shipment and retries until they match. Shipment becomes carrier truth (always current); notify-state becomes projection truth. |
| **Dispatched-status gate on OMP push** — fire `updateFulfillment(status:'shipped')` only when `Shipment.status >= dispatched`. | Two projectors (#837, #838) can't coordinate timing without a shared record. Without the gate, #838 could fire 'shipped' on the OMP before #837 has its turn — premature email, wrong ordering with the source notify. | Single reconciler owns all capability-B calls; #837 and #838 become *inputs that update `Shipment`*. Ordering is correct by construction (the reconciler fires when `Shipment` changes vs notify-state). |

Both workarounds are **architecturally non-damaging** (local to this service, no schema implications, removable in one PR) — but tag them in the code with `// v1 workaround — removed when #861 lands` so a future reader knows they're staging, not the target shape.

### 3.5 Worker handler — mirrors `MarketplaceOfferStatusSyncHandler`
```ts
@Injectable()
export class MarketplaceShipmentStatusSyncHandler implements SyncJobHandler {
  constructor(
    @Inject(SHIPMENT_STATUS_SYNC_SERVICE_TOKEN) private readonly service: IShipmentStatusSyncService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN) private readonly cursors: ConnectionCursorRepositoryPort,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const cursorKey = job.payload?.cursorKey ?? 'allegro.shipmentStatus.scanOffset';
    const offset = parseOffset(await this.cursors.get(job.connectionId, cursorKey));
    const result = await this.service.sync(job.connectionId, { offset, limit: BATCH_SIZE });
    await this.cursors.set(job.connectionId, cursorKey, String(result.nextOffset));
    return { outcome: 'ok' };
  }
}
```
Registered as `marketplace.shipment.statusSync` in `handler-registration.service.ts`.

### 3.6 Scheduler task (Allegro)
In `buildAllegroSchedulerTasks` add a parallel task `'allegro-shipment-status-sync'` with default cron `'0 */15 * * * *'` (every 15 min — tracking is faster-moving than offers; env override `OL_ALLEGRO_SHIPMENT_STATUS_SYNC_INTERVAL_CRON`). Enqueues `marketplace.shipment.statusSync` per active **Allegro connection that declares `ShippingProviderManager`** (i.e., the Allegro Delivery carrier connection, not the order-source connection).

### 3.7 Files
```
libs/core/src/shipping/
  domain/types/tracking-snapshot.types.ts             (+ trackingNumber? on TrackingSnapshot)
  domain/types/shipment-query.types.ts                (+ statuses?: readonly ShipmentStatus[] on ShipmentFilters)
  infrastructure/persistence/repositories/shipment.repository.ts  (apply statuses IN filter)
  application/interfaces/shipment-status-sync.service.interface.ts   NEW
  application/services/shipment-status-sync.service.ts (+ .spec.ts)  NEW
  application/types/shipment-status-sync.types.ts                    NEW
  shipping.tokens.ts                                  (+ SHIPMENT_STATUS_SYNC_SERVICE_TOKEN)
  shipping.module.ts                                  (+ wire service + token; import OrdersModule, IntegrationsModule already there)
  index.ts                                            (+ export interface + result types)

libs/integrations/allegro/src/
  infrastructure/adapters/allegro-delivery-shipping.adapter.ts       (populate trackingNumber in getTracking)
  infrastructure/mappers/allegro-shipment.mapper.ts                  (expose carrierWaybill via a small helper or extend snapshot construction)
  infrastructure/adapters/__tests__/allegro-delivery-shipping.adapter.spec.ts  (+ trackingNumber case)
  infrastructure/scheduler/allegro-scheduler-tasks.ts                (+ 'allegro-shipment-status-sync' task + ENV var)

apps/worker/src/
  sync/handlers/marketplace-shipment-status-sync.handler.ts (+ .spec.ts)   NEW
  sync/sync-worker.module.ts                                (+ register handler)
  sync/handler-registration.service.ts                      (+ register 'marketplace.shipment.statusSync')

apps/api/test/integration/
  shipment-status-sync.int-spec.ts                                   NEW (cursor advance + Shipment update + capability-B push, stub adapters)
```
**Migration: none.**

---

## 4. Step-by-step

1. **Contract widenings** — `TrackingSnapshot.trackingNumber?`, `ShipmentFilters.statuses?` + repo impl. *AC:* existing specs stay green; the trackingNumber field is recognised by callers that ignore it (additive).
2. **`ShipmentStatusSyncService`** — interface + impl + types + token + module wiring. Diff-based update logic, OMP push only on new-tracking or advanced-status. *AC:* unit spec covers happy + no-change + new-tracking-triggers-push + capability-B-unsupported + per-shipment isolation (one bad apple doesn't tank the page).
3. **Allegro Delivery adapter delta** — populate `trackingNumber` in `getTracking`. Tiny mapper update. *AC:* adapter spec asserts the snapshot carries the waybill.
4. **Allegro scheduler task** — register `allegro-shipment-status-sync` with default cron + env override + per-connection enqueue gated on `ShippingProviderManager` capability. *AC:* scheduler spec / int-spec sees the job enqueue.
5. **Worker handler** — `MarketplaceShipmentStatusSyncHandler` + register in `sync-worker.module.ts` + `handler-registration.service.ts` for `marketplace.shipment.statusSync`. *AC:* handler spec mirrors `MarketplaceOfferStatusSyncHandler` (cursor read → service.sync → cursor write → `outcome:'ok'`).
6. **Integration spec** — `shipment-status-sync.int-spec.ts` mirroring the offer-status-sync int-spec: seed an Allegro carrier connection + an OL `Shipment` (via the #835 dispatch seam routed to an in-memory carrier stub that returns a tracking number on `getTracking` only the *second* call — so the first scan sees null, the second backfills), a destination connection with the stub `OrderFulfillmentUpdater`, and an `OrderRecord` with a synced destination. Run the worker handler twice and assert: cursor advance, `Shipment.trackingNumber` updated, `OrderFulfillmentUpdater.updateFulfillment` called once (only on the poll that newly discovers tracking — idempotent re-push isn't observable).
7. **Quality gate** — `pnpm lint && type-check && test`; `pnpm test:integration` (no manifest/routing change, but #833-lesson suite-wide green). `migration:show` (none).

---

## 5. Validation
- **Architecture:** core ↔ integration boundary holds (the carrier adapter is resolved via `IIntegrationsService.getCapabilityAdapter`; capability B is invoked the same way). Status mapping stays in the carrier adapter (Allegro-WS knowledge), the projection mechanic stays in `OrderFulfillmentUpdater` (PS-WS knowledge), the orchestration sits in core. The two contract widenings are generic + additive (other carriers benefit too).
- **Idempotency / safety:** `Shipment.update` is patch-based; OMP push is gated to "newly-relevant change" to avoid noisy re-drives; PS adapter is itself idempotent (skip-in-state / skip-tracking-unchanged) so any over-firing is benign. Cursor advances after `service.sync` returns successfully (#838 inherits #816's cursor-after-success pattern).
- **No migration; no manifest change.** Sub-capability check: `OrderFulfillmentUpdater` is the existing sub-capability — invoked exactly as #837 does. `ShippingProviderManager.getTracking` is the base port (required), so adapter capability discovery is unchanged.
- **CI:** the new int-spec is module-free (mirrors `#858`'s approach — Allegro adapter is stubbed, no PS container needed for the orchestration assertions). Worker int-spec gap (#786) is unrelated; this PR doesn't depend on it.

---

## 6. Open design notes — to surface at the ⏸️ pause

- **Waybill-presence ≠ true dispatched.** The Allegro adapter's `mapShipmentStateToStatus` returns `'dispatched'` from waybill presence alone — which today is fine because #837 has already set OL `Shipment.status='dispatched'` by then. v1 #838 explicitly does **not** rely on the snapshot's status for the OL→OMP "this just shipped" decision; it only consumes the trackingNumber and any `cancelled` transition. Richer status from `GET /order/carriers/{carrierId}/tracking` is a deferred adapter pass.
- **`status: 'shipped'` is hardcoded in the OMP push** — same as #837. Pushing `'delivered'` (or `'cancelled'`) onto capability B would land in PS via `mapStatusToPrestashopStateId` (`delivered → 5`, `cancelled → 6`), but it's outside #838's primary scope (tracking backfill). Wire it through if the snapshot reaches those statuses; skip otherwise. v1 leans conservative — push `'shipped'` only.
- **Scan cadence:** default `0 */15 * * * *` (every 15 min). Allegro Delivery waybills typically appear within minutes of label creation; hourly (offer-status-sync's cadence) would feel laggy for buyer-visible tracking. Env-overridable.
- **Per-target idempotency:** v1 leans on the PS adapter's idempotency (#858) plus a "new-tracking-only" push gate in this service. Long-term (#861), the durable per-destination notify-state would replace this gate entirely — the service would consult it before calling B, not re-derive from snapshot diffs. Designed-out scope of #838.
