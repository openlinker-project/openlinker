# Readiness gate: cancellation release-before-restore (#2348)

**Verdict**: `READY`

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| Order-scoped ledger close (`closeForOrder`) | **PARTIAL → extend** | `reservation.service.ts:237` already has `consumeForOrder`; only the terminal status is missing. Rename, do not add. |
| `ReservationRepositoryPort.releaseHeld({terminalStatus})` | **ALREADY EXISTS** | `reservation.service.ts:254` passes `'consumed'`; `'released'` needs no new repository method. |
| `IShipmentQueryService.hasConsumedReservations` | **NEW (confirmed absent)** | zero `hasConsumed*` hits repo-wide. |
| Shipment read by order | **ALREADY EXISTS** | `ShipmentRepositoryPort.findByOrderId` (`shipment-repository.port.ts:51`) — no new repository method, no migration. |
| `Shipment.reservationConsumedAt` | **ALREADY EXISTS** | `shipment.orm-entity.ts:137` + partial index at `:60`. |
| ADR-028 restore service | **ALREADY EXISTS** | `listings/application/services/offer-stock-restore.service.ts`; token `OFFER_STOCK_RESTORE_SERVICE_TOKEN`. |
| ATP read | **ALREADY EXISTS** | `IInventoryQueryService.getAvailabilityByVariantIds` — already the restore's source since #2323. |
| `ShippingModule` for DI import | **ALREADY EXISTS + exported** | `shipping/index.ts:12`. |
| `SHIPMENT_QUERY_SERVICE_TOKEN` | **ALREADY EXISTS** | `shipping.tokens.ts:17`. |
| `ReservationsReleased` brand | **NEW** | ordering witness; local to the listings service file's `*.types.ts`. |

**No reuse collision.** The one thing the plan could have reinvented — a `releaseForOrder` twin — is
explicitly ruled out, and the repository already treats terminal status as data.

## Backward-compatibility findings

| Surface | Finding | Severity |
|---|---|---|
| `@openlinker/core/inventory` barrel | `ConsumeForOrderInput` / `ConsumeForOrderResult` are **not** exported (`inventory/index.ts:103-110` exports only the `Reserve*` / `Skipped*` types). The rename is internal. | none |
| `IReservationService` | `consumeForOrder` → `closeForOrder` is a published-interface change, but the interface has exactly **one** production caller (`shipment-reservation-consume.service.ts:70`), inside this same body, plus specs. | Warning — mechanical, compiler-caught |
| `IShipmentQueryService` | Additive method only. Implemented by one class; no plugin implements it. | none |
| `ShipmentRepositoryPort` | Unchanged. | none |
| ORM schema | Unchanged — no migration; slot `1861000000000` stays unused. | none |
| `check-cross-context-imports` | New `listings → shipping` import uses `IShipmentQueryService` (`I*Service`) + `SHIPMENT_QUERY_SERVICE_TOKEN` (`*_TOKEN`) — both **allow** shapes. No allow-list entry needed. | none |
| DI cycle | `ListingsModule → ShippingModule` is acyclic: no `libs/core/src/*/​*.module.ts` imports `ListingsModule`, and `ShippingModule` does not import it. | none |
| `check-service-interfaces` | All touched services keep their `implements I*Service`. | none |

## Open questions

- None blocking. The multi-shipment "any consumed ⇒ do not restore" reading is stated as an
  assumption in the plan and is the non-overselling direction.
