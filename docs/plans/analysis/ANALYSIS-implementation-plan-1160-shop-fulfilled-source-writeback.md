# Pre-implement gate — #1160 Shop-fulfilled (branch-1) → source writeback via the relay

**Plan:** `docs/plans/implementation-plan-1160-shop-fulfilled-source-writeback.md`
**Date:** 2026-06-22
**Verdict: ✅ READY**

Pure additive wiring inside one existing service. No new port/token/ORM/barrel; no contract-surface change; no migration. Greps run against the live tree at `3cede5d0`.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| Lifecycle relay (`relay()`, `OrderLifecycleRelayInput` dispatched event) | **ALREADY EXISTS → reuse** | `order-lifecycle-relay.service.ts`; input event `{type:'dispatched', trackingNumber?, carrier?}` |
| `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` + `IOrderLifecycleRelayService` | **ALREADY EXISTS → reuse** | `orders.tokens.ts:18`; barrel `orders/index.ts:137` — exported from `@openlinker/core/orders` |
| `FulfillmentStatusSyncService` (hook site) | **PARTIAL → extend** | `fulfillment-status-sync.service.ts:109` (`implements IFulfillmentStatusSyncService`) — add ctor dep + private `relayDispatchedToSource` / `isFirstDispatch` |
| `FulfillmentStatusSnapshot` (no carrier field) | **ALREADY EXISTS** | `fulfillment-status-snapshot.types.ts:45-56` — `{status, trackingNumber, deliveredAt}`; carrier hint correctly omitted |
| Transition-gate (at-most-once) | **ALREADY EXISTS → reuse** | `diffPatch` patches only on status change (L363); no new ledger |
| New port / DI token / ORM entity / capability / barrel export | **none** | plan adds none |

## Backward-compatibility findings

| Surface | Assessment |
|---|---|
| Top-level barrels | No symbol removed/renamed. `@openlinker/core/orders` consumed via existing exports only. **No break.** |
| Port / service signatures | `IFulfillmentStatusSyncService.sync()` unchanged (new logic is internal); relay consumed via its published interface. Adding a constructor dependency keeps the service-interface invariant (class still `implements IFulfillmentStatusSyncService`). **No break.** |
| DTO shapes / Symbol tokens | None added/removed. |
| ORM schema | No entity/migration (transition-gate, not a notify-ledger). **N/A.** |
| Module wiring | `shipping.module.ts:76` already imports `OrdersModule`; `orders.module.ts:94` exports `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN`. DI resolves with **no module edit**. |
| `check:invariants` | Shipping→orders import of `IOrderLifecycleRelayService` + token from the top-level barrel is on the cross-context allow-list (`I*Service` + Symbol token). No deep-path / service-interface / repo-URL risk. **No trip.** |

## Open questions / notes (non-blocking)

1. **Scope confirmed by the user at the plan gate:** `OrderDispatchNotifier` retirement deferred to a follow-up; relay fires on dispatched/delivered only (not the `cancelled` transition). The two source-dispatch paths (branch-1 vs #837 OL-managed) are disjoint per order, so leaving #837 alone introduces no double-write.
2. **Accepted residual:** relay-failure has no durable retry (the row is already `dispatched`); logged, surfaced, deferred to #861 (per-destination notify-state). Consistent with ADR-027.
3. **Carrier omitted** for branch-1 (snapshot has none) → source adapter falls back (Allegro → OTHER + name); tracking still propagates.

**Proceed to implementation.**
