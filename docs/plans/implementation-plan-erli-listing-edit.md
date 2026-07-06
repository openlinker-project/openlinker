# Implementation Plan: Erli Plugin — Enable Edit Offer (supportsListingEdit)

**Date**: 2026-06-30
**Status**: Ready for Review
**Estimated Effort**: 1–2 hours

---

## 1. Task Summary

**Objective**: Opt the Erli FE plugin into the existing generic "Edit offer" affordance so operators can edit an Erli offer's price, title, and description directly from the listing-detail page UI, mirroring what Allegro already provides.

**Context**: The listing-detail page gates the "Edit offer" button on `mappingPlugin?.supportsListingEdit` (line 124 of `listing-detail-page.tsx`). Allegro declares `supportsListingEdit: true`; Erli does not, so the button is hidden for Erli offers even though the backend adapter (`ErliOfferManagerAdapter`) already implements `OfferFieldUpdater.updateOfferFields`. All the generic FE machinery — `EditOfferDrawer`, `useUpdateOfferFields`, `SuggestionDialog`, PLN price field — already works for any platform that opts in.

**Classification**: Frontend / Interface (FE plugin contribution only — no backend change)

---

## 2. Scope & Non-Goals

### In Scope

- Add `supportsListingEdit: true` to the `platform` block of `apps/web/src/plugins/erli/index.ts`.
- Add a test assertion in `apps/web/src/plugins/erli/erli.test.ts` mirroring the Allegro smoke test.
- Update `docs/integrations/erli/setup-guide.md` § 8 to replace the "UI button is coming" note with a description of the live Edit offer flow.

### Out of Scope

- Backend changes — `ErliOfferManagerAdapter.updateOfferFields` is already complete and production-ready.
- Surfacing frozen / skipped fields to the operator in the UI — the backend silently drops frozen fields on PATCH; for v1 the FE shows a generic success toast. A richer "field X was skipped (frozen)" UX is a follow-up issue.
- Currency selector — Erli is PLN-only; the drawer already defaults `priceCurrency` to `'PLN'` with a read-only input and no FE change is needed.
- `EditOfferDrawer` changes — the component is fully platform-agnostic and passes Erli's context (`mapping.platformType = 'erli'`) to `SuggestionDialog` unmodified.
- New FE components, routes, or hooks.

### Constraints

- Plugin contribution only; no host-internal imports (enforced by ESLint).
- No new pattern is introduced — this is a single-flag opt-in following the documented `PlatformContribution` slot (`docs/frontend-architecture.md:504`).

---

## 3. Architecture Mapping

**Target Layer**: Interface — `apps/web` plugin contribution (`plugins/erli/`)

**Capabilities Involved**: None new — `OfferFieldUpdater` sub-capability is already registered on the BE adapter (`isOfferFieldUpdater(erliAdapter) === true`); the FE dispatches through the generic `updateOfferFields` API call.

**Existing Services Reused**:
- `EditOfferDrawer` (generic, platform-agnostic, `features/listings/components/`)
- `useUpdateOfferFields` mutation hook (`features/listings/hooks/`)
- `SuggestionDialog` for AI-assisted descriptions (`features/content/`)
- `usePlatform` hook in `listing-detail-page.tsx` — reads `mappingPlugin.supportsListingEdit` at render time.

**New Components Required**: None.

**Core vs Integration Justification**: This change lives entirely in the FE plugin layer. No CORE or BE integration is touched.

---

## 4. External / Domain Research

### Internal Patterns

**Reference: Allegro plugin** (`apps/web/src/plugins/allegro/index.ts:63`):
```typescript
platform: {
  // ...
  supportsListingEdit: true,
  // ...
}
```
The Allegro smoke test asserts it at `allegro.test.ts:64–67`:
```typescript
it('contributes the GPSR extra-config section and the edit-offer affordance', () => {
  expect(allegroPlugin.platform?.ExtraConfigSection).toBeDefined();
  expect(allegroPlugin.platform?.supportsListingEdit).toBe(true);
});
```

**`EditOfferDrawer` defaults (already PLN-safe)**:
- `priceCurrency: 'PLN'` is the hardcoded default value (line 43 of `EditOfferDrawer.tsx`).
- The currency field renders read-only (`readOnly`, `className="input--readonly"`), meaning the PLN lock applies to all platforms — it's the correct behavior for Erli.

