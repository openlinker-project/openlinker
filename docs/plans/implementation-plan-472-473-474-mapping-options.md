# Implementation Plan — #472 + #473 + #474: MappingOptions capability-scoped refactor + live data + Allegro method labels

**Branch:** `472-473-474-mapping-options-controller`
**Scope:** One PR resolving the three-issue cluster. #472 is the load-bearing architectural refactor; #473 is its symptom (closes as a side-effect); #474 Phase 1 ships in the same PR (Phase 2 is explicitly deferred per the issue).

---

## 1. Goal

Replace the eight platform-prefixed routes on `MappingOptionsController` (six of which serve hardcoded stub data) with six capability-scoped routes backed by two new sub-capabilities (`DestinationOptionsReader`, `SourceOptionsReader`). Live PrestaShop carriers/statuses/modules and live Allegro delivery methods (with human labels) flow through to the carrier-mapping UI; operators stop persisting wrong mapping rows tied to the stub `value=1`/`value=2` carriers.

## 2. Layer classification

- **CORE** — two new capability sub-ports + co-located guards, one new shared type (`MappingOption`)
- **Integration (PrestaShop)** — `PrestashopOrderProcessorManagerAdapter` implements `DestinationOptionsReader` (live `/carriers`, `/order_states`, `/modules` GETs)
- **Integration (Allegro)** — `AllegroOrderSourceAdapter` implements `SourceOptionsReader` (live delivery-methods + a static order-status enum + best-effort payment providers)
- **Interface (BE)** — `MappingOptionsController` rewrite: 6 capability-scoped routes + 2 categories-scoped routes + 8 deprecated 308 redirects from the legacy paths
- **Frontend** — `mappings.api.ts` and `use-mapping-options.ts` migrate to the new paths; no UI logic change

## 3. Non-goals

