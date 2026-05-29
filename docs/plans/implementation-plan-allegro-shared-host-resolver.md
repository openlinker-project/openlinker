# Implementation Plan — Allegro shared host resolver (#892)

## 1. Understand the task

**Goal.** Remove the duplicated OAuth-host / REST-API-host string-resolution scattered across the
Allegro plugin by extracting a single pure resolver module, then migrating every runtime call site
onto it. This kills the drift class that produced the #889 bug (one copy used the wrong host).

**Classification.** Integration (Allegro plugin) · Infrastructure layer. No CORE port, domain, or
schema change. No migration.

**Explicit non-goals (from the issue).**
- Do **not** hoist the resolver into a cross-plugin shared package — Allegro-specific, no second consumer.
- Do **not** touch the `upload.allegro.pl` image-upload subdomain (genuinely separate host).
- Do **not** touch webhook host (n/a here).
- Do **not** touch `https://developer.allegro.pl` doc-portal links (unrelated documentation URLs).

## 2. Research findings (codebase reality vs. the issue body)

The issue lists **three** call sites. Grep of the plugin (`https://(api\.)?allegro\.pl`, excluding
tests / `upload.` / `developer.`) found **runtime host resolution in five places**, not three:

| File | Helper | Host kind | In issue? |
|---|---|---|---|
| `application/allegro-adapter.factory.ts:153` | `getDefaultApiBaseUrl` | REST (`api.allegro.pl`) | ✅ yes |
| `application/allegro-adapter.factory.ts:170` | `getDefaultStorefrontBaseUrl` | site (`allegro.pl`) | ⚠️ no |
| `infrastructure/adapters/allegro-connection-tester.adapter.ts:25` | `DEFAULT_API_BASE_URLS` map | REST | ✅ yes |
| `infrastructure/adapters/allegro-oauth-completion.adapter.ts:43-51` | `getOAuthBaseUrl` / `getRestApiBaseUrl` | OAuth + REST | ✅ yes |
| `infrastructure/token-refresh/allegro-token-refresh.service.ts:319` | `getApiBaseUrl` | OAuth/site (`allegro.pl`) **misnamed** | ❌ no |

Two findings beyond the issue's inventory:

- **`allegro-token-refresh.service.ts` `getApiBaseUrl` is a misnamed OAuth-host duplicate.** It returns
  the `allegro.pl` site host and is consumed at line 209 to build `/auth/oauth/token` (the refresh-grant
  token endpoint). This is the *exact* misnaming pattern #889 fixed in the OAuth-completion adapter
  ("the pre-#889 state had four... misnamed `*_API_BASE_URL` constants"). Leaving it would mean the
  issue's own AC — "one module owns the OAuth-host... resolution; no other file contains the literal
  strings" — is **not met**. → **Migrate it.** (rename local `apiBaseUrl` → `oauthBaseUrl` for clarity.)

- **The factory's storefront host (`allegro.pl`) equals the OAuth/site host.** Allegro serves the OAuth
  authorize UI, the `/auth/oauth/token` endpoint, and the public storefront all on the same `allegro.pl`
  web host (as distinct from the `api.allegro.pl` REST host). The storefront helper therefore contains
  the literal `https://allegro.pl`, which the AC forbids in "any other file". → **Migrate it onto
  `getAllegroOAuthBaseUrl`** (the value is identical; documented as "the Allegro web/site host").

Supporting facts:
- Existing type: `AllegroEnvironment = 'sandbox' | 'production'` + `AllegroEnvironmentValues` in
  `domain/types/allegro-config.types.ts` (re-exported from the package barrel).
- All four migrated helpers currently **`logger.warn` on unknown env** and default to sandbox. The new
  resolver must preserve that observable behaviour (AC: "existing behaviour is preserved").
- Call sites pass un-narrowed `string` (e.g. `getDefaultApiBaseUrl(environment: string)`) — the defensive
  `default` branch only makes sense for `string`, so the resolver's param is `string`, not the narrow
  `AllegroEnvironment` (a narrow type makes `default` unreachable). Minor, deliberate deviation from the
  issue's `env: AllegroEnvironment` signature.
- The OAuth-completion spec (`...adapter.spec.ts:50-208`) already asserts the host values through the
  public port — it stays green and guards the delegation against behaviour change.
- `allegro-token-refresh.service.ts` and the connection-tester have **no** existing specs.
- The factory lives in `application/` but is a wiring factory that already imports heavily from
  `infrastructure/` (`AllegroHttpClient`, adapters) — importing the resolver from `infrastructure/http`
  is consistent with the file's existing role.

## 3. Design

New pure module `libs/integrations/allegro/src/infrastructure/http/allegro-hosts.ts`:

```ts
// private module constants (the single source of truth for Allegro hosts)
const SANDBOX_WEB_BASE_URL = 'https://allegro.pl.allegrosandbox.pl';     // OAuth authorize + token + storefront
const PRODUCTION_WEB_BASE_URL = 'https://allegro.pl';
const SANDBOX_REST_API_BASE_URL = 'https://api.allegro.pl.allegrosandbox.pl';
const PRODUCTION_REST_API_BASE_URL = 'https://api.allegro.pl';

// only public surface:
export function getAllegroWebBaseUrl(environment: string): string     // /auth/oauth/* + token-refresh + storefront links
export function getAllegroRestApiBaseUrl(environment: string): string // /me, /sale/*, /order/*, ...
```

