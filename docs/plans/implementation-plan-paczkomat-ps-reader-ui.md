# Implementation Plan: InPost Paczkomat Module Type — Connection Config UI

**Date**: 2026-06-23  
**Status**: Draft  
**Estimated Effort**: 2–3 hours  
**Branch dependency**: `767-paczkomat-ps-reader` (must be merged before this work starts, or work cherry-picks the domain type + DTO from that branch)

---

## 1. Task Summary

**Objective**: Expose `inpostPsModuleType` as a named dropdown in the PrestaShop structured connection config UI so operators can select a value without editing raw JSON.

**Context**: `PrestashopOrderSourceAdapter.getOrder()` (on the `767-paczkomat-ps-reader` branch, #767) reads the InPost paczkomat locker code from `ps_address.address2` only when `connection.config.inpostPsModuleType === 'official_inpost'`. The backend type (`PrestashopConnectionConfig`), its DTO validation (`PrestashopConnectionConfigDto`), and the adapter logic are already implemented on that branch. The only missing piece is a UI control so operators do not need to resort to the raw JSON view.

**Accepted values**: `none` (default — no locker-code reading) | `official_inpost` (official InPost PS module installed; code in `address2`).

**Classification**: Integration / Frontend (plugin-contributed FE component + backend factory pass-through)

---

## 2. Scope & Non-Goals

### In Scope
- Add `inpostPsModuleType` dropdown to `PrestashopStructuredSection` FE component
- Add `inpostPsModuleType` field to the Zod `editConnectionSchema`, `StructuredConfigPatch`, and `mergeStructuredIntoConfig` helper
- Add `inpostPsModuleType` to `PrestashopAdapterFactory.validateAndParseConfig()` so the typed config accurately reflects all validated fields (the adapter already reads from raw `connection.config`, so this is a correctness/completeness fix, not a functional prerequisite)

### Out of Scope
- **No CORE changes** — `OrderSourcePort`, `IncomingOrder`, core domain entities are untouched
- **No new migration** — `inpostPsModuleType` is stored in the existing untyped `Connection.config` JSONB column; no schema change
- **No ADR** — this is a routine plugin UI extension with no architectural novelty (ADR-027 already documents the adapter approach; this plan only adds the UI surface)
- **No changes to `PrestashopConnectionConfigDto`** — it already has `inpostPsModuleType` on the `767-paczkomat-ps-reader` branch
- **No changes to the domain type** — `InpostPsModuleTypeValues`, `InpostPsModuleType`, and `inpostPsModuleType?: InpostPsModuleType` on `PrestashopConnectionConfig` are already present on the `767-paczkomat-ps-reader` branch

### Constraints
- Implementation branch must be based on `767-paczkomat-ps-reader` (or the merged result) — the domain type, DTO, and adapter logic live there
- No CORE or `OrderSourcePort` changes per explicit task scope
- Follows `ResponseFormat` / `defaultCarrierId` patterns already established in the PS plugin — no new patterns invented

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/prestashop/`) + Frontend (`apps/web/src/plugins/prestashop/`)

**Capabilities Involved**: None new. The existing `ConnectionConfigShapeValidatorPort` (implemented by `PrestashopConnectionConfigShapeValidatorAdapter`) validates the field via `PrestashopConnectionConfigDto`.

**Existing Services Reused**:
- `StructuredConfigSectionProps` / `StructuredConfigPatch` / `mergeStructuredIntoConfig` pattern (established by `defaultCarrierId` in #517)
- `Select` shared UI component (`apps/web/src/shared/ui/select.tsx`)
- `InpostPsModuleTypeValues` / `InpostPsModuleType` from `prestashop-config.types.ts` (imported via the plugin barrel)
- `FormField` shared UI component

**New Components Required**: None — all changes are additions to existing files.

**Core vs Integration Justification**: This is purely an Integration/FE concern. The field governs PS-adapter behaviour only; CORE has no concept of "which InPost module is installed". The operator-facing label and valid values are PS-module-specific. No core port needs updating.

---

## 4. Internal Patterns

### Similar Implementations

`defaultCarrierId` (added in #517) is the closest reference — it's the only other PS-only structured config field that:
1. Appears in `PrestashopConnectionConfig` as an optional field
2. Has `@IsOptional()` decoration in `PrestashopConnectionConfigDto`
3. Is validated and passed through `PrestashopAdapterFactory.validateAndParseConfig()`
4. Is rendered as a `<Select>` (not `<Input>`) in `PrestashopStructuredSection`
5. Appears in `editConnectionSchema`, `StructuredConfigPatch`, and `mergeStructuredIntoConfig`

Key difference: `defaultCarrierId` is coerced from string → number at submit time. `inpostPsModuleType` is a plain string — no coercion needed. The merge semantics are: delete the key when value is `'none'` (effectively "unset"), set the key when value is `'official_inpost'`.

### Existing Patterns

- **`as const` + union type**: `ResponseFormatValues` / `ResponseFormat` in `prestashop-config.types.ts` — same pattern used for `InpostPsModuleTypeValues` / `InpostPsModuleType` (already done on the 767 branch)
- **Schema/patch/merge**: `edit-connection.schema.ts` — follow the `storefrontBaseUrl` / `baseUrl` delete-on-empty merge pattern (NOT the `masterCatalogConnectionId` persist-empty pattern, since `none` should be stored as "absent" from the config rather than the literal string `'none'`)
- **FE Select**: the `PrestashopFallbackCarrierField` sub-component shows how to wire a `<Select>` to `syncStructuredToJson` without a fetch; `inpostPsModuleType` is simpler (static options, no async load)

---

## 5. Questions & Assumptions

### Open Questions
- None that block implementation. The adapter code (on the 767 branch) confirms `address2` is the correct field. ADR-027 documents the schema uncertainty for the probe step; the UI dropdown is independent of that outcome.

### Assumptions
- **Default display**: the dropdown shows `None (disabled)` as the first/default option, which corresponds to the absent key in the config (or `'none'`). This is the safe default.
- **Merge semantics for `'none'`**: when the operator selects `None`, the key is deleted from the config JSON (same as `baseUrl` delete-on-empty). The adapter treats an absent key the same as `'none'` (already the case in the 767 branch: the `!== 'official_inpost'` guard is falsy for any value other than the literal string).
- **Factory pass-through**: the adapter reads `connection.config.inpostPsModuleType` from the raw connection entity, not from the typed config built in `validateAndParseConfig()`. Updating the factory is therefore a correctness/type-completeness fix, not a functional prerequisite. It is included in this plan to keep the typed config in sync with the interface definition.
- **No FE import of TS union from plugin package**: the FE plugin code should define its own static option array rather than importing `InpostPsModuleTypeValues` from `@openlinker/integrations-prestashop` (that package is not a dependency of `apps/web`). The option list is two items and unlikely to drift.

### Documentation Gaps
- None identified.

---

## 6. Proposed Implementation Plan

### Phase 1: Backend — Factory Pass-Through (10 min)

**Goal**: Bring `PrestashopAdapterFactory.validateAndParseConfig()` into sync with the updated `PrestashopConnectionConfig` interface (which already has `inpostPsModuleType?: InpostPsModuleType` on the 767 branch).

**Note**: This phase is only needed if the 767 branch factory does not yet include `inpostPsModuleType` in `validatedConfig`. Confirm by checking `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts` on the working branch before starting.

#### Step 1.1 — Add `inpostPsModuleType` to `validateAndParseConfig`

- **File**: `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`
- **Action**: In `validateAndParseConfig()`:
  1. After the `responseFormat` validation block, add a guard that checks if `config.inpostPsModuleType` is present and, if so, verifies it is `'none'` or `'official_inpost'`. Throw a `PrestashopConfigException` if it is an unexpected value.
  2. Include `inpostPsModuleType: config.inpostPsModuleType as InpostPsModuleType | undefined` in the `validatedConfig` object literal (after existing fields).

```typescript
// Validate inpostPsModuleType (if provided)
if (config.inpostPsModuleType !== undefined) {
  const validTypes = ['none', 'official_inpost'];
  if (
    typeof config.inpostPsModuleType !== 'string' ||
    !validTypes.includes(config.inpostPsModuleType)
  ) {
    throw new PrestashopConfigException(
      `inpostPsModuleType must be one of: ${validTypes.join(', ')}`,
      'inpostPsModuleType',
      config.inpostPsModuleType
    );
  }
}
// ... in validatedConfig:
inpostPsModuleType: config.inpostPsModuleType as InpostPsModuleType | undefined,
```

- **Import**: add `InpostPsModuleType` to the import from `'../domain/types/prestashop-config.types'`
- **Acceptance**: `pnpm type-check` passes; no TS errors in the factory file

---

### Phase 2: Frontend Schema — Schema / Patch / Merge (15 min)

**Goal**: Add `inpostPsModuleType` to the Zod form schema, `StructuredConfigPatch`, and the `mergeStructuredIntoConfig` helper so the structured field is serialised into the raw config JSON on form submit.

#### Step 2.1 — Add to `editConnectionSchema`

- **File**: `apps/web/src/features/connections/components/edit-connection.schema.ts`
- **Action**: In the `editConnectionSchema` `z.object({...})`, add after the `defaultCarrierId` entry:

```typescript
// PS-only structured field for the installed InPost PS module type (#767).
// Controls whether OL reads the paczkomat locker code from address2 on
// order ingestion. 'none' (absent) = disabled; 'official_inpost' = enabled.
inpostPsModuleType: z.enum(['none', 'official_inpost']).optional(),
```

- **Acceptance**: `pnpm type-check` passes; the field is recognized as `'none' | 'official_inpost' | undefined` in `EditConnectionFormValues`

#### Step 2.2 — Add to `StructuredConfigPatch`

- **File**: `apps/web/src/features/connections/components/edit-connection.schema.ts`
- **Action**: In the `StructuredConfigPatch` interface, add after the `defaultCarrierId` entry:

```typescript
/**
 * PS-only: which InPost PS module is installed (#767). 'none' means absent
 * from config (no locker-code read); 'official_inpost' enables address2 read.
 */
inpostPsModuleType?: 'none' | 'official_inpost';
```

- **Acceptance**: TypeScript accepts this field in callers

#### Step 2.3 — Add to `mergeStructuredIntoConfig`

- **File**: `apps/web/src/features/connections/components/edit-connection.schema.ts`
- **Action**: In `mergeStructuredIntoConfig`, add after the `defaultCarrierId` block:

```typescript
if (structured.inpostPsModuleType !== undefined) {
  if (structured.inpostPsModuleType === 'none' || structured.inpostPsModuleType.length === 0) {
    delete next.inpostPsModuleType;
  } else {
    next.inpostPsModuleType = structured.inpostPsModuleType;
  }
}
```

Rationale: `'none'` means "disabled" — the adapter treats a missing key identically, so we keep the config clean rather than persisting the literal string `'none'`. Any future value besides `'none'` (e.g. `'official_inpost'`) is written verbatim.

- **Acceptance**: Submitting the form with `None` selected removes `inpostPsModuleType` from the serialised config JSON; submitting with `official_inpost` adds `"inpostPsModuleType": "official_inpost"` to config JSON.

---

### Phase 3: Frontend Component — Dropdown (20 min)

**Goal**: Render a `<Select>` dropdown for `inpostPsModuleType` inside `PrestashopStructuredSection`, following the same wiring pattern as the existing fields.

#### Step 3.1 — Add the dropdown to `PrestashopStructuredSection`

- **File**: `apps/web/src/plugins/prestashop/components/prestashop-structured-section.tsx`
- **Action**: After the `PrestashopFallbackCarrierField` element (bottom of the returned fragment), add:

```tsx
<FormField
  label="InPost PS module type (optional)"
  name="inpostPsModuleType"
  error={form.formState.errors.inpostPsModuleType?.message}
  description="Select the official InPost PrestaShop module installed on this shop. When set, OL reads the paczkomat locker code from the delivery address during order ingestion. Leave unset if InPost orders are not in use."
>
  <Select
    value={form.watch('inpostPsModuleType') ?? 'none'}
    onChange={(event) => syncStructuredToJson('inpostPsModuleType', event.target.value)}
    disabled={!configIsParseable}
    invalid={Boolean(form.formState.errors.inpostPsModuleType)}
  >
    <option value="none">None (disabled)</option>
    <option value="official_inpost">Official InPost module (address2)</option>
  </Select>
</FormField>
```

No external data fetch needed — the two options are static.

- **Acceptance**:
  - The dropdown renders in the EditConnectionForm for PrestaShop connections
  - Selecting `Official InPost module` and saving adds `"inpostPsModuleType": "official_inpost"` to config JSON
  - Selecting `None` and saving removes the key from config JSON
  - The `disabled` prop is respected when the raw JSON is unparseable

---

### Phase 4: Quality Gate (5 min)

Run the standard quality gate before committing:

```bash
pnpm lint        # must pass with zero errors
pnpm type-check  # must pass with zero errors
pnpm test        # all unit tests must pass
```

There are no new unit tests to write for this change:
- The dropdown is a thin rendering layer with no logic beyond what `mergeStructuredIntoConfig` already covers
- `mergeStructuredIntoConfig` logic (delete-on-none) mirrors the existing `baseUrl` / `storefrontBaseUrl` pattern and does not warrant its own spec unless a test file already exists for this function
- The factory validation block mirrors `responseFormat` and needs no separate spec if none exists for the factory

If a `mergeStructuredIntoConfig` test file exists at `apps/web/src/features/connections/components/edit-connection.schema.spec.ts` (or similar), add a test case for `inpostPsModuleType`:
- `'official_inpost'` is written to config
- `'none'` deletes the key from config

---

## 7. Alternatives Considered

### Alternative 1: Import `InpostPsModuleTypeValues` from `@openlinker/integrations-prestashop` in the FE plugin

**Description**: The FE component could import the `as const` array from the backend package to avoid duplicating the option list.

**Why Rejected**: `apps/web` does not and should not depend on `@openlinker/integrations-prestashop` (a NestJS/Node integration package). The option list is two items (`'none'`, `'official_inpost'`); duplicating them in the FE is not a maintainability burden and avoids an incorrect dependency direction.

### Alternative 2: Persist `'none'` as the literal string in config

**Description**: Instead of deleting the key when `'none'` is selected, write `"inpostPsModuleType": "none"` to the config.

**Why Rejected**: The adapter guard on the 767 branch is `config.inpostPsModuleType !== 'official_inpost'` — falsy for both absent key and `'none'`. Both representations are functionally identical. Deleting the key keeps the config cleaner (fewer unexpected keys for operators inspecting raw JSON) and matches the delete-on-empty pattern used by `baseUrl`, `storefrontBaseUrl`, and `defaultCarrierId`. The DTO's `@IsIn` also accepts `'none'` as a valid value, so operators who manually write `"none"` in the raw view won't hit a validation error.

### Alternative 3: Skip the factory pass-through (Phase 1)

**Description**: Since `PrestashopOrderSourceAdapter` reads from `connection.config` (the raw connection entity), not from the typed config returned by `validateAndParseConfig()`, the factory change has no runtime effect.

**Why Rejected**: The `PrestashopConnectionConfig` interface (on the 767 branch) already declares `inpostPsModuleType?: InpostPsModuleType`. Omitting the field from `validatedConfig` leaves an implicit inconsistency between the interface declaration and the factory's output. It also means a future refactor that switches the adapter to consume the typed config would silently lose the field. The validation block also provides a defensive guard in case the DTO layer is bypassed (e.g. direct DB edits).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Integration layer only — no CORE changes
- ✅ Plugin-contributed FE component (`apps/web/src/plugins/prestashop/`) — correct location
- ✅ Structured config section pattern follows established plugin contribution model

### Naming Conventions
- ✅ Field name `inpostPsModuleType` — camelCase, matches existing config fields
- ✅ Type `InpostPsModuleType` / const array `InpostPsModuleTypeValues` — follows `ResponseFormat`/`ResponseFormatValues` pattern

### Existing Patterns
- ✅ `as const` + union type (not enum) — correct per engineering standards
- ✅ `mergeStructuredIntoConfig` delete-on-empty semantics — matches `baseUrl`, `storefrontBaseUrl`
- ✅ `<Select>` with static options — mirrors the static-option version of the carrier picker

### Risks

- **`editConnectionSchema` shared across all platforms**: `inpostPsModuleType` is added to the shared Zod schema, but it is optional and PS-specific. Non-PS forms will simply never emit this field. Risk is low; follow existing precedent (`defaultCarrierId` is already PS-only in a shared schema).
- **Backend validation accepts `'none'`**: If an operator saves `"inpostPsModuleType": "none"` via raw JSON (not the UI), the DTO's `@IsIn` will accept it. The adapter treats it the same as absent. No functional issue.
- **Factory validation added after DTO validation**: `validateAndParseConfig()` is the second validation layer; by the time it runs, the DTO has already accepted the value. The factory guard is purely defensive.

### Edge Cases

- **Unparseable raw JSON**: `configIsParseable` → `false` disables the dropdown. `syncStructuredToJson` is not called. No change to config. Same behaviour as all other structured fields.
- **Existing connections with `"inpostPsModuleType": "none"` in raw config**: The adapter treats it correctly (not `'official_inpost'`). The dropdown will display `None (disabled)` on load (the `form.watch('inpostPsModuleType') ?? 'none'` fallback covers both absent key and the literal `'none'` value).
- **Pre-existing connections without the key**: `form.watch('inpostPsModuleType')` returns `undefined`; `?? 'none'` makes the Select default to the `None` option. Correct.

### Backward Compatibility
- ✅ Fully backward-compatible. The field is optional on the config interface and DTO. Connections that don't set it continue to behave exactly as before.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

If a spec file exists for `mergeStructuredIntoConfig` (e.g. `apps/web/src/features/connections/components/edit-connection.schema.spec.ts`), add:
- `should write inpostPsModuleType to config when value is 'official_inpost'`
- `should delete inpostPsModuleType from config when value is 'none'`
- `should delete inpostPsModuleType from config when value is empty string`

If no spec file exists, skip — the logic is a one-liner that mirrors existing patterns already tested (or not) alongside `baseUrl`.

### Integration Tests

No new integration tests required. The shape validator is already tested on the 767 branch (or will be by the existing `PrestashopConnectionConfigDto` tests). The FE component change is a thin rendering layer.

### Manual Acceptance Test (in dev stack)

1. Open any PrestaShop connection's Edit form
2. The dropdown **"InPost PS module type (optional)"** renders below the Fallback carrier picker
3. Default selection is **"None (disabled)"**
4. Select **"Official InPost module (address2)"** → raw JSON view gains `"inpostPsModuleType": "official_inpost"`
5. Save the connection; reload the edit form → dropdown still shows the selected value
6. Switch back to **"None (disabled)"** → `inpostPsModuleType` is absent from raw JSON after save

### Acceptance Criteria

- [ ] Dropdown renders in the PrestaShop connection edit form with two options
- [ ] Selecting `None` removes `inpostPsModuleType` from the serialised config (or leaves it absent)
- [ ] Selecting `Official InPost module` writes `"inpostPsModuleType": "official_inpost"` to the config JSON
- [ ] Saving and reloading the form preserves the selected value
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all pass with zero errors
- [ ] Backend shape validator accepts `official_inpost` and `none` (and absent key) without error
- [ ] No CORE files modified

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — changes confined to integration + FE plugin layers
- [x] Respects CORE vs Integration boundaries — no CORE file touched
- [x] Uses existing patterns — `defaultCarrierId` and `responseFormat` patterns followed exactly
- [x] Idempotency considered — saving the form multiple times is idempotent (key is absent or has one of the two valid values)
- [x] Event-driven patterns used where applicable — N/A (config update flow; no new events)
- [x] Rate limits & retries addressed — N/A (config UI change only)
- [x] Error handling comprehensive — DTO + factory validate the value; adapter guard is already in place
- [x] Testing strategy complete — manual acceptance test defined; unit test additions noted where applicable
- [x] Naming conventions followed — `inpostPsModuleType`, `InpostPsModuleType`, `InpostPsModuleTypeValues`
- [x] File structure matches standards — changes to existing files only, correct layer locations
- [x] Plan is execution-ready — all file paths, code snippets, and merge semantics specified
- [x] Plan is saved as markdown file — this document

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [ADR-027: PrestaShop paczkomat-read approach](../architecture/adrs/027-ps-paczkomat-read-approach.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