**Frozen-field behavior (v1 scope)**:
- `ErliOfferManagerAdapter.updateOfferFields` GETs the live product, compares `frozenFields` against the `PATCH_KEY_TO_ERLI_FROZEN_NAME` map, and silently drops any frozen key before issuing the PATCH. If all supplied keys are frozen the PATCH is skipped and the method returns without error.
- The FE receives HTTP 202 (accepted), shows "Update dispatched" toast, and closes the drawer — the frozen-field silencing is entirely transparent to the FE. This is the v1 contract; no FE change is needed.

**Erli setup guide** (`docs/integrations/erli/setup-guide.md`):
- Section 8 "Update an offer (price, title, description)" already covers the backend API flow and includes a callout `> **UI button is coming.** … tracked for Erli in **#1215** — until it ships, use the API above.`
- That note must be replaced with a description of the live Edit offer drawer (mirror how the [Create an offer] section covers the UI flow).

---

## 5. Questions & Assumptions

### Open Questions

- None blocking. The frozen-field wire vocabulary is described as provisional in the adapter types (`PROVISIONAL: the exact wire shape of the frozen marker is unconfirmed until the #992 sandbox spike`) but this does not affect the FE — the BE handles it transparently.

### Assumptions

1. `EditOfferDrawer` is already fully platform-agnostic and will work for Erli without any modification.
2. The `priceCurrency` read-only `PLN` lock is correct for Erli (Erli is PLN-only per adapter types and offer-creation wizard).
3. For a frozen-field offer, the BE's silent drop + 202 response means the FE shows success with no additional handling needed (v1 frozen-field UI behavior).
4. `SuggestionDialog` works for Erli because `mapping.platformType` is `'erli'` and the AI suggestion falls back to the master template when no erli-channel template exists — this is the documented behavior (`suggestChannel = mapping.platformType`; `t(key, fallback)` fallback path per `docs/frontend-architecture.md § Internationalization`).

### Documentation Gaps

- None. `supportsListingEdit` is documented as a `PlatformContribution` slot in `docs/frontend-architecture.md:504`.

---

## 6. Proposed Implementation Plan

### Phase 1 — Plugin Flag

**Goal**: Expose the Edit offer button for Erli offers.

**Steps**:

#### Step 1.1 — Add `supportsListingEdit: true` to Erli plugin

- **File**: `apps/web/src/plugins/erli/index.ts`
- **Action**: In the `platform:` block (after `offerValidation`), add:
  ```typescript
  supportsListingEdit: true,
  ```
- **Placement**: Between `offerValidation` (line 70) and the closing `},` of the `platform` block.
- **Acceptance**: `erliPlugin.platform?.supportsListingEdit === true` in tests; the Edit offer button renders on an Erli listing-detail page.
- **Dependencies**: None.

Full resulting `platform` block (no other changes):
```typescript
platform: {
  displayName: 'Erli',
  setupCard: {
    title: 'Erli',
    description: 'Connect your Erli seller account with your Shop API key.',
    to: '/connections/new/erli',
    badge: 'API key',
  },
  CredentialsPanel: ErliCredentialsPanel,
  ConnectionActions: ErliConnectionActions,
  // Bulk offer creation (#1096): dispatch time, no policies, PLN-only.
  bulkOfferConfigSection: {
    component: ErliBulkConfigSectionLazy,
    isComplete: erliBulkConfigIsComplete,
  },
  // Per-product dispatch-time override in the Review edit modal (#1096).
  bulkOfferRowSection: ErliBulkRowSectionLazy,
  // Shared single+bulk blocker: Erli requires ≥1 image (declared once).
  offerValidation: erliOfferValidation,
  supportsListingEdit: true,
},
```

---

### Phase 2 — Test Coverage

**Goal**: Assert the flag at the plugin smoke-test level (mirrors Allegro precedent).

**Steps**:

#### Step 2.1 — Add `supportsListingEdit` assertion to Erli smoke test

- **File**: `apps/web/src/plugins/erli/erli.test.ts`
- **Action**: Inside `describe('platform contributions', ...)`, add a new `it` block:
  ```typescript
  it('supports listing edit — Edit offer button enabled (#1215)', () => {
    expect(erliPlugin.platform?.supportsListingEdit).toBe(true);
  });
  ```
- **Placement**: After the `'contributes the bulk-offer config section + offer validation (#1096)'` test (line 58–62 of the current file).
- **Acceptance**: `pnpm test` passes with the new assertion green.
- **Dependencies**: Step 1.1.

