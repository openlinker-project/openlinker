# Implementation Plan: Minimal Authorization Model

**Date**: 2026-03-28
**Issue**: [#58 — Add minimal authorization model](https://github.com/openlinker-project/openlinker/issues/58)
**Status**: Ready for Review
**Estimated Effort**: 1.5–2 days

---

## 1. Task Summary

**Objective**: Add a minimal role-based authorization model that protects operational endpoints, returns `403 Forbidden` for unauthorized access, and exposes current-user capabilities to the frontend.

**Context**: The backend has JWT authentication (login, token generation, `JwtAuthGuard`), but **zero authorization**. Only `GET /auth/me` is guarded — every other endpoint (connections, sync, integrations, adapters) is publicly accessible. The frontend `SessionUser` type already has a `roles: string[]` field but it's never populated.

**Classification**: Infrastructure / Interface (cross-cutting concern — touches auth guards, controllers, user entity, and migration)

---

## 2. Scope & Non-Goals

### In Scope
- Add a `role` field to the User entity (domain + ORM + migration)
- Define role types (`admin`, `viewer`)
- Embed role in JWT payload so authorization is stateless
- Create `@Public()` decorator to exempt endpoints from authentication
- Create `@Roles()` decorator for role-based route protection
- Create `RolesGuard` that enforces `@Roles()` metadata
- Apply `JwtAuthGuard` **globally** (via `APP_GUARD`) so all routes are protected by default
- Mark public endpoints (`/health`, `/auth/login`, webhooks, OAuth callback) with `@Public()`
- Create `@CurrentUser()` param decorator for cleaner controller signatures
- Return `403 Forbidden` when an authenticated user lacks the required role
- Expose role and derived permissions in `GET /auth/me` response
- Update frontend `SessionUser` population path (contract only — no UI gating)
- Unit tests for guard, decorator, and service changes
- Database migration for the `role` column

### Out of Scope
- Granular per-resource permissions (future)
- Role management API (CRUD for roles) — admin seeds roles via migration/env
- Frontend UI gating based on roles (separate issue)
- Multi-tenancy or organization-scoped permissions
- Refresh token flow
- Audit logging of authorization decisions

### Constraints
- Must not break existing login flow
- Must be backward-compatible: existing users get a default role (`admin` for MVP seed user)
- JWT payload size must stay small (role string, not full permission list)
- `as const` union types preferred over enums (engineering standards)
- Migration required — `synchronize: true` is forbidden

---

## 3. Architecture Mapping

**Target Layers**:
- **CORE** (`libs/core/src/users/`) — role types, User domain entity update, repository port update
- **Infrastructure** (`libs/core/src/users/infrastructure/`) — ORM entity, migration, repository mapping
- **Interface / App** (`apps/api/src/auth/`) — guards, decorators, controller updates

**Capabilities Involved**:
- No new ports. This extends the existing Identity bounded context.

**Existing Services Reused**:
- `AuthService` — extended to include role in JWT
- `UserRepositoryPort` / `UserRepository` — mapping updated for `role` field
- `JwtAuthGuard` — used as global guard with `@Public()` bypass
- `UsersModule` — re-exports updated user types

**New Components Required**:
| Component | Location | Layer |
|---|---|---|
| Role types (`role.types.ts`) | `libs/core/src/users/domain/types/` | CORE / Domain |
| `@Public()` decorator | `apps/api/src/auth/decorators/public.decorator.ts` | Interface |
| `@Roles()` decorator | `apps/api/src/auth/decorators/roles.decorator.ts` | Interface |
| `@CurrentUser()` decorator | `apps/api/src/auth/decorators/current-user.decorator.ts` | Interface |
| `RolesGuard` | `apps/api/src/auth/guards/roles.guard.ts` | Interface |
| Migration | `apps/api/src/migrations/{ts}-add-role-to-users.ts` | Infrastructure |

**Core vs Integration Justification**:
Roles are part of the Identity bounded context. They define who can do what — this is core domain logic that doesn't belong in any integration. The role type definition lives in CORE; the enforcement (guards, decorators) lives in the app/interface layer.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)

---

## 4. Internal Patterns Research

### Similar Implementations Found
- **`JwtAuthGuard`** (`apps/api/src/auth/guards/jwt-auth.guard.ts`) — extends `AuthGuard('jwt')`, minimal implementation. `RolesGuard` will follow the same style.
- **`RequestWithUser`** (`apps/api/src/auth/auth.controller.ts`) — typed `req.user` interface. Will be replaced by `@CurrentUser()` decorator.
- **`UserResponseDto.fromDomain()`** — static factory pattern for safe response mapping. Will be extended to include `role` and `permissions`.
- **`USER_REPOSITORY_TOKEN`** (`Symbol('UserRepositoryPort')`) — DI token pattern for repository injection.
- **`as const` pattern** — used throughout the codebase (e.g., `ConnectionStatusValues`). Role types will follow the same pattern.

### NestJS Global Guard Pattern
NestJS supports `APP_GUARD` for global guards. Combined with a `@Public()` decorator using `SetMetadata`, this is the standard pattern for "auth-by-default with opt-out":

```typescript
// Global guard registration
{ provide: APP_GUARD, useClass: JwtAuthGuard }
{ provide: APP_GUARD, useClass: RolesGuard }
```

The `JwtAuthGuard` must check for `@Public()` metadata and skip validation when present.

---

## 5. Questions & Assumptions

### Assumptions
1. **Two roles for MVP**: `admin` (full access) and `viewer` (read-only). This is the minimum viable permission model.
2. **Default role for existing users**: `admin` — the existing seed user should retain full access after migration.
3. **Default role for new users**: `admin` — since there's no user registration API and users are created via seed/migration, defaulting to `admin` is safe for MVP.
4. **Stateless authorization**: Role is embedded in JWT payload. No per-request DB lookup. This means role changes require re-login (acceptable for MVP).
5. **Viewer can read, admin can write**: `viewer` role can access GET endpoints; `admin` role can access all endpoints.
6. **Webhook endpoints stay public**: They use signature verification, not JWT auth.
7. **Health endpoints stay public**: No auth required for health checks.
8. **OAuth callback stays public**: The Allegro OAuth callback endpoint must be accessible without JWT.
9. **Permissions are derived, not stored**: The `GET /auth/me` response will include a `permissions` array derived from the role at response time — not stored in the database.

### Open Questions
1. **Should `viewer` role exist at MVP?** — Safe default: yes, define it now even if only `admin` is assigned initially. The guard logic and types are trivial to add.
2. **Should role changes require token refresh?** — Safe default: yes (stateless JWT). Acceptable for MVP with small user count.

### Documentation Gaps
- The architecture overview mentions "Authentication & Authorization" in the Identity bounded context but doesn't define an authorization model. This plan fills that gap.

---

## 6. Proposed Implementation Plan

### Phase 1: Domain — Role Types and Entity Update
**Goal**: Define role types and add `role` to the User domain entity.

**Step 1.1: Create role types**
- **File**: `libs/core/src/users/domain/types/role.types.ts` (new)
- **Action**: Define `UserRoleValues` as const array and `UserRole` union type. Define `PermissionValues` and `Permission` type. Add `ROLE_PERMISSIONS` mapping (role → permissions).
- **Acceptance**: Types compile, are importable from `@openlinker/core/users`.
- **Dependencies**: None

```typescript
// role.types.ts
export const UserRoleValues = ['admin', 'viewer'] as const;
export type UserRole = (typeof UserRoleValues)[number];

export const PermissionValues = [
  'connections:read',
  'connections:write',
  'sync:read',
  'sync:write',
  'integrations:read',
  'integrations:write',
  'adapters:read',
] as const;
export type Permission = (typeof PermissionValues)[number];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PermissionValues, // all permissions
  viewer: [
    'connections:read',
    'sync:read',
    'integrations:read',
    'adapters:read',
  ],
} as const;
```

**Step 1.2: Update User domain entity**
- **File**: `libs/core/src/users/domain/entities/user.entity.ts`
- **Action**: Add `role: UserRole` field to the `User` class. Import from `role.types.ts`.
- **Acceptance**: `User` entity has `role` property typed as `UserRole`.
- **Dependencies**: Step 1.1

**Step 1.3: Export new types from users index**
- **File**: `libs/core/src/users/index.ts`
- **Action**: Re-export `UserRole`, `UserRoleValues`, `Permission`, `PermissionValues`, `ROLE_PERMISSIONS` from the new types file.
- **Acceptance**: Types importable via `@openlinker/core/users`.
- **Dependencies**: Step 1.1

---

### Phase 2: Infrastructure — ORM Entity, Migration, Repository
**Goal**: Persist the role field and migrate existing data.

**Step 2.1: Update User ORM entity**
- **File**: `libs/core/src/users/infrastructure/persistence/entities/user.orm-entity.ts`
- **Action**: Add `@Column({ type: 'varchar', length: 50, default: 'admin' }) role: string` column.
- **Acceptance**: ORM entity has `role` column.
- **Dependencies**: Step 1.2

**Step 2.2: Generate database migration**
- **File**: `apps/api/src/migrations/{timestamp}-add-role-to-users.ts` (new, generated)
- **Action**: Generate migration via `pnpm --filter @openlinker/api migration:generate -- src/migrations/AddRoleToUsers`. Review generated SQL — should add `role varchar(50) DEFAULT 'admin'` to `users` table and backfill existing rows.
- **Acceptance**: `migration:show` confirms pending migration. Running `migration:run` succeeds. Existing users have `role = 'admin'`.
- **Dependencies**: Step 2.1, running dev database

**Step 2.3: Update User repository mapping**
- **File**: `libs/core/src/users/infrastructure/persistence/repositories/user.repository.ts`
- **Action**: Update `toDomain()` to map `entity.role` → `user.role` (cast to `UserRole`). Update `toOrm()` to map `user.role` → `entity.role`.
- **Acceptance**: Round-trip mapping preserves `role` field.
- **Dependencies**: Step 2.1, Step 1.2

---

### Phase 3: Auth — Decorators, Guards, JWT Payload
**Goal**: Build the authorization infrastructure.

**Step 3.1: Create `@Public()` decorator**
- **File**: `apps/api/src/auth/decorators/public.decorator.ts` (new)
- **Action**: Create decorator using `SetMetadata(IS_PUBLIC_KEY, true)`. Export `IS_PUBLIC_KEY` constant.
- **Acceptance**: Decorator compiles, can be applied to controller methods.
- **Dependencies**: None

```typescript
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

**Step 3.2: Create `@Roles()` decorator**
- **File**: `apps/api/src/auth/decorators/roles.decorator.ts` (new)
- **Action**: Create decorator using `SetMetadata(ROLES_KEY, roles)`. Accepts `UserRole[]`.
- **Acceptance**: Decorator compiles, can be applied to controller methods.
- **Dependencies**: Step 1.1 (role types)

```typescript
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@openlinker/core/users';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

**Step 3.3: Create `@CurrentUser()` param decorator**
- **File**: `apps/api/src/auth/decorators/current-user.decorator.ts` (new)
- **Action**: Create `createParamDecorator` that extracts `req.user` from the execution context.
- **Acceptance**: Can be used as `@CurrentUser() user: AuthenticatedUser` in controller methods.
- **Dependencies**: None

**Step 3.4: Update `JwtAuthGuard` to support `@Public()`**
- **File**: `apps/api/src/auth/guards/jwt-auth.guard.ts`
- **Action**: Override `canActivate()` to check for `IS_PUBLIC_KEY` metadata via `Reflector`. If `@Public()` is set, return `true` without validating JWT.
- **Acceptance**: Routes marked `@Public()` bypass JWT validation. Undecorated routes require valid JWT.
- **Dependencies**: Step 3.1

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

**Step 3.5: Create `RolesGuard`**
- **File**: `apps/api/src/auth/guards/roles.guard.ts` (new)
- **Action**: Create `CanActivate` guard that reads `ROLES_KEY` metadata via `Reflector`. If no `@Roles()` decorator is present, allow access (authenticated is sufficient). If `@Roles()` is present, check `req.user.role` against the required roles. Throw `ForbiddenException` if role doesn't match.
- **Acceptance**: Routes with `@Roles('admin')` reject `viewer` users with 403.
- **Dependencies**: Step 3.2

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false; // defensive: @Public() routes have no req.user
    return requiredRoles.includes(user.role);
  }
}
```

**Step 3.6: Add role to JWT payload and strategy**
- **File**: `apps/api/src/auth/auth.service.ts`
- **Action**: Include `role` in JWT payload: `{ sub: user.id, username: user.username, role: user.role }`.
- **File**: `apps/api/src/auth/strategies/jwt.strategy.ts`
- **Action**: Extract `role` from payload and include in `AuthenticatedUser` return value.
- **File**: `apps/api/src/auth/auth.types.ts` (new or update existing type)
- **Action**: Add `role: UserRole` to `AuthenticatedUser` interface. Add `JwtPayload` interface.
- **Acceptance**: After login, decoded JWT contains `role`. `req.user` includes `role`.
- **Dependencies**: Step 1.1, Step 2.3

**Step 3.7: Register guards globally in `AuthModule`**
- **File**: `apps/api/src/auth/auth.module.ts`
- **Action**: Add `APP_GUARD` providers for `JwtAuthGuard` and `RolesGuard` (in that order — auth first, then roles).
- **Acceptance**: All routes require JWT by default. `@Public()` bypasses auth. `@Roles()` enforces role check.
- **Dependencies**: Steps 3.4, 3.5

```typescript
providers: [
  AuthService,
  JwtStrategy,
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

---

### Phase 4: Controllers — Apply Decorators
**Goal**: Protect all endpoints appropriately.

**Step 4.1: Mark public endpoints with `@Public()`**
- **Files**:
  - `apps/api/src/app.controller.ts` — `@Public()` on class (health endpoints)
  - `apps/api/src/auth/auth.controller.ts` — `@Public()` on `login()` method
  - `apps/api/src/webhooks/webhook.controller.ts` — `@Public()` on class (signature-verified)
  - `apps/api/src/integrations/allegro/allegro.controller.ts` — `@Public()` on OAuth callback method only
- **Action**: Import and apply `@Public()` decorator.
- **Acceptance**: Public endpoints remain accessible without JWT. All other endpoints return `401` without token.
- **Dependencies**: Step 3.7

**Step 4.1b: Add `@ApiBearerAuth()` Swagger decorator to guarded controllers**
- **Files**:
  - `apps/api/src/integrations/http/connection.controller.ts` — `@ApiBearerAuth()` on class
  - `apps/api/src/integrations/allegro/allegro.controller.ts` — `@ApiBearerAuth()` on class
  - `apps/api/src/sync/sync.controller.ts` — `@ApiBearerAuth()` on class
  - `apps/api/src/auth/auth.controller.ts` — `@ApiBearerAuth()` on `getMe()` method
  - `apps/api/src/integrations/http/adapter.controller.ts` — `@ApiBearerAuth()` on class
- **Action**: Import `@ApiBearerAuth()` from `@nestjs/swagger` and apply to controllers/methods that require JWT. This ensures the Swagger UI "Authorize" button sends the Bearer token for these endpoints.
- **Acceptance**: Swagger UI shows lock icon on guarded endpoints; clicking "Try it out" sends the `Authorization: Bearer` header.
- **Dependencies**: Step 4.1

**Step 4.2: Apply `@Roles()` to write endpoints**
- **Files**:
  - `apps/api/src/integrations/http/connection.controller.ts` — `@Roles('admin')` on POST/PATCH methods; GET methods accessible to any authenticated user
  - `apps/api/src/integrations/allegro/allegro.controller.ts` — `@Roles('admin')` on `connect()` (OAuth initiation) and diagnostic/command endpoints
  - `apps/api/src/sync/sync.controller.ts` — `@Roles('admin')` on POST (trigger sync)
- **Action**: Import and apply `@Roles()` decorator to write/mutate endpoints.
- **Acceptance**: `viewer` users get `403` on write endpoints, `200` on read endpoints.
- **Dependencies**: Step 3.7

**Step 4.3: Update `AuthController` to use `@CurrentUser()` and return role/permissions**
- **File**: `apps/api/src/auth/auth.controller.ts`
- **Action**: Replace `@Req() req: RequestWithUser` with `@CurrentUser() user: AuthenticatedUser` in `getMe()`. Update `getMe()` to include `role` and `permissions` in response.
- **File**: `apps/api/src/auth/dto/user-response.dto.ts`
- **Action**: Add `role: string` and `permissions: string[]` fields. Update `fromDomain()` to populate them using `ROLE_PERMISSIONS` mapping.
- **Acceptance**: `GET /auth/me` returns `{ id, username, email, role, permissions: [...] }`.
- **Dependencies**: Steps 1.1, 3.3, 3.6

---

### Phase 5: Testing
**Goal**: Verify guards, decorators, and authorization behavior.

**Step 5.1: Unit test — `RolesGuard`**
- **File**: `apps/api/src/auth/guards/roles.guard.spec.ts` (new)
- **Tests**:
  - `should allow access when no @Roles() decorator is present`
  - `should allow access when user role matches required role`
  - `should deny access when user role does not match required role`
  - `should allow access when user has one of multiple required roles`
  - `should deny access when req.user is undefined (defensive @Public() + @Roles() edge case)`
- **Dependencies**: Step 3.5

**Step 5.2: Unit test — `JwtAuthGuard` with `@Public()`**
- **File**: `apps/api/src/auth/guards/jwt-auth.guard.spec.ts` (new)
- **Tests**:
  - `should bypass authentication when @Public() is set`
  - `should require authentication when @Public() is not set`
- **Dependencies**: Step 3.4

**Step 5.3: Unit test — `AuthService` JWT payload**
- **File**: `apps/api/src/auth/auth.service.spec.ts` (update existing or create)
- **Tests**:
  - `should include role in JWT payload on login`
  - `should return user with role from getMe()`
- **Dependencies**: Step 3.6

**Step 5.4: Unit test — `UserResponseDto`**
- **File**: `apps/api/src/auth/dto/user-response.dto.spec.ts` (new)
- **Tests**:
  - `should include role and permissions in response`
  - `should derive admin permissions correctly`
  - `should derive viewer permissions correctly`
- **Dependencies**: Step 4.3

**Step 5.5: Run quality gate**
- **Action**: Run `pnpm lint && pnpm type-check && pnpm test` — all must pass.
- **Dependencies**: All previous steps

---

### Phase 6: Frontend Contract Update
**Goal**: Ensure frontend can consume the new role/permissions data.

**Step 6.1: Update frontend auth API types**
- **File**: `apps/web/src/shared/auth/session.types.ts` (or feature-level auth API types)
- **Action**: Verify `SessionUser.roles` is populated from the `GET /auth/me` response. The field already exists. If there's an auth API module or mapper, update it to read `role` and `permissions` from the response and map `role` → `roles: [role]`.
- **Acceptance**: After login, `useSession()` returns a `SessionUser` with populated `roles` array.
- **Dependencies**: Step 4.3

---

### Implementation Details

**New Components**:
| Layer | Component | File |
|---|---|---|
| Domain | `role.types.ts` | `libs/core/src/users/domain/types/role.types.ts` |
| Domain | Updated `User` entity | `libs/core/src/users/domain/entities/user.entity.ts` |
| Infrastructure | Updated `UserOrmEntity` | `libs/core/src/users/infrastructure/persistence/entities/user.orm-entity.ts` |
| Infrastructure | Migration | `apps/api/src/migrations/{ts}-add-role-to-users.ts` |
| Interface | `@Public()` decorator | `apps/api/src/auth/decorators/public.decorator.ts` |
| Interface | `@Roles()` decorator | `apps/api/src/auth/decorators/roles.decorator.ts` |
| Interface | `@CurrentUser()` decorator | `apps/api/src/auth/decorators/current-user.decorator.ts` |
| Interface | `RolesGuard` | `apps/api/src/auth/guards/roles.guard.ts` |
| Interface | Auth types | `apps/api/src/auth/auth.types.ts` |

**Configuration Changes**:
- None. No new environment variables required.

**Database Migrations**:
- `AddRoleToUsers` — adds `role VARCHAR(50) DEFAULT 'admin' NOT NULL` to `users` table. Backfills existing rows with `'admin'`.

**Error Handling**:
- `401 Unauthorized` — returned by `JwtAuthGuard` when JWT is missing/invalid (existing behavior, now global)
- `403 Forbidden` — returned by `RolesGuard` when authenticated user lacks the required role (new)

**Reference**: [Engineering Standards - Project Structure](./engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: Granular Permission Model (PBAC)
- **Description**: Store individual permissions in a `user_permissions` join table. Each user has a set of fine-grained permissions.
- **Why Rejected**: Over-engineered for MVP with 1–2 users. Adds migration complexity, join queries, and permission management UI. Can evolve to this later by deriving permissions from roles (which this plan already does via `ROLE_PERMISSIONS`).
- **Trade-offs**: More flexible but more complex to manage, test, and maintain.

### Alternative 2: Per-Request DB Role Lookup
- **Description**: Don't embed role in JWT. Fetch role from DB on every request.
- **Why Rejected**: Adds a DB query to every authenticated request. Unnecessary for MVP with infrequent role changes. Stateless JWT is simpler and faster.
- **Trade-offs**: Would allow instant role changes without re-login, but at a per-request performance cost.

### Alternative 3: CASL-based Authorization
- **Description**: Use the CASL library for attribute-based access control.
- **Why Rejected**: Heavy dependency for a two-role system. CASL shines for complex per-resource rules — not needed here.
- **Trade-offs**: More powerful but harder to understand and debug for simple role checks.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Domain types in `libs/core/src/users/domain/types/` — no framework dependency
- ✅ Guards and decorators in `apps/api/src/auth/` — interface/app layer
- ✅ ORM entity in infrastructure layer, separate from domain entity
- ✅ Repository mapping updated in infrastructure layer
- ✅ `as const` union types for roles and permissions
- **Reference**: [Architecture Overview](./architecture-overview.md)

### Naming Conventions
- ✅ `role.types.ts` — follows `*.types.ts` pattern
- ✅ `public.decorator.ts`, `roles.decorator.ts` — descriptive decorator files
- ✅ `roles.guard.ts` — follows `*.guard.ts` NestJS convention
- ✅ `RolesGuard` — PascalCase class
- ✅ `UserRole`, `Permission` — PascalCase types
- ✅ `ROLES_KEY`, `IS_PUBLIC_KEY` — UPPER_SNAKE_CASE constants
- **Reference**: [Engineering Standards - Naming Conventions](./engineering-standards.md#naming-conventions)

### Risks
- **Stale JWT after role change**: If a user's role is changed in the database, their existing JWT still carries the old role until expiry. **Mitigation**: Acceptable for MVP (1-day token expiry, tiny user base). Document that role changes require re-login.
- **Global guard breaks existing tests**: Adding `APP_GUARD` globally means any existing controller tests that don't mock the guard will fail. **Mitigation**: Update existing controller tests to either provide mock guards or use `@Public()` where appropriate.
- **Webhook endpoints must stay public**: Webhooks use HMAC signature verification, not JWT. Must ensure `@Public()` is applied. **Mitigation**: Explicitly tested.

### Edge Cases
- **Unauthenticated request to guarded endpoint**: Returns `401` (handled by `JwtAuthGuard`).
- **Authenticated request with insufficient role**: Returns `403` (handled by `RolesGuard`).
- **Expired JWT**: Returns `401` (handled by Passport JWT strategy).
- **New user created without explicit role**: Gets `admin` default from DB column default and ORM entity default.
- **`@Public()` + `@Roles()`**: `@Public()` bypasses auth entirely, so `req.user` is undefined. `RolesGuard` defensively returns `false` if `req.user` is missing and `@Roles()` is set — but in practice this combination should not be used. A public endpoint shouldn't check roles.

### Backward Compatibility
- ✅ Existing login flow unchanged — just adds `role` to JWT payload
- ✅ Existing `GET /auth/me` response extended (additive, not breaking)
- ✅ Existing users get `admin` role via migration default
- ✅ Frontend `SessionUser.roles` field already exists — just needs population

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
| Test File | What's Tested |
|---|---|
| `roles.guard.spec.ts` | Role enforcement: allow, deny, no-decorator passthrough |
| `jwt-auth.guard.spec.ts` | `@Public()` bypass, standard auth enforcement |
| `auth.service.spec.ts` | JWT payload includes role, `getMe()` returns role |
| `user-response.dto.spec.ts` | Response includes role and derived permissions |

### Mocking Strategy
- Mock `Reflector` for guard tests (to simulate decorator metadata)
- Mock `ExecutionContext` for guard tests
- Mock `UserRepositoryPort` for service tests
- Mock `JwtService` for auth service tests

### Acceptance Criteria
- [ ] `POST /auth/login` returns JWT containing `role` claim
- [ ] `GET /auth/me` returns `{ id, username, email, role, permissions: [...] }`
- [ ] Unauthenticated requests to guarded endpoints return `401`
- [ ] `viewer` role on a `@Roles('admin')` endpoint returns `403`
- [ ] `admin` role on a `@Roles('admin')` endpoint returns success
- [ ] Health, login, webhook, and OAuth callback endpoints remain accessible without JWT
- [ ] Swagger UI shows lock icon on guarded endpoints and sends Bearer token
- [ ] All existing tests pass after changes
- [ ] `pnpm lint && pnpm type-check && pnpm test` passes
- [ ] Migration runs cleanly on existing database
- [ ] Existing users have `role = 'admin'` after migration

**Reference**: [Testing Guide](./testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (migration is idempotent via TypeORM tracking)
- [x] Event-driven patterns — N/A (no events for role changes in MVP)
- [x] Rate limits & retries — N/A (no external API calls)
- [x] Error handling comprehensive (401 + 403 covered)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready

---

## Related Documentation

- [Architecture Overview](./architecture-overview.md)
- [Engineering Standards](./engineering-standards.md)
- [Testing Guide](./testing-guide.md)
- [Code Review Guide](./code-review-guide.md)
- [Migrations Guide](./migrations.md)
