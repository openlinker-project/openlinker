# Implementation Plan: Structured ProductMaster catalog picker in Edit connection + smarter unlinked banner

**Date**: 2026-04-20
**Status**: Ready for Review
**Estimated Effort**: ~3 hours (frontend-only, no new primitives, no backend changes)

**Issue**: [#276](https://github.com/openlinker-project/openlinker/issues/276)

---

## 1. Task Summary

**Objective**: Expose `config.masterCatalogConnectionId` as a first-class structured field in the Edit Connection form for marketplace connections (Allegro today), and replace the boolean "catalog not linked" banner on the connection detail page with a three-state indicator that accounts for backend auto-resolution.

**Context**: The create wizard (`AllegroSetupForm`) already does this correctly. The edit form does not — marketplace connections fall straight through to the raw Config JSON textarea, so operators must hand-edit JSON. Separately, the banner fires as a warning whenever the field is absent, even when the backend's `autoResolveMasterConnectionId` would successfully pick the only ProductMaster connection, producing false-positive warnings on the happiest path.

**Classification**: Interface (frontend only). No CORE, integration, or infrastructure changes.

---

## 2. Scope & Non-Goals

### In Scope
- Edit form: structured **Product catalog connection** dropdown for marketplace connections, two-way bound with the raw Config JSON textarea.
- Schema: add `masterCatalogConnectionId` to `editConnectionSchema`, extend `mergeStructuredIntoConfig`.
- Auto-select on mount only, guarded so it never overwrites an explicit operator choice (including the explicit `""` opt-out).
- Banner: three states (explicitly linked / auto-resolvable / ambiguous or no candidates) with copy and tone per issue.
- Stale-pointer handling: render the dangling ID in the select + surface an error Alert.
- Tests for all new branches (form + banner).

### Out of Scope
- Backend change to expose a `resolvedMasterCatalogConnectionId` field. Client-side derivation is sufficient and matches `autoResolveMasterConnectionId` policy.
- Extracting the banner into its own component — it stays inline in `connection-detail-page.tsx` unless it grows beyond ~40 lines.
- Any visual refresh of the Alert primitive or new CSS.
- Changes to `AllegroSetupForm` (already correct).
- Changes to PrestaShop structured inputs.

### Constraints
- Pure vanilla CSS + design tokens; no Tailwind, no CSS-in-JS, no styled UI libs (per `.claude/rules/frontend.md`).
- Reuse existing `shared/ui/` primitives — `Select` already exists, no new primitives.
- Must preserve unknown config keys on submit (existing contract, already tested).
- Must maintain the "raw JSON is unparseable ⇒ lock structured inputs" guard for the new field too.

---

## 3. Architecture Mapping

**Target Layer**: Frontend (`apps/web`), specifically the `features/connections` slice and `pages/connections`.

**Dependency direction** (per `.claude/rules/frontend.md`): `pages → features → shared`. The banner logic on the page will consume a `features/connections` hook (`useProductMasterConnections`) — that's the same layering the PrestaShop category-mappings link and existing form already use.

**Capabilities Involved**: None on the backend. The frontend derives banner state from two existing inputs:
- `connection.config.masterCatalogConnectionId`
- The list of active `ProductMaster` connections (already available via `useProductMasterConnections()`).

**Existing Services Reused**:
- `useProductMasterConnections()` — already used by `AllegroSetupForm`; provides `productMasterConnections` and the underlying `connectionsQuery`. **Note**: we do NOT reuse its `autoSelectedConnectionId` field — the hook does not exclude the caller connection, which would diverge from the backend's `autoResolveMasterConnectionId(excludeConnectionId)` policy. We compute auto-select locally from a self-filtered `candidates` list instead.
- `Select`, `FormField`, `Alert`, `Button` from `shared/ui/`.
- `mergeStructuredIntoConfig` — extend, not rewrite.
- `editConnectionSchema` — extend.

**New Components Required**: None. All work is additions inside existing files.

**Core vs Integration Justification**: N/A — pure frontend.

**Reference**: [frontend-architecture.md](../frontend-architecture.md), `.claude/rules/frontend.md`, `.claude/rules/fe-pages.md`.

---

## 4. External / Domain Research

### Internal Patterns

- **`AllegroSetupForm.tsx:61-65, 197-232`** — reference UX for the Select: loading/error wrappers, empty-option `""`, name as label / id as value, auto-select via `useEffect` keyed on `autoSelectedConnectionId`.
- **`EditConnectionForm.tsx:62-80, 145-183`** — existing structured-vs-raw pattern. Two-way JSON sync via `mergeStructuredIntoConfig`, `configIsParseable` guard, textarea toggled behind a button.
- **`offer-mapping-sync.service.ts:282-301`** — backend auto-resolution policy the banner must mirror: count of active ProductMaster candidates excluding the caller. Policy — 1 candidate ⇒ auto, 0 or 2+ ⇒ disabled.
- **`useProductMasterConnections.ts`** — returns `{ connectionsQuery, productMasterConnections, autoSelectedConnectionId }`. Filters to `status === 'active' && enabledCapabilities.includes('ProductMaster')`. **Does NOT exclude the current connection**, so its `autoSelectedConnectionId` could return the caller's own ID in a future "dual-cap" platform. Both surfaces in this plan (edit form + banner) must filter self out locally and compute their own "is there exactly one candidate?" derivation — they MUST NOT consume the hook's `autoSelectedConnectionId`.
- **Test patterns** — `renderWithProviders` + `createMockApiClient` + override `connections.list`. `EditConnectionForm.test.tsx` already exercises the raw-JSON guard, good template for the new cases.

---

## 5. Questions & Assumptions

### Open Questions
None — the issue itself resolved the three-state design and the client-side-derivation decision.

### Assumptions

1. **Marketplace branch detection** — key off `connection.enabledCapabilities.includes('Marketplace')`, not `platformType === 'allegro'`. Future marketplaces inherit automatically. Safe: matches issue wording and the existing `connection-detail-page.tsx:132` branch condition.
2. **Auto-select guarding** — only set the value on mount when:
   - `connectionsQuery` is settled (not loading, no error), AND
   - `autoSelectedConnectionId` is defined, AND
   - the field is currently empty (`""`), AND
   - the field is not dirty.
   This preserves an explicit `""` opt-out that the operator set previously (persisted in config) and never clobbers their in-progress edit. An explicit `""` in config will appear as `""` in `defaultValues`, so "currently empty" alone isn't enough to distinguish "new, unset" from "explicit opt-out" — we disambiguate by also checking `typeof connection.config.masterCatalogConnectionId !== 'string'` (i.e. the server never stored the key). If the server stored `""`, we do not auto-select.
3. **Stale pointer handling** — if `config.masterCatalogConnectionId` is a UUID not in the active `ProductMaster` list, render a disabled option with the raw ID as label (`Missing: {id}`) so the select still reflects the stored value, and show an error `Alert` above the Select. The operator then picks a new value and submit replaces it. Safe default — no automatic cleanup.
   - **Implementation note**: the "Missing" option is derived live from `explicitValue && !candidates.find(c => c.id === explicitValue)`, not from a one-time flag. Once the operator picks a valid value and submits, the next render sees `explicitValue` now in `candidates`, the condition flips false, and the Missing option + error Alert disappear automatically. No stale-flag bookkeeping.
4. **Self-reference filter** — both surfaces filter candidates with `productMasterConnections.filter(c => c.id !== connection.id)`. Policy: candidates always exclude self. One line, future-proofs against dual-cap platforms, matches backend `excludeConnectionId` semantics.
5. **Banner fourth state (no candidates)** — the issue lists this as a separate warning with a "create PrestaShop" CTA. We implement it as such; the CTA is a `Link` to `/connections/new?platform=prestashop`. The `/connections/new` route already exists — no new route.
6. **Toast on save** — keep existing toast text (`"Connection updated — Connection settings have been saved."`). The issue suggested including catalog-link status in the toast, but the existing toast is generic and matches other Edit flows. Not worth the asymmetry. Non-goal for this PR.

### Documentation Gaps
None.

---

## 6. Proposed Implementation Plan

### Phase 1 — Schema & merge helper

**Goal**: Give the form a typed path to `masterCatalogConnectionId`, preserving unknown keys.

**Steps**:

1. **Extend `editConnectionSchema`**
   - **File**: `apps/web/src/features/connections/components/edit-connection.schema.ts`
   - **Action**: Add `masterCatalogConnectionId: z.union([z.string().uuid(), z.literal('')]).optional()`. Extend `mergeStructuredIntoConfig` signature to accept `masterCatalogConnectionId?: string`. If provided and empty, delete the key (opt-out semantics, matching existing `baseUrl`/`shopId` behavior). If provided and non-empty, set the key.
   - **Expected validation behavior**: a pre-existing non-UUID non-empty string (e.g. from manual raw JSON edits persisted before this PR) will fail schema validation on next save. That's **desired** — it prevents garbage from round-tripping. The form's error summary will surface the Zod message; the operator fixes it by picking a real value or clearing to `""`. Do not special-case this; just document in the PR body that pre-existing bad values require operator action.
   - **Acceptance**: `toUpdateConnectionInput` still passes unknown keys through; new field appears in `EditConnectionFormValues`/`EditConnectionFormSubmission`.
   - **Dependencies**: None.

### Phase 2 — Edit form marketplace branch

**Goal**: Render a structured catalog picker when the connection supports `Marketplace`, with loading / error / empty / stale states, and wire it into the JSON two-way sync.

**Steps**:

2. **Introduce `platformBranch` categorization**
   - **File**: `apps/web/src/features/connections/components/EditConnectionForm.tsx`
   - **Action**: Replace the single `hasStructuredInputs` boolean with a typed discriminant:
     ```ts
     type PlatformBranch = 'prestashop' | 'marketplace' | 'raw';
     const platformBranch: PlatformBranch =
       connection.platformType === 'prestashop'
         ? 'prestashop'
         : connection.enabledCapabilities.includes('Marketplace')
           ? 'marketplace'
           : 'raw';
     const hasStructuredInputs = platformBranch !== 'raw';
     ```
     Keep the existing `hasStructuredInputs` derivation semantics for the toggle (show/hide raw JSON by default) — raw JSON still appears inline when there are no structured inputs.
   - **Acceptance**: PrestaShop connections behave exactly as before (same fields, same defaults).
   - **Dependencies**: Step 1.

3. **Hook in `useProductMasterConnections`**
   - **File**: `apps/web/src/features/connections/components/EditConnectionForm.tsx`
   - **Action**: Call the hook unconditionally (React Hook rules). Destructure `{ connectionsQuery, productMasterConnections }` — **deliberately NOT** `autoSelectedConnectionId` (the hook's version doesn't exclude self; see §4 note). Compute locally:
     ```ts
     const candidates = productMasterConnections.filter((c) => c.id !== connection.id);
     const localAutoSelectId = candidates.length === 1 ? candidates[0].id : undefined;
     ```
     Use `localAutoSelectId` in the auto-select effect (Step 5). This mirrors the backend's `autoResolveMasterConnectionId(excludeConnectionId)` policy exactly.
   - **Acceptance**: Hook only fires its fetch when this component mounts; no extra calls. Handled by TanStack's dedupe + our `connectionsQueryKeys.list()`.
   - **Dependencies**: Step 2.

4. **Render marketplace branch**
   - **File**: `apps/web/src/features/connections/components/EditConnectionForm.tsx`
   - **Action**: Below `Credentials` and above `Adapter key` (mirrors create wizard ordering):
     - `Alert tone="warning"` (reuses existing raw-JSON guard text) when `!configIsParseable`. No new alert — use the same pattern as the PrestaShop branch.
     - Empty state (no candidates, not loading, not errored): `Alert tone="info"` — *"No ProductMaster connections yet. Add a PrestaShop connection to enable barcode-based offer linking."* — with a `Link` to `/connections/new?platform=prestashop` in the Alert body.
     - Stale-pointer state (config UUID is not in candidates): `Alert tone="error"` — *"This connection points to a deleted or disabled ProductMaster. Pick a new one."*
     - `FormField` wrapping a `Select` with:
       - `<option value="">None (barcode linking disabled)</option>`
       - one `<option>` per candidate
       - disabled placeholder option `Missing: {id}` if the stored value is a stale UUID (kept to reflect config state in the select)
     - Description copy per issue.
     - Disabled when `connectionsQuery.isLoading` or `!configIsParseable`.
     - Two-way JSON sync via `syncStructuredToJson` extended to accept `'masterCatalogConnectionId'`.
   - **Acceptance**: Picker appears for Allegro connection, absent for PrestaShop and for platforms without `Marketplace` capability.
   - **Dependencies**: Steps 1-3.

5. **Auto-select effect**
   - **File**: `apps/web/src/features/connections/components/EditConnectionForm.tsx`
   - **Action**: Add a `useEffect` that depends on `localAutoSelectId` (from Step 3). Guarded:
     - only run once per mount (via a `useRef` flag),
     - only when `localAutoSelectId` is defined,
     - only when the stored server value is `undefined` (i.e. `typeof connection.config.masterCatalogConnectionId !== 'string'`),
     - only when the current form field is empty,
     - only when the `masterCatalogConnectionId` field is **not** `dirty` (check `form.formState.dirtyFields.masterCatalogConnectionId`),
     - only when `!connectionsQuery.isLoading && !connectionsQuery.error`.
     On fire: set the form value AND propagate via `syncStructuredToJson` so raw JSON stays in sync. Pass `{ shouldDirty: false }` explicitly so auto-select does NOT flip `formState.isDirty` — the operator can save-and-exit without a confirm-leave prompt on an untouched page.
   - **Acceptance**: A fresh Allegro connection in an org with 1 PrestaShop sees the PrestaShop pre-filled in the picker; `form.formState.isDirty` remains `false` after the auto-select fires.
   - **Dependencies**: Step 4.

### Phase 3 — Banner logic

**Goal**: Replace the boolean check with a three-state (plus empty-candidates) renderer that mirrors backend auto-resolution policy.

**Steps**:

6. **Banner computation in `connection-detail-page.tsx`**
   - **File**: `apps/web/src/pages/connections/connection-detail-page.tsx`
   - **Action**: Import `useProductMasterConnections` and compute:
     ```ts
     const { productMasterConnections, connectionsQuery } = useProductMasterConnections();
     const explicitMaster = typeof connection?.config.masterCatalogConnectionId === 'string'
       ? connection.config.masterCatalogConnectionId
       : null;
     const candidates = productMasterConnections.filter((c) => c.id !== connection?.id);
     ```
     Render the banner only when `connection` is loaded AND `connection.enabledCapabilities.includes('Marketplace')`.

     **CTA rendering contract**: text in square brackets below (`[Edit connection]`, `[Add a PrestaShop connection]`) denotes a React Router `<Link>` rendered inline inside the Alert body, NOT literal bracket characters. Style the link with the existing inline-link CSS used elsewhere in the app (anchor-colored, underlined on hover). Keep it a real `<a>` via `<Link>` so keyboard users can Tab into it.

     **Five-way render** (pseudo):
     - `explicitMaster === ''` ⇒ *Explicitly disabled* — `Alert tone="warning"` — *"Barcode linking is disabled for this connection. [Edit connection] to select a catalog."* (explicit opt-out preserved)
     - `typeof explicitMaster === 'string' && explicitMaster.length > 0` ⇒ *Linked* — no banner.
     - `explicitMaster === null && candidates.length === 1` ⇒ *Auto-resolved* — `Alert tone="info"` — *"Barcode linking will use **{name}** (the only ProductMaster connection). [Edit connection] to pin this explicitly."*
     - `explicitMaster === null && candidates.length > 1` ⇒ *Ambiguous* — `Alert tone="warning"` — *"Multiple ProductMaster connections exist — pick one explicitly or barcode sync will be skipped. [Edit connection]."*
     - `explicitMaster === null && candidates.length === 0` ⇒ *No candidates* — `Alert tone="warning"` — *"No active ProductMaster connections to link to. [Add a PrestaShop connection] first."*
     - While `connectionsQuery.isLoading` and `explicitMaster === null`: render nothing (avoid flashing a misleading warning).
     - On `connectionsQuery.error` with `explicitMaster === null`: render nothing (silent). Rationale: the banner is advisory, not blocking; operators already see the global error surface from their other queries, and a second "couldn't determine catalog state" Alert would be noise. If `explicitMaster` has a value we still render the Linked / Explicitly-disabled banner since those states don't depend on the candidates query.
   - **Acceptance**: Matches the five states above. Operator with exactly one PrestaShop sees an info banner, not a warning. On candidates-query failure, no banner flashes.
   - **Dependencies**: None.

### Phase 4 — Tests

**Goal**: Lock the behavior with colocated vitest cases.

**Steps**:

7. **`EditConnectionForm.test.tsx` additions**
   - **File**: `apps/web/src/features/connections/components/EditConnectionForm.test.tsx`
   - **Action**: Build an `allegroConnection` fixture:
     ```ts
     const allegroConnection: Connection = {
       ...sampleConnection,
       id: 'conn_allegro',
       name: 'Allegro sandbox',
       platformType: 'allegro',
       config: { environment: 'sandbox' },
       enabledCapabilities: ['Marketplace', 'OrderProcessorManager'],
       supportedCapabilities: ['Marketplace', 'OrderProcessorManager'],
       adapterKey: 'allegro.publicapi.v1',
     };
     ```
     Cases:
     - Renders the **Product catalog connection** select for an Allegro connection, not for a PrestaShop connection.
     - Auto-fills the picker when exactly one ProductMaster candidate is returned (uses `connections.list` mock returning `[sampleConnection]`).
     - Does NOT auto-fill when `config.masterCatalogConnectionId === ''` (explicit opt-out preserved).
     - Does NOT auto-fill when 2+ candidates are returned.
     - Does NOT auto-fill when the `masterCatalogConnectionId` field is already `dirty` (operator typed/selected before the candidates query resolved) — assert the user's in-progress value is preserved even though the candidates query eventually returns one candidate.
     - Auto-fill does NOT flip `form.formState.isDirty` — after mount + auto-select, clicking **Cancel** does not trigger a confirm-leave prompt, and submitting unchanged values still works.
     - Stale UUID (config points to a deleted PrestaShop): renders error Alert + disabled `Missing: {id}` option in the Select.
     - Locks the Select when raw JSON is unparseable (mirrors existing PrestaShop guard test).
     - Submit payload for a picked value includes `masterCatalogConnectionId` in `config` and preserves other keys (`environment`).
     - Submit payload when picker is set to "" deletes the key from config on merge.

8. **No separate page-level test needed**
   - **Rationale**: The connection-detail page has no dedicated test file today. Banner logic is small enough that a future page-level test is fine, but the existing FE test coverage bar does not require a new file. I'll add a targeted banner test only if the review finds a gap.
   - **Deferred**: Create `connection-detail-page.test.tsx` only if review requests.

### Implementation Details

**New Components**: None.

**Configuration Changes**: None.

**Database Migrations**: None.

**Events**: None.

**Error Handling**: Stale UUID + connections-query error are the only surfaces. Both render inline `Alert` primitives; no network-level error handling beyond what TanStack Query + our existing pattern already provide.

---

## 7. Alternatives Considered

### Alternative 1: Add a backend `resolvedMasterCatalogConnectionId` field

- **Description**: Have the connection GET endpoint compute and return the effective master connection ID (same algorithm as `autoResolveMasterConnectionId`), letting the frontend just check presence.
- **Why Rejected**: Introduces a new backend field purely for a banner, duplicates logic that the frontend can compute from data it already has, and creates a race where the backend-resolved ID could differ from what the picker shows the user. Do it later if more UI surfaces need it.
- **Trade-offs**: Would save ~10 lines of client-side logic, would cost a schema change, DTO update, controller change, and cross-layer testing.

### Alternative 2: Extract a `ProductCatalogLinkPicker` component

- **Description**: Pull the Select + alerts into `features/connections/components/ProductCatalogLinkPicker.tsx`, consumed by both `AllegroSetupForm` and `EditConnectionForm`.
- **Why Rejected**: The current create-form version is embedded in a wizard step with its own Alert copy. The edit-form version needs the stale-pointer state, which the create form doesn't. Extracting would require either two flag-driven paths or a shared component that is more configuration than code. Premature abstraction — revisit when we add a third marketplace platform.
- **Trade-offs**: Some duplication of the loading/error/empty wrappers remains.

### Alternative 3: Leave the banner boolean, only fix the edit form

- **Description**: Minimal fix — just expose the Select, keep the banner as-is.
- **Why Rejected**: Operators continue to see a warning on the happiest path (exactly one PrestaShop). The issue explicitly scopes both fixes together.
- **Trade-offs**: Less code, but UX regression persists.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Frontend-only change. Respects `app → pages → features → shared` direction.
- ✅ No new shared UI primitives (`Select`, `FormField`, `Alert` reused).
- ✅ Server state via TanStack Query (`useProductMasterConnections`), form state via React Hook Form, URL state via search params — all matches FE-001 state ownership rules.
- **Reference**: [frontend-architecture.md](../frontend-architecture.md), `.claude/rules/frontend.md`.

### Naming Conventions
- ✅ Existing files, existing test filenames. Schema stays in `edit-connection.schema.ts`.

### Existing Patterns
- ✅ Two-way JSON sync mirrors PrestaShop structured inputs.
- ✅ Loading/error/empty Select wrappers mirror `AllegroSetupForm.tsx:209-229`.
- ✅ Auto-select effect mirrors `AllegroSetupForm.tsx:61-65` with stricter guards appropriate for edit (vs fresh-mount wizard) context.

### Risks
- **`useEffect` dependency loop** — auto-select effect writes to form state, which could re-trigger the effect. Mitigated by the `useRef`-guarded run-once flag.
- **Explicit `""` opt-out regression** — forgetting to distinguish "server never stored the key" from "server stored empty string" would silently override an operator's opt-out. Mitigated by gating on `typeof connection.config.masterCatalogConnectionId !== 'string'`.
- **Banner flicker during initial load** — `connectionsQuery.isLoading` is true while candidates are being fetched; rendering any banner state during that window is misleading. Mitigated by rendering nothing until the query settles.

### Edge Cases
- Stale UUID (deleted/disabled PrestaShop) — rendered with a disabled `Missing: {id}` option + error Alert.
- Explicit `""` in config — banner shows a distinct "explicitly disabled" warning; edit-form picker shows `""` selected and no auto-select.
- Two+ PrestaShop connections — ambiguous warning banner + no auto-select; operator must pick.
- Zero PrestaShop connections — no-candidates warning banner + disabled Select + info Alert with "add PrestaShop" CTA.

### Backward Compatibility
- ✅ Existing PrestaShop edit flow unchanged.
- ✅ Raw JSON path still available via toggle.
- ✅ Unknown config keys preserved (existing test covers it; `mergeStructuredIntoConfig` extended, not replaced).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
Co-located with `EditConnectionForm.tsx`:

- Renders Product catalog connection select for Allegro, not PrestaShop.
- Auto-selects the only candidate.
- Does not auto-select when config has `""` (opt-out).
- Does not auto-select when 2+ candidates.
- Does not auto-select when the field is already `dirty` (in-progress operator edit preserved).
- Auto-select does not flip `form.formState.isDirty`.
- Stale UUID surfaces error Alert + disabled `Missing:` option.
- Raw JSON unparseable locks the Select.
- Submit payload sets `masterCatalogConnectionId` correctly.
- Submit payload deletes the key when picker set to "".

**Location**: `apps/web/src/features/connections/components/EditConnectionForm.test.tsx`.

### Integration Tests
None — no backend changes; `pnpm test:integration` unaffected.

### Mocking Strategy
Reuse `createMockApiClient()` + override `connections.list` to shape candidate sets. No new fixtures beyond an inline `allegroConnection`.

### Acceptance Criteria
- [ ] Edit form for an Allegro connection shows **Product catalog connection** dropdown.
- [ ] Auto-select fills the picker when exactly one PrestaShop exists and config has no explicit value.
- [ ] Banner on the detail page distinguishes auto-resolved (info) from ambiguous/unlinked (warning) from no-candidates (warning) from explicitly disabled (warning).
- [ ] Operator with exactly one PrestaShop sees info banner (not warning) on a fresh Allegro connection.
- [ ] All existing PrestaShop and raw-JSON tests still pass.
- [ ] `pnpm lint && pnpm type-check && pnpm test` green.

**Reference**: [testing-guide.md](../testing-guide.md).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (frontend-only; no backend boundary crossings)
- [x] Respects CORE vs Integration boundaries (untouched)
- [x] Uses existing patterns (Select, FormField, Alert, useProductMasterConnections)
- [x] Idempotency considered (auto-select run-once guard)
- [x] Event-driven patterns used where applicable (N/A — frontend)
- [x] Rate limits & retries addressed (N/A — frontend; TanStack Query already handles)
- [x] Error handling comprehensive (stale UUID, connections-query error, raw JSON invalid)
- [x] Testing strategy complete (10 new cases in existing test file)
- [x] Naming conventions followed (no new files, no new types exported beyond what lives in schema)
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Issue #276](https://github.com/openlinker-project/openlinker/issues/276)
- [frontend-architecture.md](../frontend-architecture.md)
- [frontend-ui-style-guide.md](../frontend-ui-style-guide.md)
- `.claude/rules/frontend.md`
- `.claude/rules/fe-pages.md`
- `.claude/rules/ui-components.md`
