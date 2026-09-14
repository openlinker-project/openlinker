# Implementation Plan: Expose the Exchange Rate Behind Every Converted Figure (#2778)

**Epic**: #2452 (Phase 6/7/8 axis) — branch off `epic/2452-analytics-currency-coverage`, PR targets that branch, never `main`.

## 1. Understand the task

**Goal**: OpenLinker persists every exchange rate it uses (`exchange_rates` registry, ADR-040) for auditability, but exposes none of it over HTTP. Two additions:

- **A (primary)**: thread the actual applied rate (value, date, source, derivation, sourceRef) through `IDisplayCurrencyConversionService`'s two result types and into `/analytics/sales`'s `DisplayCurrencyConversionDto`, so a converted figure on the dashboard can be traced back to what produced it.
- **B**: a new read-only endpoint, `GET /currency/rates?from=&to=&date=`, that reads the registry directly (never triggers a provider fetch).

**Layer**: CORE (domain types + one new application interface/service in `currency`) + Interface (one new controller + two DTOs, edits to an existing DTO).

**Non-goals** (explicitly out of scope per the issue):
- Exposing `order_records.exchangeRateId` on any orders DTO (separate, not-yet-filed concern).
- Any write/admin surface — this is 100% read-only.
- Touching `ICurrencyRateService.getRateFor` or any provider-fetch path.

## 2. Research findings (already verified against the live repo)

- `ExchangeRateRepositoryPort.findByKey(key: ExchangeRateKey): Promise<StoredExchangeRate | null>` already exists and is a pure DB read — no provider call, no insert. This is exactly what the endpoint needs; it's the `insertIfAbsent` half that must stay unreachable from HTTP.
- `resolveRateSource(to: string): ExchangeRateSource` is a pure function keyed on the **`to`** side of a pair (`SOURCE_BY_REPORTING_CURRENCY`), and every existing caller (`OrderFxStampService`, `DisplayCurrencyConversionService.resolveRate`) resolves source this same way — `from` never determines the publisher. The new endpoint follows the identical rule: `source = resolveRateSource(to)`.
- `DisplayCurrencyConversionService.resolveRate(from, to, rateDate): Promise<number | null>` currently discards the `StoredExchangeRate` it gets back from `getRateFor` and returns only `Number(rate.rate)`. It needs to return the full `StoredExchangeRate | null` instead so callers can build an `AppliedRate` from it (and still `Number()` it locally where a multiply is needed).
- `DisplayCurrencyConversionDto.fromCurrentRateResult` currently **discards `result.breakdown` entirely** — it only reads `unresolvedNativeCurrencies` and the aggregate `convertedTotal`. There is no per-currency breakdown on the wire today. This PR does not change that (out of scope — the issue only asks for a rate arrs paired with the same 0-or-N-element pattern `unresolvedNativeCurrencies` already uses), so the new `appliedRates` field is populated from `result.breakdown`'s resolved rows only.
- `sales-analytics.controller.ts` calls only the two static factories (`DisplayCurrencyConversionDto.fromCurrentRateResult` / `.fromOrderDateResult`) — no controller changes needed for Part A.
- `apps/api/src/currency/currency.module.ts` (`CurrencyApiModule`) is the mount point for the new controller — same pattern as `CurrencySettingsController` (imports `CoreCurrencyModule`, declares controllers, no providers of its own).
- Cross-context rule confirmed: `apps/api` importing `ExchangeRateRepositoryPort` (a `*RepositoryPort`) directly from `@openlinker/core/currency` would be **flagged by `scripts/check-cross-context-imports.mjs`** (the walked scope list includes `apps/{api,worker}/**`, not just core-to-core). This is exactly why the issue's AC requires a new core service interface — confirmed, not just asserted by the issue.
- Stale `"pending in PR #2485"` comment appears in **9** places, not just the one the issue names (`sales-analytics-query.dto.ts:9`). Fixing all 9 in the same pass — same one-line search/replace, no behavior change, avoids leaving 8 more instances of the identical staleness for the next reader.
- `CurrencySettingsController` is the reference for a currency-context controller: JWT-guarded (global `JwtAuthGuard`), `@Roles('admin')` only where it writes; a pure read carries no `@Roles` at all — this new endpoint follows the no-`@Roles` shape.

## 3. Design

### 3.1 Domain types (`libs/core/src/orders/domain/types/display-currency.types.ts`)

```ts
/** What produced one converted figure. Never a statutory rate — ADR-040. */
export interface AppliedRate {
  readonly from: string;
  readonly to: string;
  readonly rate: string;        // string end-to-end vs numeric(18,8) — never Number()'d
  readonly rateDate: string;
  readonly source: string;
  readonly derivation: 'direct' | 'inverted' | 'pivot';
  readonly sourceRef: string | null;
}
```

