# [MINI-EPIC] Phase 3 — Backend: Analytics Settings persistence

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Depends on: Phase 2, Phase 1 Task 1.3
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` — state `settings-open` (the two `.settings-section` blocks: "Currency — recalculation" and "Tax rates")

## Scope

Persist three operator settings behind one dialog: the display currency + rate-basis mode (Phase 2's parameters — a per-viewer preference), and the tax-rate inclusion toggle from Phase 1 Task 1.3 (`includeGuessedVatRatesInNetSales` or its renamed equivalent — an org-wide policy flag). One settings table, one dialog, three fields — mirroring the existing `reporting_currency_setting` singleton-row pattern (`docs/architecture-overview.md § 18. Currency`) and the `ai_provider_active_setting` precedent it's explicitly modelled on. **None of these three fields is the reporting currency itself, and none mutates any `order_records` row** — they are read-time preferences layered on top.

## Branching

Branch `phase/2XXX-p3-settings-persistence` off the epic branch.

## Dependencies

- Phase 2 (the currency read model this setting parameterizes).
- Phase 1 Task 1.3 (the tax-inclusion setting's ADR-063 addendum must be merged first — this phase implements its persistence).

## Acceptance Criteria (mini-epic level)

- [ ] `GET /analytics/settings` and `PUT /analytics/settings` exist, `@UseGuards(JwtAuthGuard)`, `@Roles('admin')` on the write per existing settings-endpoint precedent (`AiProviderSettingsController`).
- [ ] `/analytics` defaults to the persisted display currency on load (mockup default = reporting currency, i.e. no override row exists yet); the tax-inclusion toggle defaults OFF per Phase 1 Task 1.3.
- [ ] A migration exists for the new settings table/columns and `pnpm --filter @openlinker/api migration:show` reports no pending migrations after this phase merges.

---

## Task 3.1 — `analytics_display_settings` singleton table + migration

### Problem / Context

No existing table holds a per-deployment analytics display preference or the tax-inclusion policy flag. `reporting_currency_setting` (singleton, `id = 'singleton'`) is the closest precedent and is explicitly NOT to be touched or repurposed (it is a different concern — the *stamped* reporting currency, not a *display* override).

### Proposed Solution

New table `analytics_display_settings` (`id = 'singleton'` PK, matching the `reporting_currency_setting` / `ai_provider_active_setting` shape): `displayCurrency: string | null` (null = "use reporting currency," the mockup's `native` state), `rateBasis: 'current' | 'order-date'` default `'current'`, `includeGuessedVatRatesInNetSales: boolean` default `false` (name to be finalized country-agnostic per Phase 1 Task 1.3's assumption — e.g. `includeBackfilledTaxRatesInNetSales`), `updatedAt`, `updatedByUserId`. Follow `docs/migrations.md` workflow (`/migrate`) — generate via `pnpm --filter @openlinker/api migration:generate`.

### Classification

**Type**: CORE
**Layer**: Infrastructure (persistence) + Domain (port + entity)
**File(s)**: new `libs/core/src/orders/domain/entities/analytics-display-settings.entity.ts` (or a dedicated small context if reviewers prefer not to grow `orders` further — flag in PR description, don't decide silently), matching ORM entity + repository + migration under `apps/api/src/migrations/`

### Dependencies

None beyond Phase 2's read model and Phase 1 Task 1.3 existing to parameterize.

### Assumptions

- Placed under the `orders` context by default (closest existing owner of analytics reads); open to being its own thin context if review pushes back — this is exactly the kind of judgment call `docs/architecture-overview.md` says to make explicitly and justify, not silently invent.

### Acceptance Criteria

- [ ] Migration generated, applied, and reverts cleanly (`migration:run` / `migration:revert` round-trip).
- [ ] `pnpm --filter @openlinker/api migration:show` shows no pending migrations.
- [ ] Repository follows the ORM ↔ domain mapping rule (`docs/engineering-standards.md § ORM ↔ Domain Mapping`) — no ORM entity leaks past the repository.
- [ ] Tests added.

---

## Task 3.2 — `GET/PUT /analytics/settings` endpoints

### Problem / Context

Frontend (Phase 6) needs a settings read/write surface backing the mockup's Settings dialog (state `settings-open`), for all three fields — currency, rate basis, and tax-rate inclusion.

### Proposed Solution

`AnalyticsSettingsController` in `apps/api/src/analytics/http/`, mirroring `AiProviderSettingsController`'s shape (`GET` returns current value + resolution source the way `ReportingCurrencySettingsView.source` does — `setting | default` — so the FE can show "not yet configured, using reporting currency" honestly instead of asserting a false default). `PUT` validates `displayCurrency` against the same `SUPPORTED_REPORTING_CURRENCIES` gate Phase 2 Task 2.2 uses (reuse the validator, don't fork it); `includeGuessedVatRatesInNetSales` needs no validation beyond boolean coercion, since it's a policy flag, not an identifier.

### Classification

**Type**: Interface (HTTP)
**Layer**: Interface + Application
**File(s)**: `apps/api/src/analytics/http/analytics-settings.controller.ts` (+ `.spec.ts`), `apps/api/src/analytics/analytics.module.ts` (wire the new controller + service)

### Dependencies

- Task 3.1.

### Assumptions

- Only an admin can change the org-wide defaults (`@Roles('admin')`, matching `AiProviderSettingsController`'s `PUT /keys/:provider` / `PUT /active`); any authenticated user can read them so `/analytics` can render correctly for every viewer. The tax-inclusion flag in particular is a financial-reporting policy decision — admin-only is deliberate, not incidental.

### Acceptance Criteria

- [ ] `PUT` rejects an unsupported currency with the same 422 shape Phase 2 Task 2.2 / the `currency` context's coverage-advisory validation uses (consistency — one validation error shape across the feature).
- [ ] `GET` response distinguishes "explicitly set" vs "defaulting to reporting currency" (mirrors `ReportingCurrencySettingsView.source`), so Phase 6's Settings dialog can render the mockup's default state honestly.
- [ ] Toggling `includeGuessedVatRatesInNetSales` never touches `order_records` — a controller/service test asserts no `order_records` write occurs on this endpoint (regression guard for Phase 1 Task 1.3's core invariant).
- [ ] Controller spec covers all three fields, admin-only write, and the validation-rejection path.
- [ ] Tests added.
