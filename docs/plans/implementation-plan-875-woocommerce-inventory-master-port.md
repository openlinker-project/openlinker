# Implementation Plan: WooCommerce InventoryMasterPort (#875)

## 1. Goal

Implement `InventoryMasterPort` for WooCommerce — per-variant stock read + write, variant-keyed.
Covers **User Story #3** in the spec (WC stock → Allegro offers).

**Layer:** Integration (`libs/integrations/woocommerce`)
**Base branch:** `879-woocommerce-product-master-write` (provides `put<T>` on HTTP client)
**No core port changes. No DB migration.**

**Non-goals:**
- WC reservation / soft-allocation — WC REST has no reserve-vs-available split
- Multi-warehouse / multi-location stock
- Real-time stock push — REST polling only at v1

---

## 2. WooCommerce REST API

```
GET  /wp-json/wc/v3/products/{id}                          — simple product stock
GET  /wp-json/wc/v3/products/{id}/variations               — all variations (paginated)
GET  /wp-json/wc/v3/products/{id}/variations/{var_id}      — single variation stock
PUT  /wp-json/wc/v3/products/{id}                          — update simple product stock
PUT  /wp-json/wc/v3/products/{id}/variations/{var_id}      — update variation stock
```

Stock fields on both product and variation objects:
- `stock_quantity`: `number | null` — null means stock not managed
- `manage_stock`: `boolean` — whether stock tracking is enabled
- `stock_status`: `'instock' | 'outofstock' | 'onbackorder'`

---

## 3. Design Decisions

| Decision | Resolution |
|---|---|
| Synthetic variant key | `product:{wcProductId}` — matches ProductMaster convention |
| `listInventory` simple products | One `Inventory` row, `variantId` = synthetic variant's internal ID |
| `listInventory` variable products | One `Inventory` row per variation, each `variantId` = variation's internal ID |
| `stock_quantity = null` | Maps to `quantity = 0` (stock tracking disabled → treat as 0) |
| `getInventory` on variable product | Returns the **first** `Inventory` row from `listInventory`. This matches the PrestaShop convention: `getInventory` is a best-effort aggregate — callers that need per-variant precision must use `listInventory`. Documented, not a bug. |
| `adjustInventory` — no `variantId`, variable product | Throw `WooCommerceNotSupportedException('adjustInventory without variantId on a variable product', ...)` — WC REST has no product-level stock for variable products; callers must specify a variant. |
| `adjustInventory` | Read current → compute absolute = current + delta → PUT. WC has no delta primitive. Non-atomic read-modify-write; documented limitation at v1. |
| `reserveInventory` / `releaseInventory` | Throw `WooCommerceNotSupportedException` — WC REST has no reservation concept |
| `getAvailableQuantity` | Delegates to `getInventory` → returns `inventory.available` |
| Mapper | Module-level private functions in adapter file (simpler than PS; no dedicated mapper class needed) |
| Identifier resolution | Same pattern as ProductMaster: `identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId)` to resolve internal → external |
| `fetchAllPages` shared utility | `fetchAllPages` is `private` on `WooCommerceProductMasterAdapter` and cannot be called from the inventory adapter. Extract it to `infrastructure/utils/woocommerce-utils.ts` alongside `normGmt` so both adapters can import it. |
| Inventory external ID key format | `'stock:{wcId}'` for simple products, `'stock-var:{variationId}'` for variations. These keys are OL-internal — never sent to WC — and exist purely to generate stable `ol_inventory_*` internal IDs via `getOrCreateInternalId`. They are connection-scoped so two WC connections mapping the same product each get their own rows. |

---

## 4. File Plan

### New files

```
libs/integrations/woocommerce/src/
└── infrastructure/
    ├── utils/
    │   ├── woocommerce-utils.ts               NEW — create fresh (normGmt lives in #876 which is
    │   │                                           a sibling branch, not present here)
    │   │                                           Contains: fetchAllPages<T> + FETCH_ALL_MAX_PAGES
    │   └── __tests__/
    │       └── woocommerce-utils.spec.ts      NEW — unit tests for fetchAllPages
    └── adapters/
        └── inventory-master/
            ├── woocommerce-inventory-master.adapter.ts    NEW — WooCommerceInventoryMasterAdapter
            └── __tests__/
                └── woocommerce-inventory-master.adapter.spec.ts  NEW — unit tests
```