- **#474 Phase 2** (carrier-family / pattern-matching schema migration). Explicitly deferred per the issue body until Phase 1 ships and we have signal that the operator workload is still too high.
- **Caching** of the new endpoints. Initial implementation is uncached; revisit only if PS WS round-trip times become a UX problem.
- **OpenAPI codegen migration** — FE keeps hand-written contract types for these endpoints, matching the existing `mappings.api.ts` style.
- **Saved-mapping data migration** — operators have not yet relied on stub-data mappings in production (per #473 §Assumptions). If field reports show otherwise we'll handle in a separate fix.
- **Backwards-compatible response shape changes** — `{value, label}` stays as-is. Allegro delivery-method labels go from "raw UUID" to "method name" but the field name doesn't change.

## 4. Background — what already exists

- **`MappingOptionsController`** (`apps/api/src/mappings/http/mapping-options.controller.ts`):
  - 9 routes total: 2 live (categories, via `categoriesCacheService`), 6 stubs (`PRESTASHOP_CARRIERS`, `PRESTASHOP_ORDER_STATUSES`, `PRESTASHOP_PAYMENT_MODULES`, `ALLEGRO_ORDER_STATUSES`, `ALLEGRO_DELIVERY_METHODS`, `ALLEGRO_PAYMENT_PROVIDERS`)
  - Class-level `@Roles('admin')` + `@ApiBearerAuth()`. Full Swagger coverage on every route.
  - The 6 stub handlers explicitly ignore `connectionId` (`@Param('connectionId') _connectionId: string`) — `// TODO: use connectionId to fetch live values once adapters expose option lists`.
- **`MappingOptionResponseDto`** is `{value: string, label: string}`. No richer shape needed.
- **FE consumer** (`apps/web/src/features/mappings/`):
  - `mappings.api.ts` — six functions, one per option list.
  - `use-mapping-options.ts` — `useQueries()` running 6 parallel queries, keyed under `mappingsQueryKeys.options(connectionId)`.
  - Components: `connection-mappings-page.tsx` and `MappingPanel.tsx` (the carrier tab consumes `sourceOptions` / `targetOptions` as props).
- **`IntegrationsService.getCapabilityAdapter<T>(connectionId, capability)`** — typed generic; throws `CapabilityNotSupportedException` when the connection's adapter doesn't implement the asked-for capability. Perfect for the new routes.
- **`PrestashopOrderProcessorManagerAdapter`** injects `IPrestashopWebserviceClient.listResources<T>(resource, filters?, limit?, offset?)` — the established list-fetch pattern. Today's adapter touches `order_carriers` (per-order rows) but never the base `/carriers` list — we'll write the first.
- **`AllegroOrderSourceAdapter`** has only three constructor deps today (`connectionId`, `httpClient`, `_connection: Connection`). Adding `SourceOptionsReader` is non-disruptive; the per-connection factory at `libs/integrations/allegro/src/application/allegro-adapter.factory.ts` already has access to whatever extra deps we need.
- **Sub-capability pattern reference** — `libs/core/src/listings/domain/ports/capabilities/offer-status-reader.capability.ts` (and its 8 siblings) is the canonical shape: `interface FooReader { … }` + co-located `isFooReader(adapter): adapter is BasePort & FooReader`.

## 5. Design

### 5.1 New CORE types + capabilities

```typescript
// libs/core/src/orders/domain/types/mapping-option.types.ts
export interface MappingOption {
  /** Stable identifier persisted by mapping config (PS id_reference, Allegro methodId). */
  value: string;
  /** Human-readable label for FE dropdowns. */
  label: string;
}
```

```typescript
// libs/core/src/orders/domain/ports/capabilities/destination-options-reader.capability.ts
import type { OrderProcessorManagerPort } from '../order-processor-manager.port';
import type { MappingOption } from '../../types/mapping-option.types';

export interface DestinationOptionsReader {
  listCarriers(): Promise<MappingOption[]>;
  listOrderStatuses(): Promise<MappingOption[]>;
  listPaymentMethods(): Promise<MappingOption[]>;
}

export function isDestinationOptionsReader(
  adapter: OrderProcessorManagerPort,
): adapter is OrderProcessorManagerPort & DestinationOptionsReader {
  const partial = adapter as Partial<DestinationOptionsReader>;
  return (
    typeof partial.listCarriers === 'function' &&
    typeof partial.listOrderStatuses === 'function' &&
    typeof partial.listPaymentMethods === 'function'
  );
}
```

```typescript
// libs/core/src/orders/domain/ports/capabilities/source-options-reader.capability.ts
import type { OrderSourcePort } from '../order-source.port';
import type { MappingOption } from '../../types/mapping-option.types';

export interface SourceOptionsReader {
  listOrderStatuses(): Promise<MappingOption[]>;
  listDeliveryMethods(): Promise<MappingOption[]>;
  listPaymentMethods(): Promise<MappingOption[]>;
}

export function isSourceOptionsReader(
  adapter: OrderSourcePort,
): adapter is OrderSourcePort & SourceOptionsReader {
  const partial = adapter as Partial<SourceOptionsReader>;
  return (
    typeof partial.listOrderStatuses === 'function' &&
    typeof partial.listDeliveryMethods === 'function' &&
    typeof partial.listPaymentMethods === 'function'
  );
}
```

Both files mirror the `offer-status-reader.capability.ts` shape exactly (interface + co-located narrowing guard, no separate `*.types.ts` export).

### 5.2 Adapter implementations

**PrestaShop (`PrestashopOrderProcessorManagerAdapter`)** — adds three methods, all backed by `httpClient.listResources<T>`:

| Method | Endpoint | Filter | Map to MappingOption |
|---|---|---|---|
| `listCarriers()` | `GET /carriers` | `display=full`, `filter[deleted]=0`, `filter[active]=1` | `{ value: id_reference, label: name }` |
| `listOrderStatuses()` | `GET /order_states` | `display=full`, `filter[deleted]=0` | `{ value: id, label: name }` (PS order_state has translation arrays — pick the language matching `connection.config.language` if set, else default to `id_lang=1` / first entry) |
| `listPaymentMethods()` | `GET /modules` | `display=full`, `filter[active]=1`. **Filter mechanism: TBD in step 3 of §7** — PS WS exposes `module.tab` ("payments_gateways") and `module.is_payment_module` (PS 1.7+ only) on `/modules`; verify against the connected dev PS install which is reliable and use it for the second-pass filter. If neither is reliable on the target PS version, fall back to a permissive return (every active module) and let the FE filter — but document the gap. **Avoid string-prefix matching on `name`** — third-party modules (`payu`, `przelewy24`, `stripe`, `dotpay` per the existing stub data) don't follow `ps_*payment` and would be silently dropped. | `{ value: name, label: displayName ?? name }` |

New PS response types in `libs/integrations/prestashop/src/domain/types/prestashop-options.types.ts` (file is new): `PrestashopCarrier`, `PrestashopOrderState`, `PrestashopModule`. Each carries the fields needed for the mapping; nothing more.

**Allegro (`AllegroOrderSourceAdapter`)** — adds three methods. Each is independently sourced:

| Method | Source | Notes |
|---|---|---|
| `listDeliveryMethods()` | **`GET /sale/shipping-rates` + per-id details** (verified — no `/sale/delivery-methods` exists per `allegro-api.types.ts:635`). Step 1: list the seller's rate-tables via `/sale/shipping-rates` (already fetched by `fetchSellerPolicies`). Step 2: for each rate-table, `GET /sale/shipping-rates/{id}` returns `{ rates: [{ method: { id, name }, … }] }`. Step 3: flatten + dedup by `method.id`. N+1 but bounded (sellers have <20 rate-tables typically); operator-driven endpoint so latency is acceptable. **Caching deferred** to a follow-up — first land the live data, then optimise. | Returns `{ value: methodId, label: methodName }` per distinct method. |
| `listOrderStatuses()` | Static `as const` enum in `libs/integrations/allegro/src/domain/types/allegro-order-status.types.ts` (new). | See **Static-enum design call-out** below. |
| `listPaymentMethods()` | Static `as const` enum (same file). | See **Static-enum design call-out** below. |

**Static-enum design call-out (post-review).** Two of three `SourceOptionsReader` methods return compile-time constants rather than live API data. **This is a deliberate trade-off, not an oversight** — Allegro does not expose `/sale/order-statuses` or `/sale/payment-methods` endpoints. The values are documented in `developer.allegro.pl/checkout-forms` and `developer.allegro.pl/payments`. Drift mitigation:
1. **Doc-link comment** at the top of each enum file pointing to the canonical Allegro docs page (with a date stamp of when the values were captured).
2. **Drift detection** — if a future order arrives with a `payment.type` not in our enum, the existing `mapAllegroEventType` warn-log path captures it; operators see "unknown payment type X" in logs and can request a backfill.
3. **Capability-guard honesty** — the adapter still genuinely implements `SourceOptionsReader`, but consumers should understand "implements" means "returns data from documented sources" rather than "always live". The guard is a runtime narrowing primitive, not a freshness contract.
4. **Follow-up trigger** — if Allegro ever ships live endpoints for these enums, swap the implementation; the capability shape doesn't change.

A live `/sale/delivery-methods` fetch for `listDeliveryMethods()` is the only method that genuinely benefits from a live API — it's also the one operators care most about (#474's primary win).

