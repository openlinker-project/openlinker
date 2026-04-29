# Implementation Plan — #430 + #431: Allegro seller defaults + smart-link to product cards

Closes #430 (P0 — connection-level seller defaults: `location` + GPSR fallback for inline product creation) and #431 (P0 — smart-link offers to existing Allegro product cards by EAN). Tracked under epic #429. Sandbox-blocking 422 from 2026-04-28: `INVALID_STATE` on `location.state`, `RESPONSIBLE_PRODUCER_NOT_SPECIFIED`, `SAFETY_INFO_NOT_DEFINED`.

## 1. Goal

Make Allegro `POST /sale/product-offers` succeed end-to-end on the PL marketplace by:

1. **#430 — Connection-level seller defaults.** Persist `location.{countryCode, province, city, postCode}`, `responsibleProducerId`, and `safetyInformation` on `Connection.config.allegro.sellerDefaults`. Read at offer-build time and write into the request body. Inline-product path (today's only path) sets all three; future smart-linked path inherits GPSR from the card.
2. **#431 — Smart-link by EAN.** Before constructing inline-product `productSet`, resolve the variant's EAN against Allegro's product catalogue (`GET /sale/products?phrase={ean}&category.id={categoryId}`). On unique match, build `productSet = [{ product: { id }, quantity }]` instead of inline — Allegro inherits GPSR + parameters from the card.

Both ship in one PR because they share the `productSet[0]` codepath in `buildCreateOfferRequest` / `applyPlatformParams` and the GPSR write needs the smart-link guard to know whether to skip itself.

## 2. Layer classification

| Layer | Change |
|---|---|
| **CORE** | New sub-capability `responsible-producer-reader.capability.ts` + `isResponsibleProducerReader` guard at `libs/core/src/listings/domain/ports/capabilities/`. Mirrors the `SellerPoliciesReader` pattern. Carries the neutral `ResponsibleProducerEntry` type. |
| **Integration (Allegro)** | (a) `AllegroOfferManagerAdapter` writes `location` + GPSR fields, implements `ResponsibleProducerReader`, gains a smart-link pre-step in `createOffer`. (b) New `AllegroProductCardResolver` util alongside `upload-images-via-allegro.ts`. (c) `AllegroAdapterFactory` reads `connection.config.allegro.sellerDefaults` and forwards as adapter constructor option. **No new domain exception** — missing seller defaults surface as `OfferCreateRejectedException` with code `SELLER_DEFAULTS_NOT_CONFIGURED` thrown directly by the adapter (avoids reverse `core → integration` dependency). |
| **Interface (API)** | (a) Extend `AllegroConnectionConfigDto` with optional `sellerDefaults` shape, class-validator-validated (province enum, postcode regex, type-discriminated safetyInformation). (b) New `AllegroConnectionsController` exposes `GET /api/integrations/allegro/connections/:id/responsible-producers`. **Registered in the existing `IntegrationsModule`** at `apps/api/src/integrations/integrations.module.ts` — no new module. |
| **Frontend** | Extend `EditConnectionForm.tsx` with an Allegro seller-defaults section (only when `platformType === 'allegro'`): location fields, RP dropdown (TanStack Query against the new endpoint), safetyInformation radio + conditional textarea. Zod schema extension. |
| **DX** | None. |
| **Migrations** | None — `Connection.config` is JSONB. |

## 3. Non-goals

