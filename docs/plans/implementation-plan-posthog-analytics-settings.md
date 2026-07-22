# Implementation Plan — PostHog analytics settings: DB-backed config + /settings tile (#1685)

## 1. Goal & layer classification

Add an admin-only, DB-backed configuration surface for the demo-only PostHog analytics integration (ADR-032), mirroring `libs/core/src/mailer` end to end. Today `OL_POSTHOG_KEY`/`OL_POSTHOG_HOST` are read once by `PosthogConfigService` (env-only, `apps/api/src/system/`) and surfaced via `GET /v1/system/config`. There is no admin UI and no way to override env without a redeploy — and a real EU/US region mismatch bug (key on US cloud, host defaulting to EU) was silently swallowed because PostHog's `/capture` endpoint always returns `200` regardless of key validity.

Approved mockup: https://claude.ai/code/artifact/6054a386-fc5e-4ffb-aac7-1e0f7f8ae2b1

**Layers touched**: CORE (new `libs/core/src/analytics` bounded context) + Infrastructure (migration) + Interface (new admin controller, rewired `SystemService`) + Frontend (new feature + settings tile).

**Non-goals** (explicitly out of scope):
- No new `shared/ui` Switch/Toggle primitive — reuse the existing checkbox pattern from `mailer-settings-dialog.tsx` (`smtpSecure`).
- No backend test-event endpoint — "Send test event" calls PostHog's public `/flags/` endpoint directly from the browser (client-safe, no secret involved beyond the key itself, which the browser already holds to initialize `posthog-js`).
- No multi-provider abstraction (e.g. a generic "analytics settings" that could host a future non-PostHog provider) — YAGNI, mirrors Mailer's PostHog-agnostic-in-name-only precedent (`MailerSettings` isn't generalized to "notification settings" either).

## 2. Research summary (grounded in the tree)

Exact precedent — `libs/core/src/mailer` + `apps/api/src/mailer` — read in full:
- `domain/entities/mailer-settings.entity.ts` — plain readonly class, `MAILER_SETTINGS_SINGLETON_ID = 'singleton'` constant.
- `domain/types/mailer-settings.types.ts` — `as const` transport union, `*Input`/`*View`/`Resolved*` types.
- `domain/types/mailer-credentials.types.ts` — fixed credentials ref string.
- `domain/ports/mailer-settings-repository.port.ts` — `findSettings()` / `upsertSettings()`.
- `application/services/mailer-settings.service.ts` (+ `.interface.ts`) — `getSettings`, `updateSettings`, `setSmtpPassword`, `clearSmtpPassword`, `resolveTransportConfig` (row-presence-first fallback to env).
- `infrastructure/persistence/entities/mailer-settings.orm-entity.ts` + `repositories/mailer-settings.repository.ts` (`upsert` with `conflictPaths: ['id']`, private `toDomain`).
- `mailer.tokens.ts` + `mailer.module.ts` (imports `CoreIntegrationsModule` for `CREDENTIALS_SERVICE_TOKEN`).
- `apps/api/src/migrations/1818000000009-add-mailer-settings.ts` — raw SQL `CREATE TABLE`.
- `apps/api/src/mailer/http/mailer-settings.controller.ts` + 3 DTOs (`*-response.dto.ts`, `update-*.dto.ts`, `set-*-credentials.dto.ts`) — all `@Roles('admin')`, `Cache-Control: no-store`, `204` on writes.
- `apps/api/src/mailer/mailer.module.ts` (`MailerApiModule`, imports `CoreMailerModule`) wired into `apps/api/src/app.module.ts` (`CoreMailerModule` + `MailerApiModule` both listed).
- `ICredentialsService` (`@openlinker/core/integrations`): `getByRef` (throws `CredentialNotFoundException`), `create`, `update`, `delete`.