**Naming decision (tech-review IMPORTANT).** The web-host helper is named `getAllegroWebBaseUrl`, not
the issue's prescribed `getAllegroOAuthBaseUrl`. The `allegro.pl` host serves OAuth authorize, the
`/auth/oauth/token` endpoint, **and** the public storefront link — naming it "OAuth" would reintroduce
the name/purpose mismatch this issue exists to remove (a storefront link calling an "OAuth" function).
The AC mandates convergence/behaviour, not the identifier, so this is a safe deviation — recorded on the PR.

- Both: `sandbox → sandbox host`, `production → production host`, `default → warn + sandbox`.
- Preserve the warn via a module-scoped neutral `Logger` from `@openlinker/shared/logging`
  (plugin-safe, zero-config console default). Keeps the existing observable behaviour.
- Relocate the alignment-constraint JSDoc (currently on `getRestApiBaseUrl` in the OAuth adapter)
  to sit next to both helpers — one-place-enforceable instead of duplicated-by-convention.

Data flow is unchanged — same strings resolved, just from one module.

## 4. Step-by-step implementation

**Step 1 — create the resolver.**
`libs/integrations/allegro/src/infrastructure/http/allegro-hosts.ts`
- File header; four private consts; two exported functions; module `Logger`.
- AC: pure module, no NestJS/DI; only the two functions are exported.

**Step 2 — create the spec.**
`libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-hosts.spec.ts`
- Assert the four host strings explicitly (OAuth prod/sandbox, REST prod/sandbox).
- Assert both default to sandbox on an unknown env string.
- AC: a typo in any host value fails at lint/test time.

**Step 3 — migrate `allegro-adapter.factory.ts`.**
- Line 71 `getDefaultApiBaseUrl(config.environment)` → `getAllegroRestApiBaseUrl(config.environment)`.
- Line 75 `getDefaultStorefrontBaseUrl(config.environment)` → `getAllegroWebBaseUrl(config.environment)`.
- Delete the private `getDefaultApiBaseUrl` + `getDefaultStorefrontBaseUrl` methods.
- **Leave `getDefaultUploadBaseUrl` untouched.**
- Add `import { getAllegroWebBaseUrl, getAllegroRestApiBaseUrl } from '../infrastructure/http/allegro-hosts';`

**Step 4 — migrate `allegro-connection-tester.adapter.ts`.**
- Delete `DEFAULT_API_BASE_URLS` map (25-28).
- Line 40 → `config.apiBaseUrl ?? getAllegroRestApiBaseUrl(environment)`.
- Add `import { getAllegroRestApiBaseUrl } from '../http/allegro-hosts';`

**Step 5 — migrate `allegro-oauth-completion.adapter.ts`.**
- Delete the four module consts (43-51) and the two private methods `getOAuthBaseUrl` / `getRestApiBaseUrl`.
- Replace internal calls `this.getOAuthBaseUrl(env)` → `getAllegroWebBaseUrl(env)` (lines 59, 70) and
  `this.getRestApiBaseUrl(env)` → `getAllegroRestApiBaseUrl(env)` (line 148).
- Add `import { getAllegroWebBaseUrl, getAllegroRestApiBaseUrl } from '../http/allegro-hosts';`

**Step 6 — migrate `allegro-token-refresh.service.ts`.**
- Line 137 `this.getApiBaseUrl(environment)` → `getAllegroWebBaseUrl(environment)`; rename local
  `apiBaseUrl` → `webBaseUrl` (used at 209 for `/auth/oauth/token`).
- Delete the private `getApiBaseUrl` method (319-329).
- Add `import { getAllegroWebBaseUrl } from '../http/allegro-hosts';`

**Step 7 — doc comments (tech-review SUGGESTION: keep clarifying docs intact).**
- `allegro-offer-manager.adapter.ts:267-268` — reword the storefront comment to reference the resolver
  without embedding the literal host strings (cheap).
- `domain/types/allegro-config.types.ts:37-38` — **keep intact.** It documents the `apiBaseUrl`
  config-field default; the example URLs are genuine documentation. The AC's intent ("caught at lint
  time", "value drift") is about *executable* host resolution, not doc comments — recorded on the PR.

**Step 8 — quality gate.**
`pnpm --filter @openlinker/integrations-allegro test`, then `pnpm lint && pnpm type-check && pnpm test`.

## 5. Validation

- **Architecture**: resolver is pure infra; no CORE↔Integration boundary crossing; factory→infra import
  matches the file's existing wiring role. ✅
- **Naming**: `*.ts` pure module, co-located `__tests__/*.spec.ts`. ✅
- **Behaviour preserved**: same four strings; warn-on-unknown retained via neutral Logger; OAuth-completion
  spec re-verifies host behaviour unchanged. ✅
- **Security**: no secrets, no input-trust change. ✅
- **AC closure**: after Steps 3-7, grep for `https://(api\.)?allegro\.pl` (excluding tests / `upload.` /
  `developer.`) returns only `allegro-hosts.ts`. ✅

## Decisions (resolved after tech-review)

1. **5-site convergence** (factory REST + storefront, oauth-completion OAuth + REST, connection-tester
   REST, token-refresh OAuth) — not the issue's literal 3. Required by the AC; fixes the same misnaming
   bug class. **Approved.**
2. **Function naming** → `getAllegroWebBaseUrl` + `getAllegroRestApiBaseUrl`. Deviates from the issue's
   `getAllegroOAuthBaseUrl` because the web host also serves storefront + token-refresh; an "OAuth"-named
   function for a storefront link would reintroduce name/purpose drift. **Approved; noted on PR.**
3. **Preserve warn-on-unknown** via a module-scoped neutral `Logger` (AC: behaviour preserved).
4. **`allegro-config.types.ts` doc comment** kept intact (documentation ≠ executable drift). **Noted on PR.**
