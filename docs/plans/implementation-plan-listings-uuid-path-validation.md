# Implementation Plan: Listings controller — reject non-UUID path ids with 400 instead of 500

**Date**: 2026-07-01
**Status**: Ready for Review
**Estimated Effort**: 2-3 hours
**Issue**: [#1213](https://github.com/openlinker-project/openlinker/issues/1213)

---

## 1. Task Summary

**Objective**: Three `listings` HTTP routes forward a raw path param straight into a TypeORM lookup against a Postgres `uuid` column. When the param isn't a valid UUID, Postgres raises `invalid input syntax for type uuid` (SQLSTATE `22P02`), TypeORM wraps it in `QueryFailedError`, nothing catches it, and Nest's default filter returns a generic `500`. Fix it so a malformed id returns `400 Bad Request` (boundary validation) and, as defense-in-depth, a malformed id that somehow reaches the repository layer degrades to the existing "not found" contract instead of throwing.

**Context**: Filed as a low-severity input-robustness bug. All three routes are auth-gated and not reached by normal UI navigation (the FE always links by a real `m.id`), so there is no user-facing regression — the issue is 500s polluting error monitoring and giving a post-auth probe an easy way to generate 500s. The fix mirrors a pattern (`ConnectionRepository`) that already exists in the codebase for exactly this failure mode.

**Classification**: Interface (controller boundary validation) + Infrastructure (repository error-translation), within the existing `listings` bounded context. No CORE domain-model change, no new capability, no migration.

---

## 2. Scope & Non-Goals

### In Scope
- `apps/api/src/listings/http/listings.controller.ts`: add `ParseUUIDPipe` to the three affected path params (`getOfferMapping`, `getMarketplaceOffer`, `getOfferCreationStatus`).
- `libs/core/src/listings/infrastructure/persistence/repositories/offer-mapping.repository.ts`: guard `findById` against `QueryFailedError` code `22P02` → return `null`.
- `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts`: guard `findById` (→ `null`) and `updateStatus` (→ `OfferCreationRecordNotFoundException`) against the same error code.
- New/updated unit tests for both repositories and (implicitly, via existing tests continuing to pass) the controller.
- New integration test exercising the real Nest pipe pipeline end-to-end (only way to genuinely verify `ParseUUIDPipe` fires, since existing controller unit tests call controller methods directly and bypass parameter-decorator pipes).

### Out of Scope
- The `connectionId` param on `getOfferCreationStatus` — it is never used in a DB query (`record.connectionId !== connectionId` is a JS string comparison), so a malformed value is already harmless and correctly falls through to `404`. No change needed.
- The other internal-only UUID repositories called out in the issue as "not currently HTTP-reachable with attacker input" (`listing-creation-record`, `bulk-listing-batch`, `invoice-record`, `user`, `ai/prompt-template`, mapping repos). The issue explicitly tracks these as a **separate proactive follow-up** — not blocking this fix.
- A global Nest exception filter mapping `QueryFailedError` `22P02` → `400` across the whole app. The issue calls this out as an **optional follow-up hardening PR**, not part of this fix.
- Any database migration — no schema change.
- `OfferCreationRecordRepository` methods keyed on `internalVariantId` / `externalOfferId` / `bulkBatchId` (`findLatestByVariantAndConnection`, `findByExternalOfferIdAndConnectionId`, `updateExternalOfferId`, `updateExternalIdAndStatus`, `findByBulkBatchId`, `updateClassificationReport`, `resetForRetry`) — none of these are invoked with a raw, attacker-controlled HTTP path param in the current call graph (verified via codebase search; all callers are internal application services / workers). Guarding them is unnecessary scope creep for this fix.

### Constraints
- No behavior change for the happy path (valid UUID, row exists) or the existing 404 path (valid UUID, no row) — both must continue to pass unchanged.
- Must follow the exact repository error-translation pattern already used by `ConnectionRepository` (`libs/core/src/identifier-mapping/infrastructure/persistence/repositories/connection.repository.ts`), per `docs/engineering-standards.md § Error Handling` and the issue's own explicit instruction to mirror it.
- Must follow the exact `ParseUUIDPipe` usage already used by sibling `listings` controllers (`bulk-listing.controller.ts`, `bulk-shop-publish.controller.ts`) and by `sync.controller.ts` / `webhook-delivery.controller.ts` / `prompt-templates.controller.ts`.

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/api/src/listings/http/`) + Infrastructure (`libs/core/src/listings/infrastructure/persistence/repositories/`).

**Capabilities Involved**: None — this is pure request-validation + repository error-translation. No capability port is touched.

**Existing Services Reused**:
- `OfferMappingRepositoryPort` / `OfferMappingRepository` (signature unchanged — `findById` already returns `Promise<IdentifierMapping | null>`, so returning `null` on a bad-input error is a pure implementation-detail fix, no contract change).
- `OfferCreationRecordRepositoryPort` / `OfferCreationRecordRepository` (same — `findById` already nullable; `updateStatus` already throws `OfferCreationRecordNotFoundException` on a genuinely-missing row, so routing the `22P02` case through the same exception is contract-consistent, not a contract change).
- Nest's built-in `ParseUUIDPipe` — already a dependency, already used elsewhere in the same module (`bulk-listing.controller.ts`, `bulk-shop-publish.controller.ts`).
- `OfferCreationRecordNotFoundException` (`libs/core/src/listings/domain/exceptions/offer-creation-record-not-found.exception.ts`) — already exists, already the exception `updateStatus` throws for the "row genuinely missing" case.

**New Components Required**: None. This fix adds guard clauses to existing methods; it introduces no new files in the domain/application layers, no new port, no new exception type.

**Core vs Integration Justification**: Both touched files already live in `libs/core/src/listings` (repository = infrastructure layer of the `listings` bounded context) and `apps/api/src/listings/http` (interface layer, host app). This is not an integration/adapter concern — it's tightening the boundary between the HTTP interface and the DB-backed repository inside a single bounded context. No CORE port needs to change because `findById`'s contract (`T | null`) already accommodates "not found for any reason" — the fix only changes which internal branch produces that `null`.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure), [Engineering Standards - Repository Error Handling Pattern](../engineering-standards.md#error-handling)

---

## 4. External / Domain Research

### External System
Not applicable — no external system involved.

### Internal Patterns

**Canonical repository guard (to copy verbatim in shape)** — `ConnectionRepository.get` / `ConnectionRepository.update` (`libs/core/src/identifier-mapping/infrastructure/persistence/repositories/connection.repository.ts:37-61` and `:82-135`):

```typescript
async get(connectionId: string): Promise<Connection> {
  try {
    const entity = await this.repository.findOne({ where: { id: connectionId } });
    if (!entity) {
      throw new ConnectionNotFoundException(connectionId);
    }
    return this.toDomain(entity);
  } catch (error) {
    // Handle invalid UUID format - PostgreSQL throws QueryFailedError
    // when trying to query with a non-UUID string
    if (
      error instanceof QueryFailedError &&
      'code' in error &&
      error.code === '22P02' // PostgreSQL invalid input syntax error code
    ) {
      throw new ConnectionNotFoundException(connectionId);
    }
    // Re-throw other errors (including ConnectionNotFoundException)
    throw error;
  }
}
```

Note this pattern checks the specific driver code `22P02`, not just `instanceof QueryFailedError` (a looser variant exists in `ConnectionCursorRepository` that catches *any* `QueryFailedError`, e.g. connection-reset errors, as "not found" — the issue explicitly asks for the tighter, code-checked variant, which this plan follows).

**Existing `ParseUUIDPipe` usage in the same module** — `apps/api/src/listings/http/bulk-listing.controller.ts:138` and `bulk-shop-publish.controller.ts:99`:

```typescript
@Param('batchId', new ParseUUIDPipe()) batchId: string
```

This plan uses the same `new ParseUUIDPipe()` instance form (rather than the bare class-reference form used in `sync.controller.ts` — both forms are equivalent to Nest and already coexist in the codebase; matching the *sibling listings controllers* keeps this module internally consistent).

**Existing spec pattern for constructing a `QueryFailedError` with a driver code** — `libs/core/src/invoicing/infrastructure/persistence/repositories/invoice-record.repository.spec.ts:156` and `libs/core/src/sync/infrastructure/persistence/repositories/__tests__/connection-cursor.repository.spec.ts:83`:

```typescript
const error = new QueryFailedError('invalid input syntax for type uuid', [], '');
(error as QueryFailedError & { code?: string }).code = '22P02';
ormRepository.findOne.mockRejectedValue(error);
```

**Why the fix can't be verified by controller unit tests alone**: `apps/api/src/listings/http/listings.controller.spec.ts` instantiates `ListingsController` directly and calls `controller.getOfferMapping('uuid-1')` etc. — this bypasses Nest's parameter-decorator pipe pipeline entirely, since pipes only run when Nest's router invokes the handler through the full request lifecycle. Adding `ParseUUIDPipe` to the decorator is therefore invisible to the existing unit-test style. The only way to genuinely exercise the pipe is an integration test that sends a real HTTP request through the booted Nest app (confirmed: no existing `*.spec.ts` or `*.int-spec.ts` in this repo unit-tests `ParseUUIDPipe` behavior directly — this will be the first).

---

## 5. Questions & Assumptions

### Open Questions
- None. The issue is fully specified (root cause identified with exact line numbers, proposed fix given, scope explicitly bounded, test plan given).

### Assumptions
- **UUID version**: `offer_creation_records.id` and `identifier_mappings.id` are both `@PrimaryGeneratedColumn('uuid')`, populated by Postgres `uuid_generate_v4()` (verified: `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts:40`). `ParseUUIDPipe` defaults to accepting any RFC 4122 UUID version, which is correct here — no `{ version: '4' }` option needed (matches the option-less usage already in `bulk-listing.controller.ts`).
- **`updateStatus` is not currently HTTP-reachable with attacker input** (confirmed via `grep` — all call sites are internal application services: `offer-status-poll.service.ts`, `offer-creation-execution.service.ts`). Guarding it is defense-in-depth per the issue's explicit instruction, not a fix for a currently-exploitable path.
- **No logging on the guarded branch**, matching `ConnectionRepository`'s actual behavior (it silently converts the error, it does not log a warning) — chosen over the noisier `ConnectionCursorRepository` variant that logs on every occurrence, since the issue names `ConnectionRepository` specifically as "the canonical pattern to copy."

### Documentation Gaps
- None relevant to this fix.

---

## 6. Proposed Implementation Plan

### Phase 1: Boundary validation (controller)

**Goal**: Non-UUID path params are rejected with `400` before any DB call.

**Steps**:

1. **Add `ParseUUIDPipe` import and apply to `getOfferMapping`**
   - **File**: `apps/api/src/listings/http/listings.controller.ts`
   - **Action**: Add `ParseUUIDPipe` to the existing `@nestjs/common` import list (already imports `Param`, `NotFoundException`, etc. from the same module — one-line addition to the destructured import). Change the `@Get(':id')` handler signature from `@Param('id') id: string` to `@Param('id', new ParseUUIDPipe()) id: string`.
   - **Acceptance**: `GET /listings/not-a-uuid` returns `400` before touching `offerMappingRepository`. `GET /listings/<valid-but-absent-uuid>` still returns `404` (unchanged).
   - **Dependencies**: None.

2. **Apply `ParseUUIDPipe` to `getMarketplaceOffer`**
   - **File**: `apps/api/src/listings/http/listings.controller.ts`
   - **Action**: Change the `@Get(':id/offer')` handler signature from `@Param('id') id: string` to `@Param('id', new ParseUUIDPipe()) id: string`.
   - **Acceptance**: `GET /listings/not-a-uuid/offer` returns `400`. Valid UUID + non-`Offer`-type mapping still returns `404` with the existing message (unchanged). Valid UUID + `Offer` mapping still calls the adapter as before (unchanged).
   - **Dependencies**: Same import from step 1 (single import line covers both handlers).

3. **Apply `ParseUUIDPipe` to `getOfferCreationStatus`'s `offerCreationRecordId` param only**
   - **File**: `apps/api/src/listings/http/listings.controller.ts`
   - **Action**: Change `@Param('offerCreationRecordId') offerCreationRecordId: string` to `@Param('offerCreationRecordId', new ParseUUIDPipe()) offerCreationRecordId: string`. Leave `@Param('connectionId') connectionId: string` **unguarded** — it's never used in a DB query on this path (see Scope § Out of Scope), so adding validation there would be unjustified scope creep and could change behavior for callers passing a non-UUID `connectionId` that legitimately falls through to a correct `404` today.
   - **Acceptance**: `GET /listings/connections/<any-string>/offers/creation/not-a-uuid` returns `400`. `GET /listings/connections/<valid-conn>/offers/creation/<valid-but-absent-uuid>` still returns `404`.
   - **Dependencies**: Same import from step 1.

### Phase 2: Repository defense-in-depth

**Goal**: If a malformed id ever reaches the repository layer through any future call path, it degrades to the existing "not found" contract instead of an unhandled `QueryFailedError` → 500.

**Steps**:

4. **Guard `OfferMappingRepository.findById`**
   - **File**: `libs/core/src/listings/infrastructure/persistence/repositories/offer-mapping.repository.ts`
   - **Action**: Import `QueryFailedError` from `typeorm`. Wrap the existing `findOne` call in a `try { … } catch (error) { … }`. On `error instanceof QueryFailedError && 'code' in error && error.code === '22P02'`, return `null`. Re-throw all other errors. This is a drop-in wrap — no change to the method's existing `if (!entity) return null; return this.toDomain(entity);` body, no change to the method signature or `OfferMappingRepositoryPort` contract.
   - **Acceptance**: `findById('not-a-uuid')` resolves to `null` instead of rejecting. `findById(<valid-absent-uuid>)` still resolves to `null` (unchanged). `findById(<valid-existing-uuid>)` still resolves to the mapped domain entity (unchanged).
   - **Dependencies**: None.

5. **Guard `OfferCreationRecordRepository.findById`**
   - **File**: `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts`
   - **Action**: Import `QueryFailedError` from `typeorm` (add to the existing `typeorm` import alongside `Repository`). Wrap the `findOne` call in `findById` in the same try/catch shape as step 4 — on `22P02`, return `null`.
   - **Acceptance**: `findById('not-a-uuid')` resolves to `null` instead of rejecting. Existing found/not-found behavior unchanged.
   - **Dependencies**: None (independent of step 4; same file, different method than step 6).

6. **Guard `OfferCreationRecordRepository.updateStatus`**
   - **File**: `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts`
   - **Action**: Wrap the `findOne` call in `updateStatus` in the same try/catch shape — on `22P02`, throw `OfferCreationRecordNotFoundException(id)` (already imported in this file; already the exception this method throws for the genuinely-missing-row case two lines below). This makes the `22P02` branch and the "row not found" branch produce an identical outward contract, matching `ConnectionRepository.update`'s precedent where a bad-format id and a genuinely-missing id both surface as the same domain "not found" exception.
   - **Acceptance**: `updateStatus('not-a-uuid', 'succeeded')` rejects with `OfferCreationRecordNotFoundException`, not `QueryFailedError`. Existing found/not-found behavior for `updateStatus` unchanged.
   - **Dependencies**: None. (`updateExternalOfferId`, `updateExternalIdAndStatus`, `resetForRetry`, `updateClassificationReport` also do a `findOne({ where: { id } })` immediately followed by the same not-found throw — they are **not** guarded per this plan's explicit Scope decision, since none is reachable with attacker-controlled input today. Note this as a natural extension point for the tracked follow-up issue if a future caller ever passes an HTTP-sourced id to one of them.)

### Implementation Details

**New Components**: None — no new files across any layer.

**Configuration Changes**: None.

**Database Migrations**: None — no schema change (confirmed by the issue itself: "No DB migration required").

**Events**: None emitted or consumed by this change.

**Error Handling**:
- `OfferMappingRepository.findById`: `QueryFailedError` (code `22P02`) → swallowed, returns `null` → controller's existing `if (!mapping) throw new NotFoundException(...)` fires → `404`. But this branch should now be **unreachable in practice** once Phase 1 ships, because `ParseUUIDPipe` rejects the malformed input before the repository is ever called — Phase 2 exists purely as a backstop for any future call path that skips the pipe (e.g. a new internal caller, or a future GraphQL/RPC surface reusing the same repository).
- `OfferCreationRecordRepository.findById`: same shape as above.
- `OfferCreationRecordRepository.updateStatus`: `QueryFailedError` (code `22P02`) → `OfferCreationRecordNotFoundException(id)`, exactly mirroring the exception already thrown when `findOne` legitimately returns nothing.
- `ParseUUIDPipe` on all three params: throws Nest's built-in `BadRequestException` (`400`) automatically — no custom exception class needed, no controller-level try/catch needed (Nest's parameter-pipe pipeline runs before the handler body).

**Reference**: [Engineering Standards - Project Structure](../engineering-standards.md#project-structure), [Engineering Standards - Repository Error Handling Pattern](../engineering-standards.md#error-handling)

---

## 7. Alternatives Considered

### Alternative 1: Global exception filter mapping `QueryFailedError` (`22P02`) → `400`
- **Description**: Register a Nest `ExceptionFilter` that catches any unhandled `QueryFailedError` with driver code `22P02` anywhere in the app and maps it to `400 Bad Request`, closing the same class of bug for every UUID-keyed repository at once (including the "internal-only, not currently HTTP-reachable" repos the issue lists as out of scope).
- **Why Rejected**: The issue explicitly frames this as an **optional follow-up hardening PR**, not part of this fix — it's app-wide blast radius (touches every controller, not just `listings`) for a fix that the issue scopes narrowly to three specific routes with a known, already-precedented per-repository pattern. Mixing a global filter into a "should be a small, reviewable bugfix" PR would also mask the more precise `404` semantics that `ParseUUIDPipe` + repository guards already give the two truly-not-found cases (valid UUID, no row) vs the malformed-input case (invalid UUID) — a blanket `400` filter can't distinguish those without also inspecting query context.
- **Trade-offs**: The global filter would be less code (one filter vs three call-site edits) but weaker semantics (always `400`, never lets a repository choose `404` for a domain-appropriate "not found" framing) and higher review risk (touches every controller's error path at once). Tracked separately per the issue's own text; not part of this plan.

### Alternative 2: Validate UUID shape with a custom `class-validator` decorator on a request DTO instead of `ParseUUIDPipe`
- **Description**: Introduce a `GetOfferMappingParamsDto` / similar per-route DTO with `@IsUUID()` and bind it via `@Param()` with `ValidationPipe`, following the `class-validator` DTO convention used for request *bodies* elsewhere in the codebase (`docs/engineering-standards.md § Validation`).
- **Why Rejected**: `docs/engineering-standards.md § Validation` shows DTO + `class-validator` for **body** validation; every existing UUID **path-param** validation in this codebase (`sync.controller.ts`, `webhook-delivery.controller.ts`, `ai/prompt-templates.controller.ts`, and this same `listings` module's `bulk-listing.controller.ts` / `bulk-shop-publish.controller.ts`) uses the built-in `ParseUUIDPipe` directly on the param, with no DTO wrapper. Introducing a DTO-based pattern here would be a new, unjustified abstraction for a single scalar param, directly contradicting the "use existing patterns, no unnecessary abstractions" principle and the issue's own instruction to be "consistent with `sync`, `webhooks`, and other controllers that already use `ParseUUIDPipe`."
- **Trade-offs**: A DTO gives richer OpenAPI/Swagger metadata for a param object, but there is no object here — just one scalar string per route. Not worth the added file.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No hexagonal-layer violation: the controller change stays in the interface layer, the repository change stays in the infrastructure layer, no domain-layer file is touched, no framework leaks into `domain/`.
- ✅ Repository still throws only domain-shaped outcomes (`null` / `OfferCreationRecordNotFoundException`) — no `QueryFailedError` (an infrastructure type) escapes the repository, per `docs/engineering-standards.md § Error Handling § Repository error handling pattern`.
- **Reference**: [Architecture Overview](../architecture-overview.md)

### Naming Conventions
- ✅ No new files, so no new naming decisions. Existing file/class names (`ListingsController`, `OfferMappingRepository`, `OfferCreationRecordRepository`, `OfferCreationRecordNotFoundException`) are unchanged.
- **Reference**: [Engineering Standards - Naming Conventions](../engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅ `ParseUUIDPipe` usage matches `bulk-listing.controller.ts` / `bulk-shop-publish.controller.ts` (same module) exactly.
- ✅ Repository guard matches `ConnectionRepository`'s exact `error instanceof QueryFailedError && 'code' in error && error.code === '22P02'` check (not the looser `instanceof QueryFailedError`-only variant used elsewhere), per the issue's explicit call-out of `ConnectionRepository` as "the canonical pattern to copy."

### Risks
- **Risk: swallowing a *different* `22P02` on some other column in the same query in the future.** Today `findById(id)` (and `findOne({ where: { id } })` in `updateStatus`) filters on exactly one `uuid` column, so a `22P02` can only originate from `id`. If a future change adds another `uuid`-typed filter to these same `where` clauses, a `22P02` from that *other* column would also be silently treated as "id not found," which would be a slightly misleading (but still safe — never a 500, never data leakage) degradation. Mitigation: none needed now; flag in code comment if a second uuid column is ever added to these specific queries (same latent risk already accepted by `ConnectionRepository`, so this doesn't introduce a new class of risk).
- **Risk: `updateStatus`'s new `22P02` guard changes behavior for a caller that (hypothetically) already relied on a raw `QueryFailedError` propagating.** Verified via `grep` (see § 4) that every current caller (`offer-status-poll.service.ts`, `offer-creation-execution.service.ts`) always passes `record.id` — a value that already came from a prior valid `OfferCreationRecord` read, never raw external input — so this branch is currently unreachable in production and the change is behavior-neutral for existing callers. No test exists today asserting the old (uncaught) behavior, so there is nothing to break.

### Edge Cases
- **Non-UUID id containing SQL-meta characters** (e.g. `'; DROP TABLE --`): already safe today (TypeORM's parameterized `findOne`/query-builder never interpolates raw input into SQL — the `22P02` is Postgres's *type-cast* error, not an injection). `ParseUUIDPipe` now rejects such values before they even reach TypeORM, which is strictly safer, but there was no injection risk being introduced or fixed here — worth noting in the PR description to avoid over-claiming a security fix beyond "cleaner error semantics + noise reduction."
- **Empty-string id** (`GET /listings/` with a trailing slash resolving oddly, or a client sending `id=''`): `ParseUUIDPipe` rejects empty string as not a valid UUID → `400`. Today this would also 500 (empty string also fails the `uuid` type cast) — same fix, no special-casing needed.
- **Valid UUID, different `entityType`** (e.g., a valid `identifier_mappings.id` that maps to `entityType='Product'`, not `'Offer'`): unaffected by this change — `OfferMappingRepository.findById` already scopes `WHERE entityType = 'Offer'`, so this continues to resolve as "not found" exactly as it does today. Not a regression risk.
- **Case sensitivity of UUID input** (uppercase-hex UUID string): `ParseUUIDPipe` accepts both cases (RFC 4122 is case-insensitive), matches Postgres's own `uuid` type cast behavior. No behavior change expected.

### Backward Compatibility
- ✅ No breaking change. The only externally-visible difference is the HTTP status code for a request that was already broken (malformed id): `500` → `400`. No client that depends on the current `500` response exists or could exist (a `500` is never a documented/relied-upon success path); Swagger docs for these three routes never listed `500` as an expected response (verified: existing `@ApiResponse` decorators list `200`/`404`/`403`/`422` only, never `500`), so this fix also makes the actual behavior match the already-documented contract more closely. Adding `@ApiResponse({ status: 400, ... })` decorators is a documentation nicety worth including in the PR but is not required for the fix to be correct.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

**File**: `libs/core/src/listings/infrastructure/persistence/repositories/offer-mapping.repository.spec.ts` (**new file** — none exists today for this repository)
- Set up a `Test.createTestingModule` providing `OfferMappingRepository` with a mocked `Repository<IdentifierMappingOrmEntity>` (`findOne`, `createQueryBuilder` jest-mocked), matching the DI-test-setup style already used by sibling repository specs (e.g. `offer-creation-record.repository.spec.ts`, `connection-cursor.repository.spec.ts`).
- `describe('findById')`:
  - `it('should return the mapped domain entity when found')` — `findOne` resolves an entity; asserts the returned `IdentifierMapping` shape.
  - `it('should return null when not found')` — `findOne` resolves `null`; asserts `null`.
  - `it('should return null when the driver raises a 22P02 QueryFailedError (invalid UUID)')` — `findOne` rejects with `new QueryFailedError('...', [], '')` with `.code = '22P02'` set (per the `connection-cursor.repository.spec.ts` construction pattern); asserts the method resolves to `null`, not a rejection.
  - `it('should re-throw a QueryFailedError with a different code')` — `findOne` rejects with a `QueryFailedError` whose `.code` is e.g. `'23505'` (or `undefined`); asserts the method rejects with that same error (regression guard against over-broadly swallowing all `QueryFailedError`s, matching the issue's explicit "code `22P02`" scoping rather than the looser `instanceof`-only variant).

**File**: `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.spec.ts` (**existing file** — extend)
- Add to the existing `describe('findById')` block (or create one if none exists — confirm exact existing structure while implementing):
  - `it('should return null when the driver raises a 22P02 QueryFailedError (invalid UUID)')` — same shape as above.
  - `it('should re-throw a QueryFailedError with a different code')` — same regression guard as above.
- Add to the existing `describe('updateStatus')` block:
  - `it('should throw OfferCreationRecordNotFoundException when the driver raises a 22P02 QueryFailedError (invalid UUID)')` — `findOne` rejects with a `22P02`-coded `QueryFailedError`; asserts `rejects.toThrow(OfferCreationRecordNotFoundException)`.
  - `it('should re-throw a QueryFailedError with a different code')` — same regression guard.

**File**: `apps/api/src/listings/http/listings.controller.spec.ts` (**existing file** — no changes required)
- All existing tests for `getOfferMapping`, `getMarketplaceOffer`, `getOfferCreationStatus` call the controller method directly with string args and remain valid unchanged (`ParseUUIDPipe` only executes inside Nest's request pipeline, which these unit tests don't exercise — see § 4 for why). No new unit test is added here; the `ParseUUIDPipe` behavior itself is verified at the integration level below.

### Integration Tests

**File**: `apps/api/test/integration/listings-invalid-path-id.int-spec.ts` (**new file**)
- Uses the standard Postgres+Redis Testcontainers harness (`getTestHarness` / `resetTestHarness` / `teardownTestHarness` from `./setup`), matching the pattern in `listings-seller-policies.int-spec.ts`. No PrestaShop Testcontainer needed (nothing here depends on PrestaShop's actual response — this is pure input-validation at the OL boundary).
- `beforeAll`: boot harness, `loginAsAdmin` for a bearer token (matching `listings-seller-policies.int-spec.ts`'s auth setup).
- `describe('GET /listings/:id')`:
  - `it('returns 400 for a non-UUID id')` — `GET /listings/ol_variant_2dab6f6bd3a542b3b6e86a1bc6696150` (the exact reproduction value from the issue) → `.expect(400)`.
  - `it('returns 404 for a well-formed but absent UUID')` — `GET /listings/<random valid uuid>` → `.expect(404)` (regression guard: confirms Phase 1 didn't accidentally change the already-correct 404 path).
- `describe('GET /listings/:id/offer')`:
  - `it('returns 400 for a non-UUID id')` — same shape.
- `describe('GET /listings/connections/:connectionId/offers/creation/:offerCreationRecordId')`:
  - `it('returns 400 for a non-UUID offerCreationRecordId')` — `GET /listings/connections/<valid-conn-uuid>/offers/creation/not-a-uuid` → `.expect(400)`.
  - `it('returns 404 for a non-UUID connectionId (unguarded, falls through to not-found)')` — `GET /listings/connections/not-a-uuid/offers/creation/<valid-record-uuid>` → `.expect(404)` (confirms the deliberate Out-of-Scope decision on `connectionId` behaves correctly and doesn't regress to `500`; this param never reaches the DB so it was already safe — this test documents and locks in that fact).

### Mocking Strategy
- Unit tests: mock the TypeORM `Repository<T>` (`findOne` jest-mocked to resolve/reject), per `docs/testing-guide.md` and `docs/engineering-standards.md § Mocking Ports` — never a real DB.
- Integration test: real Postgres via Testcontainers, real Nest app boot (so `ParseUUIDPipe`'s actual pipe-pipeline execution is exercised), no mocking.

### Acceptance Criteria
- [ ] `GET /listings/<non-uuid>` → `400` (was `500`).
- [ ] `GET /listings/<non-uuid>/offer` → `400` (was `500`).
- [ ] `GET /listings/connections/<conn>/offers/creation/<non-uuid>` → `400` (was `500`).
- [ ] `GET /listings/<valid-absent-uuid>` → `404` (unchanged).
- [ ] `GET /listings/<valid-absent-uuid>/offer` → `404` (unchanged).
- [ ] `GET /listings/connections/<conn>/offers/creation/<valid-absent-uuid>` → `404` (unchanged).
- [ ] `OfferMappingRepository.findById` never rejects with `QueryFailedError` for a `22P02` input; still rejects with any other error type unchanged.
- [ ] `OfferCreationRecordRepository.findById` / `updateStatus` never reject/propagate `QueryFailedError` for a `22P02` input; `updateStatus` throws `OfferCreationRecordNotFoundException` instead.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all pass with zero errors.
- [ ] `pnpm test:integration` passes for the new int-spec (requires Docker locally; CI runs it automatically).
- [ ] No DB migration generated (`pnpm --filter @openlinker/api migration:show` unchanged — confirms no schema drift was accidentally introduced).

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — interface-layer and infrastructure-layer changes only, no domain-layer or framework leakage.
- [x] Respects CORE vs Integration boundaries — entirely within the `listings` bounded context; no integration/adapter package touched.
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `ParseUUIDPipe` and the `ConnectionRepository` `22P02` guard verbatim; Alternatives section explicitly rejects introducing a new DTO/filter pattern.
- [x] Idempotency considered — not applicable (read-only GET routes; `updateStatus` guard doesn't change idempotency semantics, only which exception type a malformed id produces).
- [x] Event-driven patterns used where applicable — not applicable, no events involved.
- [x] Rate limits & retries addressed — not applicable, no external system call involved.
- [x] Error handling comprehensive — covered in § 6 Implementation Details and § 9 test plan; both the boundary (`400`) and defense-in-depth (repository → existing not-found contract) layers are specified.
- [x] Testing strategy complete — unit tests for both repositories (new + extended), integration test covering all three routes' `400` behavior plus regression coverage for the unchanged `404` behavior.
- [x] Naming conventions followed — no new classes/files besides two new test files, both following existing `*.spec.ts` / `*.int-spec.ts` conventions and existing directory placement.
- [x] File structure matches standards — repository specs colocated with their repositories (existing convention); new int-spec placed in `apps/api/test/integration/` (existing convention, matching `listings-seller-policies.int-spec.ts`).
- [x] Plan is execution-ready — every step names an exact file, an exact code change, and an exact acceptance check; no open questions remain.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
