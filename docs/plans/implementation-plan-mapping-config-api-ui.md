# Implementation Plan: Connection-Scoped Mapping Configuration API + UI

**Issues:** #133 (BE), #134 (FE)  
**Branch:** `133-134-mapping-config-api-ui`  
**Classification:** CORE/Application + Interface (BE), Frontend (FE)

---

## 1. Goal & Non-Goals

### Goal
Introduce a `mappings` bounded context that lets merchants configure Allegro → PrestaShop status, carrier, and payment mappings per connection. Expose a REST API and a React UI. Wire the status mapping into `OrderSyncService` so ingested orders use the configured mapping rather than the hardcoded `'pending'` default.

### Non-Goals
- Automatic inference of mappings from live platform data (helper endpoints return static Allegro data + live PrestaShop data)
- Mapping validation against live PrestaShop configuration
- Any mapping type beyond status, carrier, and payment

---

## 2. Architecture

### Layers touched

| Layer | Location |
|---|---|
| Domain entities + ports | `libs/core/src/mappings/domain/` |
| Application service + interface | `libs/core/src/mappings/application/` |
| ORM entities + repositories | `libs/core/src/mappings/infrastructure/` |
| NestJS module | `libs/core/src/mappings/mappings.module.ts` |
| REST controller + DTOs | `apps/api/src/mappings/` |
| TypeORM migration | `apps/api/src/migrations/` |
| FE feature (API, hooks) | `apps/web/src/features/mappings/` |
| FE pages + route | `apps/web/src/pages/connections/` + `apps/web/src/app/routes/` |

### Helper endpoints for dropdowns
- **Allegro options** (status, delivery methods, payment providers): returned as hardcoded lists (Allegro values are stable, well-known enums). Placed in a new `MappingsController` under `connections/:connectionId/allegro/*`.
- **PrestaShop options** (order statuses, carriers, payment modules): calls through the PrestaShop webservice client, resolved via `IntegrationsService.getCapabilityAdapter`. These are live calls. Placed under `connections/:connectionId/prestashop/*`.

---

## 3. Step-by-Step Implementation Plan

### Phase A — Core domain + infrastructure

#### A1. Domain entities
**Files:**
- `libs/core/src/mappings/domain/entities/status-mapping.entity.ts`
- `libs/core/src/mappings/domain/entities/carrier-mapping.entity.ts`
- `libs/core/src/mappings/domain/entities/payment-mapping.entity.ts`

Each entity: pure TypeScript class, no framework imports. Example:
```
StatusMapping(id, connectionId, allegroStatus, prestashopStatusId)
CarrierMapping(id, connectionId, allegroDeliveryMethodId, prestashopCarrierId)
PaymentMapping(id, connectionId, allegroPaymentProvider, prestashopPaymentModule)
```
IDs are UUID strings (generated at persistence layer).

#### A2. Domain types
**File:** `libs/core/src/mappings/domain/types/mapping.types.ts`
- `StatusMappingInput` / `CarrierMappingInput` / `PaymentMappingInput` (upsert payloads)

#### A3. Repository ports
**Files:**
- `libs/core/src/mappings/domain/ports/status-mapping-repository.port.ts`
- `libs/core/src/mappings/domain/ports/carrier-mapping-repository.port.ts`
- `libs/core/src/mappings/domain/ports/payment-mapping-repository.port.ts`

Each port defines:
```
findByConnectionId(connectionId: string): Promise<T[]>
replaceForConnection(connectionId: string, items: TInput[]): Promise<T[]>
```
The `replaceForConnection` method is a "delete + insert" upsert (idiomatic for bulk mapping tables).

