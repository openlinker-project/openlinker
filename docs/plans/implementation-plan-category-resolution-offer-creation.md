# Implementation Plan: Wire Category Mapping Resolution into Offer Creation Flow

**Issue**: #143  
**Classification**: CORE / Application + Integration  
**Branch**: `143-category-mapping-offer-creation`

---

## 1. Goal

When creating an Allegro offer from a PrestaShop product, automatically resolve the Allegro category using a 3-step fallback chain:

1. **Auto-detect via GTIN/EAN** — query Allegro `GET /sale/matching-categories` by barcode
2. **Category mapping fallback** — look up the product's PrestaShop category in `MappingConfigService.resolveAllegroCategory()`
3. **Manual pick** — leave category `null` for merchant to fill in

The resolution logic must be a dedicated application service, use ports only, and log which method was used.

## 2. Non-Goals

- Full offer creation endpoint / job handler (separate issue — this builds the resolution service and wires it into the port/adapter layer)
- UI changes
- Modifying existing offer sync (ingestion) flow

## 3. Design

### New Components

#### 3.1 `MarketplacePort` extension — `matchCategoryByBarcode`

Add an optional method to the marketplace port for barcode-based category matching:

```typescript
// In MarketplacePort
matchCategoryByBarcode?(barcode: string): Promise<string | null>;
```

Returns the Allegro category ID if a single match is found, `null` otherwise.

#### 3.2 Allegro adapter implementation

In `AllegroMarketplaceAdapter`, implement `matchCategoryByBarcode` calling `GET /sale/matching-categories?ean={barcode}`. Return category ID from the first match, or `null` if no results / ambiguous.

#### 3.3 `CategoryResolutionService`

New application service in `libs/core/src/listings/application/services/`:

```
Interface: ICategoryResolutionService
  resolveCategory(input: CategoryResolutionInput): Promise<CategoryResolutionResult>

Input: { connectionId, masterConnectionId, productId, variantId? }
Result: { allegroCategoryId: string | null, method: 'auto_detect' | 'category_mapping' | 'manual' }
```

**Resolution algorithm**:
1. Get product variant EAN/GTIN via `ProductVariantRepositoryPort`
2. If barcode exists → call `marketplace.matchCategoryByBarcode(barcode)`
3. If auto-detect fails → get product's PrestaShop categories via `ProductMasterPort.getProduct()` (categories in associations) or `IdentifierMappingService` to find the PrestaShop external product ID, then query PrestaShop categories
4. For each PrestaShop category → call `MappingConfigService.resolveAllegroCategory(connectionId, categoryId)`
5. If no mapping resolves → return `{ allegroCategoryId: null, method: 'manual' }`
6. Log the resolution method for observability

#### 3.4 Types

New types file: `libs/core/src/listings/application/types/category-resolution.types.ts`

### Dependency Flow

```
CategoryResolutionService
  → ProductVariantRepositoryPort (get EAN/GTIN)
  → IIntegrationsService → MarketplacePort.matchCategoryByBarcode (auto-detect)
  → IMappingConfigService.resolveAllegroCategory (fallback)
```

All via ports — no direct infrastructure imports.

---

## 4. Implementation Steps

### Step 1: Types
**File**: `libs/core/src/listings/application/types/category-resolution.types.ts`
- Define `CategoryResolutionMethod` union (`'auto_detect' | 'category_mapping' | 'manual'`)
- Define `CategoryResolutionInput` and `CategoryResolutionResult` interfaces

### Step 2: Extend MarketplacePort
**File**: `libs/core/src/integrations/domain/ports/marketplace.port.ts`
- Add optional `matchCategoryByBarcode?(barcode: string): Promise<string | null>`

### Step 3: Add Allegro API types
**File**: `libs/integrations/allegro/src/domain/types/allegro-api.types.ts`
- Add `AllegroMatchingCategoriesResponse` type

### Step 4: Implement in Allegro adapter
**File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts`
- Implement `matchCategoryByBarcode()` calling `GET /sale/matching-categories`

### Step 5: Service interface
**File**: `libs/core/src/listings/application/interfaces/allegro-category-resolution.service.interface.ts`
- Define `ICategoryResolutionService`

### Step 6: Service implementation
**File**: `libs/core/src/listings/application/services/allegro-category-resolution.service.ts`
- Implement the 3-step fallback chain
- Log resolution method with structured fields

### Step 7: Token + module wiring
**File**: `libs/core/src/listings/listings.tokens.ts` (or existing tokens file)
- Add `CATEGORY_RESOLUTION_SERVICE_TOKEN`
- Wire in listings module

### Step 8: Export from barrel
- Export new service, interface, types, and token from `libs/core/src/listings/`

### Step 9: Unit tests
**File**: `libs/core/src/listings/application/services/allegro-category-resolution.service.spec.ts`
- Test: auto-detect hit (barcode → category found)
- Test: auto-detect miss → category mapping fallback hit
- Test: both miss → manual (null)
- Test: no barcode on variant → skip auto-detect, try mapping
- Test: logging of resolution method

### Step 10: Allegro adapter unit test
**File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.spec.ts`
- Test `matchCategoryByBarcode` success/empty/error paths

---

## 5. Risks & Open Questions

1. **Product categories access**: `ProductMasterPort.getProductCategories()` throws `NotSupportedException` in PrestaShop adapter. We'll use the product's `categories` field from `getProduct()` response or look up via identifier mapping + direct PrestaShop category ID. Need to verify product entity carries category associations.
2. **Allegro `GET /sale/matching-categories` API shape**: Need to verify exact request/response format from Allegro docs. The adapter implementation should handle empty results gracefully.
3. **Which PrestaShop category to use**: Products can have multiple categories. The resolution should try each category in order (deepest first) until a mapping is found.
