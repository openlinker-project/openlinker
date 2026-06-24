# Implementation Plan: Self-Service Registration + Admin Approval + User-Management UI

**Date**: 2026-06-24
**Status**: Ready for Review
**Estimated Effort**: M — 3–5 days
**Issue**: #1125 (parent: #1123 RBAC depth spec)

---

## 1. Task Summary

**Objective**: Close the usability gap so users can be created and managed from the product UI — no DB access required. Adds self-service registration (when enabled), an admin approval queue with role assignment (approve/reject), and a user-management screen (role change, deactivate/reactivate).

**Context**: OpenLinker currently has zero user-management surface — users exist only via DB seed or migration. The two-role seam (`admin` / `viewer`, `RolesGuard`, `@Roles('admin')`) is in place but inert as a delegation mechanism: there's no way to create or manage users from the product. This blocks the public demo (#1127) and real team delegation (#1126), both of which require at least two independently managed accounts. This issue adds the lifecycle primitives (registration, status transitions, admin controls) that the siblings depend on.

**Classification**: CORE (domain types + entity + port extension) + Infrastructure (ORM + repository + migration) + Interface (controllers + DTOs) + Frontend (feature, pages, routes)

---

## 2. Scope & Non-Goals

### In Scope
- New `UserStatus` domain type: `pending | active | deactivated`
- `status` column on `users` table (migration `1810000000000-add-user-status.ts`)
- Updated `User` entity with `status` field
- New `UserRepositoryPort` methods: `findAll`, `updateStatus`, `updateRole`
- Login rejection for non-active users (status check in `AuthService.validateUser`)
- `POST /auth/register` (public, gated by `OL_REGISTRATION_ENABLED` env flag)
- `RegistrationService` — creates a `pending` user, respects the env flag
- `GET /users`, `POST /users/:id/approve`, `POST /users/:id/reject`, `PATCH /users/:id/role`, `PATCH /users/:id/status` (all `@Roles('admin')`)
- `UserManagementService` — orchestrates all admin user operations
- New `apps/api/src/users/` module wired into `AppModule`
- FE feature `apps/web/src/features/users/` (API layer, hooks, components)
- Registration page (`/register`, guest route)
- Admin Users page (`/admin/users`, tabs: All users | Pending)
- Unit tests for `RegistrationService` and `UserManagementService`
- `write-guard-coverage.spec.ts` extended with `UsersController`

### Out of Scope
- Secret redaction / read gating → #1124
- Operator role → #1126
- `OL_DEMO_MODE` auto-approve → #1127
- Email verification
- Password-strength UX (password strength meter, zxcvbn)
- SSO / SAML
- Audit log

### Constraints
- Migration timestamp must be next after `1809000000000` → `1810000000000`
- Existing `admin` bootstrap user must migrate with `status = 'active'` (migration default)
- The `OL_REGISTRATION_ENABLED` env flag defaults to `false` (conservative — self-hosters must explicitly opt in)
- No force-logout of active sessions on role change (takes effect on next JWT refresh, per spec)
- Self-protection: admin cannot deactivate or demote their own account (enforced at API layer)

---

## 3. Architecture Mapping

**Target Layers**: CORE domain (types, entity, port) + Infrastructure (ORM entity, repository, migration) + Interface (NestJS controllers at `apps/api/src/`) + Frontend (`apps/web/src/`)

**Capabilities Involved**: None of the existing capability ports (`ProductMasterPort`, etc.) are touched. This is a pure identity/lifecycle domain extension.

**Existing Services Reused**:
- `AuthService` — extended to check `user.status` in `validateUser`
- `UserRepository` / `UserRepositoryPort` — extended with new port methods
- `BootstrapAdminService` — `save` call updated to pass `status: 'active'`
- `JwtAuthGuard` + `RolesGuard` + `@Public()` — used as-is
- `ROLE_PERMISSIONS` map — read by `UserResponseDto.fromDomain` already; new roles added by #1126 appear automatically

**New Components Required**:
- `UserStatus` type + `UserStatusValues` const (`libs/core/src/users/domain/types/user-status.types.ts`)
- `UserAlreadyExistsException` (`libs/core/src/users/domain/exceptions/`)
- `RegistrationService` + `IRegistrationService` (`apps/api/src/auth/`)
- `UserManagementService` + `IUserManagementService` (`apps/api/src/users/`)
- `UsersController` + DTOs (`apps/api/src/users/`)
- `UsersApiModule` (`apps/api/src/users/users.module.ts`)
- Migration `1810000000000-add-user-status.ts`
- FE feature `apps/web/src/features/users/`
- FE pages `RegisterPage`, `UsersPage`
- FE routes `registerRoute`, `usersRoute`

