# Implementation Plan: Operator Role — Write-Scoped Delegation (#1126)

**Issue**: [IMPL] Operator role — write-scoped delegation (operate, not administer) #1126
**Parent**: Part of Refine: how far to deepen the roles/permissions model #1123
**Spec**: `docs/specs/product-spec-1123-rbac-depth.md`
**Effort**: S — 1–3 days
**Dependencies**: Blocked by #1124 (permission wiring + secret redaction), #1125 (assignment UI)

---

## 1. Goal

Add a middle-rung `operator` role to the fixed 3-rung ladder (`admin` / `operator` / `read-only`). Operators perform day-to-day operational work — processing orders, publishing listings, printing labels, adjusting inventory — but cannot touch the platform's administrative surfaces: connection credentials, webhook setup, AI provider settings, or user management.

The enforcement mechanism (#1124) and the assignment UI (#1125) are delivered by dependencies. This issue exclusively maps the `operator` role to its correct permission set, widens the `@Roles` guards on operational write endpoints, and adds the regression tests.

**No DB migration is needed** — `role` is stored as a plain string.

---

## 2. Task Classification

| Layer | Scope |
|---|---|
| **CORE** — `libs/core/src/users/domain/types/role.types.ts` | Add `operator` to role enum + permission map |
| **Interface** — `apps/api/src/*/http/*.controller.ts` | Widen `@Roles('admin')` to `@Roles('admin', 'operator')` on operational writes |
| **Interface** — `apps/api/src/auth/` | Update integration test helper (`loginAs` role union) |
| **Interface** — `apps/api/test/integration/` | New integration test: `operator-role-authz.int-spec.ts` |
| **Frontend** — `apps/web/src/app/nav-registry.types.ts` | Add `'operator'` to `RoleValues` |
| **Documentation** | Update spec role matrix |

---

## 3. Architecture Notes

The enforcement seam (#1124) is already in place:
- `RolesGuard` reads `@Roles()` metadata from each handler; throws 403 if `user.role` is not in the list.
- `@Roles()` accepts `UserRole[]`, currently typed as `'admin' | 'viewer'`.
- `ROLE_PERMISSIONS[user.role]` is resolved on `GET /auth/me` and sent as `permissions[]` to the FE.
- FE `usePermission(permission)` reads the `permissions[]` array; affordances (write buttons) are gated via this hook — never via `role === 'admin'` inline checks.
- Connection `config` redaction is role-driven: `ConnectionResponseDto.fromDomain(connection, supported, user?.role)` passes the caller's role and returns `{}` for any non-admin role.

Adding `operator` requires only:
1. Extending the type and the permissions map (CORE layer).
2. Widening `@Roles()` guards on the correct endpoints (Interface layer).
3. Adding a `loginAsOperator` helper and `operator-role-authz` integration test.
4. Updating the FE `RoleValues` type so `requiresRole: 'operator'` becomes valid for future nav gating.

No new ports, services, repositories, or modules are introduced.

---

## 4. Permission Map Design

### Operator's permissions (what changes in `ROLE_PERMISSIONS`)

| Permission | Viewer | **Operator** | Admin |
|---|---|---|---|
| `connections:read` | ✓ | ✓ | ✓ |
| `connections:write` | — | — | ✓ |
| `sync:read` | ✓ | ✓ | ✓ |
| `sync:write` | — | — | ✓ |
| `integrations:read` | ✓ | ✓ | ✓ |
| `integrations:write` | — | — | ✓ |
| `adapters:read` | ✓ | ✓ | ✓ |
| `orders:read` | ✓ | ✓ | ✓ |
| `orders:write` | — | **✓** | ✓ |
| `products:read` | ✓ | ✓ | ✓ |
| `products:write` | — | — | ✓ |
| `inventory:read` | ✓ | ✓ | ✓ |
| `inventory:write` | — | **✓** | ✓ |
| `listings:read` | ✓ | ✓ | ✓ |
| `listings:write` | — | **✓** | ✓ |

**Rationale for each decision:**
- `connections:write` — admin-only: changing connection credentials/config is administrative.
- `sync:write` — admin-only: triggering sync jobs / retry-grouped is a diagnostic/admin operation. Operators can view sync job state (`sync:read`) but not fire new ones. Order-specific retries are covered by `orders:write`.
- `integrations:write` — admin-only: same tier as connection management.
- `products:write` — admin-only for this issue: "edit/publish listings" refers to marketplace listing operations, not master catalog edits. Deferred to a follow-up if needed.
- `inventory:write` — operator: "adjust inventory" is explicitly listed in the acceptance criteria.
- `orders:write` — operator: "view/process orders" includes retrying failed order destinations.
- `listings:write` — operator: "edit/publish listings" covers marketplace offer creation, field updates, bulk publish.

---

## 5. Endpoint `@Roles` Changes

### Endpoints widened to `@Roles('admin', 'operator')`

#### `apps/api/src/orders/http/orders.controller.ts`
| Method | Route | Justification |
|---|---|---|
| POST | `/orders/:internalOrderId/destinations/:connectionId/retry` | "process orders" — retry a failed order destination sync |

#### `apps/api/src/listings/http/listings.controller.ts`
| Method | Route | Justification |
|---|---|---|
| POST | `/listings/connections/:connectionId/offers/:offerId/fields` | "edit listings" — update offer fields |
| POST | `/listings/connections/:connectionId/sync/auto-match-variants` | "edit listings" — variant matching for offers |
| POST | `/listings/connections/:connectionId/offers` | "publish listings" — create an offer |
| GET | `/listings/connections/:connectionId/seller-policies` | Read required by the offer creation wizard |
| GET | `/listings/connections/:connectionId/categories/:categoryId/parameters` | Read required by wizard |
| POST | `/listings/connections/:connectionId/categories/resolve` | Read (POST body filter) required by wizard |
| POST | `/listings/connections/:connectionId/categories/resolve-batch` | Read (POST body filter) required by wizard |
| POST | `/listings/connections/:connectionId/products/find-by-barcode` | Read (POST body filter) required by wizard |
| GET | `/listings/connections/:connectionId/products/:productId` | Read required by wizard |

> Note: the six GET/POST routes that serve as reference-data lookups for the offer-creation wizard are currently `@Roles('admin')` because the wizard itself was admin-only. Once operators can create offers, they need these lookups too. They are widened here alongside the primary write endpoints.

#### `apps/api/src/listings/http/bulk-listing.controller.ts`
| Method | Route | Justification |
|---|---|---|
| POST | `/listings/bulk-create` | "publish listings" — bulk offer creation submit |
| POST | `/listings/bulk-create/:batchId/retry-failed` | "publish listings" — retry failed bulk batch |

#### `apps/api/src/listings/http/shop-publish.controller.ts`
| Method | Route | Justification |
|---|---|---|
| POST | `/listings/connections/:connectionId/shop-publish` | "publish listings" — push to shop |

#### `apps/api/src/listings/http/bulk-shop-publish.controller.ts`
| Method | Route | Justification |
|---|---|---|
| POST | `/listings/bulk-shop-publish` | "publish listings" — bulk push to shop |

#### `apps/api/src/shipping/http/shipment.controller.ts`
Currently class-level `@Roles('admin')`. Change the class-level guard to `@Roles('admin', 'operator')` so operators can view and print labels. `viewer` remains blocked at the class level (the nav shows "Shipments" to all, but this is a pre-existing inconsistency outside this issue's scope).

#### `apps/api/src/shipping/http/pickup-point.controller.ts`
Same change: class-level `@Roles('admin')` → `@Roles('admin', 'operator')`. Operators need pickup point lookup to generate InPost labels.

### Endpoints that REMAIN `@Roles('admin')` only

All write endpoints on:
- `ConnectionController` — credentials/config/disable/webhooks are administrative
- `SyncController` — `POST /sync/jobs`, `POST /sync/jobs/retry-grouped`, `POST /sync/jobs/:id/retry`
- `AlllegroController` — OAuth connect, responsible producers, safety attachments
- `ContentController` — saving/publishing product content drafts (deferred to spec's future write)
- `AiProviderSettingsController` — entire controller (class-level guard retained)
- `PromptTemplatesController` — entire controller (class-level guard retained)
- `WebhookDeliveryController` — entire controller (class-level guard retained)
- `CursorsController` — entire controller (class-level guard retained)
- `CustomersController` — entire controller (class-level guard retained)
- `InvoicingController` — entire controller (class-level guard retained)
- `MappingsController` — entire controller (class-level guard retained)
- `FulfillmentRoutingController` — entire controller (class-level guard retained)
- `MappingOptionsController` — entire controller (class-level guard retained)

---

## 6. Step-by-Step Implementation Plan

### Phase 1 — Core: Role type and permission map

**Step 1.1 — Add `operator` to `UserRoleValues` and update `ROLE_PERMISSIONS`**

File: `libs/core/src/users/domain/types/role.types.ts`

```typescript
// Before
export const UserRoleValues = ['admin', 'viewer'] as const;

// After
export const UserRoleValues = ['admin', 'operator', 'viewer'] as const;
```

Add `operator` entry to `ROLE_PERMISSIONS`:
```typescript
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PermissionValues,
  operator: [
    'connections:read',
    'sync:read',
    'integrations:read',
    'adapters:read',
    'orders:read',
    'orders:write',
    'products:read',
    'inventory:read',
    'inventory:write',
    'listings:read',
    'listings:write',
  ],
  viewer: [
    'connections:read',
    'sync:read',
    'integrations:read',
    'adapters:read',
    'orders:read',
    'products:read',
    'inventory:read',
    'listings:read',
  ],
} as const;
```

Update the JSDoc comment on `UserRoleValues` to describe all three roles.

**Acceptance criteria**: `UserRole` type = `'admin' | 'operator' | 'viewer'`. `ROLE_PERMISSIONS['operator']` contains exactly the 11 permissions above and no others.

---

**Step 1.2 — Unit test: ROLE_PERMISSIONS operator entry**

File: `libs/core/src/users/domain/types/role.types.spec.ts` *(new file)*

```typescript
// should contain orders:write, listings:write, inventory:write
// should NOT contain connections:write, sync:write, integrations:write, products:write
// should be a subset of admin permissions
// viewer permissions should be a strict subset of operator permissions
```

Test names follow the `should [expected] when [condition]` convention. No framework dependencies — pure TypeScript assertions.

---

### Phase 2 — Backend: Widen `@Roles` guards

**Step 2.1 — Orders controller**

File: `apps/api/src/orders/http/orders.controller.ts`

Change `retryDestination` handler:
```typescript
// Before
@Roles('admin')
@Post(':internalOrderId/destinations/:connectionId/retry')

// After
@Roles('admin', 'operator')
@Post(':internalOrderId/destinations/:connectionId/retry')
```

---

**Step 2.2 — Listings controller**

File: `apps/api/src/listings/http/listings.controller.ts`

For each of the nine endpoints listed in §5, change `@Roles('admin')` to `@Roles('admin', 'operator')`. The change is mechanical; apply it in endpoint order as they appear in the file.

---

**Step 2.3 — Bulk listing controller**

File: `apps/api/src/listings/http/bulk-listing.controller.ts`

Change both write handlers: `@Roles('admin')` → `@Roles('admin', 'operator')`.

---

**Step 2.4 — Shop-publish controller**

File: `apps/api/src/listings/http/shop-publish.controller.ts`

Change the `create` handler: `@Roles('admin')` → `@Roles('admin', 'operator')`.

---

**Step 2.5 — Bulk shop-publish controller**

File: `apps/api/src/listings/http/bulk-shop-publish.controller.ts`

Change the `create` handler: `@Roles('admin')` → `@Roles('admin', 'operator')`.

---

**Step 2.6 — Shipment controller**

File: `apps/api/src/shipping/http/shipment.controller.ts`

Change the class-level decorator:
```typescript
// Before
@Roles('admin')
@Controller('shipments')

// After
@Roles('admin', 'operator')
@Controller('shipments')
```

---

**Step 2.7 — Pickup point controller**

File: `apps/api/src/shipping/http/pickup-point.controller.ts`

Same as step 2.6: class-level `@Roles('admin')` → `@Roles('admin', 'operator')`.

---

**Step 2.8 — Expand write-guard-coverage invariant**

File: `apps/api/src/auth/write-guard-coverage.spec.ts`

Add `ShipmentController` and `PickupPointController` to the `CONTROLLERS` list. These controllers have write endpoints and were not previously covered by the invariant. After this issue they both carry `@Roles('admin', 'operator')` which satisfies the "has @Roles" check.

The existing entries pass unchanged — `@Roles('admin', 'operator')` is still non-empty metadata, which is all the invariant checks.

---

### Phase 3 — Backend: Integration test helper + operator authz test

**Step 3.1 — Extend `loginAs` to accept `'operator'`**

File: `apps/api/test/integration/helpers/test-auth.helper.ts`

- Change `role: 'admin' | 'viewer'` parameter type to `role: 'admin' | 'operator' | 'viewer'`
- Add convenience wrapper `loginAsOperator`:
```typescript
export async function loginAsOperator(
  http: ReturnType<typeof request>,
  dataSource: DataSource,
  username = 'operator',
  password = 'test-password',
): Promise<string> {
  return loginAs(http, dataSource, 'operator', username, password);
}
```

---

**Step 3.2 — New integration test: operator role authz**

File: `apps/api/test/integration/operator-role-authz.int-spec.ts` *(new file)*

This test mirrors `viewer-role-authz.int-spec.ts` in structure but proves the operator's specific matrix:

```
Operator writes that should return 2xx (not 403):
  - POST /orders/:id/destinations/:connectionId/retry → 404 (guard passes; handler 404s on unknown order)
  - POST /listings/connections/:connectionId/offers → 400 or 404 (guard passes; handler validates body/connection)
  - POST /listings/bulk-create → 400 (guard passes; handler validates body)
  - POST /listings/bulk-shop-publish → 400 (guard passes; handler validates body)
  - GET /listings/connections/:connectionId/seller-policies → 404 (guard passes; connection unknown)
  - GET /shipments → 200

Operator writes that should remain 403:
  - POST /connections → 403
  - PATCH /connections/:id → 403
  - PUT /connections/:id/credentials → 403
  - POST /connections/:id/webhooks/install → 403
  - POST /sync/jobs → 403
  - POST /sync/jobs/retry-grouped → 403
  - GET /connections/:id/diagnostics → 403  (admin-only GET)
  - GET /prompt-templates → 403  (entire controller admin-only)
  - PUT /ai-provider-settings/active → 403  (entire controller admin-only)
  - GET /webhook-deliveries → 403  (entire controller admin-only)
  - GET /cursors → 403  (entire controller admin-only)

Config redaction — operator behaves same as viewer (non-admin):
  - GET /connections/:id → {} config for operator
  - GET /connections → [] with {} config for operator
```

> Implementation note: for the "guard passes; handler errors" assertions, the RolesGuard fires before the handler body, so even a completely invalid body / non-existent resource ID triggers the correct HTTP status (not 403). This pattern is already used in `viewer-role-authz.int-spec.ts`.

---

### Phase 4 — Frontend: `nav-registry.types.ts`

**Step 4.1 — Add `'operator'` to FE `RoleValues`**

File: `apps/web/src/app/nav-registry.types.ts`

```typescript
// Before
export const RoleValues = ['admin'] as const;

// After
export const RoleValues = ['admin', 'operator'] as const;
```

Update the JSDoc comment to note that `'operator'` enables `requiresRole: 'operator'` for future operator-only nav groups without type changes.

**No other FE changes are needed** for this issue:
- `buildNavGroups({ isAdmin })` already filters `requiresRole === 'admin' && !isAdmin` — operators are not admins, so admin-only nav groups (AI) stay hidden from them.
- All write affordances (`usePermission('orders:write')`, `usePermission('listings:write')`, etc.) are already read from `session.user.permissions[]` and will automatically activate for operators once the backend sends the enriched permissions from `ROLE_PERMISSIONS['operator']`.
- The `app-shell.tsx` `isAdmin` derivation (`session.user?.role === 'admin'`) remains correct and unchanged.

---

### Phase 5 — Documentation

**Step 5.1 — Update role matrix in spec**

File: `docs/specs/product-spec-1123-rbac-depth.md`

Find the role matrix table (or the permissions section) and add the `operator` column/row. Document the three-rung ladder as implemented, with the specific permission grants from §4 of this plan.

---

## 7. File Change Summary

| File | Change type | Phase |
|---|---|---|
| `libs/core/src/users/domain/types/role.types.ts` | Edit: add `operator`, update `ROLE_PERMISSIONS` | 1.1 |
| `libs/core/src/users/domain/types/role.types.spec.ts` | New: unit tests for operator permissions | 1.2 |
| `apps/api/src/orders/http/orders.controller.ts` | Edit: widen 1 guard | 2.1 |
| `apps/api/src/listings/http/listings.controller.ts` | Edit: widen 9 guards | 2.2 |
| `apps/api/src/listings/http/bulk-listing.controller.ts` | Edit: widen 2 guards | 2.3 |
| `apps/api/src/listings/http/shop-publish.controller.ts` | Edit: widen 1 guard | 2.4 |
| `apps/api/src/listings/http/bulk-shop-publish.controller.ts` | Edit: widen 1 guard | 2.5 |
| `apps/api/src/shipping/http/shipment.controller.ts` | Edit: widen class-level guard | 2.6 |
| `apps/api/src/shipping/http/pickup-point.controller.ts` | Edit: widen class-level guard | 2.7 |
| `apps/api/src/auth/write-guard-coverage.spec.ts` | Edit: add 2 controllers | 2.8 |
| `apps/api/test/integration/helpers/test-auth.helper.ts` | Edit: add `operator` to role union + `loginAsOperator` | 3.1 |
| `apps/api/test/integration/operator-role-authz.int-spec.ts` | New: operator authz integration tests | 3.2 |
| `apps/web/src/app/nav-registry.types.ts` | Edit: add `'operator'` to `RoleValues` | 4.1 |
| `docs/specs/product-spec-1123-rbac-depth.md` | Edit: update role matrix | 5.1 |

**Total**: 10 edits, 2 new files. No new DB migration. No new ports, services, repositories, or modules.

---

## 8. Risks & Edge Cases

**R1 — `write-guard-coverage.spec.ts` must still pass after widening.**
The invariant only checks that write handlers have non-empty `@Roles()` metadata. `@Roles('admin', 'operator')` satisfies it. Verified by inspection of the test at `apps/api/src/auth/write-guard-coverage.spec.ts`.

**R2 — `viewer` behaviour must not regress.**
Viewers must remain blocked from all write endpoints. The widened guards allow admin OR operator; viewer is neither. Covered by the existing `viewer-role-authz.int-spec.ts` (no changes to it).

**R3 — Connection config redaction for operator.**
`ConnectionResponseDto.fromDomain(connection, supported, user?.role)` redacts `config` for any role that is not `'admin'`. `'operator'` is not `'admin'`, so redaction applies automatically. Verified by the config-redaction assertions in `operator-role-authz.int-spec.ts` (Step 3.2).

**R4 — `loginAs` helper role type drift.**
The `loginAs` helper currently has `role: 'admin' | 'viewer'`. After step 3.1, it must include `'operator'`. If the DB schema column is an enum or check constraint (it is a plain `TEXT` column with no constraint), the insert will succeed. Verified by reading the ORM entity and migration history.

**R5 — Risk R2 from spec: operator is analogy-validated, not adopter-validated.**
The spec notes: "keep write-scope minimal." The permission set in §4 deliberately excludes `products:write` and `sync:write`. If adopter feedback post-ship reveals these should be included, they can be added in a follow-up without any schema change.

**R6 — `UserRole` type surfaces in the JWT payload and JWT strategy.**
`JwtPayload.role` and `AuthenticatedUser.role` are typed as `UserRole`. After step 1.1, `UserRole` becomes `'admin' | 'operator' | 'viewer'`, which is a strictly additive change — all existing uses that compare to `'admin'` or `'viewer'` remain valid.

**R7 — `BootstrapAdminService` seeds with `role: 'admin'`.**
That string literal stays valid; no change needed there.

**R8 — Pre-existing viewer 403 on ShipmentController / PickupPointController.**
Before this issue, viewers (and operators, since both were blocked) got 403 on all shipment endpoints even though "Shipments" is a nav item visible to all. After step 2.6/2.7, operators gain access but viewers still 403. This is acceptable per spec ("Row-scoped data: operator sees all operational data; only secrets/admin controls are gated") — viewer's shipment access (if ever desired) is a separate future issue.

---

## 9. Questions & Assumptions

| # | Question | Assumption |
|---|---|---|
| Q1 | Should `sync:write` be granted to operators (allowing them to retry individual sync jobs from the job detail page)? | **No** — kept admin-only for MVP per spec's "keep write-scope minimal." Order-specific retries are covered by `orders:write`. Re-evaluate if adopter feedback demands it. |
| Q2 | Should `products:write` be included so operators can edit the product catalog? | **No** — "edit/publish listings" refers to marketplace offers. Product catalog edits are admin-level. |
| Q3 | Should viewer access to shipments (currently blocked by class-level guard) be fixed in this PR? | **No** — out of scope. This issue targets operator role only; viewer shipment access is independent. |
| Q4 | Is `inventory:write` meaningful now (no write endpoints on InventoryController)? | Yes — the permission is forward-compatible. Future inventory adjustment endpoints should gate on `inventory:write`, and operators will have it automatically once those ship. |
| Q5 | Does the FE need any `usePermission('inventory:write')` gate added? | **No** — there are currently no FE inventory write affordances. When inventory write endpoints + UI ship, they should use `usePermission('inventory:write')` from the start. |

---

## 10. Final Validation Checklist

- [x] Follows hexagonal architecture: change is additive to the type layer only; no new ports/adapters/services
- [x] Respects CORE vs Integration boundaries: role types live in `libs/core/src/users/domain/types/`
- [x] Uses existing patterns: `as const` union + `ROLE_PERMISSIONS` map (established in #1124)
- [x] `@Roles()` pattern already used by all affected controllers — no new mechanism introduced
- [x] No DB migration needed: `role` column is `TEXT` with no check constraint
- [x] `write-guard-coverage.spec.ts` invariant still satisfied after widening
- [x] Viewer regression covered by existing `viewer-role-authz.int-spec.ts` (unchanged)
- [x] Operator-specific assertions added in `operator-role-authz.int-spec.ts`
- [x] FE affordances automatic via `permissions[]` from `ROLE_PERMISSIONS['operator']`
- [x] No new ESLint warnings: additive type widening, no `any`, no pattern violations
- [x] No force-push to main; branch strategy per CLAUDE.md
- [x] Quality gate: `pnpm lint && pnpm type-check && pnpm test` must pass before commit