#### A4. Application service interface
**File:** `libs/core/src/mappings/application/interfaces/mapping-config.service.interface.ts`
```
IMappingConfigService {
  getStatusMappings(connectionId): Promise<StatusMapping[]>
  upsertStatusMappings(connectionId, items): Promise<StatusMapping[]>
  getCarrierMappings(connectionId): Promise<CarrierMapping[]>
  upsertCarrierMappings(connectionId, items): Promise<CarrierMapping[]>
  getPaymentMappings(connectionId): Promise<PaymentMapping[]>
  upsertPaymentMappings(connectionId, items): Promise<PaymentMapping[]>
  resolveStatusMapping(connectionId, allegroStatus): Promise<string | null>
}
```

#### A5. Application service
**File:** `libs/core/src/mappings/application/services/mapping-config.service.ts`

Implements `IMappingConfigService`. Each `upsert*` delegates to `replaceForConnection`. `resolveStatusMapping` calls `statusMappingRepository.findByConnectionId` and returns the `prestashopStatusId` for a matching `allegroStatus`, or `null` if not found.

#### A6. ORM entities
**Files:**
- `libs/core/src/mappings/infrastructure/persistence/entities/status-mapping.orm-entity.ts`
- `libs/core/src/mappings/infrastructure/persistence/entities/carrier-mapping.orm-entity.ts`
- `libs/core/src/mappings/infrastructure/persistence/entities/payment-mapping.orm-entity.ts`

Tables: `connection_status_mappings`, `connection_carrier_mappings`, `connection_payment_mappings`.
Each has: `id` (uuid PK), `connection_id` (uuid FK-like, not enforced), `source_value`, `target_value`, timestamps.
Unique constraint on `(connection_id, source_value)`.

#### A7. Repositories
**Files:**
- `libs/core/src/mappings/infrastructure/persistence/repositories/status-mapping.repository.ts`
- `libs/core/src/mappings/infrastructure/persistence/repositories/carrier-mapping.repository.ts`
- `libs/core/src/mappings/infrastructure/persistence/repositories/payment-mapping.repository.ts`

Each implements the port. `replaceForConnection` deletes all rows for `connectionId` then inserts the new items in a transaction.

#### A8. DI tokens
**File:** `libs/core/src/mappings/mappings.tokens.ts`
```
MAPPING_CONFIG_SERVICE_TOKEN
STATUS_MAPPING_REPOSITORY_TOKEN
CARRIER_MAPPING_REPOSITORY_TOKEN
PAYMENT_MAPPING_REPOSITORY_TOKEN
```

#### A9. NestJS core module
**File:** `libs/core/src/mappings/mappings.module.ts`

Registers ORM entities, repositories, service; exports `MAPPING_CONFIG_SERVICE_TOKEN`.

#### A10. Core library index
**File:** `libs/core/src/mappings/index.ts`

Exports module, tokens, interfaces, and entity types needed by the API layer.

---

### Phase B — Migration

#### B1. Migration file
**File:** `apps/api/src/migrations/1778000000000-add-connection-mapping-tables.ts`

Creates three tables:
- `connection_status_mappings (id uuid PK, connection_id uuid NOT NULL, allegro_status varchar NOT NULL, prestashop_status_id varchar NOT NULL, created_at timestamptz, updated_at timestamptz, UNIQUE(connection_id, allegro_status))`
- `connection_carrier_mappings (id uuid PK, connection_id uuid NOT NULL, allegro_delivery_method_id varchar NOT NULL, prestashop_carrier_id varchar NOT NULL, ..., UNIQUE(connection_id, allegro_delivery_method_id))`
- `connection_payment_mappings (id uuid PK, connection_id uuid NOT NULL, allegro_payment_provider varchar NOT NULL, prestashop_payment_module varchar NOT NULL, ..., UNIQUE(connection_id, allegro_payment_provider))`

---

### Phase C — API layer

#### C1. Request/response DTOs
**Files in `apps/api/src/mappings/http/dto/`:**
- `status-mapping-item.dto.ts` — `{ allegroStatus, prestashopStatusId }`
- `upsert-status-mappings.dto.ts` — `{ items: StatusMappingItemDto[] }`
- `status-mapping-response.dto.ts`
- Same pattern for carrier and payment
- Helper response DTOs: `allegro-order-status-option.dto.ts`, `prestashop-order-status-option.dto.ts`, etc.

