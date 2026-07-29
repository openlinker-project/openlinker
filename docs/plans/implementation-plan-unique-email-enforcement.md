# Implementation Plan: Unique-Email Enforcement on Registration (#1625)

**Date**: 2026-07-15
**Status**: Draft
**Estimated Effort**: 4-6 hours
**Issue**: https://github.com/openlinker-project/openlinker/issues/1625 (part of epic #1606)

---

## 1. Task Summary

**Objective**: Guarantee that a given email address maps to exactly one account, closing the one real gap left in an otherwise-already-implemented uniqueness path: case-insensitive collisions (`Foo@Example.com` registering alongside an existing `foo@example.com`).

**Context**: Issue #1625 assumed uniqueness enforcement didn't exist yet. Codebase research (this plan's Phase 0) found it mostly does:
- DB-level `UNIQUE (email)` constraint since the original users-table migration (`apps/api/src/migrations/1775000000000-add-users-table.ts:25`).
- Service-level pre-check in `RegistrationService.register` (`apps/api/src/auth/registration.service.ts:60-70`) throwing `UserAlreadyExistsException`.
- Repository-level backstop in `UserRepository.save` (`libs/core/src/users/infrastructure/persistence/repositories/user.repository.ts:101-114`) catching Postgres `23505` and converting it to the same domain exception — closes the pre-check race window.
- Controller mapping to HTTP 409 (`apps/api/src/auth/auth.controller.ts:114-135`, `ConflictException`).

What's missing is **normalization**: the `email` column is plain `varchar` with no case folding anywhere in the read or write path (verified: no `citext`, no `lower()` index, no `.toLowerCase()` in `UserRepository` or `RegistrationService`). Two accounts can exist today for the same mailbox differing only by case, and login-by-email in `password-reset.service.ts` would only ever find whichever exact-case row was queried.

**Classification**: CORE (domain exception unchanged) + Infrastructure (migration, repository) + Interface (frontend error UX). No new port or capability.

---

## 2. Scope & Non-Goals

### In Scope
- Normalize email to a canonical case (lowercase) at every write and read path so the existing `UNIQUE (email)` constraint becomes effectively case-insensitive.
- Backfill migration to lowercase existing `users.email` values before... actually alongside declaring the invariant, so pre-existing mixed-case duplicates don't silently violate the constraint mid-deploy.
- Add a focused unit test for the concurrent-registration race (two `save()` calls for the same normalized email, second must surface `UserAlreadyExistsException` via the `23505` catch path, not just the pre-check).
- Add a `isConflict()` helper to `ApiError` and a dedicated "email already in use" inline error on the registration form's email field (frontend UX gap identified in research).

### Out of Scope
- Building an email-confirmation flow — this repo uses an admin-approval model (`pending → active`), not email confirmation; the issue's mention of "unconfirmed duplicate signup" does not apply here and is treated as a no-op non-goal.
- Any change to the `UserAlreadyExistsException` shape or the existing pre-check/backstop pattern — both are correct as-is and are reused, not replaced.
- Normalizing `username` casing — out of scope; the issue is scoped to email only.
- Internationalized email normalization (IDN, Unicode case folding) — plain ASCII `.toLowerCase()` is the accepted default; documented as an assumption below.

### Constraints
- Must not require a new capability port — this stays entirely inside the `users` bounded context.
- Must not break the two existing `findByEmail` callers: `RegistrationService.register` and `PasswordResetService` (`apps/api/src/auth/password-reset.service.ts:50`) — both must query with the same normalization the write path uses, or lookups silently stop matching.
- Migration ordering: current tip on this checkout is `1818000000007` (confirmed via `pnpm --filter @openlinker/api migration:show`); the new migration must use a synthetic timestamp strictly after that, e.g. `1819000000000`.

---

## 3. Architecture Mapping

