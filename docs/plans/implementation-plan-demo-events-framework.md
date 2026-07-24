# Implementation Plan: Typed Demo-Events Catalog + Gated `captureDemoEvent` Helper

**Date**: 2026-07-23
**Status**: Draft
**Estimated Effort**: 3-4 hours

---

## 1. Task Summary

**Objective**: Introduce a small, typed event-instrumentation framework in the `demo` feature: a single-source-of-truth event catalog (`demo-events.ts`) and a gated `captureDemoEvent()` helper that emits named PostHog events only when demo analytics is active.

**Context**: The demo instance (`OL_DEMO_MODE`) already records PostHog sessions and pageviews via `apps/web/src/features/demo/lib/init-demo-integrations.ts`, but there is no way to emit named business events. Marketing needs named, low-cardinality events to build funnels without scattering untyped `capture('...')` strings across the codebase. This is the foundation task (#1786) for epic #1785 — it blocks the settings panel (#1787) and all three event-instrumentation batches (#1788/#1789/#1790).

**Classification**: Frontend / DX (Interface layer — feature lib, no backend involvement).

---

## 2. Scope & Non-Goals

### In Scope
- `apps/web/src/features/demo/lib/demo-events.ts` — the event catalog (`as const`), with `DemoEventName` / `DemoEventGroup` / per-event `props` types derived from it.
- `captureDemoEvent(event, props)` added to `init-demo-integrations.ts`, gated the same way `disableDemoAnalytics` already is (no-op unless `initDemoIntegrations` actually initialized PostHog this session).
- Barrel export of both from `apps/web/src/features/demo/index.ts`.
- `docs/analytics-events.md` — marketing handoff table (event, description, props, what it measures).
- Unit tests for the gating behaviour (no-op when PostHog was never initialized) and for the catalog shape.

### Out of Scope
- The `/settings` Product-events panel (#1787) — consumes this catalog but is a separate task.
- The three viewer-event instrumentation batches (#1788/#1789/#1790) — those add real business events to the catalog; this task ships the framework with a minimal placeholder set only.
- Marketing-site (`openlinker-website`) instrumentation (website#32/#33) — separate repo, separate task.
- Any backend/API change — this is 100% frontend, in-browser.

### Constraints
- Must not introduce a runtime dependency beyond the existing `posthog-js` (already dynamically imported).
- Must preserve the existing no-op behaviour on a non-demo / no-key build (zero PostHog code paths touched).
- Props must stay low-cardinality: bounded strings/enums, numbers, booleans — never PII, free text, or entity ids (per issue constraint).

---

## 3. Architecture Mapping

**Target Layer**: Frontend — Feature lib (`apps/web/src/features/demo/lib/`). No `app`/`pages`/`shared` involvement beyond the existing feature barrel.

**Capabilities Involved**: None (no backend ports). This is pure frontend feature-lib code plus a documentation artifact.

**Existing Services Reused**:
- `posthogInstance` module-local state and the `initDemoIntegrations` gating chain (`demoMode` → `posthogConfig.key` → visitor consent) already in `init-demo-integrations.ts` — `captureDemoEvent` piggybacks on the same instance variable, no new gating logic needed.
- `apps/web/src/features/demo/index.ts` barrel — extended, not restructured.

**New Components Required**:
- `demo-events.ts` (new file, catalog + derived types).
- `captureDemoEvent` function (new export in the existing `init-demo-integrations.ts` file).
- `docs/analytics-events.md` (new doc).
- `demo-events.test.ts` (new test file for catalog shape / typing smoke checks).

**Core vs Integration Justification**: N/A — this is frontend-only, no `libs/core` or `libs/integrations` involvement. Classified per `docs/frontend-architecture.md` as a feature-lib module (`features/demo/lib/`), which is the documented "Optional: pure helpers / view-model mappers" subdirectory.

---

## 4. External / Domain Research

### External System (PostHog)
- Already integrated via `posthog-js`, dynamically imported only when demo mode + key + consent all pass (see `init-demo-integrations.ts:25-49`).
- `posthog.capture(eventName: string, properties?: Record<string, unknown>)` is the SDK call `captureDemoEvent` will delegate to. No new auth, no new rate-limit concerns — same client already initialized.

### Internal Patterns
- **Gating precedent**: `disableDemoAnalytics()` (`init-demo-integrations.ts:56-58`) is the exact shape to mirror — a function operating on the module-local `posthogInstance` that is `null` whenever init never ran, making every caller naturally a no-op pre-init.
- **`as const` + derived-union pattern**: `demo.types.ts` already uses `DemoAnalyticsConsentValues = [...] as const` → `type DemoAnalyticsConsent = (typeof ...)[number]`. The new catalog follows the same idiom but one level deeper (deriving from object keys/values, not a flat array), matching `docs/engineering-standards.md § Union Types: as const Pattern`.
- **Test mocking pattern**: `init-demo-integrations.test.ts` already mocks `posthog-js` at module level (`vi.mock('posthog-js', ...)`) and drives `getDemoAnalyticsConsent`/`initDemoIntegrations` to control whether `posthogInstance` gets set. `captureDemoEvent` tests reuse this exact harness — no new test infrastructure needed.
- **Barrel discipline**: `apps/web/src/features/demo/index.ts` re-exports named symbols only (`docs/frontend-architecture.md § Feature Public Surface`) — adding two more named exports follows the existing convention exactly.

---

## 5. Questions & Assumptions

### Open Questions
- Should the catalog ship with zero events (empty object, typed but content-free) or 1-2 placeholder events, given the real business events arrive in #1788-1790? The acceptance criteria say "unknown name or wrong props is a TypeScript error" and "tests added for the gating behaviour" — both are testable with an empty or near-empty catalog, but an empty `as const` object degenerates `DemoEventName` to `never`, which cannot be exercised in a test.

### Assumptions
- **Default (safe) assumption**: ship the catalog with a small number (2-3) of genuinely useful, low-cardinality placeholder events that batch tasks can still use or extend — not "fake test events" that get deleted later. Candidates that are framework-appropriate regardless of which batch claims them: `demo_analytics_consent_accepted` / `demo_analytics_consent_declined` (mirrors the existing consent lifecycle this feature already owns) is deliberately **excluded** because that's a consent decision, not a product-analytics business event, and adding it here would blur scope. Instead this plan seeds exactly one illustrative event, `demo_viewer_locked_action_clicked` (group: `conversion-intent`), described in the epic itself as the single highest-value signal category ("intent-to-convert clicks on the locked action"). It is a real, reusable event — batch tasks (#1788-1790) are expected to call it from their own locked-action call sites, not redefine it — and it fully exercises `DemoEventName`/`DemoEventGroup`/typed-props end to end for tests and TypeScript-error acceptance criteria.
- The catalog's `props` shape is expressed as a TypeScript type per entry (not a runtime Zod/validator schema) — consistent with props only ever needing compile-time enforcement per the issue ("Calling `captureDemoEvent` with an unknown name or wrong props is a TypeScript error"). No runtime prop validation is added; this matches the codebase's existing `as const` pattern (compile-time only, no runtime schema) and avoids a new dependency for a browser-only, low-stakes analytics event.
- `captureDemoEvent` takes `props` as a required second argument (not optional) even for events with `{}` props, for consistency and to avoid `event: E, props?: DemoEventProps<E>` overload complexity. If a future event needs zero props, its catalog entry declares `props: {} as Record<string, never>` and callers pass `{}`.
- The marketing handoff doc (`docs/analytics-events.md`) will note explicitly that this is the framework PR — the table has one row today and grows with #1788/#1789/#1790 — so marketing doesn't mistake it for the final catalog.

### Documentation Gaps
- Neither `docs/frontend-architecture.md` nor `docs/engineering-standards.md` documents an existing "typed event catalog derived via `as const`" pattern beyond flat union types (`DemoAnalyticsConsentValues`). This plan introduces the first instance of a *nested* `as const` catalog (object of objects) — Step 6.1 below documents the exact shape so #1788-1790 can extend it without re-deriving the pattern.

---

## 6. Proposed Implementation Plan

### Phase 1: Catalog + Helper

**Goal**: Ship the typed catalog and the gated capture helper, fully covered by unit tests.

**Steps**:

1. **Create the event catalog**
   - **File**: `apps/web/src/features/demo/lib/demo-events.ts`
   - **Action**:
     ```ts
     /**
      * Demo Events Catalog
      *
      * Single source of truth for demo-mode PostHog business events. Each
      * entry's `description` is the text marketing sees (settings panel,
      * #1787); `group` drives the settings panel's per-group toggles and is
      * discovered from this catalog, never hand-maintained. Props must stay
      * low-cardinality — bounded strings/numbers/booleans only, never PII,
      * free text, or entity ids.
      */
     export const DemoEventCatalog = {
       demo_viewer_locked_action_clicked: {
         description:
           'Viewer clicked a locked (read-only) write action — the primary intent-to-convert signal for a read-only demo session',
         group: 'conversion-intent',
         props: {} as { actionName: string; surface: string },
       },
     } as const;

     export type DemoEventName = keyof typeof DemoEventCatalog;

     export type DemoEventGroup = (typeof DemoEventCatalog)[DemoEventName]['group'];

     export type DemoEventProps<E extends DemoEventName> = (typeof DemoEventCatalog)[E]['props'];
     ```
   - **Acceptance**: `DemoEventName` resolves to the literal union of catalog keys; `DemoEventGroup` resolves to the union of every entry's `group` value (today just `'conversion-intent'`); no group is hand-declared anywhere else in the codebase.
   - **Dependencies**: none.

2. **Add `captureDemoEvent` to `init-demo-integrations.ts`**
   - **File**: `apps/web/src/features/demo/lib/init-demo-integrations.ts`
   - **Action**: import `DemoEventCatalog`, `DemoEventName`, `DemoEventProps` from `./demo-events`; add, next to `disableDemoAnalytics`:
     ```ts
     /**
      * Emits a named demo business event to PostHog. A no-op whenever
      * PostHog was never initialized this session (not demo mode, no key,
      * or consent not accepted) — mirrors `disableDemoAnalytics`'s gate on
      * the same module-local `posthogInstance`.
      */
     export function captureDemoEvent<E extends DemoEventName>(
       event: E,
       props: DemoEventProps<E>,
     ): void {
       posthogInstance?.capture(event, props);
     }
     ```
   - **Acceptance**: `captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'x', surface: 'y' })` type-checks; `captureDemoEvent('not_a_real_event', {})` and `captureDemoEvent('demo_viewer_locked_action_clicked', { wrong: 1 })` both fail `tsc`. At runtime, calling it before/without a successful `initDemoIntegrations()` call does not throw and does not call `posthog.capture`.
   - **Dependencies**: Step 1 (catalog must exist for the generic constraint).

3. **Export from the feature barrel**
   - **File**: `apps/web/src/features/demo/index.ts`
   - **Action**: add
     ```ts
     export { captureDemoEvent } from './lib/init-demo-integrations';
     export { DemoEventCatalog } from './lib/demo-events';
     export type { DemoEventName, DemoEventGroup, DemoEventProps } from './lib/demo-events';
     ```
   - **Acceptance**: `import { captureDemoEvent, DemoEventCatalog, type DemoEventName } from '../../demo'` resolves from any sibling feature/plugin (mirrors existing `disableDemoAnalytics`/`initDemoIntegrations` re-exports on the line above).
   - **Dependencies**: Steps 1-2.

### Phase 2: Tests

**Goal**: Cover the gating behaviour and the catalog's derived-type shape per the acceptance criteria.

**Steps**:

4. **Extend `init-demo-integrations.test.ts` with `captureDemoEvent` coverage**
   - **File**: `apps/web/src/features/demo/lib/init-demo-integrations.test.ts`
   - **Action**: add `posthogCapture = vi.fn()` to the existing `vi.mock('posthog-js', ...)` factory (alongside `posthogInit`/`posthogOptOut`), then a new `describe('captureDemoEvent', ...)` block:
     - `should not call posthog.capture when PostHog was never initialized` — call `captureDemoEvent(...)` with no prior `initDemoIntegrations` call in this test (or after a gated-out `initDemoIntegrations` call, e.g. consent declined) and assert `posthogCapture` was never called.
     - `should call posthog.capture with the event name and props once PostHog is initialized` — run the existing `configuredPosthog` + accepted-consent init flow, then call `captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' })` and assert `posthogCapture` was called with `('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' })`.
   - **Acceptance**: both tests pass under `pnpm test`; the "never initialized" test is the one the issue's acceptance criteria explicitly calls out ("verified by unit test with a null instance").
   - **Dependencies**: Phase 1 complete.

5. **Add `demo-events.test.ts`**
   - **File**: `apps/web/src/features/demo/lib/demo-events.test.ts`
   - **Action**: a small smoke test asserting the catalog's runtime shape stays in sync with its type contract — e.g. every catalog entry has non-empty `description` and `group` strings, and `Object.keys(DemoEventCatalog)` is non-empty. This is a low-value-but-cheap regression guard (catches an accidental empty catalog or a stripped `description`), not a substitute for the compile-time checks in Step 2.
   - **Acceptance**: test passes; documents the catalog's invariants for future contributors adding events in #1788-1790.
   - **Dependencies**: Step 1.

### Phase 3: Documentation

**Goal**: Ship the marketing handoff artifact required by the issue.

**Steps**:

6. **Create `docs/analytics-events.md`**
   - **File**: `docs/analytics-events.md` (new)
   - **Action**: a table with columns `Event | Description | Props | What it measures`, seeded from `DemoEventCatalog`'s single entry, plus a short intro noting (a) this is the demo-mode PostHog catalog, source of truth is `apps/web/src/features/demo/lib/demo-events.ts`, (b) the table grows as #1788/#1789/#1790 land, (c) events only fire on a demo-mode build with PostHog configured and visitor consent accepted.
   - **Acceptance**: matches the issue's "Docs impact" requirement; a marketing reader can map each event to its measurement intent without reading code.
   - **Dependencies**: Phase 1 complete (content sourced from the real catalog).

7. **(Optional, discuss with reviewer) Note the pattern in `docs/frontend-architecture.md`**
   - **File**: `docs/frontend-architecture.md`
   - **Action**: the issue's docs-impact section says "if the team wants it recorded there" — this plan treats it as optional and defers to the PR reviewer's call. If added, one short paragraph under a new `## Demo analytics events` heading pointing at `demo-events.ts` as the FE analytics pattern (mirrors the existing `## Design tokens` / `## Shared UI catalog` sections' style: contract description + drift/consistency guarantee, i.e. "groups are derived, never hand-maintained").
   - **Acceptance**: N/A if skipped; if added, one section, no rule contradictions with the rest of the doc.
   - **Dependencies**: Phase 1 complete.

### Implementation Details

**New Components**:
- **Frontend feature lib**: `demo-events.ts` (catalog + derived types), extended `init-demo-integrations.ts` (new export).
- **Tests**: extended `init-demo-integrations.test.ts`, new `demo-events.test.ts`.
- **Docs**: new `docs/analytics-events.md`, optional one-section addition to `docs/frontend-architecture.md`.

**Configuration Changes**: None — reuses the existing `SystemConfig.demoIntegrations.posthog` config surface untouched.

**Database Migrations**: None — no backend/schema involvement.

**Events**:
- **Emitted**: one demo-mode PostHog event as a placeholder (`demo_viewer_locked_action_clicked`) — the framework itself doesn't add more; #1788-1790 add the rest.
- **Consumed**: none.

**Error Handling**: None needed — `captureDemoEvent` cannot throw (optional chaining on `posthogInstance`, and `posthog.capture` itself doesn't throw synchronously per the SDK's fire-and-forget design already relied upon by `disableDemoAnalytics`/`initDemoIntegrations`).

---

## 7. Alternatives Considered

### Alternative 1: Flat `DemoEventCatalog` as a discriminated-union array instead of an object keyed by event name
- **Description**: `[{ name: 'x', description: ..., group: ..., props: {} as Props }, ...] as const`, deriving `DemoEventName` via a mapped `(typeof arr)[number]['name']`.
- **Why Rejected**: an object keyed by event name gives direct `DemoEventCatalog[eventName]` lookup (useful for the settings panel in #1787 to render per-event rows) without an `Array.find`, and the generic `DemoEventProps<E>` lookup type (`(typeof catalog)[E]['props']`) is more direct against an object shape than against an array-derived union. The array form has no advantage for this use case.
- **Trade-offs**: none material; object-keyed is strictly more ergonomic here.

### Alternative 2: Runtime prop validation (e.g. a per-event Zod schema instead of a bare TS type)
- **Description**: give each catalog entry a `propsSchema: z.object({...})` and have `captureDemoEvent` call `.parse(props)` before `posthog.capture`.
- **Why Rejected**: the issue's acceptance criteria explicitly frame the requirement as a *compile-time* guarantee ("is a TypeScript error"), not a runtime one. Demo-mode analytics events are low-stakes (PostHog silently drops malformed events; no downstream business logic depends on their shape), so adding a new runtime-validation dependency and per-event schema-authoring overhead isn't justified. `docs/engineering-standards.md`'s `as const` pattern is explicitly the lightweight, no-runtime-artifact default for exactly this kind of domain-constant catalog.
- **Trade-offs**: a caller could still bypass the compiler with an `as any` cast and send malformed props to PostHog. Accepted risk — consistent with how the rest of the FE codebase treats compile-time-enforced contracts (e.g. DTOs are still runtime-validated only at the API boundary, not in-browser).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No backend/core/integration boundary touched — pure `apps/web` feature-lib change.
- ✅ Dependency direction respected: `demo-events.ts` and `init-demo-integrations.ts` both live in `features/demo/lib/`, no upward imports into `app`/`pages`.
- **Reference**: `docs/frontend-architecture.md § Feature Public Surface`, `§ Folder Conventions`.

### Naming Conventions
- ✅ `*.ts` (lib helper, not a component) — no kebab-case component naming applies; `demo-events.ts` matches the existing `demo-analytics-consent.ts` / `init-demo-integrations.ts` lib-file convention.
- ✅ Types derived via `as const` per `docs/engineering-standards.md § Union Types: as const Pattern`.
- **Reference**: `docs/engineering-standards.md § Naming Conventions`.

### Existing Patterns
- ✅ Mirrors `disableDemoAnalytics`'s exact gating shape (module-local nullable instance, optional chaining).
- ✅ Mirrors `demo.types.ts`'s `as const` + derived-union idiom, extended one level for the nested catalog case.
- ✅ Test file reuses the existing `vi.mock('posthog-js', ...)` harness rather than introducing a new one.

### Risks
- **Catalog/props drift** (a `props` type that no longer matches what a call site actually passes): mitigated entirely at compile time — a wrong-shape call fails `pnpm type-check`. No runtime risk since `captureDemoEvent` never inspects prop values, it forwards them verbatim to `posthog.capture`.
- **Empty-catalog degenerate case**: if a reviewer prefers a genuinely empty catalog over the one placeholder event, `DemoEventName` becomes `never` and `captureDemoEvent` becomes uncallable — this would fail the "verified by unit test" acceptance criterion, since there'd be no valid event to call in a positive test. Flagged in Questions & Assumptions; this plan's default is to seed one real, reusable event to avoid the degenerate case.
- **Settings-panel dependency (#1787)**: `DemoEventGroup` must genuinely be *discovered* from the catalog (not redeclared) since #1787's panel renders one toggle per distinct `group` value — verified by Step 1's acceptance criterion; no action needed here beyond keeping the type derivation intact.

### Edge Cases
- `captureDemoEvent` called multiple times before/after `initDemoIntegrations` resolves (the `async` init function): since `posthogInstance` is set synchronously inside the `async` function body before `await` returns to the caller, and `captureDemoEvent` reads the same module-local variable, ordering is safe as long as callers don't invoke `captureDemoEvent` from application code paths that outrace `initDemoIntegrations` being awaited at app bootstrap (existing risk for `disableDemoAnalytics` too, not introduced by this change).
- Calling `captureDemoEvent` with props containing `undefined` values: TypeScript will already reject `undefined` for a non-optional `string`/`number`/`boolean` prop declared in the catalog; no additional runtime guard needed given Alternative 2's rejection.

### Backward Compatibility
- ✅ Purely additive — no existing export, type, or behaviour changes. `disableDemoAnalytics`/`initDemoIntegrations`'s existing signatures and tests are untouched.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `apps/web/src/features/demo/lib/init-demo-integrations.test.ts` — extended with a `captureDemoEvent` describe block (no-op-when-uninitialized + calls-through-when-initialized), per Step 4.
- `apps/web/src/features/demo/lib/demo-events.test.ts` — new, catalog-shape smoke test, per Step 5.
- **Files**: both above, run via `pnpm test` (or `pnpm --filter web test` if the workspace scopes it).

### Integration Tests
- None required — this is a pure frontend unit-testable helper with no API/DB/cross-service interaction.

### Mocking Strategy
- `posthog-js` mocked at module level (existing `vi.mock('posthog-js', ...)` factory, extended with a `capture` spy) — consistent with how `init` and `opt_out_capturing` are already mocked.
- `./demo-analytics-consent` mocked at module level (existing pattern) to control the consent gate deterministically per test.

### Acceptance Criteria
- [ ] `demo-events.ts` catalog exists; `DemoEventName` and `DemoEventGroup` are derived from it, not declared separately.
- [ ] `captureDemoEvent` is a no-op when PostHog is not initialised (verified by unit test with a null instance).
- [ ] Calling `captureDemoEvent` with an unknown name or wrong props is a TypeScript error.
- [ ] Helper + catalog exported from the `demo` feature barrel.
- [ ] Tests added for the gating behaviour.
- [ ] Marketing handoff doc added (`docs/analytics-events.md`).
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all pass with zero errors.

**Reference**: `docs/testing-guide.md`, `docs/frontend-architecture.md § Testing Baseline`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — pure frontend feature-lib task, no backend layers touched)
- [x] Respects CORE vs Integration boundaries (N/A — no `libs/core`/`libs/integrations` involvement)
- [x] Uses existing patterns (no unnecessary abstractions) — mirrors `disableDemoAnalytics` gating + `demo.types.ts` `as const` idiom
- [x] Idempotency considered — `captureDemoEvent` has no state/side effects beyond a single fire-and-forget `posthog.capture` call
- [ ] Event-driven patterns used where applicable — N/A (this *is* the event-emission mechanism, not a consumer of one)
- [ ] Rate limits & retries addressed — N/A (PostHog capture is fire-and-forget client-side, no OL-side rate limiting applicable)
- [x] Error handling comprehensive — no error paths exist in this helper by design (optional chaining only)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue: [#1786](https://github.com/openlinker-project/openlinker/issues/1786) (this task) — part of epic [#1785](https://github.com/openlinker-project/openlinker/issues/1785)
