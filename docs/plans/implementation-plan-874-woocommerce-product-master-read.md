# Implementation Plan — #874: WooCommerce ProductMasterPort (read)

**Branch:** `874-woocommerce-product-master-read`
**Scaffold base:** `873-woocommerce-plugin-scaffold` merged ✅ (commit `758ce507`)
**Issue:** https://github.com/openlinker-project/openlinker/issues/874

---

## 1. Scope

Implement the **read half** of `ProductMasterPort` for WooCommerce REST API v3.

**In scope:** `getProduct`, `getProducts`, `getProductVariants`, `getProductCategories`, `searchProducts`, `listExternalIds`, `getCategories` (optional port method — actively used by `categories-cache.service.ts`).

**Write methods** (`createProduct`, `updateProduct`, `deleteProduct`, `upsertProductVariant`, `assignCategories`) throw `WooCommerceNotSupportedException`.

**No core changes.** Everything lives in `libs/integrations/woocommerce/`.

**No migration needed.**

---

## 2. Scaffold Baseline (merged #873 — commit `758ce507`)

| File | State | Key facts |
|---|---|---|
| `src/infrastructure/http/woocommerce-http-client.ts` | Exists | `get<T>(path: string)` — single attempt, no params, `_retryConfig` accepted but unused |
| `src/infrastructure/http/woocommerce-http-client.types.ts` | Exists | `RetryConfig { maxRetries, initialDelayMs, backoffMultiplier, maxDelayMs }` |
| `src/domain/types/woocommerce-config.types.ts` | Exists | `{ siteUrl: string }` only |
| `src/domain/types/woocommerce-credentials.types.ts` | Exists | `{ consumerKey, consumerSecret }` |
| `src/woocommerce-plugin.ts` | Exists | `supportedCapabilities: []`, empty dispatch table |
| `src/index.ts` | Exists | Exports config/credentials types, manifest, plugin, module |
| `src/infrastructure/adapters/woocommerce-connection-tester.adapter.ts` | Exists | Uses `credentialsResolver.get<T>(connection.credentialsRef)` |

**Confirmed facts from codebase research:**
- `credentialsResolver.get<T>(ref)` — correct method (not `.resolve()`)
- `IdentifierMappingPort` exposes: `getExternalIds`, `batchGetOrCreateInternalIds`, `getOrCreateInternalId`, `deleteMapping` ✅
- `batchGetOrCreateInternalIds` map key format: `${externalId}:${connectionId}` — only this format, no fallback
- `deleteMapping` silently no-ops when row doesn't exist (TypeORM `delete()` behaviour)
- Retry loop belongs in HTTP client — consistent with InPost and Allegro pattern (one place to test, clean adapters)
- No `getAll()` helper — single-page fetch, loop handled by caller (`master-product-sync-all.handler.ts`)
- Sync handler calls `listExternalIds({ limit: pageSize, offset })` where offset is always a multiple of pageSize — offset→page translation is always exact
- WC default for `GET /products` (no status param) returns only `publish` — correct; only add `status` param when caller explicitly passes `filters.status`
- Description stored as-is — no HTML stripping; PrestaShop passes through raw; Allegro's `sanitizeAllegroDescription` is outbound (before posting to Allegro), not inbound
- `getCategories()` is actively called by `categories-cache.service.ts` — not dead code
- Adapters are instantiated fresh per `createCapabilityAdapter` call — same as PrestaShop, no caching

---

## 3. File Map

```
libs/integrations/woocommerce/src/
│
├── domain/
│   └── exceptions/
│       ├── woocommerce-not-supported.exception.ts           [NEW]
│       ├── woocommerce-config.exception.ts                  [NEW]
│       ├── woocommerce-resource-not-found.exception.ts      [NEW]
│       ├── woocommerce-unauthorized.exception.ts            [NEW]
│       └── woocommerce-network.exception.ts                 [NEW]
│
├── infrastructure/
│   ├── http/
│   │   ├── woocommerce-http-client.interface.ts             [NEW]
│   │   ├── woocommerce-http-client.ts                       [MODIFY]
│   │   ├── woocommerce-http-client.types.ts                 [no change]
│   │   └── woocommerce-http-response.exception.ts           [NEW]  ← transport-only; never exported from barrel
│   │
│   ├── mappers/
│   │   ├── woocommerce-product.mapper.interface.ts          [NEW]
│   │   ├── woocommerce-product.mapper.types.ts              [NEW]
│   │   ├── woocommerce-product.mapper.ts                    [NEW]
│   │   └── __tests__/
│   │       └── woocommerce-product.mapper.spec.ts           [NEW]
│   │
│   └── adapters/
│       └── product-master/
│           ├── woocommerce-product.types.ts                 [NEW]
│           ├── woocommerce-product-master.adapter.ts        [NEW]
│           └── __tests__/
│               └── woocommerce-product-master.adapter.spec.ts [NEW]
│
├── woocommerce-plugin.ts                                    [MODIFY]
└── index.ts                                                 [MODIFY]
```

---

## 4. Implementation Steps

### Step 1 — Domain exceptions (one file per exception)

**Convention:** individual `*.exception.ts` files — same as the PrestaShop integration
(`prestashop-not-supported.exception.ts`, `prestashop-resource-not-found.exception.ts`).

