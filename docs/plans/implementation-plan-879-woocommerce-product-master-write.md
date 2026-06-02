# Implementation Plan — #879 WooCommerce ProductMasterPort (write)

## Goal

Fill in the five write stubs in `WooCommerceProductMasterAdapter` that currently throw
`WooCommerceNotSupportedException`: `createProduct`, `updateProduct`, `deleteProduct`,
`upsertProductVariant`, `assignCategories`.

## Classification

**Integration layer only** — `libs/integrations/woocommerce/`.
No CORE port changes. No migrations. No API/FE changes.

## Non-goals

- Permanent (force) product deletion — `deleteProduct` moves to WC trash only
- Bulk write / batch API
- Image upload / media management
- Category create/delete (only category assignment)
- Price-rule or tax sync

---

## Design

### Layer map

```
WooCommerceProductMasterAdapter   (infrastructure/adapters/product-master/)
  └─ IWooCommerceHttpClient       (infrastructure/http/)   ← needs post/put/delete added
  └─ IWooCommerceProductMapper    (infrastructure/mappers/) ← read-only, unchanged
  └─ IdentifierMappingPort        (@openlinker/core/identifier-mapping) ← existing
```

### New WC REST endpoints used

| Method | Endpoint | Used by |
|--------|----------|---------|
| `POST` | `/wp-json/wc/v3/products` | `createProduct` |
| `PUT`  | `/wp-json/wc/v3/products/{id}` | `updateProduct`, `assignCategories` |
| `DELETE` | `/wp-json/wc/v3/products/{id}` | `deleteProduct` (trash; no `force`) |
| `GET`  | `/wp-json/wc/v3/products/{id}/variations` | `upsertProductVariant` (SKU lookup) |
| `POST` | `/wp-json/wc/v3/products/{id}/variations` | `upsertProductVariant` (create path) |
| `PUT`  | `/wp-json/wc/v3/products/{id}/variations/{varId}` | `upsertProductVariant` (update path) |

---

## Step-by-step plan

### Step 1 — Extend HTTP client interface

**File:** `infrastructure/http/woocommerce-http-client.interface.ts`

Add three methods alongside the existing `get<T>`:

```ts
post<T>(path: string, body: unknown): Promise<T>;
put<T>(path: string, body: unknown): Promise<T>;
delete<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T>;
```

**Acceptance:** interface compiles; existing `get` signature unchanged.

---

### Step 2 — Implement write methods in WooCommerceHttpClient

**File:** `infrastructure/http/woocommerce-http-client.ts`

Extract the retry/timeout/auth loop into a private `request<T>(method, url, body?)` helper.
Refactor `get` to call it (same observable behaviour — no logic change). Add `post`, `put`, `delete` delegating to `request`.

Key notes:
- `Content-Type: application/json` on POST/PUT bodies
- `DELETE` without `?force` → WC moves to trash (not permanent)
- Same retry logic (429, 5xx) as GET
- 401/403 → `WooCommerceUnauthorizedException`
- 404 → `WooCommerceHttpResponseException(404, ...)`

**Acceptance:** all existing 14 `woocommerce-http-client.spec.ts` GET tests must pass unchanged after the refactor; new tests for POST/PUT/DELETE added on top.

---

### Step 3 — Add write request types

**File:** `infrastructure/adapters/product-master/woocommerce-product.types.ts`

Update the file header to say "request and response shapes" (was "responses only").

Add:

```ts
export interface WooCommerceProductWriteRequest {
  name?: string;
  sku?: string;
  description?: string;
  regular_price?: string;
  weight?: string;
  status?: string;
  type?: string;
  categories?: Array<{ id: number }>;
}

export interface WooCommerceVariationWriteRequest {
  sku?: string;
  regular_price?: string;
  weight?: string;
  attributes?: Array<{ name: string; option: string }>;
}
```

---

### Step 4 — `createProduct`

Replace stub with:

1. Build `WooCommerceProductWriteRequest` from `ProductCreate` (name, sku, description, price→regular_price as string, weight→string)
2. `POST /wp-json/wc/v3/products` via `httpClient.post<WooCommerceProduct>`
3. `identifierMapping.getOrCreateInternalId(Product, String(response.id), connectionId)` to register mapping
4. Return `{ ...mapper.mapProduct(response), id: internalId }`

---

### Step 5 — `updateProduct`

Replace stub with:

1. Resolve external WC ID via `identifierMapping.getExternalIds(Product, productId)` → find `connectionId` match → throw `WooCommerceResourceNotFoundException` if none
2. Build partial `WooCommerceProductWriteRequest` from `ProductUpdate` (only fields that are non-undefined)
3. `PUT /wp-json/wc/v3/products/{wcId}` via `httpClient.put<WooCommerceProduct>`, wrapped in:
   ```ts
   try { ... } catch (err) {
     if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
       throw new WooCommerceResourceNotFoundException(
         `WooCommerce product ${wcId} not found (deleted?)`,
         CORE_ENTITY_TYPE.Product, productId, this.connection.id,
       );
     }
     throw err;
   }
   ```
4. Return `{ ...mapper.mapProduct(response), id: productId }`

---

### Step 6 — `deleteProduct`

Replace stub with:

