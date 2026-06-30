# Pre-Implementation Analysis: #1125 User Management

**Plan**: `docs/plans/implementation-plan-1125-user-management.md`
**Gate run**: 2026-06-24
**Verdict**: **READY** (no Critical blockers; 7 Warnings to address during implementation)

---

## Reuse Findings

| Plan Artifact | Status | Path / Notes |
|---|---|---|
| `UserStatus` type / `UserStatusValues` | **NEW** | `libs/core/src/users/domain/types/user-status.types.ts` does not exist |
| `UserAlreadyExistsException` | **NEW** | Not in `libs/core/src/users/domain/exceptions/` |
| `UserNotPendingException` | **NEW** (missing from Phase 1) | Not in `libs/core/src/users/domain/exceptions/` — see W7 |
| `UserRepositoryPort` | **PARTIAL – extend** | `libs/core/src/users/domain/ports/user-repository.port.ts` — missing `findAll`, `updateStatus`, `updateRole`, `deleteById` |
| `User` entity | **PARTIAL – add `status` param** | `libs/core/src/users/domain/entities/user.entity.ts` — current constructor is 7 params (id, username, email, passwordHash, role, createdAt, updatedAt); plan inserts `status` as arg 6 |
| `UserOrmEntity` | **PARTIAL – add `status` column** | `libs/core/src/users/infrastructure/persistence/entities/user.orm-entity.ts` — no `status` column today |
| `UserRepository` | **PARTIAL – 4 new methods + `toDomain` update** | `libs/core/src/users/infrastructure/persistence/repositories/user.repository.ts` |
| Migration `1810000000000-add-user-status.ts` | **NEW** | Last migration is `1809000000000-add-order-fulfillment-state.ts`; next slot confirmed |
| `IRegistrationService` + `REGISTRATION_SERVICE_TOKEN` | **NEW** | `apps/api/src/auth/registration.service.interface.ts` (follows `PasswordResetService` pattern — token co-located in interface file) |
| `RegistrationService` | **NEW** | `apps/api/src/auth/registration.service.ts` |
| `IUserManagementService` + `USER_MANAGEMENT_SERVICE_TOKEN` | **NEW** | `apps/api/src/users/user-management.service.interface.ts` |
| `UserManagementService` | **NEW** | `apps/api/src/users/user-management.service.ts` |
| `UsersController` | **NEW** | `apps/api/src/users/http/users.controller.ts` |
| `UsersApiModule` | **NEW** | `apps/api/src/users/users.module.ts` |
| `AuthService.validateUser` | **PARTIAL – add status check** | `apps/api/src/auth/auth.service.ts:30–38` — no status gate today |
| `BootstrapAdminService.save` call | **PARTIAL – add `status: 'active'`** | `apps/api/src/auth/bootstrap-admin.service.ts:79` — must pass `status` once port signature changes |
| `users:read`, `users:write` in BE `PermissionValues` | **NEW** | `libs/core/src/users/domain/types/role.types.ts` — currently 16 permissions, none named `users:*` |
| `users:read`, `users:write` in FE `PermissionValues` | **NEW** | `apps/web/src/shared/auth/session.types.ts` — currently 14 permissions |
| FE feature barrel (`apps/web/src/features/users/`) | **NEW** | Directory does not exist |
| `RegisterPage` | **NEW** | `apps/web/src/pages/auth/RegisterPage.tsx` does not exist |
| `UsersPage` | **NEW** | `apps/web/src/pages/admin/UsersPage.tsx` does not exist |
| `registerRoute` (guest route) | **NEW** | `apps/web/src/app/router.tsx` — add to `guestRoutes` array |
| `usersRoute` (admin route) | **NEW** | `apps/web/src/app/routes/root.route.tsx` — add to `coreChildren` array |

---

## Backward-Compatibility Findings

### Critical — none

No exported barrel symbols are removed, no port methods are deleted, no DI tokens are renamed. All changes are additive.

### Warnings

**W1 — `User` entity constructor: 8 test files will break type-check**

The plan adds `status: UserStatus` as arg 6 (before `createdAt`). The single production caller (`UserRepository.toDomain`) is covered in plan Step 8. However, 8 test files construct `new User(...)` with the current 7-arg signature and will fail `pnpm type-check`:

- `apps/api/src/auth/auth.service.spec.ts` (line 19)
- `apps/api/src/auth/auth.controller.spec.ts` (line 33)
- `apps/api/src/auth/bootstrap-admin.service.spec.ts` (line 14)
- `apps/api/src/auth/password-reset.service.spec.ts` (line 19)
- `apps/api/src/auth/http/dto/user-response.dto.spec.ts` (lines 15, 25, 33, 42)

