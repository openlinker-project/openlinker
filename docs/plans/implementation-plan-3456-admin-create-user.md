# Implementation plan — #3456: admin creates a user account with a role (packer)

**Issue:** #3456 (epic #3460, step 2 of the OMS onboarding wizard) · **Branch:** `3456-admin-create-user` from `main` (independent of the routing stack).

## 1. Understand

**Goal.** An admin creates an account directly — typically a packer, often someone without a work email — and hands them a one-time password that they must change at first sign-in. Today there is no way to do this: `UsersController` has list / approve / reject / role / deactivate / reactivate / delete only, and self-registration is off outside demo mode.

**Layer.** Interface + Application (`apps/api` users + auth), plus a small CORE users-context change (two columns, one repository write, one exception) and one migration.

**Non-goals.**
- **All frontend**, per the issue ("Frontend consumption is part of #3457"): the wizard's "Add packers" form, a Users-page "Add user" button, AND the first-sign-in change-password screen plus the redirect on `PASSWORD_CHANGE_REQUIRED`. The existing `/reset-password/:token` page is an emailed-token reset and does not serve a signed-in user; its form can be reused by #3457. Nothing creates accounts through this endpoint before #3457 ships, so the backend gate strands nobody in the meantime.
- Emailing the password. It is shown once to the admin, who hands it over (the mockup's flow).
- Password complexity rules beyond the existing 8–72 characters.

## 2. Research

- `User` has **no display name**. Every surface uses `username`, including `GET /users/packers`. The mockup shows a name ("Anna Kowalska") on the packer list and on the status page, and the issue's body carries `name`, so a nullable `displayName` column is added. It is projected where a user is listed, and `username` stays the login.
- There is **no change-password endpoint for a signed-in user**. Only `forgot-password` / `reset-password` exist, both via an emailed token, which a packer without email cannot use.
- **The closest enforcement pattern is the demo analytics-consent gate (#1938).** The flag rides on the JWT, a global `AnalyticsConsentGuard` returns 403 with a machine-readable `code`, a `@SkipAnalyticsConsent()` decorator exempts the routes that resolve it, `/auth/refresh` re-reads the user and re-mints the token, and the frontend redirects on the code (`apps/web/src/shared/api/analytics-consent-error.ts`). The forced password change copies this shape exactly.
- `RegistrationService` hashes with bcrypt (`BCRYPT_COST`) and raises `UserAlreadyExistsException`, deliberately vague about which field for public enumeration reasons. `username`/`email` carry DB unique constraints, so a race surfaces as a unique violation. Usernames may not contain `@` (the login identifier routes on it).
- The route-coverage spec discovers controllers and requires `@Roles`/`@AnyRole`/`@Public` on every route.

## 3. Design

### 3.1 Schema (one migration, `/migrate`)
`users.display_name varchar NULL` and `users.must_change_password boolean NOT NULL DEFAULT false`. Existing accounts read `false`, so nobody is locked out on deploy.

### 3.2 CORE (users context)
- `User` gains `displayName: string | null = null` and `mustChangePassword: boolean = false`, appended last because the constructor is positional.
- `UserRepositoryPort.save` accepts optional `displayName` and `mustChangePassword`. `updatePasswordHash(userId, hash, { clearMustChangePassword })` gains an option, so the change and the flag clear happen in ONE statement and a crash between them cannot leave a changed password still flagged.
- New `UserIdentifierTakenException(field: 'username' | 'email')` for the admin path. The admin already sees every account, so naming the field leaks nothing, unlike public registration, whose vague exception stays as it is.

### 3.3 `POST /users` (admin)
- `@Roles('admin')`. Body `CreateUserDto`: `displayName` (1–120), `username` (no `@`, same rule as registration), optional `email` (`@IsEmail`), `role` (`@IsIn(UserRoleValues)`).
- `UserManagementService.createUser` checks username then email (→ 409 naming the field), generates the temporary password with `crypto.randomBytes` (URL-safe, ~16 chars, never logged), bcrypt-hashes it, and saves `status: 'active'` with `mustChangePassword: true`. A DB unique violation from a concurrent create also maps to 409.
- Response `CreateUserResponseDto { id, temporaryPassword }`, 201. The password exists only in this response and is never stored, logged or returned again.

### 3.4 Forced change at first sign-in
- JWT gains a `mustChangePassword` claim (absent = `false`, so tokens minted before deploy keep working); `JwtStrategy` normalises it.
- A new global `PasswordChangeRequiredGuard` (fourth `APP_GUARD`, after `AnalyticsConsentGuard`) answers 403 `{ code: 'PASSWORD_CHANGE_REQUIRED' }` for any authenticated route unless it carries `@AllowPasswordChangeRequired()`. The exempt routes are `GET /auth/me` and the new change route. Refresh and logout are `@Public()` and pass anyway.
- New `POST /auth/me/password` (`@AnyRole()`, exempt): `{ currentPassword, newPassword }` (8–72). It verifies the current password, refuses a new password equal to the current one, and writes the hash and clears the flag in one statement. It answers 400 (never 401) on a wrong current password, so the client's session handling does not loop. It does NOT revoke other sessions: no revoke-all primitive exists (the emailed reset does not revoke either), and a freshly created account has no session besides the one changing the password; revoking on change is a separate follow-up. The client then calls `/auth/refresh` to get a token without the claim. The route is useful for any user, not only forced ones.
- `GET /auth/me` exposes `mustChangePassword` and `displayName`.

## 4. Steps
1. Migration + ORM entity columns (`/migrate`); `migration:show`.
2. `User` entity, repository `toDomain`/`save`/`updatePasswordHash`, port; `UserIdentifierTakenException`.
3. `CreateUserDto`, `CreateUserResponseDto`, `UserManagementService.createUser` (+ interface) and `UsersController` `POST /users`, with an exception→409 mapping. Specs: service (hash stored not plaintext, flag set, 409 per field, race → 409, password not logged) and controller.
4. JWT claim + strategy; `PasswordChangeRequiredGuard` + decorator + `APP_GUARD`; `POST /auth/me/password`; `/auth/me` fields. Specs: guard (blocks, exempts, fails closed), change-password (wrong current → 400, same password → 400, clears the flag in one write). The consent route and the password route each carry both exemptions, so an admin-created demo viewer cannot deadlock between the two gates.
5. Route-coverage spec passes with the new routes; `UserSummaryDto` / packer DTO project `displayName`.
6. Docs: architecture-overview (users/auth) bullet; `apps/api/.env.example` untouched (no new env).

## 5. Validate
- Security: admin-only create; password generated server-side from CSPRNG, bcrypt-hashed, returned once, excluded from logs (spec asserts the logger never receives it); the flag is enforced server-side by a guard, not by the UI; the change route re-verifies the current password.
- Compatibility: existing accounts `mustChangePassword = false`; tokens without the claim read `false`.
- Architecture: domain entity stays framework-free; controllers stay thin; tokens via existing `USER_REPOSITORY_TOKEN`.
- Everything local: no commits, pushes or GitHub writes until told to ship. Tests run in CI.

## Decisions (agreed)
1. Backend only; the change-password screen belongs to #3457.
2. `displayName` is added as a nullable column — the issue's body requires `name`, and nothing holds one today.
