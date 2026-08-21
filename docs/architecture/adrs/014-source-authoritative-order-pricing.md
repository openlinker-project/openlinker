# ADR-014: Source-authoritative order pricing

- **Status**: Accepted
- **Date**: 2026-05-30 (accepted 2026-08-21; see § Amendment)
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
   **Amended by #2054** — the rate clause is proposed for reversal on the *invoice-only* path;
   on the order-creation path this decision is unchanged. See § Proposed amendment below.
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
- **Amended by #2054** (proposed): the per-line rate is likewise jsonb-carried, so still no
  migration - but every order persisted before it exists carries no rate. The field must therefore
  be optional on read, and a blocking issuance gate would fire on the entire historical backlog
  from day one. That backfill-versus-gate question is #2054's, not this ADR's.

## References

- Related issues: #895; future consumers #877 (WooCommerce `OrderProcessorManager`); #2054
  (per-line tax rate - the amendment below), #1290 (the KSeF symptom that named the follow-up),
  #2053 (make the adapter substitutions visible), #2057 (split unknown from resolved-zero in
  `PrestashopTaxRateResolver` - the prerequisite this amendment named for any master rate read;
  merged 2026-08-14), #2009 / PR #2056 (own the normative rate-rule annex on ADR-026)
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (capability vs.
  invariant distinction), [ADR-012](./012-branch-1-fulfillment-modeling.md) (order destination
  modeling), [ADR-026](./026-country-agnostic-invoicing-domain.md) (the invoicing contract that
  already models a neutral per-line rate)