**Layer split:**
- `domain/exceptions/` — 5 domain exceptions (not-supported, **config**, resource-not-found, unauthorized, network)
- `infrastructure/http/` — 1 transport exception (`woocommerce-http-response.exception.ts`) — internal to the HTTP client, never exported from the barrel

---

**File:** `src/domain/exceptions/woocommerce-not-supported.exception.ts`
```typescript
/**
 * WooCommerce Not Supported Exception
 *
 * Thrown by WooCommerceProductMasterAdapter for write operations that are
 * not implemented in this issue (#874). Write capability is covered by #879.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceNotSupportedException extends Error {
  constructor(operation: string, alternative: string) {
    super(`WooCommerce does not support '${operation}'. ${alternative}`);
    this.name = 'WooCommerceNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

---

**File:** `src/domain/exceptions/woocommerce-config.exception.ts`
```typescript
/**
 * WooCommerce Config Exception
 *
 * Thrown when a WooCommerce connection is in an invalid configuration state
 * that prevents the adapter from being constructed — e.g. a missing
 * `credentialsRef` before the operator has saved credentials.
 *
 * Mirrors AllegroConfigException in libs/integrations/allegro, which uses the
 * same pattern for misconfigured connection state.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceConfigException extends Error {
  constructor(
    message: string,
    readonly connectionId: string,
  ) {
    super(message);
    this.name = 'WooCommerceConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

---

**File:** `src/domain/exceptions/woocommerce-resource-not-found.exception.ts`
```typescript
/**
 * WooCommerce Resource Not Found Exception
 *
 * Thrown by WooCommerceProductMasterAdapter when an identifier mapping
 * for a given internal entity ID does not exist for this connection, or when
 * the WooCommerce API returns 404 for a resource that was expected to exist.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceResourceNotFoundException extends Error {
  constructor(
    message: string,
    readonly entityType: string,
    readonly id: string,
    readonly connectionId: string,
  ) {
    super(message);
    this.name = 'WooCommerceResourceNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

---

**File:** `src/domain/exceptions/woocommerce-unauthorized.exception.ts`
```typescript
/**
 * WooCommerce Unauthorized Exception
 *
 * Thrown by WooCommerceHttpClient when WooCommerce returns HTTP 401 or 403.
 * Signals that the consumer key / secret is invalid or lacks required scope.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceUnauthorizedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WooCommerceUnauthorizedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

---

**File:** `src/domain/exceptions/woocommerce-network.exception.ts`
```typescript
/**
 * WooCommerce Network Exception
 *
 * Thrown by WooCommerceHttpClient for transport-level failures: timeouts
 * (AbortController), network errors, and non-2xx responses after all retries
 * are exhausted (excluding 401/403/404 which have their own typed exceptions).
 *
 * `originalError` carries the underlying cause without shadowing the native
 * `Error.cause` property (Node 16.9+ / TS 4.6+ type it as `unknown`).
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceNetworkException extends Error {
  constructor(
    message: string,
    readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'WooCommerceNetworkException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

---

### Step 2 — Transport exception (infrastructure, not domain)

**File:** `src/infrastructure/http/woocommerce-http-response.exception.ts`

This file lives in `infrastructure/http/` because it carries a raw HTTP status code — an infrastructure detail the domain must not know about. It is imported only by `WooCommerceHttpClient` (which throws it) and by capability adapters (which catch it and convert to domain exceptions). It is **not exported** from the package barrel.

```typescript
/**
 * WooCommerce HTTP Response Exception
 *
 * Transport-level exception thrown by WooCommerceHttpClient for non-2xx
 * responses that are not mapped to a more specific typed exception
 * (WooCommerceUnauthorizedException for 401/403). Carries the HTTP status
 * code so the adapter layer can inspect it and rethrow as a domain exception
 * (e.g. 404 → WooCommerceResourceNotFoundException) with full entity context.
 *
 * Intentionally placed in infrastructure/http/ (not domain/exceptions/) because
 * HTTP status codes are a transport concern — domain/exceptions/ is reserved for
 * domain-level concepts. Never exported from the package barrel.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http
 */
export class WooCommerceHttpResponseException extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'WooCommerceHttpResponseException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

---

### Step 3 — HTTP client interface

**File:** `src/infrastructure/http/woocommerce-http-client.interface.ts`

```typescript
/**
 * WooCommerce HTTP Client Interface
 *
 * Contract for the WooCommerce REST API v3 transport layer. Depends on this
 * interface rather than the concrete WooCommerceHttpClient so that capability
 * adapters (ProductMaster, etc.) remain testable with a mock transport.
 *
 * Mirrors the pattern used by IPrestashopWebserviceClient and IInPostHttpClient
 * in their respective integration packages.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http
 */
export interface IWooCommerceHttpClient {
  /**
   * Perform a GET request against the WooCommerce REST API.
   *
   * @param path - URL path including the `/wp-json/wc/v3/...` prefix.
   *   May already contain a query string (`?per_page=1`); `params` are
   *   appended with `&` in that case.
   * @param params - Optional query parameters serialized via URLSearchParams.
   * @throws {WooCommerceUnauthorizedException} on HTTP 401/403
   * @throws {WooCommerceHttpResponseException} on HTTP 404 and other non-2xx (infrastructure/http — not exported)
   * @throws {WooCommerceNetworkException} on timeout or network error
   */
  get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T>;
}
```

---

