# Implementation plan — Listing detail: surface live offer fields

Closes #464.

## Goal

Today `/listings/:id` is a debug view of `identifier_mappings` — Mapping ID, External/Internal IDs, timestamps, raw context. It tells the operator a mapping *exists* but nothing about *what the offer actually is* on the marketplace. For Allegro `entityType = 'Offer'` mappings, surface live title, image, price, available qty, status, category, marketplace URL, and a description preview — fetched on demand from `GET /sale/product-offers/{offerId}`.

## Layer classification

Cross-cutting:
- **CORE/listings (domain)** — new `OfferReader` capability + `MarketplaceOffer` neutral DTO.
- **Integration/Allegro** — adapter implements `OfferReader.getOffer()`.
- **Interface (API)** — new `GET /listings/:mappingId/offer` endpoint.
- **Frontend** — new section on the listing detail page, new query hook, four states.

No DB schema change. No worker change.

## Non-goals (per issue)

- Bulk enrichment of `/listings` list page (separate cost/value tradeoff).
- PrestaShop / other-platform `OfferReader` adapters (capability + Allegro impl only).
- Editing fields from this page (already handled by `EditOfferDrawer`).
- Persistent caching beyond `Cache-Control: max-age=30`.
- Republish / end / force-resync actions.

## One scope deviation worth flagging

The issue body says "return 501 (Not implemented for this adapter)" when the adapter doesn't support `OfferReader`. **The existing controller convention** for the same situation (e.g. `getCategoryParameters` at `listings.controller.ts:314`) is **422 `UnprocessableEntityException`**, with the same intent ("adapter does not support this capability"). I'm following the existing convention and using 422 — consistency with the rest of the controller surface beats matching the literal HTTP code in the issue body. The FE 4-state handling (loading / error / empty / data) treats 422 the same way it would treat 501: a soft "Live data unavailable for this adapter" panel. Will note in PR description.

## Variant SKU/EAN inline enrichment — in scope

The issue's "Linked product side" bullet is in scope. Both `entityType === 'Offer'` and `entityType === 'ProductVariant'` mappings store the variant id as `internalId` (verified in `OfferMappingSyncService.linkOffer` — the `Offer` mapping's internalId is the linked variant's id, not a separate offer entity). One new endpoint covers both cases:

- **BE**: `GET /products/variants/:variantId` returns `{ id, sku, ean, productId, name? }` — small DTO scoped to what the listing detail page needs (no full variant payload).
- **FE**: new `useVariantQuery(variantId)` hook + inline SKU/EAN tags next to the existing Internal ID row when the mapping links to a variant.

## Existing patterns to mirror

- **Capability + guard**: `libs/core/src/listings/domain/ports/capabilities/offer-event-reader.capability.ts` is the smallest sibling — single method + co-located `is{Capability}` guard. Drop the `Port` suffix per the convention call-out in `offer-lister.capability.ts`.
- **Capability guard tests**: extend the existing table in `libs/core/src/listings/domain/ports/capabilities/__tests__/*.spec.ts` — one new row, automatic happy-path + missing + non-function coverage.
- **Adapter offer fetch**: `AllegroOfferManagerAdapter.fetchOfferIdentifiers` (line 463) already calls `GET /sale/product-offers/{offerId}` — same HTTP client, same auth path. Refactor to extract the raw fetch and consume it from both call sites.
- **Controller capability narrowing**: `listings.controller.ts:309-319` (the `getCategoryParameters` site) is the template — `getCapabilityAdapter('OfferManager')`, `isOfferReader(adapter)` guard, 422 on miss.
- **FE detail-page state machine**: the page already follows the loading / error / data pattern at the **page** level. I'll add the new section as an **embedded** state machine that fails soft (the existing key-value list keeps rendering even when the offer fetch fails — per `.claude/rules/fe-pages.md` "do not crash the rest of the page").
- **FE query hook**: copy the shape of `use-offer-creation-status-query.ts` — TanStack Query, query-key factory, `enabled` predicate.

## Changes by file

### Phase A — CORE listings (capability + DTO)

