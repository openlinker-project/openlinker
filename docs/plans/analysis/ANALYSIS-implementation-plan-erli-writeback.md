# Pre-Implement Readiness Gate — #997 Erli Status/Fulfillment Writeback

**Date**: 2026-06-16
**Plan**: `docs/plans/implementation-plan-erli-writeback.md`
**Branch**: `997-erli-writeback` (stacked on `996-erli-webhooks`)
**Gate type**: read-only readiness

## Verdict: ✅ READY

Plugin-only, additive. Half A = add the `OrderDispatchNotifier` sub-capability (`notifyDispatched`) to `ErliOrderSourceAdapter` (mirror Allegro) + tracking inversion + reverse status map. Half B = a tested stock-restore mechanism (master-inventory absolute target → `updateOfferQuantity`), trigger honestly deferred. Zero CORE change; no migration; no contract break.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `ErliOrderSourceAdapter.notifyDispatched` | **NEW method** (adapter currently `implements OrderSourcePort` only) | `erli-order-source.adapter.ts:90` |
| `erli-fulfillment.types.ts` (#992-provisional) | **NEW** | `ls` — absent |
| stock-restore mechanism + tests | **NEW** (mechanism only; trigger deferred Q-T2) | — |

## Seam-accuracy findings (confirmed)

| Seam | Status | Evidence |
|---|---|---|
| `OrderDispatchNotifier` + `isOrderDispatchNotifier` | exported from barrel | `orders/index.ts:23-24` |
| `AllegroOrderSourceAdapter.notifyDispatched` (mirror) | present | `allegro-order-source.adapter.ts:82` |
| `ShipmentDispatchNotificationService.notifySource` (trigger, **unwired** #837) | present, narrows + calls notifyDispatched | `shipment-dispatch-notification.service.ts:135-180,:28` (review) |
| `updateOfferQuantity` (absolute-set; fronted by frozen-stock guard) | present | `erli-offer-manager.adapter.ts:293-308` |
| `IInventoryQueryService.getAvailabilityByVariantIds` (#823, restore target) | present | `inventory-query.service.interface.ts:48`; token `inventory.tokens.ts:16` |
| `DispatchCarrierHint` (carrier hint = shipping platform, never 'erli') | present | `dispatch-carrier-hint.types.ts:15-25` (review) |
| `erliOrderPath` (encode-only, not allowlist — stated accurately) | present | `erli-inbox.types.ts:79-85` (review) |
| no core order-cancel hook / `OrderStatusChangedEvent` (the honest gap) | confirmed absent | `order-processor-manager.port.ts` (createOrder-only), grep (review) |

## Backward-compatibility findings

None. Adapter gains an optional sub-capability (additive); new provisional types; new restore mechanism. CORE untouched.

## Open questions / impl-detail to settle in Stage H (non-blocking)

- **Where the master-inventory lookup lives for Half B.** The restore needs `IInventoryQueryService`. If the mechanism is plugin-resident it requires the service in the `HostServices` bag (not currently curated there); the cleaner shape — given Half B has **no trigger** — is for the future core caller (Q-T2) to compute/pass the absolute target, with the Erli side just calling `updateOfferQuantity`. Implementer chooses; flag in the PR.
- **#992-provisional**: Erli status-update endpoint/verb, whether a "sent/dispatched" writeback status token exists (ingest set is only `pending|purchased|cancelled` → Half A degrades gracefully if absent), tracking payload shape. Single reconciliation point `erli-fulfillment.types.ts`.
- **Both triggers are someone else's wiring**: Half A's `ShipmentDispatchNotificationService` is unwired (#837/#769, in-progress); Half B's cancellation hook doesn't exist as an issue yet (Q-T2). #997 ships tested adapter methods; neither is end-to-end live.
