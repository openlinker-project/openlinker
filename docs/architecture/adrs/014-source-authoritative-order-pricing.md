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
  order model. **The tax-rate half of this rejection is proposed for reversal - see
  § Proposed amendment (#2054) below. The tax-inclusivity half stands.**
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

- Related issues: #895; future consumers #877 (WooCommerce `OrderProcessorManager`); #2054
  (per-line tax rate - the amendment below), #1290 (the KSeF symptom that named the follow-up),
  #2053 (make the adapter substitutions visible), #2009 (owns the rate-rule annex on ADR-026)
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (capability vs.
  invariant distinction), [ADR-012](./012-branch-1-fulfillment-modeling.md) (order destination
  modeling), [ADR-026](./026-country-agnostic-invoicing-domain.md) (the invoicing contract that
  already models a neutral per-line rate)
- Plan: [implementation-plan-source-authoritative-order-pricing.md](../../plans/implementation-plan-source-authoritative-order-pricing.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Orders

## Proposed amendment (#2054, 2026-08-13): reverse the per-line tax-rate rejection

> **This is a proposal, not a recorded refinement - it needs an explicit accept.** The two amendment
> precedents in this repo ([ADR-009](./009-persisted-offer-status-snapshots.md),
> [ADR-026](./026-country-agnostic-invoicing-domain.md)) fill in detail the original decision
> deferred; ADR-026's note even opens with "they do not change the decision". This one *does* change
> one, so it is written as an argument to be accepted, amended or refuted at review - not as settled
> record. The body above is untouched, per the append-only rule in [README](./README.md). A reviewer
> who holds that a reversal must not live inside the ADR it reverses should say so: the alternative
> is a standalone superseding ADR, and this section becomes its Context.

**Scope.** Exactly one entry under § Alternatives considered changes: the **tax-rate** half of
"Per-line tax-inclusivity / tax rate on `OrderItem`". Everything else stands.

- **Decision 1 is the foundation this builds on, not its opponent.** A per-line rate describes how the
  buyer-paid amount *decomposes*; it never re-prices a line. Source-authoritative pricing is what
  makes the decomposition meaningful in the first place.
- **The tax-*inclusivity* half of the rejection also stands.** Inclusivity really is source-uniform,
  and order-level `taxTreatment` (Decision 2) remains the right shape for it.
- **Decision 3 is untouched.** On the order-creation path PrestaShop remains the tax and rounding
  authority; OL does not start pinning rates into a destination that owns them.

**The argument.**

1. **ADR-014 reasoned about one path: creating an order into a destination shop.** There the
   destination *is* the tax authority, and the ADR is right that OL must not become a second one -
   its rejected-sidecar alternative says exactly that ("making OpenLinker a second, drift-prone tax
   authority and producing fiscally-wrong VAT on invoices").
2. **The invoice-only path has no destination shop.** A marketplace order invoiced through a provider
   (KSeF, inFakt, Subiekt) has no destination catalog to hold the rate. So the rate is not held
   destination-side - it is held **nowhere**, and three adapters each substitute a guess. On this path
   ADR-014 achieves its own goal in reverse: it set out to prevent fiscally-wrong VAT on invoices, and
   it is what produces it.
3. **This moves a boundary the ADR already drew; it does not breach a principle.** Decision 2 already
   admitted neutral tax semantics into core, and [ADR-026](./026-country-agnostic-invoicing-domain.md)
   Decision 1 already blesses "a neutral `taxRate`/`taxCode` string per line" on the invoicing
   contract. The order model is the one link in that chain with nowhere to put the value.
4. **The rate is a function of `(product, delivery country)`, and the master already models it that
   way** - `PrestashopTaxRateResolver` resolves per delivery country and state today. The reversal
   does not make OL a tax authority; it makes the master's existing answer reachable from the
   invoicing path.

**The rule adopted with it.** The rate arrives from the `ProductMaster` together with the product and
OpenLinker never computes it; it is a **code, not a number** (`0`, `zw`, reverse charge and intra-EU
0% are four different things on a document and all look like zero); a missing rate **blocks** issuance
with an operator-facing reason instead of degrading to a default; a channel-reported rate is a
**cross-check, not an authority**. A tax engine (Avalara/TaxJar/Vertex) is an integration inside the
master or the channel, never a port here - the drafted `TaxCalculationPort` was withdrawn in full for
that reason, and tax *calculation* in OpenLinker stays out of scope. The normative statement of the
rule is owned by the ADR-026 rate annex (#2009); it is deliberately not restated here, so the two
documents cannot drift.

**Evidence** (verified against `30cb47992`):

- **Nowhere to carry it.** `OrderItem` (`order.types.ts:235-255`) and `IncomingOrderItem`
  (`incoming-order.types.ts:131-164`) carry no tax field. The only tax signals are the order-level
  aggregate `OrderTotals.tax` (`order.types.ts:269`) and `taxTreatment` (`:283`), neither of which can
  describe a mixed-rate basket. The doc at `:274-281` restates this rejection in the code ("the tax
  *rate* itself stays destination-side, never on the order contract"), as does the invoicing mapper at
  `order-to-issue-invoice-command.mapper.ts:206-217` / `:232-240`; both are downstream sites the
  reversal has to update. (Aside, outside this reversal: `tax: number` is still required, so the
  "make `tax?: number` optional" half of Decision 2 never actually shipped.)
- **So core emits nothing and adapters guess.** `toInvoiceLine` (`:228`) and `toShippingLine` (`:249`)
  emit `taxRate: ''`. inFakt substitutes `'23'` / `0.23`
  (`infakt-invoicing.adapter.ts:203-204`, applied `:228`, `:241`) - its comment at `:194-202` records
  that an empty rate 422'd every line of every invoice live on 2026-07-01, i.e. the substitution is
  load-bearing and cannot simply be deleted (#2053). Subiekt substitutes `'23'`
  (`subiekt-line.mapper.ts:26`, used `:33`). KSeF falls back to a per-connection `defaultTaxRate`
  (`ksef-connection.types.ts:56` → `ksef-adapter.factory.ts:157` → `fa3-builder-input.mapper.ts:138`)
  and then to `DEFAULT_FA3_TAX_RATE = '23'` (`fa3-tax-rate.mapper.ts:27`).
- **The destination vocabulary already exists and is unreachable.** `InvoiceLine.taxRate` is already a
  `string` code (`invoicing.types.ts:280`), and `FA3_TAX_RATE_MAP`
  (`fa3-tax-rate.mapper.ts:34-50`) maps 12 keys onto all 10 FA(3) `P_12` values - including `0-wdt`,
  `0-ex`, `np-i`, `np-ii`, `oo` - so cross-border cases are expressible today and simply never reached.
  Erli already reports a per-line rate (`erli-order.types.ts:79`) which its mapper drops
  (`erli-order.mapper.ts:156-165`); Allegro reports gross only (`tax: 0` at
  `allegro-order-source.adapter.ts:404`, `taxTreatment: 'inclusive'` at `:412`), which is why the master
  and not the channel must be the source.

**Status.** ADR-014's status line is deliberately **unchanged**. The taxonomy in
[README](./README.md) has no per-alternative value, and `Superseded by ADR-NNN` would announce a
whole-ADR replacement that is not happening. The bidirectional link is instead the forward pointer on
the rejected bullet plus this section naming what it reverses. Note ADR-014 has stood at **Proposed**
since it was written, although its decisions shipped - that is a separate bookkeeping gap this
amendment does not silently close.