System-config wiring (must change):
- `apps/api/src/system/posthog-config.service.ts` (+ `.interface.ts`, `.types.ts`) — pure env reader, **stays unchanged**, becomes the env-fallback leaf.
- `apps/api/src/system/system.service.ts` — **currently synchronous** (`getConfig(): SystemConfigDto`), calls `posthogConfigService.getConfig()` directly. Must become `async getConfig(): Promise<SystemConfigDto>` to call the new async `IPosthogSettingsService.resolveConfig()`.
- `apps/api/src/system/system.service.interface.ts` — `ISystemService.getConfig()` return type changes to `Promise<SystemConfigDto>`.
- `apps/api/src/system/system.controller.ts` — `getConfig()` becomes `async`.
- `apps/api/src/system/system.service.spec.ts` — existing 5 tests construct `SystemService` directly with a hand-rolled `IPosthogConfigService`; must be rewritten against the new constructor shape (`IPosthogSettingsService` instead) and `await`ed.
- `apps/api/src/system/dto/posthog-demo-integration.dto.ts` — add `autocapture`/`sessionRecording` fields.
- `apps/api/src/system/system.module.ts` — import the new core `AnalyticsModule`, provide `IPosthogSettingsService` alongside the existing `PosthogConfigService`/`DemoModeService` providers.

Frontend precedent — `apps/web/src/features/mailer-settings/` read in full (tile, dialog, 4 hooks, types) — see prior conversation research; same shape will be mirrored for `posthog-settings`.

`apps/web/src/features/demo/lib/init-demo-integrations.ts` — currently hardcodes `autocapture: false`; must read `config.demoIntegrations.posthog.autocapture`/`.sessionRecording` once the response DTO carries them.

`apps/web/src/features/system/api/system.types.ts` — FE mirror of `SystemConfig`/`PosthogConfig` wire types; needs the two new boolean fields.

## 3. Design

### A. Core bounded context — `libs/core/src/analytics/` (new)

```
libs/core/src/analytics/
├── domain/
│   ├── entities/posthog-settings.entity.ts
│   ├── types/posthog-settings.types.ts
│   ├── types/posthog-credentials.types.ts
│   └── ports/posthog-settings-repository.port.ts
├── application/
│   └── services/
│       ├── posthog-settings.service.interface.ts
│       └── posthog-settings.service.ts
├── infrastructure/
│   └── persistence/
│       ├── entities/posthog-settings.orm-entity.ts
│       └── repositories/posthog-settings.repository.ts
├── analytics.tokens.ts
├── analytics.module.ts
└── index.ts
```

`domain/types/posthog-settings.types.ts`:
```ts
export const PosthogRegionValues = ['eu', 'us', 'custom'] as const;
export type PosthogRegion = (typeof PosthogRegionValues)[number];

export interface PosthogSettingsInput {
  enabled: boolean;
  region: PosthogRegion;
  customHost: string | null; // required by service-layer validation when region === 'custom'
  autocapture: boolean;
  sessionRecording: boolean;
}

export interface PosthogSettingsView extends PosthogSettingsInput {
  apiKeyConfigured: boolean;
  wouldOverrideEnv: boolean;
  overriddenEnvVars: string[]; // e.g. ['OL_POSTHOG_KEY', 'OL_POSTHOG_HOST']
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface ResolvedPosthogConfig {
  key: string;
  host: string;
  autocapture: boolean;
  sessionRecording: boolean;
}
```

Region→host mapping lives in the service (not a type): `eu` → `eu.i.posthog.com`, `us` → `us.i.posthog.com` (ingestion subdomains — confirmed manually that the bare `eu.posthog.com` dashboard host is NOT what gates `/flags/`), `custom` → `customHost` verbatim.

`domain/entities/posthog-settings.entity.ts` — mirrors `MailerSettings`: `PosthogSettings` class with `enabled`, `region`, `customHost`, `autocapture`, `sessionRecording`, `updatedAt`, `updatedBy` readonly fields + `POSTHOG_SETTINGS_SINGLETON_ID = 'singleton'`.

`domain/types/posthog-credentials.types.ts`:
```ts
export const POSTHOG_API_KEY_CREDENTIALS_REF = 'posthog:api-key';
```

