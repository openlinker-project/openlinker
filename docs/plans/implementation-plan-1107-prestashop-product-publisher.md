# Implementation Plan: PrestaShop ProductPublisher + CategoryProvisioner Adapter

**Issue**: #1107
**Epic**: #1005 / ADR-024 — ShopProductManager capability across shop adapters
**Branch**: `1107-prestashop-product-publisher`
**Layer**: Integration — `libs/integrations/prestashop/`

---

## Overview

Add `PrestashopProductPublisherAdapter` implementing `ShopProductManagerPort` and the `CategoryProvisioner` sub-capability. This is the direct PrestaShop sibling of the shipped WooCommerce adapter (#1043), following the same structural pattern and contract surface.

The adapter enables the bulk-offer creation flow to publish products to a PrestaShop master catalog, including hierarchical category provisioning. No CORE changes are required — the contracts (`ShopProductManagerPort`, `CategoryProvisioner`, `ProductPublishRejectedException`) already exist and are stable.

### Primary objectives

1. Implement `publishProduct` — create or upsert a product via the PrestaShop WebService XML API, including multi-category assignment and stock via `stock_availables`.
2. Implement `provisionCategory` — walk a `ProvisionCategoryCommand.path`, find-or-create each node with exact name + parent match, return the leaf `destinationCategoryId`.
3. Wire the new adapter into the plugin manifest, dispatch table, and factory.

### Non-goals / deferred

- No media/image upload to PS (WooCommerce uses direct `imageUrls`; PS WS images require multipart; deferred to a follow-up).
- No PS-specific attribute handling beyond passing raw field values via `platformParams`.
- No integration tests (pure adapter over a mocked client; unit tests are sufficient).
- No new DB migrations (pure integration layer).

---

## Architecture & Design

### Layer assignment

| Component | Layer | Package |
|---|---|---|
| `PrestashopProductPublisherAdapter` | Integration adapter | `@openlinker/integrations-prestashop` |
| `prestashop-product-publish.types.ts` | Integration types | `@openlinker/integrations-prestashop` |
| Plugin wiring (manifest + factory) | Integration plugin | `@openlinker/integrations-prestashop` |

### Ports involved

| Port / Capability | Location | Status |
|---|---|---|
| `ShopProductManagerPort` | `libs/core/src/listings/domain/ports/shop-product-manager.port.ts` | Existing — do not modify |
| `CategoryProvisioner` | `libs/core/src/listings/domain/ports/capabilities/category-provisioner.capability.ts` | Existing — do not modify |
| `isCategoryProvisioner()` type guard | same file | Existing |
| `PublishProductCommand` / `PublishProductResult` | `libs/core/src/listings/domain/types/product-publish.types.ts` | Existing |
| `ProvisionCategoryCommand` / `ProvisionCategoryResult` | `libs/core/src/listings/domain/types/category-provision.types.ts` | Existing |
| `ProductPublishRejectedException` | `libs/core/src/listings/domain/exceptions/product-publish-rejected.exception.ts` | Existing |

### Key design decisions

**D1 — Stock via `stock_availables`, not inline on the product body.**
PrestaShop creates a `stock_available` row automatically on product creation; you cannot set `quantity` inline during `createResource('products', ...)`. After create, `listResources('stock_availables', { custom: { 'filter[id_product]': productId } })` returns the auto-generated row, then `updateResource('stock_availables', saId, { id: saId, id_product: productId, quantity: String(cmd.stock) })` sets the quantity. Upsert path (PUT products) must also refresh stock.

**D2 — Language-scoped text fields.**
PrestaShop WS requires multilingual fields (`name`, `description`, `link_rewrite`, `meta_title`, `meta_description`) as `{ language: [{ '@_id': '1', '#text': value }] }`. The adapter hardcodes language ID `'1'` (the default/primary language). Operators override via `platformParams.languageId` if needed.

**D3 — Multi-category via `associations.categories`.**
Primary category: `id_category_default`. All assigned categories (including primary): `associations.categories.category` as `[{ id: '12' }, { id: '34' }]`.

**D4 — Error mapping boundary.**
`PrestashopApiException` with `statusCode >= 400 && statusCode < 500` (excluding `PrestashopAuthenticationException` which is 401) → `ProductPublishRejectedException`. `PrestashopAuthenticationException` and all non-4xx exceptions propagate unchanged — same policy as `WooCommerceProductPublisherAdapter.toPublishError`.

**D5 — `platformParams` passthrough.**
`cmd.platformParams` fields are spread first onto the product body; explicit mapped fields (price, active, name, etc.) then overwrite any conflicting keys. This matches the WooCommerce reference.

**D6 — Idempotency of `provisionCategory`.**
The `listResources('categories', ...)` query uses `custom: { 'filter[name]': name, 'filter[id_parent]': String(parentId) }` then exact-name comparison on the result. If the category exists, it is reused; if absent, it is created. This is the same find-or-create pattern as WooCommerce.

---

## Data flow

```
publishProduct(cmd)
  ├── externalProductId? → PUT /api/products/{id}   (upsert)
  │                      → updateStock(productId, cmd.stock)
  └── (none)            → POST /api/products         (create)
                         → updateStock(newProductId, cmd.stock)

provisionCategory({ path: [root, ..., leaf] })
  for each node in path:
    → listResources('categories', filter[name]+filter[id_parent])
    → exact match? → reuse id
    → no match    → createResource('categories', { name, id_parent, link_rewrite, active: '1' })
  → return { destinationCategoryId: leafId, createdPath?: [...] }
```

---

## Implementation Phases

### Phase 1 — Wire types

**File**: `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/prestashop-product-publish.types.ts`

Define all PS-specific wire shapes used by the adapter. Keep CORE types untouched; these are integration-internal only.

```typescript
// Language-scoped field helper
export interface PrestashopLangField {
  language: Array<{ '@_id': string; '#text': string }>;
}
// Build a single-language field value for the default language
export function langField(value: string, languageId = '1'): PrestashopLangField {
  return { language: [{ '@_id': languageId, '#text': value }] };
}

// Minimal request shape for POST/PUT /api/products
export interface PrestashopProductWriteBody {
  id?: string | number;
  name: PrestashopLangField;
  description?: PrestashopLangField;
  link_rewrite: PrestashopLangField;
  price: string;                    // tax-excluded, string per PS WS convention
  active: '0' | '1';
  id_category_default: string;
  associations?: {
    categories?: { category: Array<{ id: string }> };
  };
  meta_title?: PrestashopLangField;
  meta_description?: PrestashopLangField;
  [key: string]: unknown;           // platformParams passthrough
}

// Product response from GET/POST/PUT /api/products
export interface PrestashopProductResponse {
  id: string | number;
  active: string | number;
  // other fields not needed by the adapter
}

// Response from GET /api/categories (list item)
export interface PrestashopCategoryListItem {
  id: string | number;
  name: string | PrestashopLangField;
  id_parent: string | number;
}

// Response from POST /api/categories
export interface PrestashopCategoryResponse {
  id: string | number;
  name: string | PrestashopLangField;
  id_parent: string | number;
}

// stock_available list item
export interface PrestashopStockAvailableItem {
  id: string | number;
  id_product: string | number;
  quantity: string | number;
}
```

**Acceptance criteria**: All types compile under strict mode. No imports from CORE packages (integration-internal).

---

### Phase 2 — Implement the adapter

**File**: `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/prestashop-product-publisher.adapter.ts`

```
PrestashopProductPublisherAdapter
  implements ShopProductManagerPort, CategoryProvisioner

constructor(
  private readonly client: IPrestashopWebserviceClient,
  private readonly connection: Connection,
)
```

#### `publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult>`

1. Read `languageId` from `cmd.platformParams?.languageId ?? '1'`.
2. Build the product body:
   - Spread `cmd.platformParams` first (un-modeled fields pass through).
   - Overwrite with mapped fields: `name`, `description` (if `cmd.content?.description`), `link_rewrite` (from SEO slug if present, else slugified title, else `link_rewrite_fallback`), `price` (string `cmd.price.amount.toFixed(2)`), `active` (`cmd.status === 'published' ? '1' : '0'`), `id_category_default` (`cmd.destinationCategoryIds[0]`), `associations.categories.category` (all category IDs mapped to `{ id: String(id) }`).
3. If `cmd.externalProductId` is set: `updateResource('products', cmd.externalProductId, { id: cmd.externalProductId, ...body })` → then update stock.
4. Else: `createResource('products', body)` → then update stock.
5. After create/update, call private `updateStock(productId, cmd.stock)`.
6. Return `{ externalProductId: String(response.id), status: cmd.status }`.
7. Wrap in `try/catch`: call `this.toPublishError(err)`.

#### `updateStock(productId: string, quantity: number): Promise<void>` (private)

1. `listResources<PrestashopStockAvailableItem>('stock_availables', { custom: { 'filter[id_product]': productId } })`.
2. Take first result (PS creates one `stock_available` per product, more for combinations — for simple products there is exactly one with `id_product_attribute = 0`). If none found, log a warning and return (non-fatal; stock may not be managed).
3. `updateResource('stock_availables', saId, { id: String(sa.id), id_product: productId, quantity: String(quantity) })`.

#### `provisionCategory(cmd: ProvisionCategoryCommand): Promise<ProvisionCategoryResult>`

1. Start with `parentId = '0'` (root) and `createdIds: string[] = []`.
2. For each node in `cmd.path`:
   a. `listResources<PrestashopCategoryListItem>('categories', { custom: { 'filter[name]': node.name, 'filter[id_parent]': parentId } })`.
   b. Find exact name match (compare string form; PS multilingual response may wrap in `langField` shape — extract text with a helper).
   c. If found: `parentId = String(match.id)`.
   d. If not found: `createResource('categories', { name: langField(node.name, languageId), id_parent: parentId, link_rewrite: langField(slugify(node.name), languageId), active: '1' })`. Set `parentId = String(newCat.id)`, push to `createdIds`.
3. Return `{ destinationCategoryId: parentId, createdPath: createdIds.length ? createdIds : undefined }`.

#### `toPublishError(error: unknown): never` (private)

```typescript
import {
  PrestashopApiException,
  PrestashopAuthenticationException,
} from '@openlinker/integrations-prestashop';

if (
  error instanceof PrestashopApiException &&
  !(error instanceof PrestashopAuthenticationException) &&
  error.statusCode >= 400 &&
  error.statusCode < 500
) {
  throw new ProductPublishRejectedException(
    'prestashop.webservice.v1',
    error.statusCode,
    [{ code: String(error.statusCode), message: error.message }],
  );
}
throw error;
```

#### Helper: `slugify(text: string): string` (private)

Converts a category name to a PS-compatible `link_rewrite`: lowercase, replace spaces and non-alphanumeric chars with hyphens, deduplicate hyphens, trim. No external deps needed.

#### Helper: `extractLangText(value: string | PrestashopLangField): string` (private)

PS list responses may return `name` as a plain string (when single language and no multilingual config) or as a `PrestashopLangField` struct. This helper handles both.

**Acceptance criteria**:
- Create path calls `createResource('products', ...)` then `updateStock`.
- Upsert path calls `updateResource('products', id, ...)` then `updateStock`.
- `status: 'draft'` maps to `active: '0'`; `status: 'published'` maps to `active: '1'`.
- `platformParams` fields that don't conflict with mapped fields pass through unchanged.
- A 400–499 `PrestashopApiException` surfaces as `ProductPublishRejectedException`.
- A `PrestashopAuthenticationException` (401) is rethrown as-is.
- A 5xx `PrestashopApiException` is rethrown as-is.
- `provisionCategory` reuses an existing node by exact name+parent match.
- `provisionCategory` creates missing nodes and threads `parentId` root-to-leaf.

---

### Phase 3 — Unit tests

**File**: `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/__tests__/prestashop-product-publisher.adapter.spec.ts`

Mock `IPrestashopWebserviceClient` with `jest.fn()` on each method.

#### `publishProduct` test cases

| Test | What it covers |
|---|---|
| `should POST a new product and return externalProductId` | create path, `createResource` called, stock updated via `listResources` + `updateResource` |
| `should PUT to existing id when externalProductId is set (upsert)` | upsert path, `createResource` NOT called, `updateResource` called with product id |
| `should map status "published" → active "1"` | field mapping |
| `should map status "draft" → active "0"` | field mapping |
| `should assign multi-category via associations and set id_category_default to first` | `destinationCategoryIds: ['10', '11']` |
| `should pass platformParams through without overriding mapped fields` | `platformParams: { active: '0', tax_class: 'reduced' }` — explicit `active` wins; `tax_class` passes through |
| `should throw ProductPublishRejectedException on 4xx PrestashopApiException` | 400 → rejection |
| `should propagate PrestashopAuthenticationException (401) unchanged` | 401 → rethrow |
| `should propagate 5xx PrestashopApiException unchanged` | 503 → rethrow |

#### `provisionCategory` test cases

| Test | What it covers |
|---|---|
| `should reuse an existing category by exact name+parent match` | `listResources` returns match → no `createResource` |
| `should create a missing root category and return its id` | `listResources` returns `[]` → `createResource` called |
| `should create hierarchical path root→leaf, threading parentId` | two nodes, two `createResource` calls, second call uses first's id as `id_parent` |
| `should include createdPath only for created nodes` | mixed: root found, leaf created → `createdPath` contains only leaf id |

**Mock setup pattern** (following WooCommerce spec):

```typescript
function makeClient(): jest.Mocked<IPrestashopWebserviceClient> {
  return {
    createResource: jest.fn(),
    updateResource: jest.fn(),
    listResources: jest.fn(),
    getResource: jest.fn(),
    deleteResource: jest.fn(),
  };
}
```

**Default stock mock**: `listResources` for `stock_availables` returns `[{ id: '1', id_product: '<productId>', quantity: '0' }]`; `updateResource` for `stock_availables` resolves void.

**Acceptance criteria**: All test cases pass with `pnpm test`. Coverage of adapter public methods ≥ 90%.

---

### Phase 4 — Plugin wiring

#### 4a — Extend `PrestashopAdapters` interface

**File**: `libs/integrations/prestashop/src/application/interfaces/prestashop-adapter.factory.interface.ts`

Add:
```typescript
import type { PrestashopProductPublisherAdapter } from '../../infrastructure/adapters/product-publisher/prestashop-product-publisher.adapter';

// In PrestashopAdapters:
productPublisher?: PrestashopProductPublisherAdapter;
```

#### 4b — Instantiate in factory

**File**: `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`

After the existing adapters block (around line 166), add:

```typescript
const productPublisher = new PrestashopProductPublisherAdapter(httpClient, connection);
```

Add `productPublisher` to the returned object:

```typescript
return {
  productMaster,
  inventoryMaster,
  orderSource,
  orderProcessorManager,
  productPublisher,
};
```

#### 4c — Update plugin manifest and dispatch table

**File**: `libs/integrations/prestashop/src/prestashop-plugin.ts`

1. In `prestashopAdapterManifest.supportedCapabilities`, add `'ProductPublisher'` and `'CategoryProvisioner'`:

```typescript
supportedCapabilities: [
  'ProductMaster',
  'InventoryMaster',
  'OrderSource',
  'OrderProcessorManager',
  'ProductPublisher',
  'CategoryProvisioner',
],
```

2. In `createCapabilityAdapter`, add `ProductPublisher` to the dispatch table:

```typescript
ProductPublisher: () => adapters.productPublisher,
```

Note: `CategoryProvisioner` **does** need its own dispatch entry alongside `ProductPublisher`. `IntegrationsService.getCapabilityAdapter` resolves adapters by capability string directly — without a `CategoryProvisioner` entry in the dispatch table, `dispatchCapability` throws "adapter does not support capability: CategoryProvisioner" even though the adapter implements `provisionCategory`. The dispatch table therefore maps both strings to the same adapter instance:

```typescript
ProductPublisher: () => adapters.productPublisher,
CategoryProvisioner: () => adapters.productPublisher,
```

This differs from Allegro's `OfferCreator` pattern (which shares the `OfferManager` dispatch entry and is narrowed by type guard at call sites) — here `CategoryProvisioner` is resolved as a first-class capability string, so it must have its own entry.

**Acceptance criteria**:
- `prestashopAdapterManifest.supportedCapabilities` includes `'ProductPublisher'` and `'CategoryProvisioner'`.
- `createCapabilityAdapter('ProductPublisher', ...)` returns the `PrestashopProductPublisherAdapter` instance.
- `isCategoryProvisioner(adapter)` returns `true` for the returned adapter (because it implements `provisionCategory`).

---

## Validation Checklist

- [x] Follows hexagonal architecture: adapter in `libs/integrations/prestashop/`, no domain logic, no CORE mutations
- [x] Respects CORE vs Integration boundary: ports and exception types imported from `@openlinker/core/listings`; infrastructure exceptions from `@openlinker/integrations-prestashop`
- [x] Uses existing patterns: mirrors `WooCommerceProductPublisherAdapter` structure exactly; reuses `IPrestashopWebserviceClient`
- [x] Idempotency: `provisionCategory` is find-or-create (safe to retry); `publishProduct` with `externalProductId` is a PUT (idempotent upsert)
- [x] Error handling: 4xx → `ProductPublishRejectedException`; 401 / 5xx propagate
- [x] Testing strategy: unit tests with mocked client; covers create, upsert, status, multi-category, category find-or-create, all error branches
- [x] Naming conventions: `PrestashopProductPublisherAdapter`, `prestashop-product-publisher.adapter.ts`, `prestashop-product-publish.types.ts`
- [x] File structure: `infrastructure/adapters/product-publisher/` folder, `__tests__/` subfolder
- [x] No migrations needed (no ORM entities changed)
- [x] TypeScript strict mode: explicit return types on all public methods, no `any`
- [x] No `console.log` — no logging needed in this adapter (errors propagate; the caller logs)
- [x] `pnpm lint && pnpm type-check && pnpm test` must be green before commit

---

## Questions & Assumptions

**Q1 — Language ID hardcoding.**
Assumed `languageId = '1'` is the default PS language. Operators who have a non-default primary language can pass `platformParams.languageId` to override. This is the simplest approach; a configurable default can be added to `PrestashopConnectionConfig` in a follow-up.

**Q2 — Image upload.**
PS WS image upload is a multipart `POST /api/images/products/{id}` — structurally different from WooCommerce's `imageUrls` array. Deferred. The adapter ignores `cmd.content?.imageUrls` for now.

**Q3 — `stock_availables` for products with combinations.**
A PS product with attribute combinations generates multiple `stock_available` rows (one per combination). This adapter targets simple products (the bulk-flow maps one variant → one product). `updateStock` takes the first row with `id_product_attribute = '0'` if multiple rows are present, which corresponds to the simple/master stock. This assumption is documented inline.

**Q4 — `CategoryProvisioner` in manifest vs dispatch.**
Unlike Allegro's sub-capabilities (`OfferCreator`, `CategoryBrowser`, etc.) which share the `OfferManager` dispatch entry and are narrowed by type guard at call sites, `CategoryProvisioner` here **requires its own dispatch entry**. `IntegrationsService.getCapabilityAdapter('CategoryProvisioner', ...)` resolves by capability string; without a matching entry in the dispatch table, `dispatchCapability` throws at runtime. The shipped `prestashop-plugin.ts` therefore maps both `ProductPublisher` and `CategoryProvisioner` to the same `adapters.productPublisher` instance.

---

## File Summary

| Action | File |
|---|---|
| **Create** | `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/prestashop-product-publish.types.ts` |
| **Create** | `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/prestashop-product-publisher.adapter.ts` |
| **Create** | `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/__tests__/prestashop-product-publisher.adapter.spec.ts` |
| **Modify** | `libs/integrations/prestashop/src/application/interfaces/prestashop-adapter.factory.interface.ts` |
| **Modify** | `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts` |
| **Modify** | `libs/integrations/prestashop/src/prestashop-plugin.ts` |

No migrations. No CORE changes. No frontend changes.
