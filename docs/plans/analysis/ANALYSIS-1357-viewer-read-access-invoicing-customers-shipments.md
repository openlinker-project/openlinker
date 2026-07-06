# Pre-Implementation Analysis: Viewer Read Access — Invoicing, Customers, Shipments

**Plan**: `docs/plans/implementation-plan-1357-viewer-read-access-invoicing-customers-shipments.md`
**Issue**: [#1357](https://github.com/openlinker-project/openlinker/issues/1357)
**Date**: 2026-07-06

---

## Verdict: **NEEDS-REVISION**

The plan introduces no new ports, services, DI tokens, ORM entities, or capabilities — it is a pure decorator-placement + permission-list change, exactly as it claims, and every artifact it touches genuinely already exists (no reinvention). However, live-repo verification surfaced **one confirmed test regression the plan does not account for** and **one guaranteed lint failure the plan's own step list omits**, plus one lower-severity contract-parity gap. All three are small, localized fixes — this is a `NEEDS-REVISION`, not a `NEEDS-MAJOR-REVISION`.

---

## Reuse Findings

The plan proposes zero new components. Verified against the live tree that nothing it touches is secretly a duplicate of something that already exists elsewhere (the opposite direction of the usual reuse-audit — here the question is "does the plan correctly identify that nothing new is needed," and it does):

| Plan artifact | Classification | Evidence |
|---|---|---|
| Guard mechanism (`RolesGuard`, `@Roles(...)`) | **EXISTS → reused as-is** | `apps/api/src/auth/guards/roles.guard.ts:24-37`, `apps/api/src/auth/decorators/roles.decorator.ts` — plan makes zero changes to either file. |
| `IInvoiceService`, `INVOICE_SERVICE_TOKEN` | **EXISTS → untouched** | `invoicing.controller.ts` constructor (lines 153-160) — plan does not touch the service layer. |
| `CustomerProjectionRepositoryPort`, `CUSTOMER_PROJECTION_REPOSITORY_TOKEN` | **EXISTS → untouched** | `customers.controller.ts:22-25, 38-39`. |
| `IShipmentQueryService` + 5 sibling shipment services/tokens | **EXISTS → untouched** | `shipment.controller.ts:90-105`. |
| `IPickupPointLookupService`, `PICKUP_POINT_LOOKUP_SERVICE_TOKEN` | **EXISTS → untouched** | `pickup-point.controller.ts:23-28, 46-47`. |
| `write-guard-coverage.spec.ts` invariant + its `CONTROLLERS` array | **EXISTS → extended, not reinvented** | Confirmed current array ends at `PickupPointController` (line 57); plan appends `InvoicingController` after it, matching the file's own documented extension protocol verbatim. |
| `viewer-role-authz.int-spec.ts` / `operator-role-authz.int-spec.ts` + their `seeds()` helper | **EXISTS → extended, not reinvented** | Confirmed both files and the `loginAsAdmin`/`loginAsOperator`/`loginAsViewer` helpers (`apps/api/test/integration/helpers/test-auth.helper.ts`) are live and match the plan's assumed shape exactly. |
| `PermissionValues` / `ROLE_PERMISSIONS` (backend) | **EXISTS → extended, not reinvented** | `libs/core/src/users/domain/types/role.types.ts:30-48` — confirmed the 3 proposed strings (`customers:read`, `shipments:read`, `invoices:read`) are genuinely absent today; no collision. |
| A dedicated `ADR` for this change | **Correctly identified as NOT NEW / not needed** | Plan's own Assumption 4 — verified reasonable; this is a mechanical repeat of #1124/#1126's already-adopted pattern, no new architectural decision. |

No `*Port`, `*Service`, `*.tokens.ts`, `*.orm-entity.ts`, or `CoreCapabilityValues` entry is proposed as new anywhere in the plan — confirmed correct; there is nothing to flag as a missed-reuse opportunity because the plan's whole premise (guard-decorator relocation) requires no new component.

---

## Backward-Compatibility Findings

### 🔴 Critical — Plan will break an existing, passing integration test

**Surface**: Integration test contract (not in the plan's Phase-3/9 test-update list).

**File**: `apps/api/test/integration/invoicing/invoicing-upo-download.int-spec.ts:191-206`

```typescript
it('should 403 for a non-admin caller', async () => {
  // ...
  const viewerToken = await loginAsViewer(harness);
  await http
    .get(`/v1/invoices/${record.id}/upo`)
    .set('Authorization', `Bearer ${viewerToken}`)
    .expect(403);
});
```

This test — shipped under #1224 — explicitly logs in as `viewer` and asserts `403` on `GET /v1/invoices/:invoiceId/upo`. The plan's Phase 1 Step 1 explicitly and intentionally leaves this exact endpoint (`invoicing.controller.ts:902`) with **no** `@Roles`, opening it to `viewer` per the plan's own Assumption 1 (full read access, no PII masking, includes the UPO/`content`/`document` endpoints). Once Step 1 lands, this existing test will fail — `viewer` will get `200`, not `403`.

The plan's own doc-comment/scope statement in Section 2 explicitly names `content`/`document`/`upo` as endpoints being opened to `viewer` with no masking, so the *intent* is unambiguous and correct — the plan simply never located this pre-existing negative test that codifies the opposite behavior, because it predates #1357 and wasn't part of the two `*-role-authz.int-spec.ts` files the plan's research phase focused on.

**Suggested migration path**: Add a step to Phase 3 — update `invoicing-upo-download.int-spec.ts:191-206` to reflect the new intended behavior. Two reasonable options:
- Rename/repurpose the test to assert `200` for a viewer caller (moves the "non-admin gets read access" assertion in-file, next to the file's own UPO-specific fixtures), **or**
- Delete the case entirely and let the new `GET /invoices` / UPO-adjacent case already planned for `viewer-role-authz.int-spec.ts` (Phase 3 Step 1) cover the read-access assertion, with a one-line comment in the UPO file noting the removal and pointing to where the coverage moved.
Either way, this file cannot be left as-is — it will fail CI the moment Phase 1 Step 1 ships.

**Also check while touching this file**: `shipments-read.int-spec.ts` and `invoicing-list.int-spec.ts` were grepped for the same pattern — both only use `loginAsAdmin` today, no `viewer`/`operator` assertions exist there, so no conflicting expectation to fix in those two files. No `customers-*.int-spec.ts` file exists at all yet. `pickup-point-cache.int-spec.ts` has no role assertions either. The UPO-download spec is the **only** pre-existing test file that codifies a behavior this plan reverses.

---

### 🔴 Critical (build-breaking, `check:invariants`/lint row) — Plan's Step 4 omits an unused-import removal that will fail `pnpm lint`

**Surface**: `check:invariants` / ESLint `@typescript-eslint/no-unused-vars: error` (per `docs/engineering-standards.md` ESLint config, ` "no-unused-vars": ["error", ...]`).

**File**: `apps/api/src/shipping/http/pickup-point.controller.ts:34` (`import { Roles } from '../../auth/decorators/roles.decorator';`)

`PickupPointController` has exactly one `@Roles(...)` usage in the entire file — the class-level decorator at line 38 that Plan Step 4 removes. Unlike `ShipmentController` (which keeps 5 method-level `@Roles` usages after its class-level decorator is removed) or `InvoicingController` (which gains 4 new method-level usages), `PickupPointController` has **zero** remaining `@Roles` usages after Step 4. The plan's own Step 2 (`CustomersController`) correctly anticipates this exact situation and explicitly calls for removing the now-unused `Roles` import — but Step 4 (`PickupPointController`), which is in the identical situation, does not mention it. Left as written, Step 4 alone produces a file that fails `pnpm lint` immediately.

**Suggested migration path**: Add one line to Plan Step 4, mirroring Step 2's language verbatim: *"Remove the now-unused `Roles` import (line 34) — confirm via `grep -n '@Roles' apps/api/src/shipping/http/pickup-point.controller.ts` returning zero matches before deleting it."*

---

### 🟡 Warning — Frontend `Permission` union mirror not updated

**Surface**: Cross-package (not cross-context — this is BE→FE, a separate TypeScript project) type contract, explicitly self-documented as a manual-sync obligation.

**File**: `apps/web/src/shared/auth/session.types.ts:1-24`

```typescript
/**
 * Permission strings granted to a user. Mirrors the backend's
 * `PermissionValues` from `@openlinker/core/users` — keep the two in sync
 * when adding new resource actions.
 */
export const PermissionValues = [
  'connections:read', /* ...17 entries, identical to backend today... */
] as const;
export type Permission = (typeof PermissionValues)[number];
```

This is a hand-maintained, exact mirror of the backend array the plan's Phase 2 edits — its own doc-comment instructs future editors to keep the two in sync. The plan's Phase 2 (backend `PermissionValues`/`ROLE_PERMISSIONS`) does not include a corresponding edit to this FE file.

**Impact assessment — confirmed not a hard build break today**: `apps/web/src/shared/auth/use-permission.ts` types its parameter as `permission: Permission` (the FE's own narrow union), not `string`. No current FE call site (`ConnectionActionsPanel.tsx`, `connections-list-page.tsx`, `orders-list-page.tsx`, `sync-job-detail-page.tsx`, `listings-list-page.tsx`) references `'customers:read'`, `'shipments:read'`, or `'invoices:read'`, so `pnpm --filter @openlinker/web type-check` will not fail as a direct result of this plan. There is also no automated script enforcing FE/BE permission-list parity (confirmed: `grep -rl "PermissionValues" scripts/` returns nothing) — so this drift is silent, not CI-caught.

**Why it's still worth flagging now rather than deferring**: the entire point of #1357 is to make `viewer` able to see Customers/Shipments/Invoices pages. The natural next step for whoever builds on top of this — e.g. gating a future "Export invoices" button, or reusing `usePermission` to conditionally render a Customers action — will hit a compile error the moment they type `usePermission('invoices:read')`, until someone remembers to update this file. Doing it in the same PR is a 3-line addition and keeps the two lists honestly in sync per the file's own stated contract, rather than leaving a known, self-documented gap for the next person to rediscover.

**Suggested migration path**: Add a step to Phase 2 — mirror the same 3 additions (`'customers:read'`, `'shipments:read'`, `'invoices:read'`) into `apps/web/src/shared/auth/session.types.ts`'s `PermissionValues` array. No `usePermission(...)` call sites need to change (none exist for these 3 strings yet); this is purely keeping the two literal-union declarations honest with each other.

---

## Open Questions

None that block implementation. All three findings above have a concrete, small suggested fix; none require a design decision beyond what the plan's Assumptions section already resolved (full read access, no masking, test/demo data).

---

## Summary for the plan author

Fold in three small additions before starting Phase 1: (1) add a Phase-3 step to fix or repurpose the pre-existing `should 403 for a non-admin caller` test in `invoicing-upo-download.int-spec.ts:191-206`, which will otherwise fail the moment the UPO endpoint opens to viewer; (2) add the missing "remove the now-unused `Roles` import" instruction to Step 4 (`pickup-point.controller.ts`), matching what Step 2 already correctly does for `CustomersController` — otherwise `pnpm lint` fails immediately; (3) mirror the 3 new permission strings into `apps/web/src/shared/auth/session.types.ts`'s `PermissionValues` for FE/BE parity, per that file's own doc-comment. None of these require new design decisions — the plan's core approach (remove class-level `@Roles`, re-add per-method on writes, mirroring #1124/#1126 exactly) is sound and introduces no new components, no reinvented ports/services/tokens, and no cross-context boundary issue.