---

### Phase 3 — Operator Documentation

**Goal**: Replace the "UI coming" placeholder in the Erli setup guide with live instructions.

**Steps**:

#### Step 3.1 — Update setup guide § 8

- **File**: `docs/integrations/erli/setup-guide.md`
- **Action**: Replace the existing section 8 body (lines ~273–299 in the current file) with content that:
  1. Opens with a one-paragraph summary of when to use Edit offer (operator-initiated price, title, or description change, not auto-propagated by stock sync).
  2. Describes the UI flow: open the Erli offer's listing-detail page → click **Edit offer** → the drawer opens with Title, Price (PLN), and Description fields → fill one or more → click **Save changes** → toast "Update dispatched" → the Erli PATCH is queued as a `marketplace.offer.updateFields` job.
  3. Mentions AI description suggestion (Suggest with AI button, gated on a linked variant).
  4. Documents frozen-field v1 behavior: if a field was edited directly in the Erli panel, Erli marks it `frozen`; OpenLinker's update silently skips that field. The drawer still shows success — surfacing skipped fields to the operator is a future follow-up.
  5. Removes (or converts to a historical note) the `> **UI button is coming.** … tracked for Erli in **#1215**` callout.
  6. Keeps the existing "API aside" for developer-centric readers (it's still accurate).

The updated section should mirror the depth of the "Create an offer" section (§ 6) — step-by-step UI description without screenshots (which will be added in the implementing PR when a live screenshot is available).

**Acceptance**: The "UI button is coming / tracked in #1215" callout is gone; the section reads as a completed feature.
**Dependencies**: Steps 1.1 and 2.1 merged.

---

## 7. Alternatives Considered

### Alternative 1: Erli-specific `EditOfferDrawer` variant
- **Description**: Fork `EditOfferDrawer` into an `ErliEditOfferDrawer` that explicitly shows "PLN-only" messaging or omits the description field.
- **Why Rejected**: The generic drawer already defaults `priceCurrency` to `PLN` read-only. Erli supports all three fields (price, title, description) per the adapter. A fork adds maintenance burden with no user-visible benefit.
- **Trade-offs**: Generic drawer is slightly more general than Erli strictly requires (description sections structure), but the BE maps it correctly.

### Alternative 2: Frozen-field FE awareness (show skipped fields)
- **Description**: The drawer could render a warning when the API response indicates some fields were skipped (frozen).
- **Why Rejected**: Erli's `updateOfferFields` returns 202 with a `{ jobId }` — the frozen-field silencing happens inside the adapter before the HTTP response; no field-level skip information surfaces through the current API contract. Implementing this would require a new response shape, API contract change, and BE work. Out of scope for this issue; captured as a follow-up.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Plugin contribution only — no host-internal imports, no cross-feature deep imports.
- ✅ `supportsListingEdit` is a documented `PlatformContribution` slot (`docs/frontend-architecture.md:504`).
- ✅ No new patterns introduced — single-flag opt-in.

### Naming Conventions
- ✅ `supportsListingEdit: true` is the existing slot name; no new naming decisions.

### Existing Patterns
- ✅ Mirrors `allegroPlugin.platform.supportsListingEdit: true` exactly.
- ✅ Test assertion mirrors `allegro.test.ts:66`.

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `EditOfferDrawer` sends a non-PLN currency for Erli | None | The drawer defaults `priceCurrency: 'PLN'` (read-only); no override mechanism exists. |
| Frozen-field silent-drop causes operator confusion (sent change appears to succeed but isn't applied) | Low (v1 accepted) | Documented in setup guide; follow-up tracked. |
| `SuggestionDialog` calls a non-existent erli channel template | None | Suggestion falls back to master template per AI system design. |
| `listing-detail-page.tsx` gate logic breaks | None | Gate reads `mappingPlugin?.supportsListingEdit` with optional chaining — safe when the flag is absent or present. |

### Edge Cases

- **Offer with no linked variant**: `SuggestionDialog` shows the "link this offer to a product variant first" hint instead of the Suggest button. Behavior inherited from generic drawer — no Erli-specific handling needed.
- **All fields frozen**: Erli adapter issues no PATCH and returns without error; the FE receives 202, shows "Update dispatched", closes drawer. V1 behavior accepted; no FE change.
- **Network error on `updateOfferFields`**: Drawer stays open, inline error `Alert` renders mutation error message. Generic behavior — unchanged.

### Backward Compatibility
- ✅ The flag addition is additive; no existing behavior changes for other platforms.
- ✅ `erli.test.ts` still passes all existing assertions after adding the new one.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

**File**: `apps/web/src/plugins/erli/erli.test.ts`

New assertion (Step 2.1):
```typescript
it('supports listing edit — Edit offer button enabled (#1215)', () => {
  expect(erliPlugin.platform?.supportsListingEdit).toBe(true);
});
```

No changes to `EditOfferDrawer.test.tsx` are required — the existing tests already cover the full drawer flow with a generic `OfferMapping` shape. An Erli-mapped fixture (switching `platformType: 'erli'`) can optionally be added to `EditOfferDrawer.test.tsx` to prove the drawer renders correctly for Erli:

```typescript
// Optional coverage — in EditOfferDrawer.test.tsx
const erliMapping: OfferMapping = {
  ...mockMapping,
  platformType: 'erli',
  externalId: 'erli-offer-001',
};
it('should render the edit drawer for an erli mapping', () => {
  renderDrawer(true, {}, undefined, erliMapping);
  expect(screen.getByRole('dialog', { name: 'Edit offer' })).toBeInTheDocument();
  expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
});
```

This is low-priority given the drawer is already platform-agnostic; include if the PR reviewer asks for Erli-specific coverage.

### Integration Tests

None required — this is a static plugin-flag change with no backend interaction. The backend `updateOfferFields` path already has its own unit + integration tests in `libs/integrations/erli/src/infrastructure/adapters/__tests__/`.

### Mocking Strategy

N/A for Phase 1 and 2. The `erli.test.ts` smoke tests import the live plugin object statically — no mocking needed.

### Acceptance Criteria

- [ ] `apps/web/src/plugins/erli/index.ts` declares `supportsListingEdit: true` in the `platform` block.
- [ ] `apps/web/src/plugins/erli/erli.test.ts` asserts `erliPlugin.platform?.supportsListingEdit === true` and passes.
- [ ] On an Erli offer's listing-detail page, the **Edit offer** button is visible in the page header.
- [ ] Clicking **Edit offer** opens `EditOfferDrawer` with Title, Price (PLN read-only), and Description fields.
- [ ] Submitting a title change calls `updateOfferFields` and the drawer shows "Update dispatched" + closes.
- [ ] Submitting with no dirty fields does NOT call the API (drawer's "Save changes" is disabled when pristine).
- [ ] `pnpm lint` passes (zero errors).
- [ ] `pnpm type-check` passes.
- [ ] `pnpm test` passes (new and existing assertions green).
- [ ] `docs/integrations/erli/setup-guide.md` § 8 no longer contains "UI button is coming" / "#1215" placeholder text.

**Reference**: [Testing Guide](../testing-guide.md) · [Frontend Architecture](../frontend-architecture.md) § Platform Plugins

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (FE plugin contribution; no layer boundaries crossed)
- [x] Respects CORE vs Integration boundaries (no BE change)
- [x] Uses existing patterns (single-flag opt-in, mirrors Allegro)
- [x] Idempotency considered (N/A — flag is a static declaration)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A — backend concern, existing)
- [x] Error handling comprehensive (generic drawer handles API errors inline)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan saved as markdown file

---

## File Impact Summary

| File | Change | Lines Δ |
|---|---|---|
| `apps/web/src/plugins/erli/index.ts` | Add `supportsListingEdit: true` | +1 |
| `apps/web/src/plugins/erli/erli.test.ts` | Add smoke assertion | +4 |
| `docs/integrations/erli/setup-guide.md` | Update § 8 (replace "coming" callout with live UI docs) | ~+10 −5 |

No other files need to change.

---

## Related Documentation

- [Frontend Architecture](../frontend-architecture.md) — `PlatformContribution` slot reference
- [ADR-025: Erli Marketplace Adapter](../architecture/adrs/025-erli-marketplace-adapter.md) — frozen-field exclusion §4b
- [Erli Setup Guide](../../libs/integrations/erli/docs/setup-guide.md) — operator documentation
- [Erli Runbook](../../libs/integrations/erli/docs/runbook.md) — frozen-field day-2 notes
- [Engineering Standards](../engineering-standards.md)