**Core vs Integration Justification**: User lifecycle (status, registration, admin controls) is platform-agnostic domain logic. It lives in `libs/core/src/users/` (domain types, port extension, entity) and `apps/api/src/` (application services, controllers). No integration adapters are involved.

---

## 4. External / Domain Research

### Internal Patterns
- **Similar service pair**: `PasswordResetService` (in `apps/api/src/auth/`) + `IPasswordResetService` (`password-reset.service.interface.ts`) — exact pattern to follow for `RegistrationService`
- **Similar admin module**: `apps/api/src/ai/` (admin-only endpoints, separate module imported by `AppModule`) — pattern for `UsersApiModule`
- **Migration convention**: 13-digit synthetic sequential prefix (`docs/migrations.md`), next free slot is `1810000000000`
- **Guard extension**: `write-guard-coverage.spec.ts` enumerates controllers; `UsersController` must be added there

### Known Gaps Being Addressed
- `UserRepositoryPort.save` signature uses `Pick<User, 'username' | 'email' | 'passwordHash' | 'role'>` — needs `status` added
- `User` entity has no `status` field
- `AuthService.validateUser` has no status check — deactivated/pending users would currently log in if their password is correct

---

## 5. Questions & Assumptions

### Open Questions
- **Login message for pending/deactivated**: Return generic "Invalid credentials" (no enumeration) or a specific "Account pending approval" message? **Assumption**: generic 401 for security — no account enumeration via login endpoint.
- **Reject behaviour**: Hard-delete the pending user row, or soft-mark as `rejected`? **Assumption**: hard-delete (simpler; rejected users can re-register if registration is re-enabled; no audit requirement in v1). A separate `rejected` status can be added when audit logs ship (#1128 territory).
- **Registration with an existing `pending` username**: Should a duplicate registration be rejected with a distinct error or merged? **Assumption**: rejected with 409 (same as active user), so the requester can't probe which accounts exist.

### Assumptions
- `OL_REGISTRATION_ENABLED` defaults to `false`; must be explicitly set to `true` to open registration
- The `BootstrapAdminService`-seeded `admin` user gets `status = 'active'` via the migration column default — no code change needed to `BootstrapAdminService.bootstrap()` for the migration path, but the `save()` call should explicitly pass `status: 'active'` going forward for clarity
- All existing users in the DB at migration time get `status = 'active'` via the `DEFAULT 'active'` migration constraint — safe, no manual backfill needed
- Role change takes effect on next session (next token refresh) — documented in the API response, no immediate session invalidation
- An admin cannot deactivate themselves or change their own role via the admin API — rejected with 403 at the application service layer
- Pending users are excluded from the `GET /users` response (they appear only on `GET /users?status=pending`) — simplest tab model for the FE

---

## 6. Proposed Implementation Plan

### Phase 1 — Core Domain Extension

**Goal**: Add `UserStatus` to the domain layer. No runtime change yet — just new types and entity shape.

**Steps**:

1. **Add `UserStatus` type**
   - **File**: `libs/core/src/users/domain/types/user-status.types.ts` (NEW)
   - **Action**: Define `UserStatusValues = ['pending', 'active', 'deactivated'] as const` and `UserStatus` union type. Follow the `as const` + union pattern from `role.types.ts`.
   - **Acceptance**: `UserStatus` and `UserStatusValues` importable from the file.

2. **Extend `User` entity**
   - **File**: `libs/core/src/users/domain/entities/user.entity.ts` (MODIFY)
   - **Action**: Add `status: UserStatus` as the 6th constructor parameter (before `createdAt`). Update the constructor signature.
   - **Acceptance**: `User` instances have `.status`.
   - **Dependencies**: Step 1

3. **Add `UserAlreadyExistsException`**
   - **File**: `libs/core/src/users/domain/exceptions/user-already-exists.exception.ts` (NEW)
   - **Action**: `export class UserAlreadyExistsException extends Error` with message `User already exists: ${username}`. Follow pattern of `UserNotFoundException`.
   - **Acceptance**: Exception is constructable.

4. **Extend `UserRepositoryPort`**
   - **File**: `libs/core/src/users/domain/ports/user-repository.port.ts` (MODIFY)
   - **Action**: Add three methods:
     ```typescript
     findAll(opts?: { status?: UserStatus; page?: number; pageSize?: number }): Promise<{ users: User[]; total: number }>;
     updateStatus(userId: string, status: UserStatus): Promise<void>;
     updateRole(userId: string, role: UserRole): Promise<void>;
     ```
     Also update `save` to include `status` in the Pick: `Pick<User, 'username' | 'email' | 'passwordHash' | 'role' | 'status'>`.
   - **Acceptance**: TypeScript compiles; `UserRepository` will show type errors until updated in Phase 3.
   - **Dependencies**: Steps 1, 2

5. **Export from `users/index.ts`**
   - **File**: `libs/core/src/users/index.ts` (MODIFY)
   - **Action**: Export `UserStatusValues`, `UserStatus`, `UserAlreadyExistsException` from the barrel.
   - **Acceptance**: Importable from `@openlinker/core/users`.

---

### Phase 2 — Database Migration

**Goal**: Add the `status` column to the `users` table. Safe migration — defaults all rows to `active`.

**Steps**:

6. **Create migration**
   - **File**: `apps/api/src/migrations/1810000000000-add-user-status.ts` (NEW)
   - **Action**:
     ```typescript
     export class AddUserStatus1810000000000 implements MigrationInterface {
       async up(queryRunner: QueryRunner): Promise<void> {
         await queryRunner.query(`
           ALTER TABLE "users"
           ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'active'
         `);
       }
       async down(queryRunner: QueryRunner): Promise<void> {
         await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "status"`);
       }
     }
     ```
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` shows this migration as pending. Running `migration:run` applies it. Existing rows get `status = 'active'`.