- **No per-offer wizard override.** Seller defaults are connection-level. Per-offer overrides ship customer-driven (deferred under #429).
- **No Responsible Producer registry CRUD from inside OL.** Operator creates entries in their Allegro account; we read-only fetch the registry for the dropdown.
- **No `safetyInformation` pictograms** — text-only initially per #430 OOS.
- **No card-blocked marker** for smart-link parameter-mismatch failures. Issue #431 calls for it; we defer it as gold-plating. When the card-link path 422s on parameter-mismatch, the operator sees the error in the Job-detail view and retries; if the same EAN repeatedly fails, we'll add the marker. Tracked as a future enhancement on #431's followup line.
- **No multi-EAN smart-link.** Resolve by `variant.ean ?? variant.gtin` — one value per variant. Cross-category card matching out-of-scope; always scope by `categoryId`.
- **No backfill** for existing Allegro connections without `sellerDefaults`. First offer attempt fails fast with `AllegroSellerDefaultsNotConfiguredException`; operator configures and retries.
- **No automatic `body.stock` ↔ `productSet[0].quantity` reconciliation.** Allegro docs are ambiguous on coexistence; we'll set `productSet[0].quantity` on smart-linked offers and leave `body.stock` as-is, then trim post-sandbox if Allegro rejects.

## 4. Design

### 4.1 `Connection.config.allegro.sellerDefaults` shape

```ts
interface AllegroSellerDefaultsConfig {
  location: {
    countryCode: 'PL';                  // future: extend to other markets
    province: PolishVoivodeship;         // 16-value enum
    city: string;                        // 1-200 chars
    postCode: string;                    // /^\d{2}-\d{3}$/
  };
  responsibleProducerId: string;         // from /sale/responsible-producers
  safetyInformation:
    | { type: 'NO_SAFETY_INFORMATION' }
    | { type: 'SAFETY_INFORMATION'; content: string };  // 1-2000 chars
}
```

The `PolishVoivodeship` enum lives at `libs/integrations/allegro/src/domain/types/allegro-location.types.ts` as an `as const` string array (engineering-standards.md "Union Types: `as const` Pattern"). Values: `DOLNOSLASKIE`, `KUJAWSKO_POMORSKIE`, `LUBELSKIE`, `LUBUSKIE`, `LODZKIE`, `MALOPOLSKIE`, `MAZOWIECKIE`, `OPOLSKIE`, `PODKARPACKIE`, `PODLASKIE`, `POMORSKIE`, `SLASKIE`, `SWIETOKRZYSKIE`, `WARMINSKO_MAZURSKIE`, `WIELKOPOLSKIE`, `ZACHODNIOPOMORSKIE` (Allegro's own enum — verified against `POST /sale/product-offers` 422 message).

### 4.2 Adapter wiring (`AllegroOfferManagerAdapter`)

Constructor gains optional `sellerDefaults?: AllegroSellerDefaultsConfig`. `AllegroAdapterFactory.createAdapters()` extracts it from `connection.config.allegro.sellerDefaults` (typed via the existing `AllegroConnectionConfig` type) and passes it through.

`buildCreateOfferRequest` gains a precondition guard that throws the **existing** `OfferCreateRejectedException` directly — no new exception class, no CORE-side mapping (avoids the reverse `core → integration` dependency that a custom Allegro exception would introduce):

```ts
if (!this.sellerDefaults) {
  throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
    {
      field: 'sellerDefaults.location',
      code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
      message: `Allegro connection ${this.connectionId} has no seller defaults configured. Set location, responsibleProducerId, and safetyInformation on the connection edit page before creating offers.`,
    },
    {
      field: 'sellerDefaults.responsibleProducerId',
      code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
      message: 'Configure a Responsible Producer in Allegro and select it on the connection edit page.',
    },
    {
      field: 'sellerDefaults.safetyInformation',
      code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
      message: 'Configure GPSR safety information on the connection edit page.',
    },
  ]);
}
```

This matches the existing precedent for image-related preflight errors (`upload-images-via-allegro.ts` returns `CreateOfferValidationError[]` with `code: 'IMAGE_DOWNLOAD_FAILED'` etc., which the adapter wraps into `OfferCreateRejectedException` at the same call site). FE Alert path unchanged.

After the guard:
- Always: `body.location = sellerDefaults.location`.
- Smart-link pre-step (§4.3) decides whether to set `productSet[0].product.id` (linked) or fall through to inline.
- Inline path only: `body.productSet[0].responsibleProducer = { id: sellerDefaults.responsibleProducerId }`; `body.productSet[0].safetyInformation = sellerDefaults.safetyInformation`.

### 4.3 Smart-link pre-step

New util at `libs/integrations/allegro/src/infrastructure/util/resolve-allegro-product-card-by-ean.ts` (mirrors the `upload-images-via-allegro.ts` shape — single function, types in a sibling `*.types.ts`):

```ts
export type ResolveProductCardResult =
  | { kind: 'unique'; productId: string }
  | { kind: 'ambiguous'; matches: AllegroProductCardSummary[] }
  | { kind: 'no_match' };

export async function resolveAllegroProductCardByEan(
  httpClient: IAllegroHttpClient,
  cache: CachePort | undefined,
  input: { ean: string; categoryId: string },
  options?: { cacheTtlSec?: number; cacheKeyPrefix?: string },
): Promise<ResolveProductCardResult>;
```

Behaviour:
1. Cache key `allegro:product-card:{ean}:{categoryId}`. Hit returns cached `unique` or `no_match` (both worth caching). Ambiguous results are NOT cached — they're rare and we want to re-evaluate on the next attempt in case the operator narrowed the catalogue.
2. Miss: `GET /sale/products?phrase={ean}&category.id={categoryId}&limit=10`. Filter results where the card's `ean` field matches the input exactly (Allegro's matcher is fuzzy). Determine `unique` (1 exact match) / `ambiguous` (≥2 exact matches) / `no_match` (0 exact matches).
3. Cache `unique` and `no_match` with 24h TTL.
4. Returns the discriminated result; **never throws** for resolver failures — on HTTP error from Allegro, returns `no_match` and logs (treats as "couldn't resolve, fall back to inline").

**Async resolution lives in `createOffer`, not `applyPlatformParams`.** `createOffer` is already async — it computes the smart-link result once at the top, then threads it as an optional `cardLinkResult: ResolveProductCardResult` parameter through `buildCreateOfferRequest` → `applyPlatformParams`. This keeps `applyPlatformParams` synchronous (its current contract) and avoids cascading async through the body-builder. The branch on the result happens synchronously inside `applyPlatformParams` once it's been handed the resolved value.

```ts
// inside createOffer (async)
const cardLinkResult = await maybeResolveProductCard({
  ean: variant.ean ?? variant.gtin ?? null,
  categoryId: cmd.overrides.categoryId,
  httpClient: this.httpClient,
  cache: this.cache,
});
// cardLinkResult is { kind: 'unique' | 'ambiguous' | 'no_match' }
const body = this.buildCreateOfferRequest(cmd, cardLinkResult);
// ... rest of createOffer unchanged
```

`applyPlatformParams` receives `cardLinkResult` and branches synchronously **before** the inline `productSet` block at line 988. On `unique`:

```ts
body.productSet = [{
  product: { id: cardLinkResult.productId },
  quantity: cmd.stock,
}];
// Skip name / parameters / images / GPSR on product side — inherited from card.
// Offer-section parameters[] still go through normally.
```

On `ambiguous` or `no_match` → fall through to current inline behaviour (writes `productSet[0].product.{name, parameters, images}` + GPSR from sellerDefaults).

Telemetry per offer (structured log, not metrics — same shape as existing `Logger.log`):
```
{
  smartLink: {
    attempted: true,
    ean: '...',
    categoryId: '...',
    outcome: 'unique' | 'ambiguous' | 'no_match',
    matchCount: number,           // for ambiguous diagnostics
  }
}
```

### 4.4 `ResponsibleProducerReader` capability

```ts
// libs/core/src/listings/domain/ports/capabilities/responsible-producer-reader.capability.ts
import { OfferManagerPort } from '../offer-manager.port';

export interface ResponsibleProducerEntry {
  id: string;          // Allegro's responsibleProducer ID
  name: string;        // human-readable label
  type: 'PRODUCER' | 'IMPORTER' | 'AUTHORIZED_REPRESENTATIVE' | 'FULFILLMENT_SERVICE_PROVIDER';
  // Other Allegro-returned fields kept opaque under `raw` if needed; today
  // the dropdown only needs id + name + type.
}

export interface ResponsibleProducerReader {
  fetchResponsibleProducers(): Promise<ResponsibleProducerEntry[]>;
}

export function isResponsibleProducerReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & ResponsibleProducerReader {
  return typeof (adapter as Partial<ResponsibleProducerReader>).fetchResponsibleProducers === 'function';
}
```

`AllegroOfferManagerAdapter` implements it with `GET /sale/responsible-producers`. No caching — operator-driven dropdown; freshness > latency.

### 4.5 API endpoint

`AllegroConnectionsController` at `apps/api/src/integrations/allegro/http/allegro-connections.controller.ts`:

```ts
@Controller('integrations/allegro/connections/:id')
@UseGuards(JwtAuthGuard)
export class AllegroConnectionsController {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  @Get('responsible-producers')
  async listResponsibleProducers(
    @Param('id') connectionId: string,
  ): Promise<ResponsibleProducerEntry[]> {
    const adapter = await this.integrations.getCapabilityAdapter<OfferManagerPort>(
      connectionId, 'OfferManager',
    );
    if (!isResponsibleProducerReader(adapter)) {
      throw new CapabilityNotSupportedException('ResponsibleProducerReader', connectionId);
    }
    return adapter.fetchResponsibleProducers();
  }
}
```

Returns the neutral list directly. No DTO mapping needed since the type is already platform-neutral.

### 4.6 Frontend wiring

`EditConnectionForm.tsx` already conditionally renders structured inputs by platform branch. Add:

```tsx
{connection.platformType === 'allegro' && (
  <AllegroSellerDefaultsSection
    connectionId={connection.id}
    control={form.control}
    register={form.register}
    errors={form.formState.errors}
  />
)}
```

`AllegroSellerDefaultsSection` lives at `apps/web/src/features/connections/components/allegro-seller-defaults-section.tsx`. It composes:
- `Select` (province, 16 options) — values from a small `apps/web/src/features/connections/types/polish-voivodeship.ts` constant array
- `Input` (city)
- `Input` (postCode, with `pattern` HTML attr `\d{2}-\d{3}`)
- `Select` (responsibleProducer) — populated from `useResponsibleProducersQuery(connectionId)` TanStack Query against the new API endpoint, with a "Refresh" button that invalidates the query cache
- Radio + Textarea (safetyInformation; textarea shown only when `type === 'SAFETY_INFORMATION'`)

The form's submit handler merges these structured fields into `connection.config.allegro.sellerDefaults` via the existing `mergeStructuredIntoConfig` pattern. The Zod schema at `edit-connection.schema.ts` is extended with a discriminated-union `sellerDefaults` field; when the platform isn't `'allegro'`, the field is `.optional()` and ignored.

### 4.7 Why one PR for both

- They share `applyPlatformParams` line 988 — splitting them means PR #1 writes GPSR unconditionally, then PR #2 has to add the smart-link guard. Fewer churn cycles to do them together.
- The smart-link only buys you anything if seller defaults exist (otherwise the inline fallback also fails). The two halves complete the unblock together; either alone is half-shipped.

## 5. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/integrations/allegro/src/domain/types/allegro-location.types.ts` (new) | Define `PolishVoivodeshipValues` + `PolishVoivodeship` per `as const` pattern. Export from package barrel. | Type compiles; 16 values match Allegro's enum. |
| 2 | `libs/integrations/allegro/src/domain/types/allegro-seller-defaults.types.ts` (new) | Define `AllegroSellerDefaultsConfig` + `AllegroSafetyInformation` discriminated union. Export from package barrel. | Type compiles; matches §4.1. |
| 3 | `libs/core/src/listings/domain/ports/capabilities/responsible-producer-reader.capability.ts` (new) | Per §4.4. Export `ResponsibleProducerEntry`, `ResponsibleProducerReader`, `isResponsibleProducerReader`. Add to capabilities barrel. | Type compiles; guard pattern matches existing `is{Capability}` files. |
| 4 | `libs/integrations/allegro/src/infrastructure/util/resolve-allegro-product-card-by-ean.types.ts` (new) | `ResolveProductCardResult` discriminated union; `AllegroProductCardSummary` shape (id, ean, name). | Type compiles; mirrors `upload-images-via-allegro.types.ts` shape. |
| 5 | `libs/integrations/allegro/src/infrastructure/util/resolve-allegro-product-card-by-ean.ts` (new) | Per §4.3. Single async function; never throws. Cache hits/misses via injected `CachePort`. | Returns correct discriminant for unique/ambiguous/no_match; HTTP failure → `no_match` + log; cache hit short-circuits. |
| 6 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | (a) Constructor accepts optional `sellerDefaults` and `cache`. (b) Throw `OfferCreateRejectedException` directly at top of `buildCreateOfferRequest` when `sellerDefaults` is missing — code `SELLER_DEFAULTS_NOT_CONFIGURED`, one error per missing field. (c) `createOffer` (top-level async) computes `cardLinkResult` via the smart-link resolver and threads it as a parameter into `buildCreateOfferRequest` → `applyPlatformParams`. (d) Write `body.location` from sellerDefaults always. (e) In `applyPlatformParams`, on `cardLinkResult.kind === 'unique'` → build `productSet = [{ product: { id }, quantity }]` and skip GPSR/parameters/name/images on product side. On ambiguous/no_match → fall through to existing inline block, then write `responsibleProducer` + `safetyInformation`. (f) Implement `fetchResponsibleProducers()`. | Adapter compiles; `applyPlatformParams` stays synchronous; branch logic matches §4.3. |
| 7 | `libs/integrations/allegro/src/application/allegro-adapter.factory.ts` | Read `connection.config.allegro.sellerDefaults`. Pass to `AllegroOfferManagerAdapter` constructor along with the existing `cache` instance. | Factory compiles; sellerDefaults flows from config to adapter. |
| 8 | `apps/api/src/integrations/http/dto/allegro-connection-config.dto.ts` | Extend with optional `sellerDefaults`. Use class-validator: `@ValidateNested() @Type(() => AllegroSellerDefaultsDto)`. New nested DTO classes for `AllegroLocationDto` (province enum, postcode `/^\d{2}-\d{3}$/`), `AllegroSafetyInformationDto` (discriminated by `type` via `@Type({ discriminator: { property: 'type', subTypes: [...] } })`). | DTO compiles; class-validator rejects bad province/postcode/missing-content-when-type=SAFETY_INFORMATION. |
| 9 | `apps/api/src/integrations/allegro/http/allegro-connections.controller.ts` (new) | Per §4.5. `@Controller('integrations/allegro/connections/:id')`, `GET responsible-producers`, JWT-guarded. **Register in `apps/api/src/integrations/integrations.module.ts` `controllers: [...]` array** alongside the existing controllers — no new module. | Endpoint returns 200 with `ResponsibleProducerEntry[]`; 404 when adapter doesn't support capability; controller is reachable end-to-end. |
| 10 | `apps/web/src/features/connections/types/polish-voivodeship.types.ts` (new) | `as const` array + derived type, mirrors BE. Display labels in Polish (operator-facing). | Type-only; no runtime behavior. |
| 11 | `apps/web/src/features/connections/api/responsible-producers.api.ts` (new) | Thin API client + `useResponsibleProducersQuery(connectionId)` TanStack hook. | Hook compiles; uses existing `apiClient` shared instance. |
| 12 | `apps/web/src/features/connections/components/allegro-seller-defaults-section.tsx` (new) | Per §4.6. Composes `FormField` + primitives. RHF-controlled. | Renders only when `platformType === 'allegro'`; province + postcode validation; safetyInformation textarea conditional. |
| 13 | `apps/web/src/features/connections/components/edit-connection.schema.ts` | Extend Zod schema with optional discriminated `sellerDefaults`. | Submit wires fields correctly into `config.allegro.sellerDefaults`. |
| 14 | `apps/web/src/features/connections/components/EditConnectionForm.tsx` | Render `<AllegroSellerDefaultsSection>` inside the existing platform-branch conditional when platform is `allegro`. | Form renders; submit merges sellerDefaults into config JSONB. |
| 15 | Tests (BE) | (a) Adapter spec — 5 new branches: `body.location` write, `responsibleProducer`/`safetyInformation` on inline path, unique smart-link swaps `productSet`, ambiguous/no_match fall through to inline, missing sellerDefaults throws `OfferCreateRejectedException` with code `SELLER_DEFAULTS_NOT_CONFIGURED`. (b) Resolver spec — unique/ambiguous/no_match/HTTP-failure-fallback/cache-hit. (c) Factory spec — sellerDefaults flows from config to constructor. | All branches green; existing 66 createOffer specs stay green by being seeded with sellerDefaults in `baseCmd` setup. |
| 16 | Tests (FE) | Vitest spec for `AllegroSellerDefaultsSection` — renders all fields, validates province/postcode/safetyInformation. | Component renders + submits valid input. |
| 17 | All — quality gate | `pnpm lint`, `pnpm type-check`, `pnpm test`. | Clean. |
| 18 | Manual sandbox repro — **hard merge gate** | Same Allegro sandbox flow that 422'd on 2026-04-28 (cat 257933 / Canon variant). After configuring sellerDefaults via the new admin UI: (a) offer reaches `active`/`validating` (most likely on cat 257933 which has many product cards), or (b) if no card match, offer creates inline with all three required fields populated. Either outcome confirms structural fix. The only failure is another `INVALID_STATE`/`RESPONSIBLE_PRODUCER_NOT_SPECIFIED`/`SAFETY_INFO_NOT_DEFINED` from Allegro — that means the wiring is broken. | Sandbox round-trip succeeds. |

## 6. Tests-of-record

- **Adapter spec** — 5 new createOffer branches (location write, responsibleProducer + safetyInformation on inline path, smart-link unique/ambiguous/no_match, missing-sellerDefaults preflight rejection) + `fetchResponsibleProducers` happy + 4xx paths.
- **Resolver spec (new)** — unique/ambiguous/no_match/HTTP-error/cache-hit branches.
- **Factory spec** — sellerDefaults wiring from `connection.config` into adapter constructor.
- **API DTO validation** — Jest covers province enum / postcode regex / discriminated safetyInformation.
- **FE component spec** — Vitest covers `AllegroSellerDefaultsSection` form behaviour.

No integration test (`*.int-spec.ts`) added — bug is wiring-only with no DB/wire schema changes; existing E2E coverage continues to exercise happy path. The "integration test" wording in #431's acceptance criteria refers to the manual Allegro sandbox repro at step 18, not OL's Testcontainers `*.int-spec.ts` jargon (testing-guide.md).

## 7. Validation

- **Hexagonal compliance** — capability + entry type live in CORE (`libs/core/src/listings/domain/ports/capabilities/`); adapter implements it in `libs/integrations/allegro/`; the new exception lives in the Allegro infrastructure package because it's a marketplace-specific signal mapped to a CORE exception by `OfferCreationExecutionService`. ✅
- **Naming** — `*.capability.ts` + `is{Capability}` guard, `*.types.ts`, `*.exception.ts`, `*-controller.ts` all follow engineering-standards.md. ✅
- **Domain layer purity** — capability file imports only the existing `OfferManagerPort` interface (no NestJS, no TypeORM). ✅
- **DTO validation** — class-validator at the controller boundary; `province` enum + `postCode` regex + discriminated `safetyInformation` enforced server-side. ✅
- **Headers** — every new file gets the standard JSDoc header per engineering-standards.md "File Headers". ✅
- **Migrations** — none required. `Connection.config` is JSONB. ✅
- **Security** — RP endpoint behind `JwtAuthGuard`; no credentials/secrets in FE; the operator's Allegro token already lives in the existing connection-credentials store. ✅
- **Frontend dependency direction** — section component lives under `features/connections/`; API hook lives under `features/connections/api/`; only imports from `shared/ui/`. ✅

## 8. Risks & open questions

- **Allegro voivodeship enum drift.** The 16 voivodeship strings are stable but Allegro could rename them. Acceptable because `AllegroSellerDefaultsNotConfiguredException` won't fire — but a 422 on `province` validation would surface in the existing FE Alert via the `OfferCreateRejectedException` flow. Risk: low.
- **`body.stock` ↔ `productSet[0].quantity` coexistence.** Allegro docs are ambiguous. Plan ships both fields populated on smart-linked offers (current `body.stock` + new `productSet[0].quantity`). If Allegro rejects, trim post-sandbox.
- **Smart-link cache coherence.** Cards rarely change but their `ean` field could be edited by Allegro's catalogue team. 24h TTL bounds the window. Operator can clear via Redis-flush if a known-good card stops linking — acceptable for MVP.
- **Smart-link false positive.** A card matches by EAN but its required parameters don't align with the variant's attributes — Allegro 422s on create. Today the operator sees the error in the Job-detail view. Adding the "card-blocked marker" to suppress repeat smart-links is gold-plating per §3 — open as a future enhancement once we see real-world hits.
- **No `responsibleProducer` registry sync to local storage.** Every dropdown render hits Allegro. Latency ~200-500ms acceptable for a settings page; if it becomes friction, a 5-minute Redis cache is one line of code.
- **Old-config compatibility.** Connections without `sellerDefaults` get `AllegroSellerDefaultsNotConfiguredException` on first offer attempt. Operator sees the error message naming the missing fields and a hint to configure on the connection edit page. No silent fallback (which would surface as the original Allegro 422 — strictly worse UX).

## 9. Out of scope (explicitly deferred)

- Per-offer wizard override of seller defaults (#430 OOS).
- Creating Responsible Producer entries from inside OL (#430 OOS).
- Multi-warehouse / multi-location support (#430 OOS).
- GPSR pictograms in safetyInformation (#430 OOS).
- Manual operator override "force inline" / "force card-link" UX (#431 OOS).
- Multi-EAN smart-link, cross-category card matching, creating new product cards via `POST /sale/products` (#431 OOS).
- Card-blocked marker for smart-link parameter-mismatch failures (deferred — see §8).
- Surfacing Allegro 422 details in wizard (tracked under #433, deferred).
- Detecting category-conditional required fields in wizard (tracked under #432, deferred).