- Plan: [implementation-plan-source-authoritative-order-pricing.md](../../plans/implementation-plan-source-authoritative-order-pricing.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Orders

## Amendment (#2054, 2026-08-13; accepted 2026-08-21): reverse the per-line tax-rate rejection

> **Accepted 2026-08-21 by [ADR-052](./052-per-line-tax-rate-resolution-and-provenance.md).** Recorded in
> place following this repo's convention for a partial change: six amendment sections exist across four
> ADRs ([009](./009-persisted-offer-status-snapshots.md) x3 - #1760, #2024, #2039 -
> [026](./026-country-agnostic-invoicing-domain.md),
> [030](./030-infakt-ksef-indirection.md), [037](./037-destination-taxonomy-read-model.md)), and
> ADR-037 additionally reverses a recorded decision detail *in place* (`**Corrected by #2063**`), as
> ADR-031 does with an inline `**Correction**`. The prose above is not rewritten - the two sentences it
> contradicts carry inline forward pointers (Decision 2 and the rejected bullet under § Alternatives
> considered) and nothing else in the body is touched.

**Scope.** Exactly one entry under § Alternatives considered changes: the **tax-rate** half of
"Per-line tax-inclusivity / tax rate on `OrderItem`". Everything else stands.

- **Decision 1 is the foundation this builds on, not its opponent.** A per-line rate describes how the
  buyer-paid amount *decomposes*; it never re-prices a line.
- **The tax-*inclusivity* half of the rejection also stands.** Inclusivity really is source-uniform,
  and order-level `taxTreatment` (Decision 2) remains the right shape for it.
- **Decision 3 is untouched, and the amendment binds itself to keep it so.** On the order-creation
  path PrestaShop remains the tax and rounding authority: `pinLinePrices`
  (`prestashop-order-processor-manager.adapter.ts:621`) MUST continue to resolve the rate
  destination-side and MUST ignore any `OrderItem`-carried rate. Without that clause an order both
  created into a shop *and* invoiced through a provider would carry two rates that can disagree -
  the "second, drift-prone tax authority" this ADR rejects, arriving through the back door.
- **The rule is scoped to the invoice-only path**, i.e. a sales document issued for an order that was
  not created into a rate-holding destination. A blocking "missing rate" gate must not fire on an
  order whose destination shop already holds the rate. The master-versus-destination conflict axis is
  named here and owned by #2054; only master-versus-channel is treated below.

**The argument.**

1. **ADR-014 could not have reasoned about this path: it did not exist yet.** ADR-014 is dated
   2026-05-30, [ADR-026](./026-country-agnostic-invoicing-domain.md) (the invoicing domain)
   2026-06-16. The rejection was written about creating an order into a destination shop, where the
   destination *is* the tax authority - and it is right about that path.
2. **On the invoice-only path the rate is unreachable, and the ADR's own stated goal inverts.** A
   marketplace order invoiced through a provider (KSeF, inFakt, Subiekt) has no destination shop
   holding a rate, so nothing on the path can supply one and three adapters each substitute a guess.
   The rejected-sidecar alternative above warns against "producing fiscally-wrong VAT on invoices";
   on this path ADR-014 is what produces it. Note the defect is **reachability**, not absence - the
   master does hold a rate (see 4) - which is why the alternatives below are weighed rather than
   waved past.
3. **This moves a boundary the ADR already drew; it does not breach a principle.** Decision 2 already
   admitted neutral tax semantics into core, and ADR-026 Decision 1 already blesses a neutral
   per-line `taxRate` string on the invoicing contract. The order model is the one link in that chain
   with nowhere to put the value.
4. **A rate snapshotted at ingestion is a fiscal fact about the sale; a rate read at issuance is
   today's answer to a different question.** This is the argument that selects the order contract
   over an issuance-time read: it freezes the rate the way Decision 1 already freezes the price, and
   an issuance-time read can return a changed rate, or none at all if the variant has since gone
   `isStale`. It is also what makes per-line net/gross reportable per order (#2054 step 4).

**Alternatives considered for making the rate reachable** (the reversal has to beat these, not merely
name the gap):

- **Resolve at issuance inside the invoicing context.** `InvoiceService` already injects
  `IIntegrationsService` (`invoice.service.ts:210-212`), and `toInvoiceLine`
  (`order-to-issue-invoice-command.mapper.ts:218-230`) receives a full `OrderItem` carrying
  `productId` / `variantId` and discards them on the same line that emits `taxRate: ''`. The join key
  for a master read is already in local scope. Cheapest of the four and needs no order-contract
  change. Rejected as the *primary* answer for argument 4 (point-in-time fidelity) - but it is a
  legitimate fallback for historical orders that carry no snapshotted rate, and #2054 should treat it
  as one.
- **Per-connection config**, already shipped for KSeF (`ksef-connection.types.ts:56` →
  `ksef-adapter.factory.ts:157`, with shape validation and a warn log). Zero contract change.
  Rejected as the general answer: one flat rate per connection cannot describe a mixed-rate basket.
  It has no FE surface today, which is a shippable partial mitigation on its own and is worth doing
  regardless of this reversal.
- **A `mappings`-context rule table**, alongside the operator-authored per-connection tables that
  already exist. Rejected: it makes the operator restate what the master already knows, and drifts
  from it silently.
- **A `TaxCalculationPort`** (an engine-facing port for Avalara / TaxJar / Vertex). Drafted and
  **withdrawn in full** during the #2009 discussion as overengineering; a tax engine is an
  integration inside the master or the channel, and tax *calculation* in OpenLinker stays out of
  scope.

**Cost of the chosen route, stated plainly.** It is the widest blast radius of the four: `OrderItem`
+ `IncomingOrderItem` + every `OrderSourcePort` adapter + the snapshot writer + the read-back
narrowing + `InvoiceLine` + the job payload. With no backfill the field stays optional, so the
adapter defaults remain in the code path for historical orders regardless.

**The rule adopted with it** is stated normatively by the ADR-026 rate annex (#2009 / PR #2056) and
is deliberately **not** restated here, so the two documents cannot drift. Read that annex for the
rule; read this section only for what it reverses, why, and under which constraint (below - the one
thing this section does bind, because it is the condition of the reversal rather than a detail of the
rule). Merge order: if this section lands first,
the pointer is forward-looking until #2056 merges - it is not a claim that the annex is already in
force, and neither document is normative until both are accepted.

**Known limitations of the single-string shape** (inherited from ADR-026 Decision 1, recorded here
because this is the document arguing the value must travel):

- EN 16931 models line tax as a triple - category code (UNCL 5305), rate, and an exemption reason
  that is mandatory for the exempt / reverse-charge / zero-rated categories. One opaque string cannot
  separate a domestic 19% from a 19% under OSS, nor carry the exemption-reason mention such an
  invoice must print. `InvoiceLine.taxRate` already anchors on UNCL 5305 conceptually
  (`invoicing.types.ts:274`), so the extension point exists; nothing needs it yet.
- **The master is the default source, not the only possible authority.** Under EU Art 14a
  deemed-supplier rules (and IOSS) the marketplace is the deemed supplier and the seller's leg is
  exempt or zero-rated - there the master's domestic retail rate is exactly wrong and the channel is
  authoritative. Out of scope for #2054; a channel-reported rate is treated as a cross-check today.
  (That Allegro reports gross only shows the channel is not always *available*, not that it is never
  authoritative.)

**The vocabulary constraint is part of what is being accepted, not deferred to implementation.**
Accepting "a per-line rate travels on `OrderItem`" without it would license importing a jurisdiction's
model into the neutral orders contract, and implementation is exactly where the FA(3) keys are nearest
to hand. So the reversal is conditioned on this rule, in the same words ADR-026 Decision 1 already uses
one layer in:

> A core `OrderItem` / `IncomingOrderItem` tax rate MUST be a **neutral string code that maps
> losslessly onto UNCL 5305 inside the adapter** - the rule `InvoiceLine.taxRate` already lives under
> (`invoicing.types.ts:272-274`, restating ADR-026 Decision 1: PL `zw`/`np` → `E`/`O`). Neutral
> outward, national inward. A regime vocabulary MUST NOT be adopted verbatim: `FA3_TAX_RATE_MAP`'s
> keys are KSeF-shaped and are **not** admissible as the core field's value set, because that would
> land a Polish regime model one layer further out than ADR-026 permits it on the invoicing contract.

Two corollaries follow from the same rule. The field is a **string, never a `number` fraction**, so an
unresolved rate is *absent* rather than a `0` that reads as a lawful exemption - the conflation
`PrestashopTaxRateResolver` carried until **#2057** (merged 2026-08-14) split the two apart. And naming
the concrete admissible value set belongs to the ADR-026 rate annex (#2009 / PR #2056), not here; this
section fixes the constraint the set must satisfy, the annex fixes the set.

**Evidence** (verified against `dec889afb`):

- **Nowhere to carry it.** `OrderItem` (`order.types.ts:235-255`) and `IncomingOrderItem`
  (`incoming-order.types.ts:131-164`) carry no tax field; the only tax signals are the order-level
  `OrderTotals.tax` (`:269`) and `taxTreatment` (`:283`), neither of which can describe a mixed-rate
  basket. (`tax` is still a required `number` - the "make `tax?` optional" half of Decision 2 was
  deliberately deferred, with rationale in the linked plan (`:34`, `:86-89`). Not this reversal's
  concern: argument 3 rests on `taxTreatment`, which did ship.)
- **So core emits nothing and adapters guess.** `toInvoiceLine` (`:228`) and `toShippingLine`
  (`:249`) emit `taxRate: ''`. inFakt substitutes `'23'` / `0.23`
  (`infakt-invoicing.adapter.ts:203-204`, applied `:228`, `:241`); its comment at `:194-202` records
  that an empty rate 422'd every line of every invoice live on 2026-07-01, so the substitution is
  load-bearing and cannot simply be deleted (#2053). Subiekt substitutes `'23'`
  (`subiekt-line.mapper.ts:26`, used `:33`). KSeF falls back to a per-connection `defaultTaxRate`
  and then to `DEFAULT_FA3_TAX_RATE = '23'` (`fa3-tax-rate.mapper.ts:27`).
- **The destination vocabulary already exists and is unreachable per line.** `InvoiceLine.taxRate` is
  already a `string` code (`invoicing.types.ts:280`) and `FA3_TAX_RATE_MAP`
  (`fa3-tax-rate.mapper.ts:34-50`) maps 12 keys onto all 10 FA(3) `P_12` values. A connection-level
  `defaultTaxRate` does reach them (`fa3-builder-input.mapper.ts:138` resolves
  `line.taxRate || context.defaultTaxRate`), flat for the whole connection; no *per-line* value can.
  Erli already reports a per-line rate
  (`erli-order.types.ts:79`) which its mapper drops (`erli-order.mapper.ts:156-165`); Allegro reports
  gross only (`allegro-order-source.adapter.ts:404`, `:412`).
- **Downstream comment sites assert the rejected rule** and would have to change with it
  (`order.types.ts:281`, `order-to-issue-invoice-command.mapper.ts:94` / `:206-217` / `:232-240`,
  `infakt-invoicing.adapter.ts:197`, `subiekt-line.mapper.ts:13`, `ksef-connection.types.ts:52`,
  `fa3-builder-input.mapper.ts:112`, `prestashop-tax-rate.resolver.ts:10-11`, plus the linked plan at
  `:24` / `:86-87`). Two of them - `ksef-connection.types.ts:52` and
  `fa3-builder-input.mapper.ts:112` - attribute the rule to **ADR-026**, so they become
  misattributions the moment the #2009 annex says otherwise.
- **What the master actually resolves today.** `PrestashopTaxRateResolver` resolves a rate per
  `(product, delivery country)` - not per state: `selectRule` (`:129-144`) deliberately *de-prefers*
  state rows so a multi-state group does not yield an arbitrary rate. It is constructed at
  `prestashop-adapter.factory.ts:166` and injected only into `PrestashopOrderProcessorManagerAdapter`
  (`:193`); `PrestashopProductMasterAdapter` never receives it and `ProductMasterPort` exposes no
  rate. So this is **destination / `OrderProcessorManager` knowledge today** - the resolver's own
  header says exactly that - and exposing it as a master read is a new port method, not a rewiring of
  an existing one. It would additionally need code semantics and honest unknown semantics - and that
  half is **no longer outstanding**: at `dec889afb` the resolver returned a `number` fraction in which
  `0` meant both untaxed and unresolvable (the conflation the adopted rule forbids), and **#2057
  (merged 2026-08-14, on this branch as of `a474145c8`)** replaced it with
  `{ kind: 'resolved', rate } | { kind: 'unknown', reason: 'transport' | 'configuration', … }`, never
  caching an unknown. So the prerequisite this section named is satisfied; what remains for a master
  read is the new port method, not the semantics. WooCommerce's `ProductMaster` reads no tax at all,
  and its `tax_class` is a class name rather than a rate, so a second master would have to be built
  rather than exposed.

**On the status line.** This ADR is now **Accepted**, which is what the amendment below asked for. Its
`Status` is deliberately *not* `Superseded by ADR-052`: the [README](./README.md) taxonomy has no
per-alternative value, and supersession would announce a whole-ADR replacement that is not happening -
[ADR-052](./052-per-line-tax-rate-resolution-and-provenance.md) adopts one reversed alternative and
leaves Decisions 1-3 standing. The bidirectional link is the two inline pointers plus this section
naming what it reverses.

**The location question is settled (review on PR #2058): the section stays here.** A standalone
superseding ADR was offered as an alternative for a reviewer holding that a reversal must not live
inside the ADR it reverses; it was declined, because the README ladder describes whole-ADR replacement
and a new ADR would additionally need a number from a pool with three live claimants. Note also that
the append-only rule this design defers to (`README.md:40`) binds an **accepted** ADR, and ADR-014 was
`Proposed` when the edit was made - so the in-place edit is not even the case that rule governs.

**Both edits this amendment owed are now made** (in the #2246 / [ADR-052](./052-per-line-tax-rate-resolution-and-provenance.md)
change): the "proposal, not a recorded refinement" preamble is gone, and ADR-014's own
`Proposed`-while-its-decisions-shipped status is resolved to **Accepted**. Doing only the first would
have cleared this proposal by leaving a second bookkeeping gap behind.