**Target Layer**:
- Infrastructure: `libs/core/src/users/infrastructure/persistence/repositories/user.repository.ts` (normalize before every query/insert), `apps/api/src/migrations/` (backfill + rely on existing unique constraint).
- Application (host): `apps/api/src/auth/registration.service.ts`, `apps/api/src/auth/password-reset.service.ts` — pass email through unchanged; normalization is centralized in the repository so every caller benefits without remembering to normalize.
- Interface (frontend): `apps/web/src/shared/api/api-error.ts`, `apps/web/src/features/users/components/register-form.tsx`.

**Capabilities Involved**: None new. `UserRepositoryPort` (`libs/core/src/users/domain/ports/user-repository.port.ts`) keeps its existing signature — normalization is an implementation detail of the adapter, not a contract change.

**Existing Services Reused**: `RegistrationService`, `PasswordResetService`, `UserRepository`, `UserAlreadyExistsException`, `ConflictException` mapping in `AuthController`.

**New Components Required**: none (no new entity, port, or exception — this is a hardening pass on existing components).

**Core vs Integration Justification**: This is CORE domain infrastructure (persistence adapter for the `users` context), not an integration — email uniqueness is a platform-wide invariant, not something that varies per external system.

---

## 4. External / Domain Research

### Internal Patterns
- **Repository-catches-infra-error-and-throws-domain-error** is the established pattern (`docs/engineering-standards.md § Error Handling`) and is already correctly applied in `UserRepository.save` — the normalization work extends this same method, it doesn't introduce a new pattern.
- **Self-healing migration pattern** for landing a constraint/backfill safely (see `docs/migrations.md § Recovery: duplicate migration timestamp` and `#1013`) — not strictly needed here since we're not renaming a migration, but the backfill migration should still be idempotent (`UPDATE ... WHERE email <> LOWER(email)`, safe to re-run).
- No existing `citext` usage anywhere in the schema — introducing it here would be a one-off pattern deviation; plain `.toLowerCase()` normalization at the application boundary is simpler and consistent with the rest of the codebase (no other unique text column in this repo uses `citext` or a functional index).

---

## 5. Questions & Assumptions

### Open Questions
- Should normalization also trim leading/trailing whitespace? Assumed yes (safe default, near-zero risk) — see Assumptions.
- Are there any existing production rows with case-colliding emails today? Cannot verify without querying production; the backfill migration is written to be safe either way (see Phase 2, Step 2 — it aborts loudly on a genuine post-backfill collision rather than silently dropping a row).

### Assumptions
- **Lowercase, not `citext`**: normalize to lowercase ASCII at the repository boundary and keep the plain `varchar` + `UNIQUE (email)` constraint. Rejected `citext` because it would be the first use of that extension in the schema and adds an operational dependency (`CREATE EXTENSION citext`) for no behavioral benefit over normalize-on-write.
- **No email-confirmation flow exists or is planned** in this repo (verified: `RegistrationService` goes straight to `pending`/`active` status, no token/confirmation entity found) — the issue's confirmation-flow caveat is treated as not applicable.
- Trimming whitespace is included in the same normalization step since it's a near-zero-risk, standard practice alongside case folding.

### Documentation Gaps
- None — `docs/lessons.md` has no prior entries on email/user uniqueness to reconcile with.

---

## 6. Proposed Implementation Plan

### Phase 1: Backend normalization
**Goal**: Make `foo@example.com` and `Foo@Example.com` collide everywhere email is written or read.

**Steps**:
1. **Add a normalization helper**
   - **File**: `libs/core/src/users/infrastructure/persistence/repositories/user.repository.ts`
   - **Action**: Add a private `normalizeEmail(email: string | null): string | null` (`email?.trim().toLowerCase() ?? null`). Apply it in `findByEmail` (normalize the query argument) and in `save` (normalize `user.email` before `ormRepository.create`).
   - **Acceptance**: `findByEmail('Foo@Example.com')` finds a row stored as `foo@example.com`; `save({ email: 'Foo@Example.com', ... })` persists `foo@example.com`.
   - **Dependencies**: none.

