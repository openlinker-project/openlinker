# Pre-implement gate — #1159 Allegro OrderStatusWriteback + relay source-role targeting

**Plan:** `docs/plans/implementation-plan-1159-allegro-order-status-writeback.md`
**Date:** 2026-06-22
**Verdict: ✅ READY**

No reuse collisions, no contract-surface breaks, no migration. Greps run against the live tree at `9cac7822`.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `OrderStatusWriteback` capability + `isOrderStatusWriteback` + event types | **ALREADY EXISTS → reuse** | `libs/core/src/orders/domain/ports/capabilities/order-status-writeback.capability.ts` (merged #1158); exported from `@openlinker/core/orders` |
| `ALLEGRO_FULFILLMENT_STATUS_CANCELLED` const | **NEW (confirmed absent)** | only `ALLEGRO_FULFILLMENT_STATUS_SENT` exists in `allegro-order-fulfillment.types.ts:15` |
| Allegro `write()` method + `markSent` private | **NEW** (`markSent` absent in tree) | `AllegroOrderSourceAdapter` implements `OrderDispatchNotifier` only today |
| Relay `resolveWriteback` private | **NEW** (`resolveWriteback` absent) | `order-lifecycle-relay.service.ts` currently hardcodes `'OrderProcessorManager'` |
| `CapabilityNotSupportedException` / `CapabilityNotEnabledException` | **ALREADY EXISTS → reuse** | `libs/core/src/integrations/index.ts:79-80` (exported from barrel) |
| New port / DI token / ORM entity / service / barrel export | **none** | plan adds none |

## Backward-compatibility findings

| Surface | Assessment |
|---|---|
| Top-level barrels | No symbol removed/renamed. `@openlinker/core/orders` / `@openlinker/core/integrations` consumed only via existing exports. **No break.** |
| Port method signatures | `notifyDispatched` contract unchanged (`markSent` extraction is internal); `IOrderLifecycleRelayService.relay` contract unchanged. Adding `OrderStatusWriteback` to the Allegro `implements` is additive. **No break.** |
| DTO shapes | None touched. |
| Symbol tokens | None added/removed. |
| ORM schema | No entity/migration. **N/A.** |
| `check:invariants` | Relay's new imports (`CapabilityNotSupportedException`, `CapabilityNotEnabledException`) are `*Exception` symbols from the top-level `@openlinker/core/integrations` barrel — on the cross-context allow-list (domain exceptions) and the file already imports from that barrel. No deep-path / repo-URL / service-interface risk. **No trip.** |

## Open questions / notes (non-blocking)

1. **Simplify the relay catch:** `CapabilityNotEnabledException extends CapabilityNotSupportedException`, so `error instanceof CapabilityNotSupportedException` alone narrows both — the plan's explicit two-class check is harmless but redundant. Either is fine.
2. **Allegro cancel-409 semantics** remain a `needs-sandbox-probe` (the plan now treats 409/4xx on cancel as `rejected`, the safe default) — not a gate blocker, just a documented unknown for the sandbox-verification follow-up.
3. **End-to-end cancel→Allegro** is intentionally not wired here (needs the shop-origin trigger in #1160/#1161); the relay reach + adapter capability are unit-tested. Confirmed consistent with #1157 slice sequencing.

**Proceed to implementation.**
