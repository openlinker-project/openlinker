# Implementation Plan: Viewer Read Access — Invoicing, Customers, Shipments, Webhook Deliveries, Cursors

**Date**: 2026-07-06
**Status**: Ready for Review — revised per `/pre-implement` gate; scope extended post-implementation to Webhook Deliveries + Cursors
**Estimated Effort**: 3-4 hours
**Issue**: [#1357](https://github.com/openlinker-project/openlinker/issues/1357)

**Revision note**: this plan was run through `/pre-implement` (see `docs/plans/analysis/ANALYSIS-1357-viewer-read-access-invoicing-customers-shipments.md`, verdict `NEEDS-REVISION`) and updated to fold in its 3 findings before implementation: (1) Phase 3 Step 1 now fixes a pre-existing integration test that otherwise breaks, (2) Phase 1 Step 4 now removes the now-unused `Roles` import in `pickup-point.controller.ts`, (3) Phase 2 Step 2 now mirrors the new permission strings into the frontend's `Permission` union.

**Scope extension (same session, post-implementation)**: `WebhookDeliveryController` and `CursorsController` were audited on the same "was this ever individually reviewed, or just bundled into 'administrative surfaces'?" question that motivated #1357, found to have the identical unjustified-bundling pattern (see Phase 1C below), and folded into this same plan/branch/issue rather than filed as a separate issue, since the reasoning and the pattern are identical.

---

## 1. Task Summary

**Objective**: Remove the blanket, class-level `@Roles(...)` decorators on `InvoicingController`, `CustomersController`, `ShipmentController`, `PickupPointController`, `WebhookDeliveryController`, and `CursorsController` so that the `viewer` role can read data on all six controllers, while write endpoints stay exactly as restricted as they are today (admin-only for invoicing/customers; admin-or-operator for shipments/pickup-points; webhook-deliveries and cursors have no write endpoints at all).

**Context**: `#1124` ("read-only role hardening") and `#1126` ("operator role") already converted 13 other controllers from "deny-by-default" (a single class-level `@Roles('admin')` blocking every endpoint) to "read-open, write-gated" (no `@Roles` on `GET` handlers, per-method `@Roles(...)` on write handlers). Invoicing, Customers, Shipping, Webhook Deliveries, and Cursors were never touched by either initiative — they still block `viewer` from plain reads (`GET /invoices`, `GET /customers`, `GET /shipments`, `GET /webhook-deliveries`, `GET /cursors`) that are no more sensitive than data `viewer` can already read elsewhere (`GET /orders`, `GET /sync/jobs`). Current environment data is test/demo data, so no field-level PII masking is required as part of this change (see [Questions & Assumptions](#5-questions--assumptions)).

**Classification**: Interface (HTTP controllers, `apps/api/src/{invoicing,customers,shipping,webhooks,cursors}/http/`) + Domain type (`libs/core/src/users/domain/types/role.types.ts`) + Testing (integration + unit).

---

## 2. Scope & Non-Goals

### In Scope
- `apps/api/src/invoicing/http/invoicing.controller.ts` — remove class-level `@Roles('admin')`; add it back per-method on the 4 write endpoints.
- `apps/api/src/customers/http/customers.controller.ts` — remove class-level `@Roles('admin')` (no write endpoints exist, so nothing to re-add).
- `apps/api/src/shipping/http/shipment.controller.ts` — remove class-level `@Roles('admin', 'operator')` (all 5 write endpoints already carry their own per-method `@Roles('admin', 'operator')`, so no re-add needed).
- `apps/api/src/shipping/http/pickup-point.controller.ts` — remove class-level `@Roles('admin', 'operator')` (no write endpoints exist).
- `apps/api/src/auth/write-guard-coverage.spec.ts` — add `InvoicingController` to the invariant's `CONTROLLERS` array (it now has write endpoints protected only by per-method decorators, matching the file's own stated extension criterion).
- `libs/core/src/users/domain/types/role.types.ts` — add `customers:read`, `shipments:read`, `invoices:read` to `PermissionValues` and to both `operator` and `viewer` in `ROLE_PERMISSIONS`, for parity with every other domain that went through the read-open pattern.
- `apps/web/src/shared/auth/session.types.ts` — mirror the same three permission strings into the frontend's own `PermissionValues`/`Permission` union, per that file's own doc-comment obligating the two lists to stay in sync (added per `/pre-implement` ANALYSIS-1357 finding #3).
- Integration tests — extend `apps/api/test/integration/viewer-role-authz.int-spec.ts` and `apps/api/test/integration/operator-role-authz.int-spec.ts` with the new read/write assertions for all four controllers; fix the pre-existing `apps/api/test/integration/invoicing/invoicing-upo-download.int-spec.ts` case that currently asserts the opposite of this plan's intended behavior (added per ANALYSIS-1357 finding #1).
- Doc-comment updates on the 4 controller files reflecting the new per-method posture (the invoicing and pickup-point files currently have doc-comments that explicitly describe the old class-level-only pattern).
- `apps/api/src/webhooks/http/webhook-delivery.controller.ts` — remove class-level `@Roles('admin')` (no write endpoints; the controller is `GET`-only).
- `apps/api/src/cursors/http/cursors.controller.ts` — remove class-level `@Roles('admin')` (no write endpoints; `GET`-only).
- `libs/core/src/users/domain/types/role.types.ts` / `apps/web/src/shared/auth/session.types.ts` — add `webhooks:read` to `PermissionValues` and to both `operator`/`viewer` in `ROLE_PERMISSIONS` (backend + frontend mirror). No new permission added for cursors — the existing `sync:read` (already granted to `operator`/`viewer`) already conceptually covers it, and `SyncController`'s own `GET` endpoints in the same domain are already guard-less.

### Out of Scope
- Any frontend change. `apps/web/src/app/nav-registry.ts` already lists `Customers`, `Shipments`, `Invoices` in the `Operations` group with no `requiresRole` gate — every authenticated role already sees these nav entries and can load these routes/pages. The only reason `viewer` currently sees a broken/empty experience is the backend 403 this plan removes.
- Field-level PII masking or redaction (e.g. hiding customer/shipping addresses, or the invoicing `content`/`document`/`upo` document bytes) for `viewer`. Explicitly deferred — see Assumptions.
- The separate "show role-restricted nav items grayed-out instead of hidden" UX improvement (e.g. for `Users`/`AI`). Tracked as a distinct future issue, not part of #1357.
- Any change to `CustomersController`'s or `ShipmentController`'s actual query/service logic — this plan only touches the guard decorator layer.

### Constraints
- Must not weaken any existing write-path restriction: `viewer` must remain blocked (403) on every write endpoint across all four controllers; `operator` must remain blocked on invoicing writes (admin-only) while keeping full access to shipment/pickup-point writes (unchanged from today).
- Must follow the exact pattern already shipped by #1124/#1126 — no new guard mechanism, no new decorator, no new middleware.
- `pnpm lint && pnpm type-check && pnpm test` must stay green; `pnpm test:integration` must stay green (Docker required locally to run it).

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/api/src/{invoicing,customers,shipping}/http/*.controller.ts`) + Domain type definitions (`libs/core/src/users/domain/types/role.types.ts`, no domain *entity* or *port* changes).

**Capabilities Involved**: None — this is purely an authorization-guard change at the interface layer. No `*Port` interfaces are touched; `InvoicingController`, `CustomersController`, `ShipmentController`, `PickupPointController` keep depending on exactly the same service interfaces they do today (`IInvoiceService`, `CustomerProjectionRepositoryPort`, `IShipmentQueryService`, etc.).

**Existing Services Reused**: `RolesGuard` (`apps/api/src/auth/guards/roles.guard.ts`) and the `@Roles(...)` decorator (`apps/api/src/auth/decorators/roles.decorator.ts`) — both already exist and are globally wired as `APP_GUARD`s in `apps/api/src/auth/auth.module.ts`. No guard code changes at all; this plan only changes *which* methods carry the `@Roles(...)` metadata.

**New Components Required**: None. This plan adds three permission string literals to an existing `as const` array and extends two existing integration-test files — no new files, classes, ports, or services.

**Core vs Integration Justification**: This is not a CORE-vs-Integration boundary question — `RolesGuard` is `apps/api`-only interface-layer infrastructure (auth is not a marketplace/shop capability port), and the permission-string addition lives in `libs/core/src/users` only because that's where `UserRole`/`Permission` are already defined (pre-existing pattern, not a new cross-context dependency). No adapter, no port, no `libs/integrations/**` package is touched.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### External System
Not applicable — no external system integration in this change.

### Internal Patterns

**Similar implementations found** (the direct precedent for every step in this plan):
- `docs/plans/implementation-plan-1124-read-only-role-hardening.md` — the original "remove class-level `@Roles('admin')`, re-add per-method on writes" migration for `OrdersController`, `ProductsController`, `InventoryController`, `ListingsController`, `SyncController`, etc.
- `docs/plans/implementation-plan-1126-operator-role.md` — the follow-up that introduced the `operator` role and applied `@Roles('admin', 'operator')` to `ShipmentController`/`PickupPointController` (this is *why* those two controllers already have class-level `'operator'` access but not `viewer` — #1126 explicitly deferred viewer shipment access as future scope, and this plan is that future scope).
- `apps/api/src/auth/write-guard-coverage.spec.ts` — the invariant test that must keep passing (and be extended) throughout.
- `apps/api/test/integration/viewer-role-authz.int-spec.ts` and `apps/api/test/integration/operator-role-authz.int-spec.ts` — the exact integration-test shape to extend, including the `seeds()` helper and `loginAsAdmin` / `loginAsViewer` / `loginAsOperator` from `apps/api/test/integration/helpers/test-auth.helper.ts`.

**Reusable components identified**: `RolesGuard`, `@Roles(...)` decorator, `loginAs{Admin,Operator,Viewer}` test helpers — all reused as-is, zero modification needed to any of them.

---

## 5. Questions & Assumptions

### Open Questions
None — the user (issue author/reporter) explicitly resolved the one open question from the original research phase: whether `viewer` should get full read access to addresses/PII in Customers and Shipments, or a masked/metadata-only view. Resolution below.

### Assumptions
1. **Current environment data is test/demo data**, so no field-level PII masking is required for `Customers`, `Shipments`, or the invoicing `content`/`document`/`upo` endpoints — `viewer` gets the same full response body `admin`/`operator` get today on all `GET` endpoints of these four controllers. This is an explicit user decision (not a default the plan is guessing at) — if real production customer data is introduced later, masking would need its own follow-up issue, mirroring the precedent `ConnectionResponseDto.fromDomain(..., role)` redaction pattern from #1124 Phase 2.
2. **No frontend changes needed.** Verified: `apps/web/src/app/nav-registry.ts`'s `Operations` group entries for `Customers` (`nav-registry.ts:37`), `Shipments` (`:39`), `Invoices` (`:40`) carry no `requiresRole`, and the corresponding routes (`apps/web/src/app/routes/{customers,shipments,invoices}.route.tsx`) are already wired into `root.route.tsx` unconditionally.
3. **`CustomersController` and `PickupPointController` have no write endpoints today** (confirmed by grep — only `@Get()` handlers exist in both files), so removing their class-level `@Roles(...)` fully opens them with no per-method re-add needed. If a write endpoint is ever added to either controller in the future, it must carry its own `@Roles('admin')` (Customers) or `@Roles('admin', 'operator')` (PickupPoint) — this is exactly the gap `write-guard-coverage.spec.ts` exists to catch, though today neither controller is in that invariant's `CONTROLLERS` array (see Step 1.4 for the one that needs adding now — `InvoicingController` — and why the other three don't need to be added yet).
4. **This does not warrant an ADR.** Per `docs/architecture/adrs/README.md` § When to write an ADR, this change reuses an already-adopted, already-documented pattern (#1124/#1126) verbatim on three more controllers — it introduces no new mechanism, no new trade-off, and no cross-context/plugin-contract decision. An ADR would be redundant with the ADR that (if any) already covers #1124/#1126's original pattern choice.

### Documentation Gaps
- `apps/api/src/shipping/http/pickup-point.controller.ts:8` — the file's own doc-comment says "Admin + JWT," which was already stale before this plan (the controller has actually been `@Roles('admin', 'operator')` since #1126). This plan corrects it while it's already touching the decorator line.

---

## 6. Proposed Implementation Plan

### Phase 1 — Backend: Remove class-level guards, re-add per-method where needed

**Goal**: `viewer` passes `RolesGuard` on every `GET` handler of the four controllers; every write handler keeps exactly its current effective restriction.

**Steps**:

1. **`InvoicingController` — split class-level guard into per-method write guards**
   - **File**: `apps/api/src/invoicing/http/invoicing.controller.ts`
   - **Action**:
     - Remove `@Roles('admin')` from line 146 (directly above `@ApiBearerAuth()` / `@ApiTags('invoicing')` / `@Controller()`).
     - Add `@Roles('admin')` immediately above each of the 4 write handlers:
       - `POST connections/:connectionId/bank-accounts/:accountId/default` (currently `@Post(...)` at line 196)
       - `POST invoices` (line 260)
       - `POST invoices/retry` (line 348)
       - `POST invoices/:invoiceId/correct` (line 459)
     - Leave every `GET` handler untouched (no `@Roles` added): `GET connections/:connectionId/bank-accounts` (162), `GET orders/:orderId/invoice` (545), `GET invoices` (583), `GET invoices/:invoiceId/content` (807), `GET invoices/:invoiceId/document` (832), `GET invoices/:invoiceId/upo` (902), `GET invoices/:invoiceId` (954).
     - Update the class doc-comment (lines 25-27), which currently reads:
       ```
       Guards are GLOBAL (auth.module APP_GUARD = JwtAuthGuard then RolesGuard), so
       we declare only `@Roles('admin')` + `@ApiBearerAuth()` — never a redundant
       `@UseGuards(JwtAuthGuard)`.
       ```
       to describe the new per-method split, e.g.:
       ```
       Guards are GLOBAL (auth.module APP_GUARD = JwtAuthGuard then RolesGuard), so
       we never declare a redundant `@UseGuards(JwtAuthGuard)`. Reads carry no
       `@Roles` (open to any authenticated role, including viewer); writes carry
       their own `@Roles('admin')` (#1357, mirroring the #1124 read-open/write-gated
       pattern).
       ```
   - **Acceptance**: `pnpm --filter @openlinker/api build` (or `tsc --noEmit` via `pnpm type-check`) succeeds; `grep -n "@Roles" apps/api/src/invoicing/http/invoicing.controller.ts` shows exactly 4 occurrences, each directly above a `@Post(...)` line.
   - **Dependencies**: None.

2. **`CustomersController` — remove class-level guard, no re-add**
   - **File**: `apps/api/src/customers/http/customers.controller.ts`
   - **Action**: Remove `@Roles('admin')` from line 32. Remove the now-unused `Roles` import (line 21, `import { Roles } from '../../auth/decorators/roles.decorator';`) since no method needs it after this change — confirm via `grep -n "@Roles" apps/api/src/customers/http/customers.controller.ts` returning zero matches before deleting the import (ESLint's `no-unused-vars` will fail the build otherwise, per the strict TypeScript config in `docs/engineering-standards.md`).
   - **Acceptance**: Both `GET /customers` and `GET /customers/:id` compile and run without any `@Roles` decorator anywhere in the file; `pnpm lint` passes (no unused-import warning).
   - **Dependencies**: None.

3. **`ShipmentController` — remove class-level guard, per-method guards already present on writes**
   - **File**: `apps/api/src/shipping/http/shipment.controller.ts`
   - **Action**: Remove `@Roles('admin', 'operator')` from line 83 only. Do **not** touch the 5 existing per-method `@Roles('admin', 'operator')` decorators already on the write handlers (lines 195, 231, 265, 296, 313 — `generate-label`, `bulk/generate-labels`, `bulk/protocol`, `:id/cancel`, `:id/notify-dispatched`). After this change, the 4 `GET` handlers (`list` at 107, `getActive` at 138, `:id` at 154, `:id/label` at 166) have no `@Roles` and are open to all three roles; the 5 write handlers keep exactly the same effective restriction (`admin`/`operator` only) they have today, since their guards were already per-method (the class-level decorator was redundant on those 5 handlers, not load-bearing).
   - **Acceptance**: `grep -n "@Roles" apps/api/src/shipping/http/shipment.controller.ts` shows exactly 5 occurrences, all directly above `@Post(...)` lines, none above the class or above any `@Get(...)`.
   - **Dependencies**: None.

4. **`PickupPointController` — remove class-level guard, no re-add, fix stale doc-comment**
   - **File**: `apps/api/src/shipping/http/pickup-point.controller.ts`
   - **Action**: Remove `@Roles('admin', 'operator')` from line 38. **Remove the now-unused `Roles` import too** (line 34, `import { Roles } from '../../auth/decorators/roles.decorator';`) — `PickupPointController` has zero write endpoints, so unlike `ShipmentController` (which keeps 5 method-level `@Roles` usages) this file has no remaining `@Roles` usage after the class-level decorator is gone; leaving the import in place fails `pnpm lint`'s `@typescript-eslint/no-unused-vars: error` immediately (caught during `/pre-implement`, ANALYSIS-1357 finding #2 — mirrors the same unused-import cleanup Step 2 already does for `CustomersController`). Update the stale doc-comment at line 8 (`"Admin + JWT."`) to `"Any authenticated role + JWT (#1357)."` or remove the clause entirely since it's no longer accurate and the file has no other role-related prose to update around it.
   - **Acceptance**: `grep -n "@Roles\|Roles" apps/api/src/shipping/http/pickup-point.controller.ts` returns zero matches (neither the decorator nor the import survives); both `GET /pickup-points` and `GET /pickup-points/:providerId` compile and run with no guard decorator; `pnpm lint` passes with no unused-import error.
   - **Dependencies**: None.

5. **`write-guard-coverage.spec.ts` — extend the invariant to cover Invoicing's writes**
   - **File**: `apps/api/src/auth/write-guard-coverage.spec.ts`
   - **Action**: Add `import { InvoicingController } from '../invoicing/http/invoicing.controller';` to the import block, and add `InvoicingController` to the `CONTROLLERS` array (currently ends with `PickupPointController` — append after it). This is exactly the extension the file's own header comment prescribes: *"When a new controller with write endpoints is added to the API, extend CONTROLLERS here."* `InvoicingController` now has write endpoints guarded only by per-method decorators (Step 1 above), which is precisely the class of regression this invariant exists to catch. `CustomersController` and `PickupPointController` are **not** added — they have zero write endpoints today, so the invariant's `WRITE_METHODS` filter would iterate zero handlers for them (harmless but adds no coverage); `ShipmentController` and `PickupPointController` are already in the array from #1126 and need no changes beyond the import already being present.
   - **Acceptance**: `pnpm test write-guard-coverage.spec.ts` passes, including a new `InvoicingController: every write handler carries @Roles` test case with zero `unguarded` entries.
   - **Dependencies**: Step 1 (Invoicing's write handlers must already carry `@Roles('admin')` before this test can pass).

**New Components**: None — this phase only edits decorator placement and one test-file import/array entry across 5 existing files.

**Configuration Changes**: None.

**Database Migrations**: None — no schema, entity, or ORM change anywhere in this plan.

**Events**: None emitted or consumed.

**Error Handling**: Unchanged — `RolesGuard` already throws `ForbiddenException('Insufficient permissions')` (`apps/api/src/auth/guards/roles.guard.ts:24-37`) on a role mismatch; this plan changes only which methods are subject to that check, not the exception itself.

---

### Phase 1C — Backend: Webhook Deliveries + Cursors (scope extension)

**Goal**: Apply the identical "remove class-level `@Roles('admin')`, no write endpoints exist so nothing to re-add" pattern (already used for `CustomersController`/`PickupPointController`) to two more controllers found to have the same unjustified-bundling issue.

**Why these two, and why now**: both were audited against the question "was this ever individually reviewed for what its DTOs actually expose, or just bundled into an 'administrative surfaces' list?" — the same question #1357 asked of Invoicing/Customers/Shipments. Findings:
- `WebhookDeliveryController` (`apps/api/src/webhooks/http/webhook-delivery.controller.ts`) is 100% read-only (`list()` + `getById()`, no writes). Its DTOs (`WebhookDeliverySummaryResponseDto`, `WebhookDeliveryDetailResponseDto`) carry zero connection credentials/config/secrets and no raw signature/HMAC value — only metadata (`eventId`, `provider`, `connectionId` as an opaque UUID, `signatureValid: boolean`, dedup/status fields) plus, on the detail endpoint only, an intentionally-minimal `payload` (by architectural design, "webhook payload is not source of truth" — a pull-sync hint, not a full record).
- `CursorsController` (`apps/api/src/cursors/http/cursors.controller.ts`) is also 100% read-only. Its `value` field is an opaque adapter-defined position marker (event ID / timestamp / scan offset — e.g. `allegro.offers.lastEventId`), never credential-derived, never a raw DB primary key. Cursors are conceptually part of "sync" (`sync:read`, already granted to `operator`/`viewer`), and `SyncController`'s own `GET /sync/jobs*` endpoints in the same domain are already guard-less (open to all roles) and expose more (`payloadJson`, `lastError`) than a bare cursor string — so gating cursors while leaving sync jobs open was already an internal inconsistency.
- Both were bundled into `docs/plans/implementation-plan-1126-operator-role.md`'s "Endpoints that REMAIN `@Roles('admin')` only" list (lines 141-142) with a single unexplained bullet each — no controller-specific review, unlike e.g. `ShipmentController`/`PickupPointController` just above which got an explicit one-sentence rationale.

**Steps**:

1. **`WebhookDeliveryController` — remove class-level guard, no re-add**
   - **File**: `apps/api/src/webhooks/http/webhook-delivery.controller.ts`
   - **Action**: Remove `@Roles('admin')` (class-level) and the now-unused `Roles` import — no write endpoints exist, so nothing to re-add per-method (identical shape to `CustomersController`, Phase 1 Step 2).
   - **Acceptance**: `grep -n "@Roles\|Roles" apps/api/src/webhooks/http/webhook-delivery.controller.ts` returns zero matches; `GET /webhook-deliveries` and `GET /webhook-deliveries/:id` compile and run with no guard decorator; `pnpm lint` passes.
   - **Dependencies**: None.

2. **`CursorsController` — remove class-level guard, no re-add**
   - **File**: `apps/api/src/cursors/http/cursors.controller.ts`
   - **Action**: Remove `@Roles('admin')` (class-level) and the now-unused `Roles` import — no write endpoints exist.
   - **Acceptance**: `grep -n "@Roles\|Roles" apps/api/src/cursors/http/cursors.controller.ts` returns zero matches; `GET /cursors` and `GET /cursors/:connectionId/:cursorKey` compile and run with no guard decorator; `pnpm lint` passes.
   - **Dependencies**: None.

3. **Add `webhooks:read` permission (backend + frontend mirror)**
   - **Files**: `libs/core/src/users/domain/types/role.types.ts`, `apps/web/src/shared/auth/session.types.ts`
   - **Action**: Add `'webhooks:read'` to `PermissionValues` (both files) and to `ROLE_PERMISSIONS.operator` / `ROLE_PERMISSIONS.viewer` (backend only — the FE has no separate `ROLE_PERMISSIONS` map, only the `PermissionValues`/`Permission` union). No new permission is added for cursors — `sync:read` already covers it conceptually and is already granted to both roles.
   - **Acceptance**: Both files' `PermissionValues` contain `'webhooks:read'`; backend `ROLE_PERMISSIONS.viewer`/`.operator` contain it.
   - **Dependencies**: None.

4. **Integration tests — flip existing 403 assertions to 200, add viewer coverage**
   - **Files**: `apps/api/test/integration/viewer-role-authz.int-spec.ts`, `apps/api/test/integration/operator-role-authz.int-spec.ts`
   - **Action**: Add `GET /webhook-deliveries` and `GET /cursors` → `200` cases to `viewer-role-authz.int-spec.ts`'s "reads — viewer gets 200" block (viewer was never previously tested against these two endpoints at all — the old 403 was incidental, inherited from the class-level guard, never a deliberate assertion). In `operator-role-authz.int-spec.ts`, **move** the existing `GET /webhook-deliveries → 403` and `GET /cursors → 403` cases (previously in "administrative writes — operator gets 403") into the "operational writes — operator NOT blocked" block and flip their expectation to `200`; update the file's header doc-comment (which listed "webhook-deliveries, cursors, users" as the admin-only set) to reflect that only `users` remains in that bucket for this file.
   - **Acceptance**: `viewer-role-authz.int-spec.ts` and `operator-role-authz.int-spec.ts` both assert `200` on `GET /webhook-deliveries` and `GET /cursors` for their respective role; no stale `403` assertion remains for either endpoint against `viewer` or `operator`.
   - **Dependencies**: Steps 1-2 (endpoints must already be open before these assertions can pass).

**New Components**: None — same shape as Phase 1: decorator removal + permission-string addition + test updates across existing files.

**Note — not added to `write-guard-coverage.spec.ts`**: neither controller has a write endpoint, so (consistent with `CustomersController`/`PickupPointController` in Phase 1) they are not added to that invariant's `CONTROLLERS` array — there are zero write handlers for it to check.

---

### Phase 2 — Backend: Permission map parity

**Goal**: Keep `libs/core/src/users/domain/types/role.types.ts`'s `PermissionValues`/`ROLE_PERMISSIONS` map consistent with the new read-open surface, mirroring every other domain that already went through #1124/#1126.

**Steps**:

1. **Add three new permission strings**
   - **File**: `libs/core/src/users/domain/types/role.types.ts`
   - **Action**: Add `'customers:read'`, `'shipments:read'`, `'invoices:read'` to the `PermissionValues` array (currently lines 30-48, ending with `'users:read'`/`'users:write'`). No `*:write` counterparts are added for `customers`/`shipments`/`invoices` in this plan — `shipments:write` would need to mirror the existing admin/operator write-gating already in place, but that's not part of this scope (writes are unaffected by #1357; only reads are being opened, and the permission map's own doc-comment already states it's a **display hint for the FE**, not a backend enforcement mechanism — see line 59-62 of the file).
   - Add `'customers:read'`, `'shipments:read'`, `'invoices:read'` to `ROLE_PERMISSIONS.operator` (lines 66-78) and to `ROLE_PERMISSIONS.viewer` (lines 79-88). `ROLE_PERMISSIONS.admin` needs no edit — it's defined as `PermissionValues` directly (line 65), so it picks up the three new strings automatically.
   - **Acceptance**: `ROLE_PERMISSIONS.viewer` and `ROLE_PERMISSIONS.operator` both contain all three new strings; `ROLE_PERMISSIONS.admin` equals `PermissionValues` (already asserted by the existing `role.types.spec.ts` "admin › should have all permissions" test — see Phase 3).
   - **Dependencies**: None — independent of Phase 1's decorator changes (the permission map is a separate FE-display-hint mechanism, not what `RolesGuard` reads).

2. **Mirror the same three strings into the frontend's `Permission` union**
   - **File**: `apps/web/src/shared/auth/session.types.ts`
   - **Action**: Add `'customers:read'`, `'shipments:read'`, `'invoices:read'` to the `PermissionValues` array (lines ~8-24, currently ending with `'users:read'`/`'users:write'`). This file's own doc-comment states it "Mirrors the backend's `PermissionValues` from `@openlinker/core/users` — keep the two in sync when adding new resource actions" (ANALYSIS-1357 finding #3). `apps/web/src/shared/auth/use-permission.ts` types `usePermission(permission: Permission)` against this exact union (not a bare `string`), so any future FE code gating a Customers/Shipments/Invoices affordance on one of these permissions would hit a compile error until this mirror exists. No `usePermission(...)` call site references these three strings today, so this step does not change any current FE behavior — it only keeps the two literal unions honest with each other, per the file's own stated contract.
   - **Acceptance**: `apps/web/src/shared/auth/session.types.ts`'s `PermissionValues` contains all three new strings, in the same order/position as the backend array; `pnpm --filter @openlinker/web type-check` passes (no call site needs updating).
   - **Dependencies**: None — purely additive to a literal-string array; safe to do independently of Phase 1.

**New Components**: None — three string literals added to three existing arrays (two backend, one frontend mirror).

---

### Phase 3 — Tests

**Goal**: Prove the guard changes work end-to-end for all three roles, and that nothing already-passing regresses.

**Steps**:

1. **Fix the pre-existing `invoicing-upo-download.int-spec.ts` test that this plan otherwise breaks**
   - **File**: `apps/api/test/integration/invoicing/invoicing-upo-download.int-spec.ts:191-206`
   - **Action**: This #1224-era test explicitly logs in as `viewer` and asserts `403` on `GET /v1/invoices/:invoiceId/upo`:
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
     Phase 1 Step 1 intentionally leaves `GET invoices/:invoiceId/upo` with no `@Roles`, opening it to `viewer` (per Assumption 1 — full read access, no masking, includes the UPO endpoint). Left unchanged, this test fails the moment Step 1 ships (ANALYSIS-1357 finding #1 — a confirmed regression the plan's original draft missed). Rename the test and flip its assertion to `200`, keeping the file's own fixture/adapter-stub setup (`installInvoicingAdapter`, `seedInvoiceRecord`) intact:
     ```typescript
     it('should 200 for a viewer caller (read access opened by #1357)', async () => {
       const http = harness.getHttp();
       const dataSource = harness.getDataSource();
       const connection = await createTestConnection(dataSource, {
         platformType: TEST_PLATFORM_TYPE,
         adapterKey: TEST_ADAPTER_KEY,
         enabledCapabilities: ['Invoicing'],
       });
       const record = await seedInvoiceRecord(dataSource, { connectionId: connection.id });
       const viewerToken = await loginAsViewer(harness);

       await http
         .get(`/v1/invoices/${record.id}/upo`)
         .set('Authorization', `Bearer ${viewerToken}`)
         .buffer(true)
         .parse((response, callback) => {
           const chunks: Buffer[] = [];
           response.on('data', (chunk: Buffer) => chunks.push(chunk));
           response.on('end', () => callback(null, Buffer.concat(chunks)));
         })
         .expect(200);
     });
     ```
     Also update the file's own header doc-comment (lines 12-14, "Covers: 200 ..., 403 for a non-admin caller") to drop the now-inaccurate "403 for a non-admin caller" clause.
   - **Acceptance**: `pnpm test:integration invoicing-upo-download.int-spec.ts` passes with the renamed/repurposed case asserting `200`; no test in the file still asserts `403` for a `viewer` token.
   - **Dependencies**: Phase 1 Step 1 (the endpoint must already be open before this assertion can pass).

2. **Extend `viewer-role-authz.int-spec.ts` — new "reads: viewer gets 200" cases**
   - **File**: `apps/api/test/integration/viewer-role-authz.int-spec.ts`
   - **Action**: Add to the `describe('reads — viewer gets 200', ...)` block (after the existing `GET /listings` case at line 94-100):
     ```typescript
     it('GET /customers', async () => {
       const { http, viewerToken } = await seeds();
       await http
         .get('/v1/customers')
         .set('Authorization', `Bearer ${viewerToken}`)
         .expect(200);
     });

     it('GET /shipments', async () => {
       const { http, viewerToken } = await seeds();
       await http
         .get('/v1/shipments')
         .set('Authorization', `Bearer ${viewerToken}`)
         .expect(200);
     });

     it('GET /pickup-points', async () => {
       const { http, viewerToken } = await seeds();
       const res = await http
         .get('/v1/pickup-points')
         .set('Authorization', `Bearer ${viewerToken}`);
       // No `connectionId`/`query` params seeded — assert the guard passes
       // (not 403), matching the operator-role-authz precedent for this same
       // endpoint (apps/api/test/integration/operator-role-authz.int-spec.ts:107-113).
       expect(res.status).not.toBe(403);
     });

     it('GET /invoices', async () => {
       const { http, viewerToken } = await seeds();
       await http
         .get('/v1/invoices')
         .set('Authorization', `Bearer ${viewerToken}`)
         .expect(200);
     });
     ```
   - **Acceptance**: All 4 new cases pass against a running Testcontainers harness.
   - **Dependencies**: Phase 1 Steps 1-4 must be merged first, or these assertions will fail with 403 (that's the point — this is the regression-proving test).

3. **Extend `viewer-role-authz.int-spec.ts` — new "writes: viewer gets 403" cases**
   - **File**: `apps/api/test/integration/viewer-role-authz.int-spec.ts`
   - **Action**: Add to the `describe('writes — viewer gets 403', ...)` block:
     ```typescript
     it('POST /invoices', async () => {
       const { http, viewerToken } = await seeds();
       await http
         .post('/v1/invoices')
         .set('Authorization', `Bearer ${viewerToken}`)
         .send({ orderId: 'fake-order-id' })
         .expect(403);
     });

     it('POST /invoices/retry', async () => {
       const { http, viewerToken } = await seeds();
       await http
         .post('/v1/invoices/retry')
         .set('Authorization', `Bearer ${viewerToken}`)
         .send({ invoiceIds: [] })
         .expect(403);
     });

     it('POST /shipments/generate-label', async () => {
       const { http, viewerToken } = await seeds();
       await http
         .post('/v1/shipments/generate-label')
         .set('Authorization', `Bearer ${viewerToken}`)
         .send({ orderId: 'fake-order-id' })
         .expect(403);
     });
     ```
     (`RolesGuard` fires before the handler body, so these 403s arrive even with a fake/nonexistent id — same pattern as every other case in this file, per its own header comment at lines 12-15.)
   - **Acceptance**: All 3 new cases pass; `viewer` remains fully blocked from every write path this plan does not intend to open.
   - **Dependencies**: Phase 1 Step 1 (Invoicing's per-method write guard) and Step 3 (Shipment's unchanged per-method write guard).

4. **Extend `operator-role-authz.int-spec.ts` — operator gets read access, stays blocked on invoicing writes**
   - **File**: `apps/api/test/integration/operator-role-authz.int-spec.ts`
   - **Action**: Add to `describe('operational writes — operator NOT blocked (guard passes)', ...)`:
     ```typescript
     it('GET /customers → 200 (operator has full customer-read access)', async () => {
       const { http, operatorToken } = await seeds();
       await http
         .get('/v1/customers')
         .set('Authorization', `Bearer ${operatorToken}`)
         .expect(200);
     });

     it('GET /invoices → 200 (operator has full invoice-read access)', async () => {
       const { http, operatorToken } = await seeds();
       await http
         .get('/v1/invoices')
         .set('Authorization', `Bearer ${operatorToken}`)
         .expect(200);
     });
     ```
     Add to `describe('administrative writes — operator gets 403', ...)`:
     ```typescript
     it('POST /invoices → 403 (invoicing writes remain admin-only)', async () => {
       const { http, operatorToken } = await seeds();
       await http
         .post('/v1/invoices')
         .set('Authorization', `Bearer ${operatorToken}`)
         .send({ orderId: 'fake-order-id' })
         .expect(403);
     });
     ```
   - **Acceptance**: `operator` reads Customers and Invoices successfully; `operator` remains blocked from issuing an invoice (that stays `admin`-only exactly as it is today — this plan does not change any write-side restriction).
   - **Dependencies**: Phase 1 Steps 1-2.

5. **Unit test — `write-guard-coverage.spec.ts` new `InvoicingController` case**
   - **File**: `apps/api/src/auth/write-guard-coverage.spec.ts` (edit from Phase 1 Step 5)
   - **Acceptance**: Covered by Phase 1 Step 5's own acceptance criterion — no separate new test file needed, the parameterized `for (const Controller of CONTROLLERS)` loop generates the case automatically once `InvoicingController` is in the array.

6. **Optional (non-blocking) — extend `role.types.spec.ts` assertions**
   - **File**: `libs/core/src/users/domain/types/role.types.spec.ts`
   - **Action**: Add (not required for the existing tests to keep passing, since they use `toContain`/`not.toContain`/subset checks rather than exhaustive equality — but adds direct coverage of Phase 2):
     ```typescript
     describe('viewer', () => {
       it('should contain customers:read, shipments:read, invoices:read', () => {
         expect(ROLE_PERMISSIONS.viewer).toContain('customers:read');
         expect(ROLE_PERMISSIONS.viewer).toContain('shipments:read');
         expect(ROLE_PERMISSIONS.viewer).toContain('invoices:read');
       });
     });
     ```
   - **Acceptance**: New assertions pass; no existing assertion in this file breaks (verified by reading the file — every existing check is `toContain`, `not.toContain`, subset-comparison, or `admin === PermissionValues`, none of which are broken by adding new entries to `PermissionValues`/`viewer`/`operator`).
   - **Dependencies**: Phase 2.

---

## 7. Alternatives Considered

### Alternative 1: Mask sensitive fields instead of opening full reads
- **Description**: Keep the class-level admin gate removed, but wrap `CustomerProjectionResponseDto`/`ShipmentResponseDto`/`InvoiceRecordResponseDto` in a role-aware factory (mirroring `ConnectionResponseDto.fromDomain(..., role)` from #1124 Phase 2) that redacts addresses/PII for non-admin roles.
- **Why Rejected**: The user explicitly decided current data is test/demo data and full read access is acceptable — masking would add DTO-factory complexity (new `role` parameter threaded through 3 controllers, `@CurrentUser()` injection into read handlers that don't need it today) for no present benefit, and would contradict the explicit "assumptions" resolution in this issue.
- **Trade-offs**: If real customer PII is introduced later, this alternative becomes the correct next step — but it's a distinct, separately-scoped follow-up, not part of #1357.

### Alternative 2: Grant viewer via a new dedicated `@Roles('admin', 'operator', 'viewer')` explicit list instead of removing the decorator
- **Description**: Instead of deleting `@Roles(...)` from `GET` handlers, explicitly list all three roles: `@Roles('admin', 'operator', 'viewer')`.
- **Why Rejected**: `RolesGuard`'s own documented behavior (and every #1124/#1126 precedent) is that *no* `@Roles` metadata means "any authenticated role passes" — explicitly listing all three roles is redundant, adds a maintenance burden (a 4th role added later would need every such list updated), and diverges from the established codebase convention that `write-guard-coverage.spec.ts` itself is built around (its whole premise is that reads carry no `@Roles`).
- **Trade-offs**: None meaningful — this alternative is strictly worse for maintainability with no offsetting benefit.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No hexagonal-layer violation — this plan touches only the `interfaces`/HTTP layer (`*.controller.ts`) and one domain `*.types.ts` file that already existed for this exact purpose. No domain entity, port, or application service is touched.
- **Reference**: [Architecture Overview](../architecture-overview.md)

### Naming Conventions
- ✅ No new files, classes, or symbols are introduced — only decorator placement changes and three new `UPPER_SNAKE_CASE`-adjacent `resource:action`-shaped string literals added to an existing `as const` array, matching the existing `'orders:read'`/`'products:read'` convention exactly.
- **Reference**: [Engineering Standards - Union Types: `as const` Pattern](../engineering-standards.md#union-types-as-const-pattern-default)

### Existing Patterns
- ✅ Verified against `docs/plans/implementation-plan-1124-read-only-role-hardening.md` and `implementation-plan-1126-operator-role.md` — this plan is a direct, mechanical repeat of their "remove class-level → re-add per-method on writes" pattern, applied to the 3 controllers those two initiatives didn't reach.

### Risks
- **Silent write-guard regression on `InvoicingController`**: if Step 1 is done carelessly (e.g. a write endpoint's `@Roles('admin')` is forgotten), the endpoint becomes open to `viewer`/`operator` with no automated signal — **mitigated** by Phase 1 Step 5 (adding `InvoicingController` to `write-guard-coverage.spec.ts`), which fails the build immediately if any write handler lacks `@Roles`.
- **`CustomersController`/`PickupPointController` gaining a write endpoint later with no guard**: since neither is added to `write-guard-coverage.spec.ts` in this plan (they have zero write endpoints today), a future PR that adds, say, `PATCH /customers/:id` with no `@Roles('admin')` would silently open a write path to `viewer`. **Mitigation**: flagged explicitly in Assumption 3 above; the fix (adding the controller to the invariant's array) is a one-line change whenever that future write endpoint is added — out of scope to pre-empt now since it doesn't exist yet.
- **Stale doc-comments elsewhere describing the old class-level-only pattern**: mitigated by updating the two doc-comments that explicitly describe the mechanism (Invoicing, PickupPoint) in the same PR.

### Edge Cases
- **`viewer` hitting a write endpoint with a malformed/missing body**: `RolesGuard` runs before any `@Body()` validation pipe, so the response is always `403`, never `400` — already the documented, tested behavior in both existing `*-role-authz.int-spec.ts` files, and this plan's new test cases follow the identical convention (send an intentionally-empty or fake-id body and assert `403`, never inspecting the body-validation error).
- **`PickupPointController`'s `GET /pickup-points` with no query params**: the handler itself may 400/422 on missing required query params (unrelated to the guard). The new viewer/operator integration-test cases assert `res.status).not.toBe(403)` rather than a hard `200`, exactly mirroring the existing operator-role-authz precedent for this same endpoint (`operator-role-authz.int-spec.ts:107-113`) — this correctly isolates "did the guard pass" from "did the handler validate the request."

### Backward Compatibility
- ✅ No breaking change to any existing `admin` or `operator` behavior — `admin` already passed every guard on all four controllers (no change), and `operator`'s existing shipment/pickup-point access is untouched (their per-method write guards are unchanged; only the now-redundant class-level copy is removed). `operator`'s invoicing/customers access strictly *increases* (reads open) with zero access removed anywhere.
- No API contract/response-shape change on any endpoint — same DTOs, same status codes for the roles that already had access.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `apps/api/src/auth/write-guard-coverage.spec.ts` — extended with `InvoicingController` (Phase 1 Step 5); asserts every non-`GET` handler carries `@Roles`.
- `libs/core/src/users/domain/types/role.types.spec.ts` — optionally extended (Phase 3 Step 5) with direct `viewer`-permission assertions for the 3 new strings.
- **Files**: `apps/api/src/auth/write-guard-coverage.spec.ts`, `libs/core/src/users/domain/types/role.types.spec.ts`

### Integration Tests
- `apps/api/test/integration/invoicing/invoicing-upo-download.int-spec.ts` — the pre-existing `should 403 for a non-admin caller` case (lines 191-206) is renamed/repurposed to assert `200` for a `viewer` caller, since this plan intentionally opens the UPO endpoint to viewer (Phase 3 Step 1).
- `apps/api/test/integration/viewer-role-authz.int-spec.ts` — extended with 6 new "reads → 200" cases (Customers, Shipments, Pickup-Points, Invoices, Webhook Deliveries, Cursors) and 3 new "writes → 403" cases (invoice issue, invoice retry, shipment label generation).
- `apps/api/test/integration/operator-role-authz.int-spec.ts` — extended with 4 new "operational reads → 200" cases (Customers, Invoices, Webhook Deliveries, Cursors) and 1 new "administrative write → 403" case (invoice issue stays admin-only for operator); the two pre-existing `→ 403` cases for webhook-deliveries/cursors are moved out of the "administrative writes" block and flipped to `200` (Phase 1C Step 4).
- **Files**: `apps/api/test/integration/invoicing/invoicing-upo-download.int-spec.ts`, `apps/api/test/integration/viewer-role-authz.int-spec.ts`, `apps/api/test/integration/operator-role-authz.int-spec.ts`

### Mocking Strategy
- No mocking needed beyond what the existing Testcontainers harness (`apps/api/test/integration/setup.ts`) already provides — these are pure HTTP-guard assertions against a real (ephemeral) Postgres + Redis + booted Nest app, using the existing `loginAsAdmin`/`loginAsOperator`/`loginAsViewer` helpers. Unit tests (`write-guard-coverage.spec.ts`) read decorator metadata directly via `Reflect.getMetadata` — no DI, no mocks, no database, per the file's own existing design.

### Acceptance Criteria
- [ ] `viewer` JWT gets `200` on `GET /invoices`, `GET /customers`, `GET /shipments`, `GET /pickup-points`, `GET /webhook-deliveries`, `GET /cursors`.
- [ ] `viewer` JWT gets `403` on `POST /invoices`, `POST /invoices/retry`, `POST /invoices/:invoiceId/correct`, `POST connections/:connectionId/bank-accounts/:accountId/default`, and every existing Shipment write endpoint (`generate-label`, `bulk/generate-labels`, `bulk/protocol`, `:id/cancel`, `:id/notify-dispatched`).
- [ ] `operator` JWT gets `200` on `GET /invoices`, `GET /customers`, `GET /webhook-deliveries`, `GET /cursors`; keeps existing `200`/non-`403` behavior on all Shipment/Pickup-Point endpoints (unchanged); gets `403` on all Invoicing write endpoints (unchanged posture, now individually guarded instead of class-guarded).
- [ ] `write-guard-coverage.spec.ts` passes with `InvoicingController` included in `CONTROLLERS`.
- [ ] `PermissionValues` includes `customers:read`, `shipments:read`, `invoices:read`, `webhooks:read`; both `ROLE_PERMISSIONS.viewer` and `ROLE_PERMISSIONS.operator` include all four (backend), and `apps/web/src/shared/auth/session.types.ts`'s `PermissionValues` mirrors the same four strings (frontend).
- [ ] `apps/api/test/integration/invoicing/invoicing-upo-download.int-spec.ts` no longer asserts `403` for a `viewer` token on the UPO endpoint — its repurposed case asserts `200` instead.
- [ ] `apps/api/src/shipping/http/pickup-point.controller.ts`, `apps/api/src/webhooks/http/webhook-delivery.controller.ts`, and `apps/api/src/cursors/http/cursors.controller.ts` each have no remaining `@Roles` decorator and no unused `Roles` import.
- [ ] `pnpm lint && pnpm type-check && pnpm test` all pass.
- [ ] `pnpm test:integration` passes (requires Docker) — specifically `invoicing-upo-download.int-spec.ts`, `viewer-role-authz.int-spec.ts`, and `operator-role-authz.int-spec.ts`.
- [ ] No admin-role behavior changes anywhere (regression-free for the already-privileged role).

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — interface-layer-only change, no domain/application/infrastructure boundary crossed.
- [x] Respects CORE vs Integration boundaries — no `libs/integrations/**` package touched; no port or adapter touched.
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `RolesGuard`/`@Roles` verbatim; no new guard, decorator, or DTO factory introduced.
- [x] Idempotency considered — not applicable (no write/mutation logic changed; this is a pure authorization-surface change).
- [x] Event-driven patterns used where applicable — not applicable (no events emitted or consumed by any touched file).
- [x] Rate limits & retries addressed — not applicable (no external API calls in scope).
- [x] Error handling comprehensive — unchanged `ForbiddenException` path verified sufficient; no new error paths introduced.
- [x] Testing strategy complete — unit (write-guard invariant, permission-map) + integration (both role-authz specs) covering every changed guard.
- [x] Naming conventions followed — new permission strings match the existing `resource:read`/`resource:write` convention exactly.
- [x] File structure matches standards — no new files; all edits are in-place on existing files in their existing locations.
- [x] Plan is execution-ready — every step names an exact file, exact line numbers (as of this plan's writing — re-verify before editing, since #1357's own creation and other concurrent PRs could shift them slightly), and an explicit acceptance check.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [#1124 — Read-only role hardening](./implementation-plan-1124-read-only-role-hardening.md) (direct precedent)
- [#1126 — Operator role](./implementation-plan-1126-operator-role.md) (direct precedent; also the origin of Shipment/PickupPoint's current `admin`+`operator` gating)