**Migration path**: update all 8 test files to pass `status: 'active'` (or the appropriate status) as arg 6 when constructing `new User(...)`. The plan only mentions `toDomain` (Step 8) — implementor must also update all spec files.

---

**W2 — `UserRepositoryPort.save` Pick signature gains `status`**

`BootstrapAdminService.save` at `apps/api/src/auth/bootstrap-admin.service.ts:79` passes `{ username, email, passwordHash, role: 'admin' }`. Once `status` is added to the Pick, this call becomes a type error.

**Migration path**: add `status: 'active'` to the `save` call in `BootstrapAdminService`. Plan Step 10 covers this. ✓

---

**W3 — `check-cross-context-imports` allow-list must be updated**

`RegistrationService` (in `apps/api/src/auth/`) and `UserManagementService` (in `apps/api/src/users/`) will import `UserRepositoryPort` from `@openlinker/core/users`. This pattern matches the `*RepositoryPort` deny shape in `scripts/check-cross-context-imports.mjs`. `BootstrapAdminService` follows the same pattern and is already allow-listed (tracking issue #722).

**Migration path**: add two entries to `ALLOW_LIST` in `scripts/check-cross-context-imports.mjs`:
- `apps/api/src/auth/registration.service.ts` → `UserRepositoryPort`
- `apps/api/src/users/user-management.service.ts` → `UserRepositoryPort`

The plan does not mention this — implementor must add these allow-list entries or the quality gate will fail on first `pnpm lint`.

---

**W4 — `deleteById` missing from Phase 1 port extension**

`deleteById(userId: string): Promise<void>` is needed by `rejectUser` (plan Step 15) but is only mentioned in a Note there. Phase 1 Step 4 lists `findAll`, `updateStatus`, `updateRole` but not `deleteById`.

**Migration path**: add `deleteById(userId: string): Promise<void>` to the `UserRepositoryPort` extension in Phase 1 Step 4, alongside the other new methods.

---

**W5 — FE nav-registry does not support item-level role gating**

Plan Step 31 says gate the "Users" nav entry via `usePermission('users:read')`. The `LiveNavItem` type in `apps/web/src/app/nav-registry.types.ts` has no `requiresRole` or permission field — only `LiveNavGroup` has `requiresRole?: Role`. Item-level gating is not supported by the current type system.

**Migration path (choose one)**:
- (a) Place the "Users" nav entry inside a new admin-only `LiveNavGroup` with `requiresRole: 'admin'`, so the entire group is hidden from non-admins.
- (b) Render the nav entry unconditionally (non-admin users will still be rejected at the API layer and the page route guard).

Option (a) is cleaner UX. Either avoids touching `LiveNavItem`'s type.

---

**W6 — Backend `PermissionValues` / `ROLE_PERMISSIONS` update placed in wrong phase**

Adding `users:read` and `users:write` to `libs/core/src/users/domain/types/role.types.ts` is a core domain change. The plan places it in Phase 6 (Frontend). It should be in Phase 1 (Core Domain), alongside the `UserStatus` types, because the FE `session.types.ts` sync is a downstream consumer of this definition — not a parallel peer.

Additionally, syncing `apps/web/src/shared/auth/session.types.ts` is not a numbered step in the plan; it only appears in prose.

**Migration path**: move the `PermissionValues` + `ROLE_PERMISSIONS` update to Phase 1 (or at minimum Phase 5 alongside the BE controller work). Add an explicit numbered step for the FE `session.types.ts` sync.

---

**W7 — `UserNotPendingException` not in Phase 1**

`UserNotPendingException` is referenced in plan Step 15 (for `approveUser`/`rejectUser`) but only as a Note. It should be created in Phase 1 Step 3 alongside `UserAlreadyExistsException`, so the exception exists before the service that uses it.

**Migration path**: add `UserNotPendingException` to Phase 1 Step 3 as an explicit deliverable.

---

## Open Questions

None that block implementation. The plan's Questions & Assumptions section already calls out the `OL_REGISTRATION_ENABLED` default (`false`) and the migration slot — both confirmed correct.

---

## Summary

The plan is architecturally sound and follows established patterns (`PasswordResetService`, `AiApiModule`). No new abstractions are invented; all additions extend existing `users` context artifacts. The seven warnings are all resolvable within the implementation steps — the most time-sensitive are **W1** (8 test files need a `status` arg added before `pnpm type-check` passes) and **W3** (the invariant-checker allow-list must be updated before `pnpm lint` passes). Recommend addressing W4 and W7 by amending Phase 1 steps before starting work, and deciding the nav-registry strategy (W5) at the start of the FE phase.
