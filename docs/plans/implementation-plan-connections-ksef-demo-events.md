# Implementation Plan: Connections/Import, Category Mapping & KSeF Numbering Demo Events (batch 2)

**Date**: 2026-07-24
**Status**: Draft
**Estimated Effort**: 1 day

**Issue**: [#1789](https://github.com/openlinker-project/openlinker/issues/1789) — part of [#1785](https://github.com/openlinker-project/openlinker/issues/1785). Depends on the demo-events catalog + `captureDemoEvent` helper (#1786) and mirrors the batch-1 wiring already shipped in [#1788](https://github.com/openlinker-project/openlinker/issues/1788).

---

## 1. Task Summary

**Objective**: Wire `captureDemoEvent(...)` at 15 viewer-interaction points across three reels — connections/product import, category mapping, and KSeF invoice numbering — so demo-mode PostHog analytics can measure funnel drop-off and intent-to-convert clicks the same way batch 1 (#1788) did for products/orders/listings/invoicing.

**Context**: #1785 splits the demo-analytics instrumentation work into per-reel batches so each PR stays reviewable. Batch 1 shipped the framework (`captureDemoEvent`, `DemoEventCatalog`, the `/settings` Product-events panel) and instrumented the e-commerce reel. This batch reuses that framework verbatim — no new infrastructure, only new catalog entries and new call sites.

**Classification**: Frontend / Interface layer (`apps/web/src/**`). No CORE or Integration changes — `captureDemoEvent` and its gating (`productEventsEnabled` + `enabledEventGroups`) already exist server-side (posthog_settings columns) and client-side (`features/demo/lib/init-demo-integrations.ts`) from #1786/#1787.

---

## 2. Scope & Non-Goals

### In Scope
- 15 new `DemoEventCatalog` entries in `apps/web/src/features/demo/lib/demo-events.ts`, spanning 3 new groups (`connections-reel`, `category-mapping-reel`, `ksef-numbering-reel`) plus 4 entries reusing the existing `conversion-intent` group for the `★` (locked-write) events.
- `captureDemoEvent(...)` calls added at the 15 cited call sites, across 12 distinct component files (7 of which are the per-platform connection setup-form siblings, each getting the identical one-line addition).
- Unit test coverage for every new capture call, following the exact pattern used to close the batch-1 test-coverage gap (see `docs/plans/implementation-plan-ecommerce-reel-events.md` follow-up and the recent tech-review fix on this branch).
- `docs/analytics-events.md` table updated with the 15 new rows and the "batches landed" status line.

### Out of Scope
- Any change to `captureDemoEvent`, `DemoEventCatalog`'s shape, `ProductEventsSection`, or the PostHog settings backend — all already shipped (#1786/#1787).
- Batch 3 (#1790, not yet read — explicitly deferred).
- Introducing `useWriteAccess`/`ReadOnlyLock` gating on `connection-category-mappings-page.tsx` or `MappingPanel.tsx` — neither has write-access gating today, and the issue does **not** mark `demo_category_map_attempted` / `demo_mapping_save_attempted` with `★`, so both fire as plain (non-locked) clicks. Adding real write-gating to category mapping is a separate, larger product decision, not an analytics task.
- Instrumenting the "Trigger sync…" dialog's own submit button inside `TriggerSyncDialog` — the issue only asks for the dialog-*open* click on `ConnectionActionsPanel`; the dialog's internal submit is a different component not listed in the issue and is flagged under Risks below as a likely batch-3/follow-up gap.
- Instrumenting `AllegroCategorySearch`'s own internal row-click (the actual DOM element the operator clicks to pick a category) — the issue's cited handler (`connection-category-mappings-page.tsx:124`, `handleAllegroSelect`) is one level up, in the callback the page passes down, which is where the capture call is added; no change needed inside `AllegroCategorySearch` itself.

### Constraints
- Must reuse the exact `captureDemoEvent` / `ReadOnlyLock`-`onLockedClick` / catalog-props pattern established in #1788 — no new abstractions.
- Every event must be a no-op on a self-hosted (non-demo-mode) build, which is already guaranteed by `captureDemoEvent`'s existing gate (`posthogInstance` + `productEventsEnabled` + `enabledEventGroups`) — no per-call-site guard needed.
- Props must stay low-cardinality (bounded strings/enums/booleans), never entity ids or free text, per the existing catalog-header convention in `demo-events.ts`.

---

## 3. Architecture Mapping

**Target Layer**: Frontend / Interface (`apps/web/src/features/**`, `apps/web/src/pages/**`, `apps/web/src/plugins/ksef/**`). No `libs/core` or `apps/api` changes.

**Capabilities Involved**: None new — no ports, no backend endpoints. Purely a client-side call-site addition against the existing `demo` feature's public barrel (`captureDemoEvent`, imported per `docs/frontend-architecture.md` § Feature Public Surface).

**Existing Services/Components Reused**:
- `captureDemoEvent` (`features/demo/lib/init-demo-integrations.ts`, exported from `features/demo/index.ts`)
- `DemoEventCatalog` / `deriveEventGroups` (`features/posthog-settings/lib/derive-event-groups.ts`) — the settings panel auto-derives its group toggles from whatever groups the catalog declares, so adding 3 new group strings needs **zero** settings-panel code changes (this is the entire point of #1787's design).
- `ReadOnlyLock`'s `onLockedClick` prop (`shared/ui/read-only-lock.tsx`) — already supports this; 3 of the cited call sites (`create-connection-form.tsx`, `ConnectionActionsPanel.tsx`'s "Test connection", `ksef-numbering-editor.tsx`'s "Save series") already have `ReadOnlyLock` wired with `active` bound to a `demoReadOnly` boolean — they just need `onLockedClick` added.

**New Components Required**: None. This is additive instrumentation inside existing components.

**Core vs Integration Justification**: N/A — no CORE or Integration involvement. All work is frontend `features`/`pages`/`plugins` call-site edits, consistent with how #1788 was scoped.

---

## 4. External / Domain Research

### Internal Patterns (from reading the current code — see file-by-file table in §6)

**Import path convention** (confirmed against #1788's actual call sites):
| Caller depth | Import path |
|---|---|
| `pages/**/*.tsx` | `'../../features/demo'` |
| `features/connections/components/*.tsx` | `'../../demo'` |
| `features/mappings/components/*.tsx` | `'../../demo'` |
| `plugins/ksef/components/*.tsx` | `'../../../features/demo'` |

**Existing `DemoEventGroup` values**: only `'conversion-intent'` and `'ecommerce-reel'` exist today (both from #1788). This batch introduces three new group literals — since `DemoEventGroup` is a **derived** type (`(typeof DemoEventCatalog)[DemoEventName]['group']`, not a hand-maintained union), adding a new string as a catalog entry's `group` value is sufficient; no separate type edit is needed.

**Gaps found vs. the issue's assumptions** (see full detail in §6 file table):
- `platform-picker.tsx` has **no click handler today** — platform selection is a bare React Router `<Link>` (line 24). Capturing "platform selected" means adding an `onClick` prop to that `Link` (React Router forwards it to the underlying `<a>`; it does not block navigation).
- `adapters-catalog-page.tsx` has no filter/count UI — it's a static table + a Retry button. `demo_adapters_catalog_viewed` is a page-view capture (mirrors `demo_products_viewed`'s "fire once per successful load" `useRef` pattern), not a click.
- `connection-category-mappings-page.tsx` and `MappingPanel.tsx` have **no `useWriteAccess`/`ReadOnlyLock` gating at all** — both `demo_category_map_attempted` and `demo_mapping_save_attempted` fire as plain (unlocked) clicks, which matches the issue not marking either with `★`.
- `ksef-numbering-series-tab.tsx` has **3** editor-opening buttons in-file (empty-state "Add series", toolbar "Add series", row "Edit") plus a 4th entry point one level down (`KsefNumberingRoutingCard`'s `onAddSeries` callback) that is out of scope since it's outside the 11 cited files.
- Two files have **no existing test file**: `ksef-numbering-page.tsx` and `ksef-numbering-series-tab.tsx`. New test files are needed for these (see §9).

---

## 5. Questions & Assumptions

### Open Questions
- Should the "Trigger sync…" dialog-open button on `ConnectionActionsPanel` also fire when the *dialog's own* submit is clicked (i.e., should batch 2 or a follow-up instrument `TriggerSyncDialog`)? The issue only lists the dialog-open click. Flagged under Risks — recommend a follow-up issue rather than silently expanding this PR's scope.
- Exact new group names (`connections-reel` / `category-mapping-reel` / `ksef-numbering-reel`) are not specified by the issue, only the *display* grouping ("Connections, Category mapping, and KSeF groups"). Proposed names below follow the `-reel` suffix convention `ecommerce-reel` already established; open to renaming at review time since renaming a catalog `group` string before merge is a one-line change with no migration cost (groups are derived, not persisted anywhere except the `enabled_event_groups` jsonb array on `posthog_settings`, which is operator-configured after the fact).

### Assumptions
- **`demo_connections_filtered` props shape**: the issue lists a single `filter_key` prop; this plan instead uses `{ filter: string; value: string }` — the exact shape already used by `demo_orders_filtered` in #1788 — for cross-event consistency in the catalog (marketing/ops reading the read-only catalog view benefit from one shared shape for all "X filtered" events). Camel-case `filter`/`value` field names match the codebase's props-naming convention (`demo-events.ts` uses `camelCase`, e.g. `resultCountBucket`, `documentType`), not the issue's `snake_case` (`filter_key`, `platform_type`, etc.) — the issue text appears to predate the catalog's actual `camelCase` convention finalized in #1788, so this plan normalizes every prop name to `camelCase` throughout (e.g. `platform_type` → `platformType`, `adapter_count` → `adapterCountBucket`, `mapped_count_bucket` → `mappedCountBucket`).
- **`mappingKind` prop for `demo_mapping_save_attempted`**: `MappingPanel` already receives a `title` prop (e.g. "Status mapping", "Carrier mapping", "Payment mapping") from each parent call site — this plan reuses `title` verbatim as the `mappingKind` value rather than threading a new prop, since it's already a low-cardinality, human-readable string.
- **`demo_adapters_catalog_viewed`'s `adapterCountBucket`**: bucketed the same way `demo_products_viewed`'s `resultCountBucket` is (`'0' | '1-10' | '11-50' | '50+'`), reusing the existing `bucketResultCount`-shaped helper (duplicated locally in this file per the existing precedent — `products-list-page.tsx` and this page don't share a bucketing helper today, and introducing a new `shared/` utility for a 4-line pure function would be premature abstraction for two call sites).
- **PrestaShop et al. setup-form `platform` prop**: each setup-form component is platform-specific with no `platformType` variable in scope, so `platform` is hardcoded per-file (`'prestashop'`, `'allegro'`, `'dpd'`, `'erli'`, `'infakt'`, `'inpost'`, `'subiekt'`, `'woocommerce'`), mirroring how `AllegroCreateOfferWizard.tsx` hardcodes `platform: 'allegro'` in its own step-advance capture (#1788 precedent).
- **`demo_connection_platform_selected` doesn't block navigation**: the `onClick` added to `platform-picker.tsx`'s `<Link>` fires synchronously and does not call `preventDefault`, matching `captureDemoEvent`'s fire-and-forget contract everywhere else in the codebase.

### Documentation Gaps
- None — `docs/frontend-architecture.md` § Feature Public Surface already documents cross-feature `demo` barrel consumption as the intended shape (the #1787 precedent cited there generalizes cleanly to these new call sites).

---

## 6. Proposed Implementation Plan

### Phase 1: Catalog — add 15 new events across 3 new groups
**Goal**: `DemoEventCatalog` has every event this batch needs, with the settings panel auto-deriving 3 new group toggles with zero panel-code changes.

**Steps**:
1. **Add 15 entries to `DemoEventCatalog`**
   - **File**: `apps/web/src/features/demo/lib/demo-events.ts`
   - **Action**: Append a new `// ── Connections / product import (#1789) ──` section, then `// ── Category mapping (#1789) ──`, then `// ── KSeF invoice numbering (#1789) ──`, following the exact entry shape already used (`description`, `group`, `props` with real placeholder values cast via `as { ... }`). Entries (camelCase props, see §5 assumption on naming):

     | Event | Group | Props |
     |---|---|---|
     | `demo_connection_platform_selected` | `connections-reel` | `{ platformType: string }` |
     | `demo_adapters_catalog_viewed` | `connections-reel` | `{ adapterCountBucket: string }` |
     | `demo_connections_filtered` | `connections-reel` | `{ filter: string; value: string }` |
     | `demo_connection_wizard_step_advanced` | `connections-reel` | `{ platform: string; step: string }` |
     | `demo_connection_create_attempted` ★ | `conversion-intent` | `{ platform: string }` |
     | `demo_connection_test_attempted` ★ | `conversion-intent` | `{ platform: string }` |
     | `demo_connection_sync_dialog_opened` | `connections-reel` | `Record<string, never>` |
     | `demo_category_mapping_opened` | `category-mapping-reel` | `{ mappedCountBucket: string }` |
     | `demo_category_source_selected` | `category-mapping-reel` | `Record<string, never>` |
     | `demo_category_map_attempted` | `category-mapping-reel` | `Record<string, never>` |
     | `demo_mapping_save_attempted` | `category-mapping-reel` | `{ mappingKind: string }` |
     | `demo_ksef_numbering_tab_switched` | `ksef-numbering-reel` | `{ tab: string }` |
     | `demo_ksef_series_editor_opened` | `ksef-numbering-reel` | `{ mode: string }` |
     | `demo_ksef_numbering_variable_inserted` | `ksef-numbering-reel` | `{ variable: string }` |
     | `demo_ksef_series_save_attempted` ★ | `conversion-intent` | `{ mode: string }` |

   - **Acceptance**: `pnpm --filter @openlinker/web test demo-events.test.ts` still passes; every non-empty-props entry has real (non-empty) runtime keys per the existing invariant test.
   - **Dependencies**: None.

2. **Extend the `NO_PROPS_EVENTS` whitelist**
   - **File**: `apps/web/src/features/demo/lib/demo-events.test.ts`
   - **Action**: Add `'demo_connection_sync_dialog_opened'`, `'demo_category_source_selected'`, `'demo_category_map_attempted'` to the existing `NO_PROPS_EVENTS` set (these three legitimately carry zero runtime props, matching the existing exemption pattern for `demo_product_row_expanded` etc.).
   - **Acceptance**: The "every non-empty-typed entry has runtime-inspectable prop keys" test still passes for the new entries.
   - **Dependencies**: Step 1.

### Phase 2: Connections & product-import reel (7 events, 9 files)
**Goal**: Every connections/import call site in the issue fires its event with the right props.

**Steps**:
1. **`demo_connection_platform_selected`**
   - **File**: `apps/web/src/features/connections/components/platform-picker.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../demo'`; add `onClick={() => captureDemoEvent('demo_connection_platform_selected', { platformType: card.platformType })}` to the `<Link>` at line 24 (fire-and-forget, no `preventDefault`).
   - **Acceptance**: Clicking a platform card fires the capture with the clicked card's `platformType` before navigating.

2. **`demo_adapters_catalog_viewed`**
   - **File**: `apps/web/src/pages/adapters/adapters-catalog-page.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../features/demo'`; add a local `bucketAdapterCount` helper (same 4-bucket shape as `products-list-page.tsx`'s `bucketResultCount`) and a fire-once `useRef` + `useEffect` (mirroring `demo_products_viewed`'s pattern) that fires once `query.data` resolves, with `{ adapterCountBucket: bucketAdapterCount(query.data.length) }`.
   - **Acceptance**: Loading the adapters catalog page fires the capture exactly once per successful load, not on refetch.

3. **`demo_connections_filtered`**
   - **File**: `apps/web/src/pages/connections/connections-list-page.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../features/demo'`; call it inside `handleFilterChange(key, value)` (lines 90–100) with `{ filter: key, value }`, mirroring `orders-list-page.tsx`'s `demo_orders_filtered` call site.
   - **Acceptance**: Changing either the platform or status `<Select>` fires the capture with the correct `filter`/`value` pair.

4. **`demo_connection_wizard_step_advanced`** (7 files — one line each, no shared abstraction needed since each file already has its own `goNext`/step-advance function)
   - **Files**: `apps/web/src/features/connections/components/{prestashop,allegro,dpd,erli,infakt,inpost,subiekt,woocommerce}-setup-form.tsx` — **note**: verify at implementation time which of these 7 sibling files (confirmed present: `dpd-setup-form.tsx`, `erli-setup-form.tsx`, `infakt-setup-form.tsx`, `inpost-setup-form.tsx`, `prestashop-setup-form.tsx`, `subiekt-setup-form.tsx`, `woocommerce-setup-form.tsx`) actually have a step-based wizard shape matching `prestashop-setup-form.tsx`'s `goNext()` — some may be single-step forms with no step-advance to instrument; skip any that have no step concept and note it in the PR description rather than forcing a capture call into a non-stepped form.
   - **Action**: Import `captureDemoEvent` from `'../../demo'`; inside each file's step-advance function (e.g. `goNext()` at `prestashop-setup-form.tsx:110`), call `captureDemoEvent('demo_connection_wizard_step_advanced', { platform: '<hardcoded-platform-literal>', step: STEP_LABELS[stepIndex] })` before advancing `stepIndex`, mirroring `AllegroCreateOfferWizard.tsx`'s `goToNextStep` shape exactly (capture fires with the step being *left*, not the step being entered — same convention).
   - **Acceptance**: Clicking "Next" in each stepped setup wizard fires the capture with that platform's literal + the current step label.

5. **`demo_connection_create_attempted`** ★
   - **File**: `apps/web/src/features/connections/components/create-connection-form.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../demo'`; add `onLockedClick={() => captureDemoEvent('demo_connection_create_attempted', { platform: watchedPlatformType })}` to the existing `ReadOnlyLock` at lines 216–226 (no other change — `active`/`message` already correctly wired).
   - **Acceptance**: A demo read-only viewer clicking the locked "Create connection" button fires the capture with the currently-selected platform.

6. **`demo_connection_test_attempted`** ★
   - **File**: `apps/web/src/features/connections/components/ConnectionActionsPanel.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../demo'`; add `onLockedClick={() => captureDemoEvent('demo_connection_test_attempted', { platform: connection.platformType })}` to the existing `ReadOnlyLock` around the "Test connection" button (lines 85–93).
   - **Acceptance**: A demo read-only viewer clicking the locked "Test connection" button fires the capture with the connection's platform.

7. **`demo_connection_sync_dialog_opened`**
   - **File**: `apps/web/src/features/connections/components/ConnectionActionsPanel.tsx` (same file as step 6)
   - **Action**: Add `captureDemoEvent('demo_connection_sync_dialog_opened', {})` directly inside the "Trigger sync…" button's existing `onClick={() => setIsTriggerDialogOpen(true)}` (lines 122–128) — this button is **not** `ReadOnlyLock`-wrapped, so it fires unconditionally on click (opening the dialog is not itself a write action; see Non-Goals for the dialog's own submit).
   - **Acceptance**: Clicking "Trigger sync…" fires the capture regardless of demo mode / write access.

### Phase 3: Category mapping reel (4 events, 2 files)
**Goal**: Category-mapping page-view, source-select, and (unlocked) map/save attempts are captured.

**Steps**:
1. **`demo_category_mapping_opened`**
   - **File**: `apps/web/src/pages/connections/connection-category-mappings-page.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../features/demo'`; add a fire-once `useEffect` (same `useRef` pattern as `demo_orders_viewed`) once the page's data has resolved past the loading/error/empty guards, with `{ mappedCountBucket: <bucketed count of already-mapped rows> }`.
   - **Acceptance**: Opening the category-mappings page for a connection fires the capture once per successful load.

2. **`demo_category_source_selected`**
   - **File**: `apps/web/src/pages/connections/connection-category-mappings-page.tsx`
   - **Action**: Call `captureDemoEvent('demo_category_source_selected', {})` inside `handleMarketplaceChange(nextId)` (lines 114–122).
   - **Acceptance**: Changing the marketplace/source `<Select>` fires the capture.

3. **`demo_category_map_attempted`** (not gated — matches issue's omission of `★`)
   - **File**: `apps/web/src/pages/connections/connection-category-mappings-page.tsx`
   - **Action**: Call `captureDemoEvent('demo_category_map_attempted', {})` at the top of `handleAllegroSelect(category, path)` (lines 124–134), which is passed as `onSelect` into `<AllegroCategorySearch>` — fires on every category pick attempt, including ones the server later rejects (a valid intent signal per the issue's problem statement).
   - **Acceptance**: Picking a category in the search UI fires the capture even though this page has no write-access gating today.

4. **`demo_mapping_save_attempted`** (not gated)
   - **File**: `apps/web/src/features/mappings/components/MappingPanel.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../demo'`; call it at the top of `handleSave()` (lines 156–158) with `{ mappingKind: title }` (reusing the existing `title` prop — see §5 assumption).
   - **Acceptance**: Clicking "Save mappings" (or "Try again") fires the capture with the panel's `title` (e.g. "Carrier mapping").

### Phase 4: KSeF numbering reel (4 events, 3 files)
**Goal**: Tab switches, editor opens, variable inserts, and the locked save are all captured.

**Steps**:
1. **`demo_ksef_numbering_tab_switched`**
   - **File**: `apps/web/src/plugins/ksef/components/ksef-numbering-page.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../../features/demo'`; call it inside `setTab(next)` (lines 43–52) with `{ tab: next }`, before or alongside the state update.
   - **Acceptance**: Switching between the "series" and "audit" tabs fires the capture with the destination tab name.

2. **`demo_ksef_series_editor_opened`** (3 call sites, same file)
   - **File**: `apps/web/src/plugins/ksef/components/ksef-numbering-series-tab.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../../features/demo'`; call it in all three `setMode(...)` call sites (empty-state "Add series" line ~128, toolbar "Add series" line ~169, row "Edit" line ~206) with `{ mode: 'create' }` or `{ mode: 'edit' }` respectively, matching each button's actual `kind`.
   - **Acceptance**: Each of the three entry points fires the capture with the correct `mode`.

3. **`demo_ksef_numbering_variable_inserted`**
   - **File**: `apps/web/src/plugins/ksef/components/ksef-numbering-editor.tsx`
   - **Action**: Import `captureDemoEvent` from `'../../../features/demo'`; call it inside `insertVariable(variable)` (lines 125–141) with `{ variable }`.
   - **Acceptance**: Clicking a numbering-variable chip fires the capture with that variable's literal (e.g. `{seq}`).

4. **`demo_ksef_series_save_attempted`** ★
   - **File**: `apps/web/src/plugins/ksef/components/ksef-numbering-editor.tsx` (same file as step 3)
   - **Action**: Add `onLockedClick={() => captureDemoEvent('demo_ksef_series_save_attempted', { mode: isEdit ? 'edit' : 'create' })}` to the existing `ReadOnlyLock` at lines 349–357.
   - **Acceptance**: A demo read-only viewer clicking the locked "Save series" button fires the capture with the correct `mode`.

### Phase 5: Docs
**Steps**:
1. **Update the analytics events doc**
   - **File**: `docs/analytics-events.md`
   - **Action**: Add all 15 new rows to the event table (same columns: Event, Description, Props, What it measures), and update the "Status" line at the top from "framework (#1786) + e-commerce reel batch (#1788) landed. The remaining batches (#1789, #1790) are still to come." to reflect #1789 landed, #1790 still pending.
   - **Acceptance**: Doc lists all 29 events (14 existing + 15 new) with accurate props.

---

## 7. Alternatives Considered

### Alternative 1: One shared `useViewedOnceCapture(eventName, props, ready)` hook for the three new "page opened" events
- **Description**: Extract the fire-once `useRef` + `useEffect` pattern (used 3× in this batch, on top of the 2 pre-existing uses in #1788) into a shared hook in `features/demo/`.
- **Why Rejected**: Five total call sites across two batches is not yet enough duplication to justify a new public hook on the `demo` feature's barrel — per `docs/engineering-standards.md`'s "avoid over-generalized APIs; build only the surface the current product needs," and per this repo's own precedent of keeping `bucketResultCount`-style helpers file-local until a third real consumer appears. Revisit if batch 3 (#1790) adds more "viewed once" events.
- **Trade-offs**: Slightly more repeated boilerplate (5 lines × 5 call sites) in exchange for zero new shared-surface maintenance burden.

### Alternative 2: Gate `demo_category_map_attempted` / `demo_mapping_save_attempted` behind new `ReadOnlyLock` wiring (add real write-access gating to category mapping)
- **Description**: Introduce `useWriteAccess('mappings:write', demoMode)` to `connection-category-mappings-page.tsx` and thread a `demoReadOnly` prop into `MappingPanel`, wrapping both actions in `ReadOnlyLock` like every other write action in the app.
- **Why Rejected**: This is a real product/security decision (should category mapping be write-locked for demo viewers at all?) that the issue explicitly doesn't ask for — it says "some are not [gated] and fire a server-rejected mutation — both are valid intent signals," treating the current unlocked state as intentional for this reel. Bundling a permissions change into an analytics PR would also violate the "don't design for hypothetical future requirements" / minimal-diff principle. Flagged under Risks as a candidate follow-up.
- **Trade-offs**: A future demo session could still technically mutate category mappings (if the backend doesn't already reject demo-mode writes at the API layer) — worth a separate, explicit product conversation, not an implicit side effect of this instrumentation PR.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE/Integration/backend changes; purely `apps/web` interface-layer call-site edits.
- ✅ `captureDemoEvent` consumed only via the `demo` feature's public barrel (`features/demo/index.ts`), never via a deep import — per `docs/frontend-architecture.md` § Feature Public Surface.

### Naming Conventions
- ✅ All new catalog event names follow the existing `demo_<noun>_<verb_past_tense>` shape (`demo_connection_platform_selected`, etc.).
- ✅ All new catalog `props` fields use `camelCase` (this plan intentionally deviates from the issue's `snake_case` prop names — see §5 Assumptions).

### Existing Patterns
- ✅ Every call site reuses the exact #1788 pattern (`ReadOnlyLock.onLockedClick` for gated writes, inline capture for ungated actions, fire-once `useRef` for page-view events) — no new abstractions introduced (see §7 Alternative 1).

### Risks
- **`platform-picker.tsx` has no existing click handler**: adding one to a `<Link>` is low-risk (React Router forwards `onClick` without side effects), but it's a slightly different pattern than the rest of the batch (state-based `onClick` vs. navigation-based) — call out explicitly in the PR description so reviewers aren't surprised.
- **Setup-form siblings may not all be step-based**: some of the 7 `*-setup-form.tsx` files might be single-screen forms with no `stepIndex`/`goNext` to hook into. Verify per-file at implementation time (Phase 2, step 4) rather than assuming uniformity; skip and document any that don't apply.
- **`TriggerSyncDialog`'s own submit is uninstrumented**: flagged as an explicit Non-Goal (§2) and a likely follow-up gap — the dialog *open* click is captured, but the dialog's actual "Trigger" submit (a real write action) is not, per the issue's literal scope. Recommend filing a fast-follow issue rather than silently expanding this PR.
- **`ksef-numbering-page.tsx` and `ksef-numbering-series-tab.tsx` have no existing test file**: this batch must create both from scratch (unlike the other 9 files, which just need new `it(...)` blocks added to existing suites) — slightly more effort per file, budgeted into the estimate.

### Edge Cases
- A demo viewer with `enabledEventGroups` covering only some of the 3 new groups (e.g. `connections-reel` on, `ksef-numbering-reel` off) must see `captureDemoEvent` no-op for the KSeF calls while `connections-reel` calls still fire — already guaranteed by `captureDemoEvent`'s existing per-group gate; no new logic needed, but worth one cross-group assertion in a test (see §9).
- `bucketAdapterCount(0)` / `bucketResultCount`-style zero-count buckets must render `'0'`, not throw or return `undefined`, mirroring the existing `bucketResultCount` boundary behavior.

### Backward Compatibility
- ✅ No breaking changes — every edit either adds a new (optional-by-nature, no-op-until-configured) capture call or adds `onLockedClick` to a `ReadOnlyLock` instance that previously had none (i.e., previously a no-op click, now a capture-only click — no behavior change for the underlying disabled control).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
Every capture call gets a `vi.mock('<relative-path-to-demo>', () => ({ captureDemoEvent: (...args) => captureDemoEvent(...args) }))`-style test, following the exact pattern this branch's own tech-review fix pass just established across 8 files (see `apps/web/src/pages/products/products-list-page.test.tsx`, `apps/web/src/features/listings/components/AllegroCreateOfferWizard.test.tsx`, etc., for the reference shape):

| File | New/extended test file | What to assert |
|---|---|---|
| `platform-picker.tsx` | extend existing `.test.tsx` | Clicking a platform card's `Link` fires `demo_connection_platform_selected` with that card's `platformType`. |
| `adapters-catalog-page.tsx` | extend existing `.test.tsx` | Loading the page fires `demo_adapters_catalog_viewed` exactly once with the correct bucket; a refetch does not re-fire. |
| `connections-list-page.tsx` | extend existing `.test.tsx` | Changing each filter `<Select>` fires `demo_connections_filtered` with the matching `filter`/`value`. |
| Each of the 7 `*-setup-form.tsx` files | extend existing `.test.tsx` per file | Clicking "Next" fires `demo_connection_wizard_step_advanced` with that file's hardcoded platform + the step being left. |
| `create-connection-form.tsx` | extend existing `.test.tsx` | Clicking the locked "Create connection" button (via `.read-only-lock`, per the established jsdom-safe pattern — disabled buttons don't reliably dispatch `click`) fires `demo_connection_create_attempted` with the selected platform. |
| `ConnectionActionsPanel.tsx` | extend existing `.test.tsx` | (a) Locked "Test connection" click fires `demo_connection_test_attempted`; (b) unlocked "Trigger sync…" click fires `demo_connection_sync_dialog_opened` unconditionally (both demo and non-demo sessions). |
| `connection-category-mappings-page.tsx` | extend existing `.test.tsx` | Page load fires `demo_category_mapping_opened` once; source-select change fires `demo_category_source_selected`; a category pick fires `demo_category_map_attempted`. |
| `MappingPanel.tsx` | extend existing `.test.tsx` | Clicking "Save mappings" fires `demo_mapping_save_attempted` with `{ mappingKind: title }`. |
| `ksef-numbering-page.tsx` | **new** `.test.tsx` | Switching tabs fires `demo_ksef_numbering_tab_switched` with the destination tab. |
| `ksef-numbering-series-tab.tsx` | **new** `.test.tsx` | Each of the three "open editor" buttons fires `demo_ksef_series_editor_opened` with the correct `mode`. |
| `ksef-numbering-editor.tsx` | extend existing `.test.tsx` | Clicking a variable chip fires `demo_ksef_numbering_variable_inserted` with that variable; the locked "Save series" click fires `demo_ksef_series_save_attempted` with the correct `mode`. |
| `demo-events.ts` | extend existing `demo-events.test.ts` | All 15 new entries pass the existing "non-empty description/group" and "runtime prop keys" invariant tests; the 3 no-props entries are added to `NO_PROPS_EVENTS`. |

### Mocking Strategy
- Mock only the `demo` feature's barrel (`vi.mock('<path>/demo', ...)`), exactly as established in the #1788 tests — never mock `ReadOnlyLock` itself; render it for real and click the `.read-only-lock` wrapper element for locked-click assertions (per the established jsdom-safe pattern, since a `disabled` inner button does not reliably dispatch `click`).
- No new API mocks needed beyond what each page/component's existing tests already set up (`createMockApiClient`).

### Acceptance Criteria
- [ ] All 15 events fire from their cited (or, where drifted, actually-current) handler with the props listed in §6.
- [ ] All 3 `★` events fire only via the `ReadOnlyLock`'s `onLockedClick` (i.e., only reachable when `active`/demo-read-only).
- [ ] `DemoEventCatalog` has all 15 entries, correctly grouped so the `/settings` Product-events panel shows `connections-reel`, `category-mapping-reel`, and `ksef-numbering-reel` toggles with zero settings-panel code changes.
- [ ] No event fires on a self-hosted (non-demo-mode) build — already guaranteed by the existing `captureDemoEvent` gate; add one smoke assertion per new file confirming the mock is never called when `productEventsEnabled`/consent preconditions aren't met, if the file doesn't already have blanket coverage of that gate.
- [ ] `docs/analytics-events.md` lists all 15 new events.
- [ ] `pnpm lint && pnpm type-check && pnpm test` all pass (per `docs/testing-guide.md` — tests are not run by the planning agent itself; verified at implementation time).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — N/A, no CORE/Integration touched.
- [x] Respects CORE vs Integration boundaries — no boundary crossed.
- [x] Uses existing patterns (no unnecessary abstractions) — reuses #1788's `captureDemoEvent`/`ReadOnlyLock`/catalog pattern verbatim; explicitly rejected a premature shared hook (§7 Alternative 1).
- [x] Idempotency considered — N/A, these are fire-and-forget analytics events with no server-side side effects.
- [ ] Event-driven patterns used where applicable — N/A (client-side analytics only, not the backend event bus).
- [ ] Rate limits & retries addressed — N/A, PostHog's own client SDK handles delivery; no new network calls introduced by OL code.
- [x] Error handling comprehensive — N/A, `captureDemoEvent` already no-ops safely when ungated; no new failure modes introduced.
- [x] Testing strategy complete — see §9.
- [x] Naming conventions followed — see §8.
- [x] File structure matches standards — all edits are in-place additions to existing files; no new files except two new `.test.tsx` files for previously-untested KSeF components.
- [x] Plan is execution-ready.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Frontend Architecture](../frontend-architecture.md) — § Feature Public Surface (cross-feature `demo` barrel consumption precedent)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- Sibling plan: [`implementation-plan-ecommerce-reel-events.md`](./implementation-plan-ecommerce-reel-events.md) (#1788, batch 1 — the pattern this plan replicates)
- Sibling plan: [`implementation-plan-demo-events-framework.md`](./implementation-plan-demo-events-framework.md) (#1786, the `captureDemoEvent`/catalog framework this batch builds on)
