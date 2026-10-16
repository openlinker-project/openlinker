# Implementation Plan: Operator-defined payment-method map (#3774)

**Issue**: #3774 (frontend half: #3775)
**Branch**: `3774-payment-method-map`, based on `3294-order-payment-method` (PR #3756), which is
itself stacked on #3474 / PR #3754. Rebase onto `main` once both merge.

## 1. Understand

**Goal.** Let an operator say what their own payment gateways mean, so a PrestaShop or
WooCommerce order paid through PayU / Przelewy24 / a store plugin reads `online` (or
`bank_transfer` / `cash_on_delivery`) instead of `unknown`.

**Layer.** CORE (pure rule + optional sub-capability + order-record read) + Integration
(PrestaShop, WooCommerce order sources) + Interface (one read endpoint, save validation).

**Non-goals.**
- Frontend section (#3775).
- Re-classifying already-ingested orders when the map changes.
- Allegro, Erli, Shoper (no free-text gateway id; Allegro values are platform-defined).
- Overriding a platform-defined module/gateway (`ps_cashondelivery`, `ps_wirepayment`, `cod`, `bacs`).

## 2. Research findings

- PrestaShop: `derivePrestashopPaymentMethod(order)` reads `ps_orders.module`
  (`libs/integrations/prestashop/src/infrastructure/mappers/prestashop-payment-method.ts`);
  `withCashOnDeliveryPaymentStatus(stateStatus, method, status)` already takes the method as an
  argument, so a resolved method flows into the COD status and `toCodToCollect` unchanged.
- WooCommerce: `deriveWooCommercePaymentStatus(order)` calls `deriveWooCommercePaymentMethod`
  internally (`woocommerce-order-source.adapter.ts`). It must take the resolved method as an
  argument, or a gateway mapped to COD would get a method of `cash_on_delivery` but a status of `paid`.
- Both order-source adapters already hold their `Connection`, so `connection.config` is reachable
  with no new dependency.
- `IncomingOrder.sourcePaymentMethod` (#3474) is set only by Allegro. It reaches `Order`
  (`order-ingestion.service.ts:2108`) but is not written to the persisted `orderSnapshot`.
- Config-coercion precedent: `readStockSafetyBuffer` / `readPricingRule`
  (`libs/core/src/identifier-mapping/domain/types/`). Save validation precedent:
  `ConnectionService.validateStockAndPricingConfig`
  (`apps/api/src/integrations/application/services/connection.service.ts`), called from both
  `create` and `update`.
- Nested-route read precedent: `CatalogTrustController`
  (`@Controller('connections/:connectionId/catalog-trust')`, `@Roles('admin','operator','viewer')`).
- `SourceOptionsReader.listPaymentMethods()` exists, but PrestaShop / WooCommerce do not implement
  it on the source side, and it would list every installed module rather than the ones buyers use.
  Discovery from order history is chosen instead (gateways actually seen).
- Side effect checked: the PrestaShop destination's `resolvePaymentMethodLabel` (#3474) already
  handles a `sourcePaymentMethod` with no mapping row by falling back to the default label. Once
  PrestaShop / WooCommerce sources start reporting it, that lookup runs for their orders too, and
  is harmless when unmapped.

## 3. Design

### 3.1 Core - pure rule (`libs/core/src/orders/domain/types/payment-method-map.types.ts`)

Pure-rule exception in `engineering-standards.md` (pure, is the rule for the type, changes with it).

```ts
export const PAYMENT_METHOD_MAP_CONFIG_KEY = 'paymentMethodMap';
export function normalizeSourcePaymentMethodKey(raw: string): string; // trim + lowercase
export function readPaymentMethodMap(config): ReadonlyMap<string, PaymentMethod>;
  // non-object -> empty; keys normalised; blank keys and values failing isPaymentMethod dropped
export const PaymentMethodResolutionValues = ['platform', 'operator', 'none'] as const;
export function resolveSourcePaymentMethod(input: {
  platformMethod: PaymentMethod;          // the adapter's built-in answer
  sourcePaymentMethod: string | undefined;
  map: ReadonlyMap<string, PaymentMethod>;
}): { method: PaymentMethod; resolvedBy: PaymentMethodResolution };
```

Precedence: `platformMethod !== 'unknown'` -> `platform`; else a map hit that is not `unknown`
-> `operator`; else `unknown` / `none`. One function used by both adapters AND the discovery read,
so what the endpoint reports and what ingestion writes cannot drift (#2229 rule).

**Normalisation lives in the resolver, not at its callers.** `resolveSourcePaymentMethod` looks up
`normalizeSourcePaymentMethodKey(sourcePaymentMethod)`, so an adapter reporting `PayU` verbatim
hits a `payu` map entry. Adapters keep reporting the id verbatim (it is also the #3474
destination-mapping key and must stay as the source sent it); only the map lookup is case- and
whitespace-insensitive. A blank or absent id never hits the map.

### 3.2 Core - optional sub-capability (`domain/ports/capabilities/platform-payment-method-classifier.capability.ts`)

```ts
export interface PlatformPaymentMethodClassifier {
  classifyPlatformPaymentMethod(sourcePaymentMethod: string): PaymentMethod; // sync, pure
}
export function isPlatformPaymentMethodClassifier(adapter: OrderSourcePort): adapter is ...;
```

Guard-only: not in any manifest, not in `CoreCapabilityValues` (the `ModifiedProductLister`
precedent), narrowed off the dispatched `OrderSource` adapter by a method probe. It lets the
discovery read report which gateways the platform itself defines without core knowing any
module name. Justification for a new seam: without it the API can only guess "platform-defined"
from stored history, which is wrong after a map entry is cleared.

### 3.3 Adapters

- PrestaShop: `derivePrestashopPaymentMethod` gains a string-input sibling used by
  `classifyPlatformPaymentMethod`; `getOrder` reports `sourcePaymentMethod` (trimmed `module`,
  omitted when blank) and resolves the method through `resolveSourcePaymentMethod` with
  `readPaymentMethodMap(this.connection.config)`. The resolved method feeds
  `withCashOnDeliveryPaymentStatus`.
- WooCommerce: same, from `payment_method`; `deriveWooCommercePaymentStatus(order, method)` takes
  the resolved method (default: derived from the order, so existing callers keep working).

### 3.4 Snapshot

`OrderRecordService.persistOrder` and `persistIncomingSnapshot` keep `sourcePaymentMethod` in the
snapshot, present-only, in both PII modes (a technical gateway id, not buyer data).

### 3.5 Discovery read

- Repository: `OrderRecordRepositoryPort.listObservedSourcePaymentMethods(connectionId, since, limit)`
  -> `{ sourcePaymentMethod, orderCount, lastSeenAt }[]`, grouping on
  `lower(trim("orderSnapshot"->>'sourcePaymentMethod'))` for one `sourceConnectionId` since a
  window, ordered by count desc, capped (100). Uses `IDX` on `sourceConnectionId`.
- `IOrderRecordService.listObservedSourcePaymentMethods(...)` pass-through.
- API: `ConnectionPaymentMethodsService` (app layer, `apps/api/src/orders/application/`) composes
  that read + `IIntegrationsService.getCapabilityAdapter(connectionId, 'OrderSource')` (probe
  classifier; resolution failure degrades to `classifierAvailable: false`, never 500) +
  `readPaymentMethodMap(connection.config)` + `resolveSourcePaymentMethod`.
- Cost and degradation, stated: `getCapabilityAdapter` resolves credentials and constructs the
  adapter only to call a pure classifier. A disabled connection, one in `needs_reauth`, or one
  whose adapter does not implement the classifier still returns its observed ids, with
  `classifierAvailable: false` and `platformMethod: null`, so #3775 can tell "classification
  unavailable" apart from "no gateways seen". The orders read failing is a 5xx; the adapter
  failing never is.
- Controller: `GET /connections/:connectionId/payment-methods/observed`,
  `@Roles('admin','operator','viewer')`, window 90 days. Response:
  `{ classifierAvailable, windowDays, items: [{ sourcePaymentMethod, orderCount, lastSeenAt,
  platformMethod | null, operatorMethod | null, resolvedMethod, resolvedBy }] }`.

### 3.6 Save validation

`ConnectionService.validatePaymentMethodMapConfig(config)`, called from `create` and `update`
beside `validateStockAndPricingConfig`: absent / `null` passes; non-object, or any value failing
`isPaymentMethod`, or a blank key -> 400 naming the offending key.

**Keys that collide after normalisation are refused**: `{"PayU": "online", "payu": "bank_transfer"}`
-> 400 naming both keys. Otherwise `readPaymentMethodMap` would keep whichever key JSON iteration
order put last, so the operator's intent would depend on key order (the #2610 rule: refuse a
config that would silently degrade). Duplicates with the SAME value are refused too, for one rule
rather than two. The duplicate check calls `normalizeSourcePaymentMethodKey`, never a local copy.

**Accepted, not refused**: mapping a platform-defined id (e.g. `"ps_cashondelivery": "online"`)
saves and is then ignored, because the platform answer wins. Refusing it would need an adapter
probe inside `ConnectionService`. The discovery read makes it visible (`operatorMethod` set,
`resolvedBy: 'platform'`), and #3775 renders platform-defined ids read-only, so this is reachable
only through the raw JSON editor.

## 4. Steps

1. `payment-method-map.types.ts` + spec (coercer, normaliser, precedence matrix, a mixed-case /
   padded `sourcePaymentMethod` hitting a lowercase map key, a blank id never hitting the map).
   Export from `orders/index.ts` and `orders/types.ts` (the file lives under `domain/types/`, as
   `check-types-sub-barrels.mjs` requires; the capability guard is NOT exported from `types.ts`).
2. `platform-payment-method-classifier.capability.ts` + guard spec. Export.
3. PrestaShop: classifier + `sourcePaymentMethod` + resolved method; specs (mapped gateway ->
   operator method; mapped to COD -> status `cod` + amount + consistent; map cannot override
   `ps_cashondelivery`; unmapped -> `unknown`).
4. WooCommerce: same; `deriveWooCommercePaymentStatus(order, method)`; specs incl. mapped
   gateway to COD in `processing` -> `cod`.
5. `persistOrder` / `persistIncomingSnapshot` snapshot key + specs.
6. Repository read + port + service pass-through, plus the int-spec
   `apps/api/test/integration/orders/payment-methods-observed.int-spec.ts` (real Postgres): rows
   outside the window excluded; `PayU` / ` payu ` grouped into one id with the summed count;
   another connection's rows excluded; orders with no `sourcePaymentMethod` excluded; ordering by
   count and the cap.
7. API service + controller + DTOs + module wiring + specs.
8. `ConnectionService` validation + specs (create and update): non-object, invalid value, blank
   key, and case-folded duplicate keys (both differing and equal values) refused; absent / `null`
   accepted; a platform-defined id accepted.
9. `docs/architecture-overview.md` § Orders: one bullet.

## 5. Validate

- No platform name in core; module/gateway knowledge stays in each adapter via the classifier.
- Cross-context: API reads orders through `IOrderRecordService`, never the repository port.
- No migration (JSONB config, snapshot key).
- Tests: unit specs per step. The discovery query is raw SQL over JSONB, which a query-builder
  mock cannot prove, so it gets a Testcontainers int-spec (step 6), per `testing-guide.md`.
- Security: endpoint read-only, connection-scoped, returns no buyer data.

## Risks / open questions

1. **Stacked base.** Two unmerged PRs underneath; rebase needed after merge.
2. **New guard-only sub-capability** (`PlatformPaymentMethodClassifier`) - a new seam; the
   alternative (infer "platform-defined" from stored order history) reports wrongly after a map
   entry is cleared.
3. **Window** of 90 days for discovery is a chosen default.
4. **Follow-up, not in scope**: PrestaShop and WooCommerce do not implement
   `SourceOptionsReader.listPaymentMethods()` on the source side, so the #3474 Payments tab still
   offers no source options for them, even though their orders now carry a matchable key.

## Review log

Plan tech-review (2026-10-16), folded in: resolver-side normalisation of the lookup key (§3.1);
refusal of case-folded duplicate map keys (§3.6); committed int-spec for the JSONB discovery
query (step 6, §5). Also recorded: the accepted no-op for a mapped platform-defined id (§3.6),
the discovery read's adapter cost and degradation (§3.5), and the Payments-tab follow-up (risk 4).
Still to run: `/pre-implement`.
