# Implementation Plan — #1160 Shop-fulfilled (branch-1) → source writeback via the lifecycle relay

**Issue:** #1160 (Part of #1157; ADR-027). Realises **User story S1**. Closes #1160.
**Branch:** `1160-shop-fulfilled-source-writeback`
**Layer:** CORE (`shipping` branch-1 read-back → `orders` lifecycle relay).

---

## 1. Goal (restated)

When the **destination shop fulfils** an order itself (branch-1, ADR-012 — OL generates no label), `FulfillmentStatusSyncService` reads the shop's status into a branch-1 `Shipment` row but **never tells the order's source**. Wire that last hop: on observing the shop transition to **dispatched** (shipped), fire the **lifecycle relay** so the order's source participant learns *sent + tracking* via `OrderStatusWriteback({dispatched})` — with **zero platform-type branching** (the relay already resolves targets role-agnostically, #1159).

Because dispatch routes through the relay to "every non-origin participant", **shop → OL → shop** fulfilment propagation falls out by construction (the origin shop, e.g. PrestaShop, already implements `OrderStatusWriteback`).

## 2. Non-goals (this slice)

- **Retiring `OrderDispatchNotifier` / migrating the #837 operator-dispatch path** (`ShipmentDispatchNotificationService`). ADR-027 records that aspiration, and #1159's plan loosely attributed it to #1160 — but #1160's own AC is purely branch-1 → source. The two source-dispatch paths are **disjoint per order** (branch-1 = shop-fulfilled, no OL label, `Shipment` projected straight to `dispatched`; #837 = OL-managed label, `Shipment` gated on `generated` status), so they never double-fire for the same (order, participant) and the "one writer per participant" invariant is not violated by leaving #837 alone. Retiring `OrderDispatchNotifier` is a deliberate cross-cutting refactor (touches Allegro adapter + capability + guard + controller + FE + int-specs) — **a follow-up issue**, not bundled here.
- **Branch-1 destination-shop *cancellation* → source.** #1160 is the dispatch/fulfilled half. Shop-as-source cancellation detection is #1161; destination-shop cancel-relay (if wanted) is a separate follow-up. We fire **only** on the dispatched/delivered transition, never on the `cancelled` transition.
- **A durable per-destination "already notified" ledger.** ADR-027 defers per-destination notify-state to #861. This slice relies on the existing **transition-gate** for at-most-once (see §3.3).

## 3. Verified facts (from research)

