# Implementation Plan: Dedupe `OrderSummary` FE Type (shipments/invoicing)

**Date**: 2026-08-11
**Status**: Draft
**Estimated Effort**: 1 hour

---

## 1. Task Summary

**Objective**: Eliminate the byte-identical `OrderSummary` interface currently declared twice — once in `apps/web/src/features/shipments/api/shipments.types.ts` and once in `apps/web/src/features/invoicing/api/invoicing.types.ts` — by giving it a single canonical home in `apps/web/src/shared/types/` and updating both features to import it from there.

**Context**: Follow-up from `piotrswierzy`'s tech-lead review on PR #2012 (`orderSummary` projection for shipments/invoices lists), tracked as [issue #2020](https://github.com/openlinker-project/openlinker/issues/2020):

> 🟡 IMPORTANT — `OrderSummary` is duplicated verbatim in two FE features … Two independently-drifting mirrors of one server contract is the failure mode `docs/frontend-architecture.md § Feature Public Surface` exists to prevent — and #1996 will need one canonical type anyway.

Both declarations mirror the same backend `OrderSummaryProjectionDto` and both doc comments already point at the same not-yet-built consumer, `OrderIdentityCell` (#1996). Landing the fix now avoids #1996 having to pick a winner and migrate the loser.

**Classification**: Frontend (Shared layer, per `docs/frontend-architecture.md`)

---

## 2. Scope & Non-Goals

### In Scope
- Move the `OrderSummary` interface to `apps/web/src/shared/types/order-summary.types.ts`.
- Update `shipments.types.ts` and `invoicing.types.ts` to import it instead of redeclaring it.
- Re-export `OrderSummary` from each feature's own public barrel (`features/shipments/index.ts`, `features/invoicing/index.ts`) only if a consumer needs it from there — checked in Phase 1 research; today neither barrel exports it and no external consumer imports it, so no barrel edit is required unless a caller is found (see Step 1 finding below).

### Out of Scope
- Building `OrderIdentityCell` (#1996) — that consumes this type but is a separate, larger piece of work.
- Any change to the backend `OrderSummaryProjectionDto` or the `orderSummary` field on `Shipment` / `InvoiceRecord` — those keep their exact current shape.
- Any rendering/behavior change to the shipments or invoicing list pages.

### Constraints
- Must not introduce a `shared → features` import (violates `docs/frontend-architecture.md § Dependency Rules`).
- No backend change, no migration, no API contract change.
- Zero behavior change — this is a pure type-location refactor.

---

## 3. Architecture Mapping

**Target Layer**: Frontend / Shared (`apps/web/src/shared/types/`)

**Capabilities Involved**: None (no backend port/capability touched — this is a frontend-internal type dedup).

**Existing Services Reused**:
- The existing `shared/types/` convention, already populated by `structured-error.types.ts` (hoisted there for an analogous cross-cutting-shape reason in #613 — see file header of that module for the precedent).

**New Components Required**:
- One new file: `apps/web/src/shared/types/order-summary.types.ts`.

**Core vs Integration Justification**: N/A — this task is entirely frontend (`apps/web`), no `libs/core` or integration package is touched.

**Reference**: `docs/frontend-architecture.md § Folder Conventions` (`shared/`: "reusable UI, utilities, config, and cross-feature types") and `§ Dependency Rules` (`shared` must not import `features`).

---

## 4. External / Domain Research

### External System
N/A — no external system involved.

### Internal Patterns

**Precedent found** (`apps/web/src/shared/types/structured-error.types.ts`): an existing cross-cutting data shape (`StructuredError`) was hoisted from a UI primitive into `shared/types/` specifically so multiple consumers (a feature, a plugin, `shared/plugins/`) could import it without cross-importing from each other. `OrderSummary` is architecturally the same case — a data shape consumed by two peer features (`shipments`, `invoicing`) with no natural single owner.

**Consumers found today** (`grep -rn "OrderSummary" apps/web/src`):
- `features/shipments/api/shipments.types.ts:105` (declares) and `:169` (`Shipment.orderSummary: OrderSummary | null`).
- `features/invoicing/api/invoicing.types.ts:87` (declares) and `:134` (`InvoiceRecord.orderSummary: OrderSummary | null`).
- No other file imports `OrderSummary`. Neither feature's `index.ts` public barrel currently re-exports it. **This means no barrel edit is required in this plan** — both usages are feature-internal (a field type on `Shipment` / `InvoiceRecord`), and neither `Shipment` nor `InvoiceRecord`'s consumers need to name `OrderSummary` directly today; they consume it structurally through the parent type.

**Alternative pattern considered and rejected** (documented in the issue itself): making one feature own `OrderSummary` and re-exporting it from that feature's barrel for the other to import (the `#1787 posthog-settings → demo` precedent in `docs/frontend-architecture.md`). Rejected because neither `shipments` nor `invoicing` is the natural owner of an order-derived projection — both are equally peer consumers of the same backend shape, so an arbitrary ownership direction would be confusing. `shared/types/` avoids picking an arbitrary winner.

---

## 5. Questions & Assumptions

### Open Questions
- None — the shape, location, and consumers are fully determined from the codebase.

### Assumptions
- `shared/types/` is the correct home (matches issue #2020's stated resolution and the `structured-error.types.ts` precedent). If a reviewer prefers the feature-owns-and-re-exports pattern instead, only Phase 1 Step 2 below changes (target file becomes `features/shipments/api/shipments.types.ts` plus a re-export from `invoicing.types.ts`).
- No barrel (`index.ts`) edit is needed on either feature, since neither currently exports `OrderSummary` and no external consumer imports it. If #1996's `OrderIdentityCell` work later needs `OrderSummary` from `shared/`, it will import directly from `shared/types/order-summary.types.ts` (or, if `shared/types` gains a barrel later, from that barrel) — no feature barrel involvement needed for a `shared`-owned type.

### Documentation Gaps
- None found — `docs/frontend-architecture.md § Folder Conventions` and the `structured-error.types.ts` precedent fully cover this.

---

## 6. Proposed Implementation Plan

### Phase 1: Move the type

**Goal**: `OrderSummary` exists in exactly one file, in `shared/types/`, and both features import it from there.

**Steps**:

1. **Create `apps/web/src/shared/types/order-summary.types.ts`**
   - **File**: `apps/web/src/shared/types/order-summary.types.ts`
   - **Action**: Create the file with a file header describing its purpose (mirroring `structured-error.types.ts`'s header style) and the `OrderSummary` interface, copied verbatim (all 4 fields + their doc comments) from either existing declaration — they are identical, so no reconciliation is needed. Header should note: mirrors backend `OrderSummaryProjectionDto`; shared because both `shipments` and `invoicing` consume it (#2020, follow-up from #2012's review); future consumer is `OrderIdentityCell` (#1996).
   - **Acceptance**: File exists, exports `OrderSummary` with the exact same 4 fields (`orderNumber`, `firstItemName`, `firstItemImageUrl`, `itemCount`) and types as the two current declarations.
   - **Dependencies**: None.

2. **Update `apps/web/src/features/shipments/api/shipments.types.ts`**
   - **File**: `apps/web/src/features/shipments/api/shipments.types.ts`
   - **Action**: Delete the local `OrderSummary` interface declaration (currently lines ~101-119, including its doc comment). Add `import type { OrderSummary } from '../../../shared/types/order-summary.types';` in the file's import section (this file currently has no imports — it will be the first one, placed per `docs/engineering-standards.md § Import Order`: external → cross-boundary → local; `shared/` counts as a same-app cross-boundary import here, ordered before nothing since there are no external/relative imports currently. Use a relative path, matching the existing pattern in `features/shipments/lib/extract-shipping-field-errors.ts:20` which imports the sibling `StructuredError` type the same way: `'../../../shared/types/structured-error.types'`).
   - **Acceptance**: `Shipment.orderSummary: OrderSummary | null` still type-checks; no local `OrderSummary` interface remains in the file.
   - **Dependencies**: Step 1.

3. **Update `apps/web/src/features/invoicing/api/invoicing.types.ts`**
   - **File**: `apps/web/src/features/invoicing/api/invoicing.types.ts`
   - **Action**: Same as Step 2 — delete the local `OrderSummary` declaration, add the same relative import.
   - **Acceptance**: `InvoiceRecord.orderSummary: OrderSummary | null` still type-checks; no local `OrderSummary` interface remains in the file.
   - **Dependencies**: Step 1.

### Implementation Details

**New Components**:
- **Shared**: `apps/web/src/shared/types/order-summary.types.ts` (new file, `OrderSummary` interface only — no runtime code, mirrors the pure-type shape of `structured-error.types.ts`).

**Configuration Changes**: None.

**Database Migrations**: None — this is a frontend-only, type-only change; no ORM entity, no backend DTO is touched.

**Events**: None emitted or consumed — no runtime behavior change.

**Error Handling**: N/A — no new error paths introduced.

**Reference**: `docs/engineering-standards.md § Import Aliases` (relative-import rule for local/neighbor and same-app cross-boundary files applies analogously on the FE side via the existing `structured-error.types.ts` import precedent); `docs/frontend-architecture.md § Dependency Rules`.

---

## 7. Alternatives Considered

### Alternative 1: One feature owns it, the other imports via barrel
- **Description**: Keep `OrderSummary` declared in, say, `shipments.types.ts`, export it from `features/shipments/index.ts`, and have `invoicing.types.ts` import it from `../../shipments` (mirroring the documented `#1787 posthog-settings → demo` cross-feature-barrel pattern).
- **Why Rejected**: Neither `shipments` nor `invoicing` is the semantic owner of an order-identity projection — both are equally downstream consumers of the same backend contract. Picking one as owner is an arbitrary coupling that would surprise a future reader ("why does invoicing depend on shipments for an order-summary type?"). `shared/types/` has zero ownership ambiguity and an existing precedent (`structured-error.types.ts`) for exactly this shape of problem.
- **Trade-offs**: The barrel-re-export approach would require zero new files, but at the cost of introducing an artificial `invoicing → shipments` (or vice versa) coupling that doesn't reflect the actual domain relationship.

### Alternative 2: Leave the duplication and only fix it when #1996 lands
- **Description**: Defer the fix until `OrderIdentityCell` (#1996) is built and forces a decision.
- **Why Rejected**: This is exactly the deferral the PR #2012 reviewer flagged as the wrong sequencing — #1996 would then have to pick a winner and migrate the loser under time pressure, rather than landing the trivial dedup now while it's a pure mechanical move.
- **Trade-offs**: None favorable — deferring costs strictly more later for no benefit now.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No `shared → features` import introduced (the new file has no imports at all — it's a pure type declaration).
- ✅ Both features import from `shared/`, which is an explicitly permitted direction (`features` may import `shared`, per `docs/frontend-architecture.md § Dependency Rules`).
- **Reference**: `docs/frontend-architecture.md § Dependency Rules`.

### Naming Conventions
- ✅ File name `order-summary.types.ts` matches the `*.types.ts` convention used throughout `shared/types/` and both features' `api/*.types.ts` files.
- ✅ Interface name `OrderSummary` (PascalCase) is unchanged from its current declarations.
- **Reference**: `docs/engineering-standards.md § Naming Conventions` (backend convention; the FE mirrors the same `*.types.ts` file-naming discipline per `docs/frontend-architecture.md § Folder Conventions`).

### Existing Patterns
- ✅ Directly mirrors the `structured-error.types.ts` precedent — same rationale (cross-cutting shape consumed by multiple modules), same target directory, same import style used by existing consumers of that file.

### Risks
- **Import path is a relative deep path (`../../../shared/types/...`)**: Low risk — this exact relative pattern is already used by `features/shipments/lib/extract-shipping-field-errors.ts` and `features/content/lib/extract-platform-errors.ts` to import `StructuredError` from the same `shared/types/` directory, so it is a proven, lint-clean pattern (the FE `no-restricted-imports` deep-import ban targets cross-*feature* imports, not `feature → shared` imports, which are always permitted).
- **Silent behavior drift if the two declarations were NOT actually identical**: Mitigated — verified via direct file reads that both declarations are byte-identical (same 4 fields, same JSDoc, same nullability), so consolidating into one file changes nothing semantically.

### Edge Cases
- None — this is a structural move of a pure type with no runtime logic, no generics, no conditional types, and no consumer that pattern-matches on it beyond structural typing.

### Backward Compatibility
- ✅ No breaking change. `OrderSummary` remains importable from each feature's own type-transport modules only indirectly (via the `Shipment` / `InvoiceRecord` types, which still expose an `orderSummary: OrderSummary | null` field with the same shape). No test or production code currently imports `OrderSummary` by name from either feature file (confirmed via `grep -rn "OrderSummary" apps/web/src`), so no consumer-side import needs updating beyond the two files in Phase 1.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- No new unit test is required — this is a pure type refactor with no new runtime logic to test. Existing tests that construct `Shipment` / `InvoiceRecord` fixtures (if any use inline object literals matching the interface shape) continue to pass unchanged, since the field shape is untouched.

### Integration Tests
- None applicable — no backend or API contract change.

### Mocking Strategy
- N/A.

### Acceptance Criteria
- [ ] `OrderSummary` is declared in exactly one file: `apps/web/src/shared/types/order-summary.types.ts`.
- [ ] `apps/web/src/features/shipments/api/shipments.types.ts` imports `OrderSummary` from the shared location instead of declaring it locally.
- [ ] `apps/web/src/features/invoicing/api/invoicing.types.ts` imports `OrderSummary` from the shared location instead of declaring it locally.
- [ ] No behavior change: `Shipment.orderSummary` and `InvoiceRecord.orderSummary` retain the exact same type shape (`OrderSummary | null`).
- [ ] `pnpm lint` passes with zero errors (verifies no `shared → features` violation and no deep-import ban violation).
- [ ] `pnpm type-check` passes with zero errors.
- [ ] `shared` still does not import `features` (no architecture boundary violation introduced).

**Reference**: `docs/testing-guide.md` (no new test category triggered by this change); `docs/frontend-architecture.md § Testing Baseline`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A for pure-FE-type work, but respects the FE `shared`/`features` dependency direction, which is the FE analogue)
- [x] Respects CORE vs Integration boundaries (not applicable — no `libs/core` or integration package touched)
- [x] Uses existing patterns (no unnecessary abstractions) — reuses the exact `structured-error.types.ts` precedent
- [x] Idempotency considered (N/A — no runtime operation)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A)
- [x] Error handling comprehensive (N/A — no new error paths)
- [x] Testing strategy complete (no new tests needed; existing lint/type-check gates cover the change)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [Issue #2020](https://github.com/openlinker-project/openlinker/issues/2020)
- [PR #2012 review comment](https://github.com/openlinker-project/openlinker/pull/2012#pullrequestreview-4895446731)
