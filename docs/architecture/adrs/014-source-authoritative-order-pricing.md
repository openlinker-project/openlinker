# ADR-014: Source-authoritative order pricing

- **Status**: Proposed
- **Date**: 2026-05-30
- **Authors**: @piotrswierzy

## Context

When a marketplace order (Allegro) is created into a destination shop (PrestaShop), the
destination order must reflect the **buyer-paid source price**, not the destination's own catalog
price. Today PrestaShop orders land in `Payment error` (issue #895, repro order #6 `RPRRSFSUW`):
the `order_detail` lines are priced from the PS catalog while only `total_paid` carries the
marketplace amount, so PS flags "X paid instead of Y". Root cause: the PS adapter creates the
order from a cart (`id_cart`), and PS prices `order_detail` from the cart's catalog price,
ignoring the `order_rows[].product_price` we send.

The order-creation contract (`OrderProcessorManagerPort.createOrder`, `OrderCreate`/`OrderTotals`)
carries a bare `price: number` with no tax semantics — it under-specifies money. WooCommerce
(#877) and Shopify are future destinations, so the contract must stay platform-neutral.

## Decision

Model source-authoritative pricing as a **core invariant**, implemented natively per integration:

1. **Invariant, not capability.** `createOrder` MUST price lines at `OrderCreate.items[].price`
   and MUST NOT substitute the destination catalog price; a destination that cannot must fail
   loudly. This is a behavioural constraint on an existing method, not an opt-in sub-capability.
2. **Neutral tax semantics in core.** Add `taxTreatment?: 'inclusive' | 'exclusive'` (order-level)
   and make `tax?: number` optional on `OrderTotals` — two orthogonal axes (gross/net vs.
   amount-known/unknown). The destination's tax **rate** stays destination-side (bounded context).
3. **PrestaShop implements via native cart-scoped `specific_price`** (tax-excluded), created before
   `POST /orders`; gross→net inversion uses PS's own rate for the order's **delivery country**.
4. **Rounding** anchors on the buyer-paid total via a neutral largest-remainder penny-allocation
   helper (`@openlinker/shared/money`, minor units); PS stays the tax/rounding authority.
5. Override rows have a **saga lifecycle** (create → order → delete, compensate on failure,
   self-healing reconciliation for crashes, short `to`-expiry as fail-safe).

## Alternatives considered

- **Opt-in `is…` capability** for price-pinning. Rejected: pinning is universal (every real
  destination supports it) and mis-pricing money is a correctness bug, not a degraded-but-OK
  outcome — capability-absence would license silent catalog fallback (the bug itself).
- **Extend the OL PrestaShop module sidecar** (like shipping). Rejected: it bypasses PS's tax
  engine, making OpenLinker a second, drift-prone tax authority and producing fiscally-wrong VAT
  on invoices. The shipping sidecar was a workaround for a *missing* native PS mechanism; line
  pricing has a native one (`specific_price`).
- **Per-line tax-inclusivity / tax rate on `OrderItem`.** Rejected: tax inclusivity is
  source-uniform; tax rate is destination-catalog knowledge that must not leak into the source
  order model.
- **Mirror PS's rounding engine in the adapter.** Rejected: re-implements platform-internal
  accounting; couples to PS internals and drifts across versions.

## Consequences

**Pros:**
- Orders are fiscally correct (PS-native VAT decomposition, invoices, accounting).
- Contract is platform-neutral; WC/Shopify implement the same invariant natively.
- Tax-rate and rounding authority stay in the destination system of record.

**Cons / trade-offs:**
- PS adapter must resolve per-country tax rates and manage `specific_price` lifecycle.
- `tax?: number` becoming optional ripples to all `OrderTotals.tax` consumers (compiler-guided).
- Float `number` money representation remains; a `Money` value object is the deferred end-state.

**Migration path:**
- No DB migration — `order_records.totals` is `jsonb`; new fields are optional/back-compatible.

## References

- Related issues: #895; future consumers #877 (WooCommerce `OrderProcessorManager`)
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (capability vs.
  invariant distinction), [ADR-012](./012-branch-1-fulfillment-modeling.md) (order destination
  modeling)
- Plan: [implementation-plan-source-authoritative-order-pricing.md](../../plans/implementation-plan-source-authoritative-order-pricing.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Orders
