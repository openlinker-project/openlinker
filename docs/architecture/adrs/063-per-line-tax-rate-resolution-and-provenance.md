# ADR-063: Per-line tax-rate resolution, provenance and rounding ownership

- **Status**: Proposed
- **Date**: 2026-08-21
- **Authors**: @norbert-kulus-blockydevs

> **Numbering note.** #2246 named this ADR *050*. That number, and *051*, went to the #2162
> async-work-layer epic (#2167, #2168), and *052-062* to the OMS authority-model design; the
> [README index](./README.md) therefore places this one at **063**. The issue title is the stale half.

## Context

Every line of every invoice OpenLinker issues carries an **empty** tax rate. The order-to-command
mapper emits `taxRate: ''` for product lines and for shipping, because core has nothing to give:
neither `OrderItem` nor `IncomingOrderItem` has a tax field, and the only tax signals on an order are
one aggregate `OrderTotals.tax` and an order-wide `taxTreatment`. Neither can describe a mixed-rate
basket.

Each provider adapter then substitutes its own guess - inFakt and Subiekt hardcode 23%, KSeF falls
back to a per-connection `'23'`. Three consequences follow. A cross-border sale that should carry
`0% WDT`, `0% EX`, `np I`/`np II` or an OSS rate gets 23% instead, and the `FA3_TAX_RATE_MAP`
dictionary holding all ten `P_12` values is unreachable. A mixed-rate basket is mis-taxed
domestically. And a per-line rate that Erli already reports on every order item is discarded, because
nothing downstream can hold it.

Four constraints shape any answer.

**The masters differ in what they can answer.** PrestaShop already resolves product →
`id_tax_rules_group` → `tax_rules` → `taxes`, and already distinguishes `id_tax_rules_group = 0`
("No tax") from unknown. WooCommerce reads no tax at all today, and its `tax_class` is a *class name*,
not a rate - the rate table lives in shop settings, per country.

**The channels differ too.** Allegro carries a nullable `lineItems[].tax {rate, subject, exemption}`
and an `OfferTaxSettings.rates[]` write surface; OL reads neither and writes neither, so offers
published by OL report no rate at all (verified on the live sandbox, 20 Aug 2026: 24 lines across 11
offers all returned `tax: null`; after a `PATCH` setting `taxSettings.rates`, a new purchase returned
`tax: {"rate":"23.00"}`). Erli's `Order.items[].taxRate` is a **required** enum, and its
`buyableProblems` already carries `missingTaxRate` - Erli blocks a rate-less product itself.

**Removing the adapter defaults early breaks 100% of issuance.** KSeF throws
`UnmappedTaxRateException('')`, inFakt returns 422 (live-verified 2026-07-01), the Subiekt bridge
rejects with "StawkaVAT jest wymagana".

**Coverage today is zero** (measured 2026-08-21, recorded on #2256): no rate column exists on
`products`, no tax field exists on an order line, and 0 of 123 ingested order lines carry a rate.

## Decision

**The rate arrives from the ProductMaster with the product; the marketplace is a fallback when the
master does not know; and when neither knows, the document is held rather than guessed. OpenLinker
never computes a rate and never computes an amount excluding tax.**

Seven points, in the order a rate travels.

**1. Resolution chain.** Ask the shop (`ProductMaster`) first, the channel only when the shop does
not know. A fix applied in the shop then serves every channel at once. "The shop does not know"
covers two cases treated identically: the product is absent from the catalogue, or present with an
empty field.

**2. Three answer states.** A known rate, a known exemption code (`zw`, `np`, `oo`), and *no answer*.
Only *no answer* blocks. **`0` is an answer** - export, intra-EU, exempt goods - and PrestaShop
already distinguishes it from unknown, so collapsing the two would discard information the master
already gives us. A fourth state, *not yet checked*, is distinct from *the shop has no rate*: it
produces a **sync suggestion**, never a block. Without it, day one claims the entire catalogue is
incomplete and the pre-rollout count measures nothing.

**3. Representation.** A neutral **string code**, the same vocabulary `InvoiceLine.taxRate: string`
already carries: `23`, `8`, `5`, `0`, `zw`, `np`, `oo`. A number cannot express an exemption.
**Percent-as-string is the contract**: `'23'` means 23%, because `rateFraction` does
`Number.parseFloat(taxRate) / 100`, so `'0.23'` silently means 0.23%. A country code travels with the
rate as **provenance only** - it is never compared with the buyer's country and blocks nothing.

**4. Storage.** The rate is a **projection pulled at product-sync time** onto `products` /
`product_variants`, exactly as `price` and `currency` already are - not read live at issuance.
Issuance must not depend on the shop being reachable, and "which products lack a rate" must be a
query rather than a crawl. Product level with an **optional variant override** that wins only where
the shop carries one. **The stored order snapshot is the only place the rate is settled**; any
line-item table transcribes it and settles nothing. A parallel **append-only rate journal** - item,
channel, value, origin (shop / channel / written-by-us), timestamp, one row per *change* - replaces a
mutable source field, and is what makes "the shop changed it", "we wrote this to the offer" and
"somebody overwrote it afterwards" separable facts. There is **no freshness rule**; the read date is
shown instead, because rate changes are announced ahead and do not apply retroactively.

**5. Rounding ownership.** Core passes **gross plus a rate code** and computes no net amount and no
tax amount; it rounds nothing. The rounding rule is regime-specific and belongs in the provider
adapter. This makes the observed FA(3) discrepancy (line sum 162.00 against a rate basis of 161.79 on
100 x 1.99) an **adapter bug**, not a core one. A stored per-line net is therefore a **copy of what
the issued document says**, matched by line number, skipping shipping lines, always taken from the
latest effective document so a correction updates it. Core may **group and divide** amounts; it may
never compute tax - which is the boundary the shipping split sits inside. Shipping inherits the
basket's single rate, or is split proportionally by line gross across the rates present, remainder to
the largest part so the total is exact; a single unknown line rate makes the split uncomputable, so
shipping waits with the document.

**6. Gate semantics.** A **missing rate blocks the document** - a new `missing-tax-rate` member of
`SalesDocumentGateBlockReasonValues`, so the existing badge / timeline / filter / counter machinery
works unchanged. It is the **first reason that must also refuse the manual paths** (the invoice
panel's issue button, the receipt's register button, bulk issue): every existing reason means
"auto-issue did not happen", this one means "this cannot be issued". Fiscal receipts block too; the
per-connection tax letter stays but stops being the fallback. A **shop-versus-channel disagreement
does not block** - the shop wins, the document is issued, the mismatch is surfaced - and it is
therefore **not a `SalesDocumentGateBlockReason` at all**, but its own field on the order projection
with its own resolver.

**7. Non-goals.** No tax **calculation** in OpenLinker: no `TaxCalculationPort`, no engine
integration, no nexus logic. No OSS / distance-selling rules and no buyer-country rate selection -
the master read is deliberately not parameterised by delivery country in this pass, even though
PrestaShop's resolver can do it.

## Alternatives considered

**Compute the rate in OpenLinker from a rate table.** Rejected. It makes OL the tax authority for
every regime it ships into, and a wrong rate is a legal event for the seller rather than a bug. The
rate is an input; the systems that own the catalogue already hold it.

**Default to a per-connection rate when nothing is known** (today's behaviour, made explicit).
Rejected as the *steady state*. A silent 23% is indistinguishable from a confirmed 23% on the issued
document, and the whole cost of the error lands on the seller. Holding the document is visible, and
the remedy is one field in a system the operator already administers. #2053 keeps the fallbacks while
making them visible; this ADR is what lets them be removed.

**Read the rate live at issuance instead of projecting it at sync.** Rejected. It makes issuance
depend on the shop being reachable, turns "which products lack a rate" into an N-call crawl that
cannot back a pre-flight count, and gives the same order a different rate depending on when it was
issued.

**Treat a shop-versus-channel mismatch as a block.** Rejected on evidence, not taste
(#2245 F1). `invoicingBlockedBadge` returns `null` whenever an invoice plausibly exists, and a
non-blocking conflict always has one - so the badge would never render on the list or the timeline,
and the filter would count rows that explain nothing. `SalesDocumentAttentionReasonValues` is derived
by filtering out only `trigger-model-manual`, so a revived `tax-rate-conflict` would additionally be
double-counted inside `salesDocumentBlocked`.

**A numeric rate with a separate exemption flag.** Rejected. It splits one answer across two fields
that can disagree, and the existing `InvoiceLine.taxRate: string` vocabulary already carries both
without ambiguity.

**Store the rate as a mutable field with a `source` column.** Rejected in favour of the append-only
journal. A mutable field cannot answer *when* the shop changed the rate, or whether the value now on
the offer is the one OL wrote, which is exactly the attribution a mismatch investigation needs.

## Consequences

- **A held document is a new operator-facing state**, with an age rather than only a count. The
  hard-to-unblock class is real and named: a product existing only as a marketplace offer, bought
  after rollout, with no rate on the offer, **cannot** be released by fixing the offer, because the
  marketplace stamps the rate at purchase. The only remedy is adding it to the shop catalogue.
- **Held receipts mean late fiscal registration.** Accepted, and chosen over a receipt carrying an
  unconfirmed rate letter. Reversible in one place.
- **Rollout order is load-bearing, and it is enforced by a switch rather than by sequencing alone.**
  The notation fix lands first and alone; the adapter defaults come out last, and only once catalogue
  coverage is non-trivial. With coverage at zero (see Context), an early removal reads as an outage
  rather than a diagnosis. Because the whole epic ships as one branch, "last" cannot be a merge order,
  so every refusal this ADR describes sits behind a single environment switch,
  `OL_TAX_RATE_STRICT_ENABLED`, **off by default**: with it off each provider substitutes its
  documented default, both issuance gates and the fiscal-registration gate pass, and the marketplace
  publishes omit the rate exactly as before. An operator takes the coverage count
  ([docs/operations/tax-rate-coverage.md](../../operations/tax-rate-coverage.md)) and turns it on when
  the answer says so.
- **Two publish refusals are deliberately NOT switched**, and the cost of that is accepted rather than
  overlooked. An exemption code the channel cannot express, and a rate the target category rejects,
  both mean the shop DID state a rate the channel cannot carry - a conflict at any coverage level, not
  a coverage problem, so there is nothing for the coverage switch to gate. Their blast radius is the
  same one that justified gating the third refusal: they become reachable the moment a product sync
  fills the rate column (the step the rollout runbook prescribes *before* the switch is touched), and
  on a bulk publish a catalogue-wide misconfiguration - exempt goods carried as `zw`, a whole category
  published at the wrong rate - fails every affected child, on a surface with no badge, no counter and
  no held state, with no way to switch it off. Accepted anyway: a published offer that states the
  wrong tax charges real buyers wrongly and cannot be un-charged, whereas a failed batch is visible
  and the error names the offending rate and, for the category refusal, the rates the category allows.
  A switch here would let an operator trade a visible failure for a silent wrong tax, which is the one
  trade this epic exists to remove. Surfacing both in the bulk wizard's pre-submit validation
  (#2243/#2244) so the operator sees them before submitting is the follow-up; the runbook
  ([docs/operations/tax-rate-coverage.md](../../operations/tax-rate-coverage.md) § What can still fail
  with the switch off) states them meanwhile.
- **Pre-rollout orders are marked historical** and issue exactly as they do today, so that a later
  net-revenue figure can exclude them rather than present a defaulted rate as a confirmed one - no
  such figure reads the marker yet. The marker is read where it matters: every refusal that can see an
  order exempts a pre-rollout one even with the switch on - the auto-issue invoice gate, the
  auto-issue receipt gate, the invoice issuance write path, the fiscal-registration write path and the
  Subiekt line mapper - so enabling enforcement cannot strand the back catalogue.
- **Erli gains a real read and a real write**; Allegro gains a propagation write. A category refusing
  the rate fails the publish with an actionable error naming the allowed values - never a publish with
  the rate silently omitted. A frozen field is neither written nor reported as a recurring error, and
  `frozen.taxRate === true` is the signal that a human corrected it.
- **`documentContent` stays non-authoritative.** Copying a per-line net back requires adapters to
  return provider-computed amounts; for KSeF there is nothing external to copy, because OL builds the
  XML and the adapter *is* the calculator.

## Amendment (#2456, 2026-08-25): query-time opt-in for backfilled pre-rollout tax rates in Net Sales

Line 176-181 above predicted a future net-revenue figure would read the `taxRateEra` marker; #2014 built
exactly that figure (`netSalesOrderNetEligibleSql` / `netSalesLineNetEligibleConditionSql`,
`libs/core/src/orders/domain/types/net-sales-tax-rate.types.ts`), and its literal SQL condition,
`rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'`, permanently excludes a pre-rollout order from Net
Sales — even after `TaxRateBackfillService` has independently resolved a real, current-catalogue rate
for it. That gap is by design (a backfilled rate is "today's" rate, not the rate confirmed at order
time, and this ADR's Decision treats that distinction as load-bearing), but it left operators with no
remediation path short of a raw SQL write against `taxRateEra` — exactly the "defaulted rate presented
as confirmed" outcome this ADR exists to prevent.

**Decision**: add a single operator setting, `includeGuessedVatRatesInNetSales: boolean` (final
country-agnostic name TBD at implementation — e.g. `includeBackfilledTaxRatesInNetSales`), default
**OFF**. When OFF, behaviour is unchanged from today. When ON, `netSalesOrderNetEligibleSql` /
`netSalesLineNetEligibleConditionSql` additionally admit a `taxRateEra = 'pre-rollout'` row **only when
a backfilled rate actually resolves for it** — a pre-rollout order with no resolvable rate at all stays
excluded regardless of the setting. The setting is read once per query, at the SQL-builder call site.
**It never writes `taxRateEra`, or any other column, on any `order_records` row, in either direction** —
turning it off instantly and completely reverts the excluded population, because nothing was ever
overwritten. This is additive to the ADR's Decision, not a reversal: the default-excluded behaviour is
unchanged, and the marker's meaning ("this order predates per-line tax rates") is untouched — only the
Net Sales query's tolerance for a *resolvable* pre-rollout row becomes operator-configurable.

The setting's persistence and UI live in the sibling analytics epic (#2452), not here; this amendment
records only the tax-rate-resolution-side contract the setting must honour.

## Relationship to ADR-014 and ADR-026

[ADR-014](./014-source-authoritative-order-pricing.md) rejected a per-line tax rate on `OrderItem`.
Its § *Proposed amendment (#2054)* reverses the **tax-rate half** of that rejection and is **adopted
by this ADR**; the tax-*inclusivity* half stands, and ADR-014 Decision 3 (PrestaShop remains the tax
and rounding authority on the order-*creation* path) is untouched. That amendment named two edits it
owed - dropping its own "proposal, not a recorded refinement" preamble and resolving ADR-014's
`Proposed`-while-its-decisions-shipped status - and this ADR's PR makes both.

[ADR-026](./026-country-agnostic-invoicing-domain.md) § the VAT-rate annex (owned by #2009) states the
rule that a rate is an **input, never a computation**. That sentence lives there and is referenced,
not restated, here; this ADR owns the *mechanism* - chain, provenance, storage, rounding ownership,
gate - and ADR-026 owns the *principle*.

## Related

- Epic #2245 and its thirteen children; the origin is closed #1290, which fixed the KSeF symptom and
  named this follow-up.
- #2053 must land before any adapter default is removed; #2052 (PrestaShop resolver unknown
  semantics) is a useful precursor; #2057 is the unknown-versus-resolved-zero prerequisite named by
  the existing `tax-rate-conflict` comment.
- Primary doc sections: [docs/architecture-overview.md](../../architecture-overview.md) § Listings and
  § Invoicing.
