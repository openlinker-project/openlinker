# Implementation Plan: Products & Variants Explorer (#88)

## Goal

Build a frontend products and variants explorer page that provides catalog visibility for operators. Uses the products read API (merged in #121).

## Classification

**Frontend / Feature** — `apps/web/src/features/products/` + `apps/web/src/pages/products/`

## Non-Goals

- No product editing/creation (read-only explorer)
- No variant search page (separate future work)
- No offer mapping visibility (covered by #92)

---

## Backend API Available

| Endpoint | Description |
|---|---|
| `GET /products` | Paginated list, `?search=&limit=&offset=` |
| `GET /products/:id` | Detail with variants + external IDs |
| `GET /products/:productId/variants` | Paginated variants for a product |
| `GET /variants/search` | Cross-product variant search by SKU/EAN/GTIN |

## Implementation Steps

### Step 1 — Products Feature Module

Create `apps/web/src/features/products/`:

- **`api/products.types.ts`** — `Product`, `ProductVariant`, `ExternalIdMapping`, `PaginatedProducts`, `PaginatedProductVariants`, `ProductFilters`, `ProductPagination`
- **`api/products.api.ts`** — `ProductsApi` interface + `createProductsApi()` factory
- **`api/products.query-keys.ts`** — query key factory
- **`hooks/use-products-query.ts`** — list hook
- **`hooks/use-product-query.ts`** — detail hook

### Step 2 — Register in API Client

Add `products: ProductsApi` to `ApiClient` interface and wire in `createApiClient()`.

### Step 3 — Products List Page

`apps/web/src/pages/products/products-list-page.tsx`:
- Search input for name/SKU filtering
- Paginated DataTable with columns: Name, SKU, Price, Variants count (from detail? no — list doesn't include variants), Created
- View link to detail page
- All 4 states: loading, error, empty, data

### Step 4 — Product Detail Page

`apps/web/src/pages/products/product-detail-page.tsx`:
- Product metadata via `dl`/`dt`/`dd` pattern
- External IDs section
- Variants DataTable: SKU, EAN, GTIN, Attributes, External IDs
- Back to list link

### Step 5 — Routes & Navigation

- Update `products.route.tsx` with nested routes (index → list, `:id` → detail)
- Mark Products as `'live'` in `app-shell.tsx`

### Step 6 — Tests

- Products list page: loading, error, empty, data states
- Product detail page: loading, error, data with variants

### Step 7 — Quality Gate

`pnpm lint && pnpm type-check && pnpm test`

---

## Risks

- None significant — follows established patterns exactly (sync-jobs, connections)
