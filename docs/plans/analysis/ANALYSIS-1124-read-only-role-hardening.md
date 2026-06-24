# Pre-implement analysis — ANALYSIS-1124-read-only-role-hardening

**Plan:** `docs/plans/implementation-plan-read-only-role-hardening.md`
**Gate date:** 2026-06-22
**Audited by:** `/pre-implement` gate

---

## Verdict: READY

No Critical contract breaks. No reuse collisions. Two Warnings documented below — both have clear one-line fixes that can be applied during implementation without revising the plan.

---

## Phase B — Reuse audit

| Plan artifact | Classification | Evidence |
|---|---|---|
| `PermissionValues` / `ROLE_PERMISSIONS` in `role.types.ts` | **PARTIAL (extend existing)** | `libs/core/src/users/domain/types/role.types.ts` — currently has 7 permissions; plan adds 8 more (`orders:*`, `products:*`, `inventory:*`, `listings:*`) |
| `UserRole` type, `Permission` type | **ALREADY EXISTS → reuse** | Exported from `@openlinker/core/users` barrel at `libs/core/src/users/index.ts` |
| `ConnectionResponseDto.fromDomain()` | **PARTIAL (extend existing)** | `apps/api/src/integrations/http/dto/connection-response.dto.ts:71` — current signature `fromDomain(connection, supportedCapabilities[])`. Plan correctly adds optional `role?: UserRole` |
| `@CurrentUser()` decorator | **ALREADY EXISTS → reuse** | `apps/api/src/auth/decorators/current-user.decorator.ts`. Already used in `connection.controller.ts` lines 220, 269 |
| `AuthenticatedUser` type | **ALREADY EXISTS → reuse** | `apps/api/src/auth/auth.types.ts` — `{ id, username, role: UserRole }` |
| Class-level `@Roles('admin')` on 8 operational controllers | **ALREADY EXISTS (to be removed)** | Confirmed on all 8 controllers; none have per-method decorators |
| `usePermission()` FE hook | **NEW (confirmed absent)** | Grep confirms zero matches in codebase; `SessionUser.permissions: string[]` already typed and populated |
| Auth barrel `apps/web/src/shared/auth/index.ts` | **DOES NOT EXIST** | No barrel file in `apps/web/src/shared/auth/`; plan step 3.2 ("if one exists") is correctly conditional — skip it |
| `connection-response.dto.spec.ts` | **NEW (confirmed absent)** | File does not exist |
| Integration test `connections-viewer-redaction.int-spec.ts` | **NEW (confirmed absent)** | Path `apps/api/test/integration/` confirmed as new |
| `users.tokens.ts` (no new tokens needed) | **ALREADY EXISTS** | `libs/core/src/users/users.tokens.ts` exists; plan adds no new Symbol tokens — correct |

---

## Phase C — Backward-compatibility checklist

### Critical items

**None found.**

The `fromDomain()` signature change (`role?: UserRole` added as optional third parameter) is backward-compatible: all 5 existing call sites in `connection.controller.ts` call through the private `toResponse()` helper (line 83), so they compile without changes. The `connection.controller.spec.ts` only asserts `instanceof ConnectionResponseDto`, not specific field values — no test breaks.

The `PermissionValues` expansion is additive (new entries appended); no consumer is removed. The `user-response.dto.spec.ts` viewer test (line 41) asserts `toEqual([...ROLE_PERMISSIONS['viewer']])` — a dynamic reference that auto-flexes with the updated map.

`@CurrentUser()` on `list()` and `get()` changes the controller's dependency surface, but the existing `connection.controller.spec.ts` mocks the controller module — adding a decorator parameter doesn't break the mock setup.

---

### Warning items

#### W1 — `toResponse()` has 5 call sites; plan only threads `user` to 2

