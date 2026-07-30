# Implementation Plan: Persist `providerCode` on Shipment + re-key failure triage grouping

Issue: #1918
Branch: `1918-shipment-provider-code-triage` (stacked on PR #1905's branch `1826-shipments-inline-retry-role-visibility`, since the FE triage-grouping files this issue extends only exist there, not on `main`)

## 1. Understand the task

`ShippingProviderRejectionException` carries a structured `providerCode` (+ open-shape `providerDetails`), but `ShipmentDispatchService.generateLabel`'s catch block only persists the free-text `message` onto `Shipment.errorMessage`. `providerCode` reaches a warn-level log line and is then dropped. Two consequences documented in #1918:

1. The `/shipments` triage strip (#1826/PR #1905) fuzzy-groups on normalised `errorMessage` text, which can conflate unrelated failures (bad postcode / missing parcel template / exhausted-retry 503 can all normalise to the same string).
2. There is no retryability signal — nothing distinguishes "carrier briefly unavailable, just regenerate" from "the address is wrong, fix the order first."

**Layer**: CORE (shipping domain/infrastructure) + Interface (DTO) + Frontend (triage grouping + display).

**Non-goals** (explicit, per issue Assumptions):
- No adapter-side work — every shipping adapter already throws `ShippingProviderRejectionException` with a `providerCode`; this is purely persist-and-surface.
- No `providerDetails`/`fieldErrors` persistence — optional in the issue, deferred here to keep the migration and mapping surface small. Only `providerCode` (already a `string | null` scalar) is persisted.
- No change to the sync-context `RetryClassifier`/`AuthFailureClassifier` registry pattern (`libs/core/src/sync/domain/ports/*.port.ts`) — that registry is for job-retry orchestration, a different concept from a shipment's carrier-rejection code. The retryability class here is a pure, adapter-independent derivation from the `providerCode` string shape (documented family conventions: `preflight.*`, `command.*`, `api.http-{status}`), not a new registry.
- **Scope correction from the issue's own wording**: the issue's Proposed Solution names four classes (`transient/permanent/auth/parcel-limits`). `parcel-limits` cannot be honestly derived from code *shape* alone — it would require per-carrier knowledge of which opaque carrier-surfaced code names mean "over a size/weight/COD limit", which is exactly the adapter-side work ruled out in Assumptions. This plan implements a 4-way class that is honestly derivable from code family alone: `transient | permanent | auth | unknown` (opaque carrier-surfaced codes, e.g. `DELIVERY_METHOD_NOT_AVAILABLE`, fall into `unknown` rather than a guessed bucket). Flagged to the user for confirmation before implementation.

## 2. Research the codebase (already done)

- `ShippingProviderRejectionException` (`libs/core/src/shipping/domain/exceptions/shipping-provider-rejection.exception.ts`): `providerName`, `providerCode: string | null`, `message`, `providerDetails?`.
- `KnownProviderRejectionCodeValues` (`libs/core/src/shipping/domain/types/shipping-provider-rejection.types.ts`) — closed-core vocabulary for the well-known code families (`preflight.*`, `target_point`, `command.*`); carrier-surfaced codes are explicitly open/out of scope for enumeration. This is the natural home for a sibling pure retryability-derivation file.
- `ShipmentDispatchService.generateLabel` catch block (`shipment-dispatch.service.ts:341-365`) — where `errorMessage` is written today; `providerCode` is only read for the log line.
- `Shipment` domain entity (`shipment.entity.ts`) — constructor args are positional; the file has an explicit convention (see comments around `sourceDeliveryMethodId`/`carrier`/`deliveryIntent`) to **append new fields at the end**, never splice into the middle, so a misplaced/omitted arg is a compile error, not a silent field shuffle. `providerCode` must follow this.
- `ShipmentOrmEntity` — plain nullable `@Column({ type: 'text', nullable: true })` pattern (mirrors `carrier`).
- `ShipmentRepository` — `toDomain`/`buildOrmEntity`/`buildUpdatePayload` are the three private mapping points that need the new field threaded through. `CreateShipmentInput` doesn't need `providerCode` (a shipment is always born without one — it's a failure-time value); `UpdateShipmentInput` does.
- `ShipmentResponseDto` — `errorMessage` is redacted for `viewer` (`REDACTED_ERROR_MESSAGE`); `providerCode` is a short discriminator (e.g. `preflight.missing-parcel-template`, `api.http-503`), not raw carrier prose, and does NOT carry the same address-fragment leak risk `errorMessage` does — per the issue's Proposed Solution item 2, it must be visible to `viewer` too. Not gated by `canWrite`.
- FE `Shipment` type (`apps/web/src/features/shipments/api/shipments.types.ts`) — hand-mirrors the BE DTO verbatim (FE-001 discipline; FE never imports `@openlinker/core`, confirmed via repo grep). `ShipmentsApi.list`/`generateLabel` use a generic `request<T>()` JSON passthrough — no manual per-field DTO mapping, so adding `providerCode` to the type is sufficient for it to flow through.
- `group-failed-shipments-by-cause.ts` (PR #1905 branch only) — currently groups on `(connectionId, normaliseErrorMessage(errorMessage))`. Its own header comment already documents this as "a known-inferior stand-in for a real `providerCode` column" — this issue is exactly that follow-up.
- `shipment-triage-strip.tsx` — renders `group.cause` as inline mono text; copy says "report the same carrier message". Needs to still work when the group key is now a `providerCode`, not normalised text (the rendered sample should still show something human-legible).
- `shipment-severity.ts` / `ShipmentSeverityLabel` — unaffected; severity is a status-derived label, not cause-related. Not touched by this issue.
- `shipment-row-detail.tsx` — renders `shipment.errorMessage` (redacted-aware). Will additionally show `providerCode` as a small mono fact for the operator (visible to viewer, unlike the message) so the accordion and the strip agree on cause.
- Migration naming convention: sequential synthetic timestamps, e.g. `1831000000003-add-posthog-product-events-settings.ts` is the latest on this branch → next is `1832000000000`.

## 3. Design

### 3a. CORE — persist `providerCode`

- **Migration** `apps/api/src/migrations/1832000000000-add-shipment-provider-code.ts`: nullable `providerCode` text column on `shipments`. No index needed (grouping happens in-memory over one loaded page, mirroring how `errorMessage` itself carries no index).
- **Domain entity** (`shipment.entity.ts`): append `public readonly providerCode: string | null` as the last constructor arg, with a comment following the existing anti-collision convention.
- **ORM entity** (`shipment.orm-entity.ts`): `@Column({ type: 'text', nullable: true }) providerCode!: string | null;`
- **Types** (`shipment.types.ts`): add `providerCode?: string | null;` to `UpdateShipmentInput` only (not `CreateShipmentInput` — a shipment is never born with a provider code).
- **Repository** (`shipment.repository.ts`): thread `providerCode` through `toDomain`, `buildOrmEntity` (`entity.providerCode = null;` at create-time, matching the `errorMessage`/`failedAt` null-init pattern), and `buildUpdatePayload` (`if (patch.providerCode !== undefined) payload.providerCode = patch.providerCode;`).
- **Dispatch service** (`shipment-dispatch.service.ts:357-361`): extend the failure-path `update()` patch with `providerCode: error instanceof ShippingProviderRejectionException ? error.providerCode : null`.
- **Types**: append `RETRYABILITY_CLASS_VALUES` / `RetryabilityClass` to the existing `libs/core/src/shipping/domain/types/shipping-provider-rejection.types.ts` (already owns the code-family taxonomy the classifier switches on — reuse over a new near-duplicate types file, per pre-implement gate finding).
- **New pure helper** `libs/core/src/shipping/domain/provider-code-retryability.ts` (sibling to `fulfillment-rollup.ts`/`delivery-intent-resolution.ts` — plain exported function, no class, per the existing `domain/` pattern for cross-entity pure derivations; imports the type from the `.types.ts` file above):
  ```ts
  import { type RetryabilityClass } from './types/shipping-provider-rejection.types';

  export function deriveRetryabilityClass(providerCode: string | null): RetryabilityClass {
    if (providerCode === null) return 'unknown';
    const httpMatch = /^api\.http-(\d{3})$/.exec(providerCode);
    if (httpMatch) {
      const status = Number(httpMatch[1]);
      if (status === 401 || status === 403) return 'auth';
      if (status >= 500) return 'transient';
      if (status === 429) return 'transient';
      return 'permanent';
    }
    if (providerCode.startsWith('preflight.')) return 'permanent';
    if (providerCode.startsWith('command.')) return 'permanent';
    if (providerCode === 'target_point') return 'permanent';
    return 'unknown'; // opaque carrier-surfaced code — no adapter-side classification available
  }
  ```
  Exported from the `shipping` context barrel (`libs/core/src/shipping/index.ts`) alongside the existing `KnownProviderRejectionCodeValues` re-export, since it's a pure function/type export (allowed cross-context symbol shape).
- **`ShipmentResponseDto`**: add `providerCode: string | null` field, always populated from `shipment.providerCode` regardless of `canWrite` (per issue #2 — short discriminator, not sensitive prose).

### 3b. Frontend — expose + re-key

- **`shipments.types.ts`**: add `providerCode: string | null;` to the FE `Shipment` interface (mirrors the DTO).
- **New FE helper** `apps/web/src/features/shipments/lib/shipment-retryability.ts` — FE-001 hand-mirror of the CORE helper (same reasoning as `KNOWN_CARRIER_VALUES` mirroring `KnownCarrierValues`): `RETRYABILITY_CLASS_VALUES`, `RetryabilityClass`, `deriveRetryabilityClass`, plus a `Record<RetryabilityClass, string>` display-label map (`transient` → "Transient - safe to retry", `permanent` → "Needs a fix before retrying", `auth` → "Connection authentication problem", `unknown` → "Cause not classified"). Unit-tested directly (pure function), matching `shipment-severity.spec.ts`-style colocated test.
- **`group-failed-shipments-by-cause.ts`**: re-key `groupKey`/grouping on `(connectionId, providerCode)` when `providerCode` is present on every member shipment; fall back to the existing `(connectionId, normaliseErrorMessage(errorMessage))` behaviour when `providerCode` is `null` (pre-migration rows, or a carrier that never set one). `FailedShipmentCauseGroup` gains a `providerCode: string | null` field so the strip can render it and derive retryability. Keep the `REDACTED_ERROR_MESSAGE` viewer guard as-is (unaffected — `providerCode` is never redacted, so a viewer's rows now group correctly even though their `errorMessage` is a shared placeholder — this is an ADDITIONAL fix as a side effect, worth calling out in the PR body: viewer-role triage was previously broken since every viewer row falsely appeared as "the same cause").
- **`shipment-triage-strip.tsx`**: render the `providerCode` (mono, e.g. `preflight.missing-parcel-template`) instead of / alongside the raw `errorMessage` sample, plus the derived retryability label so the copy can stop being deliberately vague where the class is knowable (e.g. explicitly say "safe to just retry" only when `retryabilityClass === 'transient'").
- **`shipment-row-detail.tsx`**: surface `providerCode` as a small mono fact next to "Carrier rejection" (visible to `viewer` too, unlike the redacted message).

## 4. Step-by-step

1. `apps/api/src/migrations/1832000000000-add-shipment-provider-code.ts` — new migration (nullable column, no backfill needed).
2. `libs/core/src/shipping/domain/entities/shipment.entity.ts` — append `providerCode` field as a **required** (no default) positional constructor arg, same discipline as `deliveryIntent`/`carrier` before it. Update every `new Shipment(...)` call site (confirmed via grep, 9 total): `infrastructure/persistence/repositories/shipment.repository.ts` (production `toDomain`) plus the local `makeShipment` test factory in each of `shipment-dispatch.service.spec.ts`, `shipment-cancellation.service.spec.ts`, `bulk-shipment-dispatch.service.spec.ts`, `shipment-dispatch-notification.service.spec.ts`, `shipment-status-sync.service.spec.ts`, `shipment-query.service.spec.ts`, `fulfillment-status-sync.service.spec.ts`, `shipment-label.service.spec.ts`, and `apps/api/src/shipping/http/shipment.controller.spec.ts`. There is no shared factory — each is hand-rolled and updated independently.
3. `libs/core/src/shipping/infrastructure/persistence/entities/shipment.orm-entity.ts` — add column.
4. `libs/core/src/shipping/domain/types/shipment.types.ts` — add `providerCode?: string | null` to `UpdateShipmentInput`.
5. `libs/core/src/shipping/infrastructure/persistence/repositories/shipment.repository.ts` — thread through `toDomain` / `buildOrmEntity` / `buildUpdatePayload`; update `shipment.repository.spec.ts`.
6. `libs/core/src/shipping/application/services/shipment-dispatch.service.ts` — populate `providerCode` in the failure-path `update()` call; extend `shipment-dispatch.service.spec.ts`'s existing `#1428` rejection test (and the plain-`Error` test) to assert `providerCode` is persisted (`'target_point'` / `null` respectively).
7. `libs/core/src/shipping/domain/types/shipping-provider-rejection.types.ts` — append `RETRYABILITY_CLASS_VALUES`/`RetryabilityClass`. `libs/core/src/shipping/domain/provider-code-retryability.ts` (+ `.spec.ts`) — new pure helper. Both exported from `libs/core/src/shipping/index.ts`.
8. `apps/api/src/shipping/http/dto/shipment-response.dto.ts` — add `providerCode` field to the DTO + `fromDomain`; update `shipment.controller.spec.ts` fixtures if they assert the full DTO shape.
9. `apps/web/src/features/shipments/api/shipments.types.ts` — add `providerCode: string | null` to the FE `Shipment` type.
10. `apps/web/src/features/shipments/lib/shipment-retryability.ts` (+ `.test.ts`) — new FE pure helper (hand-mirror of step 7).
11. `apps/web/src/features/shipments/lib/group-failed-shipments-by-cause.ts` (+ its `.test.ts`) — re-key grouping on `providerCode` with fallback to normalised text; add `providerCode` to `FailedShipmentCauseGroup`.
12. `apps/web/src/features/shipments/components/shipment-triage-strip.tsx` (+ its `.test.tsx` if one exists) — render `providerCode` + retryability label.
13. `apps/web/src/features/shipments/components/shipment-row-detail.tsx` — surface `providerCode` fact, viewer-visible.
14. Run full quality gate (§5).

## 5. Validate

- Architecture: `providerCode` stays a plain scalar on the domain entity/ORM entity — no new port, no cross-context reach. The retryability helper is a pure function colocated in `shipping/domain/`, mirroring `fulfillment-rollup.ts` — not a new capability port (no adapter needs to implement anything).
- Naming: migration name follows the sequential-timestamp convention; new files follow `*.types.ts`/no-inline-types, `*.test.ts`/`*.spec.ts` colocation.
- No architecture-boundary violation: FE hand-mirrors the CORE vocabulary (existing, established pattern for this exact package boundary — FE cannot import `@openlinker/core`).
- Migration is additive/nullable — no backfill, no data loss, reversible `down()` drops the column.
- Testing: extend existing specs (`shipment-dispatch.service.spec.ts`, `shipment.repository.spec.ts`, `group-failed-shipments-by-cause.test.ts` if present) rather than duplicating suites; add new colocated spec/test files for the two pure retryability helpers.
- `pnpm --filter @openlinker/api migration:show` after the migration is written, to confirm it's the only pending one.

## 6. Open question for the user

The 4-way retryability class in §3a §1 (design decision) diverges from the issue's literal wording (`parcel-limits` dropped, `unknown` added) because `parcel-limits` cannot be derived from code shape alone without adapter-specific knowledge — confirm before implementing.
