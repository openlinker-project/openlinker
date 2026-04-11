# Implementation Plan: Integration Tests for FE-Critical APIs

**Issue:** #80  
**Branch:** `80-integration-tests-fe-critical-apis`  
**Layer:** Interface / Infrastructure (API integration tests)

---

## 1. Goal

Add integration tests covering the backend contract that the FE depends on. Tests use real Postgres + Redis via Testcontainers (the established pattern in `apps/api/test/integration/`).

**Scope (from issue):**
- Auth — already covered (`auth.int-spec.ts`) ✅
- Connections — already covered (`connection-crud.int-spec.ts`) ✅
- Sync jobs read API — **missing**
- Diagnostics endpoints (connection diagnostics) — **missing**
- Onboarding — not a separate endpoint; covered by connection-crud ✅

Additional high-value APIs used by current FE (visible from controllers):
- Inventory read API — **missing**
- Orders read API — **missing**

**Non-goals:**
- Products/variants (deeper seeding complexity — defer)
- Listings, customers, cursors (nice-to-have — defer)
- Worker integration tests
- Webhook tests (already covered)

---

## 2. Research Findings

### Existing patterns
- **Harness:** `apps/api/test/integration/setup.ts` — `IntegrationTestHarness`, `getTestHarness()`, `resetTestHarness()`, `teardownTestHarness()` shared singleton pattern
- **Fixtures:** `apps/api/test/integration/fixtures/connection.fixtures.ts`
- **Helpers:** `test-database.helper.ts`, `test-connection.helper.ts`
- **Auth:** Tests use `POST /auth/login` to get a Bearer token — all protected routes need it
- **Reset:** Currently only truncates `identifier_mappings` + `connections` — must be extended

### Reset gap
`setup.ts reset()` only cleans connections + identifier_mappings. Tests for sync_jobs, inventory_items, and order_records need those tables truncated too. We'll extend `reset()` in `setup.ts`.

### ORM entities available for seeding
- `SyncJobOrmEntity` — `sync_jobs` table
- `InventoryItemOrmEntity` — `inventory_items` table (requires FK to `products` and optionally `product_variants`)
- `OrderRecordOrmEntity` — `order_records` table (no FK to connections — uses `sourceConnectionId` uuid column)
- `ProductOrmEntity` / `ProductVariantOrmEntity` — needed for inventory FK

### Auth token pattern
```ts
const response = await http.post('/auth/login').send({ username, password });
const token = response.body.access_token;
http.get('/some/route').set('Authorization', `Bearer ${token}`);
```

---

## 3. Implementation Steps

### Step 1 — Extend `reset()` in setup.ts
**File:** `apps/api/test/integration/setup.ts`  
Add truncations for all tables used by new tests: `sync_jobs`, `inventory_items`, `order_records`, `products`, `product_variants`, `users`.

**Acceptance:** `resetTestHarness()` leaves DB clean for all test suites.

---

### Step 2 — Add fixtures + helpers
**Files:**
- `apps/api/test/integration/fixtures/sync-job.fixtures.ts`
- `apps/api/test/integration/fixtures/inventory.fixtures.ts`
- `apps/api/test/integration/fixtures/order.fixtures.ts`
- `apps/api/test/integration/helpers/test-auth.helper.ts` — `loginAs(http, ds)` → Bearer token

**Acceptance:** Helpers seed valid rows and return seeded entities.

---

### Step 3 — Sync Jobs Read API test
**File:** `apps/api/test/integration/sync-jobs-read.int-spec.ts`

Endpoints:
- `GET /sync/jobs` — list with pagination + filters (status, connectionId, jobType)
- `GET /sync/jobs/:id` — detail + 404

**Scenarios:**
- Returns empty list when no jobs exist
- Returns seeded jobs with correct shape
- Filters by `status`, `connectionId`, `jobType`
- Pagination (`limit`, `offset`)
- Returns 404 for non-existent job ID
- Returns 401 without token

---

### Step 4 — Connection Diagnostics test
**File:** `apps/api/test/integration/connection-diagnostics.int-spec.ts`

Endpoint: `GET /connections/:id/diagnostics`

**Scenarios:**
- Returns diagnostics for active connection
- Returns 404 for non-existent connection
- Returns 401 without token

---

### Step 5 — Inventory Read API test
**File:** `apps/api/test/integration/inventory-read.int-spec.ts`

Endpoints:
- `GET /inventory` — list with filters
- `GET /inventory/:id` — detail + 404

**Scenarios:**
- Returns empty list
- Returns seeded inventory items
- Filter by `productId`, `productVariantId`, `locationId`
- Pagination
- 404 for non-existent item
- 401 without token

---

### Step 6 — Orders Read API test
**File:** `apps/api/test/integration/orders-read.int-spec.ts`

Endpoints:
- `GET /orders` — list with filters
- `GET /orders/:id` — detail + 404

**Scenarios:**
- Returns empty list
- Returns seeded orders
- Filter by `sourceConnectionId`, `syncStatus`
- Date range filters (`createdFrom`, `createdTo`)
- Pagination
- 404 for non-existent order
- 401 without token

---

## 4. Architecture Compliance

- All tests use `getTestHarness()` / `resetTestHarness()` / `teardownTestHarness()` — no new infrastructure
- Seeding done via TypeORM repositories on `DataSource` — no mocking
- No changes to production code
- Follows naming convention: `*.int-spec.ts`
- Tests placed in `apps/api/test/integration/`

---

## 5. Risks / Open Questions

- **Inventory FK:** `inventory_items` has FK to `products` (and optionally `product_variants`) — seeding inventory requires seeding a product first. Fixture helper must handle this.
- **`reset()` order matters:** Tables with FKs must be truncated before their parents (CASCADE handles this).