### Step 4 — Extend HTTP client
**File:** `src/infrastructure/http/woocommerce-http-client.ts`

Add `implements IWooCommerceHttpClient` to the class declaration.

**a) Query params on `get()`**
```typescript
async get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T>
```
URL construction — handles paths that already contain `?` (tester uses `/wp-json/wc/v3/products?per_page=1`):
```typescript
const qs = params
  ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  : '';
const separator = qs ? (path.includes('?') ? '&' : '?') : '';
const url = `${this.siteUrl}${path}${separator}${qs}`;
```

**b) Retry loop**
Rename `_retryConfig` → `retryConfig`; store and use it:
```typescript
private readonly retryConfig: RetryConfig;
constructor(siteUrl, consumerKey, consumerSecret, retryConfig?: Partial<RetryConfig>) {
  this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
}
```
Default: `{ maxRetries: 3, initialDelayMs: 500, backoffMultiplier: 2, maxDelayMs: 8000 }`

Loop: retry on 429 and 5xx only; never retry on 401, 403, 404.
Delay: `Math.min(initialDelayMs * backoffMultiplier^attempt, maxDelayMs)`.

**c) Typed exceptions — transport layer only**

The HTTP client does NOT throw `WooCommerceResourceNotFoundException` — it has no entity context. Exception mapping:
- 401/403 → `WooCommerceUnauthorizedException` (do not retry)
- 404 → `WooCommerceHttpResponseException(404, message)` (do not retry) — adapter converts to domain exception
- 429/5xx → retry; after retries exhausted → `WooCommerceNetworkException`
- AbortError → `WooCommerceNetworkException('Request timed out', error as Error)`
- Other non-2xx → `WooCommerceHttpResponseException(statusCode, message)` after retries

**No `getAll()`.** Single-page fetch only. Pagination loop lives in the caller.

---

### Step 5 — WooCommerce API types
**File:** `src/infrastructure/adapters/product-master/woocommerce-product.types.ts`

```typescript
/**
 * WooCommerce Product API Types
 *
 * TypeScript shapes for WooCommerce REST API v3 product-related responses.
 * Used exclusively by WooCommerceProductMasterAdapter and
 * WooCommerceProductMapper to deserialize WC API payloads.
 *
 * All fields are declared as optional where the WC API may omit them
 * (e.g. `price` is empty string on variable products, `meta_data` may be
 * absent on minimal-scope API keys).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-master
 */
export interface WooCommerceProduct {
  id?: number;
  name?: string;
  slug?: string;
  type?: 'simple' | 'variable' | 'grouped' | 'external';
  status?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  description?: string;
  categories?: Array<{ id: number; name: string; slug: string }>;
  images?: Array<{ id: number; src: string; alt: string }>;
  attributes?: Array<{ id: number; name: string; position: number; options: string[] }>;
  variations?: number[];
  weight?: string;
  date_created?: string;
  date_modified?: string;
  meta_data?: WooCommerceMetaEntry[];
}

export interface WooCommerceProductVariation {
  id?: number;
  sku?: string;
  price?: string;
  regular_price?: string;
  attributes?: Array<{ id: number; name: string; option: string }>;
  image?: { id: number; src: string } | null;
  weight?: string;
  date_created?: string;
  date_modified?: string;
  meta_data?: WooCommerceMetaEntry[];
}

export interface WooCommerceProductCategory {
  id?: number;
  name?: string;
  slug?: string;
  parent?: number;
  count?: number;
}

export interface WooCommerceMetaEntry {
  id?: number;
  key: string;
  value: unknown;
}
```

---

### Step 6 — Mapper interface and types

**File:** `src/infrastructure/mappers/woocommerce-product.mapper.interface.ts`
```typescript
/**
 * WooCommerce Product Mapper Interface
 *
 * Contract for mapping WooCommerce REST API product and variation shapes
 * to the OpenLinker unified Product and ProductVariant domain entities.
 * Separated from the implementation so WooCommerceProductMasterAdapter
 * can depend on the interface, enabling clean mocking in unit tests.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 * @see {@link WooCommerceProductMapper} for the implementation
 */
import type { Product, ProductVariant } from '@openlinker/core/products';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
} from '../adapters/product-master/woocommerce-product.types';

export interface IWooCommerceProductMapper {
  mapProduct(product: WooCommerceProduct): Omit<Product, 'id'>;
  mapVariation(
    variation: WooCommerceProductVariation,
    productId: string,
  ): Omit<ProductVariant, 'id'>;
}
```

**File:** `src/infrastructure/mappers/woocommerce-product.mapper.types.ts`
```typescript
/**
 * WooCommerce Product Mapper Types
 *
 * Construction-time options for WooCommerceProductMapper. Kept in a separate
 * file per docs/engineering-standards.md § Type Definitions in Separate Files.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 */

export interface WooCommerceProductMapperOptions {
  /** ISO 4217 currency code assigned to every product (e.g. 'PLN'). null when absent. */
  currency?: string;
}
```

---

### Step 7 — Mapper implementation
**File:** `src/infrastructure/mappers/woocommerce-product.mapper.ts`