### Modified files

```
infrastructure/adapters/product-master/
  woocommerce-product.types.ts        ADD stock fields: stock_quantity, manage_stock,
                                          stock_status on WooCommerceProduct and
                                          WooCommerceProductVariation

infrastructure/adapters/product-master/
  woocommerce-product-master.adapter.ts  CHANGE private fetchAllPages → import exported
                                             fetchAllPages from infrastructure/utils/woocommerce-utils.ts
                                             (remove private method, delete FETCH_ALL_MAX_PAGES constant)

woocommerce-plugin.ts                 ADD 'InventoryMaster' to supportedCapabilities
                                          wire WooCommerceInventoryMasterAdapter in
                                          createCapabilityAdapter dispatch table

__tests__/woocommerce-plugin.spec.ts  ADD InventoryMaster capability test
```

---

## 5. Stock Type Additions to `woocommerce-product.types.ts`

Add to both `WooCommerceProduct` and `WooCommerceProductVariation`:

```typescript
stock_quantity: number | null;  // null = stock tracking disabled (treat as 0)
manage_stock: boolean;
stock_status: string;           // 'instock' | 'outofstock' | 'onbackorder'
```

---

## 6. `fetchAllPages` — New Shared Utility (`infrastructure/utils/woocommerce-utils.ts`)

