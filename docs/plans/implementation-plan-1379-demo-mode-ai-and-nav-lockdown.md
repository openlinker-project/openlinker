# Implementation Plan: Demo-mode lockdown — AI-generation controls + Users nav "visible but locked"

**Date**: 2026-07-07
**Status**: Draft / Ready for Review
**Estimated Effort**: ~0.5–1 day
**Issue**: [#1379](https://github.com/openlinker-project/openlinker/issues/1379)

---

## 1. Task Summary

**Objective**: When the deployment runs in **demo mode** (`OL_DEMO_MODE=true`, surfaced to the FE as `SystemConfig.demoMode`), make two classes of affordance *visibly locked with a tooltip* instead of silently failing or being hidden:

1. **Every AI content-generation control** — the shared `SuggestionDialog` trigger (5 mount sites) and the bulk-wizard "Generate AI descriptions by default" checkbox — is rendered disabled with a tooltip reading *"AI generation is disabled in demo mode."* The bulk request must also carry `generateDescription = false` so a pre-checked default cannot smuggle a generation job into the worker.
2. **The Administration → Users nav group** (and, by the same mechanism, the AI nav group) is shown greyed-out / non-clickable with a tooltip *"Not available in demo mode."* — mirroring the existing "Automations" **Planned** pattern — instead of being filtered out of the sidebar.

**Context**: `DemoBanner` already advertises *"Demo mode — read-only. You can explore all data; write actions are disabled."* Today the AI buttons contradict that (they look active, then fail with a confusing "prompt template not found" error because no provider key is configured), and the admin nav groups vanish entirely rather than communicating that the feature exists but is locked. This closes the gap between what the banner promises and what the chrome shows.

**Classification**: Frontend — Interface layer (feature components + shared UI + app shell). No backend, no CORE, no migration.

---

## 2. Scope & Non-Goals

### In Scope
- Central demo-mode gate inside `SuggestionDialog` (covers all 5 AI-trigger mount sites in one edit).
- Bulk-wizard config-step checkbox gate + forcing `generateDescription = false` on submit in demo mode.
- A new `restricted` nav-group presentation (visible, greyed, tooltip) and demo-mode wiring in `buildNavGroups` so role-gated base groups (`AI`, `Administration`) render locked instead of hidden.
- One shared copy constant per message; a thin `useDemoMode()` hook in `features/system`.
- Unit tests for the SuggestionDialog gate, the bulk toggle gate, and the nav-registry restricted transform.

### Out of Scope
- **Backend enforcement.** The FE affordance is not the authorization source (`docs/frontend-architecture.md § App Boundary`). Whether the demo deployment rejects AI-completion requests server-side is a **separate backend concern** — noted, not delivered here.
- **A FE route guard on `/users`.** Hiding/locking the nav entry does not protect the route; visiting `/users` directly is still backend-gated (403). A friendly on-page "not available" state is an explicit follow-up.
- **Plugin-contributed admin nav items** (`NavContribution.requiresRole: 'admin'`, merged by `mergePluginNavContributions`) — in demo mode these remain filtered as today. Converting them to restricted is a bounded follow-up (see §5).
- Prompt-templates admin screens and the client-side "Preview" tab, and shipping-label "Generate label" — **not** AI generation, must stay enabled.

### Constraints
- No CSS changes for the nav — reuse `shell-nav__link--disabled` (per issue).
- No new styled UI library; the AI-button tooltip uses the existing Radix wrapper `shared/ui/tooltip.tsx`; the nav keeps its existing native `title` mechanism (see §5 Design note).
- Respect FE dependency rules (`docs/frontend-architecture.md § Dependency Rules` + § Feature Public Surface): cross-feature imports only through the feature barrel.

---

## 3. Architecture Mapping

**Target Layer**: App (`apps/web/src/app/**`) + Features (`apps/web/src/features/**`) + Shared (`apps/web/src/shared/**`). Frontend only.

**Existing services / seams reused**:
- `features/system` → `useSystemConfigQuery()` (returns `SystemConfig` with `demoMode`) — already consumed by `app-shell.tsx:206` and the login/register pages.
- `shared/ui/tooltip.tsx` — Radix wrappers `Tooltip` / `TooltipTrigger` / `TooltipContent`; `TooltipProvider` is already mounted near the app root (relied on today by `features/ai-provider-settings/components/ai-provider-table.tsx`).
- `apps/web/src/app/nav-registry.ts` (`BASE_NAV_GROUPS`, `buildNavGroups`), `nav-registry.types.ts` (`NavGroup`, `LiveNavGroup`, `PlannedNavGroup`, `Role`), `app-shell.tsx` (`SidebarNav`).
- `SuggestionDialog` (`features/content/components/suggestion-dialog.tsx`) — already exposes a `disabled?: boolean` prop.

**New components required**: none structural. New: one hook (`useDemoMode`), one/two copy constants, one nav-group variant (`RestrictedNavGroup`), and a rendering branch in `SidebarNav`.

**Core vs Integration Justification**: N/A — pure browser-UI affordance. No domain logic, no port, no adapter. Business authorization stays server-side.

**Reference**: `docs/architecture-overview.md § High-Level Architecture` (FE is a thin, separate app); `docs/frontend-architecture.md`.

---

## 4. External / Domain Research

No external system. Internal patterns found and reused:

- **Demo mode read path** — `app-shell.tsx:206`: `const demoMode = systemConfigQuery.data?.demoMode ?? false;`. The `getConfig` API is mocked in tests at `apps/web/src/test/test-utils.tsx:453` (`getConfig: vi.fn().mockResolvedValue({ demoMode: false })`) — tests override this to `true` to exercise the gate.
- **Disabled-with-hint nav pattern** — `app-shell.tsx:90-102`: `PlannedNavGroup` items render as `<span className="shell-nav__link shell-nav__link--disabled" role="link" aria-disabled="true" tabIndex={-1} title={item.reason}>`. The restricted variant reuses this shape verbatim, only swapping the reason string.
- **Role gate** — `buildNavGroups` (`nav-registry.ts:97-110`) filters `LiveNavGroup`s where `requiresRole === 'admin' && !isAdmin`, then folds in plugin contributions via `mergePluginNavContributions(baseGroups, contributions, { isAdmin })`.
- **Radix tooltip on a disabled control** — a natively `disabled` button emits no pointer events, so Radix's tooltip won't open. The established fix is to wrap the trigger in a focusable/hoverable `<span>` (`TooltipTrigger asChild` → `<span>` → the visually-disabled button). This plan uses that wrap for the demo-locked AI trigger.

---

## 5. Questions & Assumptions

### Open Questions
- **Q1 — Does demo mode lock role-gated groups for *all* viewers, or only non-admins?** The issue text frames Users as "hidden for non-admin roles today → show locked in demo". A demo deployment could log the visitor in as an admin (who would otherwise *see* Users live). **Assumed answer (A1 below).** Flag for reviewer.
- **Q2 — Copy**: two distinct strings (buttons vs nav) or one? The issue uses *"AI generation is disabled in demo mode."* for buttons and *"Not available in demo mode."* for nav. Plan keeps them as two constants.

### Assumptions
- **A1**: In demo mode, base nav groups carrying `requiresRole` (`AI`, `Administration`) render **restricted for everyone** (locked + tooltip), regardless of the viewer's role — this best advertises "the feature exists but is off in the demo" and matches the read-only banner. Outside demo mode, behavior is unchanged (role filtering as today). *Alternative — restrict only when the group would otherwise be hidden (non-admin) — noted in §7.*
- **A2**: Gating centrally in `SuggestionDialog` is acceptable; the 5 call sites keep their own non-demo `disabled` reasons (e.g. `EditOfferDrawer`'s `canSuggest && linkedProductId !== null`). Demo mode is OR-ed on top and its tooltip takes precedence.
- **A3**: The bulk worker honors `generateDescription = false`, so disabling the checkbox **and** forcing the submitted value to `false` fully prevents AI generation in demo mode.
- **A4**: `TooltipProvider` is mounted at the app root (verified indirectly — `ai-provider-table.tsx` uses `TooltipContent` in production). A verification step is included; if absent, mount it once in the app root alongside `ToastProvider`.
- **A5**: The nav restricted items keep the existing **native `title`** tooltip (consistent with the Planned pattern, "no CSS changes"). Only the AI buttons use the Radix `Tooltip`. This intentional split is documented in code comments so a future reviewer doesn't "unify" them incorrectly.

### Documentation Gaps
- `docs/frontend-architecture.md § Platform Plugins` documents `NavContribution.requiresRole` filtering but not a `restricted` presentation. If this pattern is adopted for plugin nav items later, that section should gain a note. Not required for this issue's base-group scope.

---

## 6. Proposed Implementation Plan

### Phase 1 — Shared primitives (demo-mode seam + copy)
**Goal**: One source of truth for "am I in demo mode" and for the two messages.

1. **Add `useDemoMode()` hook**
   - **File**: `apps/web/src/features/system/hooks/use-demo-mode.ts` (new)
   - **Action**: `export function useDemoMode(): boolean { return useSystemConfigQuery().data?.demoMode ?? false; }`. File header per standards.
   - **Export**: add `export { useDemoMode } from './hooks/use-demo-mode';` to `apps/web/src/features/system/index.ts`.
   - **Acceptance**: importable as `import { useDemoMode } from '../../system'` from another feature; returns `false` until config resolves.

2. **Add demo-copy constants**
   - **File**: `apps/web/src/shared/lib/demo-mode.ts` (new; `shared/` so both `features/content` and `features/listings` may import without cross-feature coupling).
   - **Action**: `export const AI_GENERATION_DEMO_DISABLED_MESSAGE = 'AI generation is disabled in demo mode.';` and `export const NAV_DEMO_RESTRICTED_MESSAGE = 'Not available in demo mode.';`
   - **Acceptance**: single import site for each string; no duplicated literals across components.

### Phase 2 — AI-generation controls (covers inventory items 1–5 + 6)
**Goal**: Every AI trigger is disabled + tooltip in demo mode; bulk never submits a generation flag.

3. **Gate `SuggestionDialog` centrally (items 1–5)**
   - **File**: `apps/web/src/features/content/components/suggestion-dialog.tsx`
   - **Action**:
     - `const demoMode = useDemoMode();` (import from `../../system`).
     - `const effectiveDisabled = disabled || demoMode;`
     - Non-demo path unchanged: `DialogTrigger` → `Button disabled={effectiveDisabled}`.
     - Demo path: render a **non-dialog**, visually-disabled trigger wrapped in the Radix tooltip so the message is discoverable:
       ```tsx
       if (demoMode) {
         return (
           <Tooltip>
             <TooltipTrigger asChild>
               {/* span wrap: a disabled <button> emits no hover events */}
               <span className="content-suggestion__demo-lock" tabIndex={0}>
                 <Button type="button" tone="ghost" disabled aria-disabled>
                   ✨ Suggest with AI
                 </Button>
               </span>
             </TooltipTrigger>
             <TooltipContent>{AI_GENERATION_DEMO_DISABLED_MESSAGE}</TooltipContent>
           </Tooltip>
         );
       }
       ```
       (No `Dialog` is mounted in demo mode → the modal cannot open at all.)
   - **Acceptance**: with `demoMode=true`, the trigger is present, `aria-disabled`, does not open the dialog on click, and reveals the tooltip on hover/focus. With `demoMode=false`, unchanged (including the existing `disabled` prop reason).
   - **Dependencies**: Phase 1.

4. **Verify pass-through at the 5 mount sites (no functional edits expected)**
   - **Files**: `features/content/components/content-editor.tsx` (master + per-channel), `content-panel.tsx`, `features/listings/components/EditOfferDrawer.tsx`, `AllegroCreateOfferWizard.tsx`, `bulk/bulk-edit-modal.tsx`.
   - **Action**: confirm each still renders `SuggestionDialog` and that their own `disabled`/`canSuggest` logic composes with the new internal gate (it does — demo mode is OR-ed inside the dialog). No change unless a site renders its own fallback `<span>` when `!canSuggest` that would bypass the dialog in demo mode (acceptable — that path is a *different* disabled reason and remains valid).
   - **Acceptance**: manual/inspection pass; covered by the SuggestionDialog unit test.

5. **Gate the bulk config-step checkbox (item 6)**
   - **File**: `apps/web/src/features/listings/components/bulk/bulk-config-step.tsx:333-348`
   - **Action**: `const demoMode = useDemoMode();`. Set the checkbox `disabled={demoMode}`; when `demoMode`, force `checked={false}` and short-circuit `onChange`. Wrap the label (or checkbox) in a `Tooltip` with `NAV`-independent copy `AI_GENERATION_DEMO_DISABLED_MESSAGE`. Add a muted hint line "Disabled in demo mode." for non-hover discoverability.
   - **Acceptance**: in demo mode the checkbox is unchecked, disabled, and tooltipped; not in demo mode it behaves as before.

6. **Force `generateDescription = false` on bulk submit in demo mode**
   - **File**: `apps/web/src/features/listings/components/bulk/bulk-wizard.tsx` (request assembly, ~line 288 `generateDescription: config.generateDescription`).
   - **Action**: `const demoMode = useDemoMode();` → `generateDescription: demoMode ? false : config.generateDescription;`. This is defense-in-depth in case a persisted/default config value is truthy.
   - **Acceptance**: request payload in demo mode always has `generateDescription === false`, independent of the checkbox state.

### Phase 3 — Nav "visible but locked" (`restricted` group)
**Goal**: In demo mode, role-gated base groups render greyed with a tooltip instead of disappearing.

7. **Add the `RestrictedNavGroup` variant + demo input type**
   - **File**: `apps/web/src/app/nav-registry.types.ts`
   - **Action**:
     ```ts
     export interface RestrictedNavItem { label: string; }
     export interface RestrictedNavGroup {
       kind: 'restricted';
       label: string;
       items: RestrictedNavItem[];
       reason: string; // tooltip copy
     }
     export type NavGroup = LiveNavGroup | PlannedNavGroup | RestrictedNavGroup;
     ```
     Keep `NavRegistryGroup` as the live/planned source shape (restricted is produced only at build time, never authored in `BASE_NAV_GROUPS`).
   - **Acceptance**: `type-check` passes; `NavGroup` is a 3-way union.

8. **Teach `buildNavGroups` about demo mode**
   - **File**: `apps/web/src/app/nav-registry.ts`
   - **Action**: extend input to `{ isAdmin: boolean; demoMode: boolean }`. Replace the role filter so that a `LiveNavGroup` with `requiresRole === 'admin'` that is **not** shown live is transformed rather than dropped:
     - if `demoMode` → emit `{ kind: 'restricted', label, items: items.map(i => ({ label: i.label })), reason: NAV_DEMO_RESTRICTED_MESSAGE }`;
     - else if `!isAdmin` → drop (today's behavior);
     - else → keep live.
   - Under A1, in demo mode the transform applies regardless of `isAdmin` (admin groups always shown locked in a demo). Plugin contributions still merge via `mergePluginNavContributions(..., { isAdmin })` into the remaining live groups (restricted groups are excluded from the merge target set).
   - **Acceptance**: unit test in §9 covers demo/non-demo × admin/non-admin.
   - **Dependencies**: Phase 1 (copy constant), step 7.

9. **Render the `restricted` branch in `SidebarNav`**
   - **File**: `apps/web/src/app/app-shell.tsx` (`SidebarNav`, ~line 69-102) and the `groups` memo (~line 219).
   - **Action**:
     - `SidebarNav`: add a branch for `group.kind === 'restricted'` that renders each item exactly like the Planned disabled span but with `title={group.reason}` — reusing `shell-nav__link shell-nav__link--disabled`, `role="link"`, `aria-disabled="true"`, `tabIndex={-1}`. (Refactor the existing planned/restricted disabled-span into a small local helper to avoid duplication.)
     - Pass demo mode into the builder: `const groups = useMemo(() => buildNavGroups({ isAdmin, demoMode }), [isAdmin, demoMode]);` (`demoMode` already computed at line 206).
   - **Acceptance**: in demo mode the sidebar shows `AI` and `Administration` groups greyed, non-clickable, with the demo tooltip; not in demo mode, unchanged (hidden for non-admin, live for admin).

### Implementation Details
- **New components**: `useDemoMode` hook, `demo-mode.ts` copy constants, `RestrictedNavGroup` type + `SidebarNav` branch.
- **Config / migrations / events**: none.
- **Error handling**: none new — this is presentational gating. The existing `SuggestionDialog` missing-template error path is now unreachable in demo mode (dialog never mounts), which is the desired outcome.

---

## 7. Alternatives Considered

- **Gate each of the 5 AI call sites individually** instead of inside `SuggestionDialog`. Rejected — five edits, drift risk, and each site would re-derive `demoMode`. Central gate is one edit and structurally guarantees coverage.
- **Restrict role-gated nav groups only when they'd otherwise be hidden (non-admin)** (the strict reading of "hidden for non-admins → show locked"). Trade-off: a demo *admin* would keep full Users/AI access, so the demo wouldn't showcase those areas as "locked". A1 chooses always-locked-in-demo for a consistent demo story; this alternative is the fallback if the reviewer prefers minimal behavior change for admins.
- **Convert the whole live group to `kind:'planned'`** and reuse its per-item `reason`. Rejected — `PlannedNavItem` semantics ("coming in a future release") are wrong here; a dedicated `restricted` kind keeps the tooltip truthful and future-proofs a role-based (non-demo) variant.
- **Use the Radix `Tooltip` for the nav items too** (uniformity with the AI buttons). Rejected for this issue — the Planned pattern already uses native `title`, the issue says "no CSS changes", and disabled `<span role=link>` + `title` is simplest. Revisit only if the nav adopts richer tooltips globally.

*ADR*: not warranted — this is a localized FE presentation pattern, not a cross-context or plugin-contract decision. (If plugin nav items later adopt `restricted`, revisit `docs/frontend-architecture.md § Platform Plugins`.)

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ FE-only, Interface layer. No CORE/Integration boundary touched. Business authz stays server-side (`docs/frontend-architecture.md § App Boundary`).
- ✅ Cross-feature imports go through barrels (`features/system` → `useDemoMode`; copy constant in `shared/`). No `shared → features` import introduced.
- ✅ Headless-lib policy respected — Radix used only via `shared/ui/tooltip.tsx`.

### Naming / structure
- ✅ Hook `use-demo-mode.ts`; constants in `shared/lib/`; types in `nav-registry.types.ts`. Matches `docs/frontend-architecture.md § Components And Pages` naming.

### Risks & Edge Cases
- **R1 — Radix tooltip on disabled button silently doesn't open.** Mitigation: the mandatory `<span>` wrap (step 3, A-note). Covered by the unit test asserting the tooltip content is reachable.
- **R2 — Config still loading** (`data` undefined): `?? false` means controls are briefly *enabled* before config resolves. Acceptable (sub-second, and non-demo is the safe default); note in code. Alternative (disable-until-known) rejected as over-engineering.
- **R3 — `route-*.test.ts` nav/route contract tests.** Adding a `restricted` group is a *runtime transform*, not a new authored route/nav entry, so `route-lazy.test.ts` / `route-handle.test.ts` counts are unaffected. Verify `app-shell.test.tsx` still passes and extend it.
- **R4 — Behavior change for demo admins** (A1): a demo admin loses live Users/AI nav. Intended per A1; flagged for reviewer in §5/§7.
- **Backward compatibility**: non-demo behavior is byte-for-byte unchanged (role filtering + live rendering). Only the demo path diverges.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests (Vitest + Testing Library; `renderWithProviders`, `createMockApiClient`)
- **`suggestion-dialog.test.tsx`** (new/extended): with `getConfig → { demoMode: true }`, assert the trigger is `aria-disabled`, clicking it does **not** open the dialog, and the tooltip copy `AI_GENERATION_DEMO_DISABLED_MESSAGE` is reachable; with `demoMode: false`, the dialog opens as before and the existing `disabled` prop still applies.
- **`bulk-config-step.test.tsx`** (new/extended): in demo mode the checkbox is `disabled` and unchecked; toggling is a no-op.
- **`bulk-wizard.test.tsx`** (extended): submitted `BulkOfferCreateRequest.sharedConfig.generateDescription === false` in demo mode even if config had it true.
- **`nav-registry.test.ts`** (new/extended): `buildNavGroups` matrix — {demoMode:false, isAdmin:false} hides AI/Admin; {false, true} shows them live; {true, *} emits them as `kind:'restricted'` with `reason === NAV_DEMO_RESTRICTED_MESSAGE`.
- **`app-shell.test.tsx`** (extended): in demo mode the sidebar renders greyed, `aria-disabled` Users/AI entries with the demo `title`.

### Mocking Strategy
- Mock only the `getConfig` API response (`demoMode`) — no implementation-detail mocking. Reuse `test-utils.tsx` defaults, override per test.

### Acceptance Criteria
- [ ] In demo mode, `✨ Suggest with AI` is disabled + tooltipped in all 5 sites (master content, per-channel content, Edit Offer drawer, Allegro wizard step 2, bulk per-row modal) and cannot open its dialog.
- [ ] In demo mode, the bulk "Generate AI descriptions by default" checkbox is disabled + tooltipped, and the bulk request always sends `generateDescription: false`.
- [ ] In demo mode, `AI` and `Administration` nav groups are visible, greyed, non-clickable, with tooltip *"Not available in demo mode."*.
- [ ] Outside demo mode, every control and the nav behave exactly as before (role filtering intact).
- [ ] Prompt-template "Preview" and shipping "Generate label" remain enabled.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` pass.
- [ ] No `shared → features` import; cross-feature imports via barrels only.

---

## 10. Alignment Checklist

- [x] Follows FE architecture (Interface layer; thin FE; server-side authz preserved)
- [x] Respects CORE vs Integration boundaries (N/A — FE only)
- [x] Uses existing patterns (planned-item disabled span, `useSystemConfigQuery`, Radix tooltip wrapper) — no unnecessary abstraction
- [x] Idempotency / events / rate limits — N/A (presentational)
- [x] Error handling — existing paths preserved; failing AI path made unreachable in demo
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [ ] Plan saved as markdown file — this file

---

## Related Documentation
- [Frontend Architecture](../frontend-architecture.md) — App Boundary, Dependency Rules, Feature Public Surface, Platform Plugins (`requiresRole`)
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md) — naming, `as const` unions, type placement
- [Testing Guide](../testing-guide.md) — Vitest / Testing Library patterns
- Issue [#1379](https://github.com/openlinker-project/openlinker/issues/1379)
