# Implementation Plan: Customer Projection & Listings Read APIs (#86, #87)

## Goal

Add read-only REST APIs for:
1. **Customer projections** (`GET /customers`, `GET /customers/:id`) — expose safe customer/debug info
2. **Offer mappings** (`GET /listings`, `GET /listings/:id`) — expose offer-to-variant mapping state

## Classification

- **CORE / Domain** — new filter/pagination types, extended repository ports
- **CORE / Infrastructure** — `findMany`/`findById` repository implementations
- **Interface / HTTP** — controllers, DTOs, API modules

## Non-Goals

- No write/mutation endpoints
- No PII exposure beyond what OL_STORE_PII already allows
- No new database migrations (querying existing tables)

---

## Part A: Customer Projection Read API (#86)

### Step 1 — Domain types

**File:** `libs/core/src/customers/domain/types/customer-projection.types.ts`

Add:
```typescript
export interface CustomerProjectionFilters {
  search?: string;           // ILIKE on emailHash, firstName, lastName
  lastSourceConnectionId?: string;
}

export interface CustomerProjectionPagination {
  limit: number;
  offset: number;
}

export interface PaginatedCustomerProjections {
  items: CustomerProjection[];
  total: number;
}
```

### Step 2 — Extend repository port

**File:** `libs/core/src/customers/domain/ports/customer-projection-repository.port.ts`

Add `findMany` method:
```typescript
findMany(
  filters: CustomerProjectionFilters,
  pagination: CustomerProjectionPagination,
): Promise<PaginatedCustomerProjections>;
```

### Step 3 — Repository implementation

**File:** `libs/core/src/customers/infrastructure/persistence/repositories/customer-projection.repository.ts`

Implement `findMany` using QueryBuilder:
- ILIKE search on `emailHash`, `normalizedEmail`, `firstName`, `lastName`
- Optional filter by `lastSourceConnectionId`
- Order by `lastSeenAt DESC`
- `getManyAndCount()` for pagination

### Step 4 — Update index exports

**File:** `libs/core/src/customers/index.ts`

Export new types (they're in an already-exported file, so likely automatic via `export *`).

### Step 5 — HTTP DTOs

**Files in** `apps/api/src/customers/http/dto/`:
- `list-customers-query.dto.ts` — search, lastSourceConnectionId, limit, offset
- `customer-projection-response.dto.ts` — maps CustomerProjection fields + addresses array
- `customer-address-response.dto.ts` — maps CustomerAddressProjection fields
- `paginated-customers-response.dto.ts` — items, total, limit, offset

### Step 6 — Controller

**File:** `apps/api/src/customers/http/customers.controller.ts`

Endpoints:
- `GET /customers` — list with filters, returns paginated customer projections
- `GET /customers/:id` — detail with addresses (calls `findById` + `findAddressesByCustomerId`)

Injects `CUSTOMER_PROJECTION_REPOSITORY_TOKEN`.

### Step 7 — API module

**File:** `apps/api/src/customers/customers.module.ts`

Imports `CustomersModule` (core), registers `CustomersController`.

### Step 8 — Register in AppModule

**File:** `apps/api/src/app.module.ts`

Add `CustomersApiModule` to imports.

### Step 9 — Controller unit tests

**File:** `apps/api/src/customers/http/customers.controller.spec.ts`

Test list (with/without filters), detail (found/not found).

---

## Part B: Listings / Offer Mappings Read API (#87)

### Step 10 — Domain types for listings

**File:** `libs/core/src/listings/domain/types/offer-mapping.types.ts` (new)

```typescript
export interface OfferMappingFilters {
  connectionId?: string;
  platformType?: string;
  internalId?: string;       // filter by linked variant ID
  search?: string;           // search on externalId
}

export interface OfferMappingPagination {
  limit: number;
  offset: number;
}

export interface PaginatedOfferMappings {
  items: IdentifierMapping[];
  total: number;
}
```

### Step 11 — Offer mapping repository port

**File:** `libs/core/src/listings/domain/ports/offer-mapping-repository.port.ts` (new)

Dedicated port for querying identifier_mappings with `entityType = 'Offer'`:
```typescript
export interface OfferMappingRepositoryPort {
  findById(id: string): Promise<IdentifierMapping | null>;
  findMany(filters: OfferMappingFilters, pagination: OfferMappingPagination): Promise<PaginatedOfferMappings>;
}
```

### Step 12 — Repository implementation

**File:** `libs/core/src/listings/infrastructure/persistence/repositories/offer-mapping.repository.ts` (new)

Uses `@InjectRepository(IdentifierMappingOrmEntity)`, always scopes to `entityType = 'Offer'`.
QueryBuilder with optional filters on connectionId, platformType, internalId, externalId search.
Order by `createdAt DESC`.

### Step 13 — Tokens and module wiring

**File:** `libs/core/src/listings/listings.tokens.ts` — add `OFFER_MAPPING_REPOSITORY_TOKEN`

**File:** `libs/core/src/listings/listings.module.ts` — register repository + token binding, import `TypeOrmModule.forFeature([IdentifierMappingOrmEntity])`

### Step 14 — Update listings index exports

**File:** `libs/core/src/listings/index.ts`

Export new types, port, token.

### Step 15 — HTTP DTOs

**Files in** `apps/api/src/listings/http/dto/`:
- `list-offer-mappings-query.dto.ts` — connectionId, platformType, internalId, search, limit, offset
- `offer-mapping-response.dto.ts` — maps IdentifierMapping fields
- `paginated-offer-mappings-response.dto.ts` — items, total, limit, offset

### Step 16 — Controller

**File:** `apps/api/src/listings/http/listings.controller.ts`

Endpoints:
- `GET /listings` — list offer mappings with filters
- `GET /listings/:id` — single offer mapping detail

Injects `OFFER_MAPPING_REPOSITORY_TOKEN`.

### Step 17 — API module

**File:** `apps/api/src/listings/listings.module.ts`

Imports `ListingsModule` (core), registers `ListingsController`.

### Step 18 — Register in AppModule

**File:** `apps/api/src/app.module.ts`

Add `ListingsApiModule` to imports.

### Step 19 — Controller unit tests

**File:** `apps/api/src/listings/http/listings.controller.spec.ts`

Test list (with/without filters), detail (found/not found).

---

## Quality Gate

```bash
pnpm lint && pnpm type-check && pnpm test
```

No migrations needed — all queries target existing tables.

## Risks

- **PII in customer responses**: Controller must only expose fields that exist (null if OL_STORE_PII=false). No special handling needed since we read what's stored.
- **Listings repo coupling**: Uses `IdentifierMappingOrmEntity` from identifier-mapping module. This is acceptable as a read-only query — no domain logic leakage.