```typescript
/**
 * WooCommerce Product Mapper
 *
 * Maps WooCommerce REST API v3 product and variation payloads to the
 * OpenLinker unified Product and ProductVariant domain entities.
 *
 * Description is stored as raw HTML — no stripping. This matches the
 * PrestaShop pattern; outbound adapters (e.g. Allegro) sanitise on publish
 * via sanitizeAllegroDescription.
 *
 * Price parsing uses Number.isFinite to correctly preserve zero-price
 * products (free downloads, giveaways) — `parseFloat('0') || null` would
 * incorrectly discard them.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 * @implements {IWooCommerceProductMapper}
 */
```

`WooCommerceProductMapper implements IWooCommerceProductMapper`

**`mapProduct(p)`:**

| OL field | Source | Notes |
|---|---|---|
| `name` | `p.name ?? ''` | |
| `sku` | `p.sku || null` | |
| `price` | `parsePrice(p.price) ?? null` | WC returns prices as strings; zero is valid |
| `currency` | `options.currency ?? null` | per-connection setting |
| `description` | `p.description || null` | **raw HTML, no stripping** |
| `images` | `p.images?.map(i => i.src) ?? null` | |
| `categories` | `p.categories?.map(c => String(c.id)) ?? []` | external IDs as strings |
| `weight` | `parseOptionalNumber(p.weight)` | zero is valid (digital goods) |
| `createdAt` | `p.date_created ? new Date(p.date_created) : undefined` | guard undefined |
| `updatedAt` | `p.date_modified ? new Date(p.date_modified) : undefined` | guard undefined |

**`mapVariation(v, productId)`:**

| OL field | Source | Notes |
|---|---|---|
| `productId` | param | |
| `sku` | `v.sku || null` | |
| `price` | `parsePrice(v.price) ?? undefined` | zero is valid |
| `weight` | `parseOptionalNumber(v.weight)` | zero is valid |
| `attributes` | `Record<name, option>` from `v.attributes` | `null` when empty/absent |
| `ean` | `normalizeToEan13(extractMeta(v.meta_data ?? [], ...EAN_KEYS))` | |
| `gtin` | `normalizeBarcode(extractMeta(v.meta_data ?? [], ...GTIN_KEYS))` | |

**Private helpers** — both use `Number.isFinite` to correctly preserve zero values (zero price = free product, zero weight = digital goods). `parseFloat(x) || null/undefined` would silently discard `'0'`.

```typescript
/** Returns the numeric value (including 0) or null. Used for price fields. */
private parsePrice(value?: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Returns the numeric value (including 0) or undefined. Used for weight fields. */
private parseOptionalNumber(value?: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}
```

`parsePrice` used for `price` fields (`?? null` for product, `?? undefined` for variation).
`parseOptionalNumber` used for `weight` on both product and variation.

**GTIN/EAN meta key priority:**
```typescript
const EAN_KEYS  = ['_ean', 'ean', '_gtin', 'gtin', '_barcode', 'barcode'] as const;
const GTIN_KEYS = ['_gtin', 'gtin', '_ean', 'ean', '_wc_gtin', 'hwp_product_gtin', '_barcode'] as const;
```

**Private `extractMeta` helper:**
```typescript
private extractMeta(metaData: WooCommerceMetaEntry[], ...keys: string[]): string | null {
  for (const key of keys) {
    const entry = metaData.find(m => m.key === key);
    if (typeof entry?.value === 'string' && entry.value.trim().length > 0) {
      return entry.value.trim();
    }
  }
  return null;
}
```

---

### Step 8 — Adapter
**File:** `src/infrastructure/adapters/product-master/woocommerce-product-master.adapter.ts`

```typescript
/**
 * WooCommerce Product Master Adapter
 *
 * Implements the read half of ProductMasterPort for WooCommerce REST API v3.
 * Write methods (createProduct, updateProduct, deleteProduct,
 * upsertProductVariant, assignCategories) throw WooCommerceNotSupportedException
 * and are deferred to #879.
 *
 * Pagination: single-page fetch consistent with PrestashopProductMasterAdapter.
 * The caller (master-product-sync-all.handler.ts) drives the loop via
 * listExternalIds({ limit, offset }). Offset is translated to WC page numbers
 * using page = Math.floor(offset / perPage) + 1.
 *
 * 404 handling: WooCommerceHttpClient throws WooCommerceHttpResponseException(404)
 * for not-found responses. Adapter catches and rethrows as
 * WooCommerceResourceNotFoundException with full entity context (entityType,
 * OL internal ID, connectionId) — consistent with PrestashopResourceNotFoundException
 * at the PS adapter boundary.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-master
 * @implements {ProductMasterPort}
 */
```

**Private `fetchAllPages<T>` helper** — used by `getCategories` and `getProductVariants` where the adapter contract says "return all items" and the caller must not loop. Keeps `IWooCommerceHttpClient.get()` single-page (consistent with codebase pattern); exhaustion is the adapter's responsibility.