---

### Phase 3 — Infrastructure (ORM Entity + Repository)

**Goal**: Wire the new `status` column into the TypeORM layer and implement new port methods.

**Steps**:

7. **Update `UserOrmEntity`**
   - **File**: `libs/core/src/users/infrastructure/persistence/entities/user.orm-entity.ts` (MODIFY)
   - **Action**: Add `@Column({ type: 'varchar', length: 20, default: 'active' }) status!: string;`
   - **Acceptance**: TypeORM recognizes the `status` column.

8. **Update `UserRepository`**
   - **File**: `libs/core/src/users/infrastructure/persistence/repositories/user.repository.ts` (MODIFY)
   - **Action**:
     - Update `toDomain` to pass `entity.status` (validated against `UserStatusValues`, fallback `'active'`) as 6th argument.
     - Update `save` to persist `user.status` (now in the Pick).
     - Implement `findAll({ status, page = 0, pageSize = 25 })` using `this.ormRepository.findAndCount`.
     - Implement `updateStatus(userId, status)` using `this.ormRepository.update`.
     - Implement `updateRole(userId, role)` using `this.ormRepository.update`.
   - **Acceptance**: TypeScript compiles, all `UserRepositoryPort` methods implemented. Existing unit test suite (`user.repository.spec.ts` if any) still passes.
   - **Dependencies**: Steps 1, 2, 4, 6, 7

---

### Phase 4 — Application Services (API Layer)

**Goal**: Add `RegistrationService` (creates pending users) and `UserManagementService` (admin CRUD), and harden login to reject non-active users.

**Steps**:

9. **Harden `AuthService.validateUser` for status**
   - **File**: `apps/api/src/auth/auth.service.ts` (MODIFY)
   - **Action**: After password comparison succeeds, check `user.status === 'active'`. Return `null` if not (same as wrong password — no enumeration). The caller's 401 message remains "Invalid credentials".
   - **Acceptance**: A `pending` or `deactivated` user whose password is correct gets 401, not a session.
   - **Test**: Update `auth.service.spec.ts` — add cases for `status: 'pending'` and `status: 'deactivated'` returning `null`.
   - **Dependencies**: Step 2

10. **Update `BootstrapAdminService`**
    - **File**: `apps/api/src/auth/bootstrap-admin.service.ts` (MODIFY)
    - **Action**: Pass `status: 'active'` explicitly in the `this.userRepository.save(...)` call.
    - **Acceptance**: Bootstrap admin is always created active; compiles cleanly after port update.

11. **Create `IRegistrationService`**
    - **File**: `apps/api/src/auth/registration.service.interface.ts` (NEW)
    - **Action**:
      ```typescript
      export interface IRegistrationService {
        register(input: { username: string; email: string; password: string }): Promise<void>;
      }
      export const REGISTRATION_SERVICE_TOKEN = Symbol('IRegistrationService');
      ```
    - **Acceptance**: Interface and token exported.

12. **Create `RegistrationService`**
    - **File**: `apps/api/src/auth/registration.service.ts` (NEW)
    - **Action**:
      - `implements IRegistrationService`
      - Constructor injects `ConfigService`, `UserRepositoryPort` (via `USER_REPOSITORY_TOKEN`)
      - `register(input)`:
        1. Read `OL_REGISTRATION_ENABLED` (default `false`) — throw `RegistrationDisabledException` if not `'true'`
        2. Check uniqueness — `findByUsername` + `findByEmail` — throw `UserAlreadyExistsException` on collision
        3. Hash password with bcrypt (cost 10)
        4. Call `userRepository.save({ username, email, passwordHash, role: 'viewer', status: 'pending' })`
    - **Note**: Default role `viewer` (least-privileged) — admin assigns actual role on approval.
    - **Acceptance**: Service compiles, injects correctly.

