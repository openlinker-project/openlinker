# Pre-Implementation Analysis: InPost Paczkomat Module Type — Connection Config UI

**Plan**: `docs/plans/implementation-plan-*.md` (inline in issue #1155)  
**Issue**: [FEATURE] Frontend — Expose PrestaShop InPost module type in structured config (#1155)  
**Analyst**: `/pre-implement` gate  
**Date**: 2026-06-24  
**Verdict**: **NEEDS-REVISION**

---

## Verdict Summary

The plan is well-scoped and architecturally sound. Two files are missing from the plan's change list, and one conditional ("if spec file exists") needs to become unconditional. No contract-surface breaks detected. One factory style gap should be addressed for consistency. Revision is minor — no architectural rethink required.

---

## Phase B — Reuse Audit

All backend artifacts assumed to be on the merged `767-paczkomat-ps-reader` branch are confirmed present on `main` (commit `f8b906ca`).

| Plan Artifact | Status | File / Location |
|---|---|---|
| `InpostPsModuleTypeValues` / `InpostPsModuleType` | **ALREADY EXISTS** | `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts:35,44` |
| `PrestashopConnectionConfig.inpostPsModuleType?` | **ALREADY EXISTS** | same file, line 228 |
| `PrestashopConnectionConfigDto.inpostPsModuleType` | **ALREADY EXISTS** | `libs/integrations/prestashop/src/application/dto/prestashop-connection-config.dto.ts:105–107` — `@IsOptional()` + `@IsIn(InpostPsModuleTypeValues)` |
| `PrestashopOrderSourceAdapter` reads `inpostPsModuleType` | **ALREADY EXISTS** | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-source.adapter.ts:245` |
| `PrestashopAdapterFactory.validateAndParseConfig()` includes `inpostPsModuleType` | **ABSENT — NEW** | `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts` lines 323–337: field is missing from `validatedConfig` object |
| `PrestashopConfigException` | **ALREADY EXISTS** | `libs/integrations/prestashop/src/domain/exceptions/prestashop-config.exception.ts` — constructor: `(message: string, field?: string, value?: unknown)` |
| `editConnectionSchema` with `inpostPsModuleType` | **ABSENT — NEW** | `apps/web/src/features/connections/components/edit-connection.schema.ts` |
| `StructuredConfigPatch` with `inpostPsModuleType` | **ABSENT — NEW** | same file |
| `mergeStructuredIntoConfig` handles `inpostPsModuleType` | **ABSENT — NEW** | same file |
| `PrestashopStructuredSection` dropdown | **ABSENT — NEW** | `apps/web/src/plugins/prestashop/components/prestashop-structured-section.tsx` |
| `Select` shared component with `invalid` prop | **ALREADY EXISTS** | `apps/web/src/shared/ui/select.tsx:3–5` |
| `syncStructuredToJson` callback | **ALREADY EXISTS** | `apps/web/src/features/connections/components/EditConnectionForm.tsx:228–242` |
| `edit-connection.schema` test file | **ALREADY EXISTS** | `apps/web/src/features/connections/components/edit-connection.schema.test.ts` |

---

## Phase C — Backward-Compatibility Checklist

### CRITICAL — None

No published barrel exports are removed or renamed. No port signatures are changed. No ORM entities are modified. No Symbol tokens are touched.

### WARNING 1 — `StructuredField` union in `EditConnectionForm.tsx` is missing from the plan

**Surface**: `apps/web/src/features/connections/components/EditConnectionForm.tsx`, line 30–38.

**Finding**: `StructuredField` is a **hand-maintained union literal** (`'baseUrl' | 'siteUrl' | 'shopId' | ... | 'unmanagedStockQuantity'`). It is **not** derived from `keyof StructuredConfigPatch`.

`syncStructuredToJson` is typed `(field: StructuredField, ...)` internally. The plugin boundary casts from `string` to `StructuredField` at line 370:
```typescript
syncStructuredToJson={(field, value, options) =>
  syncStructuredToJson(field as StructuredField, value, options)
}
```

The `as` cast means `pnpm type-check` will NOT fail even if `'inpostPsModuleType'` is absent from `StructuredField`. The feature would also work at runtime. However, the semantic contract is broken: `StructuredField` is supposed to enumerate all valid structured config keys, and `mergeStructuredIntoConfig(parsed, { [field]: value })` depends on this invariant. A future refactor that enforces `StructuredField extends keyof StructuredConfigPatch` would silently miss `inpostPsModuleType`.

**Fix**: Add `'inpostPsModuleType'` to the `StructuredField` union at `EditConnectionForm.tsx:30–38`. The plan must list this file.

**Severity**: Warning — won't fail type-check due to the cast, but leaves a semantic gap and creates a latent defect.

---

### WARNING 2 — Test file EXISTS; Phase 4 tests are required, not conditional

**Surface**: `apps/web/src/features/connections/components/edit-connection.schema.test.ts`

**Finding**: This file already exists. The plan states "if a `mergeStructuredIntoConfig` test file exists… add a test case". Since the file exists, these tests are **required** by the plan's own scope, not optional. The conditional framing could lead a developer to skip them.

**Fix**: Restate Phase 4 test additions as unconditional. Specifically add to the test file:
- `should write inpostPsModuleType to config when value is 'official_inpost'`
- `should delete inpostPsModuleType from config when value is 'none'`

**Severity**: Warning — no contract break, but the plan's hedge is factually wrong given the file exists.

---

### SUGGESTION — Factory validation should import `InpostPsModuleTypeValues` rather than hardcode

**Surface**: Phase 1, Step 1.1 code snippet in `PrestashopAdapterFactory`.

**Finding**: The plan's snippet uses a locally-defined `const validTypes = ['none', 'official_inpost']`. The existing `responseFormat` pattern in the factory also uses a local array, so the plan is self-consistent. However, `InpostPsModuleTypeValues` is already defined and imported in the DTO. Using it in the factory avoids a silent value drift if a third value is added in the future. The DTO imports `InpostPsModuleTypeValues` from the types file; the factory should do the same.

**Fix (optional but recommended)**: Replace the hardcoded `validTypes` array with `[...InpostPsModuleTypeValues]` (spreading the `readonly` tuple), and import `InpostPsModuleTypeValues` from `'../domain/types/prestashop-config.types'` alongside `InpostPsModuleType`.

**Note**: The plan's value order is `['none', 'official_inpost']` but the source of truth is `['official_inpost', 'none']` (line 35 of the types file). Order doesn't matter for `Array.includes()`, but importing the constant eliminates any question.

**Severity**: Suggestion only — no functional or contract impact.

---

## Open Questions

None that block implementation. All 767 branch artifacts are confirmed on `main`. The two warnings above are concrete and actionable.

---

## Required Revisions Before Implementation

1. **Add `EditConnectionForm.tsx` to the file list** (Phase 3 or as a new sub-step): add `'inpostPsModuleType'` to the `StructuredField` union at line 30–38.
2. **Make Phase 4 test additions unconditional**: remove the "if spec file exists" hedge; the file is confirmed present.

---

## Summary

The plan's backend assumptions are fully confirmed on `main`. All three FE files targeted (schema, structured section, test) are confirmed present and correctly identified. The plan is missing one file (`EditConnectionForm.tsx`) where the `StructuredField` union lives. This omission won't cause a `pnpm type-check` failure (the `as StructuredField` cast on line 370 suppresses it), but it leaves a semantic gap that should be closed. The test file exists and tests are required. Fix both, then implement.
