# Implementation Plan: Taxonomy reads report connection-not-found/disabled as 404/409, not 422

**Date**: 2026-09-09
**Status**: Draft
**Estimated Effort**: 2-3 hours
**Tracks**: [#2146](https://github.com/openlinker-project/openlinker/issues/2146)

---

## 0. Current-state check (is this already done?)

**No.** Verified against the working tree (`libs/core/src/listings/application/services/destination-taxonomy.service.ts:373-380`):

```typescript
private async tryGetAdapter<T>(connectionId: string, capability: string): Promise<T | null> {
  try {
    return await this.integrationsService.getCapabilityAdapter<T>(connectionId, capability);
  } catch {
    return null;
  }
}
```

The bare `catch` still swallows every exception `getCapabilityAdapter` can throw — `ConnectionNotFoundException`, `ConnectionDisabledException`, `CapabilityNotSupportedException`, `CapabilityNotEnabledException` alike — and both controllers still declare only a 422 `@ApiResponse` (`apps/api/src/listings/http/taxonomy.controller.ts:62-70`, `88-95`; `apps/api/src/listings/http/shop-publish.controller.ts:119-129`), each with a comment explicitly citing this collapse as current, correct-for-now behaviour. Issue #2146 is open and unaddressed.

---

## 1. Task Summary

**Objective**: `DestinationTaxonomyService.tryGetAdapter` must stop swallowing connection-level failures. A nonexistent connection must report 404, a disabled connection must report 409 (or be explicitly allowed to read, per a recorded decision — see §5), and only a genuine "no browse capability" condition may still report 422 with the existing capability-naming message.

**Context**: `resolveDestination` probes two capabilities (`OfferManager`, then `ProductPublisher`) to discover which kind of destination a connection is, via `tryGetAdapter`. The probe's *only* legitimate job is telling apart "declares no taxonomy" from "declares the other kind" — that's what `CapabilityNotSupportedException` / `CapabilityNotEnabledException` mean. But the same `catch {}` also eats `ConnectionNotFoundException` and `ConnectionDisabledException`, which are not about capability discovery at all — they mean the probe never got far enough to ask. Every taxonomy read (`browse`, `search`, `path`, and the shop-publish category/attribute reads) funnels through this one method, so a typo'd connection id and a perfectly fine connection with no browse capability currently produce byte-identical 422s.

**Classification**: CORE (application service) + Interface (two controllers' Swagger annotations).

---

## 2. Scope & Non-Goals

### In Scope
- `libs/core/src/listings/application/services/destination-taxonomy.service.ts` — narrow the catch in `tryGetAdapter`.
- `libs/core/src/listings/application/services/__tests__/destination-taxonomy.service.spec.ts` — update the test double so a genuinely-unsupported-capability path still throws the *real* `CapabilityNotSupportedException` (today it throws a generic `Error`, which would now propagate uncaught given the narrowed catch), plus new cases for connection-not-found and connection-disabled.
- `apps/api/src/listings/http/taxonomy.controller.ts` — restore 404/409 `@ApiResponse` declarations on `browseCategories` and `searchCategories`, update the stale comments.
- `apps/api/src/listings/http/shop-publish.controller.ts` — restore 404/409 on the shop `categories` browse route (`browseCategories`); the shop-publish attribute routes (`listAttributes`, `listAttributeTerms`) already declare 404/409, leave them as-is (they resolve through a different path — see §4).
- `apps/api/src/listings/http/taxonomy.controller.spec.ts` and `apps/api/src/listings/http/shop-publish.controller.spec.ts` — unit-test the new status propagation if not already covered by the core service spec (controllers are thin pass-throughs; primary coverage belongs in the service spec).
- The disabled-connection design decision named in the issue body (§5 below) — resolve it now, in code, with a comment recording the choice.

### Out of Scope
- `apps/api/src/mappings/http/mapping-options.controller.ts`'s `source/categories` / `source/categories/:categoryId/path` routes. These aren't named in the issue's file list and currently declare **no** 422 at all (an existing, separate gap — not introduced or worsened by this change, and not part of #2146's acceptance criteria). Left untouched; behaviour there improves incidentally (404/409 become reachable) but no `@ApiResponse` edit is required since none references 422 today.
- Any change to `getCapabilityAdapter` / `getAdapter` in `IntegrationsService` — they already throw the correct domain exceptions; this fix is purely about what the *caller* does with them.
- Any change to `ConnectionExceptionFilter` or `TaxonomySourceUnavailableFilter` — both are already registered globally (`apps/api/src/common/filters/global-filters.ts`) and already map the exceptions to the right status codes.
- Retrying #2145's decision to document-not-fix; this plan is exactly the promised follow-up.

### Constraints
- Must not weaken the "probe is how the kind is discovered" behaviour: a connection that legitimately supports only `ProductPublisher` (not `OfferManager`) must still resolve via the second probe, not blow up on the first.
- Zero architecture-boundary violations: `ConnectionNotFoundException` / `ConnectionDisabledException` live in `@openlinker/core/identifier-mapping`, which `listings` already depends on (see `docs/architecture-overview.md § Cross-context dependencies in core` — `listings --> identifier-mapping` is an existing, allowed edge), and both are domain exceptions (an allowed cross-context symbol shape per `docs/engineering-standards.md § Cross-context dependencies`).

---

## 3. Architecture Mapping

**Target Layer**: CORE (application service, `libs/core/src/listings/application/services/`) + Interface (`apps/api/src/listings/http/*.controller.ts`).

**Capabilities involved**: `OfferManager`, `ProductPublisher` (both already resolved via `IIntegrationsService.getCapabilityAdapter`; no new capability).

**Existing services reused**:
- `IIntegrationsService.getCapabilityAdapter` (unchanged — already throws the four exceptions in question).
- `ConnectionExceptionFilter` (unchanged — already maps `ConnectionNotFoundException` → 404, `ConnectionDisabledException` → 409).
- `TaxonomySourceUnavailableFilter` (unchanged — already maps `TaxonomySourceUnavailableException` → 422).

**New components required**: none. This is a pure narrowing of one `catch` block plus two `@ApiResponse` restorations.

**Core vs Integration justification**: The fix belongs in CORE because `tryGetAdapter` is core application-service logic and every controller that reads taxonomy data (`taxonomy.controller.ts`, `shop-publish.controller.ts`, and incidentally `mapping-options.controller.ts`) shares this one resolution path — fixing it once, in `DestinationTaxonomyService`, is exactly the "shared resolution path rather than one delegating service" fix #2145 deferred to. No integration-layer change is needed; adapters already report the correct exception types.

---

## 4. External / Domain Research

### Internal patterns confirmed by codebase inspection

- **Exception provenance**: `IntegrationsService.getAdapter` (`libs/core/src/integrations/application/services/integrations.service.ts:56-90`) throws `ConnectionDisabledException` at line 68 when `connection.status === 'disabled'`; `connectionPort.get(connectionId)` (not shown here, but the standard identifier-mapping `ConnectionRepository`) throws `ConnectionNotFoundException` when the id doesn't resolve. `getCapabilityAdapter` (line 94 onward) calls `getAdapter` first, so both propagate through it, followed by `CapabilityNotSupportedException` (line 104, adapter-level) and `CapabilityNotEnabledException` (line 112, connection-level).
- **Filter registration**: `apps/api/src/common/filters/global-filters.ts` registers `ConnectionExceptionFilter` and `TaxonomySourceUnavailableFilter` globally (confirmed via grep) — no per-controller `@UseFilters` needed, matching the issue's stated assumption.
- **`ConnectionExceptionFilter`** (`apps/api/src/common/filters/connection-exception.filter.ts:34-49`) maps `ConnectionDisabledException` → 409, everything else in its `@Catch` list (i.e. `ConnectionNotFoundException`) → 404.
- **Existing test double already needs updating regardless of this fix**: `libs/core/src/listings/application/services/__tests__/destination-taxonomy.service.spec.ts`'s `buildService` helper's `getCapabilityAdapter` mock rejects with a generic `new Error('Capability ... not supported ...')` for any unregistered adapter (lines ~60-64). Once `tryGetAdapter` only swallows `CapabilityNotSupportedException`/`CapabilityNotEnabledException`, this generic `Error` would propagate uncaught and break every existing test that currently relies on the swallow-and-fall-through-to-the-next-probe behaviour (e.g. "should resolve a shop to a connection-keyed scope", which relies on the `OfferManager` probe silently failing over to `ProductPublisher`). The mock must be changed to throw the real `CapabilityNotSupportedException`.
- **`mapping-options.controller.ts`'s `source/categories*` routes** call `this.taxonomyService.browse(...)` / `.path(...)` directly, same as `taxonomy.controller.ts` — they resolve through the identical `resolveScope` → `resolveDestination` → `tryGetAdapter` chain, so this fix improves their behaviour for free (404/409 become reachable) even though editing their `@ApiResponse` decorators is out of scope per the issue's file list.
- **`shop-publish.controller.ts`'s attribute routes** (`listAttributes`, `listAttributeTerms`, lines ~146-169) already declare 404/409 and resolve through `IShopAttributeReadService`, a *different* service that (per its own file, not audited here) presumably calls `getCapabilityAdapter` directly rather than through `DestinationTaxonomyService.tryGetAdapter` — hence they already report the correct codes today. Only the shop-publish `categories` browse route (`browseCategories`, lines ~110-135), which explicitly delegates to `this.categoryBrowse.browseCategories` → `DestinationTaxonomyService`, is affected by this bug and needs its `@ApiResponse` restored.

---

## 5. Questions & Assumptions

### Open Questions (resolved with a recorded decision, per the issue's own prompt)

- **"Should a disabled connection still be allowed to read its already-synced projection rows?"** The issue raises this explicitly and says whichever way it's decided must be recorded in code, not left implicit.

  **Decision taken in this plan: rethrow `ConnectionDisabledException` (409), do not special-case disabled-but-readable.**

  Rationale:
  1. The issue's own suggested precedent — "a borrowing connection with no catalogue credentials can still read the owner's rows" — is a *different* mechanism: that connection is never disabled, it's `active` with missing per-connection credentials, and the deferral lives entirely inside `marketplaceBrowseFn`'s `isCategoryBrowser` check (a capability-shaped failure, correctly mapped to `TaxonomySourceUnavailableException` → 422). It does not establish "disabled connections read fine" as a pattern; it establishes "capability-shaped gaps degrade to read-only, connection-status gaps do not."
  2. `getAdapter` throwing `ConnectionDisabledException` for *any* capability read on a disabled connection is the existing, uniform rule across every other capability in the codebase — `resolveDestination`'s two probes are the only call sites that ever swallowed it. Special-casing disabled-but-readable *only* for taxonomy would introduce a new, taxonomy-specific carve-out to the connection lifecycle model, which is a larger and more surprising decision than #2146 asks for, and the issue's acceptance criteria explicitly accept 409 as the simpler outcome ("... or reads the projection successfully if the 'disabled connections may still read' decision is taken — whichever is chosen").
  3. A disabled connection is an operator's explicit "stop touching this" signal; a stale taxonomy read past that point is a bigger surprise than a 409 telling the operator to re-enable it first.

  This is recorded as an inline comment on `tryGetAdapter` at implementation time (see Phase 1, Step 1).

### Assumptions
- `ConnectionExceptionFilter`'s `@Catch` list already includes both exceptions and needs no change (confirmed — see §4).
- No migration, no new port, no new capability.
- The existing `describeScope` / `resolveTaxonomyOwner` / `marketplaceBrowseFn` logic is untouched; only the outer `try/catch` in `tryGetAdapter` changes.

### Documentation Gaps
- None found beyond the one this plan closes — `docs/architecture-overview.md`'s taxonomy sections (`browse`/`search`/`path`, ADR-037) don't mention error-status behaviour at all, so no doc beyond the two `@ApiResponse` blocks needs correction.

---

## 6. Proposed Implementation Plan

### Phase 1: Narrow the swallow in `DestinationTaxonomyService`

**Goal**: `tryGetAdapter` rethrows connection-level failures; only capability-shaped failures return `null`.

**Steps**:

1. **Narrow `tryGetAdapter`'s catch**
   - **File**: `libs/core/src/listings/application/services/destination-taxonomy.service.ts`
   - **Action**:
     - Add imports: `ConnectionNotFoundException`, `ConnectionDisabledException` from `@openlinker/core/identifier-mapping`; `CapabilityNotSupportedException` (already needed to `instanceof`-check — `CapabilityNotEnabledException extends CapabilityNotSupportedException`, so a single `instanceof CapabilityNotSupportedException` check catches both, per `libs/core/src/integrations/domain/exceptions/capability-not-enabled.exception.ts:14`) from `@openlinker/core/integrations` (already imported in the file as `IIntegrationsService`/`INTEGRATIONS_SERVICE_TOKEN` — add to the existing import statement).
     - Rewrite:
       ```typescript
       private async tryGetAdapter<T>(connectionId: string, capability: string): Promise<T | null> {
         try {
           return await this.integrationsService.getCapabilityAdapter<T>(connectionId, capability);
         } catch (error) {
           // A destination legitimately supports only one of the two kinds; probing
           // is how the kind is discovered, so an unsupported/disabled capability is
           // expected rather than exceptional. `CapabilityNotEnabledException` extends
           // `CapabilityNotSupportedException`, so this one check covers both.
           if (error instanceof CapabilityNotSupportedException) {
             return null;
           }
           // Connection-level failures are NOT part of the kind-probe — the probe
           // never got far enough to answer "which kind". Rethrow so the global
           // ConnectionExceptionFilter maps them to 404 / 409, rather than
           // collapsing them into the capability-shaped 422 below.
           //
           // Deliberate decision (#2146): a DISABLED connection is NOT granted a
           // read-only exception here, unlike a borrower with no catalogue
           // credentials (see `marketplaceBrowseFn` below) — that deferral is a
           // capability-shaped gap, this is a connection-lifecycle gap, and every
           // other capability read in the codebase already refuses a disabled
           // connection. Re-enable the connection to read its taxonomy again.
           throw error;
         }
       }
       ```
   - **Acceptance**: `pnpm --filter @openlinker/core type-check` passes; the two new imports resolve.
   - **Dependencies**: none.

2. **Update the unit test double so it throws real exceptions**
   - **File**: `libs/core/src/listings/application/services/__tests__/destination-taxonomy.service.spec.ts`
   - **Action**: In `buildService`'s `getCapabilityAdapter` mock, replace the generic `new Error(...)` rejection with `new CapabilityNotSupportedException(...)` (import it from `@openlinker/core/integrations`), constructed with placeholder `adapterKey`/`capability` args matching its constructor shape (check `libs/core/src/integrations/domain/exceptions/capability-not-supported.exception.ts` for exact signature). This keeps every existing "falls through to the other probe" test passing under the narrowed catch.
   - **Acceptance**: All existing tests in this spec file still pass unmodified in assertions (only the mock's thrown type changes).
   - **Dependencies**: Step 1.

3. **Add new test cases for connection-not-found and connection-disabled**
   - **File**: same spec file, `describe('resolveScope', ...)` block.
   - **Action**: Add a small helper to `buildService` (or inline in the new tests) that makes `getCapabilityAdapter` reject with `ConnectionNotFoundException(connectionId)` for one connection id, and `ConnectionDisabledException(connectionId)` for another. Add two new `it(...)` cases:
     - `it('should propagate ConnectionNotFoundException from a taxonomy probe rather than swallowing it', ...)` — asserts `resolveScope(unknownConnectionId)` rejects with `ConnectionNotFoundException`, never `TaxonomySourceUnavailableException`.
     - `it('should propagate ConnectionDisabledException from a taxonomy probe rather than swallowing it', ...)` — asserts `resolveScope(disabledConnectionId)` rejects with `ConnectionDisabledException`.
     - (Optional but cheap) a third case confirming the *first* probe throwing a connection-level exception means the *second* probe is never attempted (i.e. `getCapabilityAdapter` is called exactly once) — since a connection-level failure is the same for every capability on that connection, retrying with a different capability name is pointless and the plan should assert it doesn't happen.
   - **Acceptance**: New tests fail against the pre-Phase-1 code (bare catch) and pass after Step 1.
   - **Dependencies**: Steps 1-2.

### Phase 2: Restore controller-level `@ApiResponse` declarations

**Goal**: Swagger documents the now-true behaviour; stale "unreachable" comments are removed.

**Steps**:

4. **`taxonomy.controller.ts` — `browseCategories`**
   - **File**: `apps/api/src/listings/http/taxonomy.controller.ts`
   - **Action**: Replace the comment block above the `@ApiResponse({ status: 422, ... })` (currently: *"Corrected in #2085: 404 / 409 are unreachable..."*) and add:
     ```typescript
     @ApiResponse({ status: 404, description: 'Connection not found' })
     @ApiResponse({ status: 409, description: 'Connection disabled' })
     @ApiResponse({
       status: 422,
       description:
         'No taxonomy source could be resolved — the connection exists and is active, but exposes no category browser',
     })
     ```
     (Reword the 422 description slightly since it can no longer also mean "does not exist" or "is disabled" — those are now their own codes.)
   - **Acceptance**: Swagger doc regenerates with three distinct response codes on this route.
   - **Dependencies**: Phase 1.

5. **`taxonomy.controller.ts` — `searchCategories`**
   - **File**: same file.
   - **Action**: Same treatment as Step 4 — replace the *"See the note on `browseCategories` above"* comment and 422-only declaration with the same three-response block (400 for query-too-short is untouched).
   - **Acceptance**: same as Step 4.
   - **Dependencies**: Phase 1.

6. **`shop-publish.controller.ts` — `browseCategories` (shop category tree)**
   - **File**: `apps/api/src/listings/http/shop-publish.controller.ts`
   - **Action**: Replace the *"404 / 409 were declared here until #2085 and are now unreachable"* comment block and single 422 `@ApiResponse` with the restored three-response set, mirroring Steps 4-5's wording (adjust the 422 description's capability list to reference `ShopCategoryBrowser` per this route's actual failure mode, matching the file's existing style).
   - **Acceptance**: same shape as Step 4.
   - **Dependencies**: Phase 1.

7. **Controller-level unit test sanity check**
   - **Files**: `apps/api/src/listings/http/taxonomy.controller.spec.ts`, `apps/api/src/listings/http/shop-publish.controller.spec.ts`
   - **Action**: Inspect existing specs; if they assert on `@ApiResponse` metadata (unlikely — Nest Swagger decorators aren't typically unit-tested) no change is needed. If they mock `taxonomyService.browse` to reject and assert a specific HTTP status via a full Nest test module + exception filters, add/confirm cases for the two new exception types propagating unchanged through the controller method (controllers here are thin pass-throughs with no local try/catch, so nothing to change in controller *code* — only confirm no test asserts the old swallow-to-422 behaviour).
   - **Acceptance**: No spec asserts a stale 422-for-everything expectation; existing suite is green.
   - **Dependencies**: Phase 1, Steps 4-6.

### Implementation Details

**New Components**: none — this is a modification of one existing method plus documentation-decorator updates.

**Configuration Changes**: none.

**Database Migrations**: none.

**Events**: none emitted or consumed.

**Error Handling**:
- `ConnectionNotFoundException`, `ConnectionDisabledException` now propagate out of `tryGetAdapter` / `resolveDestination` / `resolveScope` for the first time in this code path (previously always swallowed to `null`).
- `CapabilityNotSupportedException` (and its subclass `CapabilityNotEnabledException`) continue to be swallowed to `null`, preserving the two-probe fallback behaviour and the final `TaxonomySourceUnavailableException` (422) when neither probe resolves a taxonomy source.
- No new exception types are introduced.

---

## 7. Alternatives Considered

### Alternative 1: Catch-and-rethrow with an explicit exhaustive `instanceof` chain (list every non-swallowed type individually)
- **Description**: Instead of `instanceof CapabilityNotSupportedException` (which relies on `CapabilityNotEnabledException`'s inheritance), explicitly check `instanceof CapabilityNotSupportedException || error instanceof CapabilityNotEnabledException`.
- **Why Rejected**: Redundant — `CapabilityNotEnabledException extends CapabilityNotSupportedException` (confirmed in `capability-not-enabled.exception.ts:14`), so the single parent check already covers both, and stays correct if a future subclass of `CapabilityNotSupportedException` is added without this file needing an edit.
- **Trade-offs**: None meaningful; the single-check version is simpler and equally explicit given the inline comment naming both types.

### Alternative 2: Allow a disabled connection to still read the synced projection (the issue's alternative option)
- **Description**: Special-case `ConnectionDisabledException` in `tryGetAdapter` to still attempt a *projection-only* read path (bypassing capability resolution entirely) rather than rethrowing.
- **Why Rejected**: See §5's Decision — this would require either (a) resolving the taxonomy scope without ever calling `getCapabilityAdapter` for a disabled connection (a structurally different code path with its own risk of drift from the active-connection path), or (b) a bespoke "disabled but read allowed" flag threaded through `IIntegrationsService`, which is a larger surface change than #2146 asks for and inconsistent with every other capability read in the system. The issue explicitly accepts the simpler 409 outcome as a valid resolution.
- **Trade-offs**: Rejecting this means an operator who disables a connection loses taxonomy browsing until re-enabling it, even though the rows are already synced and reading them is free. This is a real but small UX cost, explicitly called out and accepted in §5.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No layer violation: change is entirely within the CORE application service and two Interface-layer controllers' decorators.
- ✅ Cross-context import (`@openlinker/core/identifier-mapping` exceptions into `listings`) is an already-allowed edge (`listings --> identifier-mapping` per `docs/architecture-overview.md`'s dependency map, exercised elsewhere in `listings.module.ts`), and exceptions are an explicitly-allowed cross-context symbol shape per `docs/engineering-standards.md`.

### Naming Conventions
- ✅ No new files, no new naming decisions.

### Existing Patterns
- ✅ Mirrors the exact pattern `IntegrationsService.getCapabilityAdapter` itself already uses (letting domain exceptions propagate for the caller's global filter to map) — this fix makes `tryGetAdapter` consistent with the rest of the codebase rather than introducing a new pattern.

### Risks
- **Test-double drift**: The existing spec's mock throws a generic `Error` for "capability not registered", which will now propagate instead of being swallowed once `tryGetAdapter` narrows its catch — Phase 1 Step 2 explicitly fixes this before it can silently break unrelated tests. Flagged as the single highest-risk item in this plan; must be done in the same commit as Step 1, not after.
- **Behavioural risk to the two-probe fallback**: If `CapabilityNotSupportedException` narrowing is wrong (e.g. missing the `CapabilityNotEnabledException` inheritance check), a connection that legitimately supports only `ProductPublisher` would incorrectly propagate an exception from the `OfferManager` probe instead of falling through — mitigated by Step 3's explicit fallback-path assertions and the existing "should resolve a shop to a connection-keyed scope" test, which already exercises this exact fallback and will catch a regression.
- **Scope creep temptation**: `mapping-options.controller.ts`'s two undecorated routes will start returning 404/409 as a side effect of this fix, but adding `@ApiResponse` there is explicitly out of scope (not in the issue's file list) — noted so a reviewer doesn't ask for it to be silently included, and doesn't flag its absence as incomplete.

### Edge Cases
- **Disabled connection with no browse capability at all**: `getAdapter` throws `ConnectionDisabledException` *before* the capability check ever runs (per `IntegrationsService.getAdapter`'s ordering), so this case correctly reports 409, not 422 — the "no capability" 422 is unreachable for a disabled connection, which is intentional (you can't know what it would have supported).
- **Nonexistent connection with a `parentId` query param, or `search`, or `path`**: All three routes funnel through `resolveScope` → `resolveDestination` → `tryGetAdapter`, so all three inherit the fix uniformly; no route-specific edge case.
- **Second probe (`ProductPublisher`) also being disabled/not-found for the same connection**: Impossible — connection status and existence are properties of the *connection*, not the capability, so if the first probe throws a connection-level exception, the second probe (Step 3's third test case) is never reached and would throw identically if it were.

### Backward Compatibility
- ⚠️ **Intentional, documented breaking change to the HTTP contract**: any client currently branching on "422 means connection problem OR capability problem" for these three routes will now see 404/409 for the connection-problem half. This is the entire point of the fix and is what the issue's acceptance criteria demand — not a regression.
- ✅ No breaking change to the 422 case itself: a connection that exists, is active, and genuinely lacks a browse capability still gets exactly the same 422 body and message as before.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/listings/application/services/__tests__/destination-taxonomy.service.spec.ts` — Phase 1 Steps 2-3 (updated mock + two/three new cases). This is where the real behavioural assertion lives; the fix is entirely in `DestinationTaxonomyService`.

### Integration Tests
- Not required — no new persistence, no new HTTP wiring, and `ConnectionExceptionFilter` / `TaxonomySourceUnavailableFilter` are pre-existing, already-tested global filters (`apps/api/src/common/filters/taxonomy-source-unavailable.filter.spec.ts` already exists and is untouched). If desired as a belt-and-suspenders check, a single new int-spec case hitting `GET /listings/connections/:id/taxonomy/categories` with a nonexistent id and asserting `404` would exercise the full filter chain, but is not required to satisfy the issue's acceptance criteria, which are stated in terms of the service-level behaviour it depends on.

### Mocking Strategy
- Mock `IIntegrationsService.getCapabilityAdapter` to reject with the real domain exception classes (`ConnectionNotFoundException`, `ConnectionDisabledException`, `CapabilityNotSupportedException`) rather than generic `Error`s — this is both the fix's own risk-mitigation (Phase 1 Step 2) and the correct testing pattern per `docs/engineering-standards.md § Mocking Ports`.

### Acceptance Criteria (mirrors the issue's own, verified achievable by this plan)
- [ ] A taxonomy read for a nonexistent connection id returns **404**, not 422 (Phase 1 Step 1 + Phase 2).
- [ ] A taxonomy read for a disabled connection returns **409** — the "disabled connections may still read" alternative is explicitly declined and recorded in code (§5, Phase 1 Step 1's comment).
- [ ] A connection with no browse capability still returns **422** with the capability-naming message (unchanged — `CapabilityNotSupportedException`/`CapabilityNotEnabledException` still swallowed to `null`, still falls through to the existing `TaxonomySourceUnavailableException` throw at the end of `resolveDestination`).
- [ ] The `@ApiResponse` declarations on both controllers (`taxonomy.controller.ts`, `shop-publish.controller.ts`) match the restored behaviour (Phase 2).
- [ ] Tests added covering all three conditions distinctly (Phase 1 Steps 2-3).
- [ ] No architecture boundary violations (CORE ↔ Integration) — confirmed in §8, the only new import is a domain-exception import across an already-allowed core-to-core edge.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — change confined to application service + interface-layer decorators.
- [x] Respects CORE vs Integration boundaries — no integration package touched; exceptions already exist in `@openlinker/core/identifier-mapping` and `@openlinker/core/integrations`.
- [x] Uses existing patterns (no unnecessary abstractions) — reuses existing exception classes and existing global filters; no new exception type, no new filter.
- [x] Idempotency considered — not applicable (pure read-path error classification, no writes).
- [x] Event-driven patterns used where applicable — not applicable.
- [x] Rate limits & retries addressed — not applicable.
- [x] Error handling comprehensive — all four exception shapes `getCapabilityAdapter` can throw are now explicitly and correctly classified (2 rethrown, 2 swallowed).
- [x] Testing strategy complete — unit tests cover all three distinguishable outcomes at the service layer, where the actual logic lives.
- [x] Naming conventions followed — no new names introduced.
- [x] File structure matches standards — no new files.
- [x] Plan is execution-ready.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Cross-context dependencies in core (the `listings --> identifier-mapping` edge this plan relies on).
- [Engineering Standards](../engineering-standards.md) — § Error Handling, § Cross-context dependencies.
- [Testing Guide](../testing-guide.md) — unit test conventions.
- Issue [#2146](https://github.com/openlinker-project/openlinker/issues/2146) — the tracked defect this plan implements.
- Issue #2145 (referenced, not re-read in full here) — documented the current behaviour and deferred this exact fix.