13. **Create `RegistrationService` unit tests**
    - **File**: `apps/api/src/auth/registration.service.spec.ts` (NEW)
    - **Test cases**:
      - `should throw when OL_REGISTRATION_ENABLED is false`
      - `should throw UserAlreadyExistsException when username is taken`
      - `should throw UserAlreadyExistsException when email is taken`
      - `should save a pending user with hashed password when registration is enabled`
    - **Mocking**: `UserRepositoryPort` mocked, `ConfigService` mocked.

14. **Create `IUserManagementService`**
    - **File**: `apps/api/src/users/user-management.service.interface.ts` (NEW)
    - **Action**:
      ```typescript
      export interface IUserManagementService {
        listUsers(opts: { status?: UserStatus; page?: number; pageSize?: number }): Promise<{ users: User[]; total: number }>;
        approveUser(userId: string, role: UserRole, actorId: string): Promise<void>;
        rejectUser(userId: string, actorId: string): Promise<void>;
        changeRole(userId: string, role: UserRole, actorId: string): Promise<void>;
        changeStatus(userId: string, status: 'active' | 'deactivated', actorId: string): Promise<void>;
      }
      export const USER_MANAGEMENT_SERVICE_TOKEN = Symbol('IUserManagementService');
      ```
    - Note: `actorId` is the caller's userId — used to enforce self-protection.

15. **Create `UserManagementService`**
    - **File**: `apps/api/src/users/user-management.service.ts` (NEW)
    - **Action**: `implements IUserManagementService`; injects `UserRepositoryPort` (via `USER_REPOSITORY_TOKEN`).
      - `listUsers`: delegates to `userRepository.findAll(opts)`
      - `approveUser(userId, role, actorId)`:
        1. `findById(userId)` — throw `UserNotFoundException` if not found
        2. Check `user.status === 'pending'` — throw `UserNotPendingException` (new) otherwise
        3. Call `updateRole(userId, role)`, then `updateStatus(userId, 'active')`
      - `rejectUser(userId, actorId)`:
        1. Verify user exists and is `pending`
        2. Hard-delete via new `deleteById` repo method (see below)
      - `changeRole(userId, role, actorId)`:
        1. Self-protection: throw if `userId === actorId`
        2. `findById`, verify `status === 'active'`
        3. `updateRole`
      - `changeStatus(userId, newStatus, actorId)`:
        1. Self-protection: throw if `userId === actorId` and newStatus is `deactivated`
        2. `findById`, `updateStatus`
    - **Note**: `deleteById` needs to be added to `UserRepositoryPort` for `rejectUser`. Add `deleteById(userId: string): Promise<void>` to the port (Step 4 extension). Implement in `UserRepository` using `this.ormRepository.delete({ id: userId })`.
    - **Acceptance**: All service methods callable.

16. **Create `UserManagementService` unit tests**
    - **File**: `apps/api/src/users/user-management.service.spec.ts` (NEW)
    - **Test cases**:
      - `approveUser should activate a pending user with the given role`
      - `approveUser should throw UserNotPendingException when user is not pending`
      - `rejectUser should delete a pending user`
      - `changeRole should throw when actor is changing their own role`
      - `changeStatus should throw when actor is deactivating themselves`
      - `changeStatus should deactivate an active user`
      - `changeStatus should reactivate a deactivated user`
    - **Mocking**: `UserRepositoryPort` mocked.

---

### Phase 5 — API Controllers & Module

**Goal**: Expose registration and user-management endpoints, wire into `AppModule`.

**Steps**:

17. **Add `POST /auth/register` to `AuthController`**
    - **File**: `apps/api/src/auth/auth.controller.ts` (MODIFY)
    - **Action**: Add endpoint:
      ```typescript
      @Public()
      @Post('register')
      @HttpCode(HttpStatus.CREATED)
      async register(@Body() dto: RegisterDto): Promise<OkResponseDto> { ... }
      ```
      Map `RegistrationDisabledException` → 403. Map `UserAlreadyExistsException` → 409. Return `{ ok: true }` on success.
    - **DTOs**: New `apps/api/src/auth/dto/register.dto.ts`:
      ```typescript
      export class RegisterDto {
        @IsString() @IsNotEmpty() @MinLength(3) @MaxLength(50) username: string;
        @IsEmail() email: string;
        @IsString() @MinLength(8) @MaxLength(72) password: string;
      }
      ```
    - **Acceptance**: `POST /auth/register` returns 201 when registration is enabled and data is valid.

18. **Wire `RegistrationService` into `AuthModule`**
    - **File**: `apps/api/src/auth/auth.module.ts` (MODIFY)
    - **Action**: Add `RegistrationService` to `providers`, bind `REGISTRATION_SERVICE_TOKEN`.
    - **Acceptance**: `AuthController` can inject the service.

