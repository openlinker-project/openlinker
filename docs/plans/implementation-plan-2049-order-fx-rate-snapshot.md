# Implementation Plan: Order-time FX rate snapshot + base-currency stamping

**Date**: 2026-08-13
**Status**: Ready for Review
**Issue**: #2049
**ADR**: [ADR-040](../architecture/adrs/040-order-time-fx-stamping-connection-derived-base-currency.md)
**Estimated Effort**: 3–4 days (BE ~2.5 d, FE ~0.5 d, tests ~1 d)

---

## 1. Task Summary

**Objective**: At ingestion time, stamp every order with the amount it represents in a *base
currency*, together with an immutable reference to the exchange rate used — so analytics can report
one figure per period instead of an un-summable pile of per-currency totals.

**Context**: [ADR-039](../architecture/adrs/039-order-analytics-read-model-persistence-strategy.md)
(#1985) denormalizes the order's **native** `currency` + `totalAmount`. That answers "how much did
we sell in EUR"; it cannot answer "how much did we sell". Converting at read time would produce a
different number every time the rate moves, which is the exact failure ADR-039 set out to eliminate.
The conversion therefore has to be pinned at ingestion, against the rate that applied on the day the
buyer paid, and never recomputed.

The base currency is derived from the order's **source connection** — there is no global settlement
setting, and adding one was explicitly rejected. See [ADR-040](../architecture/adrs/040-order-time-fx-stamping-connection-derived-base-currency.md)
for that decision and its alternatives.

**Classification**: CORE (new bounded context + orders integration), with a thin Frontend slice and
one Infrastructure migration.

---

## 2. Scope & Non-Goals

### In Scope

- New leaf core context `libs/core/src/currency/` — rate registry, providers, rule → rate-date
  derivation.
- `exchange_rates` table (shared, immutable, get-or-create).
- Four nullable columns on `order_records` + the narrow stamp-once write path.
- Base-currency resolution ladder in the `orders` context.
- `NbpExchangeRateProvider` with pivot-based cross-rates and non-publication-day walk-back.
- A backfill sync job for orders that could not be stamped inline.
- Optional ISO-4217 currency field on the Erli / WooCommerce / Allegro connection setup forms.
- One TypeORM migration.

### Out of Scope

- **Backfilling historical orders.** Pre-existing rows keep `baseCurrency IS NULL`. Restating
  already-reported figures is a separate decision (ADR-040 § Migration path).
- **The analytics queries themselves** (#1987 / #1988). This ships the columns they read.
- **A second rate rule or a second provider.** The rule is persisted and the provider interface
  carries `pivotCurrency` so both are additive later; neither is built now.
- **A UI for `Connection.config.fx`.** Same posture as `stockSafetyBuffer` / `pricingRule` today —
  JSONB, no editor yet.
- **Caching the resolved base currency.** See § 5 Assumptions.
- **Line-item-level conversion.** Only the order total is stamped; `order_line_items` (#1985) keeps
  native prices.

### Constraints

- One issue → one branch → one PR (repo convention).
- Local quality gate is `pnpm lint` + `pnpm type-check` only.
- Must not break, or depend on merging, the unmerged #1985 branch — see § 8 Risks.

---

## 3. Architecture Mapping

**Target layer**: CORE (`libs/core/src/currency/` — new; `libs/core/src/orders/` — extended),
Infrastructure (migration), Interface (FE setup schemas), App (`apps/worker` job handler).

**Capabilities involved**: none. This deliberately introduces **no capability port** — an exchange
rate is not a per-connection integration capability, it is a shared read of a public reference
source. `ExchangeRateProviderPort` is an intra-context port with in-context implementations,
resolved by a `Map`, not by `getCapabilityAdapter`.

**Existing services reused**:

| Service / helper | Used for |
|---|---|
| `IIntegrationsService` (`@openlinker/core/integrations`) | reading `Connection.config` for the ladder + the `fx` override |
| `OrderRecordRepositoryPort` | the dominant-currency read and the narrow stamp write |
| `SyncJobQueuePort` / the worker handler pattern | the backfill job |
| `Logger` (`@openlinker/shared/logging`) | warn-on-degrade |
| `readStockSafetyBuffer` / `parseTriggerModel` | the pure config-coercion **pattern** for `config.fx` |
| `IdentifierMappingService.getOrCreateInternalId` | the `ON CONFLICT DO NOTHING` + re-select **pattern** |

**New components required**: see § 6.

**Core vs Integration justification**: this cannot live in an integration package. The rate registry
is shared across every connection (that is the whole point of keying rows by
`(source, pair, date)` rather than per order), the base-currency ladder reads OL's own order
history, and the stamp is written onto a core table. No marketplace is involved and no
platform-specific vocabulary crosses the boundary — the provider speaks ISO-4217 codes and dates.

**Cross-context dependency direction** (`docs/architecture-overview.md` § Cross-context
dependencies):

```
orders ──▶ currency        (new edge: ICurrencyRateService + Symbol token, from the barrel)
orders ──▶ integrations    (already exists)
currency ──▶ (nothing)     ← leaf
```

`currency` is kept a **leaf** on purpose: the caller resolves the rule and the source from the
connection and passes them down as plain values, so `currency` never needs `integrations`, and the
`orders → currency → orders` cycle that a naive "resolve everything inside currency" design would
create never appears.

---

## 4. External / Domain Research

### NBP Web API

- **Base**: `https://api.nbp.pl/api/exchangerates/rates/a/{code}/{date}/?format=json` (table A =
  average rates, the statutory reference for PL tax purposes).
- **Authentication**: none. Public, unauthenticated.
- **Rate limits**: no published quota. Volume here is ~1 request per currency per day at most
  (the registry absorbs everything else), so throttling is a non-issue.
- **Response**: `{ table, currency, code, rates: [{ no, effectiveDate, mid }] }` — `no` is the table
  number (`158/A/NBP/2026`) persisted as `sourceRef`, `effectiveDate` is the **actual** rate date,
  `mid` is the rate.
- **Direction**: NBP quotes `X → PLN` only. A `PLN → X` request inverts; an `X → Y` request divides
  two `X → PLN` reads (the pivot).
- **Known pitfall — 404 on non-publication days**: NBP publishes on Polish business days only.
  A request for a Saturday, a Sunday, or a public holiday returns `404 NotFound`, **not** an empty
  result. The provider walks backwards day by day (bounded at 7 iterations — the longest Polish
  holiday cluster comfortably fits) and persists the `effectiveDate` the API actually answered with.
- **Known pitfall — same-day publication window**: today's table appears around 12:00 CET. Since the
  only shipped rule is `prev-business-day`, this is not hit today; a future `same-day` rule must
  handle it.

### Internal patterns found

- **Denormalized order columns**: `dispatchByAt` (#927) and `fulfillmentState` (#1108) already set
  the precedent for "project a scalar out of the snapshot onto an indexed column at write time".
  #1985 extends it with four more. The FX triple joins that group.
- **Narrow absolute-set writes**: `OrderRecordRepository.updateFulfillmentState` and
  `.updateItemResolutionFailure` both write a single-column `UPDATE` specifically so they cannot
  race a concurrent write to another column on the same row. The stamp write copies this shape and
  adds a guard predicate.
- **Money columns**: `products.price`, `product_variants.price`, and #1985's `totalAmount` all use
  `decimal` with an explicit `Number()` in `toDomain`. `baseTotalAmount` follows; the **rate** does
  not (see § 6 Implementation details).
- **Config coercion**: `readStockSafetyBuffer` (`libs/core/src/identifier-mapping/domain/types/stock-safety-buffer.types.ts`)
  is the reference shape — a pure function, defensive coercion, a documented default, and a
  companion "is present but invalid" reporter.
- **Existing currency knowledge**: `Connection.config.currency` is read at
  `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts:116`, falling back to
  `PrestashopShopCurrencyResolver`. The FE writes it at `prestashop-setup.schema.ts:69` /
  `:107`. Nothing else in the repo defines a "our currency" concept.

---

## 5. Questions & Assumptions

### Open questions

1. **Backfill of historical orders** — deliberately deferred, but someone will ask for it the first
   time they open the analytics page. The rate data is retrievable, so the job is mechanical; the
   question is whether restating past periods is acceptable. Flag to the product owner before
   #1987 ships.
2. **`fxRule` on a re-ingested order whose rule changed** — the stamp is immutable, so an order
   stamped under `prev-business-day` keeps that rule forever even if the connection later switches.
   That is intended (it is why the field exists), but it means a connection can carry two rule eras.
   No action; documented in ADR-040 § Consequences.

### Assumptions

- **NBP is the only provider shipped.** The requirement is PLN reporting, and the Polish statutory
  rate is the NBP mid rate. The interface carries `pivotCurrency` so ECB or another source is
  additive.
- **`prev-business-day` is the only rule shipped**, defaulting for every connection.
- **No cache on the resolved base currency.** ADR-039 documents this persona at 10–100 orders/day,
  so the ladder's step-2 aggregate runs at most ~100×/day against an indexed column. A cache would
  buy nothing measurable and would add an invalidation path on connection edit — a real staleness
  bug for a hypothetical gain. Revisit with numbers.
- **The stamp attempt runs inline during ingestion.** After the first order of the day for a given
  pair the rate is a local primary-key read, not an HTTP call, so the hot path is bounded. The
  fallback job exists for the first-order-of-the-day-while-NBP-is-down case.
- **`baseTotalAmount` is derived from `totals.total` only** — the buyer-paid grand total. Per-line
  conversion is out of scope.

### Documentation gaps

- `docs/architecture-overview.md` has no Currency bounded context section. Add one in this PR
  (§ 6, Phase 5) alongside the ADR link, and extend the cross-context dependency mermaid graph with
  the `orders → currency` edge.

### Deviation from the source design sketch

The original sketch stored a full `fxStamp` object inside `orderSnapshot` (JSONB) for audit.
**Dropped**, because `persistOrder` rewrites `orderSnapshot` wholesale on every re-ingestion — a
stamp stored there would silently disappear on the next re-poll, contradicting the immutability the
whole feature rests on. The audit trail is preserved instead by the `exchangeRateId` join
(`rate`, `rateDate`, `source`, `sourceRef`) plus the `fxRule` column, which is strictly more durable
and one fewer place to keep in sync.

---

## 6. Proposed Implementation Plan

### Phase 1 — The `currency` context (leaf, no dependencies)

**Goal**: a self-contained, unit-testable rate registry that answers "what was the rate for this
pair under this rule on this date".

1. **Domain types + rule derivation**
   - **Files**: `libs/core/src/currency/domain/types/exchange-rate.types.ts`,
     `libs/core/src/currency/domain/types/fx-rate-rule.types.ts`
   - **Action**: define `FX_RATE_RULES = ['prev-business-day'] as const` + `FxRateRule`;
     `EXCHANGE_RATE_SOURCES = ['nbp'] as const` + `ExchangeRateSource`; the `ExchangeRate` shape
     (`from`, `to`, `rate: string`, `rateDate: string`, `source`, `sourceRef: string | null`);
     and `GetRateInput` (`from`, `to`, `placedAt`, `rule`, `source`).
   - **Acceptance**: `as const` + derived-union pattern per engineering standards; no `enum`.

2. **`resolveRateDate` — pure**
   - **File**: `libs/core/src/currency/domain/rate-date-resolution.ts` (+ `.spec.ts`)
   - **Action**: `resolveRateDate(placedAt: Date, rule: FxRateRule, tz = 'Europe/Warsaw'): string`
     → an ISO `YYYY-MM-DD`. Converts `placedAt` into the target timezone's calendar day first
     (`Intl.DateTimeFormat` with `timeZone`, no new dependency), then steps back to the previous
     Mon–Fri. **Weekday-only**; Polish public holidays are handled by the provider's walk-back, not
     by a hard-coded calendar that would rot.
   - **Acceptance**: covered for mid-week, Monday → Friday, and a 00:30 UTC order that is the next
     calendar day in Warsaw.
   - **Dependencies**: step 1.

3. **Provider port + NBP provider**
   - **Files**: `libs/core/src/currency/domain/ports/exchange-rate-provider.port.ts`,
     `libs/core/src/currency/infrastructure/providers/nbp-exchange-rate.provider.ts` (+ `.spec.ts`)
   - **Action**: the port declares `readonly name: ExchangeRateSource`,
     `readonly pivotCurrency: CurrencyCode | null`, and
     `fetchRate({ from, to, on }): Promise<ExchangeRate>`. The NBP provider fetches
     `.../rates/a/{code}/{date}/` with the shared `fetch`-based client convention, walks back up to
     7 days on 404, inverts for `PLN → X`, and divides two pivot reads for `X → Y`. It persists the
     `effectiveDate` returned by the API. Rate arithmetic uses string-safe decimal handling — never
     accumulate in `number`.
   - **Acceptance**: unit-tested against a faked HTTP client for the direct, inverted, cross-rate,
     404-walk-back, and exhausted-walk-back (throws `RateNotAvailableError`) paths.

4. **Registry: ORM entity, port, repository**
   - **Files**: `libs/core/src/currency/infrastructure/persistence/entities/exchange-rate.orm-entity.ts`,
     `libs/core/src/currency/domain/ports/exchange-rate-repository.port.ts`,
     `libs/core/src/currency/infrastructure/persistence/repositories/exchange-rate.repository.ts`
     (+ `.spec.ts`)
   - **Action**: entity per § Implementation details below. The repository exposes
     `findByKey(...)` and `insertIfAbsent(...)`; the latter uses
     `.orIgnore()` (`ON CONFLICT DO NOTHING`) and converts a unique violation into the domain
     `DuplicateExchangeRateError`, mirroring `DuplicateIdentifierMappingError`.
   - **Acceptance**: two concurrent `insertIfAbsent` calls for one key resolve to a single row and
     neither throws.

5. **`CurrencyRateService`**
   - **Files**: `libs/core/src/currency/application/interfaces/currency-rate.service.interface.ts`,
     `libs/core/src/currency/application/services/currency-rate.service.ts` (+ `.spec.ts`)
   - **Action**: `getRateFor(input: GetRateInput): Promise<ExchangeRate & { id: string }>` —
     identity short-circuit when `from === to`; `resolveRateDate`; registry read; on miss, provider
     fetch then `insertIfAbsent` + re-select (get-or-create).
   - **Acceptance**: a second call for the same key performs **no** provider fetch.

6. **Module + tokens + barrel**
   - **Files**: `libs/core/src/currency/currency.module.ts`, `currency.tokens.ts`, `index.ts`,
     and the `exports` entry in `libs/core/package.json`
   - **Action**: providers registered into a `ReadonlyMap<ExchangeRateSource,
     ExchangeRateProviderPort>` via `useFactory`. `currency.tokens.ts` contains **only** Symbol
     declarations; `index.ts` does `export * from './currency.tokens'` (per the Symbol re-export
     convention). Add `@openlinker/core/currency` to package exports.
   - **Acceptance**: `pnpm check:invariants` passes — no sibling-context import from
     `libs/core/src/currency/**`.

### Phase 2 — Persistence

7. **Order-record columns**
   - **Files**: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`,
     `libs/core/src/orders/domain/entities/order-record.entity.ts`
   - **Action**: add the four columns (§ Implementation details) to the ORM entity and the four
     matching trailing optional constructor params to the domain entity.
   - **Acceptance**: `toOrm` does **not** write them (see step 8); `toDomain` hydrates them,
     `Number()`-ing `baseTotalAmount` per the house convention.

8. **Stamp-once repository method**
   - **Files**: `libs/core/src/orders/domain/ports/order-record-repository.port.ts`,
     `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
     (+ `.spec.ts`)
   - **Action**: add `stampFxIfAbsent(internalOrderId, stamp): Promise<boolean>` — a single
     `UPDATE … SET base_currency = …, base_total_amount = …, exchange_rate_id = …, fx_rule = …
     WHERE internal_order_id = $1 AND base_currency IS NULL`, returning whether a row was affected.
     Also add `findDominantBaseCurrency(sourceConnectionId): Promise<string | null>`
     (`GROUP BY base_currency ORDER BY count(*) DESC LIMIT 1`, `base_currency IS NOT NULL`).
     **Leave `toOrm` untouched** so the upsert path can never clobber a stamp.
   - **Acceptance**: calling `stampFxIfAbsent` twice with different values leaves the first write in
     place and returns `false` the second time.
   - **Dependencies**: step 7.

9. **Migration**
   - **File**: `apps/api/src/migrations/1833000000000-add-order-fx-stamp.ts`
   - **Action**: create `exchange_rates` (+ its unique index) and add the four `order_records`
     columns (+ the `base_currency` index). `up()` and `down()` both implemented; DDL guarded with
     `IF NOT EXISTS` / `IF EXISTS`.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists it; the 13-digit prefix
     sorts after every migration on `main` **and** after #1985's `1832000000008`; the class suffix
     matches the filename (`scripts/check-migration-timestamps.mjs`).

### Phase 3 — Orders integration

10. **`config.fx` coercion helper**
    - **File**: `libs/core/src/identifier-mapping/domain/types/fx-config.types.ts` (+ `.spec.ts`)
    - **Action**: `FX_CONFIG_KEY = 'fx'`; `readFxConfig(config): { rule: FxRateRule; source:
      ExchangeRateSource }` defaulting to `{ rule: 'prev-business-day', source: 'nbp' }`, coercing
      any missing/malformed/unknown value back to the default. Placed beside
      `stock-safety-buffer.types.ts` because that is where `ConnectionConfig` coercion helpers live.
    - **Acceptance**: exhaustive coercion table in the spec.

11. **Base-currency resolver**
    - **Files**: `libs/core/src/orders/application/services/order-base-currency.resolver.ts`
      (+ `.spec.ts`)
    - **Action**: `resolve(sourceConnectionId): Promise<string | null>` implementing the ladder —
      `Connection.config.currency` (normalised + validated as ISO-4217) → `findDominantBaseCurrency`
      → `null`.
    - **Acceptance**: each rung covered, including a malformed `config.currency` falling through to
      rung 2 rather than throwing.
    - **Dependencies**: steps 8, 10.

12. **The stamp itself**
    - **Files**: `libs/core/src/orders/application/services/order-fx-stamp.service.ts`
      (+ interface + `.spec.ts`), called from
      `libs/core/src/orders/application/services/order-record.service.ts` (`persistOrder`, after the
      upsert)
    - **Action**: resolve the base (falling back to the order's own currency when `null`); when it
      equals `order.totals.currency`, stamp `{ baseCurrency, baseTotalAmount: totals.total,
      exchangeRateId: null, fxRule }` with **no** rate lookup; otherwise call `ICurrencyRateService`,
      compute `round2(total × rate)`, and stamp. Wrap the whole thing in `try/catch`: on any failure
      log `warn` with `{ internalOrderId, from, to }` and enqueue the backfill job. `persistOrder`
      must return successfully regardless.
    - **Acceptance**: a throwing rate service leaves the order persisted and unstamped and does not
      propagate; the equal-currency path asserts the rate service was never called.
    - **Dependencies**: steps 5, 8, 11.

13. **Backfill job**
    - **Files**: `libs/core/src/sync/domain/types/sync-job.types.ts` (add `'order.fx.stamp'` to
      `JobTypeValues`), a payload type in
      `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts`, and a handler under
      `apps/worker/src/orders/` (+ `.spec.ts`)
    - **Action**: the handler re-invokes `OrderFxStampService` for one `internalOrderId`. Idempotent
      by construction — `stampFxIfAbsent` no-ops on an already-stamped row. Returns
      `outcome: 'ok'` on success and on already-stamped; a still-unavailable rate is a retryable
      throw, not a `business_failure` ([ADR-007](../architecture/adrs/007-syncjob-status-vs-outcome-split.md)).
    - **Acceptance**: enqueued with a dedupe key of the order id so repeated failures collapse.

### Phase 4 — Frontend

14. **Currency field on the remaining setup forms**
    - **Files**: `apps/web/src/features/connections/components/erli-setup.schema.ts`,
      `woocommerce-setup.schema.ts`, their matching `*-setup-form.tsx`, and the Allegro setup path
      (+ `.test.ts` updates)
    - **Action**: copy the PrestaShop field verbatim — the `z.union([trimmed-uppercased-regex,
      z.literal('')]).optional()` shape and the `if (values.currency…) config.currency = …` guard in
      `toCreateConnectionInput`, so a blank value omits the key entirely.
    - **Acceptance**: submitting blank produces a `config` without a `currency` key; submitting
      `eur` persists `EUR`.

### Phase 5 — Documentation

15. **Architecture overview**
    - **File**: `docs/architecture-overview.md`
    - **Action**: add a **Currency** bounded-context section (responsibility, key entity, location,
      the ladder, the immutability rule, the ADR link) and add the `orders → currency` edge to the
      cross-context dependency mermaid graph.
    - **Acceptance**: the graph and the § Cross-context contract surface stay consistent with what
      the code imports.

### Implementation details

**`exchange_rates`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | generated |
| `source` | `varchar` | `'nbp'` |
| `fromCurrency` / `toCurrency` | `varchar(3)` | ISO-4217 |
| `rateDate` | `date` | the rate's own date, as reported by the source |
| `rate` | `numeric(18,8)` | **`string` in TS** — nothing computes on it in JS beyond one multiply |
| `sourceRef` | `text` nullable | e.g. `158/A/NBP/2026` |
| `fetchedAt` | `timestamptz` | `@CreateDateColumn` |

Unique: `(source, fromCurrency, toCurrency, rateDate)`.

**`order_records` additions**

| Column | Type | Indexed |
|---|---|---|
| `baseCurrency` | `varchar(3)` nullable | yes |
| `baseTotalAmount` | `decimal(12,2)` nullable → `number \| null` in TS | no |
| `exchangeRateId` | `uuid` nullable | no |
| `fxRule` | `varchar` nullable | no |

`baseTotalAmount` is `decimal` + `Number()` in `toDomain` to match `products.price` and #1985's
`totalAmount`; the **rate** stays a `string` because that is where precision actually matters.
`exchangeRateId` is a plain column, not a TypeORM relation — `order_records` already avoids
relations, and the join is only ever made by an analytics query.

**Configuration**: no new environment variables. Two JSONB keys on `Connection.config`:
`currency` (already exists) and `fx` (new, optional).

**Events**: none emitted, none consumed.

**Error handling**: `RateNotAvailableError`, `DuplicateExchangeRateError` (both under
`libs/core/src/currency/domain/exceptions/`). The repository converts the unique violation; the
service converts a provider exhaustion. Neither escapes to the ingestion caller — `OrderFxStampService`
swallows both, warns, and enqueues.

---

## 7. Alternatives Considered

Fully argued in [ADR-040](../architecture/adrs/040-order-time-fx-stamping-connection-derived-base-currency.md);
summarised here.

### Alternative 1: a global settlement-currency setting
A singleton row mirroring `ai_provider_active_setting`. **Rejected** by the operator: it forces a
deployment-wide answer to a question a single-currency estate never has to ask, and analytics
silently breaks when the setup step is skipped. The connection-derived ladder reaches the same
outcome with zero configuration.

### Alternative 2: base = the DESTINATION connection's currency
**Rejected**: analytics reports what the buyer paid on a channel, not what the fulfilling shop
booked; and an order fanned out to two destinations would have two bases.

### Alternative 3: convert at read time in the analytics query
**Rejected**: the reported figure would move whenever the rate did — the exact "quietly wrong
number" failure ADR-039 exists to prevent.

### Alternative 4: one rate row per order
**Rejected**: multiplies identical rows by order volume and turns "which rate did we use on
3 August" into a `DISTINCT` scan instead of a key read.

### Alternative 5: stamp via the existing `persistOrder` upsert
**Rejected**: `toOrm` writes every column, so each re-ingestion would recompute and overwrite the
stamp — the opposite of the immutability requirement. (Worth noting: `fulfillmentState` already has
this shape and *is* reset to `null` by a re-poll. Pre-existing, out of scope here, but it is the
concrete reason this feature does not join that write path.)

---

## 8. Validation & Risks

### Architecture compliance

- ✅ Hexagonal layering — domain (types, ports, pure rule derivation) → application (services) →
  infrastructure (providers, repositories); no framework import in `domain/`.
- ✅ CORE ↔ Integration boundary — no plugin package touched; no capability port added; no
  `platformType` branching anywhere.
- ✅ Cross-context contract — `orders` imports only `ICurrencyRateService` + a Symbol token from
  `@openlinker/core/currency`; `currency` imports nothing from siblings.
- ✅ Symbol-token convention — `currency.tokens.ts` is Symbol-only, star-exported from the barrel.
- ✅ Service-interface rule — every `application/services/*.service.ts` has its interface file.

### Naming conventions

- ✅ `*.types.ts`, `*.port.ts`, `*.orm-entity.ts`, `*.repository.ts`, `*.service.ts` +
  `*.service.interface.ts`, `*.spec.ts`.
- ⚠️ `nbp-exchange-rate.provider.ts` uses a `*.provider.ts` suffix, which is **not** in the
  standards' file-suffix table. `*.adapter.ts` is the documented name for "implements a port", but
  it is strongly associated with the plugin/capability system this change deliberately avoids, and
  the class would read `NbpExchangeRateAdapter` — inviting exactly the "why isn't this a plugin?"
  confusion ADR-040 rules out. Flagged for reviewer preference; renaming is mechanical.

### Risks

- **Collision with the unmerged #1985.** Both add columns to `order-record.orm-entity.ts`,
  trailing params to the `OrderRecord` constructor, and a migration in the same range. *Mitigation*:
  additive changes, appended at the end of both lists; whichever merges second rebases. The
  migration here is pinned to `1833000000000` so it sorts after #1985's `1832000000008` regardless
  of merge order.
- **Ingestion latency on the first foreign-currency order of a day.** One NBP round trip (plus up to
  7 on a long holiday weekend) inside `persistOrder`. *Mitigation*: bounded walk-back, a hard
  timeout on the HTTP client, and the try/catch + backfill path — a slow or dead NBP degrades to an
  unstamped order, never a failed ingestion.
- **Rounding.** `round2(total × rate)` is half-up on a `number` multiply. At realistic order
  magnitudes this is exact to the cent; at extreme magnitudes it is not. *Mitigation*: the rate is
  stored at full precision, so any figure can be recomputed exactly from the join if a discrepancy
  is ever reported.
- **The dominant-currency rung shifting.** A connection's dominant currency can change as history
  accumulates, producing two base-currency eras. *Mitigation*: already-written stamps are never
  recomputed; setting `config.currency` pins it; documented in ADR-040.

### Edge cases

| Case | Handling |
|---|---|
| `from === to` | identity short-circuit in `CurrencyRateService`, no registry row |
| Connection has no order history and no `config.currency` | base = the order's own currency, no conversion |
| Order placed 00:30 UTC | resolved in `Europe/Warsaw`, so the *next* calendar day's previous business day |
| Monday order | rate date = Friday |
| Friday order on a holiday-shortened week | walk-back finds the last published table; the actual `effectiveDate` is persisted |
| NBP down | order persisted unstamped, warn, backfill enqueued |
| Two workers ingesting concurrently | `insertIfAbsent` collapses to one rate row; `stampFxIfAbsent` guard means the second stamp no-ops |
| `totals.total === 0` | stamped as `0` in the base currency; no special case |
| Order re-ingested after a rate change | stamp untouched (`base_currency IS NULL` guard fails) |

### Backward compatibility

- ✅ All four columns nullable; `exchange_rates` is new. No existing read changes shape.
- ✅ Pre-existing orders keep `baseCurrency IS NULL`; analytics consumers must treat `NULL` as
  "not stamped", not as zero.
- ✅ Connections without `config.currency` behave exactly as today until their first order.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests

| Subject | File |
|---|---|
| `resolveRateDate` (mid-week / Monday / TZ boundary) | `libs/core/src/currency/domain/rate-date-resolution.spec.ts` |
| NBP provider (direct / inverted / cross / 404 walk-back / exhausted) | `.../infrastructure/providers/nbp-exchange-rate.provider.spec.ts` |
| `CurrencyRateService` (identity, registry hit, get-or-create, concurrent duplicate) | `.../application/services/currency-rate.service.spec.ts` |
| `ExchangeRateRepository.insertIfAbsent` (unique-violation → domain error) | `.../repositories/exchange-rate.repository.spec.ts` |
| `readFxConfig` coercion table | `libs/core/src/identifier-mapping/domain/types/fx-config.types.spec.ts` |
| Base-currency ladder (all three rungs + malformed config) | `libs/core/src/orders/application/services/order-base-currency.resolver.spec.ts` |
| `OrderFxStampService` (equal-currency no-I/O, converting, provider-failure degrade) | `.../services/order-fx-stamp.service.spec.ts` |
| `stampFxIfAbsent` guard + `findDominantBaseCurrency` | `.../repositories/order-record.repository.spec.ts` |
| Backfill handler (stamps, no-ops when stamped, retryable throw) | `apps/worker/src/orders/__tests__/order-fx-stamp.handler.spec.ts` |
| FE schemas (blank omits key, lowercase normalises) | `apps/web/src/features/connections/components/{erli,woocommerce}-setup.schema.test.ts` |

### Integration tests

`apps/api/test/integration/orders/order-fx-stamp.int-spec.ts` — one vertical slice on the real
Postgres harness with a **faked provider** (never a live NBP call in CI):

1. Ingest a same-currency order → stamped, `exchangeRateId IS NULL`, provider never called.
2. Ingest a foreign-currency order → stamped, one `exchange_rates` row created.
3. Ingest a **second** foreign-currency order, same day and pair → still one rate row.
4. Re-ingest order 2 with the provider now returning a different rate → all four columns unchanged.

Add `exchange_rates` to `tablesToTruncate` in the integration harness.

### Mocking strategy

- Mock `ExchangeRateProviderPort` (the port) — never the concrete NBP class, and never a live HTTP
  call in any test tier.
- Mock `IIntegrationsService` for the ladder's rung 1.
- Real Postgres in the int-spec; everything else mocked per the testing guide.

### Acceptance criteria

Mirrors #2049's checklist — see the issue.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no plugin package, no capability port)
- [x] Uses existing patterns (denormalized columns, narrow absolute-set writes, get-or-create,
      config coercion) — no new abstraction introduced
- [x] Idempotency considered (`stampFxIfAbsent` guard, `insertIfAbsent`, idempotent backfill job)
- [x] Event-driven patterns used where applicable (none apply; the backfill uses the existing job
      queue)
- [x] Rate limits & retries addressed (bounded walk-back, HTTP timeout, degrade-to-job)
- [x] Error handling comprehensive (two domain exceptions, neither escapes ingestion)
- [x] Testing strategy complete (unit + one int-spec vertical slice, no live HTTP)
- [x] Naming conventions followed (one flagged deviation, § 8)
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as a markdown file

---

## Related Documentation

- [ADR-040 — Order-time FX stamping against a connection-derived base currency](../architecture/adrs/040-order-time-fx-stamping-connection-derived-base-currency.md)
- [ADR-039 — Order analytics read model](../architecture/adrs/039-order-analytics-read-model-persistence-strategy.md) (unmerged, #1985)
- [ADR-007 — SyncJob status vs outcome split](../architecture/adrs/007-syncjob-status-vs-outcome-split.md)
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Database Migrations](../migrations.md)
