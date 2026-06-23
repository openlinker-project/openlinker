# Pre-Implement Analysis — Order-status relay completion (#1168, #1169, #1170)

**Plan:** `docs/plans/implementation-plan-order-status-relay-completion.md`
**Gate date:** 2026-06-23
**Verdict:** ✅ **READY**

One Critical contract surface is touched (a barrel-export removal), but it is **intentional, fully enumerated, and has no out-of-tree consumer** — every in-tree consumer is migrated in the same change. No reuse collisions, no schema change, no migration. Safe to implement.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `OrderLifecycleRelayService` / `IOrderLifecycleRelayService` | **EXISTS → reuse** | `libs/core/src/orders/application/services/order-lifecycle-relay.service.ts` (merged #1159). Plan reuses, does not redefine. |
| `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` | **EXISTS → reuse** | `libs/core/src/orders/orders.tokens.ts:18`; exported via `orders.module.ts` + `@openlinker/core/orders` barrel. |
| `OrderStatusWriteback` + `isOrderStatusWriteback` | **EXISTS → reuse** | `libs/core/src/orders/domain/ports/capabilities/order-status-writeback.capability.ts`. Allegro + PrestaShop already implement `write()` for both `dispatched` and `cancelled`. |
| `OrderLifecycleEvent` (`dispatched`/`cancelled`) + `OrderWritebackResult` | **EXISTS → reuse** | `libs/core/src/orders/domain/types/order-lifecycle-event.types.ts`. `cancelled` member already present — #1170 needs no type change. |
| `FulfillmentStatusSyncService` cancel relay (`isInitialCancel` / `isFirstCancelTransition` / `relayCancelledToSource`) | **NEW (PARTIAL — extend existing)** | grep empty. Mirrors the existing `isInitialDispatch` / `isFirstDispatchTransition` / `relayDispatchedToSource` in the same file (#1160). |
| `fulfillment-relay-test-stubs.helper.ts` | **NEW (confirmed absent)** | `find` empty. The existing `dispatch-notify-test-stubs.helper.ts` is the wrong shape (stubs the to-be-removed `OrderDispatchNotifier`). |
| `fulfillment-status-sync-relay.int-spec.ts` | **NEW (confirmed absent)** | `find` empty. |
| `ShipmentDispatchNotificationService` relay rewiring | **PARTIAL (rewrite internals)** | `libs/core/src/shipping/application/services/shipment-dispatch-notification.service.ts`. Replace `notifySource`/`updateDestinations` with one relay call. |
| `OrderFulfillmentUpdater` | **RETAINED (do not remove)** | Still consumed by `ShipmentStatusSyncService` (#871) + WooCommerce/PrestaShop adapters for provisioning. Plan correctly keeps it. |

**No new ports, DI tokens, ORM entities, controllers, DTOs, or capabilities are introduced.** Every cross-system primitive the plan needs already ships.

---

## Backward-compatibility findings

### 🔴 Critical — barrel-export removal (ADDRESSED, controlled)
- **Surface:** `@openlinker/core/orders` top-level barrel removes `OrderDispatchNotifier` (type) + `isOrderDispatchNotifier` (guard) — `libs/core/src/orders/index.ts:23–24`.
- **Break analysis:** grep of the entire tree shows the only consumers are (a) `ShipmentDispatchNotificationService` (rewritten this change), (b) `AllegroOrderSourceAdapter` (`notifyDispatched` removed this change), and (c) three test files (updated this change). **No out-of-tree / plugin consumer implements `OrderDispatchNotifier`** — only Allegro does, and its `write({dispatched})` (sharing `markSent`) is the replacement. ADR-027 mandates exactly this consolidation ("Fold `OrderDispatchNotifier` into the new capability").
- **Migration path:** all consumers fold into `OrderStatusWriteback`. Because every consumer is enumerated and migrated in the same change set, this is a *controlled removal*, not a latent break → does not force `NEEDS-REVISION`.

### 🟢 Module wiring — already in place (no change needed)
- `libs/core/src/shipping/shipping.module.ts:76` already imports `OrdersModule`, and `ShipmentDispatchNotificationService` is a provider in that same module (`:134`). Injecting `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` into the service requires **only a constructor param** — no module-graph edit, no DI cycle (OrdersModule does not import ShippingModule). Plan's "confirm wiring" step resolves to a no-op.

### 🟢 Port signatures / DTOs — unchanged
- `OrderStatusWriteback.write()` signature untouched. `ShipmentDispatchNotificationResult` / `notify-dispatched-response.dto.ts` shapes preserved (plan re-labels relay results back into `{source, destinations}`). `POST /shipments/:id/notify-dispatched` contract unchanged → no FE break (`use-notify-dispatched-mutation.ts` / `shipments.api.ts` untouched).

### 🟢 ORM schema / migration — none
- No `*.orm-entity.ts` change. No migration. `docs/migrations.md` workflow not engaged.

### 🟢 `check:invariants` — no new violations
- Shipping → orders is an existing, sanctioned cross-context edge (interfaces + Symbol token via the barrel — already used by `FulfillmentStatusSyncService`). No deep-barrel import, no repo-port cross-context import, no service-interface regression (`ShipmentDispatchNotificationService` keeps its `IShipmentDispatchNotificationService`). Plan explicitly avoids new inline types (keeps result types in `*.types.ts`).

---

## Open questions

None blocking. Two design choices already resolved in the revised plan:

1. **Operator-dispatch "origin"** — pass `shipment.connectionId` (carrier) as `originConnectionId`; excludes nothing because carriers aren't order participants. Plan documents the accepted limitation (a hypothetical carrier+order-participant multiplexed connection) and requires a call-site caveat comment. ✔ resolved.
2. **#1031 reference scope** — clarified as a GitHub issue body, not a repo doc; out of scope for the code PR. ✔ resolved.

**Implementation note (not a blocker):** the shared `dispatch-notify-test-stubs.helper.ts` feeds two int-specs; both must stay green after the stubs gain `write()`. Run the full `pnpm test:integration` per the plan's risk section.

---

## Summary
The plan reuses the entire relay/writeback machinery shipped by #1158–#1160 — no port, service, token, entity, or capability is reinvented. The single Critical-surface item (removing `OrderDispatchNotifier` from the orders barrel) is the intended ADR-027 consolidation with every consumer migrated in-change and zero external dependents, so it is a controlled removal rather than a break. Module wiring for the relay injection is already present, there is no schema change, and no `check:invariants` rule is tripped. **Verdict: READY** — proceed to implementation.
