# ADR-040: Order-time FX stamping against a system-wide reporting currency

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @norbert-kulus-blockydevs

## Context

An operator selling mostly in PLN may take an order in another currency. The order analytics read
model (#1985) denormalizes the order's *native* `currency` + `totalAmount` onto `order_records`, which
makes per-currency aggregates queryable but leaves every cross-currency total unanswerable: summing
120 000 PLN and 8 400 EUR produces a number that means nothing.

Read-time conversion is not an option for a financial figure — only the rate that applied at placement
is defensible, and it must stay fixed however often the order is re-ingested. So the conversion is
*stamped* at ingestion and never recomputed.

That raises the question this ADR answers: **converted into what?** Three things were conflated:

| Level | What it is | Kind |
|---|---|---|
| Order | the currency the buyer paid in | **fact** |
| Connection | the currency that shop prices products in (`config.currency`, #362) | **fact** |
| Business | the currency we report in | **choice** |

Deriving the reporting currency per connection derives a *choice* from *facts*, and cannot deliver what
this feature exists for: per-connection values produce an estate with no single total, and a value
inferred from order history shifts as an order mix changes. The reporting currency is a property of the
**reporting entity** — one system-level answer.

*Terminology note:* an earlier draft called the target a **base** currency. In FX the *base* of a pair
is the one being priced — what the registry stores as `fromCurrency`, i.e. the order's **own** currency
— so `baseTotalAmount` read as the native total, the opposite of its meaning.

## Decision

1. **One system-level reporting-currency setting**, resolved `settings row → OL_REPORTING_CURRENCY →
   'EUR'` — the singleton-row shape `ai_provider_active_setting` establishes (`reporting_currency_setting`
   keyed `id = 'singleton'`, an admin `GET`/`PUT`, no in-process cache). The default converts, so it
   must announce itself: the resolved value is reported with the rung that produced it, renders as
   `EUR (default)` until explicitly set, and every analytics figure is labelled with its currency where
   it is consumed.

   `Connection.config.currency` (#362) keeps its meaning and readers — a genuine fact about a shop —
   and is **explicitly not consulted** for reporting. There is no per-connection FX config.

2. **The rate source is a function of the reporting currency**, not a second setting: `PLN → NBP`,
   `EUR → ECB`, one provider call per order that needs one. NBP quotes every table-A currency against
   PLN and ECB quotes EUR against everything, so each pair is either a direct published quote or a
   single documented inversion — no cross-rate pivot arises for either supported value.

   The setting is therefore **validated at save time against provider coverage** and accepts `PLN` and
   `EUR` for now. The pivot path stays implemented, so a third reporting currency is additive: a third
   provider plus one entry in the same mapping, with nothing above it changing.

3. **Convert only when the order's currency differs from the reporting currency.** The equal case
   writes `reportingTotalAmount = totals.total` with no rate lookup and no I/O. `reportingCurrency`,
   not `exchangeRateId`, is the discriminator for "unstamped".

4. **Rates live in a shared `exchange_rates` registry keyed `(source, from, to, rateDate)`**, not per
   order — five hundred EUR orders on one day resolve to one row. It is append-only: the port declares
   only `findByKey` and `insertIfAbsent`, pinned by a spec asserting no mutating ORM operation is
   reachable and an integration test asserting a second get-or-create leaves the row byte-identical. No
   database-level guard ships (§ Consequences).

   **Direction is a stated invariant, not an implementation detail**: `rate` is the number of `to` units
   per one `from` unit. For the stamp, `from` is always the order's own currency and `to` the reporting
   currency, so a stamp is always `total × rate`, never a division. The registry itself is
   **consumer-neutral** — it stores published rates, not stamps — so a future consumer with a different
   target stores its own `(from, to)` rows without breaking the invariant. An inverted or pivoted rate
   records how it was obtained, and its legs' document references, so a derived figure stays auditable.

5. **The reporting currency and rate rule are resolved once, at the first stamp *attempt***, persisted
   on the order row (`fxIntendedCurrency`, `fxRule`) before any rate lookup; the retry job and the
   reconcile sweep read that snapshot and never re-resolve. The stamped figure is thus a function of the
   order's **ingestion**, not of which write path succeeded. Without it, an order degraded to the retry
   path could stamp a different currency than the same order stamped inline — making provider
   availability a silent input to a financial figure — and the reconcile sweep, whose lag is unbounded
   by design, could reclassify arbitrary history after any setting change.

6. **The stamp is written by a narrow conditional UPDATE that fires only when no stamp exists yet** (the
   `ShipmentRepository.claimWaybillRelay` shape: `IsNull()` in the WHERE, `affected > 0` as the answer),
   never through the `persistOrder` upsert path, so re-ingestion cannot move a reported figure — and
   `persistOrder`'s returned record is refreshed when it wrote, so no caller reads a stale `null`.

7. **A new leaf core context `libs/core/src/currency/`** owns the registry, the
   `ExchangeRateProviderPort` contract, the provider registry, and the rule → rate-date derivation, with
   **no outbound HTTP** and no sibling-context dependency. Every provider ships in
   **`@openlinker/integrations-fx`** — the same split as `AiCompletionPort` in core versus the vendor
   adapters in `@openlinker/integrations-ai`, and *not* conditioned on whether a source needs a
   credential today, so nothing moves packages if NBP or ECB adds a key. `FxIntegrationModule` registers
   each adapter into the core registry at boot, as integration modules already populate
   `AdapterRegistryService` (#570/#571). Providers are **not** capability adapters — a published
   reference rate is a shared read, not a per-connection capability — so there is no manifest entry and
   no `getCapabilityAdapter` path.

8. **Changing the setting does not restate history.** Already-stamped orders keep their currency, so a
   deployment that changes its mind carries two reporting-currency eras. The `PUT` reports how many
   stamped rows exist, so the choice is informed rather than silent; restatement is filed as **#2096**
   (§ Migration path).

## Non-goals

- **Fiscal currency conversion.** This stamp must never produce the rate on a fiscal document — FA(3)
  `KursWaluty` or a provider's equivalent (§ Consequences).
- **Modelling the tax point.** `IssueInvoiceCommand.saleDate` is a supply date derived from
  `order.placedAt`; it is not *obowiązek podatkowy*, which OL does not model.
- **Changing which component owns the rate per invoicing provider** — already per-provider, unchanged.

## Alternatives considered

- **A connection-derived reporting currency** (explicit `config.fx.reportingCurrency` → `config.currency`
  → dominant native currency from history → the order's own currency). Rejected: it derives a business
  *choice* from channel *facts*, its history rung shifts silently, it gives `config.currency` a second
  meaning, and per-connection values make a deployment-wide total impossible by construction — the
  problem this feature exists to solve.
- **Locking the setting after the first stamp.** Rejected: the default converts and nobody chose it, so a
  lock makes an *unchosen* default permanent — a deployment that never opens the settings page takes one
  foreign-currency order and is locked into a currency it was never asked about. A lock is coherent only
  if the first stamp is gated behind an explicit choice, which contradicts having a default.
- **Rate providers as plain `@Injectable` classes inside `libs/core`**, bounded by a rule that only a
  credential-bearing provider ships as an integration package. Rejected: it splits two implementations of
  one port across packages on an incidental property of someone else's auth policy, is unenforceable by
  `check:invariants`, and introduces the first outbound HTTP call in `libs/core` — a precedent the next
  "simple unauthenticated GET" would cite.
- **An active-provider setting** (the AI precedent, where one vendor wins). Rejected: NBP and ECB must be
  live simultaneously, since a fiscal consumer needs an NBP/PLN rate on a EUR-reporting deployment. The
  `(source, …)` key already admits concurrent sources; only the code layering assumed one.
- **The DESTINATION connection's currency.** Rejected: analytics reports what the buyer paid on a sales
  channel, not what the fulfilling shop booked.
- **One rate row per order.** Rejected: it multiplies identical rows by order volume and makes "which rate
  did we use on 3 August" a `DISTINCT` scan instead of a unique-index read.

## Consequences

**Pros:**
- A deployment-wide total is expressible, because there is one authoritative answer to "in what?".
- Zero configuration for the common case — the default resolves with no settings step.
- The equal-currency path costs nothing: no query, no HTTP call, no rate row.
- A stamped order is reproducible: `exchangeRateId` joins to the exact rate, date, source and document
  reference.
- Coverage is validated once at save time, in front of the person choosing, rather than discovered one
  order at a time as a terminal business failure in a job log.
- The rule is persisted per stamp, so a second rule cannot make history ambiguous — for any rule mapping
  one instant to one published calendar day. A period-based rule (`month-average`) does not fit the
  `(source, pair, date)` key and would need a `rateKind` column.

**Cons / trade-offs:**
- **A stamped figure must never reach a fiscal document.** It differs from a statutory conversion on all
  three axes that define a rate, so no arithmetic recovers one from the other. **Date**: this stamp
  anchors on `order.placedAt`; PL VAT (art. 31a ust. 1) anchors on the last business day preceding the
  day the *tax obligation* arose (art. 19a) — which under ust. 8 is the *payment* instant when the buyer
  paid first, a timestamp no shipped OL source persists (Allegro reads one and discards it). Placement
  is therefore not a merely different date; it is structurally never the tax point for OL's most common
  order shape. **Target**: always PLN statutorily. **Derivation**: a statutory rate must be a directly
  published table-A quote, never an inverted or pivoted cross.

  **Invoicing therefore computes its own rate and does not consume this stamp**; the two figures for one
  order legitimately differ. This bites hardest where it looks safest: on a PLN-reporting deployment both
  come from NBP table A and differ *only* by date, so the rows look interchangeable and are not. Rate
  ownership is per-provider — KSeF is the only path where OL builds the document and would own the rate;
  inFakt and Subiekt nexo compute their own conversion server-side and must not be handed one. FA(3)
  draws the same line: `KursWaluty` (`schemat_fa3_v1-0e.xsd:3199`) is scoped to *dział VI ustawy*, while
  `KursUmowny` / `WalutaUmowna` (`:3490`) is scoped *"Nie dotyczy przypadków, o których mowa w dziale
  VI"* — the only element a self-computed rate may occupy.
- **One deployment, one reporting currency.** Two legal entities reporting differently cannot be
  expressed. Accepted because OL has no tenancy concept, and a per-entity currency with no per-entity
  boundary is fiction.
- **The default converts.** `'EUR'` applies to a deployment that never opened the settings page, and a
  PLN order then converts through an ECB-inverted quote — exact and auditable, but a UX choice rather
  than a claim that EUR suits anyone. Hence the `(default)` label, the env override, and the per-figure
  currency label.
- **The reporting currency is effectively a two-value set at launch.** Save-time validation accepts only
  `PLN` and `EUR`, because those are the two currencies the shipped providers quote against — an operator
  who wants GBP cannot have it until a third provider is added. That follows from provider coverage rather
  than from the model, and the pivot path stays implemented so the addition is additive, but it is a real
  limitation and not a temporary omission.
- **Changing the setting splits history into eras** (§ Decision 8). Everything needed to restate is
  retained (native currency, `placedAt`, the registry), so it stays computable; it is simply not built —
  filed as **#2096**.
- **Analytics must separate stamped from unstamped rows.** Stamped orders sum into one figure; unstamped
  (provider outage, retry pending) and terminal rows (no `placedAt`, unsupported pair) do not, so any
  figure must be paired with an unstamped count. **The consuming issues #1985 / #1987 / #1988 currently
  group by the *native* currency and specify that "multiple currencies never sum into a single figure"** —
  reconcilable under this model rather than contradictory, but reconciling those acceptance criteria is a
  precondition for those issues, not for this one.
- **Save-time validation is static and backward-looking.** It reads a shipped coverage list (which drifts
  if a source delists a currency) and sees only currencies already ingested, so a channel connected later
  can still introduce an uncoverable pair, falling back to the per-order terminal path.
- **No database-level append-only guard.** A `BEFORE UPDATE` trigger was rejected because the integration
  harness builds its schema with TypeORM `synchronize` and never runs a migration, so a migration-only
  trigger would be absent in dev and CI and would first fire in production (no migration in this repo
  creates one either). A `REVOKE UPDATE` is a no-op because the shipped configuration connects as a
  superuser. Revisit when the harness runs migrations.
- The registry is a new persistence surface with an external dependency behind it. A provider outage
  degrades to an unstamped order plus a retry job, never a failed ingestion — and because a dead retry job
  would hold its idempotency key forever, a periodic reconcile reads the unstamped rows directly.
- **The stamp is only as good as the order's placement timestamp, and one shipped source does not supply
  one.** Sources that do (PrestaShop, Allegro, Erli) are unaffected. The WooCommerce order source maps
  `date_created_gmt` onto `createdAt` and never sets `placedAt`, so a foreign-currency WooCommerce order
  cannot resolve a rate date and is recorded **unstamped** — deliberately as a *terminal* condition, so it
  neither throws inside ingestion nor retries forever.

  The data is not missing: WC's `date_created` is the same fact PrestaShop's `date_add → placedAt` mapping
  carries, so this is a one-line adapter change. It is **still tracked separately**, and the reason is
  fiscal rather than technical: `saleDate` is set only when `placedAt` is present
  (`order-to-issue-invoice-command.mapper.ts:108-115`), so today a WooCommerce invoice carries **no**
  `saleDate` and the provider substitutes its own date. Populating `placedAt` therefore moves that field
  from empty to the placement date — which is more correct, and which can move an invoice into a different
  tax period when the order was placed in an earlier month than it is invoiced. Already-issued documents
  are unaffected (`InvoiceRecord` is a persisted projection, and `issuedLineSnapshot` (#1297) exists so
  nothing re-derives from live order state), but a *future* invoice for an *existing* WooCommerce order
  would change. That is an invoicing decision with its own review, not an FX one — filed as **#2097**.

  Note also that no source supplies a *payment* timestamp — Allegro reads one and discards it — which is
  why this ADR anchors on placement and says so rather than claiming the rate of the day the buyer paid.
- **The two providers publish on different calendars** (Polish working days versus TARGET) and cut-offs, so
  the rule yields a candidate day and each adapter absorbs its own calendar via walk-back-on-miss — a
  further reason both live in one package.

**Migration path (if applicable):**
- Existing orders carry no stamp (`reportingCurrency IS NULL`). **No backfill of pre-feature orders ships
  here** — the retry job covers orders that could not be stamped at ingestion, a different thing.
  Historical rates are available from both providers, so a backfill remains possible later.
- **Restating figures already stamped under a previous setting is [#2096](https://github.com/openlinker-project/openlinker/issues/2096)**
  (§ Decision 8). Until it lands, changing the setting is forward-only, and the `PUT` reports the
  stamped-row count so the era split is accepted rather than discovered.

## Amendment (#2468, 2026-08-26): an operator-triggered, ledger-audited restatement of a stale-era stamp

**Status of the rule:** unchanged as a default. `stampFxIfAbsent`, `claimFxIntentIfAbsent` and
`markFxTerminal` still all guard on `reportingCurrency IS NULL`, and no automatic path anywhere moves a
figure. What this amendment adds is one narrow, deliberate exception, and it exists because the rule as
written had a cost nobody had priced: an order stamped under a previous reporting-currency era is not
merely "recorded in an old currency", it is **invisible to every `/analytics` KPI**. `getDailyOrderAggregates`
sums `reportingTotalAmount` only where `reportingCurrency = :currentReportingCurrency`, so a prior-era
stamp reads as unconverted — the same bucket as an order that was never stamped at all. Revenue silently
under-reports, and the immutability rule is what keeps it under-reporting forever.

Epic #2452's Data Coverage panel surfaces exactly that population, and #2468 gives it a fix:

- `OrderRecordRepositoryPort.clearFxStampForRestatement` nulls the six stamp columns
  (`reportingCurrency`, `reportingTotalAmount`, `exchangeRateId`, `fxStampedAt`, `fxIntendedCurrency`,
  `fxRule`) in one guarded statement, and is the ONLY writer in the codebase that moves a stamp. The
  column set is the one the `1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders` migration
  already established; `fxIntendedCurrency` in particular must go, or `resolveIntent` re-pins the stale
  currency and re-stamps it — a repair that looks successful and is not.
- `OrderFxRestatementService` (`@openlinker/core/orders`) is the only caller, reachable only from the
  `analytics.currency.recalculate` worker job.
- **The exception is acceptable because of the ledger, not in spite of it.** Every restatement runs inside
  an `analytics_remediation_runs` row (`@openlinker/core/analytics`) recording who asked, when, over how
  many orders, and how it ended. What § Decision 8 forbids is a figure that moves with no traceable cause;
  a figure that moves with a durable audit row naming its cause is a different act. Widening the caller
  set, or letting the repair run outside a run row, reopens the original problem.
- The scope is the operator's own coverage-panel window, so a repair can never be wider than the count
  they were shown, and the repair only ever CLEARS — the actual re-stamp is the ordinary
  `marketplace.order.fxStamp` path, against the ordinary intent-resolution and rate rules.

**This is not #2096.** #2096 is "re-express history after a reporting-currency change", which needs an era
model and a restatement policy across the whole corpus. This is the bounded operator-initiated repair of a
coverage gap, on a population the panel already reports and a window the operator already chose. #2096
stays open.

## Amendment (#2777, 2026-09-03): resolving the publication day before the pre-fetch cache read

**The original debt, restated.** Before this amendment, a non-publication candidate (a weekend or a
holiday, roughly 2 days in 7) was a permanent cache miss: the pre-fetch read was keyed on the raw
candidate day, `fetchRate` walked the candidate back to the day the source actually published for, and the
row landed under that earlier day - never under the candidate. This was accepted deliberately, not
overlooked: the registry stores **published** rates, so writing a second row under the candidate (a
non-publication day) would record a rate the source never published for that day - a figure an operator
could not verify against any table, in the one place whose whole purpose is to be verifiable. Memoising
the candidate-to-published-date mapping needed its own persisted table and belonged to a later persistence
phase (#2124); it was not folded into the original stamp (#2049) work, where nothing else changed
behaviour. The cost was real and recurring - every order carrying such a candidate paid a live provider
call, one hundred percent of the time, forever - but it was the honest price of keeping the registry a
verifiable ledger of published rates rather than an invented one.

**What #2777 changes, and what it deliberately does not.** `ExchangeRateProviderPort` gains an optional
`resolveExpectedPublicationDay(candidate): string` (ADR-046 probe-not-trust pattern), which each adapter
answers from the same walk-back calendar it already owns - NBP from the Polish working-day calendar,
ECB from a weekend-only rule (see that adapter's own header for why it must not share NBP's calendar).
`CurrencyRateService.getRateFor` probes for the method and, when present, keys the pre-fetch `findByKey`
read on the RESOLVED day rather than the raw candidate - so the first order under a given non-publication
candidate still pays one provider call (as before), but every later one, for that candidate or any other
candidate resolving to the same published day, now hits the cache. **The write path is untouched**: the
registry still never writes a second row under a non-publication date, and `fetchRate` still receives the
raw candidate and answers with whatever day the source actually published for. Only which key is READ
changes; this ADR's verifiability guarantee - a stored row is always a source's own published answer -
holds exactly as before.

**The guarantee this creates is asymmetric, and an implementer must respect the asymmetry.** A day
resolved TOO LATE (later than the true nearest publication day) can only ever cause a cache miss - no row
exists there, so the read falls through to `fetchRate` unchanged, at the original cost and no worse. A day
resolved TOO EARLY - walking back past a genuine publication day to an earlier one - corrupts a stamp
silently: a row under that earlier day very likely already exists (written by some other candidate that
legitimately resolved there), so the read *hits* and returns the wrong day's rate on a financial figure,
with no exception anywhere. The port's own docblock states this explicitly and requires that an
implementer in doubt return the candidate unchanged - erring late is free, erring early is not. Neither
shipped adapter can produce a too-early answer today: ECB only ever skips a weekend, and NBP's calendar is
the same one that already decides which day NBP requests, so it errs optimistic rather than walking back
past a day it is not certain about. A shared `resolveExpectedPublicationDay` port-contract suite
(`@openlinker/core/currency/testing`) binds every implementer - NBP, ECB, and the fake - to this contract,
so a future implementer cannot silently drift from it.

## References

- Related issues: #2049 (this work), #1976 (analytics epic), #1985 (order analytics read model),
  #1987 / #1988 (the consuming queries), #362 (per-connection `config.currency`, unchanged)
- Related PRs: #2050 (this ADR + the implementation plan)
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md) (status-vs-outcome split, applied to
  the retry job), [ADR-011](./011-domain-entity-behavior.md) (pure read-only derivations on entities),
  [ADR-026](./026-country-agnostic-invoicing-domain.md) (the country-agnostic provider boundary). The
  read-model ADR proposed under #1985 is what this stamp extends; cited by issue number because it is
  unmerged, and this ADR is intentionally mergeable without it.
- Precedents followed: `ai_provider_active_setting` (singleton setting + resolution chain),
  `@openlinker/integrations-ai` (port in core, implementations in an integration package),
  `AdapterRegistryService` (core registry populated by integration modules at boot),
  `ShipmentRepository.claimWaybillRelay` (conditional single-writer claim),
  `InvoiceRecord.issuedLineSnapshot` (#1297 — the shape a fiscal rate should follow instead of
  referencing a registry row).
- Follow-ups: **#2096** (restate already-stamped orders when the reporting currency changes),
  **#2097** (populate `placedAt` on the WooCommerce order source)
- Amended by: **#2468** (epic #2452 Phase 5) — the ledger-audited, operator-triggered restatement of a
  stale-era stamp; see § Amendment above.
- Primary doc section: a `docs/architecture-overview.md` § Currency section is **to be added by the #2049
  implementation PR**; it does not exist yet, so this reference is forward-looking rather than a citation.
- Plan: [implementation-plan-2049-order-fx-rate-snapshot.md](../../plans/implementation-plan-2049-order-fx-rate-snapshot.md)