```typescript
// Safety cap: 500 pages × 100 items = 50,000 items max per single "return all" call.
// A real WC store won't hit this; the guard protects against a pathological API
// that always returns perPage items (e.g. a buggy WC plugin), which would otherwise
// loop forever. Mirrors the MAX_PAGES guard in master-product-sync-all.handler.ts.
private static readonly FETCH_ALL_MAX_PAGES = 500;

/**
 * Exhausts all WC REST API pages for a given path and returns a flat array.
 * Used only for methods whose contract is "return all" (getCategories, getProductVariants).
 * For externally-paged methods (listExternalIds, getProducts) the caller drives the loop.
 */
private async fetchAllPages<T>(
  path: string,
  params?: Record<string, string | number | boolean>,
  perPage = 100,
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    this.logger.debug(
      `fetchAllPages: GET ${path} page=${page} per_page=${perPage} (connection: ${this.connection.id})`,
    );
    const batch = await this.httpClient.get<T[]>(path, { ...params, per_page: perPage, page });
    results.push(...batch);
    if (batch.length < perPage) break;
    if (page >= WooCommerceProductMasterAdapter.FETCH_ALL_MAX_PAGES) {
      this.logger.warn(
        `fetchAllPages: hit MAX_PAGES (${WooCommerceProductMasterAdapter.FETCH_ALL_MAX_PAGES}) for ${path} ` +
        `(connection: ${this.connection.id}) — catalog may be truncated`,
      );
      break;
    }
    page++;
  }
  return results;
}
```

Constructor takes `IWooCommerceHttpClient` (interface), not the concrete class:

```typescript
export class WooCommerceProductMasterAdapter implements ProductMasterPort {
  private readonly logger = new Logger(WooCommerceProductMasterAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly mapper: IWooCommerceProductMapper,
    private readonly connection: Connection,
  ) {}
```

#### `listExternalIds(filters?)`
Single-page fetch. Caller loops.
```typescript
this.logger.debug(
  `Listing external product IDs (connection: ${this.connection.id}, limit: ${String(filters?.limit)}, offset: ${String(filters?.offset)})`,
);
const perPage = filters?.limit ?? 100;
const page = filters?.offset !== undefined ? Math.floor(filters.offset / perPage) + 1 : 1;
const raw = await this.httpClient.get<Array<{ id: number }>>(
  '/wp-json/wc/v3/products',
  { _fields: 'id', per_page: perPage, page },
);
// Type-guard filter: skip objects with no id AND narrow type for String(r.id).
return raw
  .filter((r): r is { id: number } => r.id !== undefined && r.id !== null)
  .map(r => String(r.id));
```

#### `getProduct(productId)`
404 catch mirrors the pattern in `getProductVariants` — if WC deleted a product that OL has mapped, surface a domain exception rather than leaking `WooCommerceHttpResponseException` to the core sync service.
```typescript
this.logger.debug(`Getting product: ${productId} (connection: ${this.connection.id})`);
const externalIds = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
const mapping = externalIds.find(e => e.connectionId === this.connection.id);
if (!mapping) {
  throw new WooCommerceResourceNotFoundException(
    `Product not found: ${productId} (no mapping for connection ${this.connection.id})`,
    CORE_ENTITY_TYPE.Product, productId, this.connection.id,
  );
}
let p: WooCommerceProduct;
try {
  p = await this.httpClient.get<WooCommerceProduct>(`/wp-json/wc/v3/products/${mapping.externalId}`);
} catch (err) {
  if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
    throw new WooCommerceResourceNotFoundException(
      `WooCommerce product ${mapping.externalId} not found (deleted?)`,
      CORE_ENTITY_TYPE.Product, productId, this.connection.id,
    );
  }
  throw err;
}
return { ...this.mapper.mapProduct(p), id: productId };
```

#### `getProducts(filters?)`
Single-page fetch. Uses WC default `publish` when no `filters.status` provided.
```typescript
this.logger.debug(`Getting products with filters (connection: ${this.connection.id})`);
const params = this.buildWcParams(filters);
const products = await this.httpClient.get<WooCommerceProduct[]>('/wp-json/wc/v3/products', params);
if (products.length === 0) return [];

// Type-guard filter: skip objects with no id AND narrow the type so String(p.id)
// below is guaranteed number, not number | undefined. String(undefined) = 'undefined'
// would poison the identifier-mapping table.
const validProducts = products.filter(
  (p): p is WooCommerceProduct & { id: number } => p.id !== undefined && p.id !== null,
);

const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
  validProducts.map(p => ({
    entityType: CORE_ENTITY_TYPE.Product,
    externalId: String(p.id),
    connectionId: this.connection.id,
  }))
);
return validProducts
  .map(p => {
    const internalId = idMap.get(`${String(p.id)}:${this.connection.id}`);
    if (!internalId) {
      this.logger.warn(`No internal ID for WC product ${String(p.id)}`);
      return null;
    }
    return { ...this.mapper.mapProduct(p), id: internalId };
  })
  .filter((p): p is Product => p !== null);
```

Private `buildWcParams(filters?)`:
- `filters.status === 'active'` → `{ status: 'publish' }`
- `filters.status === 'inactive'` → `{ status: 'draft' }`
- no `status` param when absent — WC default (`publish`) is correct
- `filters.query` → `search`
- `filters.categoryIds?.[0]` → `category`
- `filters.limit` → `per_page`; `filters.offset` → `page` (same formula as `listExternalIds`)

#### `getProductVariants(productId)`

404 handling pattern: wrap HTTP calls in `try/catch`; convert `WooCommerceHttpResponseException(404)` to `WooCommerceResourceNotFoundException` with full entity context.

