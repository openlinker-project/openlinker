# Implementation Plan: Order-time FX rate snapshot + reporting-currency stamping

**Date**: 2026-08-13 (revised 2026-08-14 for the ADR-040 revision)
**Status**: Ready for Review (one item unresolved — see § 5 and § 10)
**Issue**: #2049
**ADR**: [ADR-040](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md)
**Estimated Effort**: 4–5 days (BE ~3 d, FE ~0.5 d, tests ~1.5 d), ~35–40 files touched. For
calibration: `implementation-plan-846-shipment-read-command-api.md:5` sizes "M (3–7 days)" for ~17 new
files with no external provider and no decimal arithmetic; this has both, plus a migration, plus two
new package-exports subpaths and a new workspace package.

**Re-baseline against the pre-revision estimate**: the reporting-currency ladder, `readFxConfig`, the
three FE connection-setup fields and the Allegro OAuth thread are all **removed**; a settings stack
(entity, port, repository, service, controller, DTOs, FE tile), the `@openlinker/integrations-fx`
package, a second provider adapter, and the first-attempt intent snapshot are **added**. Net roughly
flat.

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

The reporting currency is **one system-level setting**, resolved `settings row →
OL_REPORTING_CURRENCY → 'EUR'`. It is a property of the reporting entity — a business *choice* — not
of a sales channel, which only reports *facts*. A connection-derived ladder was considered and
rejected; see
[ADR-040](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md)
for that decision and its alternatives.

**Classification**: CORE (new bounded context + orders integration), one new integration package
(`@openlinker/integrations-fx`), a thin Frontend slice (a settings tile), one API-layer settings
controller, and one Infrastructure migration.

---

## 2. Scope & Non-Goals

### In Scope

- New leaf core context `libs/core/src/currency/` — rate registry, provider **port + registry**, rule →
  rate-date derivation, and the reporting-currency setting. **No outbound HTTP in `libs/core`.**
- New workspace package `@openlinker/integrations-fx` — `NbpExchangeRateAdapter`,
  `EcbExchangeRateAdapter`, `FakeExchangeRateAdapter`, registered into the core registry at boot.
- `exchange_rates` table (shared, immutable, get-or-create) with cross-rate provenance.
- **Six** nullable columns on `order_records` + the narrow stamp-once write path + the first-attempt
  intent claim.
- System reporting-currency setting: singleton `reporting_currency_setting` row, service with the
  three-rung resolution chain, admin `GET`/`PUT`, **save-time provider-coverage validation**, and a
  settings-page tile rendering `EUR (default)` until explicitly set.
- Source selection by reporting currency (`PLN → NBP`, `EUR → ECB`), non-publication-day handling
  driven by the existing Polish working-day calendar in `@openlinker/shared/date`, plus ECB's own
  calendar absorbed by its adapter.
- A retry sync job **plus** a periodic reconcile sweep for orders that could not be stamped inline.
- One TypeORM migration, with a manual `up`/`down`/`up` acceptance run.
- `previousWorkingDay` added to `libs/shared/src/date/pl-working-days.ts`.
- `OL_REPORTING_CURRENCY` in `apps/api/.env.example`, `apps/worker/.env.example` and the root
  `./.env.example`, plus a `docker-compose.demo.yml` passthrough.
- `placedAt` mapping in the WooCommerce order-source adapter (one line — see § 5 open question 4).
- `CurrencySettingsController` added to `CONTROLLERS` in
  `apps/api/src/auth/write-guard-coverage.spec.ts`.

### Out of Scope

- **Backfilling historical orders.** Pre-existing rows keep `reportingCurrency IS NULL`.
- **Restating orders already stamped under a previous setting.** Distinct from the backfill above: the
  data is retained and computable, but the job is a filed follow-up (ADR-040 § Decision 8 /
  § Migration path). What ships here is the honesty rail — the `PUT` reports how many stamped rows
  exist, so the operator sees the era split before accepting it.
- **A third reporting currency.** The setting accepts `PLN` and `EUR` only; the pivot path stays
  implemented so a third is additive (a third provider + one mapping entry).