`domain/ports/posthog-settings-repository.port.ts` — `findSettings(): Promise<PosthogSettings | null>`, `upsertSettings(input, updatedBy): Promise<PosthogSettings>` (identical shape to Mailer's port).

`application/services/posthog-settings.service.ts` (`PosthogSettingsService implements IPosthogSettingsService`):
- `getSettings(): Promise<PosthogSettingsView>` — reads the row (defaults: `enabled: false, region: 'eu', customHost: null, autocapture: false, sessionRecording: true` when absent — `sessionRecording: true` matches today's hardcoded FE behavior so existing demo deployments don't silently lose session recording on upgrade), computes `apiKeyConfigured` via `isApiKeyConfigured()` (mirrors `isSmtpPasswordConfigured`), computes `wouldOverrideEnv`/`overriddenEnvVars` via `computeEnvOverride(row)`.
- `updateSettings(input, actorUserId)` — `repository.upsertSettings`.
- `setApiKey(key, actorUserId)` / `clearApiKey(actorUserId)` — `ICredentialsService.update`/`.create` (catch `CredentialNotFoundException` → create, mirrors `setSmtpPassword`) / `.delete`, ref `POSTHOG_API_KEY_CREDENTIALS_REF`.
- `resolveConfig(): Promise<ResolvedPosthogConfig | null>`:
  ```ts
  async resolveConfig(): Promise<ResolvedPosthogConfig | null> {
    const row = await this.repository.findSettings();
    if (row?.enabled) {
      const key = await this.readApiKey(); // DB credential → env OL_POSTHOG_KEY fallback (mirrors readSmtpPassword)
      if (!key) return null; // enabled but no key resolvable anywhere — deny-by-default, matches PosthogConfigService's existing "empty key -> null" contract
      return {
        key,
        host: this.resolveHost(row.region, row.customHost),
        autocapture: row.autocapture,
        sessionRecording: row.sessionRecording,
      };
    }
    // No enabled DB row -> env fallback via PosthogConfigService (injected), preserving today's exact behavior.
    const envConfig = this.posthogConfigService.getConfig();
    if (!envConfig) return null;
    return { ...envConfig, autocapture: false, sessionRecording: true }; // env-only path keeps today's FE-hardcoded defaults verbatim
  }
  ```
  `PosthogSettingsService` takes `IPosthogConfigService` (existing, `apps/api/src/system`) as a constructor dependency — **cross-app-layer-into-core-module dependency is the one wrinkle**: `PosthogConfigService` lives in `apps/api/src/system`, not `libs/core`. Resolved by defining a **new port in `libs/core/src/analytics`** — `domain/ports/posthog-env-config.port.ts` (`IPosthogEnvConfigPort` — `getConfig(): { key: string; host: string } | null`) — and having `apps/api/src/system/posthog-config.service.ts` additionally implement it (zero behavior change, just an added `implements` clause + DI binding in `SystemModule`/`AnalyticsModule` wiring). This keeps `libs/core/src/analytics` framework-and-app-layer-independent (depends only on its own port, per Domain Layer Independence) while still consuming the existing env reader without duplicating its env var names.
- `wouldOverrideEnv` / `overriddenEnvVars` computed as: if `row.enabled` and the *raw* `IPosthogEnvConfigPort.getConfig()` is non-null (env has a key configured), then `wouldOverrideEnv = true` and `overriddenEnvVars` includes `'OL_POSTHOG_KEY'` (always, since a non-null env config implies the key was set) and conditionally `'OL_POSTHOG_HOST'` when the resolved DB host differs from the env-configured host and env host was explicitly set (needs `IPosthogEnvConfigPort` to also expose whether host was env-set vs defaulted — extend the port's return type with `hostWasExplicit: boolean` sourced from `ConfigService.get('OL_POSTHOG_HOST')` presence check in `PosthogConfigService`).

`infrastructure/persistence/entities/posthog-settings.orm-entity.ts` + `repositories/posthog-settings.repository.ts` — 1:1 with Mailer's shapes; columns `id (PK text), enabled (boolean), region (text), custom_host (text, nullable), autocapture (boolean), session_recording (boolean), updated_at (timestamptz), updated_by (text, nullable)`.

`analytics.tokens.ts`: `POSTHOG_SETTINGS_REPOSITORY_TOKEN`, `POSTHOG_SETTINGS_SERVICE_TOKEN`, `POSTHOG_ENV_CONFIG_PORT_TOKEN`.

`analytics.module.ts` — imports `CoreIntegrationsModule` (for `CREDENTIALS_SERVICE_TOKEN`) + `TypeOrmModule.forFeature([PosthogSettingsOrmEntity])`; **does not** provide `POSTHOG_ENV_CONFIG_PORT_TOKEN` itself (that binding is host-supplied, since the concrete `PosthogConfigService` lives in `apps/api`) — `SystemModule` provides it when composing.

`index.ts` — top-level barrel exporting `IPosthogSettingsService`, `POSTHOG_SETTINGS_SERVICE_TOKEN`, `PosthogRegionValues`, `PosthogRegion`, `PosthogSettingsView`, `PosthogSettingsInput`, `ResolvedPosthogConfig`, `IPosthogEnvConfigPort`, `POSTHOG_ENV_CONFIG_PORT_TOKEN`, `AnalyticsModule` — per the cross-context contract rule (service interfaces, DI tokens, ports, types only).

### B. Migration — `apps/api/src/migrations/{ts}-add-posthog-settings.ts`

Raw `CREATE TABLE "posthog_settings" (...)`, timestamp chosen as the next value after the latest existing migration (checked at implementation time via `ls apps/api/src/migrations | sort | tail -1`).

### C. Admin API — `apps/api/src/analytics/` (new, mirrors `apps/api/src/mailer`)

```
apps/api/src/analytics/
├── analytics.module.ts          # AnalyticsApiModule, imports CoreAnalyticsModule
└── http/
    ├── posthog-settings.controller.ts
    └── dto/
        ├── posthog-settings-response.dto.ts
        ├── update-posthog-settings.dto.ts
        └── set-posthog-credentials.dto.ts
```

`posthog-settings.controller.ts` — `GET /posthog-settings`, `PUT /posthog-settings`, `PUT /posthog-settings/credentials`, `DELETE /posthog-settings/credentials`; all `@Roles('admin')`, `Cache-Control: no-store`, `204` on writes — copy `mailer-settings.controller.ts` structure exactly, swapping method/field names.

`update-posthog-settings.dto.ts` validation: `enabled: boolean`, `region: @IsIn(PosthogRegionValues)`, `customHost?: @IsOptional() @IsUrl()` (only meaningful when `region==='custom'`, not cross-validated server-side — same "trust the admin form" precedent as Mailer's `smtpHost`/`smtpPort`), `autocapture: boolean`, `sessionRecording: boolean`.

`set-posthog-credentials.dto.ts` — mirrors `SetMailerCredentialsDto` exactly (`apiKey` field instead of `password`, same trim/length validators — PostHog project keys are `phc_` + 43 chars, so `MaxLength(128)` is generous headroom).

### D. Rewire `apps/api/src/system/`

- `posthog-config.service.ts` — add `implements IPosthogEnvConfigPort` (from `@openlinker/core/analytics`), extend `getConfig()`'s return to include `hostWasExplicit: boolean` (computed via `this.configService.get<string>('OL_POSTHOG_HOST')` presence, mirroring the existing empty-string-means-unset convention used for `OL_POSTHOG_KEY`). **No env var names or defaults change.**
- `system.service.ts` — constructor takes `IPosthogSettingsService` (`POSTHOG_SETTINGS_SERVICE_TOKEN`) instead of `IPosthogConfigService` directly; `getConfig()` becomes `async`, calls `await this.posthogSettingsService.resolveConfig()`, maps the result into `demoIntegrations.posthog` (now carrying `autocapture`/`sessionRecording`).
- `system.service.interface.ts` — `getConfig(): Promise<SystemConfigDto>`.
- `system.controller.ts` — `async getConfig()`.
- `system.module.ts` — import `AnalyticsModule` (core), bind `POSTHOG_ENV_CONFIG_PORT_TOKEN` to `useExisting: PosthogConfigService` (the module already provides `PosthogConfigService`), keep `PosthogConfigService`/`POSTHOG_CONFIG_SERVICE_TOKEN` providers as-is (no longer consumed by `SystemService` directly, but the FE-facing contract doesn't change and nothing else currently depends on removing it — leaving it wired avoids an unnecessary blast-radius increase).
- `dto/posthog-demo-integration.dto.ts` — add `autocapture: boolean`, `sessionRecording: boolean` `@ApiProperty()` fields.
- `system.service.spec.ts` — rewritten: constructs `SystemService` with a mock `IPosthogSettingsService` (`resolveConfig: jest.fn()`), all 5 existing test cases become `await`ed, plus 2 new cases asserting `autocapture`/`sessionRecording` pass through.

### E. `app.module.ts` wiring

Add `CoreAnalyticsModule` (from `@openlinker/core/analytics`) and `AnalyticsApiModule` (from `./analytics/analytics.module`) alongside the existing `CoreMailerModule`/`MailerApiModule` pair, same import-order convention.

### F. Frontend — `apps/web/src/features/posthog-settings/` (new, mirrors `mailer-settings/` 1:1)

```
apps/web/src/features/posthog-settings/
├── api/
│   ├── posthog-settings.api.ts
│   ├── posthog-settings.query-keys.ts
│   └── posthog-settings.types.ts
├── components/
│   ├── posthog-settings-tile.tsx
│   ├── posthog-settings-tile.test.tsx
│   ├── posthog-settings-dialog.tsx
│   ├── posthog-settings-dialog.schema.ts
│   └── posthog-settings-dialog.test.tsx
└── hooks/
    ├── use-posthog-settings-query.ts
    ├── use-update-posthog-settings-mutation.ts
    ├── use-set-posthog-credentials-mutation.ts
    └── use-clear-posthog-credentials-mutation.ts
```

`posthog-settings.types.ts` — wire types mirroring the BE response/request DTOs exactly (per `docs/frontend-architecture.md` § API Client Conventions: hand-written types, `camelCase` preserved).

`posthog-settings-tile.tsx` — mirrors `mailer-settings-tile.tsx`: loading/error/data states; when `enabled`, shows a `definition-list` (Source: "Saved settings" | "Environment" derived from `wouldOverrideEnv`, API key: Configured/Not set, Region + resolved host, Autocapture, Session recording) plus a `context-chip--warning` "Overrides env" pill when `wouldOverrideEnv`; "Edit" button opens the dialog. Matches the 3 tile states in the mockup.

`posthog-settings-dialog.tsx` — mirrors `mailer-settings-dialog.tsx` structure (RHF + Zod, same open-reset `useEffect` pattern at lines 79-94 of the Mailer file):
- Enable checkbox (styled as the mockup's switch via existing CSS, or the plain Mailer-style checkbox — implementation detail, functionally a boolean toggle).
- API key `Input type="password"`, "Configured" hint via `view.apiKeyConfigured` (identical UX to `smtpPasswordConfigured`).
- Region `Select` (`shared/ui/select.tsx`) with the 3 `PosthogRegionValues` options; a disabled `Input` showing the resolved host (computed client-side by the same `eu`/`us`/`custom` mapping, kept in sync with the BE mapping via a shared constant if practical, otherwise duplicated with a comment noting the BE is authoritative); conditional "Custom host URL" `Input type="url"` when `region === 'custom'`.
- Autocapture checkbox, Session recording checkbox — two independent controls per the mockup.
- `Alert tone="warning"` at the top of the body when `view.wouldOverrideEnv`, listing `view.overriddenEnvVars`.
- "Send test event" `Button` — `onClick` handler does a `fetch()` directly (documented inline exception to "no raw fetch outside the shared API client", per the issue's acceptance criteria) against `https://{resolvedHost}/flags/?v=2` with `{ api_key: <form's current key value>, distinct_id: 'openlinker-settings-test' }`; local component state tracks `idle | testing | success | error`; on `error`, banner text explains it's likely a region/key mismatch (referencing the exact bug this feature prevents).
- "Reset to environment" `Button` (mirrors "Clear stored password") — calls the clear-credentials mutation + sets `enabled: false` via the update mutation, then refetches.
- Standard `mutationError` `Alert` + `FormErrorSummary` + `DialogFooter` Save/Cancel, matching Mailer's shape exactly.

`apps/web/src/pages/settings/settings-page.tsx` — add `{isAdmin ? <PosthogSettingsTile /> : null}` right after the Mailer tile block, and add a `"PostHog"` `toolbar-chip` to the summary (same `isAdmin` guard as the existing `"Mailer"` chip).

`apps/web/src/features/system/api/system.types.ts` — extend the PostHog config shape with `autocapture: boolean; sessionRecording: boolean`.

`apps/web/src/features/demo/lib/init-demo-integrations.ts` — replace the hardcoded `autocapture: false` with `posthogConfig.autocapture`, and the `session_recording` block's implicit "always on when key present" with a conditional `session_recording: posthogConfig.sessionRecording ? { maskAllInputs: true, maskTextSelector: '*' } : undefined` — masking options stay unconditional *within* the block (never configurable), only whether the block is passed to `posthog.init()` at all becomes conditional. Update the file's header doc comment accordingly (currently says "Masking is opt-out... not opt-in" — still true, just clarify session recording itself is now a resolved-config toggle).

## 4. Step-by-step (each step = files + acceptance)

1. **Core domain types + entity** — `libs/core/src/analytics/domain/{entities,types,ports}/*`. Acceptance: `tsc` compiles the context in isolation; no NestJS/TypeORM imports in `domain/`.
2. **Core service + interface** — `application/services/posthog-settings.service.{ts,interface.ts}` + `.spec.ts` (unit tests: DB-row-wins, env-fallback, `wouldOverrideEnv` true/false, credential set/clear, region→host mapping incl. `custom`, enabled-but-no-key returns `null`). Acceptance: `pnpm --filter @openlinker/core test` green for this file.
3. **Core infra (ORM entity + repository)** — mirrors Mailer's repository including the `upsert`/`conflictPaths` pattern. Acceptance: repository unit test (mock `Repository<PosthogSettingsOrmEntity>`) covers `findSettings` null/hit and `upsertSettings`.
4. **`analytics.tokens.ts` + `analytics.module.ts` + `index.ts` barrel** — Acceptance: `check:invariants` (barrel-purity, tokens-only file) passes.
5. **Migration** — `apps/api/src/migrations/{ts}-add-posthog-settings.ts`. Acceptance: `pnpm --filter @openlinker/api migration:run` then `migration:show` reports none pending; `migration:revert` cleanly drops the table.
6. **`apps/api/src/system/` rewire** — `posthog-config.service.ts` (`implements IPosthogEnvConfigPort`), `system.service.ts` (async), `system.service.interface.ts`, `system.controller.ts` (async), `system.module.ts` (wire `AnalyticsModule` + token binding), `system.service.spec.ts` (rewritten). Acceptance: existing 5 spec cases pass (rewritten, awaited) + 2 new cases; `GET /v1/system/config` manually verified to still 200 with `demoMode:false` when demo mode is off (no behavior regression for the majority non-demo path).
7. **Admin API** — `apps/api/src/analytics/` module + controller + 3 DTOs. Acceptance: controller `.spec.ts` (mirrors `mailer-settings.controller.spec.ts`) covers all 4 endpoints × 200/204/403 paths.
8. **`app.module.ts` wiring** — add the two new module imports. Acceptance: `pnpm --filter @openlinker/api start:dev` boots without DI errors (manual smoke, or rely on the e2e/integration suite if one already boots the full module graph).
9. **Integration test — skipped, matching precedent.** Confirmed via `find apps/api/test/integration -iname "*mailer*"` that `MailerSettingsService`/`MailerSettingsController` — the exact 1:1 precedent this plan mirrors — has **no** integration test of its own, only unit-level mocking (step 2) + controller spec (step 7). Following the same level of coverage for consistency rather than introducing an asymmetric testing bar for the new context.
10. **Frontend feature** — `apps/web/src/features/posthog-settings/**` (api/hooks/components) + tests mirroring the 2 Mailer test files. Acceptance: `pnpm --filter @openlinker/web test` green.
11. **Settings page + system types + init-demo-integrations wiring** — the 3 edits in `apps/web/src/pages/settings/settings-page.tsx`, `apps/web/src/features/system/api/system.types.ts`, `apps/web/src/features/demo/lib/init-demo-integrations.ts`. Acceptance: existing `init-demo-integrations.test.ts` updated + green; manual check against the mockup's 3 tile states + dialog states.
12. **Full quality gate** — `pnpm lint && pnpm type-check && pnpm test` (root) green; `pnpm --filter @openlinker/api migration:show` clean.

## 5. Validation / risks

- **Architecture compliance**: `libs/core/src/analytics` depends only on `@openlinker/core/integrations` (existing precedent) and its own new `IPosthogEnvConfigPort` — no reverse dependency on `apps/api`. The port inversion (core defines the interface, the app-layer `PosthogConfigService` implements it) is the standard Dependency Inversion pattern already used throughout the codebase (e.g. `MailerPort`'s adapter living in `apps/api/src/auth/adapters/` while the port is core-defined) — not a new pattern.
- **Breaking change risk**: `ISystemService.getConfig()` becoming `async` is a signature change to a token-based DI interface with exactly one consumer (`SystemController`) and one implementation (`SystemService`) — low blast radius, but the existing `system.service.spec.ts` must be fully rewritten, not incrementally patched (flagged as its own step, #6 above).
- **Env-var default preserved**: the env-only fallback path (`resolveConfig()` when no enabled DB row exists) must reproduce today's `PosthogConfigService.getConfig()` behavior byte-for-byte, including the current FE-hardcoded `autocapture:false` — verified by keeping that pairing explicit in the fallback branch rather than defaulting it from the (not-yet-existing) DB row.
- **Region/host mapping duplication**: the FE dialog needs the resolved-host display without waiting for a save round-trip, so the `eu`/`us` → ingestion-host mapping is necessarily duplicated client-side (BE authoritative, FE cosmetic-only) — a minor, explicitly-accepted duplication rather than an over-engineered shared-package solution for 2 constant strings.
- **Testing**: existing 80%+ application-service coverage target and 70%+ controller/adapter targets apply; the new context is small enough that hitting both is straightforward following the Mailer template line-for-line.
- **No architecture boundary violations**: confirmed no cross-context repository-port leakage — `IPosthogSettingsService` is the only symbol other contexts would ever import (none currently need to; `SystemModule` is the sole consumer, at the app layer, not a sibling core context).

## Open questions (for the ⏸️ scope check)

1. Should `sessionRecording` default to `true` (preserving today's implicit-always-on behavior for existing demo deployments with a key already configured via env) or `false` (safer, explicit opt-in, matching `autocapture`'s new default)? Plan above defaults it to `true` on the env-fallback path specifically to avoid a silent behavior change for anyone already relying on env-configured PostHog; the *DB row's* own default (once an admin creates it, before ever saving) can reasonably default to `false` for both toggles since enabling PostHog via the new UI is an explicit admin action either way. Flagging for confirmation before implementation.
2. Resolved during research: confirmed Mailer has no integration test, so step 9 is unit-only, matching precedent exactly (no open question remains here).