19. **Create `UsersController` DTOs**
    - **Files** (NEW under `apps/api/src/users/dto/`):
      - `user-list-query.dto.ts`: `page`, `pageSize`, `status` (optional, `UserStatus`)
      - `approve-user.dto.ts`: `role: UserRole` (`@IsIn(UserRoleValues)`)
      - `change-role.dto.ts`: `role: UserRole`
      - `change-status.dto.ts`: `status: 'active' | 'deactivated'`
      - `user-response.dto.ts`: `id, username, email, role, status, createdAt` (no password hash)
      - `paginated-users-response.dto.ts`: `{ users: UserResponseDto[], total: number, page: number, pageSize: number }`

20. **Create `UsersController`**
    - **File**: `apps/api/src/users/http/users.controller.ts` (NEW)
    - **Action**:
      ```
      @Controller('users')
      @Roles('admin')
      export class UsersController {
        GET  /users                → listUsers (query: status, page, pageSize)
        POST /users/:id/approve   → approveUser (body: role)
        POST /users/:id/reject    → rejectUser
        PATCH /users/:id/role     → changeRole (body: role)
        PATCH /users/:id/status   → changeStatus (body: status)
      }
      ```
    - **Acceptance**: All 5 endpoints compile and are decorated with `@Roles('admin')`.

21. **Update `write-guard-coverage.spec.ts`**
    - **File**: `apps/api/src/auth/write-guard-coverage.spec.ts` (MODIFY)
    - **Action**: Add `UsersController` to the `CONTROLLERS` array. All write methods on `UsersController` (`POST`, `PATCH`) must carry `@Roles('admin')`.
    - **Acceptance**: The spec still passes.

22. **Create `UsersApiModule`**
    - **File**: `apps/api/src/users/users.module.ts` (NEW)
    - **Action**:
      ```typescript
      @Module({
        imports: [UsersModule],  // from @openlinker/core/users
        controllers: [UsersController],
        providers: [
          UserManagementService,
          { provide: USER_MANAGEMENT_SERVICE_TOKEN, useExisting: UserManagementService },
        ],
      })
      export class UsersApiModule {}
      ```
    - **Acceptance**: Module compiles, injects `USER_REPOSITORY_TOKEN` transitively from `UsersModule`.

23. **Register `UsersApiModule` in `AppModule`**
    - **File**: `apps/api/src/app.module.ts` (MODIFY)
    - **Action**: Add `UsersApiModule` to `imports`.
    - **Acceptance**: API server boots without errors.

---

### Phase 6 — Frontend

**Goal**: Add the registration page (guest route) and the admin Users page (authenticated, admin-only).

**Steps**:

24. **Create FE feature barrel**
    - **File**: `apps/web/src/features/users/index.ts` (NEW)
    - **Action**: Re-export public-surface symbols (API, hooks, components) as the feature grows. Start with an empty barrel and add as steps below complete.

25. **Create API layer**
    - **Files** (NEW under `apps/web/src/features/users/api/`):
      - `users.types.ts`: `UserStatus`, `UserRole`, `RegisterRequest`, `ApproveUserRequest`, `ChangeRoleRequest`, `ChangeStatusRequest`, `UserResponse`, `PaginatedUsersResponse`
      - `users.api.ts`: `createUsersApi(request)` — `register`, `listUsers`, `approveUser`, `rejectUser`, `changeRole`, `changeStatus`
    - **Acceptance**: Types and API factory are typed; no `any`.

26. **Create hooks**
    - **Files** (NEW under `apps/web/src/features/users/hooks/`):
      - `use-register.ts`: Wraps `useMutation` for `POST /auth/register`.
      - `use-users.ts`: Wraps `useQuery` for `GET /users` (with status/pagination params).
      - `use-pending-users.ts`: Wraps `useQuery` for `GET /users?status=pending` (used for the badge count).
      - `use-approve-user.ts`, `use-reject-user.ts`, `use-change-role.ts`, `use-change-status.ts`: Mutation hooks that invalidate the users query on success.
    - **Acceptance**: Each hook returns correct `{ data, isLoading, mutate }` shape.

27. **Create components**
    - **Files** (NEW under `apps/web/src/features/users/components/`):
      - `RegisterForm.tsx`: Controlled form (React Hook Form + Zod). Fields: `username`, `email`, `password`, `confirmPassword`. Submits via `useRegister`. Shows success state inline (no redirect — user waits for approval). Shows field-level errors.
      - `PendingUsersTable.tsx`: Table of pending registrations. Each row has role select (defaulting to `viewer`) + Approve button (fires `useApproveUser`) + Reject button (fires `useRejectUser` after confirmation dialog).
      - `UsersTable.tsx`: Table of all non-pending users. Each row: username, email, status badge, role inline-select (fires `useChangeRole` on change), deactivate/reactivate button (fires `useChangeStatus`). Disables role-change and deactivate for the current session user (compared via `useSession().user?.id`).