#### C2. Mappings controller
**File:** `apps/api/src/mappings/http/mappings.controller.ts`

Routes:
```
GET  /connections/:connectionId/mappings/status    → getStatusMappings
PUT  /connections/:connectionId/mappings/status    → upsertStatusMappings
GET  /connections/:connectionId/mappings/carriers  → getCarrierMappings
PUT  /connections/:connectionId/mappings/carriers  → upsertCarrierMappings
GET  /connections/:connectionId/mappings/payments  → getPaymentMappings
PUT  /connections/:connectionId/mappings/payments  → upsertPaymentMappings
```

All endpoints: `@UseGuards(JwtAuthGuard)`, `@Roles('admin')`, `@ApiBearerAuth()`, full Swagger decorators.

#### C3. Options controller
**File:** `apps/api/src/mappings/http/mapping-options.controller.ts`

Routes:
```
GET /connections/:connectionId/allegro/order-statuses      → hardcoded Allegro status list
GET /connections/:connectionId/allegro/delivery-methods    → hardcoded Allegro delivery method list  
GET /connections/:connectionId/prestashop/order-statuses   → live PrestaShop order_states call
GET /connections/:connectionId/prestashop/carriers         → live PrestaShop carriers call
GET /connections/:connectionId/prestashop/payment-modules  → live PrestaShop payment module list
```

For PrestaShop live calls: inject `IntegrationsService`, get the `OrderProcessorManager` adapter (which has access to the PS webservice client), call appropriate PS API resources. For the MVP, these will use the PrestaShop webservice adapter directly via the integrations service.

**Note:** The PrestaShop webservice adapter doesn't currently expose `getOrderStatuses()` etc. — the options controller will call the PrestaShop HTTP client directly. To avoid adding new port methods for a helper endpoint, we can inject the `PrestashopWebserviceClient` directly from the integrations module (since this controller lives in the API app, not core). Alternatively, for MVP simplicity, we return hardcoded PrestaShop option stubs with a note for expansion. **Decision: for MVP, return hardcoded known values for all helper endpoints.** This avoids coupling to live platform state and unblocks the FE. Live data can be added in a follow-up.

#### C4. Mappings API module
**File:** `apps/api/src/mappings/mappings.module.ts`

Imports `MappingsModule` from core, `IntegrationsModule` (for options endpoints). Registers both controllers.

#### C5. Register in AppModule
**File:** `apps/api/src/app.module.ts`

Add `MappingsApiModule` to imports.

---

### Phase D — Wire into OrderSyncService

#### D1. Inject `IMappingConfigService` into `OrderSyncService`
**File:** `libs/core/src/orders/application/services/order-sync.service.ts`

- Inject `MAPPING_CONFIG_SERVICE_TOKEN → IMappingConfigService`
- In `syncOrder`, after resolving `orderStatus`, call `resolveStatusMapping(sourceConnectionId, order.status)`. If a mapping is found, use it as `orderStatus`; otherwise fall back to the existing `validateOrderStatus` logic.

#### D2. Update `OrdersModule` to import `MappingsModule`
**File:** `libs/core/src/orders/orders.module.ts`

Add `MappingsModule` to imports so `MAPPING_CONFIG_SERVICE_TOKEN` is available.

---

### Phase E — Unit tests (BE)

#### E1. `MappingConfigService` unit tests
**File:** `libs/core/src/mappings/application/services/__tests__/mapping-config.service.spec.ts`

Tests:
- `getStatusMappings` returns mappings from repository
- `upsertStatusMappings` delegates to `replaceForConnection`
- `resolveStatusMapping` returns matched prestashopStatusId
- `resolveStatusMapping` returns null when no match
- Same patterns for carrier and payment

