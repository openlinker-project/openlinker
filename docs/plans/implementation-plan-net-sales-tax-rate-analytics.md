# Implementation Plan: Net Sales (VAT-exclusive) Analytics

**Date**: 2026-08-24
**Status**: Draft
**Estimated Effort**: 2–3 days

---

## 1. Task Summary

**Objective**: Wire the per-line `order_line_items.taxRate` (shipped by the tax-rate epic, ADR-063) into the existing analytics aggregation pipelines so `GET /analytics/sales` (#1987) and `GET /analytics/top-products` (#1988) can report a **net-of-VAT** figure alongside the existing gross (GMV) figures, additively and without disturbing any existing gross field.

**Context**: `docs/specs/metrics-analytics-dashboard.md` defines Net Sales / Net Order Value (NOV) / AOV / Median Order Value as VAT-exclusive, distinct from GMV (gross, incl. VAT, never converted). Today neither `getSalesAndChannelAnalytics` nor the top-products read touches `taxRate` at all — both are gross-only, and `order-sales-aggregation.ts` carries an explicit comment: *"Gross/net tax-treatment normalization remains a separate, not-yet-scoped effort."* The FE (`analytics-kpi-strip.tsx`) already renders a "Net sales" KPI slot but gates it behind a single `NET_SALES_GAP` caveat that currently blames only the (separate, out-of-scope) returns/refunds gap.

This plan closes the **tax-rate half** of that gap only. Returns/refunds remain unmodeled and out of scope — a Net Sales figure produced by this plan is still not the spec's fully-netted figure; the FE must say so.

**Classification**: CORE (`libs/core/src/orders`, cross-referencing `libs/core/src/sales-documents`) + Interface (`apps/api/src/analytics`) + Frontend (`apps/web/src/features/analytics`).

---

## 2. Scope & Non-Goals

### In Scope
- A pure, orders-context-local helper that reads one `order_line_items.taxRate` value and resolves it to either a known VAT fraction or "unknown" (never throws, never silently defaults to 0% for an unrecognized code).
- Wiring that resolution into the SQL of both existing aggregation paths:
  - `OrderRecordRepositoryPort.getDailyOrderAggregates` / `getMedianOrderValue` (#1987, sales & channel headline+per-channel).
  - `OrderLineItemRepositoryPort.getTopProductRanking` / `getProductChannelBreakdown` (#1988, top products).
- New, additive fields on both pure assemblers (`order-sales-aggregation.ts`, `top-products-aggregation.ts`) and both response DTOs (`sales-analytics-response.dto.ts`, `top-products-response.dto.ts`): net revenue/AOV/median (sales) and net revenue (top products), each paired with an explicit excluded-count/excluded-value disclosure, mirroring the existing `unconvertedCount`/`unconvertedValue`/`unconvertedCurrency` pattern.
- Honoring `order_records.taxRateEra = 'pre-rollout'` and the `OL_TAX_RATE_STRICT_ENABLED` switch semantics via the existing `sales-documents` helpers (`isPreRolloutOrder`, `isTaxRateEnforced`) — reused, not re-implemented.
- FE updates: fix the two mislabeled gross-as-"Net sales" columns (`channel-sales-table.tsx`, `product-sales-table.tsx`) to render the new net field once available; split `analytics-kpi-strip.tsx`'s single `NET_SALES_GAP` caveat into two distinguishable preconditions (tax-rate coverage vs. returns/refunds) and gate rendering on tax-rate coverage being available while still disclosing the returns/refunds caveat.
- A migration is **not** required — no new columns; every new figure is computed at query time from existing columns.

### Out of Scope
- Returns/refunds modeling (no entity exists; `NET_SALES_GAP`'s second half stays open and must stay visible in the FE copy).
- Any change to how `taxRate` is written, resolved, or validated at ingestion (ADR-063/#2245/#2250/#2254 territory — already shipped).
- Gross/GMV figures: untouched, byte-identical before/after this change.
- Variant-level top-products ranking (already out of scope for #1988).
- A hard gate that blocks issuance/publishing on missing tax rate (that is `OL_TAX_RATE_STRICT_ENABLED`'s invoicing/fiscalization/channel-adapter scope, not analytics' concern — analytics only *reports*, never blocks).

### Constraints
- Additive-only: every existing field, column, and query result shape must remain unchanged for a consumer that ignores the new fields.
- Must respect `docs/architecture-overview.md § Cross-context dependencies in core` — `orders` may only import `I*Service`/`*Port`/`is*`/entities/exceptions/`*_TOKEN`/`*Module` shapes from a sibling context's top-level barrel.
- Must not introduce a second, independently-drifting copy of ADR-063's percent-as-string notation rules; where a shared rule already exists in `invoicing`, it is either reused (if import-shape-legal) or explicitly **mirrored** with a stated reason (if not) — never silently reinvented with different edge-case behavior.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders/domain`, `.../infrastructure/persistence/repositories`) + Interface (`apps/api/src/analytics/http/dto`) + Frontend (`apps/web/src/features/analytics`).

**Capabilities Involved**: None — this is a read-model aggregation change, not a capability-port change. No new port, no new adapter.

**Existing Services Reused**:
- `OrderRecordService.getSalesAndChannelAnalytics` / `IOrderRecordService` (orchestration, unchanged signature — only its assembled result grows fields).
- `OrderRecordRepositoryPort.getDailyOrderAggregates` / `getMedianOrderValue` (SQL, extended).
- `OrderLineItemRepositoryPort.getTopProductRanking` / `getProductChannelBreakdown` (SQL, extended).
- `buildSalesAndChannelAnalytics` / the top-products pure assembler (extended, still pure).
- `isPreRolloutOrder`, `isTaxRateEnforced`, `isTaxRateStrictEnabled` from `@openlinker/core/sales-documents` (reused as-is).

**New Components Required**:
- `libs/core/src/orders/domain/types/net-sales-tax-rate.types.ts` — pure-rule-exception file (per `engineering-standards.md § The pure-rule exception to "types only"`) holding the taxRate → net-fraction-or-unknown coercion, its known-exempt-code vocabulary, and the matching SQL `CASE` fragment as a co-located string constant (see § 6 Phase 1 for why the fragment lives beside the TS rule rather than only in the repository files).
- No new ORM entity, no new migration, no new port.

**Core vs Integration Justification**: This is pure CORE domain/read-model work — it reads columns two prior CORE epics (#1985 read model, ADR-063 tax-rate) already wrote, and produces a derived reporting figure. It has no external-system dependency and no capability-adapter involvement, so there is nothing for it to be in Integration.

---

## 4. External / Domain Research

### Internal Patterns (found in codebase)

**Column facts** (already shipped on this branch, `libs/core/src/orders/infrastructure/persistence/entities/`):
- `order_line_items.taxRate` — `varchar(16)`, nullable, percent-as-string vocabulary (`'23'`, `'8'`, `'5'`, `'0'`) plus exemption codes (`'zw'`, `'np'`, `'oo'`). Transcribed from the snapshot by the single `upsertWithLineItems` writer (#2250).
- `order_records.taxRateEra` — `varchar(16)`, nullable, `'pre-rollout'` marker (#2256). `null` means "ingested after the feature", the ordinary case.

**Existing notation rule** (`libs/core/src/invoicing/domain/types/tax-rate-notation.types.ts`): `taxRatePercentToFraction(taxRate: string): number | null` reads a numeric code as a fraction, throws `FractionalTaxRateNotationError` on ambiguous fractional notation (`'0.23'`), and returns `null` for a non-numeric code (including `'zw'/'np'/'oo'`, since invoicing passes those through verbatim to the provider rather than computing with them).

This rule **cannot be imported directly** by `orders`: `taxRatePercentToFraction` / `parseTaxRatePercent` / `isFractionalTaxRateNotation` are plain functions that match none of the cross-context-import allow-list shapes (`I*Service`, `*_TOKEN`, `*Port`, `is*`-as-capability-guard, entity/VO/type-alias, `*Exception`/`*Error`, `UPPER_SNAKE_CASE` constant, `*Module`) — `scripts/check-cross-context-imports.mjs` would reject the import. `FractionalTaxRateNotationError` alone would pass (matches `*Error`), but a bare error class with no parser to throw it is useless here.

Analytics also needs **different semantics** than invoicing's helper: invoicing's `null` for `'zw'/'np'/'oo'` is correct for invoicing (nothing to compute — the code passes through), but analytics needs those three codes to resolve to a **known 0% fraction** (net = gross), and needs a **separate "unknown" outcome** for anything else unresolvable (empty, malformed, a future code) so it can be excluded rather than silently zeroed.

**Decision**: mirror, don't import. A new, orders-local pure rule (§ 3, new component) restates the "is this fractional/numeric" logic in ~10 lines rather than reusing the invoicing helper across the disallowed boundary. This follows the repo's own established mirroring precedent for this exact situation class (`scripts/check-parameter-restriction-mirror.mjs`, `scripts/check-shipping-tax-split-mirror.mjs` — a FE/BE pure-rule pair kept in sync by an invariant script because the two consumers have different constraints). See § 7 Alternatives Considered for the rejected alternative (widening the cross-context allow-list).

**Existing exclusion-disclosure pattern to mirror exactly** (`order-record.repository.ts:393-515`, `order-line-item.repository.ts:100-306`): the FX epic (#2049/ADR-040) already solved "some rows have the fact we need, some don't, never silently drop or silently mix" for `reportingCurrency`. The shape is:
1. A boolean SQL predicate splitting "has the fact, comparably" vs. "doesn't" (`isStamped` / `unconvertedOrZeroTotal`).
2. Two parallel `SUM(...) FILTER (WHERE ...)` aggregates — one per predicate branch — never a single `COALESCE`-to-zero blend.
3. A `count` + `value` pair for the excluded branch, plus a "one uniform label, or `NULL` if mixed" resolver for a descriptive dimension (`unconvertedCurrency`).
4. The pure assembler rolls the per-row/per-day figures up without doing arithmetic of its own on the split (`resolveUniformReportingCurrency`/`resolveUniformUnconvertedCurrency` precedent).

Net Sales reuses this shape verbatim, with the split predicate being "does every line on this order resolve to a known tax fraction" instead of "is this order reporting-currency-stamped".

### External System
None — no external API, no new webhook, no new capability.

---

## 5. Questions & Assumptions

### Open Questions
1. **Order-level exclusion granularity**: an order can have some lines with a known rate and others unknown (e.g. a race between #2254's writer and a partial catalogue rollout, post-#2256). Should the *whole order* be excluded from Net Sales when *any* line is unresolvable, or should the resolvable lines still contribute their own net amount while the unresolvable lines' gross falls into an "excluded" bucket?
   - **Assumption (safe default, adopted below)**: **whole-order exclusion**. A partially-net order would present a number that looks like a total but silently omits some lines' tax — indistinguishable from a correct total to anyone reading the KPI. This mirrors the codebase's existing "all-or-nothing" instinct (`unconvertedCurrency` returns `null`, not a partial label, the moment the set is mixed) and is safer to loosen later than to tighten later (loosening is additive; tightening would move numbers on dashboards operators already trust).
2. **Should Net Sales be reported per-day-trend, or headline+channel only?** `#1987`'s existing `DailyTrendPoint` only carries gross `revenue`/`orderCount`. Adding a net trend line means growing that shape too.
   - **Assumption**: **headline + per-channel only, no trend line**, for this slice. The KPI strip's Net Sales slot (`analytics-kpi-strip.tsx`) is a single number, not a chart; the trend sparkline is gross-only elsewhere in the spec too. A follow-up can add `netRevenue` to `DailyTrendPoint` if a future mockup needs it.
3. **Exempt-code vocabulary stability**: `'zw'/'np'/'oo'` are today's only known non-numeric codes (per ADR-063). Should the resolver hard-code exactly these three, or treat "any non-numeric string" as 0%?
   - **Assumption**: **hard-code the closed list** (`NetSalesExemptTaxRateCodeValues = ['zw', 'np', 'oo'] as const`), mirroring `TaxRateEraValues`'s closed-list-with-guard convention. A future unrecognized code must read as "unknown" (excluded), never silently coerced to 0% — an unrecognized code is far more likely to be a defect than a new legitimate exemption.

### Assumptions carried from the conversation (confirmed, not re-litigated)
- Net Sales excludes an order when `order_records.taxRateEra = 'pre-rollout'` (ADR-063 Consequences) — implemented via `isPreRolloutOrder`, not a bespoke check.
- `'0'`, `'zw'`, `'np'`, `'oo'` are all effective 0% for net-sales arithmetic (net = gross for that line); they are represented as a **known** 0 fraction, not folded into "unknown".
- Gross/GMV figures are never altered, relabeled, or removed.

### Documentation Gaps
- ADR-063 documents the exclusion *principle* for a future net-revenue consumer but does not itself name `getSalesAndChannelAnalytics`/`/analytics/sales`/top-products — this plan is the first concrete implementer of that principle and should be referenced back from ADR-063 once merged (a one-line addendum, not a new ADR — see § 7).

---

## 6. Proposed Implementation Plan

### Phase 1: Core pure-rule + SQL fragment

**Goal**: One pure, tested rule for "what does this taxRate mean for net-sales arithmetic", plus the SQL fragment that implements it identically in both repositories.

**Steps**:

1. **Create `libs/core/src/orders/domain/types/net-sales-tax-rate.types.ts`**
   - **File**: `libs/core/src/orders/domain/types/net-sales-tax-rate.types.ts`
   - **Action**: Define:
     ```ts
     export const NetSalesExemptTaxRateCodeValues = ['zw', 'np', 'oo'] as const;
     export type NetSalesExemptTaxRateCode = (typeof NetSalesExemptTaxRateCodeValues)[number];

     export type NetSalesTaxRateOutcome =
       | { kind: 'known'; rateFraction: number }
       | { kind: 'unknown' };

     export function resolveNetSalesTaxRate(taxRate: string | null | undefined): NetSalesTaxRateOutcome;
     ```
   - Semantics: `null`/`undefined`/empty/whitespace → `unknown`. Exempt code (case-sensitive match against the closed list) → `known, rateFraction: 0`. Otherwise parse as a float; reject (→ `unknown`, never throw — this is a read path over historical data, not a write-path validator) anything non-finite, `< 0`, `>= 1` (fractional notation, e.g. `'0.23'` — same ambiguity `FractionalTaxRateNotationError` guards, but degraded to `unknown` instead of thrown, since a read-model aggregate must never 500 on one bad historical row) , or `> 100`. Otherwise → `known, rateFraction: parsed / 100`.
   - **Acceptance**: Pure, dependency-free (no imports beyond nothing — matches the `pricing-rule.types.ts` precedent). Unit-tested (Phase 4) for every code in ADR-063's vocabulary plus malformed inputs.

2. **Add the matching raw-SQL fragment as a co-located constant**
   - **File**: same file, exported alongside the TS rule (the "both halves change together" pure-rule-exception requirement — a SQL string is not a runtime function, but it **is** the rule restated for the query builder, and must never drift from step 1's semantics).
   - **Action**: Export
     ```ts
     export const NET_SALES_RATE_FRACTION_SQL = (taxRateColumnRef: string): string => `
       CASE
         WHEN ${taxRateColumnRef} IN ('zw','np','oo') THEN 0
         WHEN ${taxRateColumnRef} ~ '^[0-9]+(\\.[0-9]+)?$'
              AND ${taxRateColumnRef}::numeric >= 0 AND ${taxRateColumnRef}::numeric <= 100
         THEN (${taxRateColumnRef}::numeric / 100)
         ELSE NULL
       END`;
     ```
   - A parameterized function (taking the qualified column reference, e.g. `li."taxRate"`) rather than a bare string, so both call sites (Phase 2 and 3) get an identical expression without hand-retyping it.
   - **Acceptance**: A single unit test asserts the generated SQL string is syntactically what's expected for a known column ref; the real correctness proof is the repository-level tests in Phase 4 exercising it against Postgres.

3. **Export from the `orders` sub-barrel** (`libs/core/src/orders/index.ts`) only the TS-side pieces a consumer outside `libs/core/src/orders/infrastructure` might need (`NetSalesTaxRateOutcome`, `resolveNetSalesTaxRate` for the FE-mirror consideration in Phase 5 — note: the FE cannot import this at all per `frontend-architecture.md`'s app boundary, so this export exists for future BE consumers / tests only, not for FE reuse). The SQL fragment constant stays infrastructure-only (imported via relative path from the two repository files — same-context, ≤ `../..` depth per `engineering-standards.md § Import Aliases` rule 1) and is **not** re-exported from the barrel, since raw SQL strings have no business crossing any boundary.

---

### Phase 2: `#1987` sales & channel aggregation (order-level net)

**Goal**: `GET /analytics/sales` reports `netRevenue`/`netAverageOrderValue`/`netMedianOrderValue` (headline + per channel), each with its own excluded-count/excluded-value pair, additive to every existing gross field.

**Steps**:

1. **Extend `OrderRecordRepositoryPort.getDailyOrderAggregates`**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` (method at line ~416).
   - **Action**: The query currently aggregates directly off `order_records` with no join to `order_line_items`. Net-per-order requires summing each order's own lines. Add an `INNER JOIN order_line_items li ON li."orderRecordId" = rec."internalOrderId"` and compute, per line, `netLineAmount = li."unitPrice" * li."quantity" * <rate-fraction-from-Phase-1>`, then `SUM` those up **grouped by order first** via a lateral/subquery pattern — or, simpler and consistent with the existing per-row style, compute an order-level `BOOL_AND` "all lines resolvable" flag and a `SUM` of per-line net amounts directly in the same `GROUP BY day, sourceConnectionId` query, using `FILTER` the same way `unconvertedOrZeroTotal` does today. Concretely:
     - `netKnownPredicate`: an order is **net-eligible** when `isTaxRateEnforced`-independent (net-sales is a reporting concern, not a gate) — i.e. NOT pre-rollout (`rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'`) AND every one of its lines resolves to a known fraction. The "every line resolvable" condition cannot be expressed as a simple per-row `FILTER` since it's an order-level fact derived from N lines; implement it as a correlated subquery predicate: `NOT EXISTS (SELECT 1 FROM order_line_items li2 WHERE li2."orderRecordId" = rec."internalOrderId" AND <Phase-1 rate fragment on li2."taxRate"> IS NULL)`.
     - `netAndNotCancelled = notCancelled AND stampedAndNotCancelled's isStamped AND netKnownPredicate` (net figures additionally require the same reporting-currency stamp as gross `revenue`, so the two are comparable — never sum unstamped native amounts into a "net" figure).
     - `netRevenue` aggregate: `COALESCE(SUM(li."unitPrice" * li."quantity" * (1 - <rate-fraction>) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${netAndNotCancelled}), 0)` — reusing the exact same order-level FX multiplier the top-products query already uses (§ Phase 3), so a net figure is converted to the current reporting currency identically to how gross already is.
     - `netExcludedCount` / `netExcludedValue`: mirror `unconverted_count`/`unconverted_value`'s shape exactly, but keyed on `NOT netKnownPredicate` (and not cancelled) instead of "not stamped" — this is a **different exclusion axis** from the existing currency one, so it must **not** reuse the `unconverted*` fields; it is a new, parallel pair.
   - **Acceptance**: `getDailyOrderAggregates` returns 5 new keys per row: `netRevenue`, `netExcludedCount`, `netExcludedValue`. Existing 9 keys unchanged in value and order.
   - **Dependencies**: Phase 1.

2. **Extend `getMedianOrderValue`** (line ~531) with a parallel `getNetMedianOrderValue` (or an additional selected column in the same query — prefer a **second, dedicated method** for clarity, since the WHERE-clause shape genuinely differs: median needs a single order-level net amount per matching order, computed via a correlated subquery `SELECT SUM(...) FROM order_line_items li WHERE li."orderRecordId" = rec."internalOrderId"` inside the `PERCENTILE_CONT` window, restricted to `netKnownPredicate`).
   - **File**: same repository, new method `getNetMedianOrderValue(filters, currentReportingCurrency): Promise<number | null>`.
   - **Acceptance**: Returns `null` when zero orders satisfy `netKnownPredicate AND isStamped AND notCancelled` in range — same "empty ordered-set" convention as the gross median.

3. **Extend `DailyOrderAggregateRow` / `SalesAndChannelAnalytics` domain types**
   - **File**: `libs/core/src/orders/domain/types/order-sales-analytics.types.ts`.
   - **Action**: Add `netRevenue: number; netExcludedCount: number; netExcludedValue: number;` to `DailyOrderAggregateRow`; add `netRevenue: number; netAverageOrderValue: number | null; netMedianOrderValue: number | null; netExcludedCount: number; netExcludedValue: number;` to both `SalesAnalyticsHeadline` and `ChannelSalesAnalytics`.
   - **Acceptance**: Type-checks; no existing field removed or renamed.

4. **Extend `buildSalesAndChannelAnalytics`**
   - **File**: `libs/core/src/orders/domain/order-sales-aggregation.ts`.
   - **Action**: Roll up `netRevenue`/`netExcludedCount`/`netExcludedValue` from `dailyRows` the same way `revenue`/`unconvertedCount`/`unconvertedValue` are rolled up today (straight `SUM`, no arithmetic beyond addition — the function stays pure and does no currency/tax math of its own, matching its existing doc-comment discipline). Compute `netAverageOrderValue = netOrderCount > 0 ? netRevenue / netOrderCount : null` — reusing the SAME `orderCount` denominator as gross AOV (an order counted in `orderCount` but excluded from net does not get its own separate net order count; net AOV is `netRevenue / orderCount`, consistent with "AOV" meaning "per order in the same population", not a redefined population). Thread `netMedianOrderValue` straight through from the new repository call.
   - **Acceptance**: Existing gross-only unit tests for this function pass unmodified; new tests cover the net rollup (Phase 4).
   - **Dependencies**: Steps 1–3.

5. **Extend `IOrderRecordService.getSalesAndChannelAnalytics` orchestration**
   - **File**: `libs/core/src/orders/application/services/order-record.service.ts` (method at line ~504).
   - **Action**: Call the new `getNetMedianOrderValue` alongside the existing `getMedianOrderValue`, pass its result into `buildSalesAndChannelAnalyticsInput`.
   - **Acceptance**: One additional repository call added to the existing `Promise.all` (or equivalent) fan-out; no change to the method's own signature.

6. **Extend the response DTO**
   - **File**: `apps/api/src/analytics/http/dto/sales-analytics-response.dto.ts`.
   - **Action**: Add `netRevenue`, `netAverageOrderValue` (nullable), `netMedianOrderValue` (nullable), `netExcludedCount`, `netExcludedValue` to both `SalesAnalyticsHeadlineDto` and `ChannelSalesAnalyticsDto`, with `@ApiProperty` descriptions cross-referencing `unconvertedCount`'s doc-comment style (state explicitly that `netExcludedCount` counts pre-rollout orders AND orders with any unresolvable line, not just one or the other).
   - **Acceptance**: Swagger doc renders the new fields; `fromDomain` mapping is 1:1, no logic in the DTO.

---

### Phase 3: `#1988` top-products aggregation (line-level net)

**Goal**: The top-products read reports `netRevenue` per product (and per channel breakdown row), reusing the same Phase-1 SQL fragment — this path is simpler than Phase 2 because it already operates at the `order_line_items` grain.

**Steps**:

1. **Extend `getTopProductRanking`**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts` (method at line ~136).
   - **Action**: Reuse the existing `stampedNonZero` predicate, additionally gated by `rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'` AND the Phase-1 rate fragment on `li."taxRate"` being non-`NULL`, call this `stampedNonZeroKnownRate`. Add:
     - `netRevenue`: `COALESCE(SUM(li."unitPrice" * li."quantity" * (1 - <rate-fraction on li."taxRate">) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroKnownRate}), 0)`.
     - `netExcludedRevenue` / `netExcludedOrderCount` (or `netExcludedLineCount` — decide against `ProductChannelBreakdownRow`'s existing naming; prefer counting **lines**, not orders, at this grain, since a product's ranking is inherently line-scoped) `FILTER (WHERE NOT ${stampedNonZeroKnownRate} AND ${stampedNonZero})` — i.e. among lines that WOULD count toward gross `revenue`, how many/how much is excluded from `netRevenue` specifically because of tax-rate unresolvability (kept disjoint from the pre-existing `unconvertedRevenue`, which already covers the currency-unstamped case; a line is either in `revenue`'s stamped set or `unconvertedRevenue`'s set, never both, and `netExcludedRevenue` is a strict subset of the stamped set).
   - **Acceptance**: `ProductRankingRow` gains `netRevenue: number; netExcludedRevenue: number; netExcludedLineCount: number;`; existing 6 fields unchanged.
   - **Dependencies**: Phase 1.

2. **Extend `getProductChannelBreakdown`** (line ~236) identically, scoped per `(productId, sourceConnectionId)`.
   - **File**: same repository.
   - **Action**: Same three new fields on `ProductChannelBreakdownRow`.

3. **Extend domain types**
   - **File**: `libs/core/src/orders/domain/types/top-products.types.ts`.
   - **Action**: Add the three fields to `ProductRankingRow` and `ProductChannelBreakdownRow`; add `netRevenue: number; netExcludedRevenue: number; netExcludedLineCount: number;` to `TopProductView` (rolled up from the ranking row, channels carry their own).

4. **Extend the pure top-products assembler**
   - **File**: `libs/core/src/orders/domain/top-products-aggregation.ts` (not yet read in full — locate the function analogous to `buildSalesAndChannelAnalytics` and thread the three new fields straight through, no arithmetic beyond what the SQL already computed).

5. **Extend the response DTO**
   - **File**: `apps/api/src/analytics/http/dto/top-products-response.dto.ts`.
   - **Action**: Mirror Phase 2 Step 6's DTO treatment for the top-products shape.

---

### Phase 4: Tests

**Unit Tests** (`*.spec.ts`, colocated):
- `libs/core/src/orders/domain/types/net-sales-tax-rate.types.spec.ts` — every ADR-063 vocabulary value (`'23'`, `'8'`, `'5'`, `'0'`, `'zw'`, `'np'`, `'oo'`), plus `null`, `''`, `'  '`, `'0.23'` (fractional-notation edge case → `unknown`, not thrown), `'150'` (out-of-range → `unknown`), a garbage string (→ `unknown`).
- `order-sales-aggregation.spec.ts` — extend existing suite: a day with all-known-rate orders, a day with one pre-rollout order (excluded from net, still counted in gross), a day with one order carrying a mixed-rate line set (whole order excluded per § 5 Assumption 1), assert `netRevenue`/`netExcludedCount`/`netExcludedValue`/`netAverageOrderValue` (including the `orderCount === 0` → `null` case).
- `top-products-aggregation.spec.ts` — analogous line-grain cases.

**Integration Tests** (`*.int-spec.ts`, `apps/api/test/integration/`):
- Extend (or add sibling to) the existing `#1987`/`#1988` integration coverage: seed order records + line items with a mix of numeric rates, exempt codes, `null` rates, and `taxRateEra = 'pre-rollout'`; assert the new fields via the real HTTP `GET /analytics/sales` and `GET /analytics/top-products` responses against a real Postgres (Testcontainers), since the correctlyness of the correlated-subquery / `FILTER` SQL in Phase 2 Step 1 is exactly the kind of thing a mocked repository test cannot prove.

**Mocking Strategy**: Repository-level unit tests (if any exist today for these methods) continue mocking `DataSource`/`QueryBuilder` per existing convention; the SQL correctness itself is proven by the integration tests above, not by mocks.

**Acceptance Criteria**:
- [ ] `pnpm test` green, including new specs.
- [ ] `pnpm test:integration` green for the extended `/analytics/sales` and `/analytics/top-products` suites.
- [ ] Every existing assertion on gross fields in both suites is unchanged (proves additivity).
- [ ] `pnpm --filter @openlinker/api migration:show` reports no pending migration (confirms no schema change was needed).

---

### Phase 5: Frontend

**Goal**: Stop mislabeling gross as "Net sales"; render the real net figure where available; make the two distinct Net Sales preconditions (tax-rate coverage vs. returns/refunds) legible instead of conflated.

**Steps**:

1. **`apps/web/src/features/analytics/api/sales-analytics.types.ts` (or wherever the FE mirrors the response DTO shape)**: add the new `netRevenue`/`netAverageOrderValue`/`netMedianOrderValue`/`netExcludedCount`/`netExcludedValue` fields (headline + channel), matching backend `camelCase` naming per `frontend-architecture.md`'s "Types that mirror backend contracts" rule.
2. **`analytics-kpi-strip.tsx`**: split the single `NET_SALES_GAP` string into two named caveats:
   - `NET_SALES_TAX_GAP` — now **resolved** for orders past the tax-rate rollout; render the real `netRevenue` figure once `netExcludedCount === 0` for the current range, or render it with a visible "excludes N orders without a settled tax rate" qualifier when `netExcludedCount > 0` (never silently drop the caveat — mirrors the `unconvertedCount` tooltip precedent in `channel-sales-table.tsx:112`).
   - `NET_SALES_RETURNS_GAP` — unchanged in substance (still no returns/refunds entity), but now clearly labeled as the **remaining** reason Net Sales is not the spec's fully-netted figure, so an operator reading the KPI understands it is "VAT-exclusive, but not yet returns-exclusive" rather than "gross" or "the spec's Net Sales".
   - **Decision needed at implementation time** (flagged, not resolved here): does the KPI render the real (VAT-exclusive-only) `netRevenue` number now, with the returns caveat as a footnote, or does it keep showing `GapMark`-only until returns are also modeled? **Recommended**: render the real number — a VAT-exclusive figure is strictly more informative than "unavailable", and the returns caveat can co-exist as a secondary disclosure the same way `unconvertedCount` co-exists with the headline revenue figure today.
3. **`channel-sales-table.tsx`**: the column currently `header: 'Net sales'` (line 229) sources from the existing gross `revenue`/`reportingTotalAmount`. Repoint it to the new `netRevenue` field; add the same excluded-orders tooltip pattern already used for `unconvertedCount` (line 112), parameterized on `netExcludedCount` instead.
4. **`product-sales-table.tsx`**: same repoint from gross to `netRevenue` for its "Net sales" column, once Phase 3 lands the field.
5. **`top-products.types.ts`**: update its header comment (currently states "#1988 computes a gross... figure") to reflect that a true net (VAT-exclusive) figure is now available, still noting the returns/refunds gap.

**Acceptance**: No FE test currently asserts on the mislabeled gross-as-net value (verify during implementation); if one does, it must be updated to assert the new, correctly-labeled behavior, not deleted.

---

## 7. Alternatives Considered

### Alternative 1: Widen the cross-context-import allow-list to permit importing `taxRatePercentToFraction` from `invoicing` directly
- **Description**: Add "pure notation/parsing helper functions" as a new allowed shape in `scripts/check-cross-context-imports.mjs`, then have `orders` import the existing invoicing helper instead of mirroring it.
- **Why Rejected**: The allow-list is deliberately narrow and name-pattern-based specifically so a reviewer can tell what crossed a boundary without reading the checker's logic; widening it for one call site sets a precedent for pulling arbitrary utility functions across context lines, defeating the reason the barrier exists (each context's internals can change freely as long as its `I*Service`/`*Port` surface holds). It would also import a helper whose actual behavior (returning `null` for exemption codes) is wrong for analytics without a wrapper anyway — so importing buys nothing over mirroring.
- **Trade-offs**: Mirroring costs ~15 lines of duplicated-in-spirit logic plus the discipline of keeping it in sync manually (there is no automatic invariant script for this pair, unlike the FE/BE mirrors — see § 10 for a note on whether one is warranted at this size).

### Alternative 2: Compute net figures in the pure assembler (JS) instead of in SQL
- **Description**: Fetch every raw `order_line_items` row for the requested range into the application layer and compute nets in `order-sales-aggregation.ts`/`top-products-aggregation.ts`.
- **Why Rejected**: Both existing read models are deliberately SQL-aggregated specifically to avoid pulling potentially thousands of line-item rows into Node for a dashboard read (`docs/architecture-overview.md`'s ADR-039 persistence-strategy rationale — "no materialized view... at this persona's volume" already assumes SQL-side aggregation, not row-by-row JS reduction). Doing net-sales math in JS would be a strictly worse-scaling regression relative to the existing gross computation living entirely in SQL.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE↔Integration boundary crossed — pure read-model extension.
- ✅ Cross-context imports stay within the documented allow-list (`is*` functions from `sales-documents` only; no function/type import that would fail `check-cross-context-imports.mjs`).
- ✅ Domain layer (`net-sales-tax-rate.types.ts`) has zero framework/I-O dependencies.

### Naming Conventions
- ✅ `*.types.ts` pure-rule exception followed (coercion function co-located with the type it rules on, per `engineering-standards.md`).
- ✅ `as const` + derived union for `NetSalesExemptTaxRateCodeValues`, matching `TaxRateEraValues`'s precedent.

### Existing Patterns
- ✅ Exclusion-disclosure shape (`count`/`value` pair, never a silent blend) directly mirrors the shipped FX `unconverted*` precedent — same reviewer-recognizable idiom, not a new one.

### Risks
- **SQL correctness of the correlated-subquery "all lines resolvable" predicate (Phase 2 Step 1)**: this is the single most SQL-hazardous piece of the whole plan — a `NOT EXISTS` subquery per order, re-evaluated per `GROUP BY` row, on a table already carrying a composite index on `(sourceConnectionId, placedAt)` and `(productId, placedAt)` but **no index on `(orderRecordId, taxRate)`**. **Mitigation**: profile against a realistic-volume Testcontainers fixture in Phase 4's integration tests before considering the query production-ready; if it is measurably slow, an index on `order_line_items(orderRecordId)` (partial, `WHERE "taxRate" IS NULL`) may be warranted as a follow-up migration — flagged here, not pre-emptively added, since the existing table-index comment (`order-line-item.orm-entity.ts:14-21`) explicitly records that the team defers new indexes until "a query actually needs" them.
- **Whole-order exclusion (§ 5 Assumption 1) may under-report Net Sales more than a line-partial approach would**, especially during the rollout window when a catalogue is only partially covered. This is a deliberate, disclosed trade-off (visible via `netExcludedCount`/`netExcludedValue`), not a silent one — but it means Net Sales coverage will visibly lag GMV coverage for a while, which the FE must not present as a bug.
- **Reporting-currency FX multiplier reuse** (`reportingTotalAmount / NULLIF(totalAmount, 0)`): net figures inherit the exact same "stamped, non-zero total" precondition gross figures already have (§ Phase 2/3 predicates require `isStamped`/`stampedNonZero` in addition to the tax-rate check) — this is intentional (net and gross must be comparable, same currency era), not an oversight, but it means an order excluded from gross `revenue` for currency reasons is *also* excluded from `netRevenue`, and that exclusion is **already** disclosed via the existing `unconverted*` fields, not double-counted into the new `netExcluded*` fields. **This must be enforced in the SQL** (the `netAndNotCancelled`/`stampedNonZeroKnownRate` predicates are defined as `isStamped AND <tax-known>`, so a currency-unstamped order never reaches the tax-rate check at all and is never double-counted).

### Edge Cases
- Order with zero line items (should not happen post-#1985, but the correlated `NOT EXISTS` predicate must be checked against this: an order with no lines makes `NOT EXISTS (...)` vacuously true, i.e. "every line resolvable" — since there are no lines to fail. Decide explicitly in Phase 2 whether such an order should count as net-eligible with `netRevenue` contribution `0` (arithmetically consistent) or be excluded (defensive). **Recommended**: exclude it too, by additionally requiring `EXISTS (SELECT 1 FROM order_line_items li WHERE li."orderRecordId" = rec."internalOrderId")` — an order with no lines is itself a data anomaly and should not silently pass as "net-eligible, contributing zero".
- `netMedianOrderValue` on a range where every order is either pre-rollout or unstamped: must return `null` (empty ordered-set), not `0` or `NaN` — same convention as the existing gross median.

### Backward Compatibility
- ✅ Fully additive. No existing field renamed, removed, or reinterpreted. A consumer (FE or third-party API client) that does not read the new fields observes zero behavior change.

---

## 9. Testing Strategy & Acceptance Criteria

Covered in § 6 Phase 4 in detail. Summary:
- [ ] Unit tests for `resolveNetSalesTaxRate` cover the full ADR-063 vocabulary + malformed input.
- [ ] Unit tests for both pure assemblers cover: all-known-rate, pre-rollout-excluded, mixed-rate-line-excluded, zero-matching-orders (`null` AOV/median).
- [ ] Integration tests exercise the real SQL against Testcontainers Postgres for both `/analytics/sales` and `/analytics/top-products`, seeding a realistic mix of tax-rate states.
- [ ] Existing gross-figure assertions in both suites remain green, unmodified.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (pure domain rule, infra-only SQL, interface-only DTO changes).
- [x] Respects CORE vs Integration boundaries (no integration touched at all).
- [x] Uses existing patterns (exclusion-disclosure shape mirrored from the FX epic; no new abstraction invented).
- [x] Idempotency considered (read-only aggregation; no write path touched).
- [ ] Event-driven patterns — N/A, no event involved.
- [ ] Rate limits & retries — N/A, no external call involved.
- [x] Error handling comprehensive (`resolveNetSalesTaxRate` never throws on malformed historical data).
- [x] Testing strategy complete (§ 9).
- [x] Naming conventions followed (§ 8).
- [x] File structure matches standards.
- [x] Plan is execution-ready.
- [x] Plan is saved as markdown file.

**Note on ADR**: this plan does not draft a new numbered ADR. The governing principle (exclude, never silently zero, an order without a settled tax rate from a net-revenue figure) is already recorded in ADR-063 § Consequences; this plan is that principle's first concrete analytics implementation, not a new architectural decision in its own right. The one genuinely novel choice — mirror-not-import for the cross-context notation rule (§ 7 Alternative 1) — is documented here and is reversible without a migration if a future change widens the import allow-list.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — §§ Orders (Order analytics read model, Sales & channel aggregates), Invoicing (Tax rates are an input, never a computation), Cross-context dependencies in core.
- [Engineering Standards](../engineering-standards.md) — § The pure-rule exception to "types only", § Import Aliases.
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- `docs/specs/metrics-analytics-dashboard.md` — canonical Net Sales / GMV definitions.
- `docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md` — the exclusion principle this plan implements.
