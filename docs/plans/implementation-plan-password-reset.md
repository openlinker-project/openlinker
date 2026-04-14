# Implementation Plan — Password Reset Flow (#158)

## Goal
MVP password reset: `POST /auth/forgot-password`, `POST /auth/reset-password`, web pages, dev console delivery. No user enumeration, single-use tokens, 1h expiry.

## Layer classification
- CORE (users): repository port additions, domain entity + port for reset tokens, notifier port
- Infrastructure: new ORM entity + migration, token repository, console notifier adapter
- Interface (apps/api/auth): 2 new endpoints + DTOs, service wiring
- Frontend (apps/web): forgot-password page, reset-password page, link on login

## Non-goals
- Real email delivery (SMTP/provider) — notifier port + console impl only
- Rate limiting (document as follow-up)
- MFA / security questions
- Account lockouts

## Backend steps

### 1. Extend `UserRepositoryPort`
File: `libs/core/src/users/domain/ports/user-repository.port.ts`
- Add `findByEmail(email: string): Promise<User | null>`
- Add `updatePasswordHash(userId: string, passwordHash: string): Promise<void>`

### 2. Implement in `UserRepository`
File: `libs/core/src/users/infrastructure/persistence/repositories/user.repository.ts`

### 3. Password reset token domain
- `libs/core/src/users/domain/entities/password-reset-token.entity.ts` — `{ id, userId, tokenHash, expiresAt, usedAt|null, createdAt }`
- `libs/core/src/users/domain/ports/password-reset-token-repository.port.ts` — `save`, `findActiveByTokenHash`, `markUsed`, `invalidateActiveForUser(userId)`
- `libs/core/src/users/domain/ports/password-reset-notifier.port.ts` — `notifyResetRequested(user, rawToken)` + export token symbol

### 4. ORM + repo + migration
- `libs/core/src/users/infrastructure/persistence/entities/password-reset-token.orm-entity.ts` — table `password_reset_tokens` (id uuid PK, user_id FK→users, token_hash varchar unique, expires_at timestamptz, used_at timestamptz null, created_at timestamptz)
- `libs/core/src/users/infrastructure/persistence/repositories/password-reset-token.repository.ts`
- Migration via `pnpm --filter @openlinker/api migration:generate`
- Export entity in `libs/core/src/users/index.ts`
- Register in `UsersModule` (TypeOrmModule.forFeature, provider + token, export)

### 5. Console notifier adapter
- `apps/api/src/auth/adapters/console-password-reset-notifier.adapter.ts` — logs reset link (e.g. `${WEB_URL}/reset-password/${token}`) using shared Logger

### 6. Application service
- `apps/api/src/auth/password-reset.service.interface.ts`
- `apps/api/src/auth/password-reset.service.ts`
  - `requestReset(email)`: always success; if user exists, invalidate old tokens, generate 32-byte token, store SHA-256 hash, notify
  - `resetPassword(rawToken, newPassword)`: lookup by hash, check expiry+unused, bcrypt hash new password, update user, mark token used
- Validate `newPassword` min length 8 (domain error → 400)

### 7. DTOs + controller endpoints
- `apps/api/src/auth/dto/forgot-password.dto.ts` — `email` (@IsEmail)
- `apps/api/src/auth/dto/reset-password.dto.ts` — `token` (@IsString), `newPassword` (@MinLength(8))
- `AuthController`: `@Public() POST /auth/forgot-password` → always 200; `@Public() POST /auth/reset-password` → 200 on success, 400 on invalid/expired

### 8. Module wiring
- `AuthModule`: provide `PasswordResetService`, bind notifier port to `ConsolePasswordResetNotifier`, inject `WEB_URL` via ConfigService

### 9. Unit tests
- `password-reset.service.spec.ts`: success, expired token, used token, unknown token, unknown email still returns ok, invalidates existing tokens on new request
- `auth.controller.spec.ts`: new endpoint tests (no enumeration)

## Frontend steps

### 10. API + types
- `apps/web/src/features/auth/api/auth.api.ts`: add `forgotPassword({email})` and `resetPassword({token, newPassword})`
- Types in `auth.types.ts`

### 11. Hooks
- `use-forgot-password.ts` (mutation)
- `use-reset-password.ts` (mutation)

### 12. Pages
- `apps/web/src/pages/auth/ForgotPasswordPage.tsx` — email form; on submit show generic "If an account exists, you'll receive instructions"
- `apps/web/src/pages/auth/ResetPasswordPage.tsx` — reads `:token` param; password + confirm fields; on success redirect to `/login`
- Add "Forgot password?" link on `LoginForm.tsx`
- Register routes in router

### 13. Tests
- Form schemas (zod) + component smoke tests

## Quality gate
`pnpm lint && pnpm type-check && pnpm test`

## Risks
- Migration generation requires running DB — use dev stack
- No rate limiting → document follow-up issue