---

### Phase F — Frontend (#134)

#### F1. API types
**File:** `apps/web/src/features/mappings/api/mappings.types.ts`

```typescript
export interface StatusMapping { id: string; connectionId: string; allegroStatus: string; prestashopStatusId: string; }
export interface CarrierMapping { ... }
export interface PaymentMapping { ... }
export interface MappingOption { value: string; label: string; }
export interface UpsertStatusMappingsPayload { items: { allegroStatus: string; prestashopStatusId: string }[]; }
// similar for carrier, payment
```

#### F2. API client
**File:** `apps/web/src/features/mappings/api/mappings.api.ts`

Methods:
```
getStatusMappings(connectionId), upsertStatusMappings(connectionId, payload)
getCarrierMappings(connectionId), upsertCarrierMappings(connectionId, payload)
getPaymentMappings(connectionId), upsertPaymentMappings(connectionId, payload)
getAllegroOrderStatuses(connectionId), getAllegroDeliveryMethods(connectionId)
getPrestashopOrderStatuses(connectionId), getPrestashopCarriers(connectionId), getPrestashopPaymentModules(connectionId)
```

#### F3. Query keys
**File:** `apps/web/src/features/mappings/api/mappings.query-keys.ts`

#### F4. Hooks
**Files in `apps/web/src/features/mappings/hooks/`:**
- `use-status-mappings.ts` — query + mutation hooks for status mappings
- `use-carrier-mappings.ts`
- `use-payment-mappings.ts`
- `use-mapping-options.ts` — single hook that fetches all 5 option lists in parallel for a connectionId

#### F5. Shared MappingPanel component
**File:** `apps/web/src/features/mappings/components/MappingPanel.tsx`

Generic panel that renders a mapping table for any mapping type. Props:
```typescript
interface MappingPanelProps<S extends string, T extends string> {
  title: string;
  description: string;
  sourceLabel: string;
  targetLabel: string;
  sourceOptions: MappingOption[];
  targetOptions: MappingOption[];
  value: { sourceValue: S; targetValue: T }[];
  onChange: (items: { sourceValue: S; targetValue: T }[]) => void;
  isSaving: boolean;
  onSave: () => void;
  isDirty: boolean;
  optionsLoading: boolean;
  optionsError: Error | null;
}
```

Features:
- Table listing current rows with delete button per row
- Add row form: source dropdown + target dropdown + Add button
- Bulk save button (disabled when no changes or saving)
- Empty state when no rows
- Unsaved changes indicator

#### F6. Connection Mappings Page
**File:** `apps/web/src/pages/connections/connection-mappings-page.tsx`

- Uses `useParams` for `connectionId`
- Renders 3 tabs (Status / Carriers / Payments) using a simple tab component or CSS tab pattern (follow existing UI patterns)
- Each tab renders a `MappingPanel` wired to the appropriate hooks
- Success toast on save via shared toast/notification mechanism (or simple inline confirmation)
- Error displayed inline on failure

#### F7. Route
**File:** `apps/web/src/app/routes/connection-mappings.route.tsx`

```typescript
export const connectionMappingsRoute: RouteObject = {
  path: 'connections/:connectionId/mappings',
  element: <ConnectionMappingsPage />,
};
```

Register in `root.route.tsx`.

#### F8. Add "Mappings" link to ConnectionDetailPage
**File:** `apps/web/src/pages/connections/connection-detail-page.tsx`

Add a `Link` to `/connections/:connectionId/mappings` in the actions/navigation area.

#### F9. Register mappings API in ApiClient
**File:** `apps/web/src/app/api/api-client.ts`

Add `mappings: MappingsApi` field and wire in `createApiClient`.

#### F10. Frontend tests
**File:** `apps/web/src/pages/connections/connection-mappings-page.test.tsx`