- **Hook site:** `FulfillmentStatusSyncService.sync()` (`libs/core/src/shipping/application/services/fulfillment-status-sync.service.ts`). Two persist branches: new-row `createBranchOneShipment` (≈L250-260) and update `diffPatch`+`update` (≈L262-269). `diffPatch` **only patches on a status change** (`projectedStatus !== existing.status`, L363) — re-polls of an unchanged status produce an empty patch and no write.
- **Snapshot shape:** `FulfillmentStatusSnapshot { status: FulfillmentStatus|null; trackingNumber: string|null; deliveredAt: Date|null }` — **no carrier field**. `FulfillmentStatus = 'delivered'|'dispatched'|'cancelled'`.
- **Relay API:** `OrderLifecycleRelayService.relay({ internalOrderId, originConnectionId, event })` where the dispatched event input is `{ type:'dispatched'; trackingNumber?: string; carrier?: DispatchCarrierHint }` (relay adds each target's `externalOrderId`). Token `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` + `IOrderLifecycleRelayService` are exported from `@openlinker/core/orders`. The relay excludes `originConnectionId` and writes to every other participant via `isOrderStatusWriteback`; it surfaces per-target outcomes and **never throws on a single target failure** (but `relay()` itself can throw on an identifier-mapping failure).
- **Module wiring:** `shipping.module.ts` already imports `OrdersModule`, which exports `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN`. No module edit needed beyond injecting the token.
- **Cross-context legality:** importing `IOrderLifecycleRelayService` + the token from `@openlinker/core/orders` into `libs/core/src/shipping/**` is an `I*Service` + Symbol-token import — on the cross-context allow-list.
- **shop→shop:** PrestaShop implements `OrderStatusWriteback.write()` (merged #1158), so an origin PrestaShop reflects dispatch by construction.
- **Self-echo:** branch-1 read-back keys on the *destination's* fulfillment status (not the source feed). OL's own writeback returning as the *source's* feed event is handled by the existing `OrderIngestionService` echo guard (`sourceConnectionId` comparison, ADR-017). No new echo handling needed here.

## 4. Design

### 4.1 `FulfillmentStatusSyncService` — inject the relay
- Constructor: `@Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN) private readonly orderLifecycleRelay: IOrderLifecycleRelayService` (import both from `@openlinker/core/orders`).

### 4.2 Fire the relay on the first dispatch transition
A private best-effort helper:
```ts
private async relayDispatchedToSource(
  internalOrderId: string,
  originConnectionId: string,        // the destination shop being synced — relay excludes it
  snapshot: FulfillmentStatusSnapshot,
): Promise<void> {
  try {
    await this.orderLifecycleRelay.relay({
      internalOrderId,
      originConnectionId,
      // No carrier hint — the branch-1 snapshot doesn't carry it; the source
      // adapter falls back (Allegro → OTHER + name). Tracking is propagated.
      event: { type: 'dispatched', trackingNumber: snapshot.trackingNumber ?? undefined },
    });
  } catch (error) {
    // relay() catches per-target; this guards an identifier-mapping-level throw
    // so one order's relay failure never breaks the fulfillment sync loop.
    this.logger.warn(
      `Branch-1 dispatch relay failed for order ${internalOrderId} ` +
        `(origin ${originConnectionId}): ${this.message(error)}`,
    );
  }
}
```
Call sites (gated so it fires **once**, on the first entry into dispatched-or-delivered):
- **New-row branch** — after `createBranchOneShipment` + `recompute`, when `snapshot.status ∈ {dispatched, delivered}`. (A shop that jumps straight to `delivered` still implies it shipped → the source must learn *sent*.)
- **Update branch** — after `update` + `recompute`, when the patch *first* reaches dispatched: `patch.status === SHIPMENT_STATUS.Dispatched`, **or** `patch.status === SHIPMENT_STATUS.Delivered && !existing.dispatchedAt` (direct-to-delivered with no prior dispatch). A `delivered` transition on an already-dispatched shipment does **not** re-fire.

A small pure helper encodes the decision (`isFirstDispatch(existing, patch)` / `isInitialDispatch(snapshot.status)`), kept readable and unit-tested.

### 4.3 At-most-once (no new ledger)
The transition-gate **is** the at-most-once mechanism: the relay is invoked only inside the status-changed code path. On re-poll, an unchanged status yields an empty `diffPatch` → no write → no relay. A shop's dispatched→delivered progression fires the relay only on the dispatched (or direct-delivered) edge, never twice. This matches AC-2 ("No duplicate mark-sent on re-poll / re-delivery"). **Accepted residual:** if the relay write to the source *fails*, the `Shipment` row is already `dispatched`, so there is no automatic retry — the failure is logged (surfaced), and durable retry/per-destination notify-state is the deferred #861 work. Documented, not built.

## 5. Steps

1. **`fulfillment-status-sync.service.ts`** — inject `IOrderLifecycleRelayService`; add `relayDispatchedToSource` + the `isFirstDispatch` decision; call it in both persist branches. **AC:** relay fired exactly once on first dispatched/delivered; not fired on unchanged re-poll; not fired on `cancelled`; relay throw is caught + logged, loop continues.
2. **`fulfillment-status-sync.service.spec.ts`** — unit tests: (a) new dispatched row → relay `{type:'dispatched', trackingNumber}` with `originConnectionId = connectionId`; (b) update idle→dispatched → relay fired; (c) re-poll unchanged status → relay NOT called; (d) dispatched→delivered (already dispatched) → relay NOT called; (e) direct→delivered (no prior dispatch) → relay fired; (f) `cancelled` transition → relay NOT called; (g) relay throws → `sync()` still completes, warn logged.
3. **Integration** — extend/add a branch-1 int-spec (`apps/api/test/integration/`) asserting: destination-shop reports `dispatched` via a `FulfillmentStatusReader` stub → a source stub implementing `OrderStatusWriteback` receives `write({type:'dispatched', externalOrderId, trackingNumber})`; a second sync pass (unchanged status) does not re-call it. Reuse the dispatch-notify test-stub harness shape.
4. **Quality gate:** `pnpm lint` / `type-check` / `test`; **full `pnpm test:integration`** (relay + fulfillment paths) per the issue note.

## 6. Validation
- Hexagonal: shipping (application) → orders (`I*Service` + token via barrel); no platform branching; relay dispatch by guard (ADR-027). No new ORM entity / migration.
- Service-interface invariant intact (`FulfillmentStatusSyncService` keeps its existing interface; relay is a port dep).
- No `any`; `Logger`; types via barrel.

## 7. Risks
- **Carrier unknown for branch-1** — the snapshot has no carrier; the source adapter falls back (Allegro → `OTHER` + name). Tracking still propagates. Acceptable; a richer branch-1 carrier identity is out of scope.
- **No durable retry on relay failure** — accepted residual (transition-gate, not a ledger); deferred to #861. Logged, not silent.
- **Scope tension on `OrderDispatchNotifier` retirement** — deliberately deferred (§2); surfaced at the plan gate for confirmation.