- **The analytics queries themselves** (#1987 / #1988). This ships the columns they read. Their
  acceptance criteria currently group by the *native* currency — see § 5 open question 1.
- **A second rate rule.** The rule is persisted per stamp so a second is additive; none is built now.
- **NBP tables B and C.** Table B is the weekly exotic set (~110 currencies) on a different endpoint;
  table C is bid/ask. Only table A (the daily statutory average) is read. A currency present only in
  table B is permanently unreachable and reports as unsupported (terminal).
- **Per-connection FX configuration.** There is no `Connection.config.fx` key at all — the rule and
  the source are code constants (the rule still persisted per stamp for auditability), and the
  reporting currency is system-level. `Connection.config.currency` (#362) keeps its existing meaning
  and is not consulted here.
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
Integration (`libs/integrations/fx/` — new package), Shared (`libs/shared/src/date/` — one function),
Infrastructure (migration), Interface (one API settings controller + DTOs, one FE settings tile), App
(`apps/worker` job handlers + module wiring, `apps/{api,worker}/src/plugins.ts`).

**Capabilities involved**: none. This deliberately introduces **no capability port** — an exchange
rate is not a per-connection integration capability, it is a shared read of a public reference source,
so there is no manifest entry and no `getCapabilityAdapter` path. The precedent for "an integration
package that is not a plugin" is `@openlinker/integrations-ai`: it appears in `apiPlugins` /
`workerPlugins` purely as a module-composition seam (`PluginRegistryModule.forRoot` only does
`imports` + `exports`), registers no manifest, and binds a core-declared token.

**Existing services reused**:

| Service / helper | Used for |
|---|---|
| `OrderRecordRepositoryPort` | the distinct-native-currency read (coverage advisory) and the narrow stamp + intent writes |
| `SyncJobQueuePort` / the worker handler pattern | the retry job + reconcile sweep |
| `Logger` (`@openlinker/shared/logging`) | warn-on-degrade |
| `isPlWorkingDay` / `addWorkingDays` (`@openlinker/shared/date`) | the Polish working-day calendar (see step 2) |
| `FetchLike` (`@openlinker/shared/http`) | the injected transport for both provider adapters |
| `AiProviderActiveSettingsService` + its ORM entity / repository | the **singleton-settings** shape copied for the reporting currency (see step 5b) |
| `AdapterRegistryService` | the **core-registry-populated-by-integration-modules** shape copied for the provider registry (see step 3a) |
| `IdentifierMappingService.getOrCreateInternalId` | the **insert-then-recover** get-or-create pattern (see § 4) |
| `ShipmentRepository.claimWaybillRelay`-shaped guarded write | the stamp-once and intent-claim conditional UPDATEs (see § 4) |
| `OrderRecordService.recordCancellationIfNeeded` | the conditional-re-read shape for `persistOrder`'s return value (see step 11) |

**No connection read at all.** The pre-revision plan read `Connection.config` through `ConnectionPort`
for the ladder's rungs 1–2. With a system-level setting there is nothing per-connection to read, so
that dependency — and the whole "why not `IIntegrationsService`" argument that went with it — is gone.
`orders` depends on `currency` and on nothing new.

**New components required**: see § 6.

**Core vs Integration split**: the *contract* cannot live in an integration package — the rate registry
is shared across every connection (that is the whole point of keying rows by `(source, pair, date)`
rather than per order), the reporting-currency setting is system-level, and the stamp is written onto a
core table. The *implementations* cannot live in core, because that would put the first outbound HTTP
call in `libs/core`. So the boundary is the ordinary one: port + registry + rate-date rules in
`libs/core/src/currency/`, every adapter in `@openlinker/integrations-fx`.

There is deliberately **no** "keyless providers may live in core" carve-out. Conditioning package
placement on whether a vendor happens to require an API key keys the architecture to someone else's
auth policy, is not expressible in `check:invariants`, and would force an adapter to *move packages*
the day NBP or ECB adds a key.

**Guard additions required** (these are opt-in per package, so a new package is invisible to them
until listed): add `libs/integrations/fx` to `scripts/check-outbound-http.mjs`'s `SCAN_ROOTS`
(lines 53–63, currently the nine existing `libs/integrations/*` packages) **and** to the matching
ESLint `no-restricted-globals: fetch` glob list (`.eslintrc.js:528–557`). Both adapters take an
injected `FetchLike` (`@openlinker/shared/http`, barrel export at `libs/shared/src/http/index.ts:8-12`)
rather than the global — which is what makes step 3b's faked-HTTP tests possible without
`jest.spyOn(globalThis)` — so exactly **one** scoped `// eslint-disable-next-line no-restricted-globals`
is needed, at the single `FX_FETCH_TOKEN` default-factory site in `fx-integration.module.ts`, with its
reason inline (the same per-line shape Allegro's OAuth-token exemptions use).

ADR-038's `HttpTransportFactoryPort.forConnection(connection, defaultRateLimit)`
(`libs/shared/src/http/http-transport-factory.port.ts:52-55`) is **structurally unusable** here: it
keys its cached transport and its rate-limit bucket on `connection.id`, and a reference-rate read has
no connection. Passing a synthetic connection would create a bucket that means nothing. Each adapter
takes a plain `FetchLike` plus its own timeout.

**Cross-context dependency direction** (`docs/architecture-overview.md` § Cross-context
dependencies):

```
orders   ──▶ currency          (new edge: ICurrencyRateService + IReportingCurrencySettingsService
                                + their Symbol tokens, from the barrel)
currency ──▶ (nothing in core) ← leaf; consumes @openlinker/shared only
integrations-fx ──▶ core/currency   (port, registry port, module, tokens — allow-listed shapes)
core ──▶ integrations-fx: NEVER    (binding is supplied at the host, see below)
```

`currency` stays a **leaf** on purpose: the caller passes already-resolved plain values down, so
`currency` never needs `integrations`, and the `orders → currency → orders` cycle a naive "resolve
everything inside currency" design would create never appears. `libs/core` already declares
`@openlinker/shared` in `dependencies` (`libs/core/package.json:185`) and references it in
`tsconfig.json`, so consuming `@openlinker/shared/date` and `/http` needs no manifest edit.

**How the binding crosses without reversing the direction.** Nothing in `libs/core` imports
`@openlinker/integrations-fx`. `FxIntegrationModule` is added to `apiPlugins` / `workerPlugins`
(`apps/{api,worker}/src/plugins.ts`), `PluginRegistryModule.forRoot` re-exports it, and its
`onModuleInit` registers each adapter into the core `ExchangeRateProviderRegistryService` — byte-for-byte
the mechanism integration modules already use for `AdapterRegistryService` (#570/#571). `CurrencyModule`
must therefore stay a **static** `@Module` (never `forRoot`), so core and the fx package share one
registry instance. The fx package also needs a `dependencies` entry for `@openlinker/core` +
`@openlinker/shared` and `tsconfig` `references` for both — per § Workspace dependency declarations in
the engineering standards, the manifest edge is what gives `pnpm -r` its build order (a tsconfig
reference alone does not, and omitting it caused #2011).

**Both hosts register it.** Order ingestion is worker-only in practice — `apps/worker/src/sync/handlers/`
holds the only `syncOrderFromSource` callers, and the FX retry job and reconcile sweep are worker
handlers too — so the worker is load-bearing. Register in the API as well (matching the dual
registration WooCommerce / InPost / Subiekt / AI already have): core `OrdersModule` is instantiated in
`apps/api/src/app.module.ts`, and a future API-side restamp endpoint hitting an empty registry would
fail at runtime rather than at boot.

**Where the pure helpers live.** There is no `readFxConfig` any more (no `config.fx` key). What remains
pure and in-context: `resolveRateDate` (rule → rate date), `resolveRateSource` (reporting currency →
`ExchangeRateSource`), and the provider-coverage constant used by save-time validation. All three sit
under `libs/core/src/currency/domain/` with no cross-context import — which matters because
`scripts/check-cross-context-imports.mjs`'s `classifyName` **default-allows** an unrecognized symbol
name (`:588` — `return { allowed: true }` after both pattern loops), so the invariant would not catch a
new edge on its own. Assert by grep in review.

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

### ECB reference rates

- **Direction**: ECB quotes `EUR → X` only — the mirror image of NBP. So `X → EUR` is a single
  inversion, and `EUR → X` is direct.
- **Authentication**: none. Public.
- **Calendar**: TARGET working days, **not** Polish ones, and a different cut-off (~16:00 CET). The
  two calendars therefore disagree — e.g. 3 May and 15 August are Polish holidays on which ECB
  publishes, and Good Friday / Easter Monday are TARGET holidays. This is why `resolveRateDate`
  produces a **candidate** day per the rule and each adapter absorbs its own publication calendar via
  its walk-back-on-miss, rather than the shared Polish calendar being treated as authoritative for
  both.
- **⚠️ NOT VERIFIED IN THIS PLAN — a research item before Phase 1b.** ECB's daily XML feed carries
  only the latest day, which is unusable for a `prev-business-day` rule that must fetch a specific
  past date. The historical / SDMX endpoint, its response shape, its date-parameter semantics and its
  behaviour on a non-publication day all need the same treatment the NBP section above received
  (including whether a missing date 404s, returns an empty series, or returns the nearest prior day —
  the last of which would make the walk-back unnecessary but must not be *assumed*). Do not implement
  `EcbExchangeRateAdapter` against a guess.

### Direction is an invariant, not a convention

`rate` is the number of `to` units per one `from` unit. **For the stamp**, `from` is always the order's
own currency and `to` always the reporting currency, so the stamp is **always**
`reportingTotalAmount = round2(totals.total × rate)` — never a division. Note this is a property of the
*stamp*, not of the *registry*: the registry is consumer-neutral and a future consumer (a fiscal
`X → PLN` read on a EUR-reporting deployment) legitimately stores its own `(from, to)` rows. Stated in
§ 6 Implementation details, in the ORM entity header, and pinned by a unit test asserting an exact
numeric `reportingTotalAmount` (§ 9). Getting it backwards produces a number that is plausible, never
throws, and is wrong by the square of the rate.

### Cross-rate arithmetic, spelled out

**No pivot arises for either shipped reporting currency.** NBP quotes everything against PLN and ECB
quotes EUR against everything, so with the source selected from the reporting currency (`PLN → NBP`,
`EUR → ECB`) every pair is direct or a single inversion. The pivot code below therefore ships
**unexercised by any supported configuration** — it exists so a third reporting currency is additive,
and it is unit-tested rather than reachable in production. Keep it, but do not describe the demo or any
shipped path as exercising it.

For a `from → to` pair where neither side is the provider's own base, the pivot is that base and the
divide order is (NBP shown):

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
- **Existing currency knowledge, and why it is left alone**: `Connection.config.currency` (#362) is read
  at `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts:120-122`
  (`config.currency ?? shopCurrencyResolver.resolveDefaultCurrencyIso(...) ?? undefined`); the FE writes
  it at `prestashop-setup.schema.ts:69` (the zod union) and `:107-109` (the omit-when-blank guard). It
  means *"the currency this shop prices products in"* — a fact about a shop — and this feature does
  **not** read it, overload it, or change its copy. Note the key is not declared on `ConnectionConfig`;
  it rides the open index signature (`connection.types.ts:109`). Leaving it undocumented is fine now
  that it keeps exactly one meaning.
- **Singleton-settings precedent (three instances, one shape)**: `ai_provider_active_setting`,
  `mailer_settings` and `posthog_settings` all use `@PrimaryColumn({ type: 'text', name: 'id' })` fixed
  to `'singleton'`, snake_case `name:` on every column, `@UpdateDateColumn` `updated_at`, a nullable
  `updated_by`, a repository pair of `find…()` returning `null` + `upsert…()` via
  `ormRepository.upsert({…}, { conflictPaths: ['id'] })` then `findOneOrFail`, and a bare `CREATE TABLE`
  migration with a `PK_<table>` constraint. `AiProviderActiveSettingsService.resolveActive`
  (`libs/core/src/ai/application/services/ai-provider-active-settings.service.ts:105-125`) is the
  reference for the row → env → default chain and for the documented no-cache decision; its
  `getMultiProviderView()` returns `activeUpdatedAt: null` on the env/default path — exactly the
  discriminator the `EUR (default)` label needs. Its write path validates first and throws a domain
  error the controller maps to **422**.

---

## 5. Questions & Assumptions

### Open questions

1. **The one still open: #1985 / #1987 / #1988 group by the *native* currency.** #1987's AC says
   *"multiple currencies never sum into a single figure"*, #1988 says *"currencies never silently
   summed"*, and #1985 says *"a query spanning multiple currencies cannot return a single summed
   figure"* plus an Out-of-scope line excluding a single reporting currency. Everyone groups by *a*
   currency; the disagreement is **which column**. Under this model stamped orders in one reporting
   currency legitimately sum, so an implementer following #1987 literally ships `GROUP BY currency` and
   leaves the FX columns unread.

   **Proposal** (an AC edit on two unstarted issues, so a body edit, not new issues): amend **#1987 and
   #1988** only — they are the query issues and the stamp's consumers — to group by
   `reportingCurrency`, report unstamped rows in their native currency in a separate group, and expose
   an unstamped count; add `Blocked by: #2049` to both; leave #1985's AC alone with one Out-of-scope
   clarification pointing at #2049. Owner: the product owner of epic #1976. **Not a blocker for this
   issue** — the stamp is strictly more information than today. Recorded in ADR-040 § Consequences.

   Note #1985 has **not** landed: `order-record.orm-entity.ts` on `origin/main` has no `placedAt` /
   `currency` / `taxTreatment` / `totalAmount`, and there is no `order_line_items` entity. The
   `analytics-trust` module on this branch is #2037 (ingestion freshness — no money, no currency), a
   different feature.

2. **RESOLVED — operator visibility.** The settings tile (step 14) renders the resolved value plus the
   rung that produced it (`setting` / `env` / `default`), and every analytics figure carries its own
   currency (ADR-040 § Decision 1). Nothing per-connection needs surfacing, because nothing per-connection
   feeds the answer any more. What the tile does **not** answer is "which rate did this order use" — that
   is the `exchangeRateId` join, and it is a debugging question rather than an operator one.

3. **RESOLVED — restatement.** Not built here, and the ADR says so plainly rather than leaving it implied:
   changing the setting is forward-only, the `PUT` reports how many stamped rows exist so the era split is
   accepted knowingly, and the restatement job is a filed follow-up. Rejected alternative:
   lock-after-first-stamp, which would make an unchosen converting default permanent.

4. **RESOLVED — WooCommerce `placedAt` is now in scope.** `woocommerce-order-source.adapter.ts:178` sets
   only `createdAt: normGmt(order.date_created_gmt, order.date_created)`, while
   `prestashop-order-source.adapter.ts:233-249` maps `date_add → placedAt` with the comment *"PrestaShop
   `date_add` is when the customer placed the order"*. WC's `date_created` is the same fact, so this is a
   one-line mapping, not missing data. Doing it here (Phase 4) turns "every foreign-currency WC order is
   permanently unstampable" from a shipped caveat into a non-issue. It does move invoicing's `saleDate` for
   WC orders — from `undefined` to the correct value — which is a fix, not a regression; call it out in the
   PR body so the invoicing owner sees it.

5. **RESOLVED — `fxRule` two-era.** Superseded by the first-attempt intent snapshot (step 11): the rule and
   the reporting currency are both pinned at the first stamp *attempt*, so retry and sweep cannot disagree
   with the inline path. Eras can still exist across a deliberate setting change (item 3), which is
   documented rather than mitigated.

### Assumptions

- **Two providers ship** (NBP and ECB), selected by the reporting currency. Both are needed
  independently of each other: ECB serves the `EUR` product default, NBP serves a `PLN` deployment
  (including the demo) *and* is the source a future fiscal consumer must use. The port keeps
  `supports()` and pivot provenance so a third is additive.
- **`prev-business-day` is the only rule shipped**, as a code constant, still persisted per stamp.
- **No cache on the resolved reporting currency.** It is a singleton-row PK lookup, and the AI
  precedent already documents the same decision for the same shape
  (`ai-provider-active-settings.service.ts:105-125`). This is strictly *cheaper* than the pre-revision
  design, which did a connection read plus a `GROUP BY` aggregate per order. Revisit with numbers.
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
- **FA(3) already has the fields, OL deliberately omits them, and the stamp must NOT be wired into
  them.** The KSeF schema declares `KursWaluty`
  (`libs/integrations/ksef/src/infrastructure/fa3/schema/schemat_fa3_v1-0e.xsd:3199`) and `KursUmowny`
  (`:3490`), and `fa3-xml.builder.ts` emits `KodWaluty` (`:463`) with **no** `Kurs*` element at all
  (grep for `Kurs` in that builder: zero hits). Invoicing anchors `saleDate` on the same
  `order.placedAt`, which makes this stamp *look* reusable. It is not: the statutory rate is anchored on
  the tax point (art. 19a — the payment instant for a prepaid order, which no shipped source persists),
  targets PLN, and must be a directly published table-A quote. Whoever implements `KursWaluty`
  **computes their own rate**; the two figures coexist and differ by design.

  Note the schema itself scopes this: `KursWaluty` is *"w przypadkach, o których mowa w dziale VI
  ustawy"* (the statutory conversion), while `KursUmowny` / `WalutaUmowna` is *"Nie dotyczy przypadków,
  o których mowa w dziale VI"* — the only element a self-computed rate may occupy. Record that next to
  the Currency section in the architecture overview (ADR-040 § Consequences carries the full argument).

  **Three cheap guards ship with it**, ranked by hit-rate per effort: (1) the reversed wording above;
  (2) a one-line doc-comment on the `order_records` FX columns, the `ExchangeRate` entity header and
  `IssueInvoiceCommand.currency` — *"Analytics only. Never a fiscal conversion rate — see ADR-040
  § Non-goals"* — because those are the exact two files a `KursWaluty` implementer lands in; (3) a
  tripwire spec in the KSeF builder suite asserting a foreign-currency command produces **no** `Kurs*`
  element, with the reason in the test name, so wrong wiring fails a build rather than shipping. A
  `check:invariants` grep rule (asserting the FX column names appear nowhere under
  `libs/core/src/invoicing/**` or the invoicing plugin packages) is the natural fourth step — **deferred**
  until invoicing legitimately starts reading `exchange_rates`, at which point (3) stops being sufficient.
- **A latent invoicing bug found while checking the above, out of scope here**:
  `libs/integrations/infakt/src/.../infakt-invoicing.adapter.ts` has **zero** `.currency` references — it
  converts to minor units and never sends a currency, so a EUR order is booked as if the numerals were
  PLN. File separately.
- `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts:247` hardcodes
  `const conversionRate = 1.0;` on the **outbound** order-create path, emitted as
  `conversion_rate: conversionRate.toFixed(6)` at `:272`. Harmless today (OL knows no rate); a
  visible inconsistency the moment it does. Explicitly out of scope — one line, noted so a reviewer
  does not have to rediscover it.
- `ConnectionConfig` (`libs/core/src/identifier-mapping/domain/types/connection.types.ts`) documents
  `invoicing`, `stockSafetyBuffer`, `pricingRule` and `rateLimit` but **not** `currency`. Left as-is:
  the pre-revision plan added a doc-comment because the key was about to carry a second meaning, and it
  no longer is. Documenting it remains a nice-to-have unrelated to this feature.

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

1. **Domain types + rule + source selection**
   - **Files**: `libs/core/src/currency/domain/types/exchange-rate.types.ts`,
     `.../fx-rate-rule.types.ts`, `.../reporting-currency.types.ts`,
     `libs/core/src/currency/domain/rate-source-resolution.ts`
     (+ `__tests__/rate-source-resolution.spec.ts`)
   - **Action**: define `FX_RATE_RULES = ['prev-business-day'] as const` + `FxRateRule`;
     `EXCHANGE_RATE_SOURCES = ['nbp', 'ecb'] as const` + `ExchangeRateSource`; `RATE_DERIVATION_KINDS =
     ['direct', 'inverted', 'pivot'] as const`; the `ExchangeRate` shape (`from`, `to`,
     `rate: string`, `rateDate: string`, `source`, `sourceRef: string | null`,
     `pivotCurrency: string | null`, `derivation: RateDerivation`); `GetRateInput` (`from`, `to`,
     `rateDate`, `source`).

     In `reporting-currency.types.ts`: `DEFAULT_REPORTING_CURRENCY = 'EUR'`;
     `SUPPORTED_REPORTING_CURRENCIES = ['PLN', 'EUR'] as const` + its type;
     `REPORTING_CURRENCY_SOURCES = ['setting', 'env', 'default'] as const` + `ReportingCurrencySource`
     (the *provenance* of the resolved value — not to be confused with `ExchangeRateSource`; name them
     apart in the file header, because two `*Source` types in one context is a review trap);
     `ReportingCurrencySettingsView`; `ReportingCurrencyCoverage`.

     `resolveRateSource(reportingCurrency): ExchangeRateSource` is a **pure** total function over
     `SUPPORTED_REPORTING_CURRENCIES` — `PLN → 'nbp'`, `EUR → 'ecb'` — throwing
     `ReportingCurrencyUnsupportedError` on anything else. **There is no `readFxConfig` and no
     `config.fx` key**: the rule and the source are not per-connection.

     A one-line comment on the mapping states *why* it is a mapping rather than a setting: each provider
     quotes against exactly one base, so pairing the source with the reporting currency is what keeps
     every pair direct-or-single-inversion (§ 4).
   - **Acceptance**: `as const` + derived-union pattern per engineering standards; no `enum`;
     `resolveRateSource` covered for both supported values and for an unsupported one.

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

3a. **Provider port + provider registry (core, no HTTP)**
   - **Files**: `libs/core/src/currency/domain/ports/exchange-rate-provider.port.ts`,
     `libs/core/src/currency/domain/ports/exchange-rate-provider-registry.port.ts`,
     `libs/core/src/currency/infrastructure/adapters/exchange-rate-provider-registry.service.ts`
     (+ `__tests__/exchange-rate-provider-registry.service.spec.ts`),
     `libs/core/src/currency/domain/exceptions/` (the rate errors)
   - **Action**: the port declares
     - `readonly name: ExchangeRateSource`
     - `readonly pivotCurrency: string | null`
     - `supports(from: string, to: string): boolean`
     - `listSupportedCurrencies(): readonly string[]` — pure, static, no I/O; consumed by save-time
       coverage validation (step 5b)
     - `fetchRate({ from, to, on }): Promise<ExchangeRate>`

     `supports()` exists because a currency absent from the source's table 404s on **every** walk-back
     day. `maxAttempts` defaults to `10`
     (`libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts:87`), so
     without it an unsupported pair costs 10 × 7 = 70 futile HTTP requests and then dies. Per
     [ADR-007](../architecture/adrs/007-syncjob-status-vs-outcome-split.md) an unsupported pair is a
     `business_failure`, not a retry.

     `RateNotAvailableError` splits into two:
     - `RateUnavailableTransientError` — a 5xx, a timeout, a network failure. Retryable.
     - `RateUnsupportedPairError` — `supports()` false, an exhausted walk-back, **any non-404 4xx**
       (see § 4 on NBP's malformed-date response), or a pivot whose legs disagree on
       `effectiveDate`. **Terminal**: no stamp, no retry job, `business_failure` in the handler.

     `ExchangeRateProviderRegistryService implements ExchangeRateProviderRegistryPort` mirrors
     `AdapterRegistryService`: a private `Map<ExchangeRateSource, ExchangeRateProviderPort>`, empty on
     construct, with `register(provider)` (throwing `DuplicateExchangeRateSourceError` on a second
     registration of the same name), `get(source)` (throwing the **terminal**
     `UnregisteredExchangeRateSourceError`, never a transient), and `has(source)`. It lives in
     `infrastructure/adapters/` and implements a `*Port`, which satisfies the service-interface invariant
     without a parallel `I*Service` (the same posture `AdapterRegistryService` has).
   - **Acceptance**: duplicate registration throws; an unknown source throws the terminal error; the
     registry is empty until an integration module populates it.
   - **Dependencies**: step 1.

3b. **`@openlinker/integrations-fx` — the provider adapters** *(new package)*
   - **Files**: `libs/integrations/fx/package.json`, `tsconfig.json` (composite,
     `references: [../../core, ../../shared]`), `tsconfig.spec.json`, `jest.config.mjs`, `README.md`,
     `src/index.ts`, `src/fx-integration.module.ts`, `src/fx-integration.tokens.ts`,
     `src/infrastructure/adapters/nbp-exchange-rate.adapter.ts`,
     `.../ecb-exchange-rate.adapter.ts`, `.../fake-exchange-rate.adapter.ts`
     (+ `__tests__/` for each)
   - **Copy the layout from `libs/integrations/ai/` verbatim** — same `private: true`, `main`/`types` →
     `./dist`, single `"."` export, `@openlinker/core` + `@openlinker/shared` in `dependencies`, peer
     `@nestjs/common`. `FakeExchangeRateAdapter` mirrors `FakeAiCompletionAdapter`'s role: deterministic,
     used by the int-spec so no tier ever makes a live call.
   - **`NbpExchangeRateAdapter`**: injected `FetchLike` + timeout, GETs
     `.../rates/a/{code}/{date}/?format=json`, walks back up to 7 days on 404, inverts for `PLN → X`,
     pivots through PLN for `X → Y` per the divide order in § 4. Persists the `effectiveDate` the API
     actually answered with, the `no` as `sourceRef`, and a `derivation`
     (`{ kind, legs: [{ pair, ref, effectiveDate }] }`) so an inverted or pivoted `rate` — which appears
     in no published table — stays auditable. Rate arithmetic uses `number` + the house `round2`-style
     rounding; the stored `rate` is the 8-dp string.
   - **`EcbExchangeRateAdapter`**: same shape, `pivotCurrency = 'EUR'`, TARGET calendar absorbed by its
     own walk-back. **Blocked on the § 4 research item** — the daily XML feed carries only the latest
     day, so the historical endpoint's shape and its non-publication-day behaviour must be established
     first. Do not implement against a guess.
   - **`FxIntegrationModule`**: `imports: [CurrencyModule]`, provides each adapter plus a
     `FX_FETCH_TOKEN` default factory (the single `eslint-disable` site, § 3), and in `onModuleInit`
     calls `registry.register(...)` per adapter. No manifest, no `adapterRegistry.register`, no
     `createCapabilityAdapter` — it is not a plugin.
   - **Acceptance**: each adapter unit-tested against a faked `FetchLike` for direct, inverted,
     cross-rate (exact expected value), 404-walk-back, exhausted walk-back, a 400, a 503, a timeout,
     `supports()` false, and legs-disagree-on-date. Never a live HTTP call in any tier. Both adapters
     are registered simultaneously (asserted).
   - **Dependencies**: steps 1, 3a, 6.

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
   - **Action**: `getRateFor(input: GetRateInput): Promise<ExchangeRate & { id: string }>` — resolve the
     provider through `EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN` (**not** a `useFactory`-built `Map`; see
     step 6), `supports()` gate, registry read by key, on miss provider fetch → `insertIfAbsent` → on
     `DuplicateExchangeRateError` re-select the winner. `resolveRateDate` and `resolveRateSource` run in
     the **caller** (the orders context owns `placedAt` and the resolved reporting currency), so this
     service takes an already-resolved `rateDate` and `source`.
   - **Acceptance**: a second call for the same key performs **no** provider fetch; a
     `DuplicateExchangeRateError` resolves to the winning row rather than propagating;
     `RateUnsupportedPairError` propagates unchanged (the stamp service, not this one, decides
     terminal-vs-retry policy); an **unregistered** source surfaces as a terminal `business_failure`,
     never a retry.

5b. **Reporting-currency setting** *(new)*
   - **Files**: `libs/core/src/currency/domain/entities/reporting-currency-setting.entity.ts` (+
     `REPORTING_CURRENCY_SETTING_SINGLETON_ID = 'singleton'`),
     `libs/core/src/currency/domain/ports/reporting-currency-setting-repository.port.ts`,
     `libs/core/src/currency/infrastructure/persistence/entities/reporting-currency-setting.orm-entity.ts`,
     `.../repositories/reporting-currency-setting.repository.ts`,
     `libs/core/src/currency/application/interfaces/reporting-currency-settings.service.interface.ts`,
     `libs/core/src/currency/application/services/reporting-currency-settings.service.ts`,
     `libs/core/src/currency/domain/exceptions/reporting-currency.exception.ts`
     (+ `__tests__/` for the service and the repository)
   - **Why `currency` and not `orders`/`analytics`**: save-time coverage validation needs the provider
     list, which lives here. Putting the setting in `orders` would create an `orders → currency` value
     dependency *for validation alone* and break `currency`'s leaf property.
   - **Action**: copy the `ai_provider_active_setting` stack (§ 4) — `id text PK` fixed to `'singleton'`,
     snake_case `name:` on every column, `@UpdateDateColumn` `updated_at`, nullable `updated_by`;
     repository pair `findSetting()` → `null` when absent and `upsertSetting(code, updatedBy)` via
     `upsert({…}, { conflictPaths: ['id'] })` + `findOneOrFail`.

     The service exposes:
     - `resolve(): Promise<string>` — `findSetting()?.reportingCurrency` → `ConfigService.get('OL_REPORTING_CURRENCY')`
       (ignored, with **one** warn, unless it normalises and is supported) → `DEFAULT_REPORTING_CURRENCY`.
     - `getView(): Promise<ReportingCurrencySettingsView>` — the value plus `source:
       'setting' | 'env' | 'default'`, `updatedAt`, `updatedBy`, and `supportedCurrencies`. `source !==
       'setting'` is what the FE renders as `EUR (default)`, mirroring the AI view's `activeUpdatedAt ===
       null` discriminator rather than comparing against a hardcoded `'EUR'` on the client.
     - `setReportingCurrency(code, updatedBy, { acknowledgeCoverageGaps })` — validate, then persist.
   - **Save-time validation, three layers, zero HTTP** (§ 4 has the precedent for the 422 shape):
     1. **Shape** — `trim().toUpperCase()` then `/^[A-Z]{3}$/`. Fail ⇒ `InvalidReportingCurrencyError` ⇒
        **400**.
     2. **Reachability** — membership of `SUPPORTED_REPORTING_CURRENCIES` and of the union of every
        registered provider's `listSupportedCurrencies()`. Fail ⇒ `ReportingCurrencyUnsupportedError` ⇒
        **422**, message carrying the supported set. A pure array test — no I/O, no cache. This is the
        **hard gate**.
     3. **Coverage advisory** — `assessCoverage(target, observed)`, a pure function
       (`observed.filter(c => !provider.supports(c, target))`) fed by
       `listDistinctNativeCurrencies()` (step 8b). **Warns, never blocks**: blocking on history would let
       one junk currency in an old snapshot make a legitimate currency permanently unsettable. Returned in
       the response and re-submitted with `acknowledgeCoverageGaps: true`.
     The composition of layer 3 lives in the **controller** (the interfaces layer, where composing two
     contexts is legal), not in `currency` — so no `currency → orders` edge appears.
   - **The stamped-row count rides the same response** (ADR-040 § Decision 8): `getView` and the `PUT`
     response both report how many `order_records` rows already carry a stamp, so an era split is accepted
     knowingly. Same controller-level composition as the coverage advisory.
   - **Acceptance**: row → env → default, each with the right `source`; a malformed or unsupported env
     value is ignored with exactly one warn (not a throw at boot); unsupported code ⇒ 422; bad ISO shape ⇒
     400; a supported code persists and flips `source` to `'setting'`.

6. **Module + tokens + barrel + package exports**
   - **Files**: `libs/core/src/currency/currency.module.ts`, `currency.tokens.ts`, `index.ts`,
     and the `"./currency"` entry in `libs/core/package.json` `exports`
   - **Action**: `CurrencyModule` is a **static** `@Module` — never `forRoot` — so core and
     `FxIntegrationModule` share one `ExchangeRateProviderRegistryService` instance (the same reason
     `AdapterRegistryService` works today). It provides the registry, both repositories,
     `CurrencyRateService`, `ReportingCurrencySettingsService`, and **exports**
     `EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN` so the fx package can inject it.

     **Do not** build a `ReadonlyMap` of providers via `useFactory` (the pre-revision design): that would
     force `libs/core` to import the adapter classes, reversing the dependency direction.

     **`TypeOrmModule.forFeature([ExchangeRateOrmEntity, ReportingCurrencySettingOrmEntity])` is
     mandatory** — runtime entity discovery is `autoLoadEntities: true`
     (`libs/shared/src/database/database.module.ts:34`), so without the `forFeature` neither table
     materializes in the `synchronize`-built dev/test schema and the int-spec cannot pass.
     `currency.tokens.ts` contains **only** Symbol declarations (`CURRENCY_RATE_SERVICE_TOKEN`,
     `EXCHANGE_RATE_REPOSITORY_TOKEN`, `EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN`,
     `REPORTING_CURRENCY_SETTING_REPOSITORY_TOKEN`, `REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN`);
     `index.ts` does `export * from './currency.tokens'` (per the Symbol re-export convention). Add
     `"./currency"` to `libs/core/package.json` `exports`, mirroring the `"./analytics"` entry (`:17-21`).
   - **Acceptance**: `pnpm check:invariants` passes; no `@openlinker/core/<sibling>` import anywhere
     under `libs/core/src/currency/**` (assert by grep in review — the invariant script
     default-allows unrecognized symbol names, so it will not catch a new edge on its own).

### Phase 2 — Persistence

7. **Order-record columns**
   - **Files**: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`,
     `libs/core/src/orders/domain/entities/order-record.entity.ts`
   - **Action**: add the **six** columns (§ Implementation details) to the ORM entity and six matching
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

     Five columns in one `UPDATE`, so the group cannot half-apply. Note the predicate stays
     `reportingCurrency: IsNull()` — **not** `fxIntendedCurrency`, which by then is deliberately populated.

     (a2) `claimFxIntentIfAbsent(internalOrderId, { reportingCurrency, fxRule }): Promise<boolean>` — the
     first-attempt snapshot (ADR-040 § Decision 5), same shape:

     ```ts
     const result = await this.repository.update(
       { internalOrderId, fxIntendedCurrency: IsNull() },
       { fxIntendedCurrency: intent.reportingCurrency, fxRule: intent.fxRule }
     );
     return (result.affected ?? 0) > 0;
     ```

     A loser (`false`) re-reads and adopts the winner's intent — the same insert-then-recover posture
     `insertIfAbsent` uses, so two concurrent first attempts cannot pin different currencies.

     (b) `listDistinctNativeCurrencies(): Promise<string[]>` — a **set**, not a winner, feeding the
     coverage advisory (step 5b). `order_records` has no native `currency` column today (that is #1985,
     which this plan must not depend on), so the read goes through the snapshot using the repository's own
     guarded JSONB idiom (`order-record.repository.ts:274-281` — `TOTAL_EXPR`, guarded with
     `jsonb_typeof(...) = 'number'` so a malformed value sorts as NULL rather than throwing on the cast,
     with a matching expression index in the migration). Copy that shape for `{totals,currency}` with
     `jsonb_typeof(...) = 'string'`:

     ```sql
     SELECT DISTINCT c AS currency
     FROM (
       SELECT CASE
                WHEN jsonb_typeof(rec."orderSnapshot"#>'{totals,currency}') = 'string'
                THEN rec."orderSnapshot"#>>'{totals,currency}'
              END AS c
       FROM "order_records" rec
     ) t
     WHERE c IS NOT NULL
     ```

     No `sourceConnectionId` filter, no `ORDER BY count(*) DESC`, no `LIMIT 1` and **no tie-break** — the
     pre-revision version was a dominant-currency aggregate for the ladder's rung 3, and both the ladder
     and the `, c ASC` tie-break rationale that went with it are gone. The expression index survives,
     repurposed. Note the quoted camelCase identifiers — no `namingStrategy` is configured anywhere
     (verified: neither `libs/shared/src/database/database.module.ts` nor
     `apps/api/src/database/data-source.ts` sets one), so `internal_order_id` would error at runtime. The
     in-repo precedents are `1832000000008-add-order-record-cancelled-at.ts:28`
     (`ADD COLUMN IF NOT EXISTS "cancelledAt"`) and `markCancelled`'s `WHERE "internalOrderId" = $2`
     (`order-record.repository.ts:561-568`).

     Once #1985 lands this collapses to `SELECT DISTINCT "currency" FROM "order_records"`. Deliberately not
     depended on.

     **Leave `toOrm` untouched** so the upsert path can never clobber a stamp — and add the
     regression spec described in § 7 Alternative 5.
   - **Acceptance**: `stampFxIfAbsent` asserts the `IsNull()` predicate is present in the `update`
     call (`toHaveBeenCalledWith({ internalOrderId, reportingCurrency: IsNull() }, {…})`, mirroring
     `shipment.repository.spec.ts:383-386`) and returns `false` when `affected` is 0;
     `claimFxIntentIfAbsent` asserts the same shape against `fxIntendedCurrency: IsNull()`;
     `listDistinctNativeCurrencies` asserts the emitted SQL carries the `jsonb_typeof` guard and returns a
     de-duplicated set.
   - **Dependencies**: step 7.

9. **Migration**
   - **File**: `apps/api/src/migrations/1834000000000-add-order-fx-stamp.ts`
   - **Action**: create `exchange_rates` (+ its unique index) **and `reporting_currency_setting`**, add the
     **six** `order_records` columns (+ the partial composite index, the group-integrity CHECK, and the
     `{totals,currency}` expression index for step 8b). `up()` and `down()` both implemented.

     `reporting_currency_setting`: `id text NOT NULL`, `reporting_currency varchar(3) NOT NULL`,
     `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by text`,
     `CONSTRAINT "PK_reporting_currency_setting" PRIMARY KEY ("id")` — a bare `CREATE TABLE`, matching
     `1792000000000-add-ai-provider-active-setting.ts`. **Note the naming split and do not unify it**:
     singleton settings tables use snake_case columns (their ORM entities carry explicit `name:`), while
     `order_records` uses quoted camelCase. Follow each table's own convention.

     Follow the house DDL-guard
     style, which for recent `ALTER TABLE` migrations **is** `IF NOT EXISTS` / `IF EXISTS` — verified
     across `1832000000005:25,30`, `1832000000006:28,34`, `1832000000007:31,36`, `1832000000008:28`,
     and #1985's own `1832000000008-add-order-analytics-read-model.ts:26-29`. `CREATE TABLE` is
     mixed in the repo (`1830000000000:31` guards, `1831000000004:26` does not); guard it, matching
     the more recent of the two.
   - **Why `1834000000000`** (re-verified 2026-08-14): the invariant that matters is
     `scripts/check-migration-timestamps.mjs`' rule 4 — a migration not yet on `origin/main` must have a
     timestamp **strictly greater than every migration that is**. `origin/main`'s tail is now
     **`1833000000001-add-destination-category-expanded-at.ts`** (with `1833000000000-add-destination-categories-table.ts`
     ahead of it), and the one plugin dir listed in `scripts/plugin-migration-dirs.json`
     (`libs/integrations/allegro/src/migrations`) is still at `1767900000000`. So `1834000000000` clears
     `main` by one synthetic slot.

     Two stale justifications to discard: `1833000000000` is **no longer free** (it landed on `main` as
     `-add-destination-categories-table`, not merely "a slot unmerged branches will reach for"), and
     `1832000000008` remains claimed three ways — `-add-order-record-cancelled-at` (on `main`),
     `-add-order-analytics-read-model` (`origin/1985-…`) and `-add-offer-commercial-snapshots-table`
     (`origin/2024-…`) — so both unmerged branches must still re-prefix, and they will now reach past
     `1833000000001`. **Re-check the tail at rebase time rather than trusting this line**: `main` has
     moved twice during this plan's life, and this branch is currently behind it.
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

10. **~~Reporting-currency ladder~~ — DELETED by the ADR-040 revision**

    The pre-revision plan created `IOrderReportingCurrencyService` in `orders` with a four-rung ladder
    (`config.fx.reportingCurrency` → `config.currency` → dominant native currency → the order's own
    currency), plus a `currency?: string` doc-comment on `ConnectionConfig`. **None of it is built.**
    Deleted with it: `readFxConfig` + `fx-config.types.ts` + their spec, the `ConnectionPort` read in the
    FX path, the `findDominantNativeCurrency` aggregate (replaced by the set-returning
    `listDistinctNativeCurrencies`, step 8b), the four-rung and rung-2-ISO test tables (§ 9), and the
    `, c ASC` tie-break rationale.

    What replaces it: `IReportingCurrencySettingsService.resolve()` in `currency` (step 5b), injected
    straight into the stamp service. There is no orders-side resolution layer, because there is nothing
    per-order or per-connection left to resolve. Kept as a numbered step rather than renumbered so the
    diff against the reviewed plan stays legible.

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
      0. **Read the persisted intent first.** If `fxIntendedCurrency` is set, use it together with the
         persisted `fxRule` and **do not call the settings service at all**. If absent, resolve
         (`IReportingCurrencySettingsService.resolve()` + the code-constant rule), then
         `claimFxIntentIfAbsent`; on `false`, re-read and adopt the winner's intent. This is ADR-040
         § Decision 5 — it is what makes the inline, retry and sweep paths agree, and it must precede the
         rate date so a retry cannot resolve against a setting changed since ingestion.
      1. `resolveRateSource(reportingCurrency)` (step 1) → the `ExchangeRateSource` to read from.
      2. `resolveRateDate(placedAt, rule)` (step 2). `null` ⇒ **terminal**: warn once with
         `{ internalOrderId, reason: 'no-placed-at' }`, **no stamp, no retry enqueue**, return
         `{ kind: 'terminal' }`.
      3. Reporting currency **equals** `totals.currency` ⇒ stamp
         `{ reportingCurrency, reportingTotalAmount: totals.total, exchangeRateId: null, fxRule,
         fxStampedAt: now }` with **no** rate lookup and no I/O.
      4. Otherwise `ICurrencyRateService.getRateFor({ from, to, rateDate, source })`, then
         `reportingTotalAmount = round2(totals.total × Number(rate))` — **multiply, never divide**
         (§ 4) — and stamp with `exchangeRateId` set.
      5. `RateUnsupportedPairError` (and an unregistered source) ⇒ terminal, as (2).
      6. Any other failure ⇒ warn with `{ internalOrderId, from, to, rateDate, source }` and enqueue the
         retry job. **The enqueue sits in its own `try/catch`, nested inside the outer one.** Its
         dependencies (Postgres, Redis) are correlated with the failures that trigger it, so a
         single flat catch swallows the enqueue throw as well and the order is lost with nothing but
         a warn line.

      The return type is a discriminated `FxStampOutcome` with
      `kind: 'stamped' | 'terminal' | 'deferred'` (`'deferred'` = degraded to the retry job). The retry
      handler already needs `terminal` vs `deferred` for its ADR-007 outcome mapping, and `persistOrder`
      needs `stamped` for (b) below.

      `persistOrder` must return successfully regardless. Two changes there:

      (a) `save()` does not return unassigned properties and the stamp happens after it, so the returned
      `OrderRecord` would report the FX fields as `null` **even when the stamp succeeded**. Decided:
      **mirror `recordCancellationIfNeeded`'s conditional re-`findById`** (`order-record.service.ts:255-282`,
      whose doc comment spells out the identical reason for `cancelledAt`) rather than documenting the
      fields as non-authoritative. A method returning an `OrderRecord` whose financial fields are silently
      `null` when they are in fact populated is the exact silent-wrong-number class this feature exists to
      remove, and the doc comment would be invisible at every future call site. Note the *contract* is what
      is being fixed: the only production caller today
      (`order-ingestion.service.ts:353`) discards the return value, so there is no live bug — but
      `IOrderRecordService.persistOrder` is published on the `@openlinker/core/orders` barrel with a
      non-`void` return, and the first future consumer would read the stale `null`.

      (b) **Collapse both post-upsert writers into one refresh.** `recordCancellationIfNeeded` returns a
      boolean, the stamp returns its `kind`, and `persistOrder` re-reads once if either wrote. Without this
      there is an ordering hazard: the cancellation re-read runs first, the stamp lands after, and the
      returned record is stale again — a bug the naive "just copy the cancellation pattern" reading would
      ship.
    - **Acceptance**: a throwing rate service leaves the order persisted and unstamped, does not
      propagate, and enqueues exactly one job; a throwing **enqueue** also does not propagate and is
      logged distinctly from the stamp failure; the equal-currency path asserts the rate service was
      never called; the converting path asserts an **exact** `reportingTotalAmount`; a `null`
      `resolveRateDate` asserts zero enqueues; **a populated `fxIntendedCurrency` asserts the settings
      service is never called and that the stamped currency equals the intent even when the live setting
      has since changed**; `persistOrder` re-reads exactly once when both writers fired and **not at all**
      when neither did.
    - **Dependencies**: steps 5, 5b, 8.

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

### Phase 4 — API settings surface, frontend, env, and the WooCommerce `placedAt` fix

14. **Settings API + settings-page tile**
    - **Files**: `apps/api/src/currency/currency.module.ts`,
      `apps/api/src/currency/http/currency-settings.controller.ts` (+ its spec),
      `.../http/dto/currency-settings-response.dto.ts` (with a static `fromView`),
      `.../http/dto/set-reporting-currency.dto.ts`, registration in `apps/api/src/app.module.ts`,
      **`apps/api/src/auth/write-guard-coverage.spec.ts`** (add `CurrencySettingsController` to
      `CONTROLLERS`), and on the FE
      `apps/web/src/features/currency-settings/{api,hooks,components}/*` +
      `CurrencySettingsTile` mounted in `apps/web/src/pages/settings/settings-page.tsx` (+ its test) +
      the entry in `apps/web/src/app/api/api-client.ts`
    - **Routes**: `GET /currency-settings` and `PUT /currency-settings/reporting-currency` (204), both
      `@Roles('admin')` — naming and shape mirror `/ai-provider-settings` +
      `PUT /ai-provider-settings/active`. Map the two domain exceptions at the boundary the way
      `ai-provider-settings.controller.ts` does (`withDomainExceptionMapping`): 400 for the ISO-shape
      error, 422 for the unsupported-currency error.
    - **The `write-guard-coverage.spec.ts` entry is not optional** — a new write endpoint absent from
      `CONTROLLERS` ships without guard coverage and nothing fails.
    - **FE**: a `<select>` fed by the response's `supportedCurrencies` (so the 400/422 paths are
      unreachable from the UI and exist only for a direct caller), the resolved value rendered as
      `EUR (default)` whenever `source !== 'setting'`, the coverage warning with its explicit
      acknowledgement before re-submitting, and the already-stamped-row count shown in the confirm so the
      era split is accepted knowingly. Server state via TanStack Query under
      `features/currency-settings/hooks`, per `docs/frontend-architecture.md` (query hooks live under
      `features/<domain>/hooks`, keys beside the feature API module, pages never call the API directly).
    - **Acceptance**: unset ⇒ `EUR (default)`; a set value renders bare; selecting an unsupported code is
      impossible from the UI and 422s from a direct call; the coverage warning blocks submit until
      acknowledged.

15. **Env + demo passthrough + the WooCommerce `placedAt` mapping**
    - **Files**: `apps/api/.env.example`, `apps/worker/.env.example`, the root `./.env.example`,
      `docker-compose.demo.yml`,
      `libs/integrations/woocommerce/src/infrastructure/adapters/woocommerce-order-source.adapter.ts`
      (+ its spec)
    - **`.env.example` is two files, and the worker one is load-bearing.** `apps/api/.env.example` is the
      dev file (insert a `# --- Reporting currency ---` block after `# --- Order sync routing ---`,
      matching the surrounding 80-col comment style with a commented-out default). The root
      `./.env.example` is the demo/self-host list `docker-compose.demo.yml` actually reads
      (`docs/public-domain-demo-deployment-guide.md:73` names it as the canonical override list). And
      `apps/worker/.env.example` matters because the worker runs the retry job and the reconcile sweep — a
      fallback that differs between the two processes would stamp differently before the first settings row
      is ever written.
    - **Demo default is `PLN`, at the compose layer only**: `OL_REPORTING_CURRENCY: '${OL_REPORTING_CURRENCY:-PLN}'`
      in the demo `api` service env. That matches the demo's `PS_CURRENCY_DEFAULT` without asserting a
      product-wide PLN. Note the consequence for the demo: its two seeded WooCommerce orders run in WC's
      install default (`woocommerce_currency` is set nowhere in the tree, so USD), which with the
      `placedAt` fix below become genuinely converted USD→PLN orders — so the demo shows a populated
      `reportingTotalAmount` with **no order seeder needed**. (There is no OL-side order seeder at all:
      zero `INSERT INTO order_records` repo-wide, and `docker-compose.yml:229` sets `PS_DEMO_MODE: 0`, so
      PrestaShop's own fixtures are not installed either.)
    - **WooCommerce `placedAt`**: `woocommerce-order-source.adapter.ts:178` currently sets only
      `createdAt: normGmt(order.date_created_gmt, order.date_created)`. Add
      `placedAt: normGmt(order.date_created_gmt, order.date_created)` alongside it — WC's `date_created` is
      the same fact `prestashop-order-source.adapter.ts:233-249` maps as `date_add → placedAt`, with the
      comment *"PrestaShop `date_add` is when the customer placed the order"*. One line; it makes every
      WooCommerce order stampable and removes the shipped caveat.
    - **Call out the invoicing side-effect in the PR body**: this also moves invoicing's `saleDate` for WC
      orders from `undefined` to the correct value. That is a fix (#1525's rule is that `createdAt` must
      never substitute for the sale date), but the invoicing owner should see it rather than discover it.
    - **Acceptance**: a foreign-currency WooCommerce order ingests with a non-null `placedAt` and stamps
      (previously terminal); `OL_REPORTING_CURRENCY` appears in all three `.env.example` files and is
      passed through by the demo compose.

### Phase 5 — Documentation

16. **Architecture overview**
    - **Files**: `docs/architecture-overview.md`
    - **Action**:
      - Add a **Currency** bounded-context section: responsibility, key entities (`ExchangeRate`,
        `ReportingCurrencySetting`), location, the system-level setting and its resolution chain, source
        selection by reporting currency, the direction invariant (a property of the *stamp*, not the
        registry), the immutability rule plus the first-attempt intent snapshot, the port-in-core /
        adapters-in-`@openlinker/integrations-fx` split, and the ADR link.
      - Add the `orders → currency` edge to the cross-context dependency mermaid graph.
      - Add the **"the FX stamp is analytics-only and must never be used for FA(3) `KursWaluty`"**
        statement with its three-axis reason and the `KursWaluty`-vs-`KursUmowny` scoping
        (§ 5 Documentation gaps) — the reverse of what the pre-revision plan said here.
    - **No `docs/engineering-standards.md` edit.** The pre-revision plan added a `*.provider.ts` row to
      the file-suffix table; the adapters now live in an integration package and use the documented
      `*.adapter.ts` suffix, so there is no new convention to document.
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
  `CHECK ("source" IN ('nbp', 'ecb'))` on `exchange_rates` and
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
| `fxIntendedCurrency` | `@Column({ type: 'varchar', length: 3, nullable: true })` | `varchar(3)` |

`fxIntendedCurrency` is the first-attempt snapshot (ADR-040 § Decision 5), written by
`claimFxIntentIfAbsent` **before** any rate lookup and read by every subsequent path. It is deliberately
a separate column from `reportingCurrency`: the two differ in meaning (*intended* vs *stamped*) and in
lifecycle (an intent exists on a row that is still unstamped, including one that degraded to the retry
job), and collapsing them would make the stamp guard's `IsNull()` predicate unusable.

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
- **A group-integrity CHECK**, so the columns cannot drift into a meaningless combination:
  ```sql
  CONSTRAINT "ck_order_records_fx_group" CHECK (
    ("reportingCurrency" IS NULL AND "reportingTotalAmount" IS NULL AND "exchangeRateId" IS NULL)
    OR ("reportingCurrency" IS NOT NULL AND "reportingTotalAmount" IS NOT NULL AND "fxRule" IS NOT NULL)
  )
  ```
  (`exchangeRateId` is legitimately `NULL` on the same-currency path, so it is not required by the
  second arm.)

  **The first arm deliberately omits `"fxRule" IS NULL`**, and that omission is load-bearing: the intent
  claim writes `fxRule` alongside `fxIntendedCurrency` while `reportingCurrency` is still `NULL`, so the
  pre-revision version of this constraint would reject every intent row and make the snapshot
  unimplementable. `fxIntendedCurrency` is likewise unconstrained here — it is orthogonal to whether a
  stamp landed.
- **`exchangeRateId` deliberately carries no FK and no index.** `order_records` has **zero** FKs
  today, and the analytics join lands on `exchange_rates`' own PK — so an index on the *referencing*
  side buys nothing for that direction. Stated here so a reviewer does not ask for either.

**Same-currency vs unstamped are distinguishable, and `exchangeRateId` is not the discriminator.**
The four states, spelled out because two of them are new with the intent snapshot:

| State | `reportingCurrency` | `reportingTotalAmount` | `exchangeRateId` | `fxRule` | `fxStampedAt` | `fxIntendedCurrency` |
|---|---|---|---|---|---|---|
| Never attempted (pre-feature, or not yet reached) | NULL | NULL | NULL | NULL | NULL | NULL |
| Attempted, deferred to the retry job | NULL | NULL | NULL | **set** | NULL | **set** |
| Terminal (no `placedAt`, unsupported pair) | NULL | NULL | NULL | set | **set** | set |
| Stamped, same currency | **set** | **set** | NULL | set | set | set |
| Stamped, converted | **set** | **set** | **set** | set | set | set |

So an analytics consumer must use `reportingCurrency IS NULL` to mean "unstamped" and **never**
`exchangeRateId IS NULL`, which would silently discard every same-currency order — i.e. the overwhelming
majority. Note `fxStampedAt IS NULL` is *not* an equivalent test any more: it is also NULL on a deferred
row, which is legitimately still in flight rather than unstampable. The sweep predicate deliberately uses
**both** (`fxStampedAt IS NULL AND reportingCurrency IS NULL`, step 13) because it wants exactly the rows
in the first two states.

**Money arithmetic.** `reportingTotalAmount = round2(totals.total * Number(rate))`, where `round2`
is the house idiom `Math.round((v + Number.EPSILON) * 100) / 100`
(`invoice.service.ts:157-158`). Accumulating in `number` is the repo's universal money convention
and there is no decimal library to adopt instead (verified: zero hits for `decimal.js`, `big.js`,
`bignumber.js`, `dinero`, `currency.js` in any `package.json`). `pricing-rule.types.ts:136-138`'s
`round2dp` is **not** reusable as-is: it is module-private **and** clamps with `Math.max(0, …)`,
which would silently turn a refund or a negative total into `0`. Either export it without the clamp
or declare a local `round2` — do not import the clamping version.

**Configuration**: **one** new environment variable, `OL_REPORTING_CURRENCY` — a fallback only, below
the settings row and above the `'EUR'` default. **No** new `Connection.config` key: `fx` is not
introduced, and `currency` (#362) keeps its single existing meaning and is not read here. See step 15
for the three `.env.example` files and the demo compose passthrough.

**Events**: none emitted, none consumed.

**Error handling**: `RateUnavailableTransientError`, `RateUnsupportedPairError`,
`DuplicateExchangeRateError`, `DuplicateExchangeRateSourceError`,
`UnregisteredExchangeRateSourceError`, `InvalidReportingCurrencyError`,
`ReportingCurrencyUnsupportedError` (all under `libs/core/src/currency/domain/exceptions/`). The
repository converts the PG `23505` unique violation; the adapters raise the two rate errors; the registry
raises the two source errors; the settings service raises the two validation errors. None of the rate or
source errors escapes to the ingestion caller — `OrderFxStampService` maps them to terminal-vs-retry and
swallows both. The two validation errors escape only to the settings controller, which maps them to
400 / 422.

---

## 7. Alternatives Considered

Fully argued in [ADR-040](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md);
summarised here.

### Alternative 1: a connection-derived reporting-currency ladder
Four rungs: explicit `config.fx.reportingCurrency` → `config.currency` (#362) → the connection's
dominant native currency from history → the order's own currency. **Rejected**, and this is the
inversion of what the pre-revision plan recorded here. It derives a business *choice* (what we report
in) from channel *facts* (what a shop prices in, what buyers happened to pay); its history rung shifts
silently as an order mix changes; it gives `config.currency` a second meaning; and per-connection values
make a deployment-wide total impossible **by construction** — the problem the feature exists to solve.
The original objection to a global setting was to a *mandatory* one ("a configuration step that silently
breaks analytics when skipped"), which optional-with-a-default answers: skipping it is the normal path.

### Alternative 1b: lock the setting after the first stamp
**Rejected**: the default converts and nobody chose it, so a lock makes an *unchosen* default permanent.
A deployment that never opens the settings page takes one foreign-currency order and is locked into a
currency it was never asked about. Shipped instead: forward-only changes, with the stamped-row count
reported on the `PUT` so the era split is accepted knowingly, and restatement filed as a follow-up.

### Alternative 1c: provider adapters inside `libs/core`, split by whether they need a credential
**Rejected**: it keys package placement on someone else's auth policy, is not expressible in
`check:invariants`, forces an adapter to move packages the day a source adds a key, and introduces the
first outbound HTTP call in `libs/core` — a precedent the next "simple unauthenticated GET" would cite.
Also rejected: **an active-provider setting** (the `ai_provider_active_setting` shape, one winner). NBP
and ECB must be live simultaneously, and the `(source, …)` key already admits that; only the pre-revision
code layering assumed one.

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
**six** FX columns. Without it, a future contributor who "completes" `toOrm` reintroduces the stomp and
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
- ✅ Cross-context contract — `orders` imports `ICurrencyRateService`,
  `IReportingCurrencySettingsService`, their Symbol tokens and `FX_RATE_RULES` from
  `@openlinker/core/currency` (all `I*Service` / `*_TOKEN` / `UPPER_SNAKE` shapes on the allow list); no
  `ConnectionPort` import is added, because nothing per-connection is read. `@openlinker/integrations-fx`
  imports only `*Port` / `*Module` / `*_TOKEN` / entity / `*Error` shapes from
  `@openlinker/core/currency`, and **nothing in `libs/core` imports the fx package**. `currency` imports
  nothing from a sibling core context. **Verify by grep, not by the invariant script** — `classifyName`
  default-allows unrecognized names (`scripts/check-cross-context-imports.mjs:588`).
- ✅ Workspace dependency declarations — `libs/integrations/fx/package.json` declares `@openlinker/core`
  and `@openlinker/shared` in `dependencies` (not only as tsconfig `references`), and
  `apps/{api,worker}/package.json` declare `@openlinker/integrations-fx`. `pnpm` reads manifests, not
  tsconfig, so a missing manifest edge lands two packages in one `pnpm -r` chunk and produces the
  nondeterministic `TS2306` from #2011. Guarded by `scripts/check-workspace-dep-declarations.mjs`.
- ✅ Symbol-token convention — `currency.tokens.ts` is Symbol-only, star-exported from the barrel.
- ✅ Service-interface rule — every `application/services/*.service.ts` has its interface file.
  This is also why the settings service is a `*.service.ts` and not a `*.resolver.ts`: `isServiceFile`
  (`scripts/check-service-interfaces.mjs:74-80`) matches only `.service.ts`, so a `*.resolver.ts`
  would **evade** the invariant rather than satisfy it. `find libs/core/src -name '*.resolver.ts'`
  is empty; the only five `*.resolver.ts` files in the repo are PrestaShop infrastructure helpers
  under `libs/integrations/prestashop/src/infrastructure/provisioners/`.

### Naming conventions

- ✅ `*.types.ts`, `*.port.ts`, `*.orm-entity.ts`, `*.repository.ts`, `*.service.ts` +
  `*.service.interface.ts`, `*.spec.ts`, `{job-type-kebab}.handler.ts`, `*.controller.ts`, `*.dto.ts`.
- ✅ `*.adapter.ts` for the providers (`NbpExchangeRateAdapter`, `EcbExchangeRateAdapter`,
  `FakeExchangeRateAdapter`) — **the pre-revision `*.provider.ts` deviation is gone**. Its argument was
  that `*.adapter.ts` would invite the "why isn't this a plugin?" question; that evaporates once the code
  physically lives in an integration package, and `@openlinker/integrations-ai` already ships
  `*.adapter.ts` files that are not capability adapters. No engineering-standards edit is needed. Note
  the two existing `*.provider.ts` files in the repo (`apps/api/src/auth/adapters/mailer.provider.ts`,
  `apps/api/src/mcp/tools/mcp-tool-definitions.provider.ts`) are Nest DI factories, so the suffix stays
  reserved for that meaning.

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
  **A bonus once #1985 lands**: `listDistinctNativeCurrencies` collapses to
  `SELECT DISTINCT "currency" FROM "order_records"`. Deliberately not depended on.
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
- **Path-dependent stamping (the failure the intent snapshot exists for).** The setting is mutable state
  read at stamp time, so without step 11's snapshot an order that degraded to the retry path could stamp
  a different reporting currency than the same order stamped inline — making provider availability a
  silent input to a financial figure. Worse at the sweep, whose lag is unbounded by design: one admin
  edit would reclassify an arbitrary slice of history **deployment-wide**, with nothing recording which
  cohort a row belongs to. *Mitigation*: `fxIntendedCurrency` + `fxRule` are claimed at the first
  attempt and every later path reads them; asserted by the test that the settings service is never called
  once the intent is populated. Note this failure is **not** specific to the ladder design — collapsing
  to a system-level setting removes the history-driven drift but leaves this one untouched, which is why
  the snapshot is a precondition of the simplification rather than an alternative to it.
- **An operator changes the setting mid-life.** Already-stamped orders keep their currency, so the
  deployment carries two eras. *Mitigation*: forward-only by design (ADR-040 § Decision 8), the `PUT`
  reports the stamped-row count so the split is accepted knowingly, and restatement is filed. **Not**
  mitigated: no restatement path exists yet.
- **The `EUR` default converts on a deployment that never opened the settings page.** A PL operator's PLN
  orders would be stamped through an ECB-inverted quote — exact and auditable, but not what they would
  have chosen. *Mitigation*: the `(default)` label, `OL_REPORTING_CURRENCY`, the per-figure currency
  label on analytics, and save-time coverage validation. *Residual*: nothing forces the choice, because
  forcing it was rejected (§ 7 Alternative 1).

### Edge cases

| Case | Handling |
|---|---|
| `from === to` | identity short-circuit before any I/O; `exchangeRateId` stays `NULL`, `reportingCurrency` + `fxStampedAt` set |
| No settings row | `OL_REPORTING_CURRENCY` if it normalises and is supported, else `'EUR'`; `source` reports which |
| `OL_REPORTING_CURRENCY` malformed or unsupported | ignored with exactly **one** warn, falls to `'EUR'` — never a boot throw |
| Setting changed between an order's ingestion and its retry | the retry stamps the **persisted intent**, not the new value |
| Setting changed between two orders' ingestions | they legitimately differ — the era split, reported by the `PUT`'s stamped-row count |
| Two concurrent first attempts on one order | `claimFxIntentIfAbsent`'s `IsNull()` means one wins; the loser re-reads and adopts the winner's intent |
| Coverage gap at save time (an ingested currency the target cannot reach) | warns, returns the uncoverable set, requires `acknowledgeCoverageGaps` — never blocks |
| A channel added *after* the save introduces an uncoverable currency | falls back to the per-order terminal path; save-time validation is backward-looking by construction |
| `placedAt` absent | `resolveRateDate` → `null` ⇒ **terminal**: warn, `fxStampedAt` set, no other column, no retry job. Never a `RangeError` out of `Intl`. **No longer reachable from WooCommerce** once step 15's one-line mapping lands |
| `placedAt` present but an Invalid Date | same terminal path — `order-ingestion.service.ts:638` has no `Number.isNaN` guard, so this reaches the stamp service |
| Order placed 23:30 UTC Sunday | Warsaw is UTC+1/+2, so this is already **Monday** 00:30/01:30 in Warsaw ⇒ rate date = the **previous Friday**. (The earlier draft's "00:30 UTC" case was backwards: 00:30 UTC Monday is 01:30/02:30 the *same* Monday and shifts nothing.) |
| Monday order | rate date = Friday |
| Saturday / Sunday order | rate date = the preceding Friday (calendar, not walk-back) |
| Order the day after a holiday cluster | calendar skips the cluster; the walk-back is not exercised |
| NBP unexpectedly has no table for a calendar working day | 404 walk-back, bounded at 7; the **actual** `effectiveDate` is persisted |
| Currency absent from the selected source's table | `supports()` false ⇒ terminal, `business_failure`, no 70-request storm |
| The selected source is not registered (host wiring missed) | terminal `business_failure`, not a retry — an infra misconfiguration must not burn 10 attempts |
| NBP answers 400 (malformed / out-of-range date) | any non-404 4xx ⇒ terminal |
| Pivot legs resolve to different `effectiveDate`s | raise (terminal) — never silently pick one |
| Source clock ahead / future `placedAt` | `min(resolved, todayInWarsaw)` clamp |
| NBP 5xx / timeout | order persisted unstamped, warn, retry job enqueued; sweep is the backstop |
| Retry-job enqueue itself throws | logged distinctly (nested `try/catch`); the sweep still recovers the row |
| Retry runs after the setting changed | the retry stamps the intent snapshotted at the first attempt; the settings service is **not** consulted. Identical to what the inline path would have written. Covered by a test |
| Inline stamp races the retry job | `stampFxIfAbsent`'s `IsNull()` predicate means exactly one wins; the loser returns `false` and no-ops |
| Two workers ingesting concurrently | `insertIfAbsent` collapses to one rate row via insert-then-recover |
| `totals.total === 0` | stamped as `0`; no special case |
| Negative / refund total | `round2` must **not** clamp at 0 (see § 6 money arithmetic) |
| Order re-ingested after a rate change | stamp untouched (`reportingCurrency IS NULL` guard fails) |
| `persistOrder`'s returned record | always reflects the stamp — one conditional `findById`, shared with the cancellation writer, taken only when a post-upsert write actually occurred |

### Backward compatibility

- ✅ All six columns nullable; `exchange_rates` and `reporting_currency_setting` are new. No existing
  read changes shape.
- ✅ Pre-existing orders keep `reportingCurrency IS NULL`; analytics consumers must treat `NULL` as
  "not stamped", not as zero — and must not use `exchangeRateId IS NULL` for that (see § 6).
- ✅ No connection needs editing: there is no new `Connection.config` key, and `config.currency` (#362)
  keeps its meaning and its readers untouched.
- ✅ A deployment that never sets the setting resolves `'EUR'` and starts stamping. That **is** a
  behaviour change for a mixed-currency estate (orders that previously carried no reporting figure now
  carry one), which is the point of the feature — but it is additive: no existing column or read is
  altered.
- ⚠️ **The WooCommerce `placedAt` mapping (step 15) changes existing behaviour outside this feature**:
  invoicing's `saleDate` for WC orders moves from `undefined` to the order's creation instant. That is a
  fix per #1525's rule, not a regression, but it is the one non-additive edit in this PR and belongs in
  the PR body.

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
| `resolveRateSource` | `PLN → 'nbp'`; `EUR → 'ecb'`; an unsupported code throws | `libs/core/src/currency/domain/__tests__/rate-source-resolution.spec.ts` |
| NBP adapter | direct; inverted; **cross-rate with an exact expected value** (EUR mid 4.2500 / USD mid 3.9000 → `1.08974359`); 404 walk-back; exhausted walk-back → `RateUnsupportedPairError`; **400** → terminal; 503 → transient; timeout → transient; `supports()` false; **pivot legs with different `effectiveDate`s → raise** | `libs/integrations/fx/src/infrastructure/adapters/__tests__/nbp-exchange-rate.adapter.spec.ts` |
| ECB adapter | the same matrix, plus its own calendar's non-publication day and the EUR-pivot direction. **Blocked on the § 4 research item** — write the cases once the historical endpoint's shape is established, not against a guess | `.../__tests__/ecb-exchange-rate.adapter.spec.ts` |
| Provider registry | duplicate `register` throws; unknown `get` throws the **terminal** error; empty until an integration module registers; **both adapters registered simultaneously** | `libs/core/src/currency/infrastructure/adapters/__tests__/exchange-rate-provider-registry.service.spec.ts` |
| `CurrencyRateService` | identity; registry hit performs **no** provider fetch; `DuplicateExchangeRateError` → re-select winner; `RateUnsupportedPairError` propagates; an **unregistered source** surfaces as terminal | `.../application/services/__tests__/currency-rate.service.spec.ts` |
| `ExchangeRateRepository.insertIfAbsent` | PG `23505` → `DuplicateExchangeRateError`; any other error propagates unchanged | `.../repositories/__tests__/exchange-rate.repository.spec.ts` |
| **`ExchangeRateRepository` append-only** | no mutating ORM operation (`update` / `upsert` / `delete` / `remove`) is reachable from any public method, and the single `save()` call carries no `id` — the guard that replaces the rejected DB trigger (§ 8) | same file |
| `ReportingCurrencySettingsService` | row → env → default, each with the right `source`; malformed env ignored with exactly one warn; unsupported env ignored; `setReportingCurrency` 422 on an unsupported code, 400 on a bad ISO shape, persists a supported one and flips `source` to `'setting'` | `libs/core/src/currency/application/services/__tests__/reporting-currency-settings.service.spec.ts` |
| `assessCoverage` | returns the uncoverable observed set; empty when everything is reachable; **never throws and never blocks** | same folder |
| `OrderFxStampService` | equal-currency asserts the rate service was **never** called; **converting path asserts an EXACT `reportingTotalAmount`** (e.g. `100.00 × 4.25 = 425.00`, and a non-trivial one such as `123.45 × 1.08974359 = 134.53`); provider-failure degrade (persisted, unstamped, one job enqueued); **enqueue-throws** does not propagate and logs distinctly; `null` rate date → terminal, **zero** enqueues; unsupported pair → terminal; **a populated `fxIntendedCurrency` means the settings service is never called and the stamped currency equals the intent even after the live setting changed**; a losing `claimFxIntentIfAbsent` adopts the winner's intent | `.../services/__tests__/order-fx-stamp.service.spec.ts` |
| `persistOrder` return freshness | re-reads and returns the stamped FX fields when the stamp wrote; **no** extra read when the stamp was `deferred` or `terminal`; **exactly one** read when both the cancellation writer and the stamp wrote | `libs/core/src/orders/application/services/__tests__/order-record.service.spec.ts` |
| `round2` boundaries | `x.005` half-up (e.g. `2.005 → 2.01`), `0`, a **negative/refund** total stays negative (the `pricing-rule.types.ts` clamp trap), a large magnitude | wherever `round2` lands |
| `stampFxIfAbsent` guard | asserts `toHaveBeenCalledWith({ internalOrderId, reportingCurrency: IsNull() }, {…five columns…})` and `false` when `affected` is 0 (precedent: `shipment.repository.spec.ts:383-386`) | `.../repositories/__tests__/order-record.repository.spec.ts` |
| `claimFxIntentIfAbsent` guard | the same shape against `{ internalOrderId, fxIntendedCurrency: IsNull() }`, writing `fxIntendedCurrency` + `fxRule`; `false` when `affected` is 0 | same file |
| `listDistinctNativeCurrencies` | emitted SQL carries the `jsonb_typeof(...) = 'string'` guard; returns a de-duplicated set; **no** `LIMIT 1` and no ordering | same file |
| **`toOrm` omits all six FX columns** | asserts each is `undefined` on the entity passed to `save()` (mirrors the `cancelledAt` regression spec at `:270-283`) | same file |
| Retry handler | stamps; no-ops when already stamped; terminal → `business_failure`; transient → retryable throw; **the idempotency key collapses repeated failures for one order** | `apps/worker/src/sync/handlers/__tests__/marketplace-order-fx-stamp.handler.spec.ts` |
| Sweep handler | predicate is `fxStampedAt IS NULL AND reportingCurrency IS NULL`; a terminal row (`fxStampedAt` set) is **not** selected | `apps/worker/src/sync/handlers/__tests__/marketplace-order-fx-stamp-sweep.handler.spec.ts` |
| Settings controller | 400 / 422 mapping (mirror `ai-provider-settings.controller.ts`'s `withDomainExceptionMapping`); the response carries `source`, `supportedCurrencies`, the coverage set and the stamped-row count | `apps/api/src/currency/http/__tests__/currency-settings.controller.spec.ts` |
| Write-guard coverage | `CurrencySettingsController` is present in `CONTROLLERS` | the existing `apps/api/src/auth/write-guard-coverage.spec.ts` |
| FE settings tile | renders `EUR (default)` when `source !== 'setting'` and the bare code otherwise; the coverage warning blocks submit until acknowledged | `apps/web/src/features/currency-settings/components/__tests__/currency-settings-tile.test.tsx` |
| WooCommerce `placedAt` | a feed order maps `date_created_gmt` onto **both** `createdAt` and `placedAt` | the existing `woocommerce-order-source.adapter.spec.ts` |

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

1. **The degrade path**: provider throws → order persisted, `reportingCurrency` /
   `reportingTotalAmount` / `exchangeRateId` / `fxStampedAt` all `NULL` but **`fxIntendedCurrency` and
   `fxRule` set** (the deferred state, § Implementation details), **zero** `exchange_rates` rows, exactly
   one `marketplace.order.fxStamp` job in `sync_jobs`. (This replaces the earlier draft's same-currency
   scenario, which is near-tautological once the short-circuit is unit-tested — and this is the path the
   whole § 8 risk section rests on.)
2. Ingest a foreign-currency order → stamped, one `exchange_rates` row created with the expected
   `rate`, `rateDate`, `source`, `sourceRef`, `derivation`.
3. Ingest a **second** foreign-currency order, same day and pair → still exactly one rate row.
4. Re-ingest order 2 with the provider now returning a different rate → all six columns unchanged.
5. **Concurrency**: `Promise.all` of two `insertIfAbsent` calls for the same key → neither throws and
   `SELECT count(*) FROM exchange_rates WHERE …` is `1`.
6. **Append-only in behaviour, not just in call shape**: a second get-or-create for an existing key with a
   *different* rate leaves the stored row byte-identical (`rate`, `sourceRef` unchanged) and the table at
   one row. This is the behavioural half of the guard that replaces the rejected DB trigger (§ 8).
7. **No settings row ⇒ stamped in `EUR`**; with a row present ⇒ stamped in that currency. Covers the
   resolution chain against a real database rather than a mocked repository.
8. **The intent snapshot survives a setting change**: ingest an order whose stamp is made to fail, change
   the setting, run the retry → the order stamps in the **original** currency, and `fxIntendedCurrency`
   matches it.

Add **`exchange_rates` and `reporting_currency_setting`** to `tablesToTruncate` in
`apps/api/test/integration/setup.ts:60` — a table not listed there is never cleaned between tests, and a
leaked singleton settings row would make scenario 7 order-dependent.

### Mocking strategy

- Mock `ExchangeRateProviderPort` (the port) — never a concrete adapter class.
- Mock `FetchLike` in each adapter spec — never `globalThis.fetch`, and never a live HTTP call in any
  tier (neither NBP nor ECB).
- In the int-spec, register `FakeExchangeRateAdapter` into the real registry rather than mocking the port
  — that exercises the registration seam the host wiring depends on.
- No `ConnectionPort` mock is needed anywhere: nothing per-connection is read.
- Real Postgres in the int-spec; everything else mocked per the testing guide.

### Acceptance criteria

Inlined from #2049, with `base*` → `reporting*` and the ladder replaced by the system-level setting.
**#2049's body still describes the superseded design** (`baseCurrency`, `baseTotalAmount`, three rungs,
migration `1833000000000`, and a link to an ADR filename that no longer exists) — it needs the same
refresh, since it carries the criteria someone implements against.

- [ ] `exchange_rates` exists with a unique constraint on `(source, fromCurrency, toCurrency,
      rateDate)`; two concurrent get-or-create calls for the same key resolve to one row and neither
      throws (int-spec scenario 5).
- [ ] `exchange_rates` carries `pivotCurrency` and `derivation`, so an inverted or pivoted rate
      records how it was obtained and the document references of its legs.
- [ ] `order_records` carries `reportingCurrency`, `reportingTotalAmount`, `exchangeRateId`,
      `fxRule`, `fxStampedAt`, `fxIntendedCurrency`, all nullable, with the partial composite index and
      the group CHECK — whose first arm does **not** require `fxRule IS NULL`, so an intent row is legal.
- [ ] `exchange_rates` has no reachable mutation path (asserted by spec) and a second get-or-create for an
      existing key leaves the row byte-identical (asserted by int-spec).
- [ ] An order whose currency equals the reporting currency is stamped with
      `reportingTotalAmount === totals.total`, `exchangeRateId === null`, and **no** rate lookup is
      performed (assert the provider is never called).
- [ ] An order whose currency differs is stamped with the rate for the previous **Polish working
      day** relative to `placedAt` in `Europe/Warsaw`, `reportingTotalAmount` equals
      `round2(total × rate)` **exactly** (asserted numerically), and `exchangeRateId` resolves to a
      row carrying that rate, its date, its source, and its `sourceRef`.
- [ ] Re-ingesting an already-stamped order (re-running `syncOrderFromSource` for the same external
      id) leaves all six FX columns byte-identical.
- [ ] The reporting currency resolves `settings row → OL_REPORTING_CURRENCY → 'EUR'`, is reported with the
      `source` that produced it, and renders as `EUR (default)` until explicitly set. A malformed or
      unsupported env value is ignored with one warn, never a boot failure.
- [ ] The setting is validated at save time: bad ISO shape ⇒ 400, unsupported currency ⇒ 422 (with the
      supported set in the message), and a coverage gap against already-ingested currencies **warns and
      requires an acknowledgement** rather than blocking.
- [ ] The rate source is derived from the reporting currency (`PLN → nbp`, `EUR → ecb`) — no
      active-provider setting, both adapters registered simultaneously.
- [ ] `Connection.config.currency` (#362) is **not read by any FX code path** (asserted by grep), and no
      `Connection.config.fx` key is introduced.
- [ ] The reporting currency and rule are pinned at the **first stamp attempt** (`fxIntendedCurrency`,
      `fxRule`); an order stamped by the retry job or the sweep carries the same currency the inline
      attempt resolved, asserted against a setting that changed in between.
- [ ] `persistOrder`'s returned record reflects the stamp, via one conditional re-read shared with the
      cancellation writer.
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
- [ ] `libs/core/src/currency/` performs **no outbound HTTP**; every provider adapter ships in
      `@openlinker/integrations-fx`, registered into the core registry at boot, and **nothing in
      `libs/core` imports the fx package**. `libs/integrations/fx` is listed in
      `scripts/check-outbound-http.mjs` and the matching ESLint glob, with at most one scoped
      `eslint-disable` at the `FX_FETCH_TOKEN` factory.
- [ ] `OL_REPORTING_CURRENCY` is documented in `apps/api/.env.example`, `apps/worker/.env.example` and the
      root `./.env.example`, and passed through by `docker-compose.demo.yml`.
- [ ] `CurrencySettingsController` is registered in `write-guard-coverage.spec.ts`'s `CONTROLLERS`.
- [ ] The WooCommerce order source populates `placedAt` from `date_created_gmt`, so a foreign-currency WC
      order stamps instead of being terminal.
- [ ] `libs/core/src/currency/` imports no sibling core context (verified by grep **and**
      `pnpm check:invariants`).
- [ ] The migration's 13-digit prefix sorts after every migration on `main` and in every dir in
      `scripts/plugin-migration-dirs.json`; its class suffix matches the filename; and a manual
      `migration:run` → `migration:revert` → `migration:run` round-trip against the dev stack is
      pasted in the PR.
- [ ] `toOrm` still omits every FX column (all six), asserted by a regression spec.
- [ ] Tests added or updated for non-trivial logic.
- [ ] No architecture boundary violations (CORE ↔ Integration).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries — port + registry + rules in core with **no outbound HTTP**,
      every adapter in `@openlinker/integrations-fx`, no capability port and no manifest (the
      `@openlinker/integrations-ai` posture)
- [x] Uses existing patterns (denormalized columns, narrow absolute-set writes, guarded claim-write,
      insert-then-recover get-or-create, the singleton-settings stack, the core-registry-populated-by-
      integration-modules seam, the existing PL working-day calendar) — no new abstraction introduced
- [x] Idempotency considered (`stampFxIfAbsent` and `claimFxIntentIfAbsent` guards, `insertIfAbsent`,
      idempotent retry job, reconcile sweep)
- [x] Event-driven patterns used where applicable (none apply; the retry + sweep use the existing
      job queue)
- [x] Rate limits & retries addressed (calendar-first rate date, bounded walk-back, HTTP timeout,
      transient-vs-terminal split, degrade-to-job, sweep backstop)
- [x] Error handling comprehensive (three domain exceptions, none escapes ingestion, terminal and
      transient separated per ADR-007)
- [x] Testing strategy complete (unit + one int-spec vertical slice, no live HTTP, coverage
      enforcement honestly described as absent)
- [x] **Naming conventions followed, no deviation.** The pre-revision `*.provider.ts` deviation is gone —
      the adapters live in an integration package and use the documented `*.adapter.ts` suffix, so no
      engineering-standards edit is needed.
- [x] File structure matches standards
- [ ] **Plan is execution-ready except for two items, one of them a hard prerequisite.**
      (1) § 4's **ECB historical-endpoint research is a blocker for Phase 1b only** — the daily XML feed
      carries just the latest day, so `EcbExchangeRateAdapter` cannot be written against a guess. Phases
      0, 1 (minus 3b's ECB half), 2, 3 and the NBP adapter are unblocked.
      (2) § 5 open question 1 (#1985/#1987/#1988 group by the *native* currency) is a product
      precondition for **those** issues, not for this one; the proposed AC edit and its owner are named
      there.
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