28. **Create pages**
    - **File**: `apps/web/src/pages/auth/RegisterPage.tsx` (NEW)
      - Layout: `GuestLayout` wrapping `section.guest-page` → `RegisterForm`. Link "Already have an account? Sign in" to `/login`.
    - **File**: `apps/web/src/pages/admin/UsersPage.tsx` (NEW)
      - Tabs using Radix `Tabs` primitive: "All users" | "Pending (N)". Pending badge count from `usePendingUsers().data?.total`. Tab content: `UsersTable` (All) / `PendingUsersTable` (Pending). Filter bar on All tab: search input (client-side filter on already-fetched page) + status chip filters.

29. **Create routes**
    - **File**: `apps/web/src/app/routes/register.route.tsx` (NEW):
      ```typescript
      export const registerRoute: RouteObject = {
        path: '/register',
        element: <GuestLayout />,
        children: [{ index: true, element: <RegisterPage /> }],
      };
      ```
      Keep eager (not lazy) — same reasoning as `loginRoute` (first paint for unauthenticated visitors).
    - **File**: `apps/web/src/app/routes/users.route.tsx` (NEW):
      ```typescript
      export const usersRoute: RouteObject = {
        path: 'admin/users',
        handle: { crumb: { group: 'Platform', title: 'Users' } } satisfies RouteCrumbHandle,
        lazy: async () => {
          const { UsersPage } = await import('../../pages/admin/UsersPage');
          return { Component: UsersPage };
        },
      };
      ```

30. **Wire routes into router**
    - **File**: `apps/web/src/app/router.tsx` (MODIFY): Add `registerRoute` to `guestRoutes`.
    - **File**: `apps/web/src/app/routes/root.route.tsx` (MODIFY): Add `usersRoute` to `coreChildren`.
    - **Acceptance**: `/register` is reachable unauthenticated; `/admin/users` renders for admin sessions.

31. **Add nav entry**
    - **File**: `apps/web/src/app/nav-registry.ts` (MODIFY — verify exact pattern): Add a "Users" entry under the "Platform" group, visible only when `usePermission('users:read')` returns true (or role === admin for now, matching how other admin-only nav items are gated). The permission string `users:read` will be added to `ROLE_PERMISSIONS` in `role.types.ts` (admin only) in this step.
    - **Note**: Adding `users:read` to `PermissionValues` and `ROLE_PERMISSIONS` is a small extension to the core role types — it follows the existing pattern and does not require a migration.
    - **Acceptance**: "Users" nav link appears only for admin sessions.

32. **Add "Sign up" link to `LoginPage`**
    - **File**: `apps/web/src/pages/auth/LoginPage.tsx` (MODIFY): When `OL_REGISTRATION_ENABLED` is surfaced (see note below), conditionally render a "Don't have an account? Request access" link to `/register`. Implementation note: expose this as a build-time flag `VITE_REGISTRATION_ENABLED` (set from the deployment env). If not set, link is hidden. API-side check is still authoritative.

33. **`route-lazy.test.ts` coverage**
    - **File**: `apps/web/src/app/routes/route-lazy.test.ts` (no change needed if `usersRoute` uses `lazy`): The existing test iterates all lazy routes and asserts they resolve to a `Component`. `usersRoute` is lazy, so it is automatically covered. `registerRoute` is eager — also not subject to the lazy test.
    - **Acceptance**: `pnpm test` in `apps/web` passes.

---

### Phase 7 — Quality Gate

**Steps**:

34. **Run the quality gate**
    ```bash
    pnpm lint          # zero errors
    pnpm type-check    # zero errors
    pnpm test          # all unit tests pass
    pnpm --filter @openlinker/api migration:show  # 1810000000000 listed as pending
    ```

35. **Manual smoke test**
    - Start API + web (`pnpm start:dev:api`, `pnpm start:dev:web`), run migration.
    - Set `OL_REGISTRATION_ENABLED=true` in local `.env`.
    - Visit `/register`, submit a form, verify 201 response.
    - Log in as `admin`, navigate to `/admin/users` → Pending tab, approve the user.
    - Log in as the approved user, verify session works.
    - Admin deactivates the user; attempt login again, verify 401.

---

## 7. Implementation Details

### New Domain Types
```
libs/core/src/users/domain/types/user-status.types.ts
  UserStatusValues = ['pending', 'active', 'deactivated'] as const
  UserStatus = (typeof UserStatusValues)[number]
```