**Create as a new file** — `normGmt` (from #876) lives in a sibling branch not present here. This file contains only `fetchAllPages` for now; #876 will add `normGmt` when both branches eventually converge on main.

`WooCommerceProductMasterAdapter` is updated to remove its private `fetchAllPages` method and `FETCH_ALL_MAX_PAGES` constant, importing from this new shared location instead.

```typescript
/**
 * Exhausts a paginated WC REST endpoint, collecting all items.
 * Safety cap: FETCH_ALL_MAX_PAGES pages × per_page items to prevent runaway iteration.
 */
export const FETCH_ALL_MAX_PAGES = 500;

export async function fetchAllPages<T>(
  path: string,
  httpClient: IWooCommerceHttpClient,
  logger: Logger,
  perPage = 100,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= FETCH_ALL_MAX_PAGES; page++) {
    const items = await httpClient.get<T[]>(path, { per_page: perPage, page });
    all.push(...items);
    if (items.length < perPage) break;
    if (page >= FETCH_ALL_MAX_PAGES) {
      logger.warn(`fetchAllPages: hit MAX_PAGES (${FETCH_ALL_MAX_PAGES}) for ${path} — truncating`);
      break;
    }
  }
  return all;
}
```

---

## 7. `WooCommerceInventoryMasterAdapter` — Complete Specification

```typescript
// Imports:
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
// (matches WooCommerceProductMasterAdapter line 33 — same type from HostServices.identifierMapping)

export class WooCommerceInventoryMasterAdapter implements InventoryMasterPort {
  private readonly logger = new Logger(WooCommerceInventoryMasterAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,  // NOT IIdentifierMappingService
    private readonly connection: Connection,
  ) {}
```

### `listInventory(productId: string): Promise<Inventory[]>`

1. Resolve internal `productId` → WC external product ID:
   ```typescript
   const externalIds = await identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
   const mapping = externalIds.find(e => e.connectionId === connection.id);
   if (!mapping) {
     throw new WooCommerceResourceNotFoundException(
       `Product ${productId} is not mapped for connection ${connection.id}`,
       'Product', productId, connection.id,
     );
   }
   const wcId = Number(mapping.externalId);
   ```
2. GET `/wp-json/wc/v3/products/{wcId}`
3. **Simple product** (`product.type !== 'variable'`):
   - `syntheticExternalId = 'product:{wcId}'`
   - `variantInternalId = await identifierMapping.getOrCreateInternalId(CORE_ENTITY_TYPE.ProductVariant, syntheticExternalId, connection.id, { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId })`
   - `inventoryInternalId = await identifierMapping.getOrCreateInternalId(CORE_ENTITY_TYPE.Inventory, 'stock:{wcId}', connection.id, { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId })`
   - Return `[mapToInventory(product.stock_quantity, productId, variantInternalId, inventoryInternalId)]`
4. **Variable product** (`product.type === 'variable'`):
   - Fetch all variations via `fetchAllPages<WooCommerceProductVariation>('/wp-json/wc/v3/products/{wcId}/variations', httpClient, logger)` (from `infrastructure/utils/woocommerce-utils.ts`)
   - **Batch** resolve variant internal IDs (mirrors ProductMaster pattern):
     ```typescript
     const variantIdMap = await identifierMapping.batchGetOrCreateInternalIds(
       variations.map(v => ({
         entityType: CORE_ENTITY_TYPE.ProductVariant,
         externalId: String(v.id),
         connectionId: connection.id,
         context: { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
       }))
     ); // Map<externalId, internalId>
     ```
   - **Batch** resolve inventory internal IDs (same pattern — avoids N sequential async calls):
     ```typescript
     const inventoryIdMap = await identifierMapping.batchGetOrCreateInternalIds(
       variations.map(v => ({
         entityType: CORE_ENTITY_TYPE.Inventory,
         externalId: `stock-var:${v.id}`,
         connectionId: connection.id,
         context: { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
       }))
     );
     ```
   - Return `variations.map(v => mapToInventory(v.stock_quantity, productId, variantIdMap.get(String(v.id))!, inventoryIdMap.get(`stock-var:${v.id}`)!))`

### `getInventory(productId: string, locationId?: string): Promise<Inventory>`

1. `rows = await listInventory(productId)`
2. If `locationId` provided: filter by `locationId` (no-op for WC — always `undefined`)
3. Return `rows[0]`
   - Simple products have exactly one row → unambiguous
   - Variable products have one row per variation → returns the first variation's row. This is a documented best-effort aggregate consistent with `PrestashopInventoryMasterAdapter`; callers that need per-variant precision must use `listInventory` directly
4. Throw `WooCommerceResourceNotFoundException` if `rows` is empty

### `getAvailableQuantity(productId: string, locationId?: string): Promise<number>`

```typescript
const inv = await this.getInventory(productId, locationId);
return inv.available;
```

### `adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory>`

WC has no delta endpoint — must use read-current → compute → write (non-atomic, documented limitation):

1. Resolve `productId` → `wcId` (same connection-filtered pattern as `listInventory`):
   ```typescript
   const externalIds = await identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
   const mapping = externalIds.find(e => e.connectionId === connection.id);
   if (!mapping) {
     throw new WooCommerceResourceNotFoundException(
       `Product ${productId} is not mapped for connection ${connection.id}`,
       'Product', productId, connection.id,
     );
   }
   const wcId = Number(mapping.externalId);
   ```
2. GET `/wp-json/wc/v3/products/{wcId}` to determine `product.type`
3. **If variable product AND `adjustment.variantId` is absent:**
   ```typescript
   throw new WooCommerceNotSupportedException(
     'adjustInventory without variantId on a variable product',
     'Specify adjustment.variantId to target a specific variation.',
   );
   ```
4. **If `adjustment.variantId` provided:** resolve variant internal ID → `wcVariationId`:
   ```typescript
   const variantExternalIds = await identifierMapping.getExternalIds(
     CORE_ENTITY_TYPE.ProductVariant, adjustment.variantId,
   );
   const variantMapping = variantExternalIds.find(e => e.connectionId === connection.id);
   if (!variantMapping) {
     throw new WooCommerceResourceNotFoundException(
       `Variant ${adjustment.variantId} is not mapped for connection ${connection.id}`,
       'ProductVariant', adjustment.variantId, connection.id,
     );
   }
   const wcVariationId = Number(variantMapping.externalId);
   ```
   Fetch current stock from `GET /wp-json/wc/v3/products/{wcId}/variations/{wcVariationId}`
5. **If simple product:** use `product.stock_quantity` already fetched in step 2
6. `newQuantity = Math.max(0, parseStockQuantity(current) + adjustment.quantity)`
   — Clamp to 0: stock cannot be physically negative; mirrors `parseStockQuantity`'s own guard and prevents sending invalid state to WC when delta exceeds current quantity
7. PUT `{ stock_quantity: newQuantity, manage_stock: true }` to the correct endpoint (product or variation)
8. Resolve `variantId` (internal) and `inventoryId` for the return value — idempotent, returns existing mapping:
   ```typescript
   // Simple product:
   const variantId = await identifierMapping.getOrCreateInternalId(
     CORE_ENTITY_TYPE.ProductVariant, `product:${wcId}`, connection.id,
     { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
   );
   const inventoryId = await identifierMapping.getOrCreateInternalId(
     CORE_ENTITY_TYPE.Inventory, `stock:${wcId}`, connection.id,
     { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
   );

   // Variation:
   const variantId = adjustment.variantId; // already internal OL ID
   const inventoryId = await identifierMapping.getOrCreateInternalId(
     CORE_ENTITY_TYPE.Inventory, `stock-var:${wcVariationId}`, connection.id,
     { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
   );
   ```
9. Return `mapToInventory(newQuantity, productId, variantId, inventoryId)`

### `reserveInventory` / `releaseInventory`

```typescript
// reserveInventory:
throw new WooCommerceNotSupportedException(
  'reserveInventory',
  'WooCommerce REST API does not expose inventory reservation. Use adjustInventory for absolute stock changes.',
);

// releaseInventory:
throw new WooCommerceNotSupportedException(
  'releaseInventory',
  'WooCommerce REST API does not expose inventory reservation. Use adjustInventory for absolute stock changes.',
);
```

---

## 8. Module-level mapping helpers (not exported)

```typescript
function parseStockQuantity(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return Math.max(0, Number(raw));
}

function mapToInventory(
  stockQuantity: number | null | undefined,
  productId: string,
  variantId: string,
  inventoryId: string,
): Inventory {
  const quantity = parseStockQuantity(stockQuantity);
  return {
    id: inventoryId,
    productId,
    variantId,
    locationId: undefined,   // WC is single-location at v1
    quantity,
    reserved: 0,             // WC REST has no reservation concept
    available: quantity,     // available = quantity - reserved = quantity
    updatedAt: undefined,
  };
}
```

---

## 9. Plugin wiring additions

```typescript
// supportedCapabilities:
supportedCapabilities: ['ProductMaster', 'InventoryMaster'],

// createCapabilityAdapter dispatch table:
{
  ProductMaster: () => new WooCommerceProductMasterAdapter(...),
  InventoryMaster: () => new WooCommerceInventoryMasterAdapter(
    httpClient,
    host.identifierMapping,
    connection,
  ),
}
```

**No new scheduler task needed for inventory polling.**
`master.inventory.syncAll` is centrally registered in `apps/api/src/sync/application/services/scheduler.service.ts` with a dynamic `connectionFilter`:
```typescript
connectionFilter: async () =>
  (await integrationsService.listCapabilityAdapters({ capability: 'InventoryMaster' }))
    .map(a => a.connection)
```
Adding `'InventoryMaster'` to `supportedCapabilities` is sufficient — the central scheduler automatically discovers WC connections and dispatches `master.inventory.syncAll` jobs for them on the configured cadence (default `*/15 * * * *`, override via `OL_INVENTORY_SYNC_CRON`). This satisfies AC "visible in OL within a reasonable window" without any WC-specific scheduler code.

---

## 10. Test Coverage

### `infrastructure/utils/__tests__/woocommerce-utils.spec.ts`

| # | Case |
|---|---|
| 1 | `fetchAllPages` — single page (< perPage items) → returns items, stops after one call |
| 2 | `fetchAllPages` — multi-page → accumulates across pages, stops when page < perPage |
| 3 | `fetchAllPages` — hits MAX_PAGES cap → logs warning, returns accumulated items |
| 4 | `fetchAllPages` — empty first page → returns empty array |

---

### `woocommerce-inventory-master.adapter.spec.ts`

| # | Case |
|---|---|
| 1 | `listInventory` — simple product → single Inventory with synthetic variantId |
| 2 | `listInventory` — variable product → one Inventory per variation |
| 3 | `listInventory` — `stock_quantity = null` maps to `quantity = 0` |
| 4 | `listInventory` — `manage_stock = false` maps to `quantity = 0` |
| 5 | `listInventory` — product not found → `WooCommerceResourceNotFoundException` |
| 6 | `getInventory` — delegates to `listInventory`, returns first row |
| 7 | `getInventory` — empty list → `WooCommerceResourceNotFoundException` |
| 8 | `getAvailableQuantity` — returns `inventory.available` |
| 9 | `adjustInventory` — simple product: reads current, computes absolute, PUT |
| 10 | `adjustInventory` — variation: reads current, computes absolute, PUT to variations endpoint |
| 11 | `adjustInventory` — product not mapped → `WooCommerceResourceNotFoundException` |
| 12 | `adjustInventory` — variable product, no `variantId` → `WooCommerceNotSupportedException` |
| 13 | `reserveInventory` → `WooCommerceNotSupportedException` |
| 14 | `releaseInventory` → `WooCommerceNotSupportedException` |

---

## 11. Architecture Compliance

- [x] Adapter depends on `IWooCommerceHttpClient` interface — never concrete class
- [x] Adapter depends on `IdentifierMappingPort` (from `@openlinker/core/identifier-mapping`) — matches `HostServices.identifierMapping` type exactly
- [x] `fetchAllPages` specified in §6 (before adapter spec), created as NEW file `infrastructure/utils/woocommerce-utils.ts` — `normGmt` is in sibling branch #876, not present here; file contains only `fetchAllPages` for now
- [x] `fetchAllPages` has 4 dedicated unit tests in `infrastructure/utils/__tests__/woocommerce-utils.spec.ts` — public exported function, not indirectly tested via adapter
- [x] `listInventory` variable path batches both variant IDs and inventory IDs via `batchGetOrCreateInternalIds` — no N sequential async calls
- [x] Synthetic variant key `product:{id}` matches ProductMaster convention exactly
- [x] Inventory external ID keys (`stock:{id}`, `stock-var:{id}`) are OL-internal, connection-scoped, documented
- [x] `reserved = 0`, `available = quantity` — consistent with WC's flat stock model
- [x] `listInventory` + `adjustInventory` step 1: explicit `getExternalIds` + connection filter + `WooCommerceResourceNotFoundException` when no mapping found
- [x] `listInventory` simple product `context` includes `parentEntityType: CORE_ENTITY_TYPE.Product` — consistent with variable path and ProductMaster
- [x] `adjustInventory` read-before-write documented — WC has no delta primitive; non-atomic limitation accepted at v1
- [x] `adjustInventory` `newQuantity` clamped to `Math.max(0, ...)` — prevents negative stock when delta exceeds current quantity
- [x] `adjustInventory` step 8: `variantId` resolved for simple product (`getOrCreateInternalId` on synthetic key); `variantId = adjustment.variantId` for variation (already internal)
- [x] `adjustInventory` step 4: variant mapping also connection-filtered + null-checked before use
- [x] `adjustInventory` throws `WooCommerceNotSupportedException` for variable product without `variantId`
- [x] `reserveInventory` / `releaseInventory` throw `WooCommerceNotSupportedException(operation, alternative)` — correct two-arg constructor
- [x] `getInventory` on variable product returns first variation's row — documented behaviour consistent with PrestaShop
- [x] `stock_quantity = null` → `0` — defensively handles unmanaged stock
- [x] Logger on all public methods
- [x] No `any` types
- [x] 14 unit test cases covering all branches including edge cases
- [x] No WC-specific scheduler task — `master.inventory.syncAll` is centrally driven; `'InventoryMaster'` in `supportedCapabilities` is sufficient
- [x] **PR note:** Issue #875 architecture notes contain two typos — `WoocommerceInventoryMasterAdapter` (should be `WooCommerceInventoryMasterAdapter`) and path `src/inventory-master/` (should be `infrastructure/adapters/inventory-master/` per engineering standards). Plan uses the correct names.