- `NativeCurrencyBreakdown` gains `appliedRate: AppliedRate | null` — `null` exactly when `convertedTotal` is `null`.
- `OrderDateConversionResult` gains `appliedRate: AppliedRate | null` — `null` exactly when `convertedTotal` is `null` (covers both "nothing stamped" and "lookup failed").

`AppliedRate.derivation` reuses the `RateDerivationKind` union value-for-value but is declared as its own inline literal union (`'direct' | 'inverted' | 'pivot'`) rather than importing `RateDerivationKind` from `currency` — `orders` already has an inbound edge into `currency`'s **value types** (`ExchangeRateSource` is not currently imported by `orders`), and importing `RateDerivationKind` here is the smallest, most literal reflection of the issue's own proposed shape. (Decision: import `RateDerivationKind` type from `@openlinker/core/currency` instead of re-declaring the literal union — avoids a second, hand-copied definition of the same three strings that could drift. `orders` already depends on `currency` for `ICurrencyRateService`/`resolveRateDate`/`resolveRateSource`, so this adds no new cross-context edge, only a new imported symbol from an edge that already exists.)

### 3.2 Service changes (`display-currency-conversion.service.ts`)

- `resolveRate(from, to, rateDate): Promise<StoredExchangeRate | null>` (was `Promise<number | null>`). Every call site multiplies via `Number(stored.rate)` instead of using the returned value directly.
- Add a private pure mapper `toAppliedRate(stored: StoredExchangeRate): AppliedRate` (one place, reused by both `convertAtCurrentRate` and `convertAtOrderDate`).
- `convertAtCurrentRate`: each `breakdown.push(...)` branch that resolves a rate now also sets `appliedRate: toAppliedRate(stored)`; every branch that reports `convertedTotal: null` sets `appliedRate: null` (mixed-currency bucket, same-currency short-circuit gets `appliedRate: null` too — no rate was applied, `convertedTotal` came from the native total directly, matching the "null exactly when convertedTotal is null" rule... **correction**: the same-currency branch sets `convertedTotal = nativeTotal`, which is NOT null — so per the stated rule `appliedRate` would need to be non-null there too, but there is no real "rate" (no lookup happened, it's an identity). Resolved by widening the rule slightly from the issue's literal wording: `appliedRate` is `null` when `convertedTotal` is `null` **or** when no lookup was needed at all (same-currency identity) — a `null` appliedRate on a same-currency row is exactly as honest as "no rate was applied" reads, and is called out explicitly in the field's JSDoc so it doesn't read as a bug.
- `convertAtOrderDate`: same-currency short-circuit and the "nothing stamped" branch both report `appliedRate: null` (consistent with the same widened rule above); the resolved branch reports `toAppliedRate(stored)`.

### 3.3 DTO changes (`apps/api/src/analytics/http/dto/sales-analytics-response.dto.ts`)

- New `AppliedRateDto` class (mirrors `AppliedRate` 1:1) with a `static fromDomain(rate: AppliedRate): AppliedRateDto`.
- `DisplayCurrencyConversionDto` gains `appliedRates: AppliedRateDto[]`:
  - `fromCurrentRateResult`: `result.breakdown.filter(row => row.appliedRate !== null).map(row => AppliedRateDto.fromDomain(row.appliedRate!))`.
  - `fromOrderDateResult`: `result.appliedRate !== null ? [AppliedRateDto.fromDomain(result.appliedRate)] : []` — the same 0-or-1-element normalization `unresolvedNativeCurrencies` already uses for this mode.

### 3.4 New core read-only interface (`libs/core/src/currency/`)

- `application/interfaces/exchange-rate-lookup.service.interface.ts`:
  ```ts
  export interface IExchangeRateLookupService {
    /** Pure registry read — never calls a provider, never inserts. */
    findRate(key: ExchangeRateKey): Promise<StoredExchangeRate | null>;
  }
  ```
- `application/services/exchange-rate-lookup.service.ts`: `ExchangeRateLookupService implements IExchangeRateLookupService`, injects `EXCHANGE_RATE_REPOSITORY_TOKEN`, one-line delegation to `findByKey`.
- New token `EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN` in `currency.tokens.ts`.
- Registered as a provider + export in `currency.module.ts` (mirrors `CurrencyRateService`'s registration exactly).
- Barrel: `export type { IExchangeRateLookupService } from './application/interfaces/exchange-rate-lookup.service.interface';` added to `currency/index.ts`.

### 3.5 New HTTP surface (`apps/api/src/currency/`)

- `http/dto/exchange-rate-response.dto.ts`: `ExchangeRateResponseDto` (rate, rateDate, source, derivation, sourceRef, from, to) + `static fromDomain(stored: StoredExchangeRate)`.
- `http/dto/get-exchange-rate.dto.ts`: query DTO with `from`/`to` (`@IsString() @IsNotEmpty()`, mirroring `SetReportingCurrencyDto`'s bare-string precedent — the selectable set isn't runtime-narrowed the way a reporting-currency save is) and `date` (`@IsDateString()` or `@Matches(/^\d{4}-\d{2}-\d{2}$/)` — ISO date, not instant).
- `http/exchange-rates.controller.ts`:
  ```ts
  @ApiTags('currency')
  @ApiBearerAuth()
  @Controller('currency/rates')
  export class ExchangeRatesController {
    constructor(@Inject(EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN) private readonly lookup: IExchangeRateLookupService) {}

    @Get()
    async getRate(@Query() query: GetExchangeRateDto): Promise<ExchangeRateResponseDto> {
      const source = resolveRateSource(query.to); // throws ReportingCurrencyUnsupportedError -> mapped to 422 by the existing global filter, matching currency-settings' own boundary split
      const stored = await this.lookup.findRate({ source, from: query.from, to: query.to, rateDate: query.date });
      if (!stored) throw new NotFoundException(...);
      return ExchangeRateResponseDto.fromDomain(stored);
    }
  }
  ```
  No `@Roles(...)` decorator at all — reachable by any authenticated user via the global `JwtAuthGuard`, exactly as the issue's AC requires.
- `currency.module.ts` (apps/api): add `ExchangeRatesController` to `controllers: [...]`.

## 4. Step-by-step implementation

1. `libs/core/src/orders/domain/types/display-currency.types.ts` — add `AppliedRate`, extend `NativeCurrencyBreakdown` and `OrderDateConversionResult`; import `RateDerivationKind` from `@openlinker/core/currency`.
2. `libs/core/src/orders/application/services/display-currency-conversion.service.ts` — `resolveRate` returns `StoredExchangeRate | null`; add `toAppliedRate`; wire both modes.
3. `libs/core/src/orders/application/services/__tests__/display-currency-conversion.service.spec.ts` — update existing specs for the new return shape; add the two ACs: "appliedRate non-null iff convertedTotal resolved" (current-rate) and "order-date reports the single applied rate / null for no-stamp / null for lookup-failure".
4. `libs/core/src/currency/application/interfaces/exchange-rate-lookup.service.interface.ts` (new) + `application/services/exchange-rate-lookup.service.ts` (new) + spec.
5. `libs/core/src/currency/currency.tokens.ts` — add `EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN`.
6. `libs/core/src/currency/currency.module.ts` — register + export the new service/token.
7. `libs/core/src/currency/index.ts` — export the new interface type.
8. `apps/api/src/analytics/http/dto/sales-analytics-response.dto.ts` — `AppliedRateDto` + `DisplayCurrencyConversionDto.appliedRates`.
9. `apps/api/src/currency/http/dto/exchange-rate-response.dto.ts` (new).
10. `apps/api/src/currency/http/dto/get-exchange-rate.dto.ts` (new).
11. `apps/api/src/currency/http/exchange-rates.controller.ts` (new) + spec — including the two negative-shape specs the AC calls for: never calls `ICurrencyRateService.getRateFor` (mock it, assert zero calls), and carries no `@Roles` metadata (reflect `Reflector`/`SetMetadata` key, matching whatever pattern the repo already uses to assert "no roles" elsewhere — check `currency-settings.controller.spec.ts` or a similar public-endpoint spec for the exact assertion idiom before writing a new one).
12. `apps/api/src/currency/currency.module.ts` — add the new controller.
13. Fix all 9 occurrences of `"pending in PR #2485"` (drop the clause, keep the rest of each comment).
14. Regression spec: `GET /analytics/sales` without `displayCurrency` — assert byte-identical response shape (extend the existing regression spec if one exists, else add one to `sales-analytics.controller.spec.ts` or the relevant int-spec).
15. Int-spec (if the existing currency-remediation/analytics int-spec suite has a natural home) or a new `apps/api/test/integration/currency/exchange-rates.int-spec.ts`: seed a real `exchange_rates` row via the repository, hit `GET /currency/rates`, assert 200 + shape; hit it for an absent key, assert 404.

## 5. Validation checklist

- [ ] No CORE ↔ Integration boundary violation — `apps/api` never imports `ExchangeRateRepositoryPort` directly (`pnpm check:invariants` / `check-cross-context-imports.mjs` is the mechanical proof).
- [ ] `AppliedRate.rate` stays `string` everywhere (DTO included) — never `Number()`'d.
- [ ] `resolveRateSource` is called with `to`, never `from` (matches every existing call site).
- [ ] Endpoint carries no `@Roles(...)`.
- [ ] `pnpm lint && pnpm type-check && pnpm test` clean; `pnpm test:integration` for the new int-spec.
- [ ] `git grep "pending in PR #2485"` returns nothing.

## 6. Open questions for the user (none blocking — noted for transparency)

- The issue's literal wording ("`appliedRate` is `null` exactly when `convertedTotal` is `null`") doesn't account for the same-currency identity branch, where `convertedTotal` is non-null but no rate was ever looked up. Plan above resolves this by widening the null-condition to "no lookup happened OR lookup failed" and documenting it explicitly in the JSDoc — flagging this interpretation choice now rather than silently deviating from the issue text.
