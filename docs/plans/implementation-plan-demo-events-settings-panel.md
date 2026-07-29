# Implementation Plan: Product-Events Settings Panel with Auto-Generated Groups

**Date**: 2026-07-23
**Status**: Draft
**Estimated Effort**: 6-8 hours

---

## 1. Task Summary

**Objective**: Extend the existing `/settings` PostHog panel (`apps/web/src/features/posthog-settings/`) with a **Product events** section: a master toggle independent of autocapture, an **Event groups** sub-panel whose toggles are *derived from the `demo-events.ts` catalog* (`DemoEventGroup`, never hand-maintained), and a read-only catalog view (event name, description, props, intent-click marker). Persist the enabled-group set server-side (`enabledEventGroups: string[]`) and gate `captureDemoEvent` (from #1786) against it — a disabled group is a no-op regardless of the global PostHog master toggle.

**Context**: PostHog settings (master enable, region/host, write-only API key, autocapture, session recording) already exist and are admin-toggleable (#1685). The demo-events framework (#1786 — typed catalog + `captureDemoEvent` helper) ships the event vocabulary but has no operator-facing on/off control. This task is the settings surface every event-instrumentation batch (#1788/#1789/#1790) needs so an operator can turn a marketing-reel's events on/off without a deploy.

**Classification**: Frontend + thin API extension (Interface layer). No new bounded context, no new capability port.

---

## 2. Scope & Non-Goals

### In Scope
- New `productEventsEnabled: boolean` and `enabledEventGroups: string[]` fields on the PostHog settings row (domain entity, ORM entity + migration, repository, service, DTOs, FE types).
- FE `/settings` dialog: a new "Product events" section (master toggle) + an "Event groups" panel that iterates `DemoEventGroup` values *derived from* `DemoEventCatalog` (imported from the `demo` feature barrel per #1786) — never a hand-maintained group list.
- A read-only catalog view under the panel: per-event name (mono), code-defined `description`, `props` shape, and a marker for events in the `conversion-intent` group (today's one intent-click event from #1786).
- Gate `captureDemoEvent` (in `apps/web/src/features/demo/lib/init-demo-integrations.ts`) against both `productEventsEnabled` and per-event `enabledEventGroups` membership.
- Panel visually dimmed/disabled (not merely hidden) when the PostHog master (`enabled`) or the new Product-events master (`productEventsEnabled`) is off.
- Tests: auto-group-derivation (pure helper, fixture-driven so it doesn't depend on real catalog contents), gating behavior in `captureDemoEvent`, backend service/repository/controller coverage for the two new fields.

### Out of Scope
- Per-event (as opposed to per-group) toggles — the issue's own "Assumptions" section confirms group-level granularity was agreed with the requester.
- In-UI editing of event descriptions — descriptions stay code-only (`demo-events.ts`), the panel only renders them read-only.
- The three event-instrumentation batches themselves (#1788/#1789/#1790) — those add real call sites to `captureDemoEvent`; this task only builds the on/off control plane.
- Marketing-site (`openlinker-website`) settings — separate repo/task (website#32/#33).
- Server-side enum-validation of `enabledEventGroups` against the closed `DemoEventGroup` union — `apps/api` cannot import `apps/web`'s catalog (cross-package boundary), so the field is validated as `string[]` only, matching the existing precedent for other admin-form-trusted fields on this same settings row (see § Questions & Assumptions).

### Constraints
- **Hard dependency on #1786** (`docs/plans/implementation-plan-demo-events-framework.md`, branch `1786-demo-events-framework`, currently open as PR #1817, not yet merged to `main`). `demo-events.ts`, `DemoEventCatalog`, `DemoEventName`, `DemoEventGroup`, and `captureDemoEvent` do not exist on `main` today — confirmed absent in this worktree. This plan cannot be implemented until #1786 merges (or its branch is merged into this one first). See § Questions & Assumptions.
- Must preserve the existing PostHog settings behavior exactly for installs that never touch the new fields (defaults: `productEventsEnabled: false`, `enabledEventGroups: []` — product events off by default, matching "off unless explicitly opted in" posture of every other PostHog toggle on this row).
- Admin-only surface — reuses the existing `@Roles('admin')` guard on `PosthogSettingsController`, no new authorization surface.

---

## 3. Architecture Mapping

**Target Layer**: Interface (FE feature + HTTP DTOs) with a data-layer extension in CORE's `analytics` context (domain entity, ORM column, repository). No new port, no new capability.

**Capabilities Involved**: None — `analytics` is a plain CRUD-style settings context, not a capability-port context (confirmed: `PosthogSettingsService` implements `IPosthogSettingsService`, a plain application-service interface, not a `*Port`).

**Existing Services Reused**:
- `PosthogSettingsService` (`libs/core/src/analytics/application/services/posthog-settings.service.ts`) — extended, not replaced.
- `PosthogSettingsRepository` (`libs/core/src/analytics/infrastructure/persistence/repositories/posthog-settings.repository.ts`) — extended.
- `PosthogSettingsController` (`apps/api/src/analytics/http/posthog-settings.controller.ts`) — extended, same `GET`/`PUT` endpoints, no new routes.
- FE `posthog-settings` feature (types, API client, Zod schema, dialog, mutation hook) — extended.
- FE `demo` feature barrel (`apps/web/src/features/demo/index.ts`, from #1786) — consumed for `DemoEventCatalog`, `DemoEventGroup`, `DemoEventName`, `captureDemoEvent`.

**New Components Required**:
- One DB migration (`apps/api/src/migrations/1829000000000-add-posthog-product-events-settings.ts`).
- One new FE pure helper: `apps/web/src/features/posthog-settings/lib/derive-event-groups.ts` (derives the distinct, ordered `DemoEventGroup` list from a catalog — parameterized so it's independently testable with a fixture catalog, not hand-tied to the real one).
- One new FE component: `apps/web/src/features/posthog-settings/components/product-events-section.tsx` (the master toggle + event-groups panel + read-only catalog — kept out of the already-large `posthog-settings-dialog.tsx` per the research finding that the dialog is a single flat form with no accordion/collapsible primitive today).

**Core vs Integration Justification**: N/A — no integration/adapter boundary crossed. The `analytics` context already lives in `libs/core/src/analytics/`; this is an in-place extension of its existing settings row, the same pattern as the original `autocapture`/`sessionRecording` fields added in #1685.

---

## 4. External / Domain Research

### Internal Patterns (from codebase research)

**Domain/persistence layer** (`libs/core/src/analytics/`):
- `PosthogSettings` entity: `enabled, region, customHost, autocapture, sessionRecording, updatedAt, updatedBy` — all `readonly`, positional constructor. **No API key field** (lives encrypted in `integration_credentials`, ref `posthog:api-key`) — irrelevant precedent to preserve, not touched by this task.
- `PosthogSettingsInput` / `PosthogSettingsView` (`domain/types/posthog-settings.types.ts`) — flat interfaces mirroring the entity's non-secret fields; `View` adds `apiKeyConfigured, wouldOverrideEnv, overriddenEnvVars, updatedAt, updatedBy`.
- `ResolvedPosthogConfig` (`{ key, host, autocapture, sessionRecording }`) — consumed by `SystemService` to populate `GET /system`'s `demoIntegrations.posthog`, which is what `apps/web/src/features/demo/lib/init-demo-integrations.ts` reads to decide whether/how to `posthog.init(...)`. **This is the exact seam the new fields must also flow through** so the FE gate has the data it needs at `captureDemoEvent` call time.
- ORM entity (`infrastructure/persistence/entities/posthog-settings.orm-entity.ts`): `enabled` (bool, default false), `region` (text), `customHost`→`custom_host` (nullable text), `autocapture`/`sessionRecording` (bool, default false), `updatedAt`→`updated_at` (`@UpdateDateColumn`), `updatedBy`→`updated_by` (nullable text). **String-array column convention**: no precedent in this exact file, but the house convention elsewhere (`libs/core/src/identifier-mapping/infrastructure/persistence/entities/connection.orm-entity.ts:46`, `enabledCapabilities`) is `@Column({ type: 'jsonb', default: () => "'[]'" }) enabledCapabilities!: string[];` — this plan follows that exact idiom for `enabledEventGroups`.
- **Repository (`posthog-settings.repository.ts`) does manual, explicit field-by-field mapping in both directions** — `upsertSettings`'s literal object passed to `.upsert(...)`, and a private `toDomain(row)` mapper. `@UpdateDateColumn` does not auto-touch on `.upsert()` (already handled by an explicit `updatedAt: new Date()` in the upsert literal — no change needed there). **Both new fields must be added explicitly to both mapping points** or they silently fail to round-trip.
- **Four manual mapping points total** must stay in lockstep for each new field: (1) repository `upsertSettings` literal, (2) repository `toDomain`, (3) `PosthogSettingsService.updateSettings`'s constructed input passed to the repository (and `getSettings`'s view construction, and `resolveConfig`'s `ResolvedPosthogConfig` construction), (4) `PosthogSettingsController`'s inline `updateSettings(...)` call construction from the request DTO. This is the single biggest correctness risk in this plan — Phase 1 below sequences each explicitly and cross-references it in acceptance criteria.

**API layer** (`apps/api/src/analytics/http/`):
- `PosthogSettingsResponseDto.fromView` — manual field copy (not a generic mapper); `UpdatePosthogSettingsDto` — one `class-validator` decorator per field. New DTO fields: `productEventsEnabled: boolean` (`@IsBoolean()`), `enabledEventGroups: string[]` (`@IsArray() @IsString({ each: true })`).
- Controller: `Controller('posthog-settings')`, both endpoints `@Roles('admin')`, `Cache-Control: no-store` on every response. `PUT` constructs the service-layer input object inline from the request DTO — this is manual-mapping-point (4) above.

**Frontend** (`apps/web/src/features/posthog-settings/`):
- `posthog-settings.types.ts` is a **hand-maintained mirror** of the backend DTOs (documented rationale: keep the web bundle NestJS-independent) — both `PosthogSettingsView` and `UpdatePosthogSettingsInput` need the two new fields added independently; no codegen to lean on.
- `posthog-settings.api.ts` — thin passthrough (`get`/`update`/`setCredentials`/`clearCredentials`); no logic changes, just type flow-through.
- `posthog-settings-dialog.tsx` — a **single flat `<form>`**, no accordion/tabs; sections run enable → API key → region → resolved host → custom host → autocapture → sessionRecording → test-event row → reset-to-environment → footer, in that literal order, using `Alert`/`Button`/`Dialog*`/`FormErrorSummary`/`FormField`/`Input`/`Select` from `shared/ui`. Checkboxes are raw `<input type="checkbox">` in a `.posthog-settings-checkbox` label wrapper — **no dedicated `Toggle`/`Switch` primitive exists in `shared/ui`** (confirmed: only `density-toggle.tsx` and `theme-toggle.tsx`, both bespoke one-off components, not generic primitives). This plan reuses the same raw-checkbox pattern for the new master toggle (consistency over introducing a new primitive for one feature) and renders the per-group toggles as a compact checkbox list (not full `FormField` rows, given N groups is expected to grow).
- `posthog-settings-form.schema.ts` — flat Zod object + `superRefine` for conditional custom-host validation. New fields added as siblings: `productEventsEnabled: z.boolean()`, `enabledEventGroups: z.array(z.string())`.
- `use-update-posthog-settings-mutation.ts` — generic `useMutation<void, Error, UpdatePosthogSettingsInput>`, no changes beyond the type flowing through.

**Demo feature barrel** (`apps/web/src/features/demo/index.ts`, from #1786 — not yet present on `main`):
- Will export `captureDemoEvent`, `DemoEventCatalog`, and the types `DemoEventName`/`DemoEventGroup`/`DemoEventProps`. This plan's `product-events-section.tsx` and `derive-event-groups.ts` consume `DemoEventCatalog`/`DemoEventGroup` via that barrel (`import { DemoEventCatalog, type DemoEventGroup } from '../../demo';` — cross-feature import through the public barrel, per `docs/frontend-architecture.md § Feature Public Surface`).
- `init-demo-integrations.ts`'s module-local `posthogInstance` gating pattern is extended with two more module-local variables (see Phase 3) so `captureDemoEvent` can check group-enablement without threading extra parameters through every call site.

**Migration timestamp**: highest existing 13-digit timestamp across `apps/api/src/migrations/` is `1828000000000` (`add-product-features.ts`); highest in the one plugin migration dir (`libs/integrations/allegro/src/migrations`, per `scripts/plugin-migration-dirs.json`) is `1767900000000` (lower, irrelevant). **Next free synthetic timestamp: `1829000000000`.**

---

## 5. Questions & Assumptions

### Open Questions
- Should `enabledEventGroups` reject unknown/typo'd group names server-side? Backend cannot import the FE catalog (cross-package boundary — `apps/api` never depends on `apps/web`), so a closed-enum validator isn't available without duplicating the group list server-side (which would violate "never hand-maintain the group list" from the FE requirement). **Assumption below resolves this as accepted risk**, but flagging as an open question in case the reviewer wants a duplicated allowlist anyway.

### Assumptions
- **`enabledEventGroups` is validated as `string[]` only, not against a closed enum, on both the DTO (`class-validator`) and the Zod schema.** This mirrors the existing precedent on this exact settings row: `customHost` is validated as "is this a URL" but never cross-checked against `region === 'custom'` server-side (that cross-field rule lives only in the FE Zod `superRefine`, documented as "trusting the admin form"). A stray/unknown group name in `enabledEventGroups` is harmless — it just never matches any real event's `group` at `captureDemoEvent` call time, so no event fires. This is a UX nicety-loss (a typo silently does nothing), not a security issue, since PostHog write access already requires `@Roles('admin')`.
- **`productEventsEnabled` defaults to `false`** and is independent of the master `enabled` (PostHog on/off) — an operator can have PostHog session recording/autocapture on but product events off, and vice versa (though gating always requires `enabled && productEventsEnabled`, per the issue's "runs independently of autocapture" framing, which is about autocapture specifically, not the master PostHog toggle).
- **The read-only catalog view renders every event across every group** (not filtered to enabled groups only) — an operator needs to see what a *disabled* group contains too, to decide whether to enable it. Dimming (not hiding) communicates enablement state, per the issue's "Panel is dimmed/disabled" acceptance criterion.
- **This plan assumes #1786 is merged (or its branch is available) before implementation starts.** If both are worked in parallel, the implementer must rebase this branch on `1786-demo-events-framework` (or wait for its merge to `main`) before Phase 3 (the `captureDemoEvent` gating change) can compile.
- **No new migration touches `integration_credentials`** — the API key storage model is unaffected; only the `posthog_settings` singleton row gains two columns.

### Documentation Gaps
- `docs/architecture-overview.md` has no dedicated "PostHog settings" subsection today (PostHog is mentioned only via the demo-mode/ADR-032 analytics-config-seam reference). This plan does not introduce a new subsection — the issue's own "Docs impact" note suggests amending "§ AI/analytics or § Sync Manager (System)", but neither of those sections currently discusses PostHog settings either, so the more precise fit is a one-paragraph addition to the existing analytics context description (currently absent from architecture-overview.md entirely — a pre-existing gap, not one this task must close beyond a short note; see Phase 4).

---

## 6. Proposed Implementation Plan

### Phase 1: Backend — domain, persistence, migration, service, DTOs

**Goal**: Two new fields (`productEventsEnabled: boolean`, `enabledEventGroups: string[]`) persist correctly end-to-end through every one of the four manual mapping points identified in § 4.

**Steps**:

1. **Domain types**
   - **File**: `libs/core/src/analytics/domain/types/posthog-settings.types.ts`
   - **Action**: add `productEventsEnabled: boolean; enabledEventGroups: string[];` to `PosthogSettingsInput` (and therefore, via `extends`, to `PosthogSettingsView`). Add `productEventsEnabled: boolean; enabledEventGroups: string[];` to `ResolvedPosthogConfig`.
   - **Acceptance**: `tsc` fails everywhere a `PosthogSettingsInput`/`View`/`ResolvedPosthogConfig` literal is constructed without the new fields — this is the mechanism that surfaces every remaining mapping point that needs updating.
   - **Dependencies**: none.

2. **Domain entity**
   - **File**: `libs/core/src/analytics/domain/entities/posthog-settings.entity.ts`
   - **Action**: add `productEventsEnabled: boolean` and `enabledEventGroups: string[]` as two more `readonly` constructor params, in the same field order as the types file.
   - **Acceptance**: entity construction sites (repository `toDomain`, tests) fail to compile until updated — intentional forcing function.
   - **Dependencies**: Step 1.

3. **ORM entity + migration**
   - **File**: `libs/core/src/analytics/infrastructure/persistence/entities/posthog-settings.orm-entity.ts`
   - **Action**:
     ```ts
     @Column({ name: 'product_events_enabled', default: false })
     productEventsEnabled!: boolean;

     @Column({ type: 'jsonb', name: 'enabled_event_groups', default: () => "'[]'" })
     enabledEventGroups!: string[];
     ```
     (mirrors `enabledCapabilities` on `ConnectionOrmEntity`).
   - **File**: `apps/api/src/migrations/1829000000000-add-posthog-product-events-settings.ts`
   - **Action**: raw-SQL `ALTER TABLE posthog_settings ADD COLUMN IF NOT EXISTS product_events_enabled boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS enabled_event_groups jsonb NOT NULL DEFAULT '[]'::jsonb;` in `up()`; `ALTER TABLE posthog_settings DROP COLUMN enabled_event_groups, DROP COLUMN product_events_enabled;` in `down()`. Class name `AddPosthogProductEventsSettings1829000000000` — filename prefix and class suffix must match exactly (13-digit invariant).
   - **Acceptance**: `pnpm --filter @openlinker/api migration:run` applies cleanly against a fresh DB; `pnpm --filter @openlinker/api migration:show` lists it; `pnpm lint`'s `check-migration-timestamps.mjs` passes (unique + ordered timestamp).
   - **Dependencies**: Step 2.

4. **Repository — both manual mapping points**
   - **File**: `libs/core/src/analytics/infrastructure/persistence/repositories/posthog-settings.repository.ts`
   - **Action**: add `productEventsEnabled`/`enabledEventGroups` to (a) the `upsertSettings` literal passed to `.upsert(...)`, and (b) the private `toDomain(row)` mapper's constructor call.
   - **Acceptance**: a repository spec round-trip test (Step 8) confirms both fields persist and read back correctly.
   - **Dependencies**: Step 3.

5. **Service — third manual mapping point**
   - **File**: `libs/core/src/analytics/application/services/posthog-settings.service.ts`
   - **Action**: `updateSettings` already passes its whole `input: PosthogSettingsInput` through to `repository.upsertSettings` — verify this call site doesn't destructure/reconstruct a narrower object (if it does, add the two fields there too). `getSettings`'s "no row" fallback object literal needs `productEventsEnabled: false, enabledEventGroups: []` added. `resolveConfig`'s two return literals (`ResolvedPosthogConfig` for the enabled-row branch and the env-fallback branch) both need the two new fields — env fallback should set `productEventsEnabled: false, enabledEventGroups: []` (env-only PostHog installs never get product events, since there is no env var for group enablement — DB-only feature).
   - **Acceptance**: `posthog-settings.service.spec.ts` (extended in Step 8) covers all three literals.
   - **Dependencies**: Step 4.

6. **API DTOs + controller — fourth manual mapping point**
   - **Files**: `apps/api/src/analytics/http/dto/posthog-settings-response.dto.ts`, `apps/api/src/analytics/http/dto/update-posthog-settings.dto.ts`, `apps/api/src/analytics/http/posthog-settings.controller.ts`
   - **Action**:
     - `UpdatePosthogSettingsDto`: add `@IsBoolean() productEventsEnabled: boolean;` and `@IsArray() @IsString({ each: true }) enabledEventGroups: string[];`.
     - `PosthogSettingsResponseDto.fromView`: copy both fields through.
     - Controller's `PUT` handler: add both fields to the inline service-input construction.
   - **Acceptance**: `posthog-settings.controller.spec.ts` (extended in Step 8) exercises a `PUT` with both fields set and a subsequent `GET` reflecting them.
   - **Dependencies**: Step 5.

### Phase 2: Frontend — settings feature types, form, and new Product-events section

**Goal**: `/settings` exposes a "Product events" section with a master toggle and an auto-derived Event-groups panel + read-only catalog.

**Steps**:

7. **FE types + API client + Zod schema**
   - **Files**: `apps/web/src/features/posthog-settings/api/posthog-settings.types.ts`, `apps/web/src/features/posthog-settings/components/posthog-settings-form.schema.ts`
   - **Action**: mirror the two new fields into `PosthogSettingsView`/`UpdatePosthogSettingsInput` (hand-maintained, per existing convention) and add `productEventsEnabled: z.boolean()`, `enabledEventGroups: z.array(z.string())` to the Zod schema (no `superRefine` cross-field rule needed — these two are independent of region/custom-host).
   - **Acceptance**: `tsc` and the schema both compile; no behavior change yet (fields flow through inertly until Step 9 wires the UI).
   - **Dependencies**: Phase 1 complete (DTO shape stable).

8. **New pure helper: derive event groups**
   - **File**: `apps/web/src/features/posthog-settings/lib/derive-event-groups.ts`
   - **Action**:
     ```ts
     export function deriveEventGroups<
       C extends Record<string, { group: string }>
     >(catalog: C): ReadonlyArray<C[keyof C]['group']> {
       const seen = new Set<string>();
       const groups: string[] = [];
       for (const entry of Object.values(catalog)) {
         if (!seen.has(entry.group)) {
           seen.add(entry.group);
           groups.push(entry.group);
         }
       }
       return groups as ReadonlyArray<C[keyof C]['group']>;
     }
     ```
     Generic over the catalog shape (not hard-coded to `DemoEventCatalog`) so the unit test (Step 11) can pass a small fixture catalog and assert a new fixture group appears with zero test-file changes to the derivation logic itself — this is what "never hand-maintain the group list" is unit-tested against, independent of whatever real groups #1786/#1788-1790 happen to define.
   - **Acceptance**: called with the real `DemoEventCatalog` from `../../demo`, returns `['conversion-intent']` today (per #1786's seed event); adding a second catalog entry with a new group value changes the returned list with no code change to this helper.
   - **Dependencies**: none (pure function, no dependency on Phase 1).

9. **New component: Product-events section**
   - **File**: `apps/web/src/features/posthog-settings/components/product-events-section.tsx`
   - **Action**: a `ProductEventsSection` component accepting `{ form, disabled }` (React Hook Form context + a `disabled` prop computed by the parent dialog from `!watch('enabled') || !watch('productEventsEnabled')`), rendering:
     1. Master toggle: `productEventsEnabled` checkbox, same `.posthog-settings-checkbox` pattern as existing toggles, with inline copy: "Runs independently of autocapture — cleaner funnels."
     2. Event-groups panel: one checkbox per `deriveEventGroups(DemoEventCatalog)` value, bound to array-membership in the `enabledEventGroups` form field (checked ⇒ add to array, unchecked ⇒ remove) — dimmed (`aria-disabled`, reduced opacity via a CSS class) when the section-level `disabled` prop is true.
     3. Read-only catalog: for each event in `DemoEventCatalog`, a row showing the event name in `.mono-text`, its `description`, its `props` key list (rendered as comma-joined prop names — no runtime prop-value inspection needed, just the shape), and a small marker (e.g. a `StatusBadge`-style dot or inline label) when `group === 'conversion-intent'` or more generally when the event's group is in a hard-coded "intent" marker set... — **actually, simplify**: mark any event whose description matches this being the intent-signal precedent is over-engineering for one seed event; instead render the group name next to each event (already meaningful) and skip a separate "intent marker" heuristic — defer a dedicated intent flag to a future catalog field if/when #1788-1790 show a real need. Document this simplification explicitly in the plan's Alternatives section.
     4. Demo-mode context banner (`Alert` from `shared/ui`, tone informational): "The marketing site (openlinker.io) uses a separate PostHog project — this panel only controls the in-app demo."
   - **Acceptance**: renders correctly with 0, 1, and N groups (no groups ⇒ empty-state message, not a blank panel); dimming reflects `disabled` prop; checkbox state round-trips through the form.
   - **Dependencies**: Step 8; Phase 1 (for the `productEventsEnabled`/`enabledEventGroups` form fields to exist).

10. **Wire into the dialog**
    - **File**: `apps/web/src/features/posthog-settings/components/posthog-settings-dialog.tsx`
    - **Action**: insert `<ProductEventsSection form={form} disabled={!form.watch('enabled') || !form.watch('productEventsEnabled')} />` after the existing `sessionRecording` checkbox block and before the test-event row (per the researched section order). Update `toFormValues`/`onSubmit`/`handleResetToEnvironment` (the three manual-construction points in this file) to include the two new fields — `handleResetToEnvironment` (env-fallback reset) sets `productEventsEnabled: false, enabledEventGroups: []` since env-only config never carries product-events state (matches Step 5's `resolveConfig` env-fallback literal).
    - **Acceptance**: full dialog renders with the new section; save persists both fields (verified against the real API in Step 12's test, mocked).
    - **Dependencies**: Step 9.

### Phase 3: Gate `captureDemoEvent` against the settings

**Goal**: an event whose group is not in `enabledEventGroups`, or when `productEventsEnabled` is false, is a no-op — mirroring the existing "no PostHog instance ⇒ no-op" gate from #1786.

**Steps**:

11. **Thread the two new fields through `ResolvedPosthogConfig` → `SystemConfig`**
    - **File**: `apps/api/src/system/system.service.ts` (and its DTO, `apps/api/src/system/dto/posthog-demo-integration.dto.ts`)
    - **Action**: `SystemService`'s `demoIntegrations.posthog` construction already spreads `ResolvedPosthogConfig` — add the two new fields to the DTO the same way `autocapture`/`sessionRecording` are already exposed there.
    - **Acceptance**: `GET /system` response includes `demoIntegrations.posthog.productEventsEnabled` and `.enabledEventGroups` when demo mode + PostHog are active.
    - **Dependencies**: Phase 1 complete.

12. **Extend `init-demo-integrations.ts`'s gating**
    - **File**: `apps/web/src/features/demo/lib/init-demo-integrations.ts` (from #1786)
    - **Action**:
      ```ts
      let productEventsEnabled = false;
      let enabledEventGroups: ReadonlySet<string> = new Set();

      // inside initDemoIntegrations, after resolving posthogConfig:
      productEventsEnabled = posthogConfig.productEventsEnabled;
      enabledEventGroups = new Set(posthogConfig.enabledEventGroups);

      // captureDemoEvent:
      export function captureDemoEvent<E extends DemoEventName>(
        event: E,
        props: DemoEventProps<E>,
      ): void {
        if (!posthogInstance || !productEventsEnabled) {
          return;
        }
        const group = DemoEventCatalog[event].group;
        if (!enabledEventGroups.has(group)) {
          return;
        }
        posthogInstance.capture(event, props);
      }
      ```
    - **Acceptance**: unit tests (Step 13) cover: no instance ⇒ no-op (existing #1786 test, unaffected); instance present but `productEventsEnabled: false` ⇒ no-op; instance present, `productEventsEnabled: true`, event's group absent from `enabledEventGroups` ⇒ no-op; all three gates pass ⇒ `posthog.capture` called.
    - **Dependencies**: Step 11; #1786 merged/available.

### Phase 4: Tests & Docs

13. **Tests**
    - `apps/web/src/features/posthog-settings/lib/derive-event-groups.test.ts` — fixture-catalog-driven, per Step 8's acceptance criteria (adding a fixture group with zero derivation-logic changes).
    - `apps/web/src/features/posthog-settings/components/product-events-section.test.tsx` — renders groups from a mocked/fixture catalog, dimming behavior, checkbox round-trip.
    - `apps/web/src/features/demo/lib/init-demo-integrations.test.ts` — extend the existing `captureDemoEvent` describe block (added in #1786) with the three new gating cases from Step 12.
    - `libs/core/src/analytics/application/services/posthog-settings.service.spec.ts`, `libs/core/src/analytics/infrastructure/persistence/repositories/posthog-settings.repository.spec.ts`, `apps/api/src/analytics/http/posthog-settings.controller.spec.ts` — each extended for the two new fields per Steps 4-6.
    - **Files**: as listed above.

14. **Docs**
    - **File**: `docs/analytics-events.md` (from #1786) — add a short "Enabling event groups" section pointing to `/settings` → Product events, since the doc currently only covers the catalog/marketing-handoff side.
    - **File**: `docs/architecture-overview.md` — one short paragraph under a new "PostHog settings" mention (see § Questions & Assumptions — no existing subsection to extend cleanly; add a minimal one rather than force-fitting into AI or Sync Manager sections as the issue suggested, since neither currently discusses PostHog at all).

---

## 7. Alternatives Considered

### Alternative 1: Per-event toggles instead of per-group
- **Description**: expose one checkbox per event name rather than per group.
- **Why Rejected**: the issue's own "Assumptions" section states group-level granularity was explicitly confirmed with the requester. Per-event toggles would also make the panel unbounded in length as #1788-1790 add dozens of events, whereas groups stay small and stable.
- **Trade-offs**: less fine-grained control for the operator, but matches the agreed UX and keeps the settings surface maintainable.

### Alternative 2: A dedicated "intent" flag on catalog entries, surfaced as a visual marker in the read-only view
- **Description**: add an `isIntentSignal: boolean` (or similar) field to each `DemoEventCatalog` entry so the settings panel can visually flag "this is a conversion-intent event."
- **Why Rejected**: with only one seed event today (from #1786), a dedicated flag is speculative design for a shape that doesn't exist yet — the event's `group` (`conversion-intent`) already communicates this without a redundant boolean. Revisit once #1788-1790 land enough events that grouping alone stops being self-explanatory.
- **Trade-offs**: slightly less polished UI today; avoids adding a field to the catalog schema (#1786's contract) that this task doesn't strictly need.

### Alternative 3: Server-side allowlist validation of `enabledEventGroups` against a duplicated group-name list
- **Description**: maintain a mirrored list of valid group names in `apps/api` (e.g. a `const` array) and validate incoming `enabledEventGroups` against it.
- **Why Rejected**: this is exactly the "hand-maintained group list" the issue explicitly warns against — it would need updating every time #1788-1790 (or any future work) adds a group, defeating the auto-derivation purpose. The existing precedent on this same settings row (`customHost`/`region` cross-validation living only in the FE Zod schema) supports treating this as acceptable trust-the-admin-form territory.
- **Trade-offs**: a typo'd group name is a silent no-op rather than a validation error — flagged as an open question in § 5 for reviewer sign-off.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No hexagonal-layer violation — extension stays within the existing `analytics` context's established layers (domain → application → infrastructure → interface).
- ✅ FE cross-feature import (`posthog-settings` → `demo`) goes through the public barrel only, per `docs/frontend-architecture.md § Feature Public Surface`.
- **Reference**: `docs/architecture-overview.md § Hexagonal Architecture Structure`.

### Naming Conventions
- ✅ `product-events-section.tsx` / `ProductEventsSection` (kebab-case file, PascalCase export) and `derive-event-groups.ts` follow `docs/frontend-architecture.md § Components And Pages` naming; `*.test.tsx`/`*.test.ts` colocated.
- ✅ Migration class `AddPosthogProductEventsSettings1829000000000` matches its filename's 13-digit prefix exactly.
- **Reference**: `docs/engineering-standards.md § Naming Conventions`.

### Existing Patterns
- ✅ ORM array column follows the `enabledCapabilities`/`ConnectionOrmEntity` jsonb-array precedent exactly.
- ✅ Migration is `IF [NOT] EXISTS`-guarded per `docs/migrations.md`'s self-healing convention, even though this is a fresh column (not a recovery scenario) — cheap insurance against re-run collisions.
- ✅ Repository/service/controller manual-mapping-point pattern is preserved (not refactored into a generic mapper) — consistent with the rest of this vertical slice, and refactoring that pattern is explicitly out of scope for this task.

### Risks
- **Missed manual mapping point**: the single biggest risk (§ 4) — mitigated by TypeScript's structural typing forcing a compile error at each of the four points once Step 1's type change lands; Phase 4's test extensions independently verify each layer.
- **#1786 not yet merged**: this plan's Phase 3 cannot compile until the demo-events framework exists on this branch — explicitly called out as a hard dependency, not silently assumed.
- **jsonb vs native `text[]` for `enabledEventGroups`**: chose jsonb to match the one existing precedent (`enabledCapabilities`) rather than introduce a second array-column idiom into the codebase; a native Postgres `text[]` would also work but has no precedent here.

### Edge Cases
- **Zero catalog entries** (hypothetically, if `demo-events.ts` ever shipped an empty catalog): `deriveEventGroups` returns `[]`, `ProductEventsSection` renders an empty-state message under the groups panel rather than a blank area.
- **`enabledEventGroups` contains a group name that no longer exists in the catalog** (e.g. an event/group was renamed after being enabled): harmless — `captureDemoEvent`'s `Set.has(group)` check for a *current* event's group only ever looks up groups that currently exist; a stale entry in the persisted array is inert, not an error.
- **Concurrent settings updates**: unaffected by this change — the existing `upsertSettings` single-row upsert semantics (no optimistic locking) are unchanged; not introducing new concurrency risk beyond what already exists for `autocapture`/`sessionRecording`.

### Backward Compatibility
- ✅ Fully additive — existing installs get `productEventsEnabled: false, enabledEventGroups: []` from the migration's `DEFAULT` clauses; no behavior change until an admin opts in via `/settings`.
- ✅ `resolveConfig()`'s env-fallback branch is unaffected for env-only (non-DB-row) installs — those always report `productEventsEnabled: false`, matching pre-existing "product events require the DB row" scoping.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `derive-event-groups.test.ts` — fixture-catalog-driven derivation correctness (order-stable, dedups, empty-catalog case).
- `product-events-section.test.tsx` — renders N groups from a fixture, dimming when `disabled`, checkbox round-trip via `renderWithProviders`.
- `init-demo-integrations.test.ts` (extended) — three new gating cases per Phase 3 Step 12.
- `posthog-settings.service.spec.ts`, `posthog-settings.repository.spec.ts`, `posthog-settings.controller.spec.ts` (all extended) — new-field coverage at each of the four manual mapping points.
- **Files**: as listed in Phase 4 Step 13.

### Integration Tests
- None required — this is a settings-row extension with no new cross-service orchestration; existing unit-test coverage of the four mapping points is sufficient per `docs/testing-guide.md`'s guidance that integration tests are reserved for full HTTP→DB vertical slices with real infra concerns, which this isn't (no new infra, no new capability).

### Mocking Strategy
- Backend specs mock the repository port / TypeORM repository per existing `posthog-settings.*.spec.ts` conventions (already established, just extended).
- FE tests mock the `demo` feature's `DemoEventCatalog` via a fixture object passed directly to `deriveEventGroups`/`ProductEventsSection`'s props — not via `vi.mock('../../demo', ...)` — so tests don't hard-couple to whatever real events #1786/#1788-1790 happen to define.

### Acceptance Criteria
- [ ] Event-group toggles render from the catalog automatically; a new group in code appears without editing the settings page.
- [ ] `enabledEventGroups` persists server-side and gates emission in `captureDemoEvent`.
- [ ] Read-only catalog shows each event's code-defined description and props.
- [ ] Panel is dimmed/disabled when the Product-events master or PostHog master is off.
- [ ] Tests added for the auto-group derivation and the gating.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` pass with zero errors.
- [ ] `pnpm --filter @openlinker/api migration:show` confirms the new migration is applied with no pending migrations.

**Reference**: `docs/testing-guide.md`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (extension stays within existing `analytics` context layers)
- [x] Respects CORE vs Integration boundaries (N/A — no integration/adapter touched)
- [x] Uses existing patterns (no unnecessary abstractions) — reuses the manual-mapping-point pattern, the jsonb-array ORM idiom, the flat-form dialog structure
- [ ] Idempotency considered — N/A (settings CRUD, no job/event processing)
- [ ] Event-driven patterns used where applicable — N/A (this *is* the control plane for an existing event-emission mechanism, not itself event-driven)
- [ ] Rate limits & retries addressed — N/A (no external API call introduced)
- [x] Error handling comprehensive — no new error paths; existing `@Roles('admin')` guard and DTO validation cover the new fields the same way as existing ones
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready **once #1786 is merged/available** (see hard dependency, § 2 Constraints and § 5 Assumptions)
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
- [Migrations Guide](../migrations.md)
- [Demo Events Framework Plan (#1786)](./implementation-plan-demo-events-framework.md)
- Issue: [#1787](https://github.com/openlinker-project/openlinker/issues/1787) (this task) — part of epic [#1785](https://github.com/openlinker-project/openlinker/issues/1785); depends on [#1786](https://github.com/openlinker-project/openlinker/issues/1786) (PR [#1817](https://github.com/openlinker-project/openlinker/pull/1817), not yet merged)
