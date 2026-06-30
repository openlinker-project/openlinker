# Pre-Implementation Analysis: Operator Role — Write-Scoped Delegation (#1126)

**Plan**: `docs/plans/implementation-plan-1126-operator-role.md`
**Gate run**: 2026-06-25
**Verdict**: ✅ READY

---

## Reuse Audit

| Plan artifact | Status | Live path |
|---|---|---|
| `UserRoleValues` + `UserRole` type | PARTIAL — extend existing | `libs/core/src/users/domain/types/role.types.ts:17` |
| `ROLE_PERMISSIONS` map | PARTIAL — extend existing | `libs/core/src/users/domain/types/role.types.ts:59` |
| `PermissionValues` / `Permission` type | EXISTS — reused, no change | `libs/core/src/users/domain/types/role.types.ts:27` |
| `@Roles()` decorator | EXISTS — reused, no change | `apps/api/src/auth/decorators/roles.decorator.ts:15` |
| `RolesGuard` | EXISTS — reused, no change | `apps/api/src/auth/guards/roles.guard.ts` |
| `JwtPayload.role` / `AuthenticatedUser.role` | EXISTS — auto-widens with type | `apps/api/src/auth/auth.types.ts:15,25` |
| `OrdersController.retryDestination` guard | EXISTS — widen | `apps/api/src/orders/http/orders.controller.ts:181` |
| `ListingsController` 9 guards | EXISTS — widen | `apps/api/src/listings/http/listings.controller.ts:237,281,314,382,401,457,508,564,617` |
| `BulkListingController` 2 guards | EXISTS — widen | `apps/api/src/listings/http/bulk-listing.controller.ts:72,147` |
| `ShopPublishController` 1 guard | EXISTS — widen | `apps/api/src/listings/http/shop-publish.controller.ts:52` |
| `BulkShopPublishController` 1 guard | EXISTS — widen | `apps/api/src/listings/http/bulk-shop-publish.controller.ts:52` |
| `ShipmentController` class guard | EXISTS — widen | `apps/api/src/shipping/http/shipment.controller.ts` (class-level) |
| `PickupPointController` class guard | EXISTS — widen | `apps/api/src/shipping/http/pickup-point.controller.ts` (class-level) |
| `write-guard-coverage.spec.ts` CONTROLLERS list | EXISTS — extend (add 2) | `apps/api/src/auth/write-guard-coverage.spec.ts:41` |
| `loginAs` role union | EXISTS — widen | `apps/api/test/integration/helpers/test-auth.helper.ts:24` |
| `loginAsOperator` helper | NEW — create | — |
| `operator-role-authz.int-spec.ts` | NEW — create | — |
| `viewer-role-authz.int-spec.ts` (reference) | EXISTS | `apps/api/test/integration/viewer-role-authz.int-spec.ts` |
| `role.types.spec.ts` (unit test) | NEW — create | — |
| `nav-registry.types.ts` `RoleValues` | EXISTS — widen | `apps/web/src/app/nav-registry.types.ts:26` |
| `docs/specs/product-spec-1123-rbac-depth.md` | EXISTS — update matrix | `docs/specs/product-spec-1123-rbac-depth.md` |

No reinvention found. Every infrastructure piece (type system, guard, DTO redaction, barrel export) already exists and will absorb the `operator` addition naturally.

---

## Backward-Compatibility Findings

### ✅ No Critical breaks

| Surface | What was checked | Result |
|---|---|---|
| `@openlinker/core/users` barrel | `UserRole`, `UserRoleValues`, `ROLE_PERMISSIONS`, `Permission`, `PermissionValues` all exported via `libs/core/src/users/index.ts:22–27`. Adding `operator` to `UserRoleValues` widens the union additively — no existing named export removed or renamed. | Safe |
| `@Roles()` decorator signature | `roles.decorator.ts:15` uses `...roles: UserRole[]`. Adding `'operator'` to `UserRole` makes `@Roles('admin', 'operator')` a valid call; all existing `@Roles('admin')` and `@Roles('viewer')` sites continue to compile. | Safe |
| `RolesGuard` | Uses `.includes(user.role)` against the `UserRole[]` metadata. Purely runtime inclusion check — no exhaustive switch. Adding a new value does not break the guard. | Safe |
| `ROLE_PERMISSIONS` type constraint | Typed as `Record<UserRole, readonly Permission[]>`. Once `UserRole` expands to include `'operator'`, TypeScript **will require** the `operator` key in the const — the plan adds it in step 1.1. Compile-time enforcement, not a break. | Safe (plan handles it) |
| `JwtPayload` / `AuthenticatedUser` | Both use `role: UserRole`. Additive change — new JWT tokens with `role: 'operator'` will decode correctly; old tokens with `role: 'admin'` or `role: 'viewer'` are unaffected. | Safe |
| `ConnectionResponseDto.fromDomain` redaction | `connection-response.dto.ts:85` uses `role === 'admin' ? connection.config : {}`. `'operator' !== 'admin'` → config is redacted for operators, matching the plan's risk R3 analysis. **No change needed here.** | Safe (confirmed) |
| `loginAs` helper | Currently typed `role: 'admin' | 'viewer'`. The plan widens to `role: 'admin' | 'operator' | 'viewer'`. All existing call sites passing `'admin'` or `'viewer'` continue to compile and run unchanged. | Safe |
| User ORM entity `role` column | `user.orm-entity.ts:32` is `varchar(50)` with no `CHECK` constraint or Postgres `ENUM` type. No migration required. | Safe (confirmed) |

### ⚠️ One Warning: plan text truncation in step 2.5

The plan text for step 2.5 is truncated — it reads "...`bulk-shop-publisChange the class-level decorator...`" (steps 2.5 and 2.6 appear merged in the document). However:
- The **file change table (§7)** correctly lists `bulk-shop-publish.controller.ts` and `shipment.controller.ts` as separate entries.
- The actual `bulk-shop-publish.controller.ts` has a **handler-level** `@Roles('admin')` at line 52, not a class-level decorator (the plan description says "class-level" in step 2.6 for shipment — that is correct for shipment; bulk-shop-publish is handler-level). The end result (widen the guard) is identical.

**Remediation**: none required for implementation; the file table in §7 is the authoritative change list.

---

## Open Questions

None that block implementation. The plan addresses all risk items explicitly:

| Risk | Plan's resolution | Confirmed by gate |
|---|---|---|
| `write-guard-coverage.spec.ts` still passes | `@Roles('admin', 'operator')` satisfies the "non-empty roles metadata" check | ✅ |
| Viewer regression | Existing `viewer-role-authz.int-spec.ts` unchanged | ✅ file exists |
| Config redaction for operator | `role === 'admin'` check is identity-exact; operator is automatically redacted | ✅ confirmed |
| No DB migration | `role` column is `TEXT`, no constraint | ✅ confirmed |
| `BootstrapAdminService` seeds `role: 'admin'` | String literal stays valid | ✅ confirmed |

---

## Implementation Order Note

TypeScript will fail to compile after step 1.1 (adding `'operator'` to `UserRoleValues`) until the `operator` key is added to `ROLE_PERMISSIONS`. Both changes must be committed together in a single step. The plan groups them correctly in step 1.1.

---

*Gate produced no edits to the plan or source. Revising is the implementer's next step.*