| Severity | Warning |
|---|---|
| Surface | Private `toResponse()` helper in `connection.controller.ts` |
| Detail | `toResponse()` is called from **5 places** in the controller (lines 99, 115, 128, 155, 287 — covering `get`, `list`, `update`, and `disable`). The plan explicitly threads `user` only through `list()` and `get()`. The remaining 3 callers — `update()` (line 131, `@Roles('admin')`), and `disable()` (line 275, `@Roles('admin')`) — would call `toResponse(connection)` without a `user`, causing `role === undefined` → `config: {}` in the response. An admin would receive a redacted config after a successful `PUT /connections/:id` or `PATCH /connections/:id/disable`. |
| Fix | Thread `@CurrentUser() user: AuthenticatedUser` into every method that calls `toResponse()`, not just `list()` and `get()`. All affected methods already have `@Roles('admin')`, so the user will always be an admin at those call sites — they'll get `config` populated as expected. Alternatively, pass a hardcoded `role: 'admin'` sentinel from admin-only write endpoints. The cleaner approach is to add `@CurrentUser()` uniformly. |
| Effort | 3 additional `@CurrentUser() user: AuthenticatedUser` parameter additions. |

#### W2 — `listings.controller.ts` wizard-helper GETs need explicit per-method `@Roles('admin')` — count is higher than the plan implies

| Severity | Warning |
|---|---|
| Surface | `apps/api/src/listings/http/listings.controller.ts` |
| Detail | The class currently has 13 handlers. The plan opens 4 GETs and keeps 9 (all POSTs + wizard GET helpers) as admin-only. The wizard GETs are: `getSellerPolicies` (line 380), `getCategoryParameters` (line 398), `getCatalogProduct` (line 609). Removing the class-level guard means all 3 must get explicit `@Roles('admin')` at the method level, in addition to the 6 POST handlers. That's 9 individual decorators to add — the plan's table in §5 says "all 4 POST endpoints" but there are actually 6 POST handlers in this controller (updateOfferFields, autoMatchVariants, createOffer, resolveCategory, resolveCategoriesBatch, findProductsByBarcode). |
| Fix | During implementation, verify the complete POST count for `listings.controller.ts` is 6 (not 4 as the §5 table says) and add `@Roles('admin')` to all 6. The plan's text in Step 1.2 says "all write POSTs" which is correct; only the §5 table header is understated. |
| Effort | 2 additional `@Roles('admin')` decorators beyond the plan's stated 4. |

---

## Open questions

**OQ1 — `getDiagnostics()` FE surface**

The plan gates `GET /connections/:id/diagnostics` to `@Roles('admin')`. Confirmed the endpoint currently has no `@Roles` decorator. Before adding the gate, confirm no FE page visible to viewer sessions calls this endpoint (e.g., a connection health widget). A 403 where a 200 was expected will surface as an error toast rather than a clean "no data" state. Quick grep: `diagnostics` appears in admin-only connection detail pages, so this is safe.

**OQ2 — `connection.controller.spec.ts` update after `@CurrentUser()` addition**

The controller spec mocks `@CurrentUser()` via `NestJS TestingModule` overrides or JWT strategy mocks. Adding `@CurrentUser()` to `list()` and `get()` means those test cases need a request object with a `user` field populated (or `ExecutionContext` mock updated). The plan mentions updating the spec but doesn't enumerate which test cases need the mock user. The implementer should audit each `list` and `get` test case in the spec.

**OQ3 — FE components inventory**

The plan's Phase 4 (§4.1–4.5) lists component files by role (connections, dashboard, listings, sync). The exact component file paths for listings and sync write controls are left as `apps/web/src/pages/listings/*.tsx` etc. — not pinned. The implementer should grep for `createOffer`, `retryJob`, `triggerSync`, etc. to find the precise component files before editing.

---

## Summary

The plan is architecturally clean and ready to implement. All plan assumptions about the live codebase are confirmed correct:
- `SessionUser.permissions[]` is already populated end-to-end (no stub to wire)
- `usePermission` hook is genuinely absent
- `@CurrentUser()` pattern already used in the same controller
- `fromDomain()` call site is isolated to one private helper in one file

Two warnings have straightforward one-liner fixes implementable without revising the plan: (W1) add `@CurrentUser()` to `update()` and `disable()` call sites too, and (W2) count 6 POST handlers in `listings.controller.ts`, not 4. Neither is a contract break.
