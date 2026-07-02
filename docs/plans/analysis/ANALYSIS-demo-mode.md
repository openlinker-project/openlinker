<!--
  Pre-implement readiness gate for implementation-plan-demo-mode.md
  Plan: #1127 — OL_DEMO_MODE flag, sandbox seed script, demo UX
  Gate run: 2026-06-30
-->

# ANALYSIS — Demo Mode (`implementation-plan-demo-mode.md`)

**Verdict: NEEDS-REVISION**

Two Critical issues (one TypeScript compilation error, one architectural violation) block a clean implementation. Both have straightforward fixes. No new ports, adapters, or migrations are required — the scope and approach are correct.

---

## Phase B — Reuse Audit

| Plan artifact | Status | File path |
|---|---|---|
| `DemoModeService` + `IDemoModeService` | **NEW** — confirmed absent | — |
| `DEMO_MODE_SERVICE_TOKEN` | **NEW** — confirmed absent | — |
| `POST /auth/demo-session` endpoint | **NEW** — no such route in `AuthController` | — |
| `SystemModule` + `SystemService` + `ISystemService` | **NEW** — `apps/api/src/system/` does not exist | — |
| `SystemController` / `GET /system/config` | **NEW** | — |
| `SystemConfigDto` | **NEW** | — |
| FE `features/system/` feature module | **NEW** — directory does not exist | — |
| FE `useSystemConfigQuery` hook | **NEW** | — |
| FE `useDemoSessionMutation` hook | **NEW** | — |
| FE `DemoBanner` component | **NEW** — not in `shared/ui/` | — |
| Seed script `scripts/seed-demo.ts` | **NEW** | — |
| Docs `docs/demo-mode.md` | **NEW** | — |
| `viewer` UserRole value | **EXISTS — reuse** | `libs/core/src/users/domain/types/role.types.ts:17` |
| `email: string \| null` on user ORM entity | **EXISTS — reuse** | `libs/core/src/users/infrastructure/persistence/entities/user.orm-entity.ts` |
| `username` column on user ORM entity | **EXISTS — reuse** | same |
| `status` column on user ORM entity | **EXISTS — constraint (see Critical #1)** | same — added by #1125 |
| `USER_REPOSITORY_TOKEN` | **EXISTS — reuse** | `libs/core/src/users/users.tokens.ts` |
| `@Public()` decorator | **EXISTS — reuse** | `apps/api/src/auth/decorators/public.decorator.ts` |
| `setRefreshCookie` / `setCsrfCookie` | **EXISTS — reuse** | `apps/api/src/auth/auth.cookies.ts` |
| `LoginResponseDto` | **EXISTS — reuse** | `apps/api/src/auth/dto/login-response.dto.ts` |
| `ConfigService.get<string>('OL_*')` pattern | **EXISTS — reuse** | `apps/api/src/auth/bootstrap-admin.service.ts:48–58` |
| `bcryptjs` (`import * as bcrypt from 'bcryptjs'`) | **EXISTS — reuse (see Warning #2)** | `apps/api/src/auth/auth.service.ts:12` and 6 other auth files |
| `randomBytes` from `'crypto'` | **EXISTS — reuse** | `apps/api/src/auth/auth.cookies.ts:12`, `refresh-token.service.ts:21` |
| `status-info-soft/border/fg` CSS tokens | **EXISTS — no addition needed** | `apps/web/src/shared/theme/tokens.ts:137–142` (all three present) |
| `features/auth/hooks/` directory | **EXISTS — extend** | `apps/web/src/features/auth/hooks/` (use-login.ts, use-forgot-password.ts, use-reset-password.ts) |
| `shared/ui/` directory | **EXISTS — extend** | `apps/web/src/shared/ui/` (44 components, no demo-banner) |

---

## Phase C — Backward-Compatibility Findings

### CRITICAL #1 — Missing `status` field in `userRepository.save()` call (TypeScript compilation error)

**Surface**: `UserRepositoryPort.save()` method signature  
**Affected step**: Plan Step 1.2 (`POST /auth/demo-session` controller code)

**What the plan writes:**
```typescript
const user = await this.userRepository.save({ username, email: null, passwordHash, role: 'viewer' });
```

**What the port actually requires:**
```typescript
// libs/core/src/users/domain/ports/user-repository.port.ts
save(user: Pick<User, 'username' | 'email' | 'passwordHash' | 'role' | 'status'>): Promise<User>
```

`#1125` added the `status` column (`'pending' | 'active' | 'deactivated'`) to the `users` ORM entity with a default of `'active'`. The `UserRepositoryPort.save()` signature now requires it explicitly. TypeScript strict mode will fail to compile the plan's `save()` call because `status` is missing from the argument.

**Fix (one line):** add `status: 'active' as UserStatus` to the `save()` call:
```typescript
const user = await this.userRepository.save({ username, email: null, passwordHash, role: 'viewer', status: 'active' });
```

Demo accounts must be immediately active — never `'pending'`, which would cause `validateUser()` to reject them (it enforces `user.status === 'active'`).

---

### CRITICAL #2 — `AuthController` injects repository port directly (architectural violation)

**Surface**: Controller layer dependency direction  
**Affected step**: Plan Step 1.2 and the `AuthModule` wiring note

**What the plan proposes:**
> "Inject `USER_REPOSITORY_TOKEN` into `AuthController` (currently injected indirectly via `AuthService.getMe` — add direct injection for the `save` call)."

```typescript
// As proposed: AuthController calls
const user = await this.userRepository.save({ ... });
```

**Why this is wrong:** Every controller in the codebase delegates to a service; repositories are injected only into services. The four existing `AuthController` dependencies are all service interfaces (`IAuthService`, `IPasswordResetService`, `IRefreshTokenService`, `IRegistrationService`). All four existing auth services that need `UserRepositoryPort` (`AuthService`, `RegistrationService`, `PasswordResetService`, `BootstrapAdminService`) inject it into the service, not the controller. Injecting a repository port into a controller bypasses the service layer and makes the controller untestable in isolation.

**Fix:** Move the `userRepository.save()` call into `DemoModeService.createDemoSession()`. Inject `USER_REPOSITORY_TOKEN` into `DemoModeService` (not `AuthController`), and change the return type of `createDemoSession()` from `{ username, passwordHash }` to the created `User`:

```typescript
// demo-mode.service.interface.ts
export interface IDemoModeService {
  isDemoModeEnabled(): boolean;
  createDemoSession(): Promise<User>;   // ← returns User, not credentials tuple
}

// demo-mode.service.ts
@Injectable()
export class DemoModeService implements IDemoModeService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
  ) {}

  // ...
  async createDemoSession(): Promise<User> {
    const suffix = randomBytes(3).toString('hex');
    const username = `demo_${suffix}`;
    const passwordHash = await bcrypt.hash(randomBytes(18).toString('base64url'), BCRYPT_COST);
    return this.userRepository.save({ username, email: null, passwordHash, role: 'viewer', status: 'active' });
  }
}

// auth.controller.ts — no repository import, no change to constructor
const user = await this.demoModeService.createDemoSession();
const accessTokenDto = this.authService.login(user);
```

This also resolves Critical #1, since `status: 'active'` is added in the service.

---

### WARNING #1 — `useDemoSessionMutation` token persistence diverges from existing login pattern

**Surface**: FE mutation hook — `ApiClient` interface  
**Affected step**: Plan Step 5.1

**What the plan proposes:**
```typescript
mutationFn: () => apiClient.post<LoginResponse>('/auth/demo-session'),
onSuccess: async (data) => {
  await apiClient.setToken(data.access_token);
  await refreshSession();
},
```

**What the existing `use-login.ts` actually does:**
The existing `use-login.ts` does not use `apiClient.post<T>()` or `apiClient.setToken()`. It routes through a `session.adapter.persistSession(access_token)` call (from `useSession()`). The `ApiClient` returned by `useApiClient()` is described as a typed domain-namespaced object (e.g. `apiClient.auth.login`) — it may not expose raw `post<T>()` or `setToken()` methods.

**Risk:** If `ApiClient` has no raw `post<T>()` method, the mutation will be a TypeScript error. If it has no `setToken()` method, the token won't be persisted correctly.

**Required action before Phase 5:** Read `apps/web/src/features/auth/hooks/use-login.ts` in full and replicate its token-persistence pattern exactly. The FE `auth.api.ts` should define a typed `demoSession()` call analogous to the existing `login()` API function, using the same auth domain namespace.

---

### WARNING #2 — `bcrypt` import must use `bcryptjs` namespace form

**Surface**: Dependency import in `DemoModeService`  
**Affected step**: Plan Step 1.1

The plan references `bcrypt.hash()` without specifying the import. Every auth-layer file in the codebase uses:
```typescript
import * as bcrypt from 'bcryptjs';
```
Not `import bcrypt from 'bcrypt'`. The plan must use `bcryptjs` with the namespace import syntax.

Additionally, `BCRYPT_COST` is a file-local constant (value `10`) in every auth service file — not a shared import. The plan should declare it the same way:
```typescript
const BCRYPT_COST = 10;
```

---

### NOTE — `status-info-*` tokens already exist; `tokens.ts` modification not needed

**Surface**: `apps/web/src/shared/theme/tokens.ts`

The plan says "add … if not already listed — check before adding." The check confirms all three tokens already exist at lines 137–142:
- `'status-info-soft'`
- `'status-info-border'`
- `'status-info-fg'`

No modification to `tokens.ts` is needed. The plan's conditional phrasing is already correct; implementors should skip this step.

---

## Open Questions

| # | Item | Status |
|---|---|---|
| Q1 | **`ApiClient` raw `post<T>()` and `setToken()` methods** — Do they exist? The `use-login.ts` pattern uses `session.adapter.persistSession()`, not `apiClient.setToken()`. Must be resolved before Phase 5 can be implemented cleanly. | Unresolved — read `use-login.ts` before writing Phase 5 |
| Q2 | **`LoginPage.tsx` is 14 lines** — the plan adds the demo section there (outside `<LoginForm />`). This is structurally correct, but implementors should be aware the page is a very thin wrapper; the demo section goes as a sibling to `<LoginForm />` within the `<section className="guest-page">`. | Noted — no change to the plan needed, just awareness |
| Q3 | **Plan A2**: demo accounts accumulate in the DB. The plan notes a cleanup cron as a follow-up. No action needed now, but the `docs/demo-mode.md` should prominently document the recommended cleanup query. | Noted — already in plan risks section |
| Q4 | **Seed script TypeScript target**: the plan uses `ts-node scripts/seed-demo.ts`, but the project may not have `ts-node` as a root-level dev dependency, or the root `tsconfig.json` may not cover `scripts/`. Verify before committing the `package.json` script. | Should verify `ts-node` availability or use `tsx` (which is used by other scripts if any) |

---

## Summary

The plan is architecturally sound — no new ports, no migrations, clean isolation in Interface/Application layers. The two Critical issues are both in Phase 1 and reduce to a single fix: move `userRepository.save()` into `DemoModeService.createDemoSession()` (which also surfaces the missing `status: 'active'` fix). The FE token-persistence warning requires reading `use-login.ts` before writing Phase 5. All other artifacts are cleanly new and follow established patterns.
