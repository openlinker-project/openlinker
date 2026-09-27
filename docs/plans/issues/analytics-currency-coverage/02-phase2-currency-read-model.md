# [MINI-EPIC] Phase 2 — Backend: display-currency read model (no persistence writes)

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Depends on: Phase 1 (Task 1.1 ADR)
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` — states `native`, `converting`, `converted`, `unavailable`

## Scope

Add a **read-only, synchronous** re-render of the sales-analytics response in an operator-chosen currency. Per Task 1.1's ADR, **neither conversion mode needs a job, a queue, or a progress UI** — both operate at the aggregate level (one rate per distinct native currency, or a single multiply over an already-computed total). No writes to `order_records`.

Base code this phase extends (all on `origin/main` via PR #2014): `libs/core/src/orders/domain/order-sales-aggregation.ts`, `libs/core/src/orders/domain/types/order-sales-analytics.types.ts` (`SalesAnalyticsHeadline`), `apps/api/src/analytics/http/sales-analytics.controller.ts`, `apps/api/src/analytics/http/dto/sales-analytics-query.dto.ts` / `sales-analytics-response.dto.ts`.

## Branching

Branch `phase/2XXX-p2-currency-read-model` off the epic branch. Both tasks below commit directly to it; PR into the epic branch when the mini-epic's acceptance criteria are met.

## Dependencies

- Phase 1 Task 1.1 (ADR must be merged before this starts).
- Read-only consumer of `libs/core/src/currency/` (`ICurrencyRateService` — leaf context, see `docs/architecture-overview.md § 18. Currency`). No change to the currency context itself.

## Acceptance Criteria (mini-epic level)

- [ ] `GET /analytics/sales` accepts an optional display-currency + rate-basis query param pair and returns converted totals synchronously, in the same request/response cycle as today — no polling, no job status to check.
- [ ] "Current rate" mode never issues more than one rate lookup per distinct native currency present in the queried range.
- [ ] "Order-date"/stable mode issues at most **one** additional rate lookup total per request (the single today's-rate multiply over the already-computed aggregate) — never one per order.
- [ ] Unit tests cover: single native currency (no-op), mixed native currencies, a currency with no resolvable rate (reports `unavailable` rather than throwing or silently defaulting).

---

## Task 2.1 — `DisplayCurrencyConversionService` (both modes, synchronous)

### Problem / Context

`docs/architecture-overview.md § 18. Currency` documents `ICurrencyRateService` as a leaf context with **one** inbound edge (`orders`, for the ADR-040 stamp). This phase adds a *second*, read-only inbound edge from `analytics` reporting. The service must not read/write `order_records.reportingCurrency`/`reportingTotalAmount` (ADR-040 write-once invariant) — it operates purely on the already-computed `SalesAnalyticsHeadline` (and per-channel) aggregate that `order-sales-aggregation.ts` already produces.

### Proposed Solution

New pure application service `DisplayCurrencyConversionService` in `libs/core/src/orders/application/services/` (interface in `libs/core/src/orders/application/interfaces/`, per `docs/engineering-standards.md § Service Interface Implementation`), implementing both modes from Task 1.1's ADR:

- **`current-rate`**: takes the raw per-order (or per-daily-row) native `currency`/`totalAmount` data the aggregation already reads, groups by distinct native currency, resolves one rate per distinct currency via `ICurrencyRateService`, sums. A native currency with no resolvable rate is reported back as `unresolvedNativeCurrencies: string[]` on the result rather than thrown — this backs mockup state `unavailable`.
- **`order-date`** (stable mode): takes the already-computed `SalesAnalyticsHeadline.revenue` (in the system's stamped reporting currency). If the target display currency equals the reporting currency, returns it unchanged (zero I/O). Otherwise resolves **one** current rate `(reportingCurrency → displayCurrency)` and multiplies the whole total once.

Both branches are plain synchronous application-layer code — no `SyncJobPort`, no `sync_jobs` row, no polling endpoint.

### Classification

**Type**: CORE
**Layer**: Application
**File(s)**: `libs/core/src/orders/application/services/display-currency-conversion.service.ts`, `.../display-currency-conversion.service.interface.ts`, `libs/core/src/orders/domain/types/display-currency.types.ts`

### Dependencies

- Phase 1 Task 1.1.

### Assumptions

- `ICurrencyRateService` already exposes a "give me today's/latest rate for (from, to)" read sufficient for both modes; if it doesn't, this task adds the missing read method to the port rather than reaching around it.

### Acceptance Criteria

- [ ] `docs/plans/mockups/analytics-display-currency-picker.html` states `native` (baseline, no conversion), `converted` (mixed-currency banner: "Summed by each order's own currency: {n} orders in {currency}, …") and `unavailable` (unresolved native currency) are all reproducible from this service's output shape, for BOTH modes.
- [ ] `converting` reproduces as nothing more than the client's normal "waiting for the HTTP response" state — no distinct backend-observable in-progress state exists, because there is no job.
- [ ] Unit test: `current-rate` with two orders, two native currencies, one unresolvable → `unresolvedNativeCurrencies` populated, converted total excludes it.
- [ ] Unit test: `order-date` with target currency equal to reporting currency → zero calls to `ICurrencyRateService`.
- [ ] Unit test: `order-date` with a different target currency → exactly one call to `ICurrencyRateService`, regardless of the number of orders in range.
- [ ] Tests added.
- [ ] No CORE ↔ Integration boundary violations (this stays entirely inside `libs/core`).

---

## Task 2.2 — `GET /analytics/sales` query param + response DTO

### Problem / Context

The existing `apps/api/src/analytics/http/dto/sales-analytics-query.dto.ts` / `sales-analytics-response.dto.ts` have no currency-override axis.

### Proposed Solution

Add optional `displayCurrency?: string` (ISO-4217, validated against `SUPPORTED_REPORTING_CURRENCIES` per the existing `currency` context's save-time validation precedent) and `rateBasis?: 'current' | 'order-date'` (default `'current'`) to `SalesAnalyticsQueryDto`. Extend `SalesAnalyticsResponseDto` with the converted totals and `unresolvedNativeCurrencies` from Task 2.1. `sales-analytics.controller.ts` wires the new params through to `DisplayCurrencyConversionService` synchronously, within the existing request/response cycle, when `displayCurrency` differs from the resolved reporting currency; when absent, behaviour is byte-identical to today (no regression for existing callers).

### Classification

**Type**: Interface (HTTP)
**Layer**: Interface
**File(s)**: `apps/api/src/analytics/http/dto/sales-analytics-query.dto.ts`, `apps/api/src/analytics/http/dto/sales-analytics-response.dto.ts`, `apps/api/src/analytics/http/sales-analytics.controller.ts`

### Dependencies

- Task 2.1.

### Assumptions

- Same param shape applies to `top-products.controller.ts` and the channel breakdown (already part of `sales-analytics-response.dto.ts`) since both render currency-denominated figures from the same request.

### Acceptance Criteria

- [ ] `class-validator` decorators enforce ISO-4217 + `SUPPORTED_REPORTING_CURRENCIES` membership on `displayCurrency` (400 on violation).
- [ ] Omitting `displayCurrency` is behaviourally identical to pre-Phase-2 responses (regression guard).
- [ ] Controller spec (`sales-analytics.controller.spec.ts`) covers the new params for both `rateBasis` values.
- [ ] Tests added/updated.
