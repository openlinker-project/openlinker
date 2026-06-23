# Pre-Implement Readiness Gate — #994 Erli Order→IncomingOrder Mapper

**Date**: 2026-06-16
**Plan**: `docs/plans/implementation-plan-erli-order-mapper.md`
**Branch**: `994-erli-order-mapper` (stacked on `991-erli-offers-int-specs`, tip `e5f55309`)
**Gate type**: read-only readiness (no code, no plan edits)

## Verdict: ✅ READY

New Integration-layer mapper + wire types + spec only. No port, DTO, schema, or barrel export is modified, so the backward-compat surface is inert. All proposed files are NEW; every consumed seam exists and is exported from the `@openlinker/core/orders` barrel.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `libs/integrations/erli/src/infrastructure/adapters/erli-order.types.ts` | **NEW** | `ls` — absent |
| `.../erli-order.mapper.ts` | **NEW** | `ls` — absent |
| `.../__tests__/erli-order.mapper.spec.ts` | **NEW** | `ls` — absent |

## Seam-accuracy findings (confirmed against live code)

| Seam | Shape | Confirmed at |
|---|---|---|
| `IncomingOrder` | required `externalOrderId/status/items/totals/createdAt/updatedAt` + optionals | `incoming-order.types.ts:21` |
| `IncomingOrderItem.price` | **`number`** (not money object) → map `li.price.amount` | `incoming-order.types.ts:127` (review-confirmed) |
| `IncomingOrderTotals` | required `subtotal/tax/shipping/total/currency` | `incoming-order.types.ts:159` |
| `OrderStatusValues` | `pending/processing/shipped/delivered/cancelled/refunded` (no `paid`/`purchased`) | `order.types.ts:20` |
| `PaymentStatusValues` | `paid/cod/awaiting/refunded` | `payment-status.types.ts:23` |
| Barrel exports | `IncomingOrder`, `IncomingOrderItem`, `IncomingOrderItemRef`, `IncomingOrderTotals`, `IncomingOrderAddress`, `OrderStatus(Values)`, `PaymentStatus(Values)` | `orders/index.ts:46-66` |
| Reference mapper | standalone `PrestashopOrderMapper`; Allegro inline `getOrder` (output-shape twin) | `prestashop-order.mapper.ts`, `allegro-order-source.adapter.ts:242,273` |
| Identity boundary | "adapters MUST NOT emit internal OpenLinker IDs" | `incoming-order.types.ts:38-43,119-124` |

## Backward-compatibility findings

None. New files only; CORE untouched; no migration; no new port; no barrel change.

## Open questions (non-blocking, #992-provisional — flagged in plan §5)

- COD-vs-PayU discriminator field (assumed `paymentMethod` + `status:'purchased'`) — isolated in `derivePaymentStatus`.
- Erli order wire field names, money shape, line-item `productRef` type, totals decomposition, timestamp fields, externalOrderId key — all provisional with safe-default fallbacks mirroring Allegro; single reconciliation point `erli-order.types.ts`. Revisit on #992 sandbox.
- Stale `OrderSourcePort.getOrder` JSDoc (says "returns internal IDs") — superseded by the field-level rule; noted in the plan so #993/#994 reviewers don't "fix" the mapper to resolve ids.
