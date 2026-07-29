# Pre-Implement Analysis: Shipments inline retry + carrier-message role visibility (#1826)

**Plan**: `docs/plans/implementation-plan-shipments-inline-retry.md`
**Date**: 2026-07-28
**Verdict**: **READY** (with two required plan refinements, both Warning-level — not Critical)

---

## Summary

The plan is unusually well-grounded — it already reconciled itself against the live worktree during its own research phase (correcting several assumptions the original issue/mockup carried: the `Processor` column, the `EntityLabel` navigation gap, the missing `shipments:write` permission, and the non-persisted parcel dimensions). This gate re-verified every one of those claims directly against the current tree and found them **all accurate**. No reinvented artifact, no contract-surface break. Two gaps surfaced that the plan itself doesn't yet cover: (1) a wrong file path for the BE DTO, and (2) the `CAN_GENERATE`/etc. sets need to be re-exported from the `orders` feature's public barrel, not just from `shipment-action-buttons.tsx` itself, for the plan's own barrel-import approach to actually work.

---

## Reuse Findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `shipments:write` permission | **NEW (confirmed absent)** | `libs/core/src/users/domain/types/role.types.ts` — `PermissionValues` has `shipments:read` only (line 49); `apps/web/src/shared/auth/session.types.ts` mirrors the same gap (line 25). |
| BE `@Roles` guard shape | **EXISTS, correctly cited** | `apps/api/src/shipping/http/shipment.controller.ts:194,233,267,298,315` — all five write endpoints (`generate-label`, `bulk/generate-labels`, `bulk/protocol`, `:id/cancel`, `:id/notify-dispatched`) use `@Roles('admin', 'operator')`. Plan's correction of an earlier "`@Roles('admin')` alone" claim is accurate. |
| `ConnectionDot` | **EXISTS, not barrel-exported** | `apps/web/src/features/orders/components/connection-dot.tsx` — real component; `apps/web/src/features/orders/index.ts` (20 lines total) exports only `ordersQueryKeys` + 4 types. `ConnectionDot` is absent — the plan's "add it to the barrel" step is confirmed necessary, not redundant. |
| `CAN_GENERATE` / `CAN_CANCEL` / `CAN_NOTIFY_DISPATCHED` / `CAN_DOWNLOAD_LABEL` / `PAYMENT_BLOCKS_DISPATCH` | **EXISTS, module-private** | `apps/web/src/features/orders/components/shipment-action-buttons.tsx:46,61,63,64,67` — confirmed all five are plain `const` (no `export`). Plan's "export them" step is correctly scoped. |
| `sourceDeliveryMethodId` on `ShipmentResponseDto` | **EXISTS** | `apps/api/src/shipping/http/dto/shipment-response.dto.ts:44-48,94` — already an `@ApiProperty` + assigned in `fromDomain`. Confirms the plan's "FE-only" classification for this field. |
| `deliveryIntent` on `ShipmentResponseDto` | **NEW (confirmed absent)** | Same file — no `deliveryIntent` field anywhere in the DTO or `fromDomain`. Confirms the plan's "needs a small BE DTO addition" correction. |
| `CopyableId` | **EXISTS** | `apps/web/src/shared/ui/copyable-id.tsx` present. |
| `useSearchParams` on order-detail | **NEW (confirmed absent)** | `apps/web/src/pages/orders/order-detail-page.tsx:14,67,73` — imports only `useLocation`/`useParams` from `react-router-dom`. Confirms the plan's "genuinely new plumbing" claim. |
| `Processor` column + `?processor=` filter | **EXISTS, correctly scoped as untouched** | `apps/web/src/pages/shipments/shipments-page.tsx` (live) — confirmed shipped, unrelated to this PR's `Provider` column. |
| Cross-feature `orders` ↔ `shipments` barrel relationship | **EXISTS as an established, bidirectional pattern** | `apps/web/src/features/orders/index.ts`'s own header comment: *"Today's only cross-feature consumer is `use-notify-dispatched-mutation`"* (a `shipments` hook consuming `orders`' barrel). Ten files under `features/orders/components/` already import from `'../../shipments'` (the `shipments` barrel) — `shipment-action-buttons.tsx`, `generate-label-form.tsx`, `order-shipment-panel.tsx`, `bulk-dispatch-dialog.tsx`, etc. The plan's proposed `shipments` → `orders` barrel import (for `ConnectionDot`) is the **reverse direction of an already-established pattern**, not a novel coupling — lower risk than a fresh cross-feature relationship would be. |

---

## Backward-Compatibility Findings

### Critical
None.

### Warning