2. **Backfill migration**
   - **File**: `apps/api/src/migrations/1819000000000-normalize-user-emails.ts`
   - **Action**: `up()` runs `UPDATE users SET email = LOWER(TRIM(email)) WHERE email IS NOT NULL AND email <> LOWER(TRIM(email))`. Wrap in a pre-check: if this update would violate the existing `UQ_users_email` constraint (i.e. two rows normalize to the same value), the `UPDATE` fails naturally with `23505` — that is the desired behavior (surface the conflict loudly for manual resolution rather than silently merging/deleting a row). `down()` is a no-op (`// intentionally irreversible — original casing is not preserved`), consistent with other data-normalizing migrations in this repo having asymmetric down migrations where restoring original data isn't meaningful.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:run` succeeds against a fresh DB and against a DB with pre-existing mixed-case rows that don't collide; fails loudly (documented, expected) if two existing rows do collide after normalization.
   - **Dependencies**: Step 1 (so no new mixed-case rows are written between the migration running and app restart — deploy migration and code together, as is already the norm for this repo).

3. **Verify `PasswordResetService` still matches**
   - **File**: `apps/api/src/auth/password-reset.service.ts:50`
   - **Action**: No code change expected — `findByEmail` now normalizes internally, so the caller's raw-case input still resolves correctly. Add a regression assertion in its existing spec (see Testing Strategy) rather than modifying the service.
   - **Acceptance**: `password-reset.service.spec.ts` passes with a mixed-case lookup.

### Phase 2: Frontend error UX
**Goal**: Registering with a duplicate (or case-variant duplicate) email shows an unambiguous, field-attributed error instead of a generic alert.

**Steps**:
1. **Add `isConflict()` to `ApiError`**
   - **File**: `apps/web/src/shared/api/api-error.ts`
   - **Action**: Add `isConflict(): boolean { return this.status === 409; }`, mirroring the existing `isUnauthorized()/isForbidden()/isNotFound()` helpers.
   - **Acceptance**: Unit test asserts `new ApiError({ status: 409, ... }).isConflict() === true`.

