# Implementation Plan — #889 Allegro OAuth `/me` REST API host fix

**Branch:** `889-fix-allegro-oauth-me-rest-host`
**Issue:** [#889](https://github.com/openlinker-project/openlinker/issues/889)
**Classification:** Integration / Infrastructure / Bug

---

## 1. Goal

Stop calling `GET /me` against the Allegro OAuth/site host (returns 403 on sandbox). Use the REST API host instead — `https://api.allegro.pl.allegrosandbox.pl/me` on sandbox, `https://api.allegro.pl/me` on production.

Token exchange continues to use the OAuth/site host (the existing — and correct — behaviour for `/auth/oauth/authorize` and `/auth/oauth/token`).

## 2. Non-goals

- Hoisting URL constants into the shared factory (`allegro-adapter.factory.ts`) — flagged as follow-up in the issue. The same OAuth-host / REST-API-host pair is currently duplicated across three files; convergence is a separate refactor.
- Changing the `OAuthCompletionPort` contract or the neutral `OAuthCredentialBlob` shape.
- Adding new env vars / runtime config / Allegro API features.
- Touching credentials persistence or the per-connection `AllegroHttpClient`.
- Production OAuth verification — that's an AC for the PR reviewer / shipper, not a code change.

## 3. Root cause (recap)

`allegro-oauth-completion.adapter.ts:39-40` defines two constants named `*_API_BASE_URL` whose **values** are the OAuth/site hosts (`allegro.pl` / `allegro.pl.allegrosandbox.pl`). The single `getApiBaseUrl()` helper feeds those values into three call sites:

- `buildAuthorizationUrl` → `/auth/oauth/authorize` — ✅ correct (OAuth UI host)
- `exchangeCode` → `/auth/oauth/token` — ✅ correct (Allegro hosts the token endpoint on the OAuth host)
- `fetchAccountIdentity` → `AllegroAccountReader.fetchSellerIdentity(baseUrl, ...)` → `GET /me` — ❌ wrong (`/me` is a REST API call; it lives on the `api.` subdomain)

Other code in the package already uses the correct REST API host:
- `allegro-adapter.factory.ts:154-162` (per-connection `AllegroHttpClient`)
- `allegro-connection-tester.adapter.ts:25-28`

Two existing tests lock in the bug:
- `allegro-oauth-completion.adapter.spec.ts:173` asserts the wrong URL is passed to `fetchSellerIdentity`
- `allegro-account-reader.spec.ts:12` declares `BASE_URL` as the OAuth host (opaque mocked value, so the test passes regardless)

## 4. Files

| File | Change |
|---|---|
| `libs/integrations/allegro/src/infrastructure/adapters/allegro-oauth-completion.adapter.ts` | Split URL constants into OAuth-host pair + REST-API-host pair; add `getRestApiBaseUrl()` helper; wire `fetchAccountIdentity` to the REST host |
| `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-oauth-completion.adapter.spec.ts` | Flip the assertion at line ~173 that locks in the wrong URL; add a sandbox case asserting the sandbox REST API host |
| `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-account-reader.spec.ts` | Fix the misleading `BASE_URL` constant so future readers don't copy the wrong pattern |

No domain entity changes, no migrations, no port-shape changes, no module wiring changes.

## 5. Steps

### Step 1 — Adapter constants + helpers

In `libs/integrations/allegro/src/infrastructure/adapters/allegro-oauth-completion.adapter.ts`:

1. Rename existing `SANDBOX_API_BASE_URL` / `PRODUCTION_API_BASE_URL` → `SANDBOX_OAUTH_BASE_URL` / `PRODUCTION_OAUTH_BASE_URL` (values unchanged — they were always the OAuth host).
2. Add new constants:
   ```ts
   const SANDBOX_REST_API_BASE_URL = 'https://api.allegro.pl.allegrosandbox.pl';
   const PRODUCTION_REST_API_BASE_URL = 'https://api.allegro.pl';
   ```
3. Rename `getApiBaseUrl()` → `getOAuthBaseUrl()`; switch on `environment` exactly as before, but return the renamed OAuth constants.
4. Add `getRestApiBaseUrl()` — identical structure, returns the REST API constants. The default-on-unknown-environment branch matches `getOAuthBaseUrl`'s posture (defaults to sandbox + warns).
5. Wire call sites:
   - `buildAuthorizationUrl` (line ~48) → `getOAuthBaseUrl(...)`
   - `exchangeCode` (line ~59) → `getOAuthBaseUrl(...)`
   - `fetchAccountIdentity` (line ~137) → `getRestApiBaseUrl(...)`
6. Update the file header comment if it mentions the now-renamed helper.

**Acceptance:** `pnpm --filter @openlinker/integrations-allegro build` passes.

### Step 2 — Adapter spec

In `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-oauth-completion.adapter.spec.ts`:

1. Find the assertion at ~line 173 that does `expect(reader.fetchSellerIdentity).toHaveBeenCalledWith('https://allegro.pl', 'at-1');`. Flip the URL to `'https://api.allegro.pl'`.
2. Add (or extend) a sandbox case asserting `fetchSellerIdentity` is called with `'https://api.allegro.pl.allegrosandbox.pl'` when `environment: 'sandbox'`.
3. Confirm existing `buildAuthorizationUrl` + `exchangeCode` tests continue to assert the OAuth host — those paths' behaviour is unchanged and the assertions should still pass without edits.

**Acceptance:** `pnpm --filter @openlinker/integrations-allegro test -- allegro-oauth-completion.adapter.spec` green.

### Step 3 — Account-reader spec

In `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-account-reader.spec.ts`:

1. Change `const BASE_URL = 'https://allegro.pl.allegrosandbox.pl';` → `const BASE_URL = 'https://api.allegro.pl.allegrosandbox.pl';`.

Pure documentation fix — the mock matches any URL the adapter constructs, so the test passes either way. The purpose is to stop future readers from copy-pasting the wrong pattern.

**Acceptance:** `pnpm --filter @openlinker/integrations-allegro test -- allegro-account-reader.spec` green.

### Step 4 — Quality gate

```bash
pnpm --filter @openlinker/integrations-allegro build
pnpm --filter @openlinker/integrations-allegro test
```

Then the full pre-commit hook (lint + check:invariants + type-check + full test suite) runs on `git commit`.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Renaming the existing constants/helpers breaks something else in the file | Scope is one file; ctrl-F confirms no external imports of the renamed symbols. Verified: both old constants and `getApiBaseUrl` are private to the adapter. |
| `buildAuthorizationUrl` / `exchangeCode` tests start failing because something inadvertently changed | Only the constant *name* and the helper *name* changed for those paths; values are identical. Test assertions check URL strings, not symbol names. |
| Production was actually relying on the OAuth-host-for-/me quirk | Extremely unlikely — that would mean Allegro proxies `allegro.pl/me` → `api.allegro.pl/me`. The acceptance criteria require a live production OAuth re-verification by the shipper; the AC is in the issue body and surfaces this gap. Either way the fix is the same. |

No domain risk, no migration risk, no consumer-API-breaking risk.

## 7. Architecture compliance

- No CORE ↔ Integration boundary crossings (change is purely inside the Allegro plugin).
- No domain-layer changes.
- No NestJS-framework imports added.
- No `any` types introduced.
- No `console.log` introduced.
- No new ESLint disable comments.
- Naming follows existing conventions (`{SCOPE}_{NAME}_BASE_URL`, camelCase methods).
- No new ports / capability changes.

## 8. Effort

S — ~1 hour code + tests. Full pre-commit hook adds ~5 min wall time.
