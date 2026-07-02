# Implementation Plan: Fix Misleading "Adapter Not Recognized" Copy in ConnectionCapabilitiesPanel

**Date**: 2026-07-02
**Status**: Draft
**Estimated Effort**: 1–2 hours
**Issue**: [#1287](https://github.com/openlinker-project/openlinker/issues/1287)

---

## 1. Task Summary

**Objective**: Stop `ConnectionCapabilitiesPanel` from showing a factually wrong, alarming "adapter is not recognized" message (with a broken escape-sequence typo) for `Invoicing`-only connections (KSeF, Subiekt, Infakt), and make the fallback copy accurate for the cases that genuinely remain.

**Context**: The panel's `supported` list is computed by filtering `connection.supportedCapabilities` through a closed FE-only `CORE_CAPABILITY_VALUES` array (`apps/web/src/features/connections/api/connections.types.ts`). That array was never updated when `'Invoicing'` was added as a first-class capability on the backend (ADR-026). For any connection whose adapter's *only* capability is `Invoicing`, `supported` filters down to `[]`, and the panel renders a fallback that (a) is textually broken — `’` is written as a literal escape sequence inside a JSX text node, so it renders as six literal characters instead of an apostrophe — and (b) is substantively wrong: it claims "the adapter is not recognized," when the adapter is active and its `Invoicing` capability works correctly everywhere else in the app.

**Classification**: Frontend (Interface / feature component). No backend changes.

---

## 2. Scope & Non-Goals

### In Scope

- Add `'Invoicing'` to the FE's `CORE_CAPABILITY_VALUES` closed list so `Invoicing`-only connections (KSeF, Subiekt, Infakt) render the normal toggle-list UI instead of the fallback.
- Add a `CAPABILITY_HELP['Invoicing']` entry (required for `Record<CoreCapability, string>` exhaustiveness once `Invoicing` joins the union — TypeScript will refuse to compile without it).
- Fix the escape-sequence typo (`’` as a literal JSX text-node string) at the true fallback line.
- Rewrite the fallback copy so it accurately describes the *remaining* `supported.length === 0` case (a connection whose adapter has genuinely no recognized capabilities — e.g. a registration-only skeleton plugin, or a resolution failure) instead of implying the adapter itself is broken.
- Update/add unit tests in `ConnectionCapabilitiesPanel.test.tsx` covering both the Invoicing-toggle path and the corrected fallback copy.

### Out of Scope

- Widening `CORE_CAPABILITY_VALUES` to include `'ProductPublisher'` / `'CategoryProvisioner'` (also present in the backend's `CoreCapabilityValues` per ADR-024, also absent from the FE list). No in-tree adapter currently declares either capability, so this isn't manifesting as a user-visible bug today — see [Questions & Assumptions](#5-questions--assumptions).
- The full #576 runtime-aware-DTO-validator follow-up (making the create/update DTO accept arbitrary plugin-registered capability names). `Invoicing` doesn't need that follow-up — it's already a well-known, closed-list capability on the backend (see research below), not a plugin-extension capability.
- Any change to `apps/api` — the backend already accepts `'Invoicing'` in `enabledCapabilities` end-to-end (see §4).
- Redesigning the capabilities panel UI/UX beyond the copy fix.

### Constraints

- Must not touch backend DTOs, entities, or migrations — this is confirmed to be a pure FE staleness bug (§4).
- Must preserve the existing `isCoreCapability` narrowing pattern and the documented rationale for why plugin-registered (non-core) capabilities stay excluded from this panel — that comment (lines 43–47) remains valid and should stay, since it addresses a different, still-open gap (#576).

---

## 3. Architecture Mapping

**Target Layer**: Frontend — `features/connections` (Interface layer per `docs/frontend-architecture.md`; no `app`/`pages`/`shared` boundary crossings needed).

**Capabilities Involved**: `CoreCapability` union (FE-local type mirroring the backend's `CoreCapabilityValues`, per `docs/engineering-standards.md` — there is no shared package between `apps/web` and `libs/core`, so this mirror is maintained by hand and is the root cause of the drift being fixed here).

**Existing Services Reused**:
- `useUpdateConnectionMutation` (`apps/web/src/features/connections/hooks/use-update-connection-mutation.ts`) — unchanged, already accepts `enabledCapabilities: string[]` end-to-end via the API client.
- `StatusBadge`, `Alert` from `shared/ui` — unchanged.

**New Components Required**: None. This is a data + copy fix inside two existing files:
- `apps/web/src/features/connections/api/connections.types.ts`
- `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.tsx`

**Core vs Integration Justification**: N/A — no backend/CORE involvement. This is entirely inside the FE `features/connections` module; no dependency-direction or hexagonal-layer concerns apply.

---

## 4. External / Domain Research

### Backend capability contract (confirmed via codebase research)

The backend's `CoreCapabilityValues` (`libs/core/src/integrations/domain/types/adapter.types.ts:22-36`) **already includes `'Invoicing'`**:

```ts
export const CoreCapabilityValues = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'OfferManager',
  'ProductPublisher',
  'CategoryProvisioner',
  'Invoicing', // added under ADR-026
] as const;
```

Both `CreateConnectionDto` (`apps/api/src/integrations/http/dto/create-connection.dto.ts:107-116`) and `UpdateConnectionDto` (`apps/api/src/integrations/http/dto/update-connection.dto.ts:49-58`) validate `enabledCapabilities` with `@IsIn(CoreCapabilityValues, { each: true })` — i.e. `'Invoicing'` is **already a legal value** the API accepts today. `ConnectionService.create` also already defaults `enabledCapabilities` to the adapter's full `supportedCapabilities` when omitted, so `Invoicing`-only connections already persist `enabledCapabilities: ['Invoicing']` on creation — this is exercised in `apps/api/test/integration/invoicing/invoicing-upo-download.int-spec.ts` and `libs/core/src/invoicing/application/services/auto-issue-trigger.service.spec.ts`.

**Conclusion**: adding `'Invoicing'` to the FE's closed list is safe and sufficient — toggling it in the panel will round-trip through the existing update mutation with no backend changes. This resolves the "decide during implementation" fork the issue calls out in favor of **Option A** (widen the FE list), not Option B (copy-only fix).

### Adapters affected

Three in-tree adapters declare `supportedCapabilities: ['Invoicing']` (Invoicing-only, so they hit this bug today):

| Adapter | `adapterKey` | File |
|---|---|---|
| KSeF | `ksef.publicapi.v2` | `libs/integrations/ksef/src/ksef-plugin.ts:43-45` |
| Subiekt | `subiekt.invoicing.v1` | `libs/integrations/subiekt/src/subiekt-plugin.ts:36-38` |
| Infakt | `infakt.accounting.v1` | `libs/integrations/infakt/src/infakt-plugin.ts:36-38` |

The issue only mentions KSeF and Subiekt; Infakt is a third affected adapter surfaced during research and is covered by the same fix without extra work.

### Internal patterns

- `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.test.tsx` already has a test asserting the (currently broken) fallback text (`renders a notice when adapter is unknown (no supported capabilities)`, line 96-105) — this test's assertion string must be updated to match the corrected copy, and it remains a valid test for the *genuine* empty-`supportedCapabilities` case (e.g. a registration-only skeleton plugin, per `AdapterMetadata.supportedCapabilities` docs: "An empty array is valid for a registration-only plugin skeleton").
- `CAPABILITY_HELP: Record<CoreCapability, string>` (line 22-28) is a TS-enforced exhaustive map — adding `'Invoicing'` to `CoreCapability` without adding a `CAPABILITY_HELP.Invoicing` entry will fail `pnpm type-check`, which is a useful compile-time guardrail confirming the fix is complete.

---

## 5. Questions & Assumptions

### Open Questions

- Should `'ProductPublisher'` / `'CategoryProvisioner'` also be added to the FE's `CORE_CAPABILITY_VALUES` in the same PR, since they have the identical latent-drift shape as `Invoicing` did? **Recommendation**: no — defer to a separate follow-up issue. No in-tree adapter currently declares either capability (`ADR-024` shop-listing work), so there's no reproducible user-facing bug for them yet, and bundling an untested, unobserved case into this fix risks scope creep on what should be a small, verifiable PR. Flagging this as a suggested fast-follow issue is in scope for this plan; implementing it is not.

### Assumptions

- The three-second delta between the issue's description (KSeF, Subiekt) and the research finding (KSeF, Subiekt, **and Infakt**) is accepted as an improvement, not a scope change — same root cause, same fix, zero extra files touched.
- "This connection has no capabilities available to toggle here." (exact wording finalized in Phase 1, step 2 below) is judged sufficiently accurate for the remaining fallback case. This is a UI-copy judgment call, not an architectural one — any reasonable rephrase away from "adapter is not recognized" satisfies the issue's acceptance criteria.
- No i18n migration is needed for this string per `docs/frontend-architecture.md` § Internationalization — v1 scope explicitly excludes migrating existing inline strings to `t()`; this string stays an inline literal like every other string in the file.

### Documentation Gaps

None. The backend contract, adapter manifests, and existing test file were all directly inspectable; no ambiguity remains about whether the fix is FE-only.

---

## 6. Proposed Implementation Plan

### Phase 1: Fix the code

**Goal**: Close the gap between the FE's closed capability list and the backend's, and correct the fallback copy.

**Steps**:

1. **Add `'Invoicing'` to `CORE_CAPABILITY_VALUES`**
   - **File**: `apps/web/src/features/connections/api/connections.types.ts`
   - **Action**: Append `'Invoicing'` to the `CORE_CAPABILITY_VALUES` array (lines 25-31), with a one-line comment noting it mirrors the backend's `CoreCapabilityValues` (ADR-026) — matching the existing header comment style in this file.
   - **Acceptance**: `CoreCapability` type now includes `'Invoicing'`; `pnpm type-check` immediately fails in `ConnectionCapabilitiesPanel.tsx` (`CAPABILITY_HELP` no longer exhaustive) until step 2 lands — this is the expected, useful compile-time signal.
   - **Dependencies**: None.

2. **Add the `Invoicing` help copy and fix the fallback text**
   - **File**: `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.tsx`
   - **Action**:
     - Add `Invoicing: 'Issue and manage fiscal documents (invoices) through this connection.'` to `CAPABILITY_HELP` (lines 22-28).
     - Replace line 116's fallback paragraph. Remove the literal `’` escape-sequence text entirely (don't just fix the character — rephrase to avoid the possessive construction per the issue's own suggestion) and remove the false "adapter is not recognized" claim. New copy: `This connection has no capabilities available to toggle here.`
   - **Acceptance**: `pnpm type-check` passes; visually inspecting a KSeF/Subiekt/Infakt connection's detail page shows the normal checkbox toggle-list (with the `Invoicing` row) instead of the fallback paragraph.
   - **Dependencies**: Step 1.

3. **(No change, verify only) Confirm the pre-existing `isCoreCapability` scoping comment (lines 43-47) still reads correctly**
   - **File**: `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.tsx`
   - **Action**: Re-read the comment after the edit; it already correctly scopes itself to "plugin-registered capabilities (#576)" which remains true post-fix (`Invoicing` was never a plugin-registered capability — it's a well-known backend constant). No edit needed, but explicitly confirm during review that the comment doesn't now read as contradictory.
   - **Acceptance**: Comment reviewed, no edit required (or a one-line clarification added if review finds it ambiguous).
   - **Dependencies**: Step 2.

### Phase 2: Tests

**Goal**: Lock in both the fixed toggle behavior and the corrected fallback copy so this doesn't regress.

**Steps**:

1. **Update the existing fallback-text test**
   - **File**: `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.test.tsx`
   - **Action**: Update the `'shows a notice when adapter is unknown (no supported capabilities)'` test (lines 96-105) — change the assertion from `/adapter is not recognized/` to match the new copy (e.g. `/no capabilities available to toggle/`). Keep `supportedCapabilities: []` as the fixture — this test still validates the genuine "no known capabilities" fallback path.
   - **Acceptance**: Test passes against the new copy; test still fails if the fallback copy is reverted to the old text (i.e. the assertion is specific enough to catch a regression).
   - **Dependencies**: Phase 1 complete.

2. **Add a new test for the `Invoicing`-only connection case**
   - **File**: `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.test.tsx`
   - **Action**: Add a test asserting that a connection with `supportedCapabilities: ['Invoicing']`, `enabledCapabilities: ['Invoicing']` renders the normal checkbox toggle-list (not the fallback), shows `1 of 1 enabled`, and that the checkbox is labeled/checked correctly — mirroring the existing `'renders one checkbox per supported capability...'` test's structure (lines 14-25).
   - **Acceptance**: New test fails on the pre-fix code (`supported.length === 0` for an `Invoicing`-only connection) and passes after the Phase 1 fix — confirms the test actually exercises the regression.
   - **Dependencies**: Phase 1 complete.

3. **Run the full FE quality gate**
   - **Action**: `pnpm --filter @openlinker/web lint && pnpm --filter @openlinker/web type-check && pnpm --filter @openlinker/web test` (or the repo-root equivalents `pnpm lint`, `pnpm type-check`, `pnpm test` if package-scoped scripts aren't set up that way — confirm against `package.json` at execution time).
   - **Acceptance**: All three pass with zero errors.
   - **Dependencies**: Steps 1-2 in this phase.

### Implementation Details

**New Components**: None.

**Modified Files**:
- `apps/web/src/features/connections/api/connections.types.ts` — widen `CORE_CAPABILITY_VALUES`.
- `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.tsx` — add `CAPABILITY_HELP.Invoicing`, fix fallback copy.
- `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.test.tsx` — update one assertion, add one new test.

**Configuration Changes**: None.

**Database Migrations**: None — no backend or schema changes.

**Events**: None emitted or consumed by this change.

**Error Handling**: No new error paths — the existing `updateMutation.error` → `Alert` path is unchanged and already covers a failed toggle of `Invoicing` the same way it covers any other capability.

---

## 7. Alternatives Considered

### Alternative 1: Copy-only fix (Option B from the issue) — leave `CORE_CAPABILITY_VALUES` closed, only fix the fallback text

- **Description**: Fix the escape-sequence typo and rephrase the fallback message to something accurate for "capabilities aren't editable from this panel yet," without adding `'Invoicing'` to the list. `Invoicing`-only connections would still show the fallback (just with honest copy) instead of a toggle UI.
- **Why Rejected**: Research confirms the backend already fully supports `'Invoicing'` in `enabledCapabilities` end-to-end (§4) — nothing blocks making it toggleable. Leaving it in the fallback state would ship a *correct but still degraded* experience when a strictly better one (the real toggle UI, matching every other capability) is available for the same effort. The issue's own acceptance criteria frame widening the list as the preferred outcome contingent on exactly the backend-support check this plan already did.
- **Trade-offs**: Alternative 1 is marginally smaller (no `CAPABILITY_HELP` entry, no new toggle test) but ships a permanently degraded UI for three real, working adapters (KSeF, Subiekt, Infakt) for no remaining technical reason.

### Alternative 2: Make `CORE_CAPABILITY_VALUES` derive dynamically from `connection.supportedCapabilities` instead of a hardcoded list

- **Description**: Drop the FE closed list entirely; render a toggle for every string in `connection.supportedCapabilities`, with a generic help fallback for capability names without a `CAPABILITY_HELP` entry.
- **Why Rejected**: This is architecturally a much larger change — it reopens the #576 runtime-aware-DTO-validator scope, since the update mutation would then need to send arbitrary plugin-registered capability names that the backend DTO's `@IsIn(CoreCapabilityValues)` validator would reject. The issue explicitly scopes this fix to *not* pull in that follow-up. It's the right eventual direction (referenced by the existing lines 43-47 comment) but out of scope for a copy/data-fix bug ticket.
- **Trade-offs**: Alternative 2 would prevent *this exact class* of bug from recurring for future well-known capabilities, at the cost of a cross-cutting FE+BE DTO-validation change that isn't what this issue asked for.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ No hexagonal-layer or CORE/Integration boundary touched — pure FE `features/connections` change.
- ✅ Respects `docs/frontend-architecture.md` dependency direction (`features` → `shared`, no new imports added).
- ✅ No global store, no new query/mutation hooks — reuses `useUpdateConnectionMutation` unchanged.

### Naming Conventions

- ✅ No new files; existing files keep their established naming (`*.types.ts`, `PascalCase.tsx` component, `*.test.tsx`).

### Existing Patterns

- ✅ Follows the existing `Record<CoreCapability, string>` exhaustive-map pattern for `CAPABILITY_HELP` — adding a union member and immediately being forced (by TS) to add its help text is the same pattern used for the four existing capabilities.
- ✅ Test additions mirror the existing test file's Arrange-Act-Assert structure and `sampleConnection` spread pattern (`test/test-utils.tsx`).

### Risks

- **Risk**: A reviewer or future contributor assumes `'ProductPublisher'` / `'CategoryProvisioner'` should have been added in the same pass, since they have the same latent-drift shape. **Mitigation**: this plan documents the decision explicitly in §5 and recommends a fast-follow issue rather than silently deferring it.
- **Risk**: The new fallback copy is itself later found inaccurate for some other adapter shape not seen during this research pass. **Mitigation**: low risk — the fallback path is only reachable when `connection.supportedCapabilities` genuinely contains no entries from the (now-8-entry) `CoreCapabilityValues` set, which today only happens for a registration-only skeleton plugin (explicitly documented as a valid, intentional adapter state) or a true resolution failure. Both are accurately described by "no capabilities available to toggle here."

### Edge Cases

- **A connection with a mix of core and non-core (plugin-registered) capabilities**: unaffected by this change — `isCoreCapability` still filters per-item, so `supported` shows only the recognized subset; behavior for this case is unchanged (still governed by the untouched #576-scoped comment).
- **A connection whose only capability is exactly `'Invoicing'` but `enabledCapabilities` is empty** (e.g. explicitly disabled by an operator): after the fix, this renders the normal toggle list with the checkbox unchecked and triggers the existing "No capabilities enabled" warning `Alert` (lines 144-148) — this is correct, expected behavior already implemented for every other capability and requires no special-casing.

### Backward Compatibility

- ✅ No breaking changes. Widening a FE union type and its backing array is additive; no consumer of `CoreCapability` narrows exhaustively in a way that would break (verified: `CAPABILITY_HELP` is the only exhaustive consumer, and it's fixed in the same step).
- ✅ No API contract change — the backend has accepted `'Invoicing'` in this field since it shipped (ADR-026); the FE is only now catching up to an already-existing contract.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

- `ConnectionCapabilitiesPanel.test.tsx`:
  - Updated: fallback-copy assertion for the genuine "no supported capabilities" case.
  - New: `Invoicing`-only connection renders the toggle list (not the fallback), with correct checked/enabled-count state.
- **Files**: `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.test.tsx`

### Integration Tests

- None required — this is a pure rendering/copy change with no new API surface; the existing `useUpdateConnectionMutation` → `apiClient.connections.update` path is already integration-tested elsewhere for capability toggling in general, and the backend's acceptance of `'Invoicing'` is already covered by `apps/api/test/integration/invoicing/invoicing-upo-download.int-spec.ts`.

### Mocking Strategy

- Follow the existing file's pattern: `createMockApiClient({ connections: { update: vi.fn()... } })` + `renderWithProviders`. No new mocking infrastructure needed.

### Acceptance Criteria

- [ ] The literal `’` escape-sequence typo no longer appears anywhere in `ConnectionCapabilitiesPanel.tsx`.
- [ ] Viewing the detail page for a KSeF, Subiekt, or Infakt connection shows the normal capability toggle list (including an `Invoicing` row with checkbox + help text), not the "not recognized" fallback.
- [ ] The remaining fallback path (genuinely empty `supportedCapabilities`) renders accurate, non-alarming copy.
- [ ] `ConnectionCapabilitiesPanel.test.tsx` covers both the `Invoicing`-toggle path and the corrected fallback copy.
- [ ] `pnpm lint`, `pnpm type-check`, and `pnpm test` all pass with zero errors.
- [ ] No backend files touched; no migration required.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — pure FE change, no layers crossed)
- [x] Respects CORE vs Integration boundaries (no backend touched)
- [x] Uses existing patterns (no unnecessary abstractions — reuses `CAPABILITY_HELP` map, existing test structure)
- [x] Idempotency considered (N/A — no new mutation, existing update-mutation semantics unchanged)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A — no new network calls)
- [x] Error handling comprehensive (existing `updateMutation.error` path already covers this)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards (no new files)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Invoicing (bounded context 14), § Capability Abstractions
- [Engineering Standards](../engineering-standards.md) — § Union Types `as const` Pattern
- [Frontend Architecture](../frontend-architecture.md) — § Feature Public Surface, § Internationalization
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [ADR-026: Country-agnostic invoicing domain](../architecture/adrs/026-country-agnostic-invoicing-domain.md)
