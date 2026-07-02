# Implementation Plan: Demo Mode (`OL_DEMO_MODE`)

**Issue**: [IMPL] Demo posture: OL_DEMO_MODE flag, sandbox seed script, demo UX [#1127]
**Blocked by**: #1124 (read-only redaction), #1125 (registration + approval flow)
**Independent of**: #1126 (operator role)
**Effort**: M — 3–7 days

---

## Goal

Light up a public-facing OpenLinker demo without a fork. A single env flag (`OL_DEMO_MODE=true`) wires together:

1. A `POST /auth/demo-session` endpoint that creates a throwaway viewer account and returns a JWT — no registration form, no admin approval.
2. A `GET /system/config` endpoint that exposes the flag to the frontend.
3. A persistent "Demo — read-only" banner inside the authenticated shell.
4. A "Launch demo session" affordance on the login page (absent on normal installs).
5. A TypeScript seed script that provisions sandbox connections + representative data on a demo instance.
6. Documentation covering flag + seed + deploy.

Normal installs (`OL_DEMO_MODE` absent or `false`) see **zero** behaviour change.

---

## UI Mockups

Low-fi mockups are at `docs/plans/mockups/demo-mode-mockup.html` — open in a browser.

Covers:
- **Scenario A**: In-app demo banner placement + tone (authenticated shell, full-width below topbar).
- **Scenario B**: Login page demo entry affordance ("Launch demo session" button + info bar, absent when demo mode off).

> **Design-first gate**: Share `docs/plans/mockups/demo-mode-mockup.html` for approval before starting Phase 2 (frontend).

---

## Architecture Analysis

### Layer mapping

| Work item | Layer |
|---|---|
| `OL_DEMO_MODE` env resolution | Infrastructure (same `process.env.OL_*` pattern as `OL_WEBHOOK_SKEW_WINDOW_MS`) |
| `POST /auth/demo-session` | Interface + Application (`apps/api/src/auth/`) |
| `DemoModeService` | Application service (`apps/api/src/auth/`) |
| `GET /system/config` | Interface + Application (`apps/api/src/system/`) |
| Demo banner component | Frontend `shared/ui/` |
| Login page demo affordance | Frontend `features/auth/` |
| Seed script | DX (`scripts/`) |
| Documentation | Docs |

### Key decisions

**`POST /auth/demo-session` is independent of the #1125 approval flow.**
The demo path creates an ephemeral viewer account using the existing `userRepository.save()` (no pending-approval state). This keeps #1127 shippable without coupling its implementation to #1125 internals. The issue says "overriding manual approval" — this endpoint is the override: it never enters the approval queue.

**Server-driven flag: `GET /system/config → { demoMode: boolean }`.**
No `VITE_DEMO_MODE` build-time var. The API is the single authoritative source. The FE fetches it once at startup via TanStack Query (`staleTime: Infinity`). This means a running instance can be switched to demo mode with a redeploy, not a rebuild.

**Demo accounts use existing `role: 'viewer'`.**
The `viewer` role is already in `role.types.ts` with the correct read-only permission set. No schema change needed — no migration required for #1127.

**Demo username format: `demo_` + 6-char hex** (e.g. `demo_a4f8e2`).
Unique per session, recognisable in the user chip, safe to accumulate (a periodic cleanup cron is noted as a follow-up).

**No `user_status` field needed for #1127.**
#1125 adds the approval/pending model. #1127's demo endpoint never puts accounts into a "pending" state — it creates them as immediately active with the `viewer` role.

### CORE vs Integration boundary

No new ports or adapters. All changes are in the Interface/Application layers of `apps/api` and `apps/web`. The `libs/core/src/users` domain is not modified.

---

## Questions & Assumptions

| # | Item |
|---|---|
| A1 | **Assumed**: #1125 is not yet merged when #1127 is implemented. The demo-session endpoint does not depend on any #1125-specific schema changes. |
| A2 | **Assumed**: Demo accounts accumulate in the DB. A periodic cleanup (e.g. cron that deletes accounts older than 24h with username `LIKE 'demo_%'`) is noted as an ops follow-up and is NOT required for initial launch. |
| A3 | **Assumed**: No rate-limiting on `POST /auth/demo-session` for the first release. A follow-up issue should add it (e.g. 10 requests/min per IP using NestJS Throttler). |
| A4 | **Assumed**: Seed script targets the demo instance directly via TypeORM DataSource (not HTTP API calls) — same pattern as migrations. |
| Q1 | **Open**: Should the seed script be idempotent (skip if already seeded) or destructive (wipe + reseed)? **Proposed default**: idempotent (check for existing `demo_connection_*` names), with a `--force` flag to wipe and reseed. |
| Q2 | **Open**: Should the "Launch demo session" button be gated also behind a `VITE_SHOW_DEMO_ENTRY` env to allow preview deployments that are NOT in demo mode? **Proposed**: no, gating is entirely server-driven via `GET /system/config`. |

---

## Implementation Plan

### Phase 1 — Backend: flag plumbing + demo-session endpoint

#### Step 1.1 — `DemoModeService` + interface

**File**: `apps/api/src/auth/demo-mode.service.interface.ts`

```typescript
export interface IDemoModeService {
  isDemoModeEnabled(): boolean;
  createDemoSession(): Promise<{ username: string; passwordHash: string }>;
}
export const DEMO_MODE_SERVICE_TOKEN = Symbol('IDemoModeService');
```

**File**: `apps/api/src/auth/demo-mode.service.ts`

```typescript
@Injectable()
export class DemoModeService implements IDemoModeService {
  constructor(private readonly configService: ConfigService) {}

  isDemoModeEnabled(): boolean {
    return this.configService.get<string>('OL_DEMO_MODE', 'false').trim().toLowerCase() === 'true';
  }

  async createDemoSession(): Promise<{ username: string; passwordHash: string }> {
    // username: demo_ + 6-char hex
    const suffix = randomBytes(3).toString('hex');
    const username = `demo_${suffix}`;
    // password never known — generate a random hash; user logs in only via demo-session
    const passwordHash = await bcrypt.hash(randomBytes(18).toString('base64url'), BCRYPT_COST);
    return { username, passwordHash };
  }
}
```

Acceptance: `isDemoModeEnabled()` returns true only when `OL_DEMO_MODE=true` (case-insensitive).

#### Step 1.2 — `POST /auth/demo-session` endpoint

Extend `AuthController` (`apps/api/src/auth/auth.controller.ts`):

```typescript
@Public()
@Post('demo-session')
@HttpCode(HttpStatus.OK)
async demoSession(@Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
  if (!this.demoModeService.isDemoModeEnabled()) {
    throw new ForbiddenException('Demo mode is not enabled on this instance.');
  }
  const { username, passwordHash } = await this.demoModeService.createDemoSession();
  const user = await this.userRepository.save({ username, email: null, passwordHash, role: 'viewer' });
  const accessTokenDto = this.authService.login(user);
  const refresh = await this.refreshTokenService.issue(user.id);
  setRefreshCookie(res, refresh.rawToken);
  setCsrfCookie(res);
  return accessTokenDto;
}
```

- `@Public()` — no JWT required.
- Returns `LoginResponseDto` + sets refresh cookie — identical shape to `POST /auth/login`.
- `ForbiddenException` (403) when demo mode is off — not 404 (avoids misleading "route doesn't exist").
- No Swagger "400" — no request body to validate.

**Wire into `AuthModule`**: add `DemoModeService` to `providers` and `{ provide: DEMO_MODE_SERVICE_TOKEN, useExisting: DemoModeService }`. Inject `USER_REPOSITORY_TOKEN` into `AuthController` (currently injected indirectly via `AuthService.getMe` — add direct injection for the `save` call).

Acceptance: `POST /auth/demo-session` with `OL_DEMO_MODE=true` → 200 + JWT. With `OL_DEMO_MODE=false` → 403.

#### Step 1.3 — Unit tests

**File**: `apps/api/src/auth/demo-mode.service.spec.ts`

Test:
- `isDemoModeEnabled()` returns `true` with `OL_DEMO_MODE=true`, `True`, `TRUE`.
- `isDemoModeEnabled()` returns `false` with `OL_DEMO_MODE=false`, unset, empty string.
- `createDemoSession()` returns `username` matching `/^demo_[0-9a-f]{6}$/` and a non-empty `passwordHash`.
- Generated usernames are distinct across consecutive calls.

**File**: `apps/api/src/auth/auth.controller.spec.ts` (extend existing or add `demo-mode` describe block)

Test:
- Returns 403 when `isDemoModeEnabled()` returns false.
- Returns 200 with `access_token` when `isDemoModeEnabled()` returns true.
- New user is saved with `role: 'viewer'`.

---

### Phase 2 — Backend: system config endpoint

#### Step 2.1 — `SystemService` + interface

**Files**:
- `apps/api/src/system/system.service.interface.ts`
- `apps/api/src/system/system.service.ts`
- `apps/api/src/system/system.module.ts`

```typescript
// system.service.interface.ts
export interface ISystemService {
  getConfig(): SystemConfigDto;
}

// system.service.ts
@Injectable()
export class SystemService implements ISystemService {
  constructor(private readonly configService: ConfigService) {}

  getConfig(): SystemConfigDto {
    const dto = new SystemConfigDto();
    dto.demoMode = this.configService.get<string>('OL_DEMO_MODE', 'false').trim().toLowerCase() === 'true';
    return dto;
  }
}
```

**File**: `apps/api/src/system/dto/system-config.dto.ts`

```typescript
export class SystemConfigDto {
  @ApiProperty({ description: 'True when OL_DEMO_MODE=true; false otherwise.' })
  demoMode!: boolean;
}
```

#### Step 2.2 — `GET /system/config` controller

**File**: `apps/api/src/system/system.controller.ts`

```typescript
@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly systemService: ISystemService) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Returns instance-level configuration flags. Public.' })
  @ApiResponse({ status: 200, type: SystemConfigDto })
  getConfig(): SystemConfigDto {
    return this.systemService.getConfig();
  }
}
```

**Wire `SystemModule` into `AppModule`** (`apps/api/src/app.module.ts`).

Acceptance: `GET /system/config` → `{ "demoMode": false }` (without `OL_DEMO_MODE`). With `OL_DEMO_MODE=true` → `{ "demoMode": true }`.

#### Step 2.3 — Unit test

**File**: `apps/api/src/system/system.service.spec.ts`

Test:
- `getConfig().demoMode` is `false` by default.
- `getConfig().demoMode` is `true` with `OL_DEMO_MODE=true`.

---

### Phase 3 — Frontend: system config query

#### Step 3.1 — API + query key + hook

**File**: `apps/web/src/features/system/api/system.api.ts`

```typescript
export interface SystemConfig {
  demoMode: boolean;
}

export async function getSystemConfig(apiClient: ApiClient): Promise<SystemConfig> {
  return apiClient.get<SystemConfig>('/system/config');
}
```

**File**: `apps/web/src/features/system/api/system.query-keys.ts`

```typescript
export const systemQueryKeys = {
  config: ['system', 'config'] as const,
};
```

**File**: `apps/web/src/features/system/hooks/use-system-config-query.ts`

```typescript
export function useSystemConfigQuery(): UseQueryResult<SystemConfig> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: systemQueryKeys.config,
    queryFn: () => getSystemConfig(apiClient),
    staleTime: Infinity, // config is static per deployment
    gcTime: Infinity,
  });
}
```

**File**: `apps/web/src/features/system/index.ts` (barrel)

```typescript
export { useSystemConfigQuery } from './hooks/use-system-config-query';
export type { SystemConfig } from './api/system.api';
```

Acceptance: Hook returns `{ demoMode: false }` on a standard instance.

---

### Phase 4 — Frontend: demo banner component

#### Step 4.1 — `DemoBanner` component

**File**: `apps/web/src/shared/ui/demo-banner.tsx`

```tsx
import type { ReactElement } from 'react';

interface DemoBannerProps {
  className?: string;
}

export function DemoBanner({ className = '' }: DemoBannerProps): ReactElement {
  const classes = ['shell-demo-banner', className].filter(Boolean).join(' ');
  return (
    <div className={classes} role="status" aria-live="polite">
      <span aria-hidden="true">🔒</span>
      <span>
        <strong>Demo instance — read-only.</strong>{' '}
        You can explore all data; write actions are disabled.
      </span>
    </div>
  );
}
```

**CSS** (add to `apps/web/src/index.css` under the Shell section):

```css
/* ── Shell demo banner (#1127) ── */
.shell-demo-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-4);
  background: var(--status-info-soft);
  border-bottom: 1px solid var(--status-info-border);
  color: var(--status-info-fg);
  font-size: var(--text-sm, 12px);
}

.shell-demo-banner strong {
  font-weight: 600;
}
```

**Token additions** (add to `apps/web/src/shared/theme/tokens.ts` if `--status-info-soft`, `--status-info-border`, `--status-info-fg` are not already listed — check before adding):

```typescript
'status-info-soft': true,
'status-info-border': true,
'status-info-fg': true,
```

Acceptance: `DemoBanner` renders correct CSS classes and passes the drift-checker (`pnpm lint`).

#### Step 4.2 — Wire `DemoBanner` into `AppShell`

**File**: `apps/web/src/app/app-shell.tsx`

Condition: show banner when **both** `systemConfig.demoMode === true` **and** `session.user?.role === 'viewer'`. The dual guard prevents the banner from appearing if an admin logs in while demo mode is on.

In `AppShell`:

```tsx
const systemConfig = useSystemConfigQuery();
const isDemo = systemConfig.data?.demoMode === true && session.user?.role === 'viewer';

// Inside the shell-main div, after the topbar header:
{isDemo ? <DemoBanner /> : null}
```

Acceptance: Banner renders in the authenticated shell when demo mode is active and the user is a viewer. Not rendered for admin users. Not rendered on normal instances.

#### Step 4.3 — Unit tests

**File**: `apps/web/src/shared/ui/demo-banner.test.tsx`

Test:
- Renders the banner with expected text.
- Has `role="status"` for screen reader announcement.
- Accepts and merges `className`.

**File**: `apps/web/src/app/app-shell.test.tsx` (extend existing)

Test:
- Banner is rendered when `demoMode: true` and `role: 'viewer'`.
- Banner is NOT rendered when `demoMode: false`.
- Banner is NOT rendered when `demoMode: true` but `role: 'admin'`.

---

### Phase 5 — Frontend: login page demo entry affordance

#### Step 5.1 — `useDemoSessionMutation` hook

**File**: `apps/web/src/features/auth/hooks/use-demo-session-mutation.ts`

```typescript
export function useDemoSessionMutation(): UseMutationResult<LoginResponse, Error, void> {
  const apiClient = useApiClient();
  const { refreshSession } = useSession();

  return useMutation({
    mutationFn: () => apiClient.post<LoginResponse>('/auth/demo-session'),
    onSuccess: async (data) => {
      // Store token same way as login
      await apiClient.setToken(data.access_token);
      await refreshSession();
    },
  });
}
```

#### Step 5.2 — Demo section on `LoginPage`

**File**: `apps/web/src/pages/auth/LoginPage.tsx` (extend existing)

- Load `useSystemConfigQuery()`.
- If `systemConfig.data?.demoMode` is `true`, render below the login form:
  - A horizontal divider.
  - A demo info blurb ("Demo instance — explore without an account").
  - A "Launch demo session" button that fires `useDemoSessionMutation()` + navigates to `/` on success.
  - Error alert on mutation error.
  - Loading state (button disabled + "Starting session…" text) during mutation.

```tsx
{systemConfig.data?.demoMode ? (
  <>
    <div className="login-divider" aria-hidden="true">
      <span>or</span>
    </div>
    <p className="login-demo-label">Demo instance — explore without an account</p>
    {demoMutation.error ? (
      <Alert tone="error">{demoMutation.error.message}</Alert>
    ) : null}
    <Button
      tone="ghost"
      onClick={() => demoMutation.mutate()}
      disabled={demoMutation.isPending}
      className="login-demo-btn"
    >
      {demoMutation.isPending ? 'Starting session…' : '▶ Launch demo session'}
    </Button>
  </>
) : null}
```

**CSS** (add to `index.css` under the Auth / Login section):

```css
/* ── Login demo affordance (#1127) ── */
.login-demo-label {
  font-size: var(--text-sm, 12px);
  color: var(--text-muted);
  text-align: center;
  margin-bottom: var(--space-2);
}

.login-demo-btn {
  width: 100%;
}
```

Acceptance: Demo section is absent when `demoMode: false`. Present and functional when `demoMode: true`. Button flows through the same login mechanics as `POST /auth/login`.

---

### Phase 6 — Seed script

#### Step 6.1 — Seed script scaffold

**File**: `scripts/seed-demo.ts`

```typescript
#!/usr/bin/env ts-node
/**
 * Demo instance seed script.
 *
 * Provisions sandbox connections and representative data on an OL demo instance.
 * Idempotent: skips resources that already exist (keyed by name prefix `demo_`).
 * Pass --force to drop all demo_ resources and reseed from scratch.
 *
 * Usage:
 *   OL_DEMO_DB_URL=postgres://... pnpm ts-node scripts/seed-demo.ts
 *   OL_DEMO_DB_URL=postgres://... pnpm ts-node scripts/seed-demo.ts --force
 *
 * Never commit real credentials. Use sandbox/test API keys only.
 */
```

The script uses `DataSource` directly (same pattern as `apps/api/src/database/data-source.ts`):

```
import { DataSource } from 'typeorm';

async function main() {
  const ds = new DataSource({ ... }); // reads OL_DEMO_DB_URL
  await ds.initialize();
  try {
    const force = process.argv.includes('--force');
    await seedConnections(ds, force);
    await seedProducts(ds, force);
    // future: seedOrders, seedListings
  } finally {
    await ds.destroy();
  }
}
```

#### Step 6.2 — Seed fixtures

Each fixture is a named function in the script. Fixtures use only sandbox credentials:

- **`seedConnections`**: inserts 2 connections with `name: 'demo_prestashop_1'` and `name: 'demo_allegro_1'`. Credentials use documented sandbox values (e.g. Allegro sandbox API keys — see `docs/demo-mode.md` for how to obtain them). Never real production keys.
- **`seedProducts`**: inserts 5–10 products with realistic EAN/SKU/name data. No external API call required — direct DB insert via identifier-mapping + products tables.

#### Step 6.3 — `package.json` script

**File**: `package.json` (root)

```json
"seed:demo": "ts-node scripts/seed-demo.ts"
```

---

### Phase 7 — Documentation

**File**: `docs/demo-mode.md`

Contents:
1. Overview — what demo mode does.
2. Activation — `OL_DEMO_MODE=true` env var; restart required.
3. Seed script — how to run it; prerequisite env vars; idempotency notes.
4. Demo session lifecycle — accounts accumulate; cleanup cron recommendation.
5. Deployment notes — reverse proxy / CORS considerations; suggest disabling `OL_BOOTSTRAP_ADMIN_PASSWORD` rotation reminder for demo instances.
6. Security notes — demo mode must NOT be enabled on instances with real customer data; demo accounts have `viewer` role and cannot write; read-only redaction (from #1124) is the safety net.

---

## File Manifest

```
apps/api/src/auth/
  demo-mode.service.interface.ts        new
  demo-mode.service.ts                  new
  demo-mode.service.spec.ts             new
  auth.controller.ts                    modified (add POST demo-session, inject DemoModeService + USER_REPOSITORY_TOKEN)
  auth.module.ts                        modified (wire DemoModeService)

apps/api/src/system/
  system.module.ts                      new
  system.service.interface.ts           new
  system.service.ts                     new
  system.service.spec.ts                new
  system.controller.ts                  new
  system.controller.spec.ts             new
  dto/
    system-config.dto.ts                new

apps/api/src/app.module.ts              modified (import SystemModule)

apps/web/src/features/system/
  index.ts                              new
  api/
    system.api.ts                       new
    system.query-keys.ts                new
  hooks/
    use-system-config-query.ts          new

apps/web/src/features/auth/hooks/
  use-demo-session-mutation.ts          new

apps/web/src/pages/auth/
  LoginPage.tsx                         modified (demo section)

apps/web/src/shared/ui/
  demo-banner.tsx                       new
  demo-banner.test.tsx                  new

apps/web/src/app/
  app-shell.tsx                         modified (wire DemoBanner)
  app-shell.test.tsx                    modified (extend tests)

apps/web/src/index.css                  modified (add .shell-demo-banner, .login-demo-*)
apps/web/src/shared/theme/tokens.ts     modified (add status-info-* tokens if missing)

scripts/
  seed-demo.ts                          new

docs/
  demo-mode.md                          new
  plans/mockups/
    demo-mode-mockup.html               new (already written in /plan)
```

**No migrations** — the `viewer` role already exists in `role.types.ts`; user accounts created by the demo-session endpoint use the existing `users` schema unchanged.

---

## Validation Checklist

- [x] Follows hexagonal architecture — all new code in Interface/Application layers, no CORE changes
- [x] Respects CORE vs Integration boundaries — `libs/core/src/users` untouched
- [x] Uses existing patterns — `process.env.OL_*` for env resolution, `ConfigService` in NestJS services, `@Public()` guard opt-out, `userRepository.save()`, `LoginResponseDto`
- [x] Idempotency — `POST /auth/demo-session` creates a new account each call (expected for demo); seed script skips existing `demo_` resources by default
- [x] Event-driven — no events emitted; demo session is a direct synchronous action
- [x] Rate limits — intentionally deferred to follow-up (noted in Questions & Assumptions A3)
- [x] Error handling — 403 when demo mode off; error alert on FE mutation failure
- [x] Testing strategy — unit tests for all new services + controller methods + FE components
- [x] Naming conventions — `DemoModeService`, `IDemoModeService`, `DEMO_MODE_SERVICE_TOKEN`, `SystemService`, `ISystemService`, `SystemConfigDto`, `useSystemConfigQuery`, `DemoBanner`
- [x] File structure — follows `apps/api/src/auth/`, `apps/api/src/system/`, `apps/web/src/features/system/`, `shared/ui/` conventions
- [x] Security — `@Public()` endpoints do not bypass `JwtAuthGuard` for protected routes; demo accounts are `viewer` only; `OL_DEMO_MODE=false` on production is the explicit default; seed script never contains real credentials; `ForbiddenException` on demo-session when mode is off prevents probing

---

## Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| Demo accounts accumulate in DB unbounded | Note in docs. Operators should run a cleanup cron (`DELETE FROM users WHERE username LIKE 'demo_%' AND created_at < NOW() - INTERVAL '24 hours'`). Automated cleanup is a follow-up. |
| Admin sees banner if `viewer` role check is missing | Banner condition is `demoMode === true AND role === 'viewer'` — admin users are never shown it. |
| `GET /system/config` called before session is ready | Query is fired unconditionally at boot (not guarded by auth). `staleTime: Infinity` means it's fetched once per tab lifetime. Login page can access it before auth, which is the desired behaviour. |
| Seed script run against production DB | Script reads `OL_DEMO_DB_URL` (a separate env var, not `DATABASE_URL`), reducing the blast radius of accidental execution. Documented prominently in `docs/demo-mode.md`. |
| `POST /auth/demo-session` called concurrently → username collision | Username uses `randomBytes(3)` = 16M combinations. Collision probability is negligible at demo scale. On conflict, the unique-constraint error propagates as a 500 (acceptable at demo scale; a retry loop would be over-engineering). |
| #1125 approval flow registers users with `status: pending` — demo mode doesn't short-circuit that | The `POST /auth/demo-session` endpoint completely bypasses the #1125 registration flow. When #1125 is merged, an additional integration point should be added: in `UserRegistrationService.register()`, check `demoModeService.isDemoModeEnabled()` and set `status: 'active'` immediately (tracked in #1125 or a follow-up). This is NOT required for #1127 to ship. |

---

## Follow-ups (out of scope for this issue)

- Rate limiting on `POST /auth/demo-session` (e.g. 10/min per IP via `@nestjs/throttler`).
- Automated demo account cleanup cron (e.g. nightly job in `apps/worker`).
- Demo instance state-reset automation (periodic full DB wipe + reseed).
- Public-traffic rate limiting at reverse proxy level.
- Add `isDemo` flag to `SessionUser` / `GET /auth/me` for richer FE personalisation (e.g. tooltip on disabled write buttons: "Disabled in demo — sign up to write").
