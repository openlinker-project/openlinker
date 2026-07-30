# Implementation Plan — Require session-recording consent on the demo (#1938)

**Issue**: [#1938](https://github.com/openlinker-project/openlinker/issues/1938)
**Design spec + mockups**: https://claude.ai/code/artifact/4244d959-ef82-4d7f-b579-2167b56ce72d
**Branch**: `1938-require-session-recording-consent`

---

## 0. Decision: this is a condition, not a consent (settled in review on #1945)

The first implementation kept the consent vocabulary and made the checkbox
required and pre-ticked. Review flagged the contradiction: the code said
"condition" while the UI said "consent", and the migration comment had dropped
the CJEU Planet49 citation that previously justified an unticked box rather than
re-arguing it.

**Settled position: session recording is a condition of using the free demo, and
`users.analytics_consent` records acceptance of that condition.** The
registration form discloses it in a line of body copy under the submit button
(plus a "What we record" disclosure) and creating the account accepts it; there
is no checkbox, no validation error, and no "Agree" button anywhere. `/consent`
collects the same acceptance from accounts created before the rule, with
**Continue** / **Sign out**.

Why not keep the consent basis: a consent that cannot be declined without losing
access is not freely given, and Art. 7(3) then obliges a withdrawal path as easy
as giving — which the removal of the Settings tile deleted. Dropping the consent
framing removes that obligation by not invoking the basis that creates it, and it
is honest about what the demo actually offers. Declining carries no detriment:
the demo is free, optional, and runs only on synthetic data (a requirement made
load-bearing when masking was narrowed to passwords in #1877/#1878 — the two
changes now depend on each other).

The rejected alternative was: unticked box + a visible "withdraw and delete my
demo account" affordance in Settings. It is legally the more conservative shape,
but it reintroduces exactly the friction that left the demo unrecorded.

## 1. Goal

On a demo-mode instance, an account may only use the demo if it has accepted
session recording. Recording stops being an optional, ignorable checkbox and
becomes a condition of entry, enforced server-side. Both product affordances for
switching analytics off are removed, and `localStorage` stops being a second
source of truth for the flag.

**Layers touched**: Interface (FE routes/forms, API guard + DTO) and Application
(`RegistrationService`). No CORE change, no schema change (`users.analytics_consent`
already exists from #1743, migration `1827000000000`).

### Non-goals

- No self-service withdrawal affordance: the acceptance is not a consent that
  Art. 7(3) attaches to (see § 0). Servicing an erasure request stays a manual
  runbook over the existing `PATCH` endpoint plus deleting the PostHog recording.
- No SQL backfill of existing accounts: `/consent` collects a real acceptance.
- No change to `captureMarketingLanding` (independent of this flag by design).
- No PostHog-side retention change. Nothing deletes recordings today; no copy may
  claim otherwise.

---

## 2. Research findings (live repo)

| Fact | Location | Consequence for the design |
|---|---|---|
| Two global guards already registered | `apps/api/src/auth/auth.module.ts:82-83` (`APP_GUARD` × 2) | A third `APP_GUARD` is a one-line change; no controller edits. |
| `@Public()` sets metadata read by `Reflector` | `apps/api/src/auth/decorators/public.decorator.ts` | Copy the shape for `@SkipAnalyticsConsent()`. |
| JWT is stateless — no DB read per request | `apps/api/src/auth/strategies/jwt.strategy.ts` | Carry `analyticsConsent` as a claim, not a per-request query. |
| `/auth/refresh` re-issues via `authService.login(user)` with a DB-read user | `apps/api/src/auth/auth.controller.ts:269` | Refreshing the token after consent picks up the new claim. |
| `getSession()` reuses the cached in-memory access token | `apps/web/src/shared/auth/jwt-bearer-session-adapter.ts` | `refreshSession()` alone does NOT re-mint the token — the accept flow must call `adapter.refresh()` first. `SessionContextValue` already exposes `adapter`. |
| `AuthenticatedAppLayout` already redirects anonymous → `/login` | `apps/web/src/app/layouts/authenticated-app-layout.tsx:29-34` | The consent redirect is a sibling condition in the same component. |
| Guest routes are top-level siblings of `rootRoute`, each wrapping `GuestLayout` | `apps/web/src/app/router.tsx`, `login.route.tsx` | `/consent` renders outside `AppShell` for free by following the same shape, but needs its own layout (it requires an authenticated session, `GuestLayout` redirects those away). |
| `useUpdateAnalyticsConsentMutation` already calls `refreshSession()` | `apps/web/src/features/auth/hooks/` | Extend it with `adapter.refresh()`; its only caller after this change is the consent page. |
| `QueryClient` is created above the router | `apps/web/src/app/providers/app-providers.tsx:16-26` | A cache-level `onError` cannot use `useNavigate`; use a hard `window.location.assign` (which also re-boots and re-mints the token). |
| No name collisions | grep for `AnalyticsConsentGuard`, `SkipAnalyticsConsent`, `consent.route`, `AnalyticsConsentRequired` | All new symbols are genuinely new. |

Pre-implement gate: the collision + contract-surface checks above were run inline
(five greps, one label/route listing). The change adds no port, no ORM entity, no
Symbol token, and no top-level barrel export, so the full `/pre-implement` pass
would have nothing further to assert.

---

## 3. Implementation steps

### API

1. **`apps/api/src/auth/decorators/skip-analytics-consent.decorator.ts`** (new) —
   `SKIP_ANALYTICS_CONSENT_KEY` + `SkipAnalyticsConsent()`, mirroring `public.decorator.ts`.
2. **`apps/api/src/auth/exceptions/analytics-consent-required.exception.ts`** (new) —
   domain-shaped exception carrying the machine-readable code, used by both the guard
   and registration. Registration rejects with 400, the guard with 403; the exception
   holds the message + code, the throw site chooses the HTTP shape.
3. **`apps/api/src/auth/guards/analytics-consent.guard.ts`** (new) — short-circuits on
   non-demo mode, `@SkipAnalyticsConsent()`, missing `req.user`, non-`viewer` role, or
   `user.analyticsConsent === true`; otherwise throws
   `ForbiddenException({ code: 'ANALYTICS_CONSENT_REQUIRED', … })`.
4. **`apps/api/src/auth/auth.types.ts`** — `analyticsConsent: boolean` on `JwtPayload`
   and `AuthenticatedUser`; `JwtStrategy.validate` passes it through (defaulting a
   pre-deploy token without the claim to `false` — fail closed).
5. **`apps/api/src/auth/auth.service.ts`** — `login()` stamps the claim from the user.
6. **`apps/api/src/auth/auth.module.ts`** — third `APP_GUARD`.
7. **Allowlist** `@SkipAnalyticsConsent()` on `GET /auth/me`, `PATCH /auth/me/analytics-consent`,
   `POST /auth/refresh`, `POST /auth/logout` (the last two are already `@Public()`, so the
   decorator is belt-and-braces for the guard's own short-circuit) and `GET /system/config`.
8. **`apps/api/src/auth/dto/register.dto.ts`** — `analyticsConsent` required.
9. **`apps/api/src/auth/registration.service.ts`** — reject `demoMode && !analyticsConsent`
   before the rate-limit check; non-demo registration is unaffected.

### Frontend

10. **`register-form.schema.ts`** — the field leaves the form schema entirely: it is
    not a choice the visitor makes here.
11. **`register-form.tsx`** — a recording notice under the submit button (body copy +
    a quiet "What we record" disclosure); the submit handler sends
    `analyticsConsent: demoMode`. No checkbox, no consent validation, no
    error state to duplicate.
12. **`apps/web/src/features/demo/components/consent-gate.tsx`** (new) — the page body
    (copy, disclosure, Continue / Sign out actions). Lives in `features/demo` because it is
    demo-only and needs the demo copy; exported from the feature barrel.
13. **`apps/web/src/app/layouts/consent-layout.tsx`** (new) — guest-shaped chrome for an
    *authenticated* session: redirects anonymous → `/login`, and already-consented →
    `next`/`/` after re-minting the token (covers a token issued before the claim existed).
14. **`apps/web/src/app/routes/consent.route.tsx`** (new) + registration in `router.tsx`.
15. **`authenticated-app-layout.tsx`** — redirect demo viewer without consent to
    `/consent?next=…`.
16. **`apps/web/src/shared/api/analytics-consent-error.ts`** (new) —
    `isAnalyticsConsentRequiredError(error)` type guard over `ApiError.details.code`.
17. **`app-providers.tsx`** — `QueryCache` + `MutationCache` `onError` → hard-navigate to
    `/consent?next=…` when that guard matches and we are not already there.
18. **`use-update-analytics-consent-mutation.ts`** — `adapter.refresh()` before
    `refreshSession()` so the new claim lands in the access token.
19. **Removals** — `analytics-consent-tile.tsx` (+ test, barrel export, `settings-page.tsx`
    mount); `demo-analytics-consent.ts` (+ test), its three `demo.types.ts` exports and the
    barrel re-exports; `subscribeToDemoAnalyticsConsent` + the AppShell seeding effect,
    listener, and `handleDisableAnalytics`; `disableDemoAnalytics`; the
    `demo_analytics_disabled` catalog event; `analyticsActive` / `onDisableAnalytics` on
    `demo-banner.tsx`.
20. **`init-demo-integrations.ts`** — `initDemoIntegrations(config, hasConsent)`.

### Tests + docs

21. New: `analytics-consent.guard.spec.ts`, `consent-gate.test.tsx`, `consent-layout.test.tsx`.
22. Updated: `register-form.test.tsx`, `app-shell.test.tsx`, `settings-page.test.tsx`,
    `registration.service.spec.ts`, `auth.controller.spec.ts`, `auth.service.spec.ts`,
    `jwt-bearer-session-adapter.test.ts`, `use-update-analytics-consent-mutation.test.tsx`,
    `auth-analytics-consent.int-spec.ts`, `guest-layout.test.tsx`, `route-lazy.test.ts`.
23. Deleted: `analytics-consent-tile.test.tsx`, `demo-analytics-consent.test.ts`.
24. Docs: `one-command-demo-setup-guide.md` (consent-prompt + revoke paragraphs),
    `analytics-events.md` (consent-banner line), ADR-032 (opt-in rationale), and the
    migration comment in `1827000000000-add-user-analytics-consent.ts`.

---

## 4. Validation

- **Architecture**: no CORE ↔ Integration crossing. `shared/api` gains a pure type guard
  (no feature import). The consent page body lives in `features/demo`; the layout and route
  live in `app/` — matching the existing guest-route composition.
- **Naming**: `*.guard.ts`, `*.decorator.ts`, `*.exception.ts`, `*.route.tsx`, `kebab-case.tsx`.
- **Security**: the gate is enforced server-side by a global guard, so a tampered client
  cannot bypass it; the allowlist is minimal and explicit; no secret or token is logged.
- **Fail-closed**: a token predating the claim reads as no consent, and the consent layout
  silently re-mints for an account that already consented in the database.