The constructor needs no new injection — the existing `httpClient` covers the live call; the static enums need no deps.

### 5.3 New controller routes

```
# Capability-scoped (replaces 6 stubbed routes)
GET /connections/:connectionId/mappings/options/destination/carriers
GET /connections/:connectionId/mappings/options/destination/order-statuses
GET /connections/:connectionId/mappings/options/destination/payment-methods
GET /connections/:connectionId/mappings/options/source/order-statuses
GET /connections/:connectionId/mappings/options/source/delivery-methods
GET /connections/:connectionId/mappings/options/source/payment-methods

# Categories — migrated to the same shape (still backed by categoriesCacheService)
GET /connections/:connectionId/mappings/options/destination/categories
GET /connections/:connectionId/mappings/options/source/categories
```

Each capability handler:

```typescript
@Get('mappings/options/destination/carriers')
async getDestinationCarriers(@Param('connectionId') connectionId: string): Promise<MappingOptionResponseDto[]> {
  const adapter = await this.integrationsService.getCapabilityAdapter<OrderProcessorManagerPort>(
    connectionId,
    'OrderProcessorManager',
  );
  if (!isDestinationOptionsReader(adapter)) {
    throw new NotImplementedException(
      `Adapter for connection ${connectionId} does not implement DestinationOptionsReader`,
    );
  }
  return adapter.listCarriers();
}
```

`NotImplementedException` (501) is the right HTTP status — the operator did everything right; the platform just doesn't support listing yet. FE renders an empty dropdown with a clear empty-state message rather than crashing.

### 5.4 Legacy routes — drop entirely (post-review)

The plan originally proposed 308 redirects from the eight legacy paths to the new ones. **Reverted to drop-and-replace** because:

1. §4 research confirmed there are **no external consumers** of the legacy paths — only `mappings.api.ts` in `apps/web`, and we update that in the same PR.
2. There is no documented OpenAPI consumer outside this repo (per the grep).
3. The 308 redirects would be dead code from day one with no clear removal cadence.

