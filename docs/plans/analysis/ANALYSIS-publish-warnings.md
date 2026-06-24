---
plan: implementation-plan-publish-warnings.md
issue: "#1131"
date: 2026-06-23
verdict: READY
---

# Pre-implement Analysis: Surface PublishProductResult.warnings

## Verdict

**READY** — no reuse collisions, no Critical contract-surface breaks, all changes additive and backward-compatible. Two existing spec assertions are intentionally broken by the API change and correctly identified in the plan (Step 4.1).

---

## Reuse Findings

| Plan Artifact | Status | Evidence |
|---|---|---|
| `warnings: string[] \| null` field on `ListingCreationRecord` domain entity | **NEW (confirmed absent)** | Entity has 9 positional constructor params ending with optional `bulkBatchId: string \| null = null`; no `warnings` field exists anywhere in the listings domain layer |
| `warnings` column on `listing_creation_records` ORM entity | **NEW (confirmed absent)** | ORM entity columns: `id`, `internalVariantId`, `connectionId`, `externalProductId`, `status`, `errors` (jsonb nullable), `bulkBatchId`, `createdAt`, `updatedAt` — no `warnings`, `validationErrors`, or `detail` column |
| `warnings?` param on `updateExternalIdAndStatus` in `ListingCreationRecordRepositoryPort` | **PARTIAL (extend existing)** | Method currently has 4 params `(id, externalProductId, status, errors?)` — appending optional `warnings?` is a backward-compatible extension; no callers outside the execution service pass `errors` so none will break |
| `warnings?` field on `CreateListingCreationRecordInput` type | **PARTIAL (extend existing)** | Type exists in `listing-creation-record.types.ts`; field is new, optional, callers that omit it compile unchanged |
| Migration `1810000000000-add-warnings-to-listing-creation-records.ts` | **NEW** | No migration file with this timestamp exists; current tail is `1809000000000-add-order-fulfillment-state.ts` → timestamp ordering invariant satisfied (`1810000000000 > 1809000000000`) |
| `warnings` jsonb column on `listing_creation_records` table | **NEW (confirmed absent)** | `errors` column exists (semantic: `errors is not null ↔ status = 'failed'`); no `warnings` column found; plan correctly identifies that `errors` cannot be reused |
| Logger `warn()` call in `ProductPublishExecutionService` | **PARTIAL (extend existing)** | `Logger` from `@openlinker/shared/logging` already instantiated in the service (`private readonly logger = new Logger(ProductPublishExecutionService.name)`); `warn(string)` call pattern already used in `buildResult`; new call follows identical style |
| `buildOrmEntity` `warnings` field threading | **PARTIAL (extend existing)** | Method exists; adding `entity.warnings = input.warnings ?? null` is an additive one-liner consistent with how `bulkBatchId` was added in the same method |

**No reuse collisions.** The `errors` column was audited as the only plausible candidate for reuse and is correctly ruled out on semantic grounds.

---

## Backward-Compatibility Findings

### Critical

None.

### Warning

| Surface | Change | Assessment |
|---|---|---|
| `ListingCreationRecordRepositoryPort.updateExternalIdAndStatus` signature | Optional 5th param `warnings?` appended | **Safe** — existing callers omit the argument; TypeScript optional params are backward-compatible at call sites and at type-check time |
| `ListingCreationRecord` constructor | Optional 10th param `warnings: string[] \| null = null` appended | **Safe** — all existing `new ListingCreationRecord(...)` construction sites pass ≤ 9 args; the default covers every omitted callsite |
| `listing_creation_records` schema | New nullable jsonb column `warnings` | **Safe** — nullable with no default expression; all existing rows read as `NULL`; no backfill required; TypeORM reads `null` correctly for pre-migration rows |
| Two spec assertions in `product-publish-execution.service.spec.ts` | 4-arg `toHaveBeenCalledWith` → 5-arg | **Intentional, bounded** — both occurrences explicitly identified in plan Step 4.1; not a contract break but a test update required before `pnpm test` passes |

### `check:invariants` scan

- **`check-cross-context-imports`**: No new cross-context imports introduced; all changes are within `libs/core/src/listings/` — no violation.
- **`check-service-interfaces`**: `ProductPublishExecutionService` already exists with its service interface; no new `*.service.ts` file added — no violation.
- **Deep barrel imports**: Plan uses only relative same-context paths and the existing `@openlinker/shared/logging` alias — no violation.
- **Repo-URL guard**: Not applicable.

---

## Open Questions

None blocking. All decisions documented in the plan:

- **Persist vs log-only**: resolved — persist + log (log-only is ephemeral, unqueryable).
- **Reuse `errors` column**: resolved — cannot reuse; semantic invariant would be corrupted.
- **Bulk-path aggregate counter**: resolved — not needed; `getBatch` already returns full child records.
- **Empty array handling**: resolved — `result.warnings?.length` check treats `[]` as absent; stores `null`.

---

## Summary

The plan is clean. All 8 file-level changes are either new artifacts or additive extensions to existing ones. No published barrel export is removed or renamed. No port method loses a parameter. The migration timestamp `1810000000000` satisfies the ordering invariant. The only test breakage is the two known happy-path assertions that must be updated to match the new 5-argument call — these are correctly identified and scoped in Step 4.1. Implementation can proceed as written.