```typescript
this.logger.debug(`Getting variants for product: ${productId} (connection: ${this.connection.id})`);
const externalIds = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
const mapping = externalIds.find(e => e.connectionId === this.connection.id);
if (!mapping) {
  throw new WooCommerceResourceNotFoundException(
    `Product not found: ${productId}`,
    CORE_ENTITY_TYPE.Product, productId, this.connection.id,
  );
}

const wcId = mapping.externalId;
let product: WooCommerceProduct;
try {
  product = await this.httpClient.get<WooCommerceProduct>(`/wp-json/wc/v3/products/${wcId}`);
} catch (err) {
  if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
    throw new WooCommerceResourceNotFoundException(
      `WooCommerce product ${wcId} not found (deleted?)`,
      CORE_ENTITY_TYPE.Product, productId, this.connection.id,
    );
  }
  throw err;
}

if (product.type !== 'variable' || !product.variations?.length) {
  // Simple product — deterministic synthetic variant (same convention as PrestaShop)
  const syntheticExternalId = `product:${wcId}`;
  const internalVariantId = await this.identifierMapping.getOrCreateInternalId(
    CORE_ENTITY_TYPE.ProductVariant, syntheticExternalId, this.connection.id,
    {
      parentEntityType: CORE_ENTITY_TYPE.Product,
      parentInternalId: productId,
      metadata: { variantExternalId: syntheticExternalId, synthetic: true },
    },
  );
  const price = product.price !== undefined ? this.parseVariantPrice(product.price) : undefined;
  return [{
    id: internalVariantId,
    productId,
    sku: product.sku || `product-${wcId}`,
    attributes: null,
    ean: null,
    gtin: null,
    price,
  }];
}

// Variable product — delete stale synthetic (safe no-op if absent)
await this.identifierMapping.deleteMapping(
  CORE_ENTITY_TYPE.ProductVariant, `product:${wcId}`, this.connection.id,
);

// Exhaust all pages — products with >100 variations exist (configurable products, apparel).
// fetchAllPages loops internally until WC returns a short page; no 100-item cap.
const variations = await this.fetchAllPages<WooCommerceProductVariation>(
  `/wp-json/wc/v3/products/${wcId}/variations`,
);

// Type-guard filter: skip variation objects with no id AND narrow type for downstream String(v.id).
const validVariations = variations.filter(
  (v): v is WooCommerceProductVariation & { id: number } => v.id !== undefined && v.id !== null,
);

const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
  validVariations.map(v => ({
    entityType: CORE_ENTITY_TYPE.ProductVariant,
    externalId: String(v.id),
    connectionId: this.connection.id,
    context: {
      parentEntityType: CORE_ENTITY_TYPE.Product,
      parentInternalId: productId,
      metadata: { variantExternalId: String(v.id) },
    },
  }))
);
return validVariations
  .map(v => {
    const internalId = idMap.get(`${String(v.id)}:${this.connection.id}`);
    if (!internalId) {
      this.logger.warn(`No internal ID for WC variation ${String(v.id)}`);
      return null;
    }
    return { ...this.mapper.mapVariation(v, productId), id: internalId };
  })
  .filter((v): v is ProductVariant => v !== null);
```

Private `parseVariantPrice` helper (inline in adapter for the synthetic-variant path, consistent with `parseProductPrice` in the PS adapter). Intentionally not delegated to the mapper — the synthetic variant is built directly in the adapter without going through `mapper.mapVariation()`, so the adapter needs its own price-parsing utility for this one path. Logic is identical to `parseOptionalNumber` in the mapper; if it ever diverges, that is a bug.
```typescript
// Inline price parse for synthetic variant — mirrors parseOptionalNumber in the mapper.
// Uses Number.isFinite so zero-price products (free downloads) are correctly preserved;
// `parseFloat('0') || undefined` would silently discard them.
private parseVariantPrice(value?: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}
```

#### `getProductCategories(productId)`
Uses `_fields=id,categories` to fetch only the two fields needed, avoiding the full product body fetch (name, description, images, price, meta_data, etc.). Same `_fields` technique as PS's `display: '[id]'` for ID-only listing. Entry logged for observability. Same 404 catch pattern as `getProduct`.
```typescript
this.logger.debug(`Getting categories for product: ${productId} (connection: ${this.connection.id})`);
const externalIds = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
const mapping = externalIds.find(e => e.connectionId === this.connection.id);
if (!mapping) {
  throw new WooCommerceResourceNotFoundException(
    `Product not found: ${productId}`,
    CORE_ENTITY_TYPE.Product, productId, this.connection.id,
  );
}
// Request only the fields we need — avoids fetching the full product body.
let product: Pick<WooCommerceProduct, 'categories'>;
try {
  product = await this.httpClient.get<Pick<WooCommerceProduct, 'categories'>>(
    `/wp-json/wc/v3/products/${mapping.externalId}`,
    { _fields: 'id,categories' },
  );
} catch (err) {
  if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
    throw new WooCommerceResourceNotFoundException(
      `WooCommerce product ${mapping.externalId} not found (deleted?)`,
      CORE_ENTITY_TYPE.Product, productId, this.connection.id,
    );
  }
  throw err;
}
return (product.categories ?? []).map(c => ({ id: String(c.id), name: c.name }));
```

#### `getCategories()` (optional port method)
```typescript
this.logger.debug(`Getting all categories (connection: ${this.connection.id})`);
// Exhaust all pages — large multi-category WC stores can exceed 100 categories.
const raw = await this.fetchAllPages<WooCommerceProductCategory>(
  '/wp-json/wc/v3/products/categories',
);
// Type-guard filter: skip category objects with no id AND narrow type so String(c.id)
// is guaranteed number, not number | undefined. Same pattern as validProducts/validVariations.
return raw
  .filter((c): c is WooCommerceProductCategory & { id: number } => c.id !== undefined && c.id !== null)
  .map(c => ({
    id: String(c.id),
    name: c.name ?? '',
    parentId: c.parent ? String(c.parent) : undefined,
  }));
```

