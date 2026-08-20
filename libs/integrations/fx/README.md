# @openlinker/integrations-fx

Reference exchange-rate provider adapters for OpenLinker.

Implements `ExchangeRateProviderPort` (declared in `@openlinker/core/currency`)
against the two public reference sources OpenLinker reads today:

| Adapter | Source | Base | Notes |
|---|---|---|---|
| `NbpExchangeRateAdapter` | Narodowy Bank Polski, table A | `PLN` (quotes `X -> PLN`) | Owns the Polish working-day calendar; 404 walk-back as defence in depth |
| `EcbExchangeRateAdapter` | European Central Bank daily reference rates (SDMX) | `EUR` (quotes `EUR -> X`) | No walk-back - `endPeriod` + `lastNObservations=1` resolves it server-side |

`FakeExchangeRateAdapter` is the deterministic offline stand-in used by the
integration suite; it is not registered by the module.

## This is not a plugin

There is no adapter manifest, no `adapterRegistry.register`, and no
`createCapabilityAdapter`. A published reference rate is a shared read of a
public source, not a per-connection capability, so there is no
`getCapabilityAdapter` path. `FxIntegrationModule` appears in `apiPlugins` /
`workerPlugins` purely as a module-composition seam - the same role
`AiIntegrationModule` plays.

## Direction is an invariant

`ExchangeRate.rate` is the number of `to` units per one `from` unit, so a
consumer always **multiplies**. An inverted or pivoted rate records its
`derivation` (`kind` plus each leg's `pair` / `ref` / `effectiveDate`), so a
figure that appears in no published table stays auditable.

## Why the adapters own their calendars

`resolveRateDate` (core) is deliberately calendar-neutral: it yields a candidate
*calendar* day. Each adapter resolves that candidate onto a day its own source
actually published on. A shared Polish calendar would silently stale every ECB
rate on a Polish-only holiday - ECB publishes on Corpus Christi and Epiphany,
Poland does not.

## HTTP

Both adapters take an injected `FetchLike` (`@openlinker/shared/http`). The
single global-transport reference in the package is the `FX_FETCH_TOKEN` default
factory in `fx-integration.module.ts`, carrying a scoped
`eslint-disable-next-line no-restricted-globals` with its reason inline.
ADR-038's connection-bound transport is structurally unusable here - it keys its
cache and rate-limit bucket on `connection.id`, and a reference-rate read has no
connection.

No adapter ever makes a live HTTP call in any test tier.

## Related

- ADR-040 - Order-time FX stamping against a system reporting currency
- `@openlinker/core/currency` - the port, the registry, the rules, the settings