### Updated `UserRole` / Permissions
No new roles in this issue (operator is #1126). Add `users:read` and `users:write` to:
- `PermissionValues` in `libs/core/src/users/domain/types/role.types.ts`
- `ROLE_PERMISSIONS.admin` (both)
- `ROLE_PERMISSIONS.viewer` — no user permissions (viewer cannot manage users)
- FE `PermissionValues` in `apps/web/src/shared/auth/session.types.ts` — keep in sync

### Configuration Changes
- `OL_REGISTRATION_ENABLED` — boolean env var, default `false`. Consumed by `RegistrationService`.
- `VITE_REGISTRATION_ENABLED` — frontend build-time flag, controls whether the "Sign up" link is shown on the login page.

### Database Migration
```sql
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'active';
```
Existing rows (including bootstrap admin) get `'active'`. No data backfill needed.

### New Exceptions (libs/core/src/users/domain/exceptions/)
- `UserAlreadyExistsException` — thrown when username or email is taken
- `UserNotPendingException` — thrown when attempting to approve/reject a non-pending user

### HTTP API Summary
| Method | Path | Guard | Description |
|---|---|---|---|
| POST | `/auth/register` | `@Public()` | Self-register; gated by `OL_REGISTRATION_ENABLED` |
| GET | `/users` | `@Roles('admin')` | List users (filter by status, paginated) |
| POST | `/users/:id/approve` | `@Roles('admin')` | Approve pending + assign role |
| POST | `/users/:id/reject` | `@Roles('admin')` | Delete pending registration |
| PATCH | `/users/:id/role` | `@Roles('admin')` | Change user role |
| PATCH | `/users/:id/status` | `@Roles('admin')` | Activate or deactivate user |

### Events
None emitted in v1. A future `UserApprovedEvent` / `UserDeactivatedEvent` would be the natural next step for audit logs (#1128 territory).

---

## 8. Alternatives Considered

### Alternative 1: Soft-delete rejected users (add `rejected` status)
**Description**: Instead of hard-deleting on reject, mark as `rejected` in DB.
**Why Rejected**: No audit log requirement in v1, and rejected users should be able to re-register if enabled. Adding a `rejected` status adds complexity (UI state, filtering) with no benefit until audit logs ship. Hard-delete is simpler and reversible (migration adds the status back when needed).

### Alternative 2: `RegistrationService` in `libs/core/src/users/application/`
**Description**: Move registration orchestration into the core application layer.
**Why Rejected**: `RegistrationService` reads `OL_REGISTRATION_ENABLED` from `ConfigService` which is a NestJS infrastructure dependency. Putting it in CORE would violate the domain's framework-independence invariant. The existing precedent (`BootstrapAdminService`, `PasswordResetService`) keeps similar orchestration at the API layer. Pure domain logic stays in CORE; the env-reading orchestration lives in `apps/api/src/auth/`.

### Alternative 3: Merge registration and user-management into `AuthModule`
**Description**: Add user-management endpoints directly to `AuthController`.
**Why Rejected**: `AuthModule` is already responsible for authentication, token rotation, and password reset. User management is an admin concern with a distinct bounded context. Keeping it in a separate `UsersApiModule` under `apps/api/src/users/` aligns with the existing pattern (e.g. `AiApiModule` for admin-facing AI settings).

---

## 9. Validation & Risks

### Architecture Compliance
- ✅ Domain layer (`libs/core/src/users/domain/`) has no framework dependencies
- ✅ Application services (`RegistrationService`, `UserManagementService`) inject `UserRepositoryPort` via Symbol token, not the concrete `UserRepository`
- ✅ ORM entity and repository stay in `infrastructure/persistence/`
- ✅ New exceptions live in `domain/exceptions/`
- ✅ `UserRepository` implements `UserRepositoryPort` (all new methods)
- ✅ FE: server state via TanStack Query; form state via React Hook Form + Zod; no global store

### Naming Conventions
- ✅ `UserStatus` (type), `UserStatusValues` (const) — follows `UserRole` / `UserRoleValues` pattern
- ✅ `IRegistrationService` / `RegistrationService` — follows `IPasswordResetService` / `PasswordResetService` pattern
- ✅ `IUserManagementService` / `UserManagementService` — follows `I{Purpose}Service` convention
- ✅ `REGISTRATION_SERVICE_TOKEN`, `USER_MANAGEMENT_SERVICE_TOKEN` — follows Symbol token naming convention
- ✅ `*.service.interface.ts`, `*.service.ts`, `*.dto.ts`, `*.types.ts` — all correct suffixes

### Risks

**R1 — Migration safety on existing installs**: The `DEFAULT 'active'` migration is safe (no NOT NULL without default, no multi-step), but must be run before deploying new API code. Document in release notes. The `IF NOT EXISTS` guard makes it idempotent.

**R2 — Bootstrap admin seeded before migration**: If the migration runs *after* the API boots and tries to read `status`, TypeORM will return `undefined` for existing rows. Mitigated: TypeORM `toDomain` falls back to `'active'` if the status value is not in `UserStatusValues` (defensive programming, same pattern already used for `role`).

**R3 — Self-protection bypass**: An admin could still make API calls directly with another admin account. In v1 this is acceptable — "you can't deactivate yourself" is UX safety, not a security boundary (admins are trusted).

**R4 — `route-lazy.test.ts` drift**: Adding `registerRoute` (eager) doesn't affect the lazy-route test. `usersRoute` (lazy) is automatically covered. Risk: low.

### Edge Cases
- **Registration with duplicate email on a pending account**: Returns 409 — user should try a different email or contact admin to clear the pending request.
- **Admin approves an already-approved user**: `UserNotPendingException` → 409 (idempotent call-site).
- **Admin tries to change role of deactivated user**: `changeRole` checks `status === 'active'` — returns 400 (deactivated users must be reactivated first).
- **Concurrent registrations with same username**: The `users.username` unique constraint is the authoritative race guard (same as `BootstrapAdminService`). `UserAlreadyExistsException` is thrown from the catch block on constraint violation.

### Backward Compatibility
- ✅ Migration is additive; `DEFAULT 'active'` means all existing rows are valid after migration
- ✅ Existing JWT tokens don't carry `status` — status is checked at validate time, not in the JWT
- ✅ Existing admin bootstrap flow continues to work (explicit `status: 'active'` in save call)

---

## 10. Testing Strategy & Acceptance Criteria

### Unit Tests
- `apps/api/src/auth/registration.service.spec.ts` — 4 cases (registration disabled, duplicate username, duplicate email, success)
- `apps/api/src/auth/auth.service.spec.ts` — 2 additional cases (pending user login, deactivated user login)
- `apps/api/src/users/user-management.service.spec.ts` — 7 cases (approve, approve non-pending, reject, change-role self-protection, deactivate self-protection, deactivate active user, reactivate deactivated user)

### Integration Tests (if applicable)
- A single vertical-slice integration test covering: register → pending → approve → login is a high-value candidate for `test/integration/` but is deferred to a follow-up (it requires Testcontainers + a real Postgres instance and is non-trivial to set up for the auth flow). Mark as a follow-up on the issue.

### Mocking Strategy
- Unit tests mock `UserRepositoryPort` (not `UserRepository`) via `jest.fn()`-typed objects
- `ConfigService` mocked with `get` returning controlled values

### Acceptance Criteria
- [ ] UI mockups at `docs/plans/mockups/user-management-screens.html` approved before implementation
- [ ] A visitor can self-register when `OL_REGISTRATION_ENABLED=true`; registration is rejected with 403 when the flag is false
- [ ] A new registration lands as `status: pending` with no login access
- [ ] Admin sees a pending-registrations queue at `/admin/users` → Pending tab
- [ ] Admin can approve (choosing a role) or reject from the UI, no DB access needed
- [ ] Admin can list all users with role + status, change a user's role, and deactivate/reactivate from the UI
- [ ] A deactivated user gets 401 on login (same error as wrong password — no enumeration)
- [ ] Role changes take effect on the user's next session (next token refresh)
- [ ] Registration toggle works per install via `OL_REGISTRATION_ENABLED`
- [ ] All unit tests pass (`pnpm test`)
- [ ] `pnpm lint` and `pnpm type-check` pass with zero errors
- [ ] Migration `1810000000000` is listed and applied cleanly
- [ ] `write-guard-coverage.spec.ts` covers `UsersController`

---

## 11. Alignment Checklist

- [x] Follows hexagonal architecture (domain types in CORE, ORM in infrastructure, services at API layer)
- [x] Respects CORE vs Integration boundaries (no adapter coupling; `UserRepositoryPort` stays the cross-layer seam)
- [x] Uses existing patterns (PasswordResetService → RegistrationService, AiApiModule → UsersApiModule, as-const unions)
- [x] Idempotency considered (migration uses `IF NOT EXISTS`; approve rejects already-active users)
- [x] Event-driven patterns: not applicable (no cross-context events needed in v1)
- [x] Rate limits & retries: not applicable (registration rate-limiting is an infrastructure concern deferred post-v1)
- [x] Error handling comprehensive (status check in login, self-protection, duplicate guard, flag check)
- [x] Testing strategy complete (unit tests for both services; guard-coverage spec updated)
- [x] Naming conventions followed (verified above)
- [x] File structure matches standards (verified above)
- [x] Plan is execution-ready (all file paths, actions, and acceptance criteria specified)

---

## 12. UI Mockups

Stored at `docs/plans/mockups/user-management-screens.html`. Covers:
- Screen 1: Registration page — `/register` (guest route, 3 variants: empty / submitted / validation error)
- Screen 2: Admin pending-approval queue — `/admin/users` Pending tab
- Screen 3: Full user management list — `/admin/users` All users tab (role change + deactivate/reactivate)
- Screen 4: Empty pending queue state

Open the HTML file directly in a browser. No build step needed.