#### `searchProducts(query, filters?)`
```typescript
this.logger.debug(`Searching products: "${query}" (connection: ${this.connection.id})`);
return this.getProducts({ ...filters, query });
```

#### Write stubs
```typescript
createProduct(_product: ProductCreate): Promise<Product> {
  return Promise.reject(
    new WooCommerceNotSupportedException('createProduct', 'Use the WooCommerce admin or #879'),
  );
}
// same pattern for updateProduct, deleteProduct, upsertProductVariant, assignCategories
```

---

### Step 9 — Wire into plugin
**File:** `src/woocommerce-plugin.ts`

1. Add `'ProductMaster'` to `woocommerceAdapterManifest.supportedCapabilities`.
2. Make `createCapabilityAdapter` async. Guard `credentialsRef` explicitly before use:

```typescript
async createCapabilityAdapter<T>(connection: Connection, capability: string, host: HostServices): Promise<T> {
  if (!connection.credentialsRef) {
    return Promise.reject(
      new WooCommerceConfigException(
        `Connection ${connection.id} is missing credentialsRef — save credentials before using this capability.`,
        connection.id,
      )
    );
  }
  const credentials = await host.credentialsResolver.get<WooCommerceCredentials>(connection.credentialsRef);
  const config = (connection.config ?? {}) as WooCommerceConnectionConfig;
  const httpClient = new WooCommerceHttpClient(config.siteUrl, credentials.consumerKey, credentials.consumerSecret);
  const mapper = new WooCommerceProductMapper({});
  const productMaster = new WooCommerceProductMasterAdapter(
    httpClient, host.identifierMapping, mapper, connection,
  );
  try {
    return Promise.resolve(
      dispatchCapability<T>(capability, { ProductMaster: () => productMaster }, WOOCOMMERCE_BRAND)
    );
  } catch (err) {
    return Promise.reject(err as Error);
  }
}
```

Add imports: `WooCommerceProductMapper`, `WooCommerceProductMasterAdapter`, `WooCommerceCredentials`, `WooCommerceConnectionConfig`, `WooCommerceConfigException`.

---

### Step 10 — Update barrel
**File:** `src/index.ts`

```typescript
// Domain exceptions — 5 domain-level exceptions exported for consumers (e.g. connection tester, sync services)
export { WooCommerceNotSupportedException } from './domain/exceptions/woocommerce-not-supported.exception';
export { WooCommerceConfigException } from './domain/exceptions/woocommerce-config.exception';
export { WooCommerceResourceNotFoundException } from './domain/exceptions/woocommerce-resource-not-found.exception';
export { WooCommerceUnauthorizedException } from './domain/exceptions/woocommerce-unauthorized.exception';
export { WooCommerceNetworkException } from './domain/exceptions/woocommerce-network.exception';
// WooCommerceHttpResponseException is intentionally NOT exported — it is a transport-level
// implementation detail of WooCommerceHttpClient, lives in infrastructure/http/, and must
// never escape the adapter layer.
```

---

### Step 11 — Unit tests

**`woocommerce-http-client.spec.ts`** (extend existing suite — 4 error-case tests need rewriting for typed exceptions):
- `get()` with params: URL correctly serialized; path with existing `?` uses `&` separator
- Retry: retries on 429 and 500; does NOT retry on 401, 404; stops at `maxRetries`
- 401/403 → throws `WooCommerceUnauthorizedException`
- 404 → throws `WooCommerceHttpResponseException` with `statusCode === 404`
- AbortError → throws `WooCommerceNetworkException`
- `maxRetries: 0`: single attempt, no retry (as the connection tester uses)

**`woocommerce-product.mapper.spec.ts`** (new):
- `mapProduct`: name, sku, price string→number (zero preserved: `'0'` → `0`, not `null`), description raw HTML preserved, images, categories as string IDs, `createdAt`/`updatedAt` from ISO strings
- `mapProduct`: missing `date_created` → `createdAt` is `undefined` (not `Invalid Date`)
- `mapProduct`: `weight: '0'` → `0` (not `undefined`) — zero weight is valid for digital goods
- `mapVariation`: sku, attributes Record (empty/absent → null), EAN from `_ean` key, GTIN from `_gtin` key, missing meta → null
- `mapVariation`: price `'0'` → `0`; weight `'0'` → `0`
- EAN key priority: `_ean` wins over `_gtin` when both present

