# Pre-Implementation Readiness Gate: Unique-Email Enforcement (#1625)

**Plan**: `docs/plans/implementation-plan-unique-email-enforcement.md`
**Date**: 2026-07-15
**Verdict**: ✅ **READY**

---

## Reuse Findings

| Plan Artifact | Classification | Evidence |
|---|---|---|
| `normalizeEmail()` private helper in `UserRepository` | **NEW (confirmed absent)** | `grep -rn "normalizeEmail\|toLowerCase\|LOWER(" libs/core/src/users` matches nothing in `users` domain/infrastructure — the only `.toLowerCase()` hits in `apps/api/src/auth` are unrelated boolean-flag parsing (`registration.service.ts:51`, `demo-mode.service.ts:21`, `bootstrap-admin.service.ts:49`). No existing email-normalization utility anywhere in the repo to reuse instead. |
| Migration `1819000000000-normalize-user-emails.ts` | **NEW** | Current tip on this checkout is `1818000000007-add-inventory-item-is-stale.ts`; `1819000000000` is strictly greater, satisfying the ordering invariant in `docs/migrations.md`. No existing migration touches `users.email` casing. |
| `ApiError.isConflict()` | **NEW (confirmed absent)** | `apps/web/src/shared/api/api-error.ts` has `isUnauthorized()` (401), `isForbidden()` (403), `isNotFound()` (404), `isServerError()` (≥500), `isNetworkError()` (0) — no `isConflict()`. Adding it at 409 follows the exact same one-line pattern as its siblings. |
| `register-form.tsx` conflict branch | **NEW** | Confirmed current file (lines 77-81) renders `register.error.message` verbatim inside a generic `<Alert>` with no status branching — matches the plan's stated gap exactly. |
| `libs/core/src/users/infrastructure/persistence/repositories/user.repository.spec.ts` | **NEW file** | `find libs/core/src/users -iname "*repository*spec*"` returns nothing — the plan's "create if absent" branch applies; no existing spec to extend. |
| `UserAlreadyExistsException`, `UserRepositoryPort`, `findByEmail`, repository's `23505` catch | **ALREADY EXISTS → reuse, unchanged** | Confirmed in prior research pass (`user.repository.ts:35-38,91-115`, `domain/exceptions/user-already-exists.exception.ts`). Plan correctly reuses these without modification. |

No collisions. Nothing the plan proposes to add already exists elsewhere under a different name.

---

## Backward-Compatibility Findings

| Surface | Check | Result |
|---|---|---|
| `UserRepositoryPort` signature | `findByEmail`/`save` signatures unchanged — normalization is internal to the method body | ✅ No break |
| Top-level barrel `@openlinker/core/users` | No export added/removed/renamed | ✅ No break |
| Symbol tokens | None touched | ✅ No break |
| DTOs (`RegisterDto`, register API request/response shapes) | Unchanged | ✅ No break |
| ORM schema | No column/table added; migration is data-only (`UPDATE ... SET email = LOWER(TRIM(email))`), existing `UQ_users_email` constraint retained | ⚠️ **Warning (expected, planned)**: a pre-existing case-colliding pair of rows will cause the migration to fail with `23505` rather than silently merge — this is the plan's documented, intentional behavior (Phase 6 Step 2, Risks section). Flagging only so the human running the migration is prepared for it, not as a defect.
| `check:invariants` | Migration timestamp ordering (`scripts/check-migration-timestamps.mjs`) | ✅ `1819000000000` sorts after the confirmed tip `1818000000007` — passes rule 3 (strictly greater than `origin/main`'s newest). No cross-context import added, so `check-cross-context-imports` is unaffected. No new service file requiring the `check-service-interfaces` interface rule (the repository already `implements UserRepositoryPort`). |

No Critical items. One expected Warning, already accounted for in the plan's own risk section.

---

## Open Questions

None blocking. The plan's own "Open Questions" section (production case-collision unknowable without a live query) is accepted as-is — the migration's fail-loud behavior is the correct mitigation and doesn't require resolving before implementation starts.

---

## Summary

The plan is ready to implement as written: every artifact it proposes to add (`normalizeEmail` helper, the backfill migration, `ApiError.isConflict()`, the register-form conflict branch, and a new `user.repository.spec.ts`) was confirmed absent from the live tree, so there is no reuse collision to resolve. Nothing it changes breaks a published contract — `UserRepositoryPort`'s signature, the `@openlinker/core/users` barrel, DI tokens, and DTOs are all untouched, and the one schema-adjacent risk (the backfill migration failing loudly on a genuine pre-existing case collision) is both expected and already documented as intentional in the plan itself. No revision needed before moving to implementation.