1. **BE DTO file path in the plan is wrong.** The plan cites `apps/api/src/shipping/http/shipment-response.dto.ts`; the real path is `apps/api/src/shipping/http/dto/shipment-response.dto.ts` (a `dto/` subfolder the plan omitted). Low-risk, but will cost a confused first edit if not corrected before implementation starts.

2. **`CAN_GENERATE`/etc. need a second export, not just one.** The plan's Phase 1 Step 5 says "export them from `shipment-action-buttons.tsx`" — necessary, but **not sufficient** for the plan's own stated approach (importing them into `shipments`' `ShipmentRowDetail` via the `orders` **public barrel**, matching the barrel-only convention the plan itself invokes for `ConnectionDot`). `apps/web/src/features/orders/index.ts` does not currently re-export anything from `shipment-action-buttons.tsx`. Two fixes needed together: (a) add `export` to the five consts in `shipment-action-buttons.tsx`, and (b) add them to `orders/index.ts`'s barrel export list, mirroring how `ordersQueryKeys` is already exported there for `shipments`' own cross-feature consumption. Without step (b), `ShipmentRowDetail` either can't import them at all (if strictly barrel-only) or would deep-import `shipment-action-buttons.tsx` directly — which happens to **not** be blocked by the current ESLint cross-feature rule (see next finding) but contradicts the plan's own stated intent.

3. **ESLint's cross-feature deep-import ban does not currently enumerate `orders`.** `.eslintrc.js`'s `no-restricted-imports` cross-feature-barrel rule (`apps/web/src/features/**/*.{ts,tsx}` block) explicitly lists deny-globs for `adapters`, `allegro`, `connections`, `content`, `customers`, `inventory`, `listings`, `mappings`, `products`, `shipments`, `sync-jobs` — **`orders` is absent from this list**. This means a deep import like `import { ConnectionDot } from '../../orders/components/connection-dot'` from within `features/shipments/**` would **not** fail lint today, even though it violates the documented convention (`docs/frontend-architecture.md § Feature Public Surface`). This is a pre-existing gap in the enforcement list, not something this PR introduces — but it means the plan's barrel-export discipline (Phase 3 Step 3) is **not lint-enforced as a safety net**; it must be followed by convention/code-review alone. Not blocking, but worth a one-line PR-description note so reviewers know to check for it by eye.

4. **No automated FE/BE permission-list drift check.** Adding `shipments:write` to `libs/core/src/users/domain/types/role.types.ts` `PermissionValues` without also adding it to `apps/web/src/shared/auth/session.types.ts` (or vice versa) would not be caught by any existing test or `check:invariants` script — confirmed no drift-check script exists (`scripts/*permission*` returns nothing). Purely a discipline point for the implementer; the plan already correctly scopes both edits as one step, so this is a note for careful execution, not a plan defect.

5. **`DataTableSkeleton` has no `expandable` awareness.** `apps/web/src/shared/ui/data-table-skeleton.tsx`'s props are just `columns: number | readonly DataTableSkeletonColumn[]` — no leading-toggle-column concept. The loading skeleton will render one column narrower than the real expandable table unless the column count passed to it accounts for the new toggle column. Minor visual nit, not a functional break — flag as an implementation detail to check during Phase 4, not a plan revision.

### Migration / Schema
None required — `deliveryIntent` already exists as a column on the ORM entity (confirmed by the plan's own research); the DTO addition is a pure serialization change with zero migration.

### `check:invariants`
No cross-context (`libs/core`) import-boundary rules are implicated — the CORE change (`shipments:write` permission) is a same-context, additive enum entry inside `libs/core/src/users`, not a cross-context symbol. `check-service-interfaces.mjs` is not implicated (no new service class added). The only relevant invariant-adjacent gap is the ESLint cross-feature list finding above (Warning #3), which is a pre-existing repo condition, not a new violation this plan would introduce.

---

## Open Questions

- None blocking. The plan's own "Open Questions" section (sender-postcode redaction proportionality, draft-row observability) are correctly deferred as non-blocking follow-ups and don't affect this gate's verdict.

---

## Verdict Rationale

No Critical finding exists — nothing the plan proposes collides with an existing port/service/token/entity, and no published contract surface (barrel export, DTO shape, Symbol token, ORM schema) is broken by what's changed. The five Warning-level items are all small, concrete, and fixable by amending the plan text before Phase 4 starts (correct the DTO path; add the `orders/index.ts` barrel re-export step; note the ESLint gap for reviewers; note the skeleton column-count detail). None require re-architecting any part of the plan. **READY** to proceed to Phase 4 once the plan file is amended with these five corrections.