2. **Surface a dedicated message in `register-form.tsx`**
   - **File**: `apps/web/src/features/users/components/register-form.tsx`
   - **Action**: In the existing error-render branch (around line 77-81), branch on `register.error.isConflict?.()` to render `"This email is already registered."` instead of the raw backend message, keeping the existing generic `Alert` as the fallback for all other error types. Do not add field-level validation wiring beyond this (React Hook Form's async server-error mapping for a single top-level alert is consistent with how other forms in this codebase already surface server errors — no new pattern needed).
   - **Acceptance**: Manually triggering a 409 (e.g. registering the same email twice in dev) shows the dedicated copy.

---

## 7. Alternatives Considered

### Alternative 1: Postgres `citext` column type
- **Description**: Change `email` to `citext`, drop the manual normalization.
- **Why Rejected**: First use of the extension in this schema; requires `CREATE EXTENSION citext` privilege in every environment (including CI Testcontainers image) and a type-level migration touching TypeORM's column mapping. Normalize-on-write achieves the identical guarantee with zero new infrastructure dependencies.
- **Trade-offs**: `citext` is slightly more defensive against a future direct-SQL write bypassing the repository; deemed unnecessary since all writes already go through `UserRepository.save`.

### Alternative 2: Functional unique index `UNIQUE (LOWER(email))`, keep stored casing
- **Description**: Preserve the user's original casing on display, enforce uniqueness via a functional index instead of normalizing storage.
- **Why Rejected**: `findByEmail` would then need `WHERE LOWER(email) = LOWER($1)` instead of an exact match, and the existing `UQ_users_email` constraint would need dropping in favor of the functional index — more migration surface for a benefit (preserved display casing) nobody has asked for; email isn't rendered back to the user anywhere in this codebase today.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No port signature change; normalization is a private implementation detail of `UserRepository`, consistent with `docs/architecture-overview.md § Repository Ports Pattern`.
- ✅ No CORE↔Integration boundary touched — everything stays inside `libs/core/src/users` and its host callers in `apps/api/src/auth`.

### Naming Conventions
- ✅ Migration filename/class follow `docs/migrations.md` timestamp convention (`1819000000000`, class suffix matches).

### Existing Patterns
- ✅ Reuses the established repository error-conversion pattern; reuses the established `ApiError.isX()` helper family on the frontend.

### Risks
- **Pre-existing case-colliding rows in a real deployment**: the backfill migration fails loudly instead of silently merging accounts — intentional (data-loss-avoidant), but means this migration is not silently zero-touch in an environment with actual collisions. Mitigation: document the failure mode in the migration's file header so an operator knows to manually resolve (rename or deactivate one account) before retrying.
- **Missed normalization call site**: if a future write path bypasses `UserRepository.save` (e.g. a raw SQL admin script), the invariant could be violated again. Mitigation: the DB-level `UNIQUE (email)` constraint remains the ultimate backstop regardless of case — a raw insert of `Foo@Example.com` when `foo@example.com` already exists would not be blocked by the DB constraint (case-sensitive), but this is accepted as an existing, unrelated gap in "someone bypasses the repository" scenarios generally, not something this plan can fully close without `citext` (Alternative 1, rejected).

### Edge Cases
- **Null email**: `UserOrmEntity.email` is nullable; `normalizeEmail(null)` must return `null`, not throw or produce `"null"`.
- **Already-lowercase input**: normalization must be idempotent — registering with `foo@example.com` twice must still hit the pre-check/backstop path unchanged.

### Backward Compatibility
- ✅ No breaking change to `UserRepositoryPort` or any consumer signature. The migration is additive/corrective data-only.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/users/infrastructure/persistence/repositories/user.repository.spec.ts` (create if absent, or extend): assert `findByEmail` normalizes its input and `save` normalizes before persisting.
- `apps/api/src/auth/registration.service.spec.ts`: extend existing duplicate-email cases with a case-variant case (`register('user2', 'FOO@EXAMPLE.COM', ...)` after `foo@example.com` exists → `UserAlreadyExistsException`).
- New test: concurrent-registration race — two `save()` invocations for the same normalized email where the pre-check passes for both (simulate by calling `save` directly, bypassing the service's pre-check), second call must throw `UserAlreadyExistsException` via the `23505` catch path in `UserRepository.save`.
- `apps/api/src/auth/password-reset.service.spec.ts`: add a mixed-case lookup regression case.
- `apps/web/src/shared/api/api-error.spec.ts` (or wherever `ApiError` is tested): `isConflict()` returns true only for status 409.

### Integration Tests
- Not required for this change — the unit-level Postgres-error-conversion path is already exercised at the unit level per this repo's existing test for `UserAlreadyExistsException`; a full `*.int-spec.ts` would duplicate that coverage against a real Testcontainers Postgres without adding meaningfully to confidence. If reviewers want a live-DB confirmation, add one assertion to an existing `test/integration/**/users*.int-spec.ts` if one exists — otherwise skip, per proportionality.

### Mocking Strategy
- Repository unit tests use a real in-memory-backed `Repository<UserOrmEntity>` mock or the existing `jest.Mocked<UserRepositoryPort>` pattern already used in `registration.service.spec.ts` — no new mocking pattern needed.

### Acceptance Criteria
- [ ] `foo@example.com` and `Foo@Example.com` cannot both register successfully.
- [ ] Existing duplicate-email (same-case) behavior is unchanged (still 409 via `UserAlreadyExistsException`).
- [ ] `PasswordResetService` still resolves a user regardless of the casing used at registration vs. the casing used to request a reset.
- [ ] Migration `1819000000000-normalize-user-emails.ts` runs cleanly on a fresh DB (`pnpm --filter @openlinker/api migration:run`) and `migration:show` reflects it as applied.
- [ ] Frontend registration form shows a dedicated "This email is already registered." message on a 409.
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions) — no new port, no new exception type
- [x] Idempotency considered — normalization and backfill are both idempotent
- [x] Event-driven patterns used where applicable — n/a, no event involved
- [x] Rate limits & retries addressed — unaffected, existing demo-mode rate limit untouched
- [x] Error handling comprehensive — reuses existing `UserAlreadyExistsException` → 409 mapping
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Migrations Guide](../migrations.md)
- [Code Review Guide](../code-review-guide.md)
