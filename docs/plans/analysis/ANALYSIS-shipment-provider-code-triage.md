# Pre-implement Analysis: shipment-provider-code-triage (#1918)

**Verdict: NEEDS-REVISION** (minor — one omission, no design change; corrected inline below and in the plan)

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `ShippingProviderRejectionException` (providerCode/providerDetails source) | **ALREADY EXISTS** — reuse as-is | `libs/core/src/shipping/domain/exceptions/shipping-provider-rejection.exception.ts`; already thrown by `dpd-shipping.adapter.ts`, `inpost-shipping.adapter.ts`, `allegro-delivery-shipping.adapter.ts` with real `providerCode` values. Confirms the "no adapter-side work" assumption — every adapter already supplies the field, it's just not persisted. |
| `KnownProviderRejectionCodeValues` closed-core code vocabulary | **ALREADY EXISTS** — extend, don't duplicate | `libs/core/src/shipping/domain/types/shipping-provider-rejection.types.ts`. The plan's retryability types (`RetryabilityClass`, `RETRYABILITY_CLASS_VALUES`) should be appended to this file (same file already owns the code-family taxonomy the classifier switches on), not a new `*.types.ts` file — avoids proliferating near-duplicate type files. |
| A "retryability" classification concept | **PARTIAL — name collision risk checked, none found** | `SubiektTransportRetryability` (`libs/integrations/subiekt/src/domain/types/subiekt-transport-retryability.types.ts`) is a same-named-in-spirit but unrelated concept (bridge-transport fiscal-safety classification for Subiekt invoicing, `'safe' \| 'indeterminate'`). Different package, different symbol name (`RetryabilityClass` vs `SubiektTransportRetryability`), no export collision. Confirms the plan's chosen name doesn't clash. |
| Sync-context `RetryClassifier`/`AuthFailureClassifier` registry (`libs/core/src/sync/domain/ports/*.port.ts`) | **NOT REUSED (correctly, per plan's own non-goal)** | Confirmed this is a job-retry-orchestration registry (per-adapter classifier resolved by connection), a different concept from a shipment's own carrier-rejection code. Plan correctly avoids it. |
| `new Shipment(...)` construction sites (must be updated for the new positional constructor arg) | **PLAN UNDERCOUNTS — 9 sites, not 2** | `grep -rl "new Shipment("` returns: `shipment.repository.ts` (production) + **8** spec files each with their own local `makeShipment` test factory: `shipment-dispatch.service.spec.ts`, `shipment-cancellation.service.spec.ts`, `bulk-shipment-dispatch.service.spec.ts`, `shipment-dispatch-notification.service.spec.ts`, `shipment-status-sync.service.spec.ts`, `shipment-query.service.spec.ts`, `fulfillment-status-sync.service.spec.ts`, `shipment-label.service.spec.ts`, plus `apps/api/src/shipping/http/shipment.controller.spec.ts`. There is no shared/centralized `makeShipment` test helper — each spec hand-rolls its own. The plan (step 2) named only 2 of these 9. **Correction applied to the plan**: step 2 now enumerates all 9 files. Per the entity's own established discipline (see the `deliveryIntent`/`carrier` field-append comments — "Required (no default) so every construction site is forced to supply it"), `providerCode` should be a **required** (non-optional, non-defaulted) constructor arg, same as its predecessors — this makes a missed call site a compile error instead of a silent gap, which is exactly what surfaced this omission during the gate rather than during `pnpm type-check`. |

## Backward-compatibility findings

| Surface | Check | Severity | Notes |
|---|---|---|---|
| `Shipment` domain entity constructor | Adding a new **required** positional arg | Warning | Breaking for every construction site (9, see above) — all are same-repo, same-PR call sites (no external plugin constructs `Shipment` directly), so this is a same-commit fix-up, not a real compat break. Consistent with the file's own established pattern for prior field additions. |
| `ShipmentOrmEntity` / `shipments` table | New nullable column | Warning | Requires a migration (`docs/migrations.md`) — plan already accounts for this (`1832000000000-add-shipment-provider-code.ts`). Nullable + no backfill ⇒ safe, reversible. |
| `ShipmentResponseDto` | New field added, always populated (not gated by `canWrite`) | None | Purely additive on a response DTO — existing consumers ignore unknown fields. Confirmed `providerCode` is a short discriminator string, not carrier prose, so exposing it unconditionally does not reopen the `errorMessage` redaction concern (#1826) it sits beside. |
| `UpdateShipmentInput` / `CreateShipmentInput` | New optional field on `UpdateShipmentInput` only | None | Additive, optional — no existing caller breaks. |
| `@openlinker/core/shipping` top-level barrel | New named exports (`deriveRetryabilityClass`, `RetryabilityClass`, `RETRYABILITY_CLASS_VALUES`) | None | Additive export, matches the barrel's existing pattern of re-exporting pure domain functions/types (e.g. the `KnownProviderRejectionCodeValues` re-export already there). |
| `check-cross-context-imports` / deep-barrel ESLint rules | New FE file `shipment-retryability.ts` mirrors CORE logic by hand, does not import `@openlinker/core/*` | None | Confirmed via grep — `apps/web/src` has zero value-imports of `@openlinker/core` anywhere in the tree today (only comment references), so the FE-001 hand-mirror approach is the established, only-used pattern for this package boundary. No new violation introduced. |
| `check-service-interfaces` | No new `application/services/*.service.ts` file added | None | The retryability helper is a plain function in `domain/`, not a service — rule doesn't apply. |
| Full-object `toEqual` assertions on `Shipment`/`ShipmentResponseDto` fixtures | Not exhaustively checked | Warning | `shipment.repository.spec.ts` and `apps/api/src/shipping/http/shipment.controller.spec.ts` may assert exact object shape (`toEqual` vs `toMatchObject`) somewhere; adding a field could break an assertion that enumerates every key. Flagged for attention during Phase 4 implementation — not verified exhaustively here since it's a mechanical fix either way (add the field to the expected fixture), not a design question. |

## Open questions

- None blocking. The retryability-class naming/scope question was already resolved with the user (`transient/permanent/auth/unknown`, issue updated) before this gate ran.

## Disposition

The one real finding (undercounted `new Shipment(...)` call sites) is a plan-completeness gap, not a design flaw — corrected directly in the plan's step 2 (now lists all 9 files) as part of this gate, per the "fix the plan and re-gate" guidance for a NEEDS-REVISION verdict on a cheap, non-architectural correction. No second gate pass is needed; proceeding to implementation.