Tests:
- Renders empty state when no mappings
- Renders table rows when mappings exist
- Add row updates the table
- Delete row removes from table
- Save button calls mutation
- Error displays on API failure
- Dirty state indicator shows when changes pending

---

## 4. File Map Summary

### New files (BE core)
```
libs/core/src/mappings/
  domain/
    entities/status-mapping.entity.ts
    entities/carrier-mapping.entity.ts
    entities/payment-mapping.entity.ts
    ports/status-mapping-repository.port.ts
    ports/carrier-mapping-repository.port.ts
    ports/payment-mapping-repository.port.ts
    types/mapping.types.ts
  application/
    interfaces/mapping-config.service.interface.ts
    services/mapping-config.service.ts
    services/__tests__/mapping-config.service.spec.ts
  infrastructure/
    persistence/entities/status-mapping.orm-entity.ts
    persistence/entities/carrier-mapping.orm-entity.ts
    persistence/entities/payment-mapping.orm-entity.ts
    persistence/repositories/status-mapping.repository.ts
    persistence/repositories/carrier-mapping.repository.ts
    persistence/repositories/payment-mapping.repository.ts
  index.ts
  mappings.module.ts
  mappings.tokens.ts
```

### New files (BE API)
```
apps/api/src/migrations/1778000000000-add-connection-mapping-tables.ts
apps/api/src/mappings/
  http/
    dto/status-mapping-item.dto.ts
    dto/upsert-status-mappings.dto.ts
    dto/status-mapping-response.dto.ts
    dto/carrier-mapping-item.dto.ts
    dto/upsert-carrier-mappings.dto.ts
    dto/carrier-mapping-response.dto.ts
    dto/payment-mapping-item.dto.ts
    dto/upsert-payment-mappings.dto.ts
    dto/payment-mapping-response.dto.ts
    dto/mapping-option-response.dto.ts
    mappings.controller.ts
    mapping-options.controller.ts
  mappings.module.ts
```

### Modified files (BE)
```
libs/core/src/orders/application/services/order-sync.service.ts  (inject + use resolveStatusMapping)
libs/core/src/orders/orders.module.ts                            (import MappingsModule)
apps/api/src/app.module.ts                                       (import MappingsApiModule)
```

### New files (FE)
```
apps/web/src/features/mappings/
  api/mappings.types.ts
  api/mappings.api.ts
  api/mappings.query-keys.ts
  hooks/use-status-mappings.ts
  hooks/use-carrier-mappings.ts
  hooks/use-payment-mappings.ts
  hooks/use-mapping-options.ts
  components/MappingPanel.tsx
apps/web/src/pages/connections/connection-mappings-page.tsx
apps/web/src/pages/connections/connection-mappings-page.test.tsx
apps/web/src/app/routes/connection-mappings.route.tsx
```

### Modified files (FE)
```
apps/web/src/app/routes/root.route.tsx          (add connectionMappingsRoute)
apps/web/src/app/api/api-client.ts              (add mappings field)
apps/web/src/pages/connections/connection-detail-page.tsx  (add Mappings link)
```

---

## 5. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| PrestaShop option endpoints require live PS call | Deferred to follow-up — MVP returns hardcoded lists |
| `replaceForConnection` in a transaction — TypeORM transaction pattern | Use `queryRunner.manager` in repository |
| FE tab component — no existing tab primitive | Build inline using CSS tab pattern or render as stacked panels |
| `resolveStatusMapping` called on every order sync — N+1 if uncached | Acceptable for MVP; cache-aware resolver is a follow-up |

---

## 6. Acceptance Criteria Checklist

- [ ] Status, carrier, and payment mappings CRUD per connection
- [ ] Mappings consumed by `order-ingestion.service.ts` (via `OrderSyncService`)
- [ ] Helper endpoints return available options (hardcoded for MVP)
- [ ] Migration verified via `migration:show`
- [ ] Unit tests for `MappingConfigService`
- [ ] FE: all three types configurable; empty state; dirty state; error handling; tests
