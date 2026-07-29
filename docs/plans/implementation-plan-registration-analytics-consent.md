# Implementation Plan — Registration analytics consent (#1743)

## Goal

Move demo analytics (PostHog) consent from a post-login banner prompt to a **default-on checkbox at registration**, persisted on the user account so login needs no prompt.

Layer: **Interface + Infrastructure + Frontend** (thin BE persistence, one vertical slice).
Non-goals: no change to what PostHog captures or its masking; no new settings screen; consent stays demo-mode-relevant only.

## Design

`analyticsConsent` flows: RegisterDto → RegistrationService → UserRepository.save → User entity/ORM/DB → UserResponseDto (`/auth/me`) → FE `MeResponse`/`SessionUser` → app-shell seeds consent (localStorage cache) → PostHog init, no prompt.

Default-on: DTO field optional, missing ⇒ `true`; DB column `default true`; FE adapter `?? true`.

## Steps

### Backend
1. `libs/core/.../domain/entities/user.entity.ts` — add `public readonly analyticsConsent: boolean = true` as the last constructor param (default keeps all 18 existing `new User(...)` call sites compiling).
2. `libs/core/.../infrastructure/persistence/entities/user.orm-entity.ts` — `@Column({ name: 'analytics_consent', type: 'boolean', default: true })`.
3. `user.repository.ts` — map `analyticsConsent` in `toDomain` + persist in `save`.
4. `user-repository.port.ts` — widen `save` Pick with `'analyticsConsent'`.
5. `apps/api/src/migrations/1827000000000-add-user-analytics-consent.ts` — `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "analytics_consent" boolean NOT NULL DEFAULT true`.
6. `register.dto.ts` — `@IsBoolean() @IsOptional() analyticsConsent?: boolean`.
7. `registration.service.ts` (+ interface) — accept `analyticsConsent` arg (default `true`), pass to `save`.
8. `auth.controller.ts` — pass `dto.analyticsConsent` to `register(...)`.
9. `user-response.dto.ts` — expose `analyticsConsent` + map in `fromDomain`.

### Frontend
10. `session.types.ts` — add `analyticsConsent: boolean` to `MeResponse` + `SessionUser`.
11. `jwt-bearer-session-adapter.ts` — map `analyticsConsent: data.analyticsConsent ?? true`.
12. `auth.types.ts` (`RegisterRequest`) — add `analyticsConsent: boolean`.
13. `register-form.schema.ts` — add `analyticsConsent: z.boolean()` (default `true`).
14. `register-form.tsx` — pre-checked checkbox above submit, demo-mode only; submit the value.
15. `demo-banner.tsx` — remove `consentPending` prop + accept/decline branch; keep quiet `Analytics on` + Disable.
16. `app-shell.tsx` — seed consent from `session.user.analyticsConsent` (write-through to localStorage cache) instead of prompting; drop `consentPending` wiring.

### Tests
17. Update/extend: `register-form.test.tsx` (checkbox present/checked, demo-only), `registration.service.spec.ts` (consent true/false/absent persisted), `user-response.dto.spec.ts` (field exposed), `demo-banner` (no accept prompt).

## Validation
- Hexagonal: domain entity stays framework-free; port Pick widened, not the repo class leaking; FE dependency direction unchanged (`shared/ui` demo-banner still consent-agnostic).
- `pnpm lint && type-check && test`; `migration:show` clean.
