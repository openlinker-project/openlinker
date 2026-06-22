# Implementation Plan — Read-only role hardening: secret redaction + role-driven read gating

**Issue:** #1124
**Parent spec:** `docs/specs/product-spec-1123-rbac-depth.md`
**ADR:** `docs/architecture/adrs/027-connection-response-secret-redaction.md`
**Effort estimate:** M (3–7 days)
**Blocks:** #1126 (operator role), #1127 (demo posture)
**Dependency:** Independent — builds on existing `admin`/`viewer` + `RolesGuard` seam

---

## 1. Goal

Make the `viewer` role safe to expose to untrusted demo users:

1. Every credential, AI key, webhook secret, and **raw config value** is absent or masked from all non-admin API responses — deny-by-default, not late-blanking.
2. Viewers can browse all operational data (dashboard, orders, products, inventory, listings, connections) but cannot invoke any write action.
3. `permissions[]` is populated from `ROLE_PERMISSIONS` in `GET /auth/me` (already done) **and used as the FE's gate** for write affordances — not an inline `role === 'admin'` check.
4. Tests include an explicit "no secret field reaches a non-admin response" assertion.

**Out of scope:** operator role (#1126), user-management UI (#1125), `OL_DEMO_MODE` flag (#1127), per-connection/per-resource scoping, custom roles.

---

## 2. Pre-flight: Current State

### What already works

| Concern | Status |
|---|---|
| `ROLE_PERMISSIONS` map | ✅ exists in `libs/core/src/users/domain/types/role.types.ts` |
| `GET /auth/me` returns `permissions[]` | ✅ `UserResponseDto.fromDomain()` maps ROLE_PERMISSIONS |
| `SessionUser.permissions[]` populated on login | ✅ `jwt-bearer-session-adapter.ts` maps `data.permissions ?? []` |
| `RolesGuard` enforces `@Roles('admin')` on write endpoints | ✅ registered as `APP_GUARD` |
| AI provider settings — all endpoints `@Roles('admin')` | ✅ |
| Webhook secret rotate — `@Roles('admin')` | ✅ |
| Nav group filtering by role | ✅ `buildNavGroups({ isAdmin })` removes AI section for viewers |

### Gaps this issue fixes

| Gap | Fix |
|---|---|
| `viewer` cannot read orders/products/inventory/listings/sync — class-level `@Roles('admin')` blocks all endpoints including GETs | Remove class-level guard; add per-method guard on writes only |
| `GET /connections` and `GET /connections/:id` return raw `config` (may contain shop URLs, OAuth client IDs) | Role-aware DTO factory: `config: {}` for non-admin |
| `GET /connections/:id/diagnostics` returns `recentErrors` which may reveal config details in error strings | Add `@Roles('admin')` |
| FE uses `role === 'admin'` inline — no permission hook | Add `usePermission(permission)` hook; gate write controls with it |
| FE shows write controls (Create, Edit, Test, Rotate, Sync, Retry) to all authenticated users | Hide/disable via `usePermission` |

---

## 3. Architecture Decision

The redaction enforcement point is a critical security decision. See **ADR-027** (`docs/architecture/adrs/027-connection-response-secret-redaction.md`) for the full rationale. Summary:

**Chosen approach: Role-aware static factory on the DTO.**

```typescript
// connection-response.dto.ts
static fromDomain(
  connection: Connection,
  supportedCapabilities: string[],
  role: UserRole   // NEW — determines what gets projected
): ConnectionResponseDto {
  dto.config = role === 'admin' ? connection.config : {};
  // ...
}
```

**Why not `@SerializeGroups`/class-serializer:** late-blanking — the data is built, then stripped; a missed interceptor or a new endpoint bypasses the strip. **Why not a guard:** guards allow/deny the whole request; they can't shape the response. **Why not middleware:** runs before controller, can't inspect controller return value. The factory is the narrowest, most explicit enforcement point — auditable in one file, impossible to skip without modifying the factory itself.

---

## 4. Data / Secret Inventory

Fields that must be absent or redacted for non-admin sessions:

| Resource | Field | Current state | Fix |
|---|---|---|---|
| `ConnectionResponseDto.config` | Raw JSONB platform config (shop URLs, OAuth client IDs, etc.) | Returned to all authenticated users | `{}` for non-admin via role-aware factory |
| `GET /connections/:id/diagnostics` → `recentErrors[]` | Job error strings may contain config details | Open to all authenticated users | Gate to `@Roles('admin')` |
| `GET /ai-provider-settings` | AI provider key status | `@Roles('admin')` already | No change |
| `POST /connections/:id/webhooks/secret/rotate` | Webhook HMAC secret | `@Roles('admin')` already | No change |
| `PUT /connections/:id/credentials` | Credentials payload | `@Roles('admin')` already | No change |

---

## 5. Read Endpoint Access Matrix

Controllers currently blocked by class-level `@Roles('admin')` that must open to viewers:

| Controller | File | Read endpoints to open | Write endpoints (keep `@Roles('admin')`) |
|---|---|---|---|
| `OrdersController` | `apps/api/src/orders/http/orders.controller.ts` | `GET /orders`, `GET /orders/status-summary`, `GET /orders/sla-summary`, `GET /orders/:id` | `POST /orders/:id/destinations/:connectionId/retry` |
| `ProductsController` | `apps/api/src/products/http/products.controller.ts` | `GET /products`, `GET /products/variants/:variantId`, `GET /products/:id`, `GET /products/:productId/variants` | _(no write endpoints in this controller)_ |
| `VariantsController` | `apps/api/src/products/http/products.controller.ts` | `GET /variants/search` | _(no write endpoints)_ |
| `InventoryController` | `apps/api/src/inventory/http/inventory.controller.ts` | `GET /inventory`, `GET /inventory/availability`, `GET /inventory/:id` | _(no write endpoints)_ |
| `ListingsController` | `apps/api/src/listings/http/listings.controller.ts` | `GET /listings`, `GET /listings/:id`, `GET /listings/:id/offer`, `GET /listings/connections/:connectionId/offers/creation/:recordId` | All POST endpoints (fields update, auto-match, create offer, category resolve, barcode lookup); also keep `@Roles('admin')` on wizard GET helpers: seller-policies, category-params, products-by-catalog |
| `BulkListingController` | `apps/api/src/listings/http/bulk-listing.controller.ts` | `GET /listings/bulk/:batchId` | `POST /listings/bulk`, `POST /listings/bulk/:batchId/retry-failed` |
| `ShopPublishController` | `apps/api/src/listings/http/shop-publish.controller.ts` | `GET /listings/shop-publish/:recordId` | `POST /listings/shop-publish` |
| `BulkShopPublishController` | `apps/api/src/listings/http/bulk-shop-publish.controller.ts` | `GET /listings/bulk-shop-publish/:batchId` | `POST /listings/bulk-shop-publish` |
| `SyncController` | `apps/api/src/sync/http/sync.controller.ts` | `GET /sync/jobs`, `GET /sync/jobs/grouped`, `GET /sync/jobs/:id` | `POST /sync/jobs`, `POST /sync/jobs/retry-grouped`, `POST /sync/jobs/:id/retry` |

---

## 6. Frontend Write Control Gating

Replace inline `role === 'admin'` checks with `usePermission()` permission checks across UI:

| Page / Component | Write control to gate | Permission |
|---|---|---|
| `connections-list-page.tsx` | "New connection" button | `connections:write` |
| `ConnectionActionsPanel.tsx` | Edit, Test, Credentials, Install Webhooks, Disable, Rotate Secret buttons | `connections:write` |
| `connection-detail-page.tsx` | "Actions" tab visibility | `connections:write` |
| `dashboard-page.tsx` | "Retry" button on failed job groups | `sync:write` |
| `listings.controller` → listings pages | Create offer button, Bulk create, Auto-match, Edit offer fields | `listings:write` |
| Sync page (if separate from dashboard) | Trigger sync / retry buttons | `sync:write` |

Nav filtering already works (`requiresRole: 'admin'` on AI group). No change needed there.

---

## 7. Step-by-Step Implementation Plan

### Phase 1 — Backend: Expand permission model

**Step 1.1 — Add new permissions to `PermissionValues` and viewer role**

_File:_ `libs/core/src/users/domain/types/role.types.ts`

Add permissions for all readable domains the viewer needs:

```typescript
export const PermissionValues = [
  'connections:read',
  'connections:write',
  'orders:read',
  'orders:write',        // reserved for operator role (#1126)
  'products:read',
  'products:write',      // reserved for operator role (#1126)
  'inventory:read',
  'inventory:write',     // reserved for operator role (#1126)
  'listings:read',
  'listings:write',      // reserved for operator role (#1126)
  'sync:read',
  'sync:write',
  'integrations:read',
  'integrations:write',
  'adapters:read',
] as const;

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PermissionValues,
  viewer: [
    'connections:read',
    'orders:read',
    'products:read',
    'inventory:read',
    'listings:read',
    'sync:read',
    'integrations:read',
    'adapters:read',
  ],
} as const;
```

**Acceptance criteria:**
- `ROLE_PERMISSIONS['viewer']` includes `orders:read`, `products:read`, `inventory:read`, `listings:read`
- `ROLE_PERMISSIONS['admin']` equals all `PermissionValues`
- Existing `user-response.dto.spec.ts` tests remain green (update the viewer-permissions test to match the new set)

---

**Step 1.2 — Remove class-level guards; add per-method write guards**

For each controller in the table in §5, apply this pattern:

```typescript
// BEFORE (blocks all endpoints for viewers):
@Roles('admin')        // ← class-level, remove
@Controller('orders')
export class OrdersController {
  @Get()              // was blocked for viewer
  async list() { ... }

  @Post(':id/destinations/:connectionId/retry')
  async retry() { ... }
}

// AFTER (read open, write guarded):
@Controller('orders')
export class OrdersController {
  @Get()              // now open to any authenticated user
  async list() { ... }

  @Roles('admin')     // ← per-method
  @Post(':id/destinations/:connectionId/retry')
  async retry() { ... }
}
```

Apply the same pattern to all 9 affected controllers. The `ListingsController` is the most complex — apply `@Roles('admin')` individually to each write POST and to the wizard-helper GETs (seller-policies, category-params, products-by-catalog).

**Files to modify:**
- `apps/api/src/orders/http/orders.controller.ts`
- `apps/api/src/products/http/products.controller.ts` (two controller classes)
- `apps/api/src/inventory/http/inventory.controller.ts`
- `apps/api/src/listings/http/listings.controller.ts`
- `apps/api/src/listings/http/bulk-listing.controller.ts`
- `apps/api/src/listings/http/shop-publish.controller.ts`
- `apps/api/src/listings/http/bulk-shop-publish.controller.ts`
- `apps/api/src/sync/http/sync.controller.ts`

**Acceptance criteria:**
- `GET /orders` returns 200 for a viewer JWT; returns 403 for unauthenticated
- `POST /orders/:id/destinations/:connectionId/retry` returns 403 for a viewer JWT
- `pnpm lint && pnpm type-check && pnpm test` pass

---

### Phase 2 — Backend: Connection secret redaction (deny-by-default)

**Step 2.1 — Role-aware factory in `ConnectionResponseDto`**

_File:_ `apps/api/src/integrations/http/dto/connection-response.dto.ts`

Add an optional `role` parameter to `fromDomain()`. Non-admin callers receive `config: {}` (empty object — never `null` or `undefined`, which would break the existing `Record<string, unknown>` FE type):

```typescript
import type { UserRole } from '@openlinker/core/users';

// In ConnectionResponseDto class:
static fromDomain(
  connection: Connection,
  supportedCapabilities: string[],
  role?: UserRole
): ConnectionResponseDto {
  const dto = new ConnectionResponseDto();
  dto.id = connection.id;
  dto.platformType = connection.platformType;
  dto.name = connection.name;
  dto.status = connection.status;
  dto.config = role === 'admin' ? connection.config : {};  // deny-by-default
  dto.credentialsBacked = connection.credentialsRef.startsWith('db:');
  dto.adapterKey = connection.adapterKey;
  dto.enabledCapabilities = connection.enabledCapabilities;
  dto.supportedCapabilities = supportedCapabilities;
  dto.createdAt = connection.createdAt;
  dto.updatedAt = connection.updatedAt;
  return dto;
}
```

The `role` param is optional (defaults to undefined → treated as non-admin) so that existing callers within integration tests or Swagger tooling that don't pass a role get safe defaults automatically.

**Acceptance criteria:**
- `fromDomain(conn, caps, 'admin')` → `dto.config` equals the connection's full config
- `fromDomain(conn, caps, 'viewer')` → `dto.config` equals `{}`
- `fromDomain(conn, caps, undefined)` → `dto.config` equals `{}`

---

**Step 2.2 — Thread `AuthenticatedUser` through `ConnectionController` reads**

_File:_ `apps/api/src/integrations/http/connection.controller.ts`

Three changes:

1. Private helper `toResponse()` accepts user:
```typescript
private async toResponse(
  connection: Connection,
  user?: AuthenticatedUser
): Promise<ConnectionResponseDto> {
  // ... resolve supportedCapabilities unchanged ...
  return ConnectionResponseDto.fromDomain(connection, supported, user?.role);
}
```

2. `list()` and `get()` inject the current user:
```typescript
@Get()
async list(
  @Query() filtersDto: ConnectionFiltersDto,
  @CurrentUser() user: AuthenticatedUser
): Promise<ConnectionResponseDto[]> {
  // ...
  return Promise.all(connections.map((c) => this.toResponse(c, user)));
}

@Get(':id')
async get(
  @Param('id') id: string,
  @CurrentUser() user: AuthenticatedUser
): Promise<ConnectionResponseDto> {
  const connection = await this.connectionService.get(id);
  return this.toResponse(connection, user);
}
```

3. Gate `getDiagnostics()` to admin (error strings may reveal config details):
```typescript
@Roles('admin')    // ← ADD
@Get(':id/diagnostics')
async getDiagnostics(...) { ... }
```

**Acceptance criteria:**
- A viewer calling `GET /connections` receives `config: {}` for every connection
- An admin calling `GET /connections` receives the real `config`
- `GET /connections/:id/diagnostics` returns 403 for a viewer

---

**Step 2.3 — Unit tests for `ConnectionResponseDto` redaction**

_File:_ `apps/api/src/integrations/http/dto/connection-response.dto.spec.ts` (create if not present)

```typescript
describe('ConnectionResponseDto.fromDomain', () => {
  const mockConnection = new Connection(
    'id-1', 'prestashop', 'My Store', 'active',
    { baseUrl: 'https://my-shop.com', apiKey: 'secret' },   // sensitive config
    'db:cred-ref',
    new Date(), new Date(),
    undefined, ['ProductMaster']
  );

  it('should redact config for viewer role', () => {
    const dto = ConnectionResponseDto.fromDomain(mockConnection, [], 'viewer');
    expect(dto.config).toEqual({});
  });

  it('should redact config when role is undefined', () => {
    const dto = ConnectionResponseDto.fromDomain(mockConnection, [], undefined);
    expect(dto.config).toEqual({});
  });

  it('should expose full config for admin role', () => {
    const dto = ConnectionResponseDto.fromDomain(mockConnection, [], 'admin');
    expect(dto.config).toEqual({ baseUrl: 'https://my-shop.com', apiKey: 'secret' });
  });

  it('should never expose credentialsRef', () => {
    const dto = ConnectionResponseDto.fromDomain(mockConnection, [], 'admin');
    expect(dto).not.toHaveProperty('credentialsRef');
  });
});
```

---

### Phase 3 — Frontend: Permission hook

**Step 3.1 — `usePermission` hook**

_File (new):_ `apps/web/src/shared/auth/use-permission.ts`

```typescript
import { useSession } from './use-session';

/**
 * Returns true if the current session's user holds the given permission.
 * Returns false for anonymous sessions or when the permission is absent.
 */
export function usePermission(permission: string): boolean {
  const { session } = useSession();
  return session.user?.permissions.includes(permission) ?? false;
}
```

**Acceptance criteria:**
- Returns `true` when `session.user.permissions` contains the given string
- Returns `false` for anonymous session (`session.user === null`)
- No dependency on `role` — purely permission-string-driven

---

**Step 3.2 — Export from the auth barrel (if one exists)**

If `apps/web/src/shared/auth/index.ts` exists, add:
```typescript
export { usePermission } from './use-permission';
```
Otherwise import directly from the file path.

---

**Step 3.3 — Unit tests for `usePermission`**

_File (new):_ `apps/web/src/shared/auth/use-permission.test.ts`

```typescript
import { renderHook } from '@testing-library/react';
import { usePermission } from './use-permission';
import { renderWithProviders } from '../../test/test-utils';

it('should return true for a permission the user holds', () => {
  const { result } = renderWithProviders(
    () => { const p = usePermission('connections:read'); return p; },
    { sessionUser: { permissions: ['connections:read', 'orders:read'] } }
  );
  expect(result.current).toBe(true);
});

it('should return false for a permission the user lacks', () => {
  const { result } = renderWithProviders(
    () => usePermission('connections:write'),
    { sessionUser: { permissions: ['connections:read'] } }
  );
  expect(result.current).toBe(false);
});

it('should return false for anonymous session', () => {
  const { result } = renderWithProviders(
    () => usePermission('connections:read'),
    { sessionUser: null }
  );
  expect(result.current).toBe(false);
});
```

---

### Phase 4 — Frontend: Hide write controls

For each component below, inject `usePermission` and conditionally hide/disable the write control. The pattern is identical throughout:

```tsx
const canWrite = usePermission('connections:write');

// Render nothing (not disabled) for write-only controls:
{canWrite && <Button tone="primary" onClick={handleCreate}>New connection</Button>}

// Disable rather than hide for controls that must still communicate "not available":
<Button disabled={!canWrite} onClick={handleEdit}>Edit</Button>
```

**Prefer hiding (not rendering) over disabling** for primary action buttons. Reserve `disabled` only where the control's existence communicates information (e.g., a tab that the user needs to know exists but cannot use today).

---

**Step 4.1 — Connections list page**

_File:_ `apps/web/src/pages/connections/connections-list-page.tsx`

Add `usePermission('connections:write')` and gate the "New connection" / "Add connection" button.

---

**Step 4.2 — Connection detail page + `ConnectionActionsPanel`**

_File:_ `apps/web/src/pages/connections/connection-detail-page.tsx`

Gate the "Actions" tab rendering on `canWrite`.

_File:_ `apps/web/src/features/connections/components/ConnectionActionsPanel.tsx`

Gate each action (Edit, Test, Install Webhooks, Disable, Rotate Secret, Update Credentials) on `usePermission('connections:write')`.

---

**Step 4.3 — Dashboard: retry group button**

_File:_ `apps/web/src/pages/dashboard/dashboard-page.tsx`

Gate the "Retry" button on `usePermission('sync:write')`. The job list and failed-group list remain visible (read-only operational data).

---

**Step 4.4 — Listings pages**

_Files:_ `apps/web/src/pages/listings/*.tsx` and `apps/web/src/features/listings/components/*.tsx`

Gate create/bulk-create/auto-match/field-update controls on `usePermission('listings:write')`. Read/list/detail views remain open.

---

**Step 4.5 — Sync / jobs page (if action controls exist)**

_Files:_ any component with "Trigger sync" or "Retry job" affordances

Gate on `usePermission('sync:write')`.

---

### Phase 5 — Tests: end-to-end non-admin safety assertion

**Step 5.1 — Integration test: viewer cannot see connection secrets**

_File:_ `apps/api/test/integration/connections-viewer-redaction.int-spec.ts`

```
describe('Connection read — viewer role', () => {
  it('should return config: {} for a viewer-role token on GET /connections', ...);
  it('should return config: {} for a viewer-role token on GET /connections/:id', ...);
  it('should return 403 for GET /connections/:id/diagnostics', ...);
  it('should return 403 for POST /connections/:id/test', ...);
  it('should return 403 for PUT /connections/:id/credentials', ...);
});
```

Use Testcontainers + `resetTestHarness()` between tests. Seed one connection with a non-empty `config`. Create a viewer-role JWT. Assert `config: {}` in list and detail responses.

This is the **required "no secret field reaches a non-admin response" assertion** from the acceptance criteria.

---

**Step 5.2 — Update existing `user-response.dto.spec.ts`**

The viewer-permissions test at line 41 expects the old permission set. Update it to match the new `ROLE_PERMISSIONS['viewer']` set (which now includes `orders:read`, `products:read`, `inventory:read`, `listings:read`).

---

## 8. Questions & Assumptions

**Q1 — Should the `config` field be entirely absent (not present in JSON) or always present as `{}`?**
**Assumption:** return `{}` (always present). The FE `Connection` type declares `config: Record<string, unknown>` as required; omitting it would cause a TypeScript error and potential runtime breakage in components that read `config` without a null-check. An empty object is safe and signals "config exists but is empty/redacted" without breaking the existing FE contract.

**Q2 — Is `GET /connections/:id/diagnostics` accessible to viewers?**
**Assumption:** No — gate to `@Roles('admin')`. The `recentErrors` strings come from job error messages which may include platform-specific details (e.g. "Authentication failed for https://my-shop.com") that could reveal config values. Adding `@Roles('admin')` is the conservative choice. If viewer access to diagnostics is needed later (e.g., for operator role), this can be relaxed per-field at that point.

**Q3 — Spec mentions `product-spec-1123-rbac-depth.md` had not been merged at plan-generation start.**
**Resolution:** Spec was merged as #1128 during the plan session. All guidance in this plan is consistent with the committed Shape B decision in the spec.

**Q4 — Does the `ConnectionDiagnosticsResponseDto` expose the full `Connection.config`?**
**Assumption:** No — it only references `connection.name` and `connection.status`, not `config`. The risk is in `recentErrors` (error message strings), which is why we gate the entire endpoint to admin.

**Q5 — What about `products:write` and `orders:write` in `PermissionValues`?**
**Assumption:** Add them now as reserved stubs so the permission model is forward-compatible with the operator role (#1126). They are in `admin`'s permissions (all of `PermissionValues`) but absent from `viewer`. They don't trigger any new backend guard changes in this issue.

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A write endpoint is missed (no `@Roles('admin')` after class-level guard removal) | Low-Medium | High (silent exposure of mutation) | Integration test matrix; grep for write HTTP methods in modified controllers after changes |
| FE write control missed in a component | Medium | Medium (UX gap, but 403 at API catches the call) | Component-level FE tests; manual spot-check on connection detail page |
| Role change mid-session shows stale permissions | Low | Low (acceptable for MVP) | Document: permission changes take effect on next token refresh / re-login |
| `config` redaction breaks a FE component that reads specific config keys | Low | Medium | `config: {}` returns valid `Record<string, unknown>` — components doing `config.baseUrl ?? ''` will get `undefined` which is the correct behavior for a non-admin |

---

## 10. Migration

**None required.** Permissions are derived from role at response time (`ROLE_PERMISSIONS` lookup). No new DB column or schema change needed.

---

## 11. Quality Gate

Before merging:
```bash
pnpm lint         # zero errors
pnpm type-check   # zero errors
pnpm test         # unit tests pass
pnpm test:integration   # viewer-redaction int-spec passes (requires Docker)
```

Manual spot-check:
- Log in as viewer → `GET /connections` in browser devtools → confirm `config: {}` in all responses
- Log in as viewer → navigate to Orders, Products, Inventory, Listings → confirm data loads (no 403)
- Log in as viewer → "New connection" button absent; "Edit" button absent on connection detail
- Log in as admin → full `config` present; all write controls visible

---

## 12. Implementation Checklist

- [ ] 1.1 Expand `PermissionValues` and `viewer` ROLE_PERMISSIONS in `role.types.ts`
- [ ] 1.2 Remove class-level `@Roles('admin')` from 9 controllers; add per-method `@Roles('admin')` on writes
- [ ] 2.1 Role-aware `ConnectionResponseDto.fromDomain()` — `config: {}` for non-admin
- [ ] 2.2 Thread `AuthenticatedUser` through `ConnectionController.list()`, `get()`; gate `getDiagnostics()`
- [ ] 2.3 Unit tests for `ConnectionResponseDto` config redaction
- [ ] 3.1 `usePermission(permission)` hook in `apps/web/src/shared/auth/use-permission.ts`
- [ ] 3.2 Export from auth barrel
- [ ] 3.3 Unit tests for `usePermission`
- [ ] 4.1 Gate "New connection" button in connections-list-page
- [ ] 4.2 Gate action controls in `ConnectionActionsPanel` + "Actions" tab in connection-detail-page
- [ ] 4.3 Gate "Retry" button in dashboard-page
- [ ] 4.4 Gate create/bulk controls in listings pages
- [ ] 4.5 Gate sync trigger/retry controls
- [ ] 5.1 Integration test: viewer receives `config: {}`, is blocked from writes
- [ ] 5.2 Update `user-response.dto.spec.ts` viewer-permissions assertion
- [ ] Verify no new ESLint warnings or type errors