**`woocommerce-product-master.adapter.spec.ts`** (new — mock `IWooCommerceHttpClient`, not concrete class):
- `getProduct`: calls correct endpoint, returns product with internal ID
- `getProduct`: throws `WooCommerceResourceNotFoundException` when no identifier mapping
- `getProduct`: `WooCommerceHttpResponseException(404)` from HTTP → re-thrown as `WooCommerceResourceNotFoundException`
- `getProducts`: filters products with undefined/null id before batch mapping
- `getProducts`: batch maps with composite key `externalId:connectionId`; empty response → `[]`
- `getProducts`: `status:'active'` → `status:'publish'`; no status param when filter absent
- `listExternalIds`: returns string array; filters out objects with undefined id; offset→page translation correct
- `getProductVariants` simple: synthetic variant with `syntheticExternalId='product:{wcId}'`; zero price preserved
- `getProductVariants` variable: calls `fetchAllPages` for `/variations`; filters undefined-id variations; batch maps; calls `deleteMapping` for stale synthetic
- `getProductVariants` variable: two-page scenario — `fetchAllPages` loops correctly and returns combined results
- `getProductVariants` variable: `fetchAllPages` hits MAX_PAGES guard → warns and returns partial results (not infinite loop)
- `getProductVariants`: `WooCommerceHttpResponseException(404)` from HTTP → re-thrown as `WooCommerceResourceNotFoundException`
- `getProductCategories`: `WooCommerceHttpResponseException(404)` from HTTP → re-thrown as `WooCommerceResourceNotFoundException`
- `getCategories`: uses `fetchAllPages`; maps id/name/parentId (parent=0 → undefined)
- `getCategories`: filters categories with undefined/null id before mapping — consistent with getProducts/getProductVariants
- `getCategories`: **three-page termination** — page 1 = 100 items, page 2 = 100 items, page 3 = 0 items → terminates correctly and returns all 200; confirms no early exit on coincidentally-full second page
- `getCategories`: MAX_PAGES guard logs warn and breaks without infinite loop
- `getProductCategories`: calls endpoint with `_fields=id,categories`; does NOT fetch full product body
- `searchProducts`: delegates to `getProducts` with `query` merged into filters — `searchProducts('term', { status: 'active' })` → `getProducts({ status: 'active', query: 'term' })`
- Write stubs: each rejects with `WooCommerceNotSupportedException`

---

## 5. Architecture Checklist

- ✅ All new code in `libs/integrations/woocommerce/` — zero core changes
- ✅ `ProductMasterPort`, `Product`, `ProductVariant`, `normalizeToEan13`, `normalizeBarcode` from `@openlinker/core/products`
- ✅ `IdentifierMappingPort`, `CORE_ENTITY_TYPE`, `Connection` from `@openlinker/core/identifier-mapping`
- ✅ `Logger` from `@openlinker/shared/logging`
- ✅ Adapter constructor takes `IWooCommerceHttpClient` (interface), not the concrete class — testable with mock transport
- ✅ One exception file per exception — consistent with PS integration naming convention
- ✅ `WooCommerceHttpResponseException` placed in `infrastructure/http/` (not `domain/exceptions/`) — HTTP status code is a transport concern; domain must not know about it
- ✅ `WooCommerceHttpResponseException` NOT exported from the barrel — internal transport detail, never escapes the adapter layer
- ✅ 404 handled consistently at the adapter boundary in `getProduct`, `getProductVariants`, and `getProductCategories` — all convert `WooCommerceHttpResponseException(404)` to `WooCommerceResourceNotFoundException` with entity context
- ✅ `parsePrice` / `parseOptionalNumber` / `parseVariantPrice` all use `Number.isFinite` — zero values (free products, zero-weight digital goods) correctly preserved
- ✅ `listExternalIds` filters objects with undefined `id` before mapping to strings
- ✅ `originalError` field on `WooCommerceNetworkException` — avoids shadowing native `Error.cause`
- ✅ `connection.credentialsRef` null-guarded with `WooCommerceConfigException` — consistent with `AllegroConfigException` pattern, not `NotSupportedException`
- ✅ `new Date()` guarded — `p.date_created ? new Date(p.date_created) : undefined`
- ✅ No NestJS decorators on adapter or mapper — plain classes
- ✅ Types in separate `*.types.ts`; mapper interface in separate `*.interface.ts`
- ✅ No `any`; `WooCommerceMetaEntry.value` is `unknown`, narrowed in `extractMeta`
- ✅ Map key always `${externalId}:${connectionId}` — no fallback needed
- ✅ `fetchAllPages<T>` private helper exhausts all WC pages for `getCategories` and `getProductVariants` — no 100-item cap
- ✅ `fetchAllPages` has `FETCH_ALL_MAX_PAGES = 500` guard — bounded loop, warns and breaks on pathological API behavior; mirrors `master-product-sync-all.handler.ts`
- ✅ `fetchAllPages` logs `debug` per page and `warn` on MAX_PAGES — observable behavior in production
- ✅ `getProducts` and `getProductVariants` filter undefined/null `id` before `batchGetOrCreateInternalIds` — consistent with `listExternalIds`; prevents `'undefined'` from entering identifier-mapping table
- ✅ `getProductCategories` uses `_fields=id,categories` — fetches only needed fields, not full product body
- ✅ `getCategories` filters undefined/null category `id` before mapping — consistent with `listExternalIds`, `getProducts`, `getProductVariants`
- ✅ All public adapter methods log `debug` at entry point — consistent with PrestaShop adapter observability pattern
- ✅ All `id`-undefined filters use TypeScript type-guard form `(x): x is T & { id: number } => ...` — matches `.filter((p): p is Product => ...)` pattern; eliminates residual `| undefined` in downstream `.map()` under strict mode
- ✅ `searchProducts` test covers delegation with merged filters
- ✅ Step numbers are sequential (1–11); no duplicate numbering
- ✅ No documented trade-offs remain — all limitations eliminated
- ✅ File headers on all new files (included in each step above)
- ✅ No migration required
