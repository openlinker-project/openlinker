# [TASK] CORE — Decide whether pre-rollout orders' missing `taxRate` should be backfilled or left permanently excluded from Net Sales

> Draft only — not created on GitHub. Local file per user request.

## Problem / Context

Orders ingested before per-line tax-rate capture existed (ADR-063) have `order_line_items.taxRate = NULL`. The migration `apps/api/src/migrations/1840000000003-mark-pre-rollout-orders-historical.ts` already marks every such order as `order_records.taxRateEra = 'pre-rollout'` (backfill `UPDATE`, idempotent via `jsonb_path_exists` against `orderSnapshot`, lines ~45-53).

That marker is read by the Net Sales aggregation, not just by the ADR-063 publish/issuance enforcement switch:

- `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts:610` — `rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'` is one of the three gates for an order to count toward net-sales.
- `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts:157-158,280-281` — `stampedNonZeroKnownRate` requires the same, independent of `OL_TAX_RATE_STRICT_ENABLED`.

So today, **every pre-rollout order is permanently and unconditionally excluded from Net Sales**, regardless of whether the tax-rate-enforcement switch is on. This surfaced as a real symptom while seeding local test data for `/analytics`: orders with `taxRate` populated correctly still showed zero contribution to Net Sales once `taxRateEra` was set (or defaulted in a way that read as pre-rollout), and it wasn't obvious from the UI alone that this was *by design* rather than a bug.

ADR-063 (`docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md`, § Consequences, ~lines 162-164) states this outcome explicitly: pre-rollout orders "issue exactly as they do today, excluded from any net-revenue figure rather than presented as a confirmed rate," and the migration file's own header comment (line ~7) frames the historical rate as unrecoverable — "nothing about them can be corrected after the fact." **No backfill or re-derivation strategy is proposed anywhere in the ADR.**

A superficially plausible backfill — re-deriving `taxRate` from `ProductMasterPort` / `Product.taxRate` / `ProductVariant.taxRate` (`libs/core/src/products/domain/entities/product.entity.ts:60`, `product-variant.entity.ts:55`) — does not actually solve the problem: those fields carry the **current live** master-catalogue rate (with their own `taxRateReadAt` provenance), not a point-in-time historical rate. A product's VAT rate can legitimately change between the order date and today (rate migrations, product reclassification), so stamping today's rate onto a historical order would present a *guessed* rate as if it were confirmed — precisely what ADR-063 says pre-rollout orders should *not* do.

## Proposed Solution

This is an **investigation/decision issue**, not a guaranteed-implementation one. The likely outcome is "no backfill — `taxRateEra='pre-rollout'` is the designed, correct mechanism and Net Sales permanently under-reporting the pre-rollout period is accepted behaviour," but that decision should be made explicitly and documented rather than left implicit, because:

- it's currently discoverable only by reading repository SQL + the migration + ADR-063 — there's no operator-facing surface stating "your Net Sales figure excludes N pre-rollout orders worth X"
- an operator migrating from a pre-ADR-063 install could reasonably expect Net Sales to eventually "fill in" once the switch is enabled, when in fact it never will for historical orders

Two decision branches to evaluate and pick one:

**Branch A — No backfill (confirm as final, ship an operator-facing disclosure).**
- Confirm ADR-063's stance stands (no correction of historical rate — a guessed rate is worse than an honest exclusion).
- Add an operator-facing count/value of pre-rollout-excluded orders to the sales-analytics response (mirroring the existing `unconvertedCount`/`unconvertedValue` pattern in `getSalesAndChannelAnalytics`, per the architecture doc's Currency section), so the gap is visible instead of silently depressing Net Sales.
- Update ADR-063 status/wording only if this issue's investigation adds anything not already stated (it may not — the ADR may already be sufficient, in which case this branch is a no-op beyond the analytics disclosure).

**Branch B — Backfill from a source that actually has the point-in-time rate.**
- Only viable if a source system (e.g. the shop's own historical order/invoice data, not the live `ProductMaster` catalogue) can supply the rate *as it was at order time* — not today's catalogue rate.
- Requires establishing per-adapter feasibility (does PrestaShop/WooCommerce/Allegro expose a historical per-order tax rate on an already-placed order, distinct from the current product rate?) before any implementation is scoped.
- If feasible for at least one adapter, this becomes a real follow-up issue with adapter-specific scope — not something to implement speculatively here.

**Deliverable of this issue**: a decision comment/ADR amendment stating which branch was chosen and why, plus (if Branch A) the analytics-visibility follow-up scoped as acceptance criteria below.

## Classification

**Type**: CORE
**Layer**: Domain / Application (analytics read path); Interface (if the disclosure DTO field ships)
**File(s)**:
- `docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md`
- `apps/api/src/migrations/1840000000003-mark-pre-rollout-orders-historical.ts`
- `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
- `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts`
- `libs/core/src/sales-documents/domain/types/tax-rate-enforcement.types.ts`
- `apps/api/src/analytics/http/dto/sales-analytics-response.dto.ts` (if Branch A's disclosure field ships)

## Dependencies

- None required to start the investigation. Branch B (if chosen) would depend on adapter-specific research per platform before scoping implementation.

## Assumptions

- The user's framing ("czy nie uzupełniamy starych orderów o to") describes the *current* observed behaviour correctly — old orders are not backfilled — and this issue is scoped to decide whether that should change, not to assume it must.
- "Backfill migration" in the original request is treated as one candidate solution (Branch B) to be evaluated, not a foregone implementation, per explicit instruction to draft this as a decision issue first.
- If Branch A is chosen, the analytics-visibility follow-up is included here as an in-scope acceptance criterion rather than spun into a separate issue, since it's a small, well-understood addition once the decision is made — split it out if it turns out to be non-trivial.

## Acceptance Criteria

- [ ] Written decision recorded (ADR-063 amendment or a decision comment on this issue) on whether pre-rollout `taxRate` gaps are backfilled or permanently accepted as excluded from Net Sales
- [ ] If Branch A (no backfill): sales-analytics response surfaces a pre-rollout excluded count/value (mirroring `unconvertedCount`/`unconvertedValue`), and the FE renders it as a visible caveat near the Net Sales figure rather than a silent gap
- [ ] If Branch B (backfill feasible): a separate, adapter-scoped follow-up issue is filed with concrete per-platform feasibility findings — no implementation lands in *this* issue
- [ ] No architecture boundary violations (CORE ↔ Integration)
- [ ] Tests added or updated for any shipped code (the Branch A disclosure field, if implemented)