Cleaner alternative shipped here: this PR removes the eight legacy routes outright and updates the FE in the same diff. If a downstream consumer surfaces during review (very unlikely given the grep), the 308-redirect stanza can be added back as a one-commit follow-up — but committing to the redirects up front is over-engineering for a contract no one else relies on.

### 5.5 Controller helper (post-review)

Each new handler would otherwise repeat the same 4-line block (`getCapabilityAdapter` → `if (!isFooReader) throw 501` → `return adapter.foo()`). Six handlers × ~5 lines = 30 lines of structural noise. Extracted to a private helper on the controller:

```typescript
private async resolveDestinationOptions<K extends keyof DestinationOptionsReader>(
  connectionId: string,
  method: K,
): Promise<MappingOptionResponseDto[]> {
  const adapter = await this.integrationsService.getCapabilityAdapter<OrderProcessorManagerPort>(
    connectionId,
    'OrderProcessorManager',
  );
  if (!isDestinationOptionsReader(adapter)) {
    throw new NotImplementedException(
      `Adapter for connection ${connectionId} does not implement DestinationOptionsReader`,
    );
  }
  return adapter[method]();
}
```

Each handler then becomes a one-liner: `return this.resolveDestinationOptions(connectionId, 'listCarriers');`. Same shape for `resolveSourceOptions`. Cuts repetition without leaking infrastructure into CORE.

## 6. Files

### CORE — `libs/core/src/orders/`

| File | Action | Notes |
|---|---|---|
| `domain/types/mapping-option.types.ts` | **new** | `MappingOption { value, label }` — shared between both new capabilities. |
| `domain/ports/capabilities/destination-options-reader.capability.ts` | **new** | Interface + `isDestinationOptionsReader` guard. |
| `domain/ports/capabilities/source-options-reader.capability.ts` | **new** | Interface + `isSourceOptionsReader` guard. |
| `domain/ports/capabilities/__tests__/destination-options-reader.capability.spec.ts` | **new** | Guard test: positive case (adapter has all three methods), negative case (missing one). |
| `domain/ports/capabilities/__tests__/source-options-reader.capability.spec.ts` | **new** | Same shape. |
| `index.ts` | edit | Export `MappingOption`, both capabilities, both guards. Slot in alongside the existing port exports (lines 1-12). |

### Integration — PrestaShop

| File | Action | Notes |
|---|---|---|
| `libs/integrations/prestashop/src/domain/types/prestashop-options.types.ts` | **new** | `PrestashopCarrier`, `PrestashopOrderState`, `PrestashopModule` response types. |
| `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` | edit | (a) Class declaration: add `, DestinationOptionsReader` after `OrderProcessorManagerPort`. (b) Three new methods using `httpClient.listResources`. (c) Defensive empty-list fallbacks if PS returns no rows (vs erroring). |
| `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-processor-manager.adapter.spec.ts` | edit | Add three describe blocks covering happy path + filter syntax (`filter[deleted]=0` etc.) + empty-list fallback. |

### Integration — Allegro