**`libs/core/src/listings/domain/types/marketplace-offer.types.ts`** (new)
- `MarketplaceOffer` interface with the fields listed in the issue:
  - `externalId`, `title`
  - `description?: string` (raw HTML/text — FE owns truncation)
  - `imageUrl?: string` (primary image)
  - `price: { amount: string; currency: string }`
  - `availableQuantity: number`
  - `status: string` (string passthrough — no leaky enum; the FE renders unknown strings as a neutral badge)
  - `category?: { id: string; name?: string }`
  - `marketplaceUrl?: string`
  - `endsAt?: string` (ISO — when the offer's marketplace-side validity ends; Allegro's `publication.endingAt`. Distinct from "last modified": the bare offer GET doesn't expose a cheap last-modified timestamp, and operators benefit more from seeing when the offer expires.)

**`libs/core/src/listings/domain/ports/capabilities/offer-reader.capability.ts`** (new)
- `OfferReader { getOffer(input: { externalId: string }): Promise<MarketplaceOffer> }`
- Co-located `isOfferReader(adapter)` guard mirroring `isOfferEventReader`.

**`libs/core/src/listings/domain/ports/capabilities/__tests__/*.spec.ts`**
- Add `'OfferReader' / isOfferReader / 'getOffer'` row to the table.

**`libs/core/src/listings/index.ts`**
- Re-export `MarketplaceOffer`, `OfferReader`, `isOfferReader`.

Acceptance: types compile in isolation; capability guard table grows by one row, all rows still pass.

### Phase B — Allegro adapter

**`libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts`**
- Implement `getOffer({ externalId })` calling `GET /sale/product-offers/{externalId}` and mapping the response to `MarketplaceOffer`. Reuse the shared HTTP client; rely on its existing 404 / token-refresh / transient-5xx handling.
- Map fields:
  - `id` → `externalId`, `name` → `title`
  - `description` → from `description.sections[].items` (Allegro stores rich text as a sectioned array — flatten to a single string for now; FE can render or truncate).
  - `imageUrl` → first item of `images[]` (Allegro returns array of `{ url }`).
  - `price` → `sellingMode.price.{amount, currency}`.
  - `availableQuantity` → `stock.available`.
  - `status` → `publication.status` (string).
  - `category` → `category.{id, name}` (name may not be present on the bare GET — leave undefined).
  - `marketplaceUrl` → derived per-environment: sandbox vs prod uses different host (`https://allegro.pl/oferta/{id}` for prod, `https://allegro.pl.allegrosandbox.pl/oferta/{id}` for sandbox). Use the existing config's `environment` flag.
  - `endsAt` → `publication.endingAt` (Allegro's scheduled offer end; the bare GET does not expose a last-modified timestamp).

**`libs/integrations/allegro/src/domain/types/allegro-api.types.ts`**
- Extend `AllegroProductOffer` with the additional fields needed by `getOffer`: `description?`, `images?`, `sellingMode?`, `stock?`, `publication?`. Keep additions optional to avoid breaking the existing `fetchOfferIdentifiers` consumer.

**`libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts`**
- New describe `getOffer (#464)`:
  - happy-path: full response → `MarketplaceOffer` with every field populated.
  - sparse-payload: missing `description` / `images` / `category.name` / `endsAt` — adapter returns `MarketplaceOffer` with the optional fields undefined, the required ones present.
  - 404 from upstream: propagates as the existing HTTP error type (no special domain conversion needed in this PR — keep the HTTP layer's existing behavior; controller maps to 404).

Acceptance: adapter spec covers happy + sparse + 404; the existing `fetchOfferIdentifiers` tests keep passing.

### Phase B.5 — Variant-by-id endpoint (#464 "Linked product side")

**`apps/api/src/products/http/dto/product-variant-summary-response.dto.ts`** (new — small DTO scoped to the listing-detail enrichment use case)
- `ProductVariantSummaryResponseDto { id, productId, sku: string | null, ean: string | null, name?: string }`.

**`apps/api/src/products/http/products.controller.ts`**
- New endpoint: `@Get('variants/:variantId')` placed **before** `@Get(':id')` so the route doesn't collide with the product-detail handler. Returns `ProductVariantSummaryResponseDto`. 404 when not found. Reuse `productsService.getVariant` if present; otherwise inject `ProductVariantRepositoryPort` directly via the existing `PRODUCT_VARIANT_REPOSITORY_TOKEN`.

**`apps/api/src/products/http/products.controller.spec.ts`**
- Happy path + 404.

Acceptance: `GET /products/variants/{id}` returns 200 with summary or 404; existing product endpoints unaffected.

### Phase C — API endpoint

**`apps/api/src/listings/http/dto/marketplace-offer-response.dto.ts`** (new)
- `MarketplaceOfferResponseDto` mirroring `MarketplaceOffer` for OpenAPI/Swagger; static `fromDomain(offer): MarketplaceOfferResponseDto` helper.

**`apps/api/src/listings/http/listings.controller.ts`**
- New endpoint: `@Get(':id/offer')`.
  - Load the mapping; throw `NotFoundException` if missing.
  - Reject with `NotFoundException` if `mapping.entityType !== 'Offer'` — the issue says 404 ("not an offer mapping"). Same status as "mapping doesn't exist" so we don't leak record presence to operators with the wrong scope.
  - Resolve `OfferManagerPort` via `IntegrationsService.getCapabilityAdapter('OfferManager', mapping.connectionId)`.
  - Narrow via `isOfferReader(adapter)` → throw `UnprocessableEntityException` ("does not support live offer reading") on miss. **Status 422, matching `getCategoryParameters` convention.**
  - Call `adapter.getOffer({ externalId: mapping.externalId })` — propagate upstream errors (the existing HTTP-error→Nest-exception filter handles 404 from Allegro as 502 or similar; no special handling).
  - Set `Cache-Control: public, max-age=30` on the response — operator-friendly back-and-forth without re-hitting Allegro.
  - Return `MarketplaceOfferResponseDto.fromDomain(...)`.

**`apps/api/src/listings/http/listings.controller.spec.ts`**
- New describe block:
  - Happy path: 200 + body for `entityType === 'Offer'`.
  - 404 when mapping doesn't exist.
  - 404 when `entityType !== 'Offer'`.
  - 422 when adapter doesn't implement `OfferReader`.
  - Connection errors (404/409) propagate from `getCapabilityAdapter` unchanged.

Acceptance: integration controller tests pass for all four/five branches; `listOfferMappings` and `getOfferMapping` tests unaffected.

### Phase D — Frontend

**`apps/web/src/features/products/api/products.api.ts`**
- Add `getVariant(variantId: string): Promise<ProductVariantSummary>`.

**`apps/web/src/features/products/api/products.types.ts`**
- Add `ProductVariantSummary` interface.

**`apps/web/src/features/products/api/products.query-keys.ts`**
- Add `variant: (id) => ['products', 'variant', id] as const`.

**`apps/web/src/features/products/hooks/use-variant-query.ts`** (new)
- TanStack Query hook with `staleTime: 60_000` and retries-disabled on 404.

**`apps/web/src/features/listings/api/listings.types.ts`**
- Add `MarketplaceOfferResponse` interface mirroring the BE DTO.

**`apps/web/src/features/listings/api/listings.api.ts`**
- Add `getMarketplaceOffer(mappingId: string): Promise<MarketplaceOfferResponse>` → `GET /listings/{mappingId}/offer`.

**`apps/web/src/features/listings/api/listings.query-keys.ts`**
- Add `marketplaceOffer: (mappingId: string) => ['listings', 'marketplace-offer', mappingId] as const`.

**`apps/web/src/features/listings/hooks/use-listing-marketplace-offer-query.ts`** (new)
- TanStack Query hook. `enabled = mapping?.entityType === 'Offer'`. `staleTime: 30_000` (matches BE Cache-Control).
- Disable retries on 422 (capability missing) and 404 (mapping doesn't exist) — these are not transient.

**`apps/web/src/features/listings/components/listing-marketplace-offer-section.tsx`** (new)
- Embedded state machine: loading → error (with retry) → soft-fallback on 422 → data.
  - Loading: `LoadingState liveRegion="off"` inline.
  - Error (5xx / network / unknown): `ErrorState` with retry; the parent page's key-value list keeps rendering.
  - 422 fallback: small neutral panel "Live data unavailable for this adapter."
  - Data: thumbnail (`ProductThumbnail` shared primitive — issue mentions it indirectly), title (`<h3>`), `StatusBadge` for `status`, price + available qty in a `KeyValueList`, category name when present, marketplace URL as `<a target="_blank">`, description preview that expands on click (`<details>` element — native, accessible).
- Render only when `mapping.entityType === 'Offer'` (decided at the parent page).

**`apps/web/src/pages/listings/listing-detail-page.tsx`**
- Mount `<ListingMarketplaceOfferSection mappingId={mapping.id} entityType={mapping.entityType} />` between the existing `KeyValueList` section and the `OfferCreation` section.
- For mappings whose `internalId` is a variant (`entityType === 'ProductVariant' || entityType === 'Offer'`), render the variant's SKU + EAN inline next to the Internal ID via `useVariantQuery`. Render quietly: when the variant query is loading, show the bare ID; when it errors or 404s, also show just the bare ID (no error UI — the variant enrichment is a nice-to-have, not load-bearing for the page).

**`apps/web/src/pages/listings/listing-detail-page.test.tsx`**
- Extend with cases:
  - Renders the new section when `entityType === 'Offer'` and the offer query resolves.
  - Renders the soft fallback when the offer query fails with 422.
  - Renders the error panel + retry on 5xx, raw mapping fields still visible.
  - Skipped (no fetch) when `entityType !== 'Offer'`.

**`apps/web/src/test/test-utils.tsx`**
- Add `getMarketplaceOffer: vi.fn().mockResolvedValue(...)` to the listings mock.

Acceptance: page tests cover happy + error + 422 + skipped paths; existing tests pass.

## Quality gate

```bash
pnpm lint && pnpm type-check && pnpm test
```

No schema migration. No worker change.

## Risks

1. **Allegro response shape drift**: `description` / `images` / `sellingMode` field shapes vary slightly across Allegro API versions (per the `feedback_allegro_api_verify_shape` memory). I'll capture a real fixture during implementation and verify against developer.allegro.pl.
2. **`marketplaceUrl` host derivation**: the offer URL's host depends on the connection's environment (sandbox vs prod). The Allegro connection config carries this — confirm field name during implementation, fall back to omitting `marketplaceUrl` if the env is unknown.
3. **Sparse Allegro fields on synced-in offers**: offers fetched after a re-sync may have empty `description.sections` or no `images[]`. The DTO marks all of those `?:` so the UI renders gracefully.

## Out-of-band follow-ups (not in this PR)

- **PrestaShop `OfferReader` impl** when a `PrestashopOfferManagerAdapter` lands.
- **Marketplace-side actions** (republish, end, force-sync) — separate UX + capability discussion per issue.
