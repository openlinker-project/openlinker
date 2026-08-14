# Implementation Plan: Order-time FX rate snapshot + reporting-currency stamping

**Date**: 2026-08-13
**Status**: Ready for Review (two items unresolved — see § 5 and § 10)
**Issue**: #2049
**ADR**: [ADR-040](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md)
**Estimated Effort**: 4–5 days (BE ~2.5 d, FE + Allegro OAuth thread ~1 d, tests ~1.5 d), ~30–35 files
touched. For calibration: `implementation-plan-846-shipment-read-command-api.md:5` sizes "M (3–7 days)"
for ~17 new files with no external provider and no decimal arithmetic; this has both, plus a migration,
plus a new package-exports subpath.

---

## 1. Task Summary

**Objective**: At ingestion time, stamp every order with the amount it represents in a **reporting
currency**, together with an immutable reference to the exchange rate used — so analytics can report
one figure per period per reporting currency instead of an un-summable pile of per-currency totals.

**Context**: the order analytics read model (#1985) denormalizes the order's **native** `currency` +
`totalAmount`. That answers "how much did we sell in EUR"; it cannot answer "how much did we sell".
Converting at read time would produce a different number every time the rate moves, which is the exact
failure #1985 set out to eliminate. The conversion therefore has to be pinned at ingestion, against the
rate that applied on the day the buyer paid, and never recomputed.

**On the name**: this plan says *reporting* currency, never *base* currency. In FX the **base** currency
of a pair is the one being priced — what this plan stores as `exchange_rates.fromCurrency`, i.e. the
order's own currency. A column called `baseTotalAmount` therefore reads to an accountant as *the native
total*, the exact opposite of its meaning. `docs/specs/product-spec-1976-analytics.md:267` already
uses "reporting currency" for this concept. The issue text (#2049) was written with `base*`; every
occurrence maps 1:1 onto `reporting*` here.

The reporting currency is derived from the order's **source connection** — there is no global settlement
setting, and adding one was explicitly rejected. See
[ADR-040](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md)
for that decision and its alternatives.

**Classification**: CORE (new bounded context + orders integration), with a thin Frontend slice, one
small API-layer change on the Allegro OAuth path, and one Infrastructure migration.

---

## 2. Scope & Non-Goals

### In Scope

- New leaf core context `libs/core/src/currency/` — rate registry, providers, rule → rate-date
  derivation.
- `exchange_rates` table (shared, immutable, get-or-create) with cross-rate provenance.
- Five nullable columns on `order_records` + the narrow stamp-once write path.
- Reporting-currency resolution ladder (four rungs) in the `orders` context.
- `NbpExchangeRateProvider` with pivot-based cross-rates and non-publication-day handling, driven by
  the existing Polish working-day calendar in `@openlinker/shared/date`.
- A retry sync job **plus** a periodic reconcile sweep for orders that could not be stamped inline.
- Optional ISO-4217 reporting-currency field on the Erli / WooCommerce / Allegro setup paths (Allegro
  requires a small backend change — see Phase 4).
- One TypeORM migration, with a manual `up`/`down`/`up` acceptance run.
- `previousWorkingDay` added to `libs/shared/src/date/pl-working-days.ts`.
- A `*.provider.ts` row in the engineering-standards file-suffix table.

### Out of Scope

- **Backfilling historical orders.** Pre-existing rows keep `reportingCurrency IS NULL`. Restating
  already-reported figures is a separate decision (ADR-040 § Migration path).
- **The analytics queries themselves** (#1987 / #1988). This ships the columns they read. Their
  acceptance criteria currently contradict this model — see § 5 open question 1.
- **A second rate rule or a second provider.** The rule is persisted and the provider port carries
  `supports()` + pivot provenance so both are additive later; neither is built now.
- **NBP tables B and C.** Table B is the weekly exotic set (~110 currencies) on a different endpoint;
  table C is bid/ask. Only table A (the daily statutory average) is read. A currency present only in
  table B is permanently unreachable and reports as unsupported (terminal).
- **A UI for `Connection.config.fx`.** Same posture as `stockSafetyBuffer` / `pricingRule` today —
  JSONB, no editor yet. The *reporting-currency* rung is surfaced (via `config.currency`); the
  rule/source override is not.
- **Caching the resolved reporting currency.** See § 5 Assumptions.
- **Line-item-level conversion.** Only the order total is stamped; `order_line_items` (#1985) keeps
  native prices.
- **Emitting FA(3) `KursWaluty`.** See § 5 Documentation gaps.
- **`prestashop-order.mapper.ts:247`'s hardcoded `const conversionRate = 1.0;`** on the outbound
  order-create path. Out of scope, one line, noted in § 5.

### Constraints

- One issue → one branch → one PR (repo convention).
- Local quality gate is `pnpm lint` + `pnpm type-check` only. CI runs `pnpm test:ci`
  (`.github/workflows/ci.yml:133`) and `test:integration` (`:286`), so the local gate is fine for
  code — but **it is not a backstop for the DDL**, because nothing anywhere executes a migration
  (see step 9).
- Must not break, or depend on merging, the unmerged #1985 branch — see § 8 Risks.

---

## 3. Architecture Mapping

**Target layer**: CORE (`libs/core/src/currency/` — new; `libs/core/src/orders/` — extended),
Shared (`libs/shared/src/date/` — one function), Infrastructure (migration), Interface (FE setup
schemas + one API DTO/controller change), App (`apps/worker` job handler + module wiring).

**Capabilities involved**: none. This deliberately introduces **no capability port** — an exchange
rate is not a per-connection integration capability, it is a shared read of a public reference
source. `ExchangeRateProviderPort` is an intra-context port with in-context implementations,
resolved by a `Map`, not by `getCapabilityAdapter`.

**Existing services reused**:

| Service / helper | Used for |
|---|---|
| `ConnectionPort` + `CONNECTION_PORT_TOKEN` (`@openlinker/core/identifier-mapping`) | reading `Connection.config` for the ladder |
| `OrderRecordRepositoryPort` | the dominant-native-currency read and the narrow stamp write |
| `SyncJobQueuePort` / the worker handler pattern | the retry job + reconcile sweep |
| `Logger` (`@openlinker/shared/logging`) | warn-on-degrade |
| `isPlWorkingDay` / `addWorkingDays` (`@openlinker/shared/date`) | the working-day calendar (see step 2) |
| `FetchLike` (`@openlinker/shared/http`) | the injected transport for the NBP provider |
| `readStockSafetyBuffer` / `readPricingRule` | the pure config-coercion **pattern** for `config.fx` |
| `IdentifierMappingService.getOrCreateInternalId` | the **insert-then-recover** get-or-create pattern (see § 4) |
| `OrderRecordRepository.claimWaybillRelay`-shaped guarded write | the stamp-once conditional UPDATE (see § 4) |

**Not** `IIntegrationsService`: its interface exposes no plain connection read
(`libs/core/src/integrations/application/interfaces/integrations.service.interface.ts` declares only
`getAdapter`, `getCapabilityAdapter`, `resolveAdapterMetadata`, `listCapabilityAdapters`), and
`getAdapter` resolves adapter metadata OL does not need here. The house pattern for "read this
connection's config" is `ConnectionPort.get(connectionId)` —
`libs/core/src/inventory/application/services/inventory-sync.service.ts:63` is the reference call
site for exactly this purpose (`readStockSafetyBuffer(connection.config)` on the next line but one).
`ConnectionPort` is a single-`Port`-suffix port on the cross-context allow list, and `orders` already
imports `IdentifierMappingModule` (`libs/core/src/orders/orders.module.ts:43`).

**New components required**: see § 6.

**Core vs Integration justification**: this cannot live in an integration package. The rate registry
is shared across every connection (that is the whole point of keying rows by
`(source, pair, date)` rather than per order), the reporting-currency ladder reads OL's own order
history, and the stamp is written onto a core table. No marketplace is involved and no
platform-specific vocabulary crosses the boundary — the provider speaks ISO-4217 codes and dates.

**The first outbound HTTP call in `libs/core`.** Verified: `grep -rn "fetch(" libs/core/src` excluding
`*.spec.ts` returns zero hits. Two guards exist for outbound HTTP and **neither covers `libs/core`**:
`scripts/check-outbound-http.mjs`'s `SCAN_ROOTS` (lines 53–63) lists only the nine
`libs/integrations/*` packages, and its ESLint twin (`.eslintrc.js:528–557`) uses the same nine globs.
So nothing would stop a bare `fetch()` here. Two rules make that acceptable rather than a hole:

1. **The provider takes an injected `FetchLike`** (`@openlinker/shared/http`, exported from that
   barrel at `libs/shared/src/http/index.ts:8-12`), never the global. That keeps the transport
   substitutable, is what makes step 3's faked-HTTP tests possible without `jest.spyOn(globalThis)`,
   and means the eventual widening of the guard finds nothing to complain about.
2. **A rate provider that needs a credential or a vendor SDK ships as `libs/integrations/fx-*`**
   implementing `ExchangeRateProviderPort`. Only keyless public GETs live in core. This mirrors
   `AiCompletionPort` in core vs the vendor adapters in `@openlinker/integrations-ai`.

ADR-038's `HttpTransportFactoryPort.forConnection(connection, defaultRateLimit)`
(`libs/shared/src/http/http-transport-factory.port.ts:52-55`) is **structurally unusable** here: it
keys its cached transport and its rate-limit bucket on `connection.id`, and an NBP read has no
connection. Passing a synthetic connection would create a bucket that means nothing. The provider
takes a plain `FetchLike` plus its own timeout.

**Cross-context dependency direction** (`docs/architecture-overview.md` § Cross-context
dependencies):

```
orders ──▶ currency            (new edge: ICurrencyRateService + Symbol token + FX_RATE_RULES, from the barrel)
orders ──▶ identifier-mapping  (already exists — ConnectionPort)
currency ──▶ (nothing in core) ← leaf; consumes @openlinker/shared only
```

`currency` is kept a **leaf** on purpose: the caller resolves the rule and the source from the
connection and passes them down as plain values, so `currency` never needs `integrations`, and the
`orders → currency → orders` cycle that a naive "resolve everything inside currency" design would
create never appears. `libs/core` already declares `@openlinker/shared` in `dependencies`
(`libs/core/package.json:185`) and references it in `tsconfig.json`, so consuming
`@openlinker/shared/date` and `/http` needs no manifest edit.

**`readFxConfig` lives in `currency`, not `identifier-mapping`.** The earlier draft placed it beside
`stock-safety-buffer.types.ts`. That is wrong: membership-checking `FX_RATE_RULES` /
`EXCHANGE_RATE_SOURCES` requires a **value** import, so the helper would create a runtime
`identifier-mapping → currency` edge out of a barrel that every plugin loads
(`@openlinker/core/identifier-mapping` is imported by the Allegro, DPD and Erli packages among
others) — contradicting the leaf claim above. The two cited precedents do not carry the property the
placement argument claimed for them: `stock-safety-buffer.types.ts:17` and `pricing-rule.types.ts:21`
each import **only** `./connection.types`, zero cross-context. And
`scripts/check-cross-context-imports.mjs`'s `classifyName` **default-allows** an unrecognized symbol
name (`:588` — `return { allowed: true }` after both pattern loops), so the invariant would not have
caught the regression either. The helper therefore lives at
`libs/core/src/currency/domain/types/fx-config.types.ts` and takes config **structurally** —
`Record<string, unknown> | null | undefined`, the same shape-not-import trick
`libs/shared/src/http/http-transport-factory.port.ts:16-21` uses for `RateLimitedConnection`. That
works because `ConnectionConfig` carries `[key: string]: unknown` (`connection.types.ts:109`), so a
caller passes `connection.config` with no import in either direction.

---

## 4. External / Domain Research

### NBP Web API

- **Base**: `https://api.nbp.pl/api/exchangerates/rates/a/{code}/{date}/?format=json` (table A =
  average rates, the statutory reference for PL tax purposes).
- **Authentication**: none. Public, unauthenticated.
- **Rate limits**: no published quota. Volume here is ~1 request per currency per day at most
  (the registry absorbs everything else), so throttling is a non-issue.
- **Response**: `{ table, currency, code, rates: [{ no, effectiveDate, mid }] }` — `no` is the table
  number (`149/A/NBP/2026`) persisted as `sourceRef`, `effectiveDate` is the **actual** rate date,
  `mid` is the rate published to **4 decimal places**.
- **Direction**: NBP quotes `X → PLN` only. A `PLN → X` request inverts; an `X → Y` request divides
  two `X → PLN` reads (the pivot).
- **Coverage**: table A carries the majors. Tables B (weekly exotic) and C (bid/ask) are out of
  scope, so a currency absent from table A is permanently unreachable — which is why the port
  reports supported pairs (step 3) instead of letting the walk-back discover it 70 requests later.
- **Non-publication days**: NBP publishes on Polish business days only. A request for a Saturday, a
  Sunday, or a public holiday returns `404 NotFound`, **not** an empty result. The rate date is
  therefore resolved from the **calendar** first (step 2), and the HTTP walk-back exists only as
  defence against unexpected non-publication.
- **Malformed / out-of-range date**: NBP is documented to answer `400 Bad Request` rather than 404
  for a date it cannot parse or that lies outside the published range. **Not verified against the
  live API in this plan** — so the provider treats *any non-404 4xx* as terminal rather than
  hardcoding 400. That is correct whichever code NBP actually returns, and closes the hole where a
  400 escapes the 404-only walk-back as an unhandled HTTP error.
- **Same-day publication window**: today's table appears around 12:00 CET. Since the only shipped
  rule is `prev-business-day`, this is not hit today; a future `same-day` rule must handle it.

### Direction is an invariant, not a convention

`rate` is the number of `to` units per one `from` unit. `from` is **always** the order's own
currency; `to` is **always** the reporting currency. The stamp is therefore **always**
`reportingTotalAmount = round2(totals.total × rate)` — never a division. This is stated in § 6
Implementation details, in the ORM entity header, and pinned by a unit test asserting an exact
numeric `reportingTotalAmount` (§ 9). Getting it backwards produces a number that is plausible,
never throws, and is wrong by the square of the rate.

### Cross-rate arithmetic, spelled out

NBP quotes `X → PLN`. For a `from → to` pair where neither side is PLN, the pivot is PLN and the
divide order is:

```
rate(from → to) = mid(from → PLN) / mid(to → PLN)
```

Worked: EUR mid `4.2500`, USD mid `3.9000`, reporting in USD, order in EUR →
`4.2500 / 3.9000 = 1.08974359` (8 dp). One EUR is 1.08974359 USD. Sanity check: EUR is worth more
than USD, so the rate must exceed 1 — a flipped divide gives 0.917…, which is the tell.

A pivot whose two legs resolve to **different** `effectiveDate`s **raises** (terminal), never
silently picks one. That happens when one currency's table row is missing for a day the other has;
combining two dates into one `rateDate` would make the stored row unverifiable against any published
table.

### Internal patterns found

- **Denormalized order columns**: `dispatchByAt` (#927) and `fulfillmentState` (#1108) already set
  the precedent for "project a scalar out of the snapshot onto an indexed column at write time".
  #1985 extends it with four more. The FX group joins that pattern.
- **Narrow absolute-set writes**: `OrderRecordRepository.updateFulfillmentState`
  (`libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts:529-534`)
  writes **one** column; `.updateItemResolutionFailure` (`:542-550`) writes **two** (`recordStatus`
  **and** `mappingFailureReason`). Both are narrow absolute-sets specifically so they cannot race a
  concurrent write to another column on the same row. "Narrow absolute-set" is the right
  description; "single-column" is not.
- **Guarded claim-write (the closest precedent for the stamp)**: `ShipmentRepository.claimWaybillRelay`
  (`libs/core/src/shipping/infrastructure/persistence/repositories/shipment.repository.ts:132-141`) —
  `this.repository.update({ id, waybillRelayedAt: IsNull() }, { waybillRelayedAt: at })` then
  `return (result.affected ?? 0) > 0`. Exactly the shape `stampFxIfAbsent` needs, and it is spec'd
  the same way (`shipment.repository.spec.ts:383-386` asserts the `IsNull()` predicate is in the
  `update` call).
- **Get-or-create is insert-then-recover, NOT `ON CONFLICT DO NOTHING`.** The earlier draft
  mis-cited this. `IdentifierMappingRepository.insertMapping`
  (`libs/core/src/identifier-mapping/infrastructure/persistence/repositories/identifier-mapping.repository.ts:78-99`)
  attempts a plain `save()`, catches `QueryFailedError` with PG code `23505`, and converts it to the
  domain `DuplicateIdentifierMappingError`; the service
  (`identifier-mapping.service.ts:224-264`, whose own comment at `:209` reads *"Pure
  insert-then-recover: always attempts insert (no upfront read)"*) catches that domain error and
  re-selects via `findByExternalKey`. Following the earlier draft literally would also have bypassed
  the infrastructure-error → domain-error conversion the engineering standards require of
  repositories.
- **Money columns**: `products.price` and `product_variants.price` both use
  `@Column({ type: 'decimal', precision: 10, scale: 2 })`
  (`product.orm-entity.ts:23`, `product-variant.orm-entity.ts:45`) with an explicit `Number()` in
  `toDomain`. #1985's `totalAmount` is `numeric(12,2)`. `reportingTotalAmount` matches #1985; the
  **rate** does not (see § 6 Implementation details). There are **zero** `transformer:` usages in any
  `libs/core` `*.orm-entity.ts`, so none is introduced here.
- **`round2` is the house money idiom**: `Math.round((value + Number.EPSILON) * 100) / 100` —
  `libs/core/src/invoicing/application/services/invoice.service.ts:157-158` (module-private
  `round2`) and `libs/core/src/identifier-mapping/domain/types/pricing-rule.types.ts:136-138`
  (module-private `round2dp`). No decimal library exists anywhere: `decimal.js`, `big.js`,
  `bignumber.js`, `dinero`, `currency.js` all return zero hits across every `package.json`.
- **Polish working-day calendar already exists**: `libs/shared/src/date/pl-working-days.ts` exports
  `easterSunday` (`:113`, computus for the movable holidays), `isPlPublicHoliday` (`:175`),
  `isPlWorkingDay` (`:184`) and `addWorkingDays` (`:201`). Warsaw-anchored via `Intl`,
  dependency-free, hand-rolled precisely because no date library exists. `@openlinker/shared/date` is
  a declared export subpath (`libs/shared/package.json:56`). The earlier draft argued against "a
  hard-coded calendar that would rot" — the repo already made the opposite call, and that calendar is
  correct.
- **Offset-less source timestamps**: PrestaShop passes `date_add` through with no offset
  (`prestashop-order-source.adapter.ts:235-236`). `parseDpdEventTime`
  (`libs/integrations/dpd-polska/src/infrastructure/mappers/dpd-tracking.mapper.ts:88-106`) is the
  in-repo solution — parse the wall-clock parts, then subtract the Warsaw offset at that instant via
  `Intl`. Relevant because a near-midnight PrestaShop order's rate date otherwise depends on the
  API host's `TZ`.
- **Existing currency knowledge**: `Connection.config.currency` (#362) is read at
  `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts:120-122`
  (`config.currency ?? shopCurrencyResolver.resolveDefaultCurrencyIso(...) ?? undefined`). The FE
  writes it at `prestashop-setup.schema.ts:69` (the zod union) and `:107-109` (the
  omit-when-blank guard). Nothing else in the repo defines a "our currency" concept. Note the key is
  **not** declared on `ConnectionConfig` — it rides the open index signature (`connection.types.ts:109`).

---

## 5. Questions & Assumptions

### Open questions

1. **BLOCKING for #1987 / #1988 (not for this issue): the consuming issues specify the opposite
   model.** Their acceptance criteria say multiple currencies never sum into a single figure; this
   plan makes each per-reporting-currency figure a stamped, immutable number and expects the query to
   `GROUP BY "reportingCurrency"`. Both cannot be right. This plan ships the columns regardless — the
   stamp is strictly more information than today — but **the AC reconciliation is a precondition for
   those issues and is unresolved**. Flag to the product owner before #1987 starts. Recorded in
   ADR-040 § Consequences.
2. **Operator visibility: the resolved reporting currency and which rung produced it are surfaced
   nowhere.** `ConnectionConfigPanel.tsx` renders no `currency` field (grep: zero hits), and there is
   no `apps/web/src/features/analytics/` at all. So "why is my Allegro revenue reported in EUR?"
   requires SQL against `order_records` today. Options: expose the resolved value + rung on the
   connection detail page, or on the (unbuilt) analytics page. **Unresolved** — out of scope here, but
   it should not stay unresolved past #1987, because rung 3 is invisible and self-reinforcing from the
   operator's seat.
3. **Backfill of historical orders** — deliberately deferred, but someone will ask for it the first
   time they open the analytics page. The rate data is retrievable, so the job is mechanical; the
   question is whether restating past periods is acceptable. Flag to the product owner before
   #1987 ships.
4. **WooCommerce emits no `placedAt` at all**, so under the terminal-on-missing-`placedAt` rule
   (see step 2) **every** foreign-currency WooCommerce order is permanently unstampable. The fix is
   one line in the adapter, not in this feature:
   `woocommerce-order-source.adapter.ts:178` already reads
   `createdAt: normGmt(order.date_created_gmt, order.date_created)`, and WC's `date_created` **is**
   when the buyer placed the order — so it should also populate `placedAt`. Deliberately **not** done
   here (it changes invoicing's `saleDate` for every WC order, which needs its own review). Decide
   whether to file it as a follow-up before, or alongside, #1987.
5. **`fxRule` on a re-ingested order whose rule changed** — the stamp is immutable, so an order
   stamped under `prev-business-day` keeps that rule forever even if the connection later switches.
   That is intended (it is why the field exists), but it means a connection can carry two rule eras.
   No action. ADR-040 § Consequences documents the analogous **reporting-currency** two-era concern
   under rung 3; the *rule* two-era concern is documented under § Consequences "Pros" (the
   one-instant-to-one-published-day property) rather than as a con.

### Assumptions

- **NBP is the only provider shipped.** The requirement is PLN reporting, and the Polish statutory
  rate is the NBP mid rate. The port carries `supports()` and pivot provenance so ECB or another
  source is additive.
- **`prev-business-day` is the only rule shipped**, defaulting for every connection.
- **No cache on the resolved reporting currency.** #1985's ADR (unmerged) documents this persona at
  10–100 orders/day, so the ladder's rung-3 aggregate runs at most ~100×/day. A cache would buy
  nothing measurable and would add an invalidation path on connection edit — a real staleness bug for
  a hypothetical gain. Revisit with numbers.
- **The stamp attempt runs inline during ingestion.** After the first order of the day for a given
  pair the rate is a local **unique-index** read (the PK is `id uuid`; the lookup key is
  `(source, fromCurrency, toCurrency, rateDate)`), not an HTTP call, so the hot path is bounded. The
  retry job plus the reconcile sweep cover the first-order-of-the-day-while-NBP-is-down case.
- **`reportingTotalAmount` is derived from `totals.total` only** — the buyer-paid grand total.
  Per-line conversion is out of scope.
- **`placedAt` is the correct economic anchor**, and this is not a new judgement: invoicing derives
  `saleDate` from the same field and explicitly refuses `createdAt` —
  `libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts:109-115`,
  *"`createdAt` is OL's ingestion clock, not the sale date, and must never substitute (#1525)"*.
  The FX stamp adopts the identical rule, which is also why a missing `placedAt` is terminal rather
  than silently falling back.

### Documentation gaps

- `docs/architecture-overview.md` has no Currency bounded context section. Add one in this PR
  (§ 6, Phase 5) alongside the ADR link, and extend the cross-context dependency mermaid graph with
  the `orders → currency` edge.
- `docs/engineering-standards.md`'s file-suffix table has no `*.provider.ts` row. Add one in this PR
  (§ 6, Phase 5) — see the naming note in § 8.
- **FA(3) already has the fields and OL deliberately omits them.** The KSeF schema declares
  `KursWaluty` (`libs/integrations/ksef/src/infrastructure/fa3/schema/schemat_fa3_v1-0e.xsd:3199`)
  and `KursUmowny` (`:3490`), and
  `libs/integrations/ksef/src/infrastructure/fa3/builders/fa3-xml.builder.ts` emits
  `KodWaluty` (`:463`) and **no** `Kurs*` element at all (grep for `Kurs` in that builder: zero
  hits). Since invoicing anchors `saleDate` on the same `order.placedAt`, whoever implements
  `KursWaluty` **must consume this stamp** rather than compute a second, divergent rate for the same
  order. Add that sentence next to the Currency section in the architecture overview. (ADR-040
  § Consequences already carries the fiscal-vs-analytics caveat.)
- `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts:247` hardcodes
  `const conversionRate = 1.0;` on the **outbound** order-create path, emitted as
  `conversion_rate: conversionRate.toFixed(6)` at `:272`. Harmless today (OL knows no rate); a
  visible inconsistency the moment it does. Explicitly out of scope — one line, noted so a reviewer
  does not have to rediscover it.
- `ConnectionConfig` (`libs/core/src/identifier-mapping/domain/types/connection.types.ts`) documents
  `invoicing`, `stockSafetyBuffer`, `pricingRule` and `rateLimit` but **not** `currency`. Now that
  the key carries a second meaning, add a doc-comment field for it in this PR (see step 10).

### Deviation from the source design sketch

The original sketch stored a full `fxStamp` object inside `orderSnapshot` (JSONB) for audit.
**Dropped**, because `persistOrder` rewrites `orderSnapshot` wholesale on every re-ingestion — a
stamp stored there would silently disappear on the next re-poll, contradicting the immutability the
whole feature rests on. The audit trail is preserved instead by the `exchangeRateId` join
(`rate`, `rateDate`, `source`, `sourceRef`, `pivotCurrency`, `derivation`) plus the `fxRule` column,
which is strictly more durable and one fewer place to keep in sync.

---

## 6. Proposed Implementation Plan

### Phase 0 — Shared calendar

0. **`previousWorkingDay` in `@openlinker/shared/date`**
   - **Files**: `libs/shared/src/date/pl-working-days.ts`, `libs/shared/src/date/index.ts`
     (+ `libs/shared/src/date/__tests__/`)
   - **Action**: add `previousWorkingDay(from: Date): Date` beside `addWorkingDays` (`:201`), reusing
     the module-private `toWarsawCivil` / `warsawCivilToInstant` helpers and
     `isPlPublicHolidayYmd`. `addWorkingDays` clamps `Math.max(0, …)` and so cannot step backwards —
     hence a new function rather than a negative argument. Export it from the barrel
     (`index.ts` currently exports four names).
   - **Acceptance**: Friday for a Monday input; Friday for a Saturday and a Sunday input; the day
     before a holiday cluster (e.g. 2026-01-02 → 2025-12-31, skipping 1 Jan); DST-transition-day
     input returns a valid instant with the source's Warsaw wall-clock time preserved.
   - **Caveat to record in the function's doc comment**: `PL_FIXED_HOLIDAYS` includes 24 December
     unconditionally ("statutory non-working day from 2025", per the existing comment at
     `pl-working-days.ts:23-25`). For pre-2025 dates that is wrong, and NBP *did* publish on
     24 December then. Immaterial for orders arriving now; it would matter to a historical backfill.

### Phase 1 — The `currency` context (leaf, no core dependencies)

1. **Domain types + rule + config coercion**
   - **Files**: `libs/core/src/currency/domain/types/exchange-rate.types.ts`,
     `.../fx-rate-rule.types.ts`, `.../fx-config.types.ts` (+ `__tests__/fx-config.types.spec.ts`)
   - **Action**: define `FX_RATE_RULES = ['prev-business-day'] as const` + `FxRateRule`;
     `EXCHANGE_RATE_SOURCES = ['nbp'] as const` + `ExchangeRateSource`; `RATE_DERIVATION_KINDS =
     ['direct', 'inverted', 'pivot'] as const`; the `ExchangeRate` shape (`from`, `to`,
     `rate: string`, `rateDate: string`, `source`, `sourceRef: string | null`,
     `pivotCurrency: string | null`, `derivation: RateDerivation`); `GetRateInput` (`from`, `to`,
     `rateDate`, `rule`, `source`).
     Also `FX_CONFIG_KEY = 'fx'` and
     `readFxConfig(config: Record<string, unknown> | null | undefined): { rule: FxRateRule; source:
     ExchangeRateSource; reportingCurrency: string | null }`, defaulting to
     `{ rule: 'prev-business-day', source: 'nbp', reportingCurrency: null }` and coercing any
     missing / malformed / unknown value back to the default. **Structural config parameter, no
     `ConnectionConfig` import** — see § 3.
   - **Acceptance**: `as const` + derived-union pattern per engineering standards; no `enum`;
     exhaustive coercion table in the spec (§ 9).

2. **`resolveRateDate` — pure**
   - **File**: `libs/core/src/currency/domain/rate-date-resolution.ts`
     (+ `__tests__/rate-date-resolution.spec.ts`)
   - **Action**: `resolveRateDate(placedAt: Date | undefined, rule: FxRateRule): string | null`
     → an ISO `YYYY-MM-DD`, or `null`.
     - Returns `null` when `placedAt` is `undefined` **or** `Number.isNaN(placedAt.getTime())`.
       This is the **terminal** signal (no stamp, no retry enqueue), never a throw and never a
       `RangeError` out of `Intl.DateTimeFormat`. Without the guard, WooCommerce's absent `placedAt`
       (which `order-ingestion.service.ts:638` passes through as `undefined` from
       `incoming.placedAt ? new Date(incoming.placedAt) : undefined`, with no `Number.isNaN`
       check — unlike `deriveDispatchByAt`, `order-record.service.ts:243-250`, which has one) makes
       100% of foreign-currency WC orders throw and die after 10 retries.
     - For `prev-business-day`: `previousWorkingDay(placedAt)` (step 0), then format in
       `Europe/Warsaw` via `Intl.DateTimeFormat` (no new dependency). The calendar owns weekends
       **and** Polish public holidays; the provider's HTTP walk-back is defence against unexpected
       non-publication only, not the holiday oracle.
     - **Clamp**: `min(resolved, todayInWarsaw)`. A source clock running fast (or a source that
       reports a future `date_add`) must not resolve a rate date NBP has not published.
   - **Acceptance**: see § 9 — mid-week, Monday, **Saturday**, **Sunday**, the 23:30 UTC Sunday roll,
     a Europe/Warsaw DST-transition day, a holiday cluster, `undefined`, an Invalid Date, and the
     future-date clamp.
   - **Dependencies**: steps 0, 1.

3. **Provider port + NBP provider**
   - **Files**: `libs/core/src/currency/domain/ports/exchange-rate-provider.port.ts`,
     `libs/core/src/currency/infrastructure/providers/nbp-exchange-rate.provider.ts`
     (+ `__tests__/nbp-exchange-rate.provider.spec.ts`)
   - **Action**: the port declares
     - `readonly name: ExchangeRateSource`
     - `readonly pivotCurrency: string | null`
     - `supports(from: string, to: string): boolean`
     - `fetchRate({ from, to, on }): Promise<ExchangeRate>`

     `supports()` exists because a currency absent from NBP table A 404s on **every** walk-back day.
     `maxAttempts` defaults to `10` (`libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts:87`),
     so without it an unsupported pair costs 10 × 7 = 70 futile HTTP requests and then dies. Per
     [ADR-007](../architecture/adrs/007-syncjob-status-vs-outcome-split.md) an unsupported pair is a
     `business_failure`, not a retry.

     `RateNotAvailableError` splits into two:
     - `RateUnavailableTransientError` — a 5xx, a timeout, a network failure. Retryable.
     - `RateUnsupportedPairError` — `supports()` false, an exhausted walk-back, **any non-404 4xx**
       (see § 4 on NBP's malformed-date response), or a pivot whose legs disagree on
       `effectiveDate`. **Terminal**: no stamp, no retry job, `business_failure` in the handler.

     The NBP provider takes an injected `FetchLike` (`@openlinker/shared/http`) plus a timeout, GETs
     `.../rates/a/{code}/{date}/?format=json`, walks back up to 7 days on 404, inverts for `PLN → X`,
     and pivots through PLN for `X → Y` per the divide order in § 4. It persists the `effectiveDate`
     the API actually answered with, the `no` as `sourceRef`, and a `derivation`
     (`{ kind, legs: [{ pair, ref, effectiveDate }] }`) so an inverted or pivoted `rate` — which
     appears in no published table — stays auditable. Rate arithmetic uses `number` + the house
     `round2`-style rounding (see below); the stored `rate` is the 8-dp string.
   - **Acceptance**: unit-tested against a faked `FetchLike` for direct, inverted, cross-rate (with
     an exact expected value), 404-walk-back, exhausted walk-back, a 400, a 503, a timeout,
     `supports()` false, and legs-disagree-on-date. Never a live HTTP call in any tier.
   - **Dependencies**: step 1.

4. **Registry: ORM entity, port, repository**
   - **Files**: `libs/core/src/currency/infrastructure/persistence/entities/exchange-rate.orm-entity.ts`,
     `libs/core/src/currency/domain/ports/exchange-rate-repository.port.ts`,
     `libs/core/src/currency/infrastructure/persistence/repositories/exchange-rate.repository.ts`
     (+ `__tests__/exchange-rate.repository.spec.ts`)
   - **Action**: entity per § Implementation details below. The repository exposes `findByKey(...)`
     and `insertIfAbsent(...)`. `insertIfAbsent` follows the **insert-then-recover** pattern
     (§ 4): plain `save()`, catch `QueryFailedError` with PG code `23505`, convert to the domain
     `DuplicateExchangeRateError`. The caller re-selects. **Not** `.orIgnore()` — the house pattern
     is the code-`23505` conversion, and it keeps the infrastructure-error → domain-error boundary
     the standards require.
   - **Acceptance (unit)**: a `23505` `QueryFailedError` from `save()` surfaces as
     `DuplicateExchangeRateError`; any other error propagates unchanged. The "two concurrent calls
     resolve to one row" claim is **not** unit-testable — see § 9 (int-spec scenario 5).

5. **`CurrencyRateService`**
   - **Files**: `libs/core/src/currency/application/interfaces/currency-rate.service.interface.ts`,
     `libs/core/src/currency/application/services/currency-rate.service.ts`
     (+ `__tests__/currency-rate.service.spec.ts`)
   - **Action**: `getRateFor(input: GetRateInput): Promise<ExchangeRate & { id: string }>` —
     resolve the provider from the `Map`, `supports()` gate, registry read by key, on miss provider
     fetch → `insertIfAbsent` → on `DuplicateExchangeRateError` re-select the winner.
     `resolveRateDate` runs in the **caller** (the orders context owns `placedAt`), so this service
     takes an already-resolved `rateDate`.
   - **Acceptance**: a second call for the same key performs **no** provider fetch; a
     `DuplicateExchangeRateError` resolves to the winning row rather than propagating;
     `RateUnsupportedPairError` propagates unchanged (the stamp service, not this one, decides
     terminal-vs-retry policy).

6. **Module + tokens + barrel + package exports**
   - **Files**: `libs/core/src/currency/currency.module.ts`, `currency.tokens.ts`, `index.ts`,
     and the `"./currency"` entry in `libs/core/package.json` `exports`
   - **Action**: providers registered into a `ReadonlyMap<ExchangeRateSource,
     ExchangeRateProviderPort>` via `useFactory`. **`TypeOrmModule.forFeature([ExchangeRateOrmEntity])`
     is mandatory** — runtime entity discovery is `autoLoadEntities: true`
     (`libs/shared/src/database/database.module.ts:34`), so without the `forFeature` the table never
     materializes in the `synchronize`-built dev/test schema and the int-spec cannot pass.
     `currency.tokens.ts` contains **only** Symbol declarations; `index.ts` does
     `export * from './currency.tokens'` (per the Symbol re-export convention). Add
     `"./currency"` to `libs/core/package.json` `exports`, mirroring the `"./analytics"` entry
     (`:17-21`).
   - **Acceptance**: `pnpm check:invariants` passes; no `@openlinker/core/<sibling>` import anywhere
     under `libs/core/src/currency/**` (assert by grep in review — the invariant script
     default-allows unrecognized symbol names, so it will not catch a new edge on its own).

### Phase 2 — Persistence

7. **Order-record columns**
   - **Files**: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`,
     `libs/core/src/orders/domain/entities/order-record.entity.ts`
   - **Action**: add the five columns (§ Implementation details) to the ORM entity and five matching
     trailing optional constructor params to the domain entity, appended at the end of the existing
     list (which currently ends at `cancelledAt`, `order-record.entity.ts:34+`).
   - **Acceptance**: `toOrm` does **not** write them (see step 8); `toDomain` hydrates them,
     `Number()`-ing `reportingTotalAmount` per the house convention.

8. **Stamp-once repository method + dominant-native-currency read**
   - **Files**: `libs/core/src/orders/domain/ports/order-record-repository.port.ts`,
     `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
     (+ `__tests__/order-record.repository.spec.ts`)
   - **Action**:

     (a) `stampFxIfAbsent(internalOrderId, stamp): Promise<boolean>` — one guarded absolute-set,
     copying `claimWaybillRelay`'s shape exactly (§ 4):

     ```ts
     const result = await this.repository.update(
       { internalOrderId, reportingCurrency: IsNull() },
       {
         reportingCurrency: stamp.reportingCurrency,
         reportingTotalAmount: stamp.reportingTotalAmount,
         exchangeRateId: stamp.exchangeRateId,
         fxRule: stamp.fxRule,
         fxStampedAt: stamp.fxStampedAt,
       }
     );
     return (result.affected ?? 0) > 0;
     ```

     Five columns in one `UPDATE`, so the group cannot half-apply.

     (b) `findDominantNativeCurrency(sourceConnectionId): Promise<string | null>` — the rung-3
     aggregate, over the **native** currency in the snapshot, never over `reportingCurrency`.
     `order_records` has no native `currency` column today (that is #1985, which this plan must not
     depend on), so the read goes through the snapshot using the repository's own guarded JSONB
     idiom (`order-record.repository.ts:274-281` — `TOTAL_EXPR`, guarded with
     `jsonb_typeof(...) = 'number'` so a malformed value sorts as NULL rather than throwing on the
     cast, with a matching expression index in the migration). Copy that shape for
     `{totals,currency}` with `jsonb_typeof(...) = 'string'`:

     ```sql
     SELECT c AS currency, count(*) AS n
     FROM (
       SELECT CASE
                WHEN jsonb_typeof(rec."orderSnapshot"#>'{totals,currency}') = 'string'
                THEN rec."orderSnapshot"#>>'{totals,currency}'
              END AS c
       FROM "order_records" rec
       WHERE rec."sourceConnectionId" = $1
     ) t
     WHERE c IS NOT NULL
     GROUP BY c
     ORDER BY count(*) DESC, c ASC     -- deterministic tie-break
     LIMIT 1
     ```

     The `, c ASC` tie-break is load-bearing: without it a connection with an exact 50/50 split can
     resolve to a different reporting currency on two consecutive ingestions, silently splitting one
     channel's history into two eras. Note the quoted camelCase identifiers — no `namingStrategy` is
     configured anywhere (verified: neither `libs/shared/src/database/database.module.ts` nor
     `apps/api/src/database/data-source.ts` sets one), so `base_currency` / `internal_order_id`
     would error at runtime. The in-repo precedents are
     `1832000000008-add-order-record-cancelled-at.ts:28` (`ADD COLUMN IF NOT EXISTS "cancelledAt"`)
     and `markCancelled`'s `WHERE "internalOrderId" = $2` (`order-record.repository.ts:561-568`).

     **Leave `toOrm` untouched** so the upsert path can never clobber a stamp — and add the
     regression spec described in § 7 Alternative 5.
   - **Acceptance**: `stampFxIfAbsent` asserts the `IsNull()` predicate is present in the `update`
     call (`toHaveBeenCalledWith({ internalOrderId, reportingCurrency: IsNull() }, {…})`, mirroring
     `shipment.repository.spec.ts:383-386`) and returns `false` when `affected` is 0;
     `findDominantNativeCurrency` asserts the emitted SQL carries the `jsonb_typeof` guard and the
     `, c ASC` tie-break.
   - **Dependencies**: step 7.

9. **Migration**
   - **File**: `apps/api/src/migrations/1834000000000-add-order-fx-stamp.ts`
   - **Action**: create `exchange_rates` (+ its unique index), add the five `order_records` columns
     (+ the partial composite index, the group-integrity CHECK, and the `{totals,currency}`
     expression index for step 8b). `up()` and `down()` both implemented. Follow the house DDL-guard
     style, which for recent `ALTER TABLE` migrations **is** `IF NOT EXISTS` / `IF EXISTS` — verified
     across `1832000000005:25,30`, `1832000000006:28,34`, `1832000000007:31,36`, `1832000000008:28`,
     and #1985's own `1832000000008-add-order-analytics-read-model.ts:26-29`. `CREATE TABLE` is
     mixed in the repo (`1830000000000:31` guards, `1831000000004:26` does not); guard it, matching
     the more recent of the two.
   - **Why `1834000000000`**: the invariant that matters is
     `scripts/check-migration-timestamps.mjs`' rule 4 — a migration not yet on `origin/main` must
     have a timestamp **strictly greater than every migration that is**. Verified tails:
     `1832000000008` in `apps/api/src/migrations/`, `1767900000000` in the one plugin dir listed in
     `scripts/plugin-migration-dirs.json` (`libs/integrations/allegro/src/migrations`). The earlier
     draft justified `1833000000000` as "after #1985's `1832000000008`" — that reasoning is void,
     because `1832000000008` is claimed **three** ways: `-add-order-record-cancelled-at` (on `main`
     via #2022), `-add-order-analytics-read-model` (`origin/1985-order-analytics-read-model`), and
     `-add-offer-commercial-snapshots-table` (`origin/2024-offer-commercial-snapshots`). Both
     unmerged branches must re-prefix, and the next free synthetic slot they will reach for is
     `1833000000000`. `1834000000000` stays clear of all three.
   - **Acceptance (automated)**: `pnpm --filter @openlinker/api migration:show` lists it; the
     13-digit prefix and the class suffix match (`scripts/check-migration-timestamps.mjs` rules 1–3).
   - **Acceptance (manual, REQUIRED, and paste the output in the PR)**:
     ```
     pnpm dev:stack:up
     pnpm --filter @openlinker/api migration:run
     pnpm --filter @openlinker/api migration:revert
     pnpm --filter @openlinker/api migration:run
     ```
     **Nothing in CI or in the test harness executes a migration.** `docs/testing-guide.md:193-198`
     states it plainly — the Testcontainers schema is built by TypeORM `synchronize`, "**No migration
     runs in this path** … the integration suite therefore does not prove that the migrations
     reproduce the entity schema" — and `grep -rn "migration:run\|runMigrations"
     .github/workflows/ apps/api/test/integration/setup.ts` returns **zero** hits (the
     `runMigrations()` line in the testing guide's illustrative snippet at `:188` is stale; the real
     harness, `libs/test-kit/src/harness.ts`, never calls it). So the int-spec in § 9 **would pass
     with a completely wrong migration**. The manual round-trip is the only gate.

### Phase 3 — Orders integration

10. **Reporting-currency service (the ladder)**
    - **Files**: `libs/core/src/orders/application/interfaces/order-reporting-currency.service.interface.ts`,
      `libs/core/src/orders/application/services/order-reporting-currency.service.ts`
      (+ `__tests__/order-reporting-currency.service.spec.ts`),
      and a `currency?: string` doc-comment field on `ConnectionConfig`
      (`libs/core/src/identifier-mapping/domain/types/connection.types.ts`)
    - **Action**: `IOrderReportingCurrencyService.resolve(sourceConnectionId): Promise<string | null>`,
      implementing the **four**-rung ladder:
      1. `readFxConfig(connection.config).reportingCurrency` — the new explicit override.
      2. `connection.config.currency` — the **existing #362 field**, reused. State the overload
         explicitly: its existing meaning is *"the currency this shop prices products in"*, read at
         `prestashop-adapter.factory.ts:120-122`. For every shipped platform the two coincide, which
         is what preserves the zero-configuration property; rung 1 exists for the operator whose
         catalogue and reporting currencies genuinely differ.
      3. `findDominantNativeCurrency(sourceConnectionId)` — the **native** currency across history.
      4. `null` ⇒ the caller uses the order's own currency and converts nothing.

      Rungs 1 and 2 both pass through the same ISO-4217 normaliser (trim, uppercase,
      `/^[A-Z]{3}$/`); a value that fails falls **through** to the next rung rather than throwing.
      The connection is read once via `ConnectionPort.get` (§ 3).
      Add the `currency` doc-comment field to `ConnectionConfig` while here — it now carries a
      second meaning and is currently undocumented (it rides the index signature at
      `connection.types.ts:109`).
    - **Acceptance**: each of the four rungs covered; a malformed rung-1 value falls through to
      rung 2 and a malformed rung-2 value to rung 3, neither throwing; the rung-2 validation table
      in § 9.
    - **Dependencies**: steps 1, 8.

11. **The stamp itself**
    - **Files**: `libs/core/src/orders/application/interfaces/order-fx-stamp.service.interface.ts`,
      `libs/core/src/orders/application/services/order-fx-stamp.service.ts`
      (+ `__tests__/order-fx-stamp.service.spec.ts`), called from
      `libs/core/src/orders/application/services/order-record.service.ts` (`persistOrder`, after the
      upsert)
    - **Action**: **one signature for both callers** —
      `stamp(internalOrderId: string): Promise<FxStampOutcome>`. The retry handler receives only an
      `internalOrderId`, and `placedAt` lives **only** inside `orderSnapshot` JSONB; rehydration
      through `libs/core/src/orders/domain/order-from-ready-snapshot.ts:65-71` uses `asOptionalDate`
      (`:183-189`), which **silently drops** an unparseable value. Two different signatures would
      therefore let the inline and retry paths legitimately disagree about whether `placedAt` exists.
      Both take `(internalOrderId)` and rehydrate from the persisted record; the inline caller pays
      one extra `findById`, which is the price of the two paths being the same code.

      Body:
      1. Resolve the reporting currency (step 10); `null` ⇒ the order's own `totals.currency`.
      2. `resolveRateDate(placedAt, rule)` (step 2). `null` ⇒ **terminal**: warn once with
         `{ internalOrderId, reason: 'no-placed-at' }`, **no stamp, no retry enqueue**, return
         `{ kind: 'terminal' }`.
      3. Reporting currency **equals** `totals.currency` ⇒ stamp
         `{ reportingCurrency, reportingTotalAmount: totals.total, exchangeRateId: null, fxRule,
         fxStampedAt: now }` with **no** rate lookup and no I/O.
      4. Otherwise `ICurrencyRateService.getRateFor(...)`, then
         `reportingTotalAmount = round2(totals.total × Number(rate))` — **multiply, never divide**
         (§ 4) — and stamp with `exchangeRateId` set.
      5. `RateUnsupportedPairError` ⇒ terminal, as (2).
      6. Any other failure ⇒ warn with `{ internalOrderId, from, to, rateDate }` and enqueue the
         retry job. **The enqueue sits in its own `try/catch`, nested inside the outer one.** Its
         dependencies (Postgres, Redis) are correlated with the failures that trigger it, so a
         single flat catch swallows the enqueue throw as well and the order is lost with nothing but
         a warn line.

      `persistOrder` must return successfully regardless. Note that `persistOrder`'s returned
      `OrderRecord` will report the FX fields as `null` **even when the stamp succeeded**, because
      `save()` does not return unassigned properties and the stamp happens after it.
      `recordCancellationIfNeeded` solves the identical problem with a re-`findById`
      (`order-record.service.ts:277-278`, whose doc comment spells out the reason). Mirror it — the
      extra read is paid only on the stamped path — **or** document the returned record's FX fields
      as non-authoritative in `persistOrder`'s doc comment. Mirroring is preferred; pick one and say
      which in the PR.
    - **Acceptance**: a throwing rate service leaves the order persisted and unstamped, does not
      propagate, and enqueues exactly one job; a throwing **enqueue** also does not propagate and is
      logged distinctly from the stamp failure; the equal-currency path asserts the rate service was
      never called; the converting path asserts an **exact** `reportingTotalAmount`; a `null`
      `resolveRateDate` asserts zero enqueues.
    - **Dependencies**: steps 5, 8, 10.

12. **Retry job**
    - **Files**: `libs/core/src/sync/domain/types/sync-job.types.ts` (add
      `'marketplace.order.fxStamp'` to `JobTypeValues`), a payload type in
      `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts`, the handler
      `apps/worker/src/sync/handlers/marketplace-order-fx-stamp.handler.ts`
      (+ `apps/worker/src/sync/handlers/__tests__/marketplace-order-fx-stamp.handler.spec.ts`),
      the `register(...)` call in
      `apps/worker/src/sync/handlers/handler-registration.service.ts`, and the provider entry in
      `apps/worker/src/sync/sync-worker.module.ts`
    - **Naming**: `marketplace.order.fxStamp`, **not** `order.fx.stamp`. Every existing value in
      `JobTypeValues` (`sync-job.types.ts:16-64`) sits under `marketplace.* | master.* | shop.* |
      shipping.* | invoicing.* | inventory.*`, and order ingestion itself is
      `marketplace.order.sync` (`:19`). A new top-level `order.*` namespace buys nothing and breaks
      the grep-ability of the existing six.
    - **Location**: `apps/worker/src/orders/` **does not exist**. Handlers live in
      `apps/worker/src/sync/handlers/` as `{job-type-kebab}.handler.ts`, with specs mostly under
      `apps/worker/src/sync/handlers/__tests__/` (a minority are colocated).
    - **Registration is two edits, not one**: adding to `JobTypeValues` alone is inert.
      `SyncJobHandlerRegistry.getHandler` (`sync-job-handler.registry.ts:39-51`) validates against
      `JobTypeValues` and then returns `null` unless `handler-registration.service.ts` has called
      `register('marketplace.order.fxStamp', this.orderFxStampHandler)` (see `:79-182` for the ~30
      existing calls), and the handler must be a provider in `sync-worker.module.ts`. The service it
      calls reaches the worker through `OrdersModule` (already imported at
      `sync-worker.module.ts:61`), so `OrdersModule` must export the new Symbol token
      (`orders.module.ts:93-101`).
    - **Action**: the handler re-invokes `IOrderFxStampService.stamp(internalOrderId)`. Idempotent
      by construction — `stampFxIfAbsent` no-ops on an already-stamped row. Returns
      `outcome: 'ok'` on success and on already-stamped; `'business_failure'` on a terminal outcome
      (no `placedAt`, unsupported pair); a transient rate failure is a retryable **throw**
      ([ADR-007](../architecture/adrs/007-syncjob-status-vs-outcome-split.md)).
    - **Acceptance**: enqueued with idempotency key `fx:{internalOrderId}` so repeated inline
      failures for one order collapse to a single job.

13. **Reconcile sweep (the guarantee that survives a dead job)**
    - **Files**: as step 12 plus `'marketplace.order.fxStampSweep'` in `JobTypeValues`, a sweep
      handler, its registration, and a scheduler task registration
    - **Why**: a dead retry job holds its idempotency key **forever**.
      `createIfNotExistsByIdempotencyKey` (`sync-job.repository.ts:62`) returns the **existing** row
      whatever its status (`:97-121` — catch `23505`, `findOne` by `idempotencyKey`, return it), keys
      are globally unique with no TTL, and the whole retry window is ~4.3 h
      (`maxAttempts: 10` at `:87`; backoff `30 s × 2^(n-1)` capped at 6 h,
      `apps/worker/src/sync/sync-job.runner.ts:41-42` and `:496-506` — the nine delays sum to
      15 330 s). So a five-hour provider outage silently loses the stamp permanently.

      Three options were considered:
      - **(a) A periodic reconcile that reads the unstamped rows directly.** Chosen.
      - (b) `requeueDeadByIdempotencyKey` (`sync-job.repository.ts:311`) — resurrects the dead job in
        place. Rejected as the primary mechanism: it still depends on the job row having been created
        in the first place, so it does not cover the case where the *enqueue* failed (step 11's
        nested catch).
      - (c) A wave-distinct idempotency key per attempt (the #742 bulk-retry pattern). Rejected: it
        defeats the collapse property that made the key useful, and unbounded key growth per order
        is worse than one periodic scan.

      (a) is the #1689 sweep precedent — "the guarantee that survives a lost event" — and it is the
      only one of the three that covers **both** a dead job and a failed enqueue.
    - **Action**: an hourly `marketplace.order.fxStampSweep` selects a bounded page of
      `order_records` where `"fxStampedAt" IS NULL AND "reportingCurrency" IS NULL` and, for orders
      newer than a cutoff, enqueues (or directly runs) the stamp. **`fxStampedAt` is what makes this
      bounded**: `WHERE "reportingCurrency" IS NULL` alone re-selects the entire pre-feature table on
      every tick, forever. A terminal outcome writes `fxStampedAt` with the other columns left
      `NULL`, so it is not re-selected either.
    - **Acceptance**: the sweep's predicate is asserted in the handler spec; a row with
      `fxStampedAt` set and `reportingCurrency IS NULL` (terminal) is **not** selected.

### Phase 4 — Frontend + the Allegro OAuth thread

14. **Reporting-currency field on Erli and WooCommerce**
    - **Files**: `apps/web/src/features/connections/components/erli-setup.schema.ts`,
      `woocommerce-setup.schema.ts`, their matching `*-setup-form.tsx`
      (+ new `erli-setup.schema.test.ts` / `woocommerce-setup.schema.test.ts` — neither exists
      today; the current tests are `erli-setup-form.test.tsx` / `woocommerce-setup-form.test.tsx`)
    - **Action**: port the PrestaShop field — the
      `z.union([trimmed-uppercased-regex, z.literal('')]).optional()` shape
      (`prestashop-setup.schema.ts:69-78`) and the omit-when-blank guard
      (`:107-109`). **Not a verbatim copy**: `erli-setup.schema.ts:40-56`'s
      `toCreateConnectionInput` returns a **literal** `config: { environment: values.environment }`,
      whereas PrestaShop builds a mutable `const config: Record<string, unknown> = {…}`
      (`prestashop-setup.schema.ts:100`) and conditionally assigns onto it. Restructure Erli's (and
      WooCommerce's) to the mutable form first, preserving the existing comment about `environment`
      being the neutral choice.
    - **New copy, per destination.** The PrestaShop label
      (`prestashop-setup-form.tsx:244-247`: "Default currency (optional)" / "ISO 4217 code applied to
      every product synced from this connection. Leave blank to persist currency as unknown.") is
      **false** on Erli and WooCommerce, neither of which is a product-sync master in this context —
      and it is now incomplete on PrestaShop too, since the field gained a second meaning. Write:
      - PrestaShop (**update**): "ISO 4217 code applied to every product synced from this connection,
        and used as the reporting currency for orders from it. Leave blank to derive it from order
        history."
      - Erli / WooCommerce (**new**): "ISO 4217 code used as the reporting currency for orders from
        this connection. Leave blank to derive it from order history."
    - **Acceptance**: submitting blank produces a `config` **without** a `currency` key; submitting
      `eur` persists `EUR`.

15. **Allegro: thread the field through the OAuth start**
    - **Files**: `apps/web/src/features/allegro/components/allegro-setup.schema.ts` +
      `allegro-setup.schema.test.ts` + the setup form,
      `apps/api/src/integrations/http/dto/allegro-oauth-connect.dto.ts`,
      `apps/api/src/integrations/http/allegro.controller.ts`
    - **Why this is not an FE field copy**: `allegro-setup.schema.ts` is **not** in
      `features/connections/components/` (it is under `features/allegro/components/`), it has **no**
      `config` object, and it has **no** `toCreateConnectionInput` — it exports
      `toStartOAuthInput()`, and the connection is created **server-side** by the OAuth callback.
    - **Action**: the mechanism already exists. `masterCatalogConnectionId` rides the same path —
      DTO field (`allegro-oauth-connect.dto.ts:74`) → `initialConfig`
      (`allegro.controller.ts:136-141`) → OAuth state → callback connection creation, where
      `initialConfig` is *"an opaque blob the host never interprets"*
      (`oauth-connection.service.types.ts:8-10`). Add `currency` the same way: one optional DTO
      field with the same ISO-4217 validation, one conditional spread into `initialConfig`, one FE
      field, one line in `toStartOAuthInput`.
    - **Acceptance**: a start-OAuth request with `currency: 'PLN'` lands a connection whose
      `config.currency === 'PLN'`; omitting it lands a `config` with no `currency` key (assert on the
      controller's `generateAuthorizationUrl` argument in the existing controller spec).
    - **If descoped**: drop Allegro from § 2 In Scope and from the acceptance criteria, and say why —
      an Allegro connection then relies on rung 3, which for a PLN-selling Allegro account is
      correct with zero configuration anyway. This plan keeps it in scope because the issue's AC
      names Allegro explicitly and the change is four small edits.

### Phase 5 — Documentation

16. **Architecture overview + engineering standards**
    - **Files**: `docs/architecture-overview.md`, `docs/engineering-standards.md`
    - **Action**:
      - Add a **Currency** bounded-context section (responsibility, key entity, location, the
        four-rung ladder, the direction invariant, the immutability rule, the core-vs-`fx-*`-package
        provider rule, the ADR link), and add the `orders → currency` edge to the cross-context
        dependency mermaid graph.
      - Add the "whoever implements FA(3) `KursWaluty` must consume this stamp" sentence
        (§ 5 Documentation gaps).
      - Add a `*.provider.ts` row to the engineering-standards file-suffix table (see § 8 naming).
    - **Acceptance**: the graph and the § Cross-context contract surface stay consistent with what
      the code imports.

### Implementation details

**`exchange_rates`**

| Column | ORM decorator | Migration DDL | Notes |
|---|---|---|---|
| `id` | `@PrimaryGeneratedColumn('uuid')` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | see below |
| `source` | `@Column({ type: 'varchar', length: 16 })` | `varchar(16) NOT NULL` | `'nbp'` |
| `fromCurrency` / `toCurrency` | `@Column({ type: 'varchar', length: 3 })` | `varchar(3) NOT NULL` | ISO-4217 |
| `rateDate` | `@Column({ type: 'date' })` | `date NOT NULL` | the rate's own date, as reported by the source |
| `rate` | `@Column({ type: 'decimal', precision: 18, scale: 8 })` | `numeric(18,8) NOT NULL` | **`string` in TS** |
| `sourceRef` | `@Column({ type: 'text', nullable: true })` | `text` | e.g. `149/A/NBP/2026` |
| `pivotCurrency` | `@Column({ type: 'varchar', length: 3, nullable: true })` | `varchar(3)` | `NULL` ⇒ direct or inverted |
| `derivation` | `@Column({ type: 'jsonb' })` | `jsonb NOT NULL` | see below |
| `fetchedAt` | `@Column({ type: 'timestamptz' })` | `timestamptz NOT NULL DEFAULT now()` | see below |

Unique: `(source, fromCurrency, toCurrency, rateDate)`.

- **`decimal`, not `numeric`, in the decorator.** House convention: `product.orm-entity.ts:23` and
  `product-variant.orm-entity.ts:45` both use `type: 'decimal'`. TypeORM emits `numeric` on Postgres,
  so the migration DDL says `numeric(18,8)` — same type, two spellings, and this is the pairing the
  repo already ships.
- **`rate` deliberately stays a `string`** and must not be `Number()`-ed in `toDomain`. Put that in
  the entity's header comment, because every other money column in the repo *is* `Number()`-ed and
  the next contributor will "fix" it. There are **zero** `transformer:` usages in any `libs/core`
  ORM entity, so none is introduced.
- **`gen_random_uuid()`, not `uuid_generate_v4()`**, with the house comment "built-in on PG ≥ 13
  (Testcontainers + prod run PG 16)". Both idioms exist in the migrations dir — the
  `gen_random_uuid()` + PG-≥-13-comment precedents are
  `1789000000000-add-product-content-field-table.ts:21,26`,
  `1805000000000-add-attribute-mappings.ts:13,26` and
  `1830000000000-add-attribute-mapping-rules.ts:20`, while
  `1831000000001-add-shop-product-status-snapshots-table.ts:24` still uses `uuid_generate_v4()`.
- **`fetchedAt` is an explicit `timestamptz` on both sides, not `@CreateDateColumn()`.** A bare
  `@CreateDateColumn()` emits `timestamp without time zone` on Postgres, so pairing it with
  `timestamptz` in the migration diverges from what `synchronize` builds — and because no gate runs
  the migration (step 9), that divergence is silent. The correct-pairing precedent is
  `shop-product-status-snapshot.orm-entity.ts:62` (bare `@CreateDateColumn()`) against
  `1831000000001-add-shop-product-status-snapshots-table.ts:31` (`"createdAt" TIMESTAMP NOT NULL
  DEFAULT now()`) — they agree because both are offset-less. `cancelledAt` is the cleaner model to
  copy: explicit `@Column({ type: 'timestamptz', nullable: true })`
  (`order-record.orm-entity.ts:94`) against `timestamptz` in
  `1832000000008-add-order-record-cancelled-at.ts:28`.
- **`source` / `fxRule` union enforcement**: add
  `CHECK ("source" IN ('nbp'))` on `exchange_rates` and
  `CHECK ("fxRule" IS NULL OR "fxRule" IN ('prev-business-day'))` on `order_records`. Precedent:
  `1790000000000-add-prompt-templates-table.ts:35-36`
  (`CONSTRAINT "ck_prompt_templates_state" CHECK ("state" IN (…))`). The cost is one extra
  migration line per future union member; the benefit is that a typo'd source cannot become an
  unqueryable row. If a reviewer prefers the TS-only union, say so explicitly in the entity header —
  do not leave it defaulted.
- **`derivation`** is `{ kind: 'direct' | 'inverted' | 'pivot', legs: [{ pair, ref, effectiveDate }] }`,
  e.g.
  ```json
  {"kind":"pivot","legs":[
    {"pair":"EUR/PLN","ref":"149/A/NBP/2026","effectiveDate":"2026-08-04"},
    {"pair":"USD/PLN","ref":"149/A/NBP/2026","effectiveDate":"2026-08-04"}]}
  ```
  `NOT NULL` — a direct rate records `{"kind":"direct","legs":[{…}]}`, so the column is never a
  "sometimes populated" field a consumer has to guess about.

**`order_records` additions**

| Column | ORM decorator | Migration DDL |
|---|---|---|
| `reportingCurrency` | `@Column({ type: 'varchar', length: 3, nullable: true })` | `varchar(3)` |
| `reportingTotalAmount` | `@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })` → `number \| null` | `numeric(12,2)` |
| `exchangeRateId` | `@Column({ type: 'uuid', nullable: true })` | `uuid` |
| `fxRule` | `@Column({ type: 'varchar', length: 32, nullable: true })` | `varchar(32)` |
| `fxStampedAt` | `@Column({ type: 'timestamptz', nullable: true })` | `timestamptz` |

Indexes and constraints:

- **A partial composite index, not a standalone one on `reportingCurrency`:**
  ```sql
  CREATE INDEX IF NOT EXISTS "IDX_order_records_reporting"
    ON "order_records" ("sourceConnectionId", "reportingCurrency")
    WHERE "reportingCurrency" IS NOT NULL;
  ```
  A single-column btree on a 1–3-distinct-value column is not selective enough for the planner to
  prefer over a sequential scan, and `@Index(['sourceConnectionId'])` already exists
  (`order-record.orm-entity.ts:39`) covering the filter half. The composite serves the actual
  analytics shape — filter by connection, group by reporting currency — and the partial predicate
  keeps every unstamped row out of it.
- **An expression index matching step 8b's aggregate**, in the same `jsonb_typeof`-guarded form the
  repository uses so the planner can use it (`order-record.repository.ts:274-281` documents exactly
  this requirement for `TOTAL_EXPR`).
- **A group-integrity CHECK**, so the five columns cannot drift into a meaningless combination:
  ```sql
  CONSTRAINT "ck_order_records_fx_group" CHECK (
    ("reportingCurrency" IS NULL AND "reportingTotalAmount" IS NULL AND "exchangeRateId" IS NULL AND "fxRule" IS NULL)
    OR ("reportingCurrency" IS NOT NULL AND "reportingTotalAmount" IS NOT NULL AND "fxRule" IS NOT NULL)
  )
  ```
  (`exchangeRateId` is legitimately `NULL` on the same-currency path, so it is not required by the
  second arm.)
- **`exchangeRateId` deliberately carries no FK and no index.** `order_records` has **zero** FKs
  today, and the analytics join lands on `exchange_rates`' own PK — so an index on the *referencing*
  side buys nothing for that direction. Stated here so a reviewer does not ask for either.

**Same-currency vs unstamped are distinguishable, and `exchangeRateId` is not the discriminator.**
A same-currency stamp has `reportingCurrency` set, `fxStampedAt` set, and `exchangeRateId NULL`.
An unstamped row has all five `NULL`. A terminal-failed row has only `fxStampedAt` set. So an
analytics consumer must use `reportingCurrency IS NULL` (or `fxStampedAt IS NULL`) to mean
"unstamped" and **never** `exchangeRateId IS NULL`, which would silently discard every
same-currency order — i.e. the overwhelming majority.

**Money arithmetic.** `reportingTotalAmount = round2(totals.total * Number(rate))`, where `round2`
is the house idiom `Math.round((v + Number.EPSILON) * 100) / 100`
(`invoice.service.ts:157-158`). Accumulating in `number` is the repo's universal money convention
and there is no decimal library to adopt instead (verified: zero hits for `decimal.js`, `big.js`,
`bignumber.js`, `dinero`, `currency.js` in any `package.json`). `pricing-rule.types.ts:136-138`'s
`round2dp` is **not** reusable as-is: it is module-private **and** clamps with `Math.max(0, …)`,
which would silently turn a refund or a negative total into `0`. Either export it without the clamp
or declare a local `round2` — do not import the clamping version.

**Configuration**: no new environment variables. Two JSONB keys on `Connection.config`:
`currency` (already exists, #362) and `fx` (new, optional).

**Events**: none emitted, none consumed.

**Error handling**: `RateUnavailableTransientError`, `RateUnsupportedPairError`,
`DuplicateExchangeRateError` (all under `libs/core/src/currency/domain/exceptions/`). The repository
converts the PG `23505` unique violation; the provider raises the two rate errors. None escapes to
the ingestion caller — `OrderFxStampService` maps them to terminal-vs-retry and swallows both.

---

## 7. Alternatives Considered

Fully argued in [ADR-040](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md);
summarised here.

### Alternative 1: a global reporting-currency setting
A singleton row mirroring `ai_provider_active_setting`. **Rejected** by the operator: it forces a
deployment-wide answer to a question a single-currency estate never has to ask, and analytics
silently breaks when the setup step is skipped. The connection-derived ladder reaches the same
outcome with zero configuration.

### Alternative 2: reporting currency = the DESTINATION connection's currency
**Rejected**: analytics reports what the buyer paid on a channel, not what the fulfilling shop
booked; and an order fanned out to two destinations would have two reporting currencies.

### Alternative 3: convert at read time in the analytics query
**Rejected**: the reported figure would move whenever the rate did — the exact "quietly wrong
number" failure the analytics read model (#1985) exists to prevent.

### Alternative 4: one rate row per order
**Rejected**: multiplies identical rows by order volume and turns "which rate did we use on
3 August" into a `DISTINCT` scan instead of a unique-index read.

### Alternative 5: stamp via the existing `persistOrder` upsert
**Rejected** — but not for the reason the earlier draft gave. `toOrm` does **not** write every
column: it deliberately omits `cancelledAt`, with a 10-line comment
(`order-record.repository.ts:735-744`) giving exactly this reason — `upsert` is
`Repository.save(entity)` (`:570-575`), a full-object save with no per-order lock, and two ingestion
paths (webhook + reconciliation poll) legitimately race for the same order, so writing the column
there would let a stale in-memory read stomp a value a concurrent atomic write already committed.
Leaving the ORM property unset makes TypeORM omit the column from the generated `UPDATE` entirely.

So the correct framing is: the mechanism this feature needs **already exists and is proven** —
`cancelledAt` + `markCancelled` (`:561-568`) is the closest precedent, and the FX group follows it
exactly. What that precedent also ships, and what this plan must copy, is a **regression spec**:
`__tests__/order-record.repository.spec.ts:270-283` asserts
`callArg.cancelledAt` is `undefined` in the entity passed to `save()`. Add the equivalent for all
five FX columns. Without it, a future contributor who "completes" `toOrm` reintroduces the stomp and
nothing fails.

(`fulfillmentState` is the counter-example: it *is* written by `toOrm` and *is* reset to `null` by a
re-poll. Pre-existing, out of scope, and the concrete reason this feature does not join that write
path.)

---

## 8. Validation & Risks

### Architecture compliance

- ✅ Hexagonal layering — domain (types, ports, pure rule derivation) → application (services) →
  infrastructure (providers, repositories); no framework import in `domain/`.
- ✅ CORE ↔ Integration boundary — no plugin package touched; no capability port added; no
  `platformType` branching anywhere.
- ✅ Cross-context contract — `orders` imports `ICurrencyRateService`, its Symbol token,
  `FX_RATE_RULES` and `readFxConfig` from `@openlinker/core/currency`, and `ConnectionPort` +
  `CONNECTION_PORT_TOKEN` from `@openlinker/core/identifier-mapping` (both single-`Port`-suffix /
  `I*Service` / `*_TOKEN` / `UPPER_SNAKE` shapes on the allow list). `currency` imports nothing from
  a sibling core context. **Verify by grep, not by the invariant script** — `classifyName`
  default-allows unrecognized names (`scripts/check-cross-context-imports.mjs:588`).
- ✅ Symbol-token convention — `currency.tokens.ts` is Symbol-only, star-exported from the barrel.
- ✅ Service-interface rule — every `application/services/*.service.ts` has its interface file.
  This is also why the ladder is a `*.service.ts` and not a `*.resolver.ts`: `isServiceFile`
  (`scripts/check-service-interfaces.mjs:74-80`) matches only `.service.ts`, so a `*.resolver.ts`
  would **evade** the invariant rather than satisfy it. `find libs/core/src -name '*.resolver.ts'`
  is empty; the only five `*.resolver.ts` files in the repo are PrestaShop infrastructure helpers
  under `libs/integrations/prestashop/src/infrastructure/provisioners/`.

### Naming conventions

- ✅ `*.types.ts`, `*.port.ts`, `*.orm-entity.ts`, `*.repository.ts`, `*.service.ts` +
  `*.service.interface.ts`, `*.spec.ts`, `{job-type-kebab}.handler.ts`.
- ⚠️ `nbp-exchange-rate.provider.ts` uses a `*.provider.ts` suffix, which is **not** in the
  standards' file-suffix table. `*.adapter.ts` is the documented name for "implements a port", but
  it is strongly associated with the plugin/capability system this change deliberately avoids, and
  the class would read `NbpExchangeRateAdapter` — inviting exactly the "why isn't this a plugin?"
  confusion ADR-040 rules out. **The suffix is being overloaded either way**: the only two existing
  `*.provider.ts` files in the repo (`apps/api/src/auth/adapters/mailer.provider.ts`,
  `apps/api/src/mcp/tools/mcp-tool-definitions.provider.ts`) are Nest **DI factories** exporting a
  `Provider` object, not port implementations. Step 16 therefore documents the suffix in
  `docs/engineering-standards.md` with both meanings named, rather than leaving a third undocumented
  convention in the tree. Renaming to `*.adapter.ts` is mechanical if a reviewer prefers it.

### Risks

- **Silent wrong-direction conversion.** The single highest-consequence failure: multiplying where a
  division was needed (or vice versa) produces a plausible number, never throws, and is wrong by the
  square of the rate. *Mitigation*: the invariant is stated in § 4, in the entity header, and pinned
  by an exact-value unit test at both the provider and the stamp-service tier (§ 9).
- **Collision with the unmerged #1985.** Both add columns to `order-record.orm-entity.ts`, trailing
  params to the `OrderRecord` constructor, and a migration in the same range (#1985's is
  `1832000000008-add-order-analytics-read-model.ts`, which adds `placedAt`, `currency`,
  `taxTreatment`, `totalAmount`). *Mitigation*: additive changes appended at the end of both lists;
  whichever merges second rebases. This migration is `1834000000000`, clear of the three-way claim on
  `1832000000008` and of the `1833000000000` slot both unmerged branches will reach for (step 9).
  **A bonus once #1985 lands**: `findDominantNativeCurrency` can drop its JSONB expression for
  `order_records."currency"`. Deliberately not depended on.
- **Ingestion latency on the first foreign-currency order of a day.** One NBP round trip inside
  `persistOrder`. *Mitigation*: the rate date comes from the calendar (step 0/2) rather than from a
  walk-back, so the common case is **one** request, not seven; a hard timeout on the injected
  `FetchLike`; and the try/catch + retry + sweep path — a slow or dead NBP degrades to an unstamped
  order, never a failed ingestion.
- **Rounding, with real bounds.** An 8-dp rate carries an absolute rounding error ≤ 5e-9; against a
  typical PLN rate of ~3.5 that is a **relative** error of ~1.4e-9, so the rounded cent is only at
  risk above roughly `0.005 / 1.4e-9 ≈ 3.6 M` units of the source currency. Comfortably outside any
  realistic order.
  **A PLN-pivoted cross is materially worse.** NBP publishes `mid` to **4** decimal places, so each
  leg carries a relative error of order 1e-5 (0.5e-4 against a mid of O(1)–O(5)); dividing two legs
  compounds to roughly 2e-5–1e-4 depending on the mids' magnitudes. At 2.5e-5 the cent is at risk
  above only ~200 units — an *ordinary* order size. That is a property of NBP's published precision,
  not of the `numeric(18,8)` column, and it is why a cross-rate figure is an analytics figure and
  never a fiscal one (ADR-040 § Consequences). *Mitigation*: the full-precision rate plus its
  `derivation` legs are stored, so any figure can be recomputed and audited from the join.
- **A dead retry job would lose the stamp forever.** Addressed by step 13's reconcile sweep; the
  reasoning and the rejected alternatives are recorded there.
- **The rung-3 aggregate shifting.** A connection's dominant **native** currency can change as
  history accumulates, producing two reporting-currency eras. *Mitigation*: already-written stamps
  are never recomputed; setting rung 1 or rung 2 pins it; the `, c ASC` tie-break removes the
  50/50-split flapping case; documented in ADR-040. **Not** mitigated: nothing surfaces the resolved
  value to the operator (§ 5 open question 2).

### Edge cases

| Case | Handling |
|---|---|
| `from === to` | identity short-circuit before any I/O; `exchangeRateId` stays `NULL`, `reportingCurrency` + `fxStampedAt` set |
| Connection has no order history and no rung-1/2 value | reporting = the order's own currency, no conversion |
| `placedAt` absent (every WooCommerce order) | `resolveRateDate` → `null` ⇒ **terminal**: warn, `fxStampedAt` set, no other column, no retry job. Never a `RangeError` out of `Intl` |
| `placedAt` present but an Invalid Date | same terminal path — `order-ingestion.service.ts:638` has no `Number.isNaN` guard, so this reaches the stamp service |
| Order placed 23:30 UTC Sunday | Warsaw is UTC+1/+2, so this is already **Monday** 00:30/01:30 in Warsaw ⇒ rate date = the **previous Friday**. (The earlier draft's "00:30 UTC" case was backwards: 00:30 UTC Monday is 01:30/02:30 the *same* Monday and shifts nothing.) |
| Monday order | rate date = Friday |
| Saturday / Sunday order | rate date = the preceding Friday (calendar, not walk-back) |
| Order the day after a holiday cluster | calendar skips the cluster; the walk-back is not exercised |
| NBP unexpectedly has no table for a calendar working day | 404 walk-back, bounded at 7; the **actual** `effectiveDate` is persisted |
| Currency absent from NBP table A | `supports()` false ⇒ terminal, `business_failure`, no 70-request storm |
| NBP answers 400 (malformed / out-of-range date) | any non-404 4xx ⇒ terminal |
| Pivot legs resolve to different `effectiveDate`s | raise (terminal) — never silently pick one |
| Source clock ahead / future `placedAt` | `min(resolved, todayInWarsaw)` clamp |
| NBP 5xx / timeout | order persisted unstamped, warn, retry job enqueued; sweep is the backstop |
| Retry-job enqueue itself throws | logged distinctly (nested `try/catch`); the sweep still recovers the row |
| Retry runs after siblings populated rung 3 | the retry can legitimately stamp a **different** reporting currency than the inline path would have. Accepted: the stamp records the ladder's answer at stamp time, and `fxRule` + `exchangeRateId` make it auditable. Covered by a test |
| Inline stamp races the retry job | `stampFxIfAbsent`'s `IsNull()` predicate means exactly one wins; the loser returns `false` and no-ops |
| Two workers ingesting concurrently | `insertIfAbsent` collapses to one rate row via insert-then-recover |
| `totals.total === 0` | stamped as `0`; no special case |
| Negative / refund total | `round2` must **not** clamp at 0 (see § 6 money arithmetic) |
| Order re-ingested after a rate change | stamp untouched (`reportingCurrency IS NULL` guard fails) |
| `persistOrder`'s returned record | FX fields read `null` even when stamped, unless step 11's re-`findById` is taken |

### Backward compatibility

- ✅ All five columns nullable; `exchange_rates` is new. No existing read changes shape.
- ✅ Pre-existing orders keep `reportingCurrency IS NULL`; analytics consumers must treat `NULL` as
  "not stamped", not as zero — and must not use `exchangeRateId IS NULL` for that (see § 6).
- ✅ Connections without rung-1/rung-2 values behave exactly as today until their first order.
- ✅ `readFxConfig` on a connection with no `fx` key returns the documented default, so no connection
  needs editing.

---

## 9. Testing Strategy & Acceptance Criteria

No `coverageThreshold` is configured anywhere — `jest.config.js:8`, `libs/core/jest.config.js:27` and
`apps/api/jest.config.js:11` set only `collectCoverageFrom`. So the "90%+ on core domain logic"
standard is **aspirational, not enforced**; the case list below is the actual contract. CI does run
`pnpm test:ci` (`.github/workflows/ci.yml:133`) and `test:integration` (`:286`), so the local
lint+type-check-only gate is fine for code — but see step 9 for why it is not a backstop for the DDL.

### Unit tests

| Subject | Cases | File |
|---|---|---|
| `previousWorkingDay` | Monday→Friday, Saturday→Friday, Sunday→Friday, holiday cluster, DST-transition day | `libs/shared/src/date/__tests__/pl-working-days.spec.ts` |
| `resolveRateDate` | mid-week; **Monday**; **Saturday**; **Sunday** (the two cases the branch exists for); a **Europe/Warsaw DST-transition** day; **23:30 UTC Sunday** → previous Friday; `undefined` `placedAt` → `null`; Invalid Date → `null`; future `placedAt` → clamped to today-in-Warsaw | `libs/core/src/currency/domain/__tests__/rate-date-resolution.spec.ts` |
| NBP provider | direct; inverted; **cross-rate with an exact expected value** (EUR mid 4.2500 / USD mid 3.9000 → `1.08974359`); 404 walk-back; exhausted walk-back → `RateUnsupportedPairError`; **400** → terminal; 503 → transient; timeout → transient; `supports()` false; **pivot legs with different `effectiveDate`s → raise** | `.../infrastructure/providers/__tests__/nbp-exchange-rate.provider.spec.ts` |
| `CurrencyRateService` | identity; registry hit performs **no** provider fetch; `DuplicateExchangeRateError` → re-select winner; `RateUnsupportedPairError` propagates | `.../application/services/__tests__/currency-rate.service.spec.ts` |
| `ExchangeRateRepository.insertIfAbsent` | PG `23505` → `DuplicateExchangeRateError`; any other error propagates unchanged | `.../repositories/__tests__/exchange-rate.repository.spec.ts` |
| `readFxConfig` | exhaustive coercion table: absent, `null`, non-object, unknown `rule`, unknown `source`, correct value, and the same ISO validation table as the ladder | `libs/core/src/currency/domain/types/__tests__/fx-config.types.spec.ts` |
| Reporting-currency ladder | all **four** rungs; rung-1 malformed → falls to rung 2; rung-2 malformed → falls to rung 3; **rung-2 ISO validation table**: `'eur'`, `'EU'`, `'EURO'`, `'985'`, `'  EUR  '`, `42`, `null`, `''` | `libs/core/src/orders/application/services/__tests__/order-reporting-currency.service.spec.ts` |
| `OrderFxStampService` | equal-currency asserts the rate service was **never** called; **converting path asserts an EXACT `reportingTotalAmount`** (e.g. `100.00 × 4.25 = 425.00`, and a non-trivial one such as `123.45 × 1.08974359 = 134.53`); provider-failure degrade (persisted, unstamped, one job enqueued); **enqueue-throws** does not propagate and logs distinctly; `null` rate date → terminal, **zero** enqueues; unsupported pair → terminal; **retry stamps a different reporting currency than the inline path would have** | `.../services/__tests__/order-fx-stamp.service.spec.ts` |
| `round2` boundaries | `x.005` half-up (e.g. `2.005 → 2.01`), `0`, a **negative/refund** total stays negative (the `pricing-rule.types.ts` clamp trap), a large magnitude | wherever `round2` lands |
| `stampFxIfAbsent` guard | asserts `toHaveBeenCalledWith({ internalOrderId, reportingCurrency: IsNull() }, {…five columns…})` and `false` when `affected` is 0 (precedent: `shipment.repository.spec.ts:383-386`) | `.../repositories/__tests__/order-record.repository.spec.ts` |
| `findDominantNativeCurrency` | emitted SQL carries the `jsonb_typeof(...) = 'string'` guard and the `, c ASC` tie-break | same file |
| **`toOrm` omits all five FX columns** | asserts each is `undefined` on the entity passed to `save()` (mirrors the `cancelledAt` regression spec at `:270-283`) | same file |
| Retry handler | stamps; no-ops when already stamped; terminal → `business_failure`; transient → retryable throw; **the idempotency key collapses repeated failures for one order** | `apps/worker/src/sync/handlers/__tests__/marketplace-order-fx-stamp.handler.spec.ts` |
| Sweep handler | predicate is `fxStampedAt IS NULL AND reportingCurrency IS NULL`; a terminal row (`fxStampedAt` set) is **not** selected | `apps/worker/src/sync/handlers/__tests__/marketplace-order-fx-stamp-sweep.handler.spec.ts` |
| FE schemas | blank omits the key; lowercase normalises | `apps/web/src/features/connections/components/{erli,woocommerce}-setup.schema.test.ts` |
| Allegro OAuth start | `currency: 'PLN'` reaches `initialConfig`; omitted leaves no key | the existing `allegro.controller.spec.ts` + `allegro-setup.schema.test.ts` |

**What is deliberately NOT a unit test**: "two concurrent `insertIfAbsent` calls resolve to a single
row". Every one of the 23 `*.repository.spec.ts` files in `libs/core` mocks `Repository<T>` — 14 via
`getRepositoryToken` (`order-record.repository.spec.ts:11-52` is the reference), the other nine by
hand-constructing the mock and passing it to the constructor — so there is no database to serialise
anything and "one row" is unobservable. It moves to int-spec scenario 5. The `stampFxIfAbsent`
**guard shape** is legitimately a unit test, because what is being asserted is the *argument*, not
the outcome.

### Integration tests

`apps/api/test/integration/orders/order-fx-stamp.int-spec.ts` — one vertical slice on the real
Postgres harness with a **faked provider** (never a live NBP call in any tier):

1. **The degrade path**: provider throws → order persisted, all five FX columns `NULL`, **zero**
   `exchange_rates` rows, exactly one `marketplace.order.fxStamp` job in `sync_jobs`. (This replaces
   the earlier draft's same-currency scenario, which is near-tautological once the short-circuit is
   unit-tested — and this is the path the whole § 8 risk section rests on.)
2. Ingest a foreign-currency order → stamped, one `exchange_rates` row created with the expected
   `rate`, `rateDate`, `source`, `sourceRef`, `derivation`.
3. Ingest a **second** foreign-currency order, same day and pair → still exactly one rate row.
4. Re-ingest order 2 with the provider now returning a different rate → all five columns unchanged.
5. **Concurrency**: `Promise.all` of two `insertIfAbsent` calls for the same key → neither throws and
   `SELECT count(*) FROM exchange_rates WHERE …` is `1`.

Add `exchange_rates` to `tablesToTruncate` in `apps/api/test/integration/setup.ts:60` — a table not
listed there is never cleaned between tests.

### Mocking strategy

- Mock `ExchangeRateProviderPort` (the port) — never the concrete NBP class.
- Mock `FetchLike` in the NBP provider spec — never `globalThis.fetch`, and never a live HTTP call in
  any tier.
- Mock `ConnectionPort` for the ladder's rungs 1–2.
- Real Postgres in the int-spec; everything else mocked per the testing guide.

### Acceptance criteria

Inlined from #2049, with `base*` → `reporting*` and the three-rung ladder corrected to four.

- [ ] `exchange_rates` exists with a unique constraint on `(source, fromCurrency, toCurrency,
      rateDate)`; two concurrent get-or-create calls for the same key resolve to one row and neither
      throws (int-spec scenario 5).
- [ ] `exchange_rates` carries `pivotCurrency` and `derivation`, so an inverted or pivoted rate
      records how it was obtained and the document references of its legs.
- [ ] `order_records` carries `reportingCurrency`, `reportingTotalAmount`, `exchangeRateId`,
      `fxRule`, `fxStampedAt`, all nullable, with the partial composite index and the group CHECK.
- [ ] An order whose currency equals its source connection's reporting currency is stamped with
      `reportingTotalAmount === totals.total`, `exchangeRateId === null`, and **no** rate lookup is
      performed (assert the provider is never called).
- [ ] An order whose currency differs is stamped with the rate for the previous **Polish working
      day** relative to `placedAt` in `Europe/Warsaw`, `reportingTotalAmount` equals
      `round2(total × rate)` **exactly** (asserted numerically), and `exchangeRateId` resolves to a
      row carrying that rate, its date, its source, and its `sourceRef`.
- [ ] Re-ingesting an already-stamped order (re-running `syncOrderFromSource` for the same external
      id) leaves all five FX columns byte-identical.
- [ ] The ladder returns the explicit `config.fx.reportingCurrency`; then `config.currency`; then the
      connection's dominant **native** currency from history; then the order's own currency. A
      malformed value at any rung falls through rather than throwing.
- [ ] The rung-3 aggregate reads the **native** currency, never `reportingCurrency`, and carries a
      deterministic tie-break.
- [ ] `resolveRateDate` is pure and covered for: mid-week, Monday, Saturday, Sunday, a
      Europe/Warsaw DST-transition day, the 23:30 UTC Sunday roll, an absent `placedAt`, an invalid
      `placedAt`, and a future `placedAt`.
- [ ] A missing or invalid `placedAt` is **terminal** — no stamp, no retry job, no `RangeError`.
- [ ] A currency the provider does not support is a terminal `business_failure`, not a retry.
- [ ] A transient rate-provider failure leaves the order persisted with
      `reportingCurrency IS NULL`, emits a warn log, and enqueues the retry job; ingestion itself
      succeeds. A failure of the **enqueue** is logged distinctly and does not propagate.
- [ ] A stamp lost to a dead retry job is recovered by the periodic reconcile sweep.
- [ ] Cross-rate resolution via the PLN pivot is covered with an exact expected value, and a pivot
      whose legs disagree on `effectiveDate` raises.
- [ ] `Connection.config.fx` is read by a pure helper, living in `currency`, that coerces a
      missing/malformed value to the documented default and takes config **structurally**.
- [ ] The Erli, WooCommerce and Allegro setup paths accept an optional ISO-4217 currency and omit the
      key entirely when blank; the field's copy is accurate for each destination and the PrestaShop
      copy is updated for the field's second meaning.
- [ ] `libs/core/src/currency/` imports no sibling core context (verified by grep **and**
      `pnpm check:invariants`).
- [ ] The migration's 13-digit prefix sorts after every migration on `main` and in every dir in
      `scripts/plugin-migration-dirs.json`; its class suffix matches the filename; and a manual
      `migration:run` → `migration:revert` → `migration:run` round-trip against the dev stack is
      pasted in the PR.
- [ ] `toOrm` still omits every FX column, asserted by a regression spec.
- [ ] Tests added or updated for non-trivial logic.
- [ ] No architecture boundary violations (CORE ↔ Integration).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no plugin package, no capability port; the first
      outbound HTTP call in `libs/core`, bounded by the injected-`FetchLike` + `fx-*`-package rules
      in § 3)
- [x] Uses existing patterns (denormalized columns, narrow absolute-set writes, guarded claim-write,
      insert-then-recover get-or-create, config coercion, the existing PL working-day calendar) — no
      new abstraction introduced
- [x] Idempotency considered (`stampFxIfAbsent` guard, `insertIfAbsent`, idempotent retry job,
      reconcile sweep)
- [x] Event-driven patterns used where applicable (none apply; the retry + sweep use the existing
      job queue)
- [x] Rate limits & retries addressed (calendar-first rate date, bounded walk-back, HTTP timeout,
      transient-vs-terminal split, degrade-to-job, sweep backstop)
- [x] Error handling comprehensive (three domain exceptions, none escapes ingestion, terminal and
      transient separated per ADR-007)
- [x] Testing strategy complete (unit + one int-spec vertical slice, no live HTTP, coverage
      enforcement honestly described as absent)
- [ ] **Naming conventions followed — with one documented deviation.** `*.provider.ts` is not in the
      standards' file-suffix table and the suffix is already overloaded by two Nest DI factories.
      Step 16 adds the table row; until it lands this is a deviation, not a pass.
- [x] File structure matches standards
- [ ] **Plan is execution-ready — except for two unresolved items.** § 5 open question 1
      (#1987/#1988 acceptance criteria contradict this stamping model) is a product precondition for
      those issues; § 5 open question 2 (nothing surfaces the resolved reporting currency to the
      operator) has no owner. Neither blocks starting Phase 0–3, and both must be resolved before
      #1987.
- [x] Plan is saved as a markdown file

---

## Related Documentation

- [ADR-040 — Order-time FX stamping against a system-wide reporting currency](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md)
- **Order analytics read model** — issue **#1985** (branch `origin/1985-order-analytics-read-model`).
  Referenced by issue number rather than by link: its ADR is not on `main`, so a relative link would
  land as a 404 if this branch merges first.
- [ADR-007 — SyncJob status vs outcome split](../architecture/adrs/007-syncjob-status-vs-outcome-split.md)
- [ADR-038 — Per-connection outbound rate limiting](../architecture/adrs/038-per-connection-outbound-rate-limiting.md)
  (why `HttpTransportFactoryPort` does not apply here — see § 3)
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Database Migrations](../migrations.md)
- `docs/specs/product-spec-1976-analytics.md` (the "reporting currency" naming, `:267`)