| File | Action | Notes |
|---|---|---|
| `libs/integrations/allegro/src/domain/types/allegro-order-status.types.ts` | **new** | `AllegroOrderStatusValues` (`as const`) + label map. Doc-link comment to Allegro checkout-form docs. |
| `libs/integrations/allegro/src/domain/types/allegro-payment-type.types.ts` | **new** | Same shape, sourced from `checkoutForm.payment.type` enum. |
| `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` | edit | Add `AllegroDeliveryMethodsResponse` interface (response shape for `GET /sale/delivery-methods`). |
| `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts` | edit | (a) `, SourceOptionsReader` on the implements clause. (b) `listDeliveryMethods()` — `GET /sale/delivery-methods`, dedupe by `id`. (c) `listOrderStatuses()` and `listPaymentMethods()` return the static enum mapped through a localisation helper (currently English; placeholder for #449's i18n pass). |
| `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-order-source.adapter.spec.ts` | edit | Tests for all three methods + dedup correctness + the order-status/payment-method static lists. |

### Interface — API

| File | Action | Notes |
|---|---|---|
| `apps/api/src/mappings/http/mapping-options.controller.ts` | **rewrite** | Six new capability-scoped handlers (each a one-liner via the `resolveDestinationOptions`/`resolveSourceOptions` helpers from §5.5) + two new categories handlers. **All eight legacy routes removed** (no 308 redirects — see §5.4). All seven hardcoded constants deleted. |
| `apps/api/src/mappings/http/dto/mapping-option-response.dto.ts` | unchanged | Already `{ value, label }` — no contract change. |
| `apps/api/src/mappings/http/__tests__/mapping-options.controller.spec.ts` | edit (or rewrite) | Unit tests: each new route resolves the right capability, narrows via the right guard, returns the live list, throws 501 when adapter doesn't implement. Plus 308 tests for each deprecated route. |
| `apps/api/test/integration/mapping-options.int-spec.ts` | **new** | One round-trip integration test: `GET /connections/:connectionId/mappings/options/destination/carriers` with a stubbed PS adapter; asserts the FE-shape response. Per the testing-guide: integration tests live in `apps/api/test/integration/` and use `getTestHarness()`. |

### Frontend — `apps/web/src/features/mappings/`

| File | Action | Notes |
|---|---|---|
| `api/mappings.api.ts` | edit | **Collapsed (post-review):** the six near-identical functions become one parameterised `getMappingOptions(connectionId, side: 'source'\|'destination', kind: 'carriers'\|'order-statuses'\|'payment-methods'\|'delivery-methods')`. Categories stay separate (richer DTO). Cuts ~60 lines of repetition. |
| `api/mappings.query-keys.ts` | edit | Single `mappingsQueryKeys.option(connectionId, side, kind)` keyed under `['mappings', connectionId, 'options', side, kind]`. Allows side-level invalidation. |
| `hooks/use-mapping-options.ts` | edit | The 6 parallel queries call the parameterised function. Public hook signature unchanged — `MappingPanel` doesn't notice. |
| `components/MappingPanel.tsx` | unchanged | Consumes via the hook, doesn't care about URLs. |
| `pages/connection-mappings-page.tsx` | unchanged | Same. |

## 7. Step-by-step implementation order

1. **Prep — verify Allegro `/sale/delivery-methods` exists.** Quick `curl` against the connected Allegro sandbox (or check the dev tooling fixtures committed under `libs/integrations/allegro/test/fixtures/`). If the endpoint exists, design (5.2) holds. If it doesn't, fall back to fetching `/sale/shipping-rates` and flattening per-rate-set — adds N+1 semantics but doesn't change the capability shape.
2. **CORE — `MappingOption` type + two capabilities + guards** (pure declarations, no adapter changes yet). Export from `libs/core/src/orders/index.ts`.
3. **CORE — guard tests** for both capabilities. Will go red because no adapter implements them yet — that's expected, verifies the guard correctly returns `false`.
4. **PrestaShop adapter — implement `DestinationOptionsReader`.** Add the three new types in `prestashop-options.types.ts`, the three new methods, the implements clause. Adapter tests turn green.
5. **Allegro adapter — implement `SourceOptionsReader`.** Static enums first (cheap, deterministic), then `listDeliveryMethods()` last (the live fetch). Adapter tests turn green.
6. **API controller — rewrite.** Drop the seven hardcoded constants (`PRESTASHOP_CARRIERS` etc.), wire the six new capability-scoped routes, the two new categories routes. Add the eight 308 redirects. Update the controller spec. Run `pnpm test` for `apps/api`.
7. **API integration test** — one happy-path round-trip with a stubbed adapter at the `IntegrationsService` boundary. Verifies the controller-to-adapter path through DI.
8. **FE — repoint API + query keys + hook.** Verify carrier-mapping UI in dev: live PS carriers appear with correct names, Allegro delivery methods show as "Allegro Paczkomaty InPost (uuid)" rather than bare UUID. Manual smoke test, screenshot before/after to attach to the PR.
9. **FE — Vitest coverage** on the source-options dropdown render + on the `useMappingOptions` query hook (per #474 acceptance criteria).
10. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`. Pre-commit hook runs the full battery again.

## 8. Testing strategy

- **CORE guards** (4 tests total — 2 per capability): adapter implements all three methods → guard returns true; adapter missing one method → guard returns false. Validates the guard is strict, not just nominal-typed.
- **PS adapter** — three describe blocks, one per method. Each verifies (a) the right resource + filter shape is requested, (b) the response is mapped to `{value, label}` with the right field choices, (c) empty-list behaviour, (d) error propagation when PS returns 5xx.
- **Allegro adapter** — three describe blocks. `listDeliveryMethods` covers dedup + label preservation; the two static-enum methods are simple but should still assert the full enum is returned + labels match.
- **API controller** — for each of the six new routes: happy path (adapter resolved + capability narrowed + list returned), 501 path (`isFooReader` returns false), 404 path (connection doesn't exist; comes free from `getCapabilityAdapter` throwing). Plus eight 308 redirect tests.
- **API integration** — one round-trip via `getTestHarness()` with a stubbed `OrderProcessorManagerPort` registered for the test connection. Confirms the controller wiring threads through DI correctly.
- **FE** — Vitest tests on `use-mapping-options.ts` (returns parsed lists; merges loading/error states correctly) and on the carrier dropdown render (shows label + faded UUID).

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `/sale/delivery-methods` doesn't exist or returns a different shape than expected | Step 1 of §7 verifies before writing the adapter code. Fallback path (per-rate-set fetch) is documented; same capability shape, more roundtrips. |
| PS WS `filter[active]=1` not honored on `/modules` (PS WS quirks) | Adapter does a defensive client-side filter on the response. Test asserts that an inactive module in the response is dropped. |
| FE migration deploys before API merge → 404s from old paths | API ships first with both old (308) and new routes. FE migration is a follow-up commit on the same PR. The 308 redirect makes order-of-deployment irrelevant in the worst case (old URLs keep working). |
| Saved mappings exist with stub `value=1` / `value=2` | Per #473 §Assumptions, no production reliance. Once live data lands, an operator opening the carrier-mapping UI sees the row's saved-value highlighted as "no longer in the list" (or matches by coincidence). The FE should render a clear "previously saved as: X (no longer available)" affordance — covered by the existing empty-state polish, not net-new work for this PR. Add a brief release-note. |
| Allegro static order-status / payment-method enums drift from reality | Doc-link comments in the type files, plus a code-search note in `docs/architecture-overview.md` §Listings → Allegro section so the next person who touches these knows where they came from. Genuinely live endpoints would be better but Allegro doesn't expose them. |
| `NotImplementedException` (501) mishandled by the FE | The FE already handles network errors; 501 will be surfaced as an error state on the affected dropdown. Worth a one-line UX improvement: special-case 501 with "Not supported by this platform" rather than the generic error message — covered in step 8. |
| Categories endpoints break during migration | They keep their existing `categoriesCacheService` backing — the migration is just URL renaming + 308 from the legacy paths. Tests on the new paths plus 308 tests on the old paths. |

## 10. Validation checklist

- [ ] CORE has no NestJS / TypeORM imports outside infrastructure
- [ ] All ports / adapters use Symbol tokens (no string DI) — but no new tokens needed here since `IntegrationsService` does the resolution
- [ ] No `any` types; no `console.log`; no hardcoded secrets
- [ ] Files match naming conventions (`*.capability.ts`, `*.types.ts`, `*.adapter.ts`, `*-response.dto.ts`)
- [ ] Dependency direction: capabilities in CORE, adapter implementations in `libs/integrations/`, controller imports both via aliases
- [ ] Tests added at every non-trivial branch (guards × 2, PS adapter × 3 methods, Allegro adapter × 3 methods, controller × 6 routes × 3 paths, integration × 1, FE × 2)
- [ ] No DB migration needed (no schema change — Phase 2 of #474 is deferred)
- [ ] Quality gate green: `pnpm lint && pnpm type-check && pnpm test`

## 11. Locked decisions (post-review)

1. **PS connection language** — the new `listOrderStatuses()` and `listCarriers()` map PS multi-language fields to a single `label`. **Decision: hardcode `id_lang=1` for v1.** File a follow-up if the operator asks for a language picker.
2. **FE API function shape** — replaced six near-identical functions with one parameterised `getMappingOptions(connectionId, side, kind)`. ~60 lines saved on the FE; cleaner cache-key structure.
3. **Categories migration** — keeps the richer existing `AllegroCategoryResponseDto`; only the URL changes (`/connections/:id/allegro/categories` → `/connections/:id/mappings/options/source/categories`).
4. **Legacy route lifecycle** — drop entirely (no 308 redirects). §4 grep confirmed no external consumers; the FE migrates in the same PR.
5. **PS `/modules` filter mechanism** — verify `module.tab === 'payments_gateways'` and/or `module.is_payment_module` against the dev PS install in step 3 of §7. Avoid string-prefix matching on `name`.
6. **Allegro static enums** — explicitly documented trade-off; see the design call-out in §5.2. Memory-worthy for future implementers.
