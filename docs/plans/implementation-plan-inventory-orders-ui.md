# Implementation Plan: Inventory & Orders UI (#89 + #90)

## Goal

Build inventory visibility and orders monitoring frontend screens, replacing the current placeholder pages with functional list + detail views backed by the existing read APIs (merged in PR #122).

## Classification

- **Layer**: Frontend (Interface)
- **Bounded Contexts**: Inventory, Orders
- **Pattern**: Replicates products/variants explorer (PR #124)

## Non-Goals

- No create/update/delete mutations (read-only views)
- No real-time updates or WebSocket subscriptions
- No new backend endpoints — consume existing `GET /inventory`, `GET /inventory/:id`, `GET /orders`, `GET /orders/:internalOrderId`

---

## Step-by-Step Implementation

### Step 1: Inventory Feature Module

**1a. Types** — `features/inventory/api/inventory.types.ts`
- `InventoryItem { id, productId, productVariantId, availableQuantity, reservedQuantity, locationId, updatedAt }`
- `InventoryFilters { productId?, productVariantId?, locationId? }`
- `InventoryPagination { limit?, offset? }`
- `PaginatedInventory { items, total, limit, offset }`

**1b. API client** — `features/inventory/api/inventory.api.ts`
- `InventoryApi` interface with `list()` and `getById()`
- `createInventoryApi(request)` factory
- Query string builder for filters + pagination

**1c. Query keys** — `features/inventory/api/inventory.query-keys.ts`
- `inventoryQueryKeys.all`, `.list(filters, pagination)`, `.detail(id)`

**1d. Query hooks** — `features/inventory/hooks/use-inventory-query.ts` and `use-inventory-item-query.ts`
- Standard TanStack Query wrappers

### Step 2: Inventory Pages

**2a. List page** — `pages/inventory/inventory-list-page.tsx`
- Columns: Product ID, Variant ID, Available Qty, Reserved Qty, Location, Updated, View link
- Filters via URL search params: productId, productVariantId, locationId
- Offset-based pagination (PAGE_SIZE = 20)
- All 4 states: loading, error, empty, data

**2b. Detail page** — `pages/inventory/inventory-detail-page.tsx`
- Detail list: all inventory item fields
- Back link to list

### Step 3: Inventory Route

**3a.** Update `app/routes/inventory.route.tsx` — replace placeholder with children (index + `:id`)

### Step 4: Orders Feature Module

**4a. Types** — `features/orders/api/orders.types.ts`
- `OrderSyncStatus { destinationConnectionId, status, syncedAt, externalOrderId, externalOrderNumber, error }`
- `OrderRecord { internalOrderId, customerId, sourceConnectionId, sourceEventId, orderSnapshot, syncStatus[], createdAt, updatedAt }`
- `OrderFilters { sourceConnectionId?, syncStatus?, customerId?, createdFrom?, createdTo? }`
- `OrderPagination { limit?, offset? }`
- `PaginatedOrders { items, total, limit, offset }`
- `OrderSyncStatusValue` union type

**4b. API client** — `features/orders/api/orders.api.ts`
- `OrdersApi` interface with `list()` and `getById()`
- `createOrdersApi(request)` factory

**4c. Query keys** — `features/orders/api/orders.query-keys.ts`

**4d. Query hooks** — `features/orders/hooks/use-orders-query.ts` and `use-order-query.ts`

### Step 5: Orders Pages

**5a. List page** — `pages/orders/orders-list-page.tsx`
- Columns: Order ID, Source Connection, Customer, Sync Status (badges), Created, View link
- Filters via URL: syncStatus, sourceConnectionId
- Status badges with appropriate tones (success=synced, warning=syncing, info=pending, error=failed)
- Offset-based pagination

**5b. Detail page** — `pages/orders/order-detail-page.tsx`
- Order metadata in detail list
- Sync status table showing per-destination status
- Order snapshot as formatted JSON

### Step 6: Orders Route

**6a.** Update `app/routes/orders.route.tsx` — replace placeholder with children (index + `:internalOrderId`)

### Step 7: Register API Modules

**7a.** Add `inventory` and `orders` to `ApiClient` interface and `createApiClient()` in `app/api/api-client.ts`

### Step 8: Update Navigation

**8a.** Update `app-shell.tsx` — change Inventory and Orders nav items from `state: 'planned'` to `state: 'live'`

### Step 9: Quality Gate

- `pnpm lint`, `pnpm type-check`, `pnpm test` — all must pass

---

## Risks

- None significant — pure frontend, follows established pattern, backend APIs already exist

## Testing Strategy

- Unit tests not strictly required for read-only pages (no complex logic), but can be added for query hooks if desired
- Manual testing via dev server recommended