1. Resolve external WC ID (same as Step 5, throw `WooCommerceResourceNotFoundException` if no mapping)
2. `DELETE /wp-json/wc/v3/products/{wcId}` — no `?force` param → WC moves to trash.
   Treat WC 404 as **idempotent success** (product is already gone/trashed — caller's intent is satisfied):
   ```ts
   try { await this.httpClient.delete(...) } catch (err) {
     if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
       return; // already trashed/deleted — idempotent
     }
     throw err;
   }
   ```
3. Return `void`

---

### Step 7 — `upsertProductVariant`

Replace stub with:

1. Resolve parent product's external WC ID (throw `WooCommerceResourceNotFoundException` if no OL mapping).
2. Fetch existing variations: `GET .../variations?per_page=100` (single page). Wrap in the standard 404 catch — WC 404 here means the parent product no longer exists:
   ```ts
   try { variations = await this.httpClient.get<WooCommerceProductVariation[]>(...) }
   catch (err) {
     if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
       throw new WooCommerceResourceNotFoundException(
         `WooCommerce product ${wcId} not found (deleted?)`,
         CORE_ENTITY_TYPE.Product, productId, this.connection.id,
       );
     }
     throw err;
   }
   ```
   If exactly 100 results are returned, log a `warn` that the list may be truncated.
3. SKU-match in the returned array:
   - **Found** → `PUT .../variations/{varId}` with mapped payload, wrapped in 404 catch → rethrow as `WooCommerceResourceNotFoundException` for the variation. Then call:
     `identifierMapping.getOrCreateInternalId(ProductVariant, String(varId), connectionId, { parentEntityType: Product, parentInternalId: productId })`
     to register the mapping even if the variation predates OL.
   - **Not found** → `POST .../variations` (no 404 expected here); then call:
     `identifierMapping.getOrCreateInternalId(ProductVariant, String(response.id), connectionId, { parentEntityType: Product, parentInternalId: productId })`
     to register the new mapping.
4. Return `{ ...mapper.mapVariation(response, productId), id: internalId }`

Note: WC variation `attributes` are `[{ name, option }]`; `ProductVariantCreate.attributes` is `Record<string, string>` — map with `Object.entries`.

---

### Step 8 — `assignCategories`

Replace stub with:

1. Resolve external WC ID (throw `WooCommerceResourceNotFoundException` if no OL mapping).
2. `PUT /wp-json/wc/v3/products/{wcId}` with `{ categories: categoryIds.map(id => ({ id: Number(id) })) }`.
   - Category IDs come in as WC external ID strings (from `getCategories()` return values); `Number()` converts for the WC REST payload.
   - Wrap in 404 catch → rethrow as `WooCommerceResourceNotFoundException` (same pattern as `updateProduct`).
3. Return `void`

---

### Step 9 — Tests

**Files:**
- `infrastructure/http/__tests__/woocommerce-http-client.spec.ts` — add POST/PUT/DELETE cases (happy path, retry, 401, 404, timeout). The `makeHttpClient()` mock factory in the adapter spec does **not** need changes here — that is the concrete class, not the interface mock.
- `infrastructure/adapters/product-master/__tests__/woocommerce-product-master.adapter.spec.ts`:
  - **Update `makeHttpClient()` factory** to include `post: jest.fn(), put: jest.fn(), delete: jest.fn()` alongside the existing `get: jest.fn()`. This is required because `IWooCommerceHttpClient` will now declare all four methods and `jest.Mocked<IWooCommerceHttpClient>` will not satisfy strict mode without them.
  - `createProduct`: happy path (mapping registered, mapper called), HTTP error propagates
  - `updateProduct`:
    - happy path
    - `WooCommerceResourceNotFoundException` on missing OL identifier mapping
    - `WooCommerceResourceNotFoundException` when WC returns 404 on PUT (stale mapping race)
  - `deleteProduct`:
    - happy path
    - `WooCommerceResourceNotFoundException` on missing OL identifier mapping
    - returns void (idempotent) when WC returns 404 on DELETE (already trashed)
  - `upsertProductVariant`:
    - create path (SKU not found → POST → mapping registered)
    - update path (SKU match → PUT → mapping registered even when absent before call)
    - update path where mapping already exists (idempotent — `getOrCreateInternalId` still called)
    - `WooCommerceResourceNotFoundException` on missing OL identifier mapping for parent
    - `WooCommerceResourceNotFoundException` when WC returns 404 on variations GET (parent deleted)
    - saturation warning (variations list returns exactly 100 items → `logger.warn` called)
  - `assignCategories`:
    - happy path (categories payload uses `Number(id)`)
    - `WooCommerceResourceNotFoundException` on missing OL identifier mapping
    - `WooCommerceResourceNotFoundException` when WC returns 404 on PUT (stale mapping race)

---

## Files changed

```
libs/integrations/woocommerce/src/infrastructure/http/
  woocommerce-http-client.interface.ts              ← +post/put/delete
  woocommerce-http-client.ts                        ← implement + refactor to private request()
  __tests__/woocommerce-http-client.spec.ts         ← extend

libs/integrations/woocommerce/src/infrastructure/adapters/product-master/
  woocommerce-product.types.ts                      ← +write request types
  woocommerce-product-master.adapter.ts             ← replace 5 stubs
  __tests__/woocommerce-product-master.adapter.spec.ts  ← extend
```

**Total new files: 0. Total files changed: 6.**

---

## Architecture compliance

- Stays inside `libs/integrations/woocommerce/` — no core boundary crossed
- No `any` types — all payloads typed via `WooCommerceProductWriteRequest` / `WooCommerceVariationWriteRequest`
- Identifier mapping used correctly: `getExternalIds` for read-before-write, `getOrCreateInternalId` for create **and** for upsert update path (variation may predate OL connection)
- `deleteMapping` NOT called on delete — OL keeps the mapping for traceability (product is in WC trash, not permanently gone)
- Logger used on all public methods

## Risk / open questions

- `upsertProductVariant` single-page variation fetch (100 limit) — fine for MVP; log warn if saturated
- `deleteProduct` trash vs force confirmed: trash only; WC 404 on DELETE treated as idempotent success
