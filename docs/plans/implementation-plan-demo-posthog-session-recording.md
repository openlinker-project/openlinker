# Implementation Plan: Demo-only PostHog session recording via a server-gated, vendor-neutral config seam

**Date**: 2026-07-08
**Status**: Ready for Review
**Estimated Effort**: 1 day (~6-8 hours)

---

## 1. Task Summary

**Objective**: Enable PostHog session recording / product analytics on the public OpenLinker demo instance only, without shipping telemetry into normal self-hosted installs, and without requiring a build-time secret or a per-environment build artifact.

**Context**: [Issue #1301](https://github.com/openlinker-project/openlinker/issues/1301). The demo already has a server-authoritative flag seam (`SystemService` / `GET /system/config` → `{ demoMode }`, #1127 / PR #1264), consumed once by the FE via `useSystemConfigQuery`. This plan extends that seam with an optional `demoIntegrations.posthog` block, and adds a demo-scoped FE loader that dynamically imports `posthog-js` only when the config is present and the visitor has consented.

**Classification**: Frontend (+ a small Interface-layer BE extension). See [ADR-030](../architecture/adrs/030-demo-only-vendor-neutral-analytics-config-seam.md) for the design rationale (vendor-neutral, namespaced config seam vs. flat fields, vs. a private overlay/fork, vs. build-time `VITE_*`).

---

## 2. Scope & Non-Goals

### In Scope
- `SystemConfigDto` gains an optional `demoIntegrations.posthog` block, populated only when `OL_DEMO_MODE=true` and `OL_POSTHOG_KEY` is set.
- FE loader that dynamically imports `posthog-js` and initializes session recording, gated on `demoMode` + the config block + explicit visitor consent.
- A consent gate (reuses/extends the existing `DemoBanner`) that defers `posthog.init()` until accepted.
- README / demo docs statement that OpenLinker ships no telemetry by default.
- BE + FE unit tests for the gating logic.

### Out of Scope
- The sibling support-chat issue (reuses this same `demoIntegrations` seam in its own follow-up PR — this plan only leaves the DTO shape open for it).
- Any change to `OL_DEMO_MODE` semantics or the existing `DemoBanner` visual design beyond adding a consent affordance.
- Persisting consent server-side or associating it with a user account (localStorage only, anonymous visitors — `person_profiles: 'identified_only'`).
- A generic plugin/provider registry for demo integrations — `demoIntegrations` stays a small, hand-written DTO with one sub-key per provider until a third provider justifies more structure.

### Constraints
- One built image serves both prod and demo (ADR-029 Axis 4) — no `VITE_POSTHOG_KEY`, config must be runtime-only.
- No secret may be embedded in browser code or committed to the repo (PostHog's project key is a publishable write-only ingestion key, not a secret, but still only ever sourced from server-side env at runtime — see `docs/frontend-architecture.md § Environment Variables`).
- `posthog-js` must not be in the default (non-demo) bundle's eagerly-loaded path — dynamic `import()` only.

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/api/src/system/`) + Frontend (`apps/web/src/features/system`, new `apps/web/src/features/demo/`, `apps/web/src/app/`)

**Capabilities Involved**: None — this is a system-config flag extension, not a CORE domain capability. No new port is introduced; `SystemService` already delegates env-derived flags to small dedicated services (see `IDemoModeService` precedent) rather than reading `ConfigService` directly, and this plan follows that same shape for PostHog.

**Existing Services Reused**:
- `SystemService` / `ISystemService` / `SYSTEM_SERVICE_TOKEN` (`apps/api/src/system/`)
- `useSystemConfigQuery()` / `SystemConfig` / `features/system` barrel
- `DemoBanner` (`apps/web/src/shared/ui/demo-banner.tsx`) — extended with a consent affordance, not replaced
- The `AppShell` component's existing `useSystemConfigQuery()` call site (`apps/web/src/app/app-shell.tsx`) — the loader mounts alongside it, since it is the one place in the tree already inside `QueryClientProvider`/`ApiClientProvider` with the config result in hand

**New Components Required**:
- BE: `PosthogDemoIntegrationDto` (nested response DTO), a small `IPosthogConfigService` (mirrors `IDemoModeService`) reading `OL_POSTHOG_KEY` / `OL_POSTHOG_HOST`
- FE: `apps/web/src/features/demo/` — new feature (`lib/init-demo-integrations.ts`, `index.ts` barrel), a small consent hook/helper, extension of `DemoBanner` for the consent CTA
- FE: `apps/web/package.json` gains `posthog-js`

**Core vs Integration Justification**: N/A — no CORE domain logic is touched. This is Interface-layer config plumbing (mirrors how `demoMode` itself was added in #1127) and a Frontend feature. It does not implement or consume any `ProductMasterPort`/`OrderSourcePort`/etc. capability, so the hexagonal CORE/Integration boundary isn't in play.

---

## 4. External / Domain Research

### External System: PostHog
- **Authentication**: project API key (`OL_POSTHOG_KEY`), a publishable write-only ingestion key — safe to expose to the browser once resolved server-side, but per the issue's own security framing it must never be a **personal/private** API key.
- **Host**: `OL_POSTHOG_HOST`, default `https://eu.posthog.com` (data-region is operator-configurable via env, not hard-coded).
- **SDK**: `posthog-js`, initialized via `posthog.init(key, { api_host, person_profiles: 'identified_only', session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]' } })`.
- **Known pitfall**: `posthog-js` is not tree-shakeable if statically imported — must be loaded via `await import('posthog-js')` inside the gated loader, never as a top-level import anywhere reachable from the default bundle entry.

### Internal Patterns (from codebase research)
- `apps/api/src/system/system.service.ts` currently delegates the single `demoMode` flag to `IDemoModeService` (Symbol token `DEMO_MODE_SERVICE_TOKEN`, defined in `apps/api/src/auth/demo-mode.service.interface.ts`) rather than injecting `ConfigService` directly. **Follow the same shape** for PostHog config: a small `IPosthogConfigService` (own interface + implementation + Symbol token) that `SystemService` depends on, keeping `SystemService.getConfig()` a thin composition of small services rather than growing ad-hoc `ConfigService.get(...)` calls inline.
- `SystemConfigDto` today is a **flat single-boolean DTO** (`apps/api/src/system/dto/system-config.dto.ts`) — this plan introduces the module's first nested response object.
- Nested-DTO pattern reference: `apps/api/src/listings/http/dto/create-offer.dto.ts` uses `@ApiPropertyOptional({ type: XDto }) @IsOptional() @ValidateNested() @Type(() => XDto)` for optional nested objects. Since `SystemConfigDto` is purely an **outbound response** shape (no `ValidationPipe` runs on values `SystemService` constructs), `@ValidateNested()`/`@Type()` are not functionally required here, but are included anyway for Swagger-schema correctness and consistency with the rest of the codebase's nested-DTO convention.
- FE feature `lib/` precedent: `apps/web/src/features/allegro/lib/translate-allegro-error.ts` — pure, colocated-tested helper. The new `apps/web/src/features/demo/lib/init-demo-integrations.ts` follows the same shape.
- FE barrel precedent: `apps/web/src/features/system/index.ts` (3-line explicit named-export barrel) — `apps/web/src/features/demo/index.ts` follows the same explicit-export style, no `export *`.
- localStorage precedent: `apps/web/src/shared/theme/theme-provider.tsx` reads/writes `THEME_STORAGE_KEY = 'openlinker.theme'` from a sibling `*.types.ts` file, wrapped in try/catch for private-mode/disabled-storage fallback. The new consent flag follows the same key style: `openlinker.demoAnalyticsConsent` in `apps/web/src/features/demo/demo.types.ts` (or colocated in the same `lib/` module — see Step 2.3).
- Consumption seam: `apps/web/src/app/app-shell.tsx` (lines ~205-206, ~318) already calls `useSystemConfigQuery()` and reads `data?.demoMode` to render `DemoBanner`. **This is where the new loader mounts** — `AppProviders` (the actual provider-composition root) sits *outside* `QueryClientProvider`/`ApiClientProvider`, so a config-driven effect cannot live there; `AppShell` is the first point in the tree with both the query result and full provider access.
- Existing FE test-mock seam: `apps/web/src/test/test-utils.tsx` line ~454 hard-codes `getConfig: vi.fn().mockResolvedValue({ demoMode: false })` inside `createMockApiClient`. This mock needs no change for existing tests (an absent `demoIntegrations` key is `undefined`, which the guard already treats as "disabled"), but new tests exercising the loader will override this mock per-test.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking — the design (namespaced `demoIntegrations.posthog`) was confirmed with the user before this plan was written (see [ADR-030](../architecture/adrs/030-demo-only-vendor-neutral-analytics-config-seam.md)).

### Assumptions
- Consent is **not** persisted server-side or tied to a user identity — a `localStorage` flag (`openlinker.demoAnalyticsConsent`) is sufficient, mirroring the theme-preference precedent. If product later wants server-tracked consent (e.g. for compliance reporting), that's a follow-up.
- Consent, once given, persists across sessions in the same browser (not re-asked every page load) — this is the more common UX for a non-blocking analytics banner and matches the "lightweight cookie-consent gate" language in the issue. If rejected, the visitor is not re-prompted this session (avoids banner fatigue); a "manage privacy" affordance is out of scope for v1.
- `OL_POSTHOG_HOST` defaults to `https://eu.posthog.com` when `OL_POSTHOG_KEY` is set but `OL_POSTHOG_HOST` is not — per the issue's stated EU/PL operator assumption.
- The consent gate reuses/extends the existing `DemoBanner` component (adds a CTA) rather than introducing a second banner — avoids banner stacking in the shell's already-tight vertical budget (`docs/frontend-ui-style-guide.md § Main Workspace`).

### Documentation Gaps
- None identified beyond what ADR-030 already resolves (the vendor-neutral shape question raised in the earlier `/tech-review` pass).

---

## 6. Proposed Implementation Plan

### Phase 1: Backend — extend `/system/config`

**Goal**: `GET /system/config` returns `demoIntegrations.posthog` only when demo mode is active and a PostHog key is configured; absent otherwise.

**Steps**:

1. **Add `IPosthogConfigService` port + implementation**
   - **File**: `apps/api/src/system/posthog-config.service.interface.ts` (new)
     ```ts
     export interface IPosthogConfigService {
       getConfig(): { key: string; host: string } | null;
     }
     export const POSTHOG_CONFIG_SERVICE_TOKEN = Symbol('IPosthogConfigService');
     ```
   - **File**: `apps/api/src/system/posthog-config.service.ts` (new)
     - Reads `OL_POSTHOG_KEY` via `ConfigService`; returns `null` if unset/empty.
     - Reads `OL_POSTHOG_HOST` via `ConfigService`, default `'https://eu.posthog.com'`.
     - Mirrors `DemoModeService`'s constructor/DI shape exactly (`ConfigService` injected, one small method).
   - **Acceptance**: unit test — returns `null` when `OL_POSTHOG_KEY` unset; returns `{ key, host }` with the default host when only the key is set; returns the custom host when both are set.
   - **Dependencies**: none.

2. **Add nested `PosthogDemoIntegrationDto` + extend `SystemConfigDto`**
   - **File**: `apps/api/src/system/dto/posthog-demo-integration.dto.ts` (new)
     ```ts
     import { ApiProperty } from '@nestjs/swagger';

     export class PosthogDemoIntegrationDto {
       @ApiProperty({ description: 'PostHog project API key (publishable, write-only ingestion key).' })
       key!: string;

       @ApiProperty({ description: 'PostHog ingestion host, e.g. https://eu.posthog.com.' })
       host!: string;
     }
     ```
   - **File**: `apps/api/src/system/dto/demo-integrations.dto.ts` (new)
     ```ts
     import { ApiPropertyOptional } from '@nestjs/swagger';
     import { Type } from 'class-transformer';
     import { ValidateNested, IsOptional } from 'class-validator';
     import { PosthogDemoIntegrationDto } from './posthog-demo-integration.dto';

     export class DemoIntegrationsDto {
       @ApiPropertyOptional({ type: PosthogDemoIntegrationDto })
       @IsOptional()
       @ValidateNested()
       @Type(() => PosthogDemoIntegrationDto)
       posthog?: PosthogDemoIntegrationDto;
     }
     ```
   - **File**: `apps/api/src/system/dto/system-config.dto.ts` (edit)
     - Add:
       ```ts
       @ApiPropertyOptional({ type: DemoIntegrationsDto })
       @IsOptional()
       @ValidateNested()
       @Type(() => DemoIntegrationsDto)
       demoIntegrations?: DemoIntegrationsDto;
       ```
   - **Acceptance**: `pnpm --filter @openlinker/api type-check` passes; Swagger schema renders the nested shape (manual check via `/api-docs` if run locally is feasible, otherwise defer to CI Swagger generation).
   - **Dependencies**: Step 1.

3. **Wire `IPosthogConfigService` into `SystemService`**
   - **File**: `apps/api/src/system/system.service.ts` (edit)
     - Inject `@Inject(POSTHOG_CONFIG_SERVICE_TOKEN) private readonly posthogConfig: IPosthogConfigService`.
     - In `getConfig()`, only when `demoModeService.isDemoModeEnabled()` is `true`, call `posthogConfig.getConfig()`; if non-null, set `demoIntegrations: { posthog: { key, host } }`; otherwise omit `demoIntegrations` entirely (do not emit `demoIntegrations: {}`).
   - **Acceptance**: extends `apps/api/src/system/system.service.spec.ts` with three cases: (a) demo mode off → no `demoIntegrations` regardless of PostHog config; (b) demo mode on, no PostHog key → no `demoIntegrations`; (c) demo mode on + PostHog key → `demoIntegrations.posthog` present with correct `key`/`host`.
   - **Dependencies**: Steps 1-2.

4. **Register the new provider in `system.module.ts`**
   - **File**: `apps/api/src/system/system.module.ts` (edit)
     - Add `PosthogConfigService` to `providers`, bound to `POSTHOG_CONFIG_SERVICE_TOKEN` via `useExisting` (mirrors the existing `DemoModeService` binding — no dependency on `AuthModule`).
   - **Acceptance**: `apps/api/src/system/system.controller.spec.ts` still passes unmodified (controller only depends on `ISystemService`, unaffected by the internal composition change).
   - **Dependencies**: Steps 1, 3.

5. **Document the new env vars**
   - **File**: `apps/api/.env.example` (edit) — add `OL_POSTHOG_KEY=` and `OL_POSTHOG_HOST=` with a one-line comment referencing demo-only usage.
   - **Acceptance**: visible in the diff, no functional test.
   - **Dependencies**: none (can be done any time in Phase 1).

### Phase 2: Frontend — `features/system` type extension

**Goal**: `SystemConfig` type carries the new optional shape; no runtime behavior yet.

**Steps**:

1. **Extend `SystemConfig` type**
   - **File**: `apps/web/src/features/system/api/system.types.ts` (edit)
     ```ts
     export interface PosthogDemoIntegration {
       key: string;
       host: string;
     }

     export interface DemoIntegrations {
       posthog?: PosthogDemoIntegration;
     }

     export interface SystemConfig {
       demoMode: boolean;
       demoIntegrations?: DemoIntegrations;
     }
     ```
   - **Acceptance**: `pnpm --filter @openlinker/web type-check` passes.
   - **Dependencies**: Phase 1 (shape must match the BE DTO field-for-field — camelCase, same nesting).

2. **Extend the `features/system` barrel**
   - **File**: `apps/web/src/features/system/index.ts` (edit)
     - Add `PosthogDemoIntegration` and `DemoIntegrations` to the existing `export type { SystemConfig, ... }` line, following the barrel's existing explicit-named-export style.
   - **Acceptance**: consumers outside `features/system` can `import type { DemoIntegrations } from '../../system'` without a deep import.
   - **Dependencies**: Step 2.1.

### Phase 3: Frontend — `features/demo` loader + consent

**Goal**: A gated, dynamically-imported PostHog loader that only runs on a demo instance with an explicit visitor opt-in, plus a consent affordance on the existing `DemoBanner`.

**Steps**:

1. **Add `posthog-js` dependency**
   - **File**: `apps/web/package.json` (edit) — add `"posthog-js": "^1.x.x"` (resolve the current stable major/minor at implementation time) under `dependencies`.
   - **Acceptance**: `pnpm install` updates `pnpm-lock.yaml` cleanly; no other package's resolved versions change.
   - **Dependencies**: none.

2. **Add consent storage helper**
   - **File**: `apps/web/src/features/demo/demo.types.ts` (new)
     ```ts
     export const DEMO_ANALYTICS_CONSENT_STORAGE_KEY = 'openlinker.demoAnalyticsConsent';
     export type DemoAnalyticsConsent = 'accepted' | 'declined';
     ```
   - **File**: `apps/web/src/features/demo/lib/demo-analytics-consent.ts` (new)
     - `getDemoAnalyticsConsent(): DemoAnalyticsConsent | null` — reads `localStorage`, wrapped in try/catch (mirrors `theme-provider.tsx`'s private-mode fallback), returns `null` if unset or storage inaccessible.
     - `setDemoAnalyticsConsent(value: DemoAnalyticsConsent): void` — writes, same try/catch guard.
   - **Acceptance**: `apps/web/src/features/demo/lib/demo-analytics-consent.test.ts` — round-trips accepted/declined; returns `null` when unset; does not throw when `localStorage` is unavailable (mock `Storage.prototype.getItem` to throw).
   - **Dependencies**: none.

3. **Add the gated loader**
   - **File**: `apps/web/src/features/demo/lib/init-demo-integrations.ts` (new)
     ```ts
     import type { SystemConfig } from '../../system';
     import { getDemoAnalyticsConsent } from './demo-analytics-consent';

     export async function initDemoIntegrations(config: SystemConfig | undefined): Promise<void> {
       const posthogConfig = config?.demoMode ? config.demoIntegrations?.posthog : undefined;
       if (!posthogConfig?.key) return;
       if (getDemoAnalyticsConsent() !== 'accepted') return;

       const { default: posthog } = await import('posthog-js');
       posthog.init(posthogConfig.key, {
         api_host: posthogConfig.host,
         person_profiles: 'identified_only',
         session_recording: {
           maskAllInputs: true,
           maskTextSelector: '[data-ph-mask]',
         },
       });
     }
     ```
     - Guard order matters: cheap synchronous checks (`demoMode`, key presence, consent) all happen *before* the dynamic `import()`, so a declined/unconfigured visitor never triggers the network fetch for `posthog-js` at all.
   - **Acceptance**: `apps/web/src/features/demo/lib/init-demo-integrations.test.ts` — asserts `import('posthog-js')` is **not** called (via a mocked dynamic import or module-level spy) when: `demoMode` false; `demoMode` true but no `posthogConfig.key`; config present but consent not `'accepted'`. Asserts `posthog.init` **is** called with the exact options object when all three gates pass.
   - **Dependencies**: Steps 3.2, Phase 2.

4. **Add the feature barrel**
   - **File**: `apps/web/src/features/demo/index.ts` (new)
     ```ts
     export { initDemoIntegrations } from './lib/init-demo-integrations';
     export {
       getDemoAnalyticsConsent,
       setDemoAnalyticsConsent,
     } from './lib/demo-analytics-consent';
     export type { DemoAnalyticsConsent } from './demo.types';
     ```
   - **Acceptance**: matches the explicit-named-export style of `features/system/index.ts`.
   - **Dependencies**: Steps 3.2-3.3.

5. **Extend `DemoBanner` with a consent CTA**
   - **File**: `apps/web/src/shared/ui/demo-banner.tsx` (edit)
     - `DemoBanner` currently renders unconditionally when `demoMode` is true. Add an optional `onConsentChange?: (consent: DemoAnalyticsConsent) => void` prop and, when the consent state is still unset (`getDemoAnalyticsConsent() === null`), render an inline "Accept analytics" / "Decline" affordance using the existing `Button` primitive (`button--sm` per `docs/frontend-ui-style-guide.md § Density & Row Heights`). Once a choice is stored, the banner keeps its current non-dismissible informational copy without the consent controls.
     - **Note**: `demo-banner.tsx` lives in `shared/ui/`, which per `docs/frontend-architecture.md § Dependency Rules` must not import `features/`. Keep `DemoBanner` itself consent-agnostic (accepts `onConsentChange` + a `consentPending: boolean` prop) — the actual `features/demo` consent read/write calls happen in `AppShell` (which may import features), not inside the shared primitive.
   - **Acceptance**: `apps/web/src/shared/ui/demo-banner.test.tsx` extended with a case for the consent CTA rendering/not rendering based on `consentPending`, and firing `onConsentChange('accepted' | 'declined')` on click.
   - **Dependencies**: none (can proceed in parallel with 3.1-3.4).

6. **Wire the loader into `AppShell`**
   - **File**: `apps/web/src/app/app-shell.tsx` (edit)
     - Alongside the existing `const systemConfigQuery = useSystemConfigQuery();` / `const demoMode = ...` lines, add a `useEffect` that calls `initDemoIntegrations(systemConfigQuery.data)` once the query has settled (`systemConfigQuery.isSuccess`), and re-runs when consent changes (see below).
     - Pass `consentPending={demoMode && !!systemConfigQuery.data?.demoIntegrations?.posthog && getDemoAnalyticsConsent() === null}` and an `onConsentChange` handler to `<DemoBanner />` that calls `setDemoAnalyticsConsent(consent)` then re-invokes `initDemoIntegrations(systemConfigQuery.data)` if accepted (a decline is a no-op — the loader's own guard already blocks it, and no page reload is required since nothing was fetched yet).
   - **Acceptance**: manual verification (Step 9) — accepting recording on a demo-configured instance triggers exactly one dynamic import of `posthog-js` and one `posthog.init` call; declining does not.
   - **Dependencies**: Steps 3.3-3.5, Phase 2.

### Phase 4: Documentation

**Steps**:

1. **README / demo docs statement**
   - **File**: `README.md` (edit, or the demo-specific doc it points to, e.g. `docs/demo-*.md` if one exists — confirm exact target file during implementation) — add: "OpenLinker ships no telemetry by default; session recording only activates on a demo instance the operator explicitly configures via `OL_POSTHOG_KEY`."
   - **Acceptance**: statement is discoverable from the top-level README or the demo deployment guide.
   - **Dependencies**: none.

---

## 7. Alternatives Considered

See [ADR-030](../architecture/adrs/030-demo-only-vendor-neutral-analytics-config-seam.md) for the full trade-off discussion (flat vendor-prefixed fields vs. namespaced `demoIntegrations.<provider>`, private overlay/fork, build-time `VITE_*`). Summary: namespaced-per-provider was chosen so the sibling support-chat issue is an additive DTO change rather than a reshape.

One additional FE-scoped alternative considered in this plan:

- **Skip the consent gate; init PostHog immediately once `demoMode && posthog.key` are true.** Rejected — the issue's acceptance criteria explicitly require a consent notice before recording starts, and defaulting to "recording on" for anonymous demo visitors is a worse privacy posture than the extra click, especially given `maskAllInputs` alone doesn't eliminate session-replay privacy concerns for page content.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE/Integration boundary touched — pure Interface-layer (BE) + Frontend feature work.
- ✅ `SystemService` composition mirrors the existing `IDemoModeService` pattern rather than reading `ConfigService` inline (`docs/engineering-standards.md § Dependency Injection`).
- ✅ FE dependency direction respected: `shared/ui/demo-banner.tsx` stays feature-agnostic; `app/app-shell.tsx` (which may import `features/`) owns the `features/demo` wiring (`docs/frontend-architecture.md § Dependency Rules`).
- ✅ `features/demo` loader lives under the canonical `lib/` subdirectory, consistent with `docs/frontend-architecture.md § Feature Public Surface`.

### Naming Conventions
- ✅ BE: `*.dto.ts`, `*.service.ts`/`*.service.interface.ts`, Symbol token `{NAME}_TOKEN` pattern followed (`POSTHOG_CONFIG_SERVICE_TOKEN`).
- ✅ FE: `lib/*.ts` pure helpers, `*.types.ts` for the storage-key constant, `index.ts` explicit-export barrel.

### Existing Patterns
- ✅ Nested DTO pattern matches `apps/api/src/listings/http/dto/create-offer.dto.ts`.
- ✅ localStorage consent pattern matches `apps/web/src/shared/theme/theme-provider.tsx`.

### Risks
- **Consent-then-init race**: if `initDemoIntegrations` is called both on mount and again after consent changes without a guard, `posthog.init` could theoretically fire twice. Mitigation: `posthog-js`'s own `init()` is idempotent-safe in practice, but the plan's `AppShell` wiring should still track a local `hasInitializedRef` to avoid a redundant dynamic import.
- **`posthog-js` bundle weight on the demo path**: acceptable trade-off since it never loads on non-demo installs (verified in Step 9's acceptance check); demo instances alone absorb the extra chunk.
- **Env var typos** (`OL_POSTHOG_KEY` vs a mistyped variant) silently resulting in "no analytics" rather than an error — acceptable given deny-by-default is the explicit safety goal; document the exact var names in `.env.example` to reduce the risk (Phase 1, Step 5).

### Edge Cases
- `OL_DEMO_MODE=true`, `OL_POSTHOG_KEY` unset → `demoIntegrations` entirely absent from the response (not `{}` or `{ posthog: undefined }`) — covered by Phase 1 Step 3's test case (b).
- Visitor declines consent, then later revisits — `localStorage` persists the decline; no re-prompt (per the stated assumption in §5). A future "manage privacy settings" affordance to change one's mind is explicitly out of scope for v1.
- `localStorage` disabled/unavailable (private browsing) → `getDemoAnalyticsConsent()` returns `null` every time, so the banner re-prompts each session and no consent is ever "stuck" — a safe fail-open-to-re-prompt (not fail-open-to-recording) behavior.

### Backward Compatibility
- ✅ `demoIntegrations` is a purely additive, optional field on `SystemConfigDto`/`SystemConfig` — no existing consumer of `/system/config` breaks. `apps/web/src/test/test-utils.tsx`'s hard-coded `{ demoMode: false }` mock remains valid (an absent key is `undefined`, which every new guard already treats as disabled).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests (Backend)
- `apps/api/src/system/posthog-config.service.spec.ts` (new): null-key, default-host, custom-host cases.
- `apps/api/src/system/system.service.spec.ts` (extend): demo-off, demo-on-no-key, demo-on-with-key cases for `demoIntegrations`.

### Unit Tests (Frontend)
- `apps/web/src/features/demo/lib/demo-analytics-consent.test.ts` (new): round-trip + storage-failure fallback.
- `apps/web/src/features/demo/lib/init-demo-integrations.test.ts` (new): the three negative gates + the one positive path, asserting the dynamic import is never triggered on any negative gate.
- `apps/web/src/shared/ui/demo-banner.test.tsx` (extend): consent CTA render/click behavior.

### Integration Tests
- Not required — this is a config-shape + FE-gating change with no database, cross-service, or HTTP-flow interaction beyond the already-tested `GET /system/config` endpoint. `apps/api/src/system/system.controller.spec.ts` needs no change (controller is a thin pass-through).

### Mocking Strategy
- BE: mock `ConfigService.get` for `PosthogConfigService` tests; mock `IPosthogConfigService`/`IDemoModeService` for `SystemService` tests (per `docs/engineering-standards.md § Mocking Ports`).
- FE: mock the dynamic `import('posthog-js')` call (e.g. via `vi.mock('posthog-js', ...)` with a spy-able `init`) rather than letting the real SDK load in tests.

### Acceptance Criteria (mirrors the GitHub issue, confirmed against this plan)
- [ ] `GET /system/config` returns `demoIntegrations.posthog` only when `OL_DEMO_MODE=true` and `OL_POSTHOG_KEY` is set; a non-demo instance's response contains no `demoIntegrations` key at all.
- [ ] `posthog-js` is loaded via dynamic `import()` gated on config + consent — confirmed absent from the eagerly-loaded bundle graph for a non-demo build (spot-check via `pnpm --filter @openlinker/web build` bundle analysis, or simply grep the built non-demo entry chunk for the string `posthog`).
- [ ] Session recording masks inputs (`maskAllInputs: true`) and honours `[data-ph-mask]`.
- [ ] A consent notice is shown before recording starts; init is deferred until accepted.
- [ ] No PostHog key or host is hard-coded anywhere in the repo; only read from env server-side and returned at runtime.
- [ ] README / demo docs state OpenLinker ships no telemetry by default and this is demo-instance-only.
- [ ] `pnpm lint` and `pnpm type-check` pass with zero errors across `apps/api` and `apps/web`; no `any`.
- [ ] No architecture-boundary violations: config stays server-authoritative, `shared/ui/demo-banner.tsx` stays feature-agnostic, no secret ever reaches browser code except the already-runtime-resolved publishable key.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (no CORE/Integration boundary touched; Interface-layer + Frontend only)
- [x] Respects CORE vs Integration boundaries (N/A — no capability ports involved)
- [x] Uses existing patterns (no unnecessary abstractions) — mirrors `IDemoModeService`, existing nested-DTO convention, existing `lib/`+barrel FE convention, existing localStorage-consent precedent
- [x] Idempotency considered (loader guards against double-init; consent read/write is naturally idempotent)
- [x] Event-driven patterns used where applicable — N/A, no event bus interaction
- [x] Rate limits & retries addressed — N/A, no external API polling; PostHog SDK owns its own transport
- [x] Error handling comprehensive — localStorage failures fail safe (re-prompt, not silent-enable); missing config fails safe (no load)
- [x] Testing strategy complete — BE unit + FE unit, no integration test needed (justified above)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [ADR-030: Demo-only, vendor-neutral analytics/integration config seam](../architecture/adrs/030-demo-only-vendor-neutral-analytics-config-seam.md)
- [ADR-029: Versioning and release strategy](../architecture/adrs/029-versioning-and-release-strategy.md) (one-image deploy model referenced in constraints)
- Originating issue: [#1301](https://github.com/openlinker-project/openlinker/issues/1301)
