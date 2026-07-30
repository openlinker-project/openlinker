# Pre-implement gate: MCP Phase 0 — RS auth via user-issued PATs

**Plan**: `docs/plans/implementation-plan-mcp-pat-resource-server-auth.md`
**Issue**: #1486
**Gate run**: 2026-07-28
**Verdict**: **NEEDS-REVISION** (1 Critical, 4 Warnings)

One contract-surface break would fail `pnpm lint` on first commit. Everything else is additive and confirmed
greenfield. The fix is small and makes the design *more* compliant, not less.

---

## Reuse audit

| Plan artifact | Status | Evidence |
|---|---|---|
| `McpToken` domain entity | **NEW** — confirmed absent | No `McpToken`/`mcp_token`/`mcp-token` identifier in any `.ts`; only planning docs match |
| `McpTokenRepositoryPort` | **NEW** | ditto |
| `mcp_tokens` ORM entity/table | **NEW** | 44 `@Entity(...)` decls in `libs/core` swept; nearest are `refresh_tokens`, `password_reset_tokens`, `email_confirmation_tokens` |
| `MCP_TOKEN_REPOSITORY_TOKEN` | **NEW** | `libs/core/src/users/users.tokens.ts` holds 6 symbols, none colliding |
| `McpTokenService` / `IMcpTokenService` | **NEW** | zero `.ts` matches |
| `OlMcpTokenVerifier` | **NEW** | zero `.ts` matches |
| `McpModule`, `McpTokensController`, `McpTransportController` | **NEW** | zero `.ts` matches; `apps/api/src/mcp/` does not exist |
| `@modelcontextprotocol/*` dependency | **NEW** | absent from every `package.json` |
| FE `features/mcp-tokens/`, mcp route | **NEW** | `find apps/web -iname '*mcp*'` → zero |
| Generic API-key / PAT store to reuse | **CONFIRMED ABSENT** | see below |
| Hashed-opaque-token *pattern* | **PARTIAL → copy, don't reuse** | `refresh-token.{entity,orm-entity,repository}.ts` + `refresh-token-repository.port.ts`. Session-rotation shaped (rotation chain, no scopes/label/audience) — a pattern, not a table |
| `integration_credentials` as a store | **REJECTED as reuse target** | `integrations/infrastructure/persistence/entities/integration-credential.orm-entity.ts` — AES-256-GCM **reversible** encryption, keyed by `ref`+`platformType`, **no `user_id`, no scopes, no expiry, no revocation**. Reversible encryption is the wrong primitive for an inbound bearer credential (must be hash-at-rest) |
| DB-backed bearer guard to reuse | **CONFIRMED ABSENT** | only `jwt-auth.guard.ts` (passport), `roles.guard.ts`, `csrf.guard.ts`. Webhook HMAC auth is in-service (`webhook-auth.service.ts`), not a guard |
| `users/orm-entities.ts` sub-barrel | **ABSENT — and not needed** | TypeORM CLI discovers via `**/*.orm-entity.{ts,js}` glob in `apps/api/src/database/data-source.ts`. Plan correctly does not export the ORM entity |
| Reveal-secret-once UI component | **CONFIRMED ABSENT** | Existing secrets (SMTP password, AI keys) are **write-only** and never returned, so no precedent exists. Net-new UI |
| Copy-to-clipboard | **EXISTS → reuse with care** | `apps/web/src/shared/ui/copyable-id.tsx` (`CopyableId`). ⚠️ its copy button is hover-hidden via `.copyable-id__copy` — wrong affordance for a one-time reveal; may need a variant |
| Token list table | **EXISTS → reuse** | `shared/ui/data-table.tsx` (`DataTable`), or the lighter `features/ai-provider-settings/components/ai-provider-table.tsx`. Also `confirm-dialog.tsx` for revoke, `feedback-state.tsx` for loading/error |

**Net**: no reuse collisions. The plan is not reinventing anything that exists.

---

## Backward-compatibility findings

### 🔴 CRITICAL — plan trips `check-cross-context-imports` (fails `pnpm lint`)

Plan §3.8 places `McpTokenService` in `apps/api/src/mcp/application/` while `McpTokenRepositoryPort` lives in
`libs/core/src/users/domain/ports/`. That import is a **deny-pattern**:

> `*RepositoryPort` — repository ports are intra-context; cross-context callers go through `I*Service`.
> (`scripts/check-cross-context-imports.mjs:24`; scope explicitly includes `apps/{api,worker}/**`)

The `RefreshTokenService` precedent the plan leans on **only passes because it is explicitly allow-listed**:

```js
// scripts/check-cross-context-imports.mjs:171-173
// apps → users.RefreshTokenRepositoryPort — rewire via IUsersService
['apps/api/src/auth/refresh-token.service.ts', new Set(['RefreshTokenRepositoryPort'])],
['apps/api/src/auth/refresh-token.service.spec.ts', new Set(['RefreshTokenRepositoryPort'])],
```

The allow-list is **per-(file, symbol)**, so a new file inherits nothing. Worse, that list is **tracked tech debt
being actively paid down** (#718 core-to-core, #722 plugins+apps) — growing it for net-new code inverts its purpose
and a reviewer would be right to block it.

**Recommended fix — move the service into the `users` context** (option B below), which makes the import
same-context and the violation disappear entirely:

| Option | Assessment |
|---|---|
| A. Add 2 new ALLOW_LIST entries | ❌ Grows a debt list that exists to shrink. Not for greenfield code |
| **B. `McpTokenService` → `libs/core/src/users/application/services/`, expose `IMcpTokenService` + `MCP_TOKEN_SERVICE_TOKEN` via the users barrel; `apps/api/src/mcp/` injects the *service interface*** | ✅ **Recommended.** Service interfaces + Symbol tokens are both explicitly ALLOWED cross-context shapes. Zero allow-list entries. Bonus: `check-service-interfaces` (scans `libs/core` only) now *enforces* the `I*Service` rule that plan §8 flagged as unenforced |
| C. Keep service in api, expose a core facade | Equivalent to B with an extra hop |

**Second-order benefit — it also fixes a latent second violation.** §3.5 has the verifier resolving the `User` for
role inheritance. Doing that from `apps/api` would need `UserRepositoryPort` — also deny-listed, also only
allow-listed for `auth.service.ts`/`bootstrap-admin.service.ts`. Routing through a core
`IMcpTokenService.resolvePrincipal(rawToken) → { userId, role, scopes, expiresAt, resource, tokenId }` avoids it.

**Critical constraint on option B**: `libs/core` **must not** import `@modelcontextprotocol/*`. The split is:

```
libs/core/src/users/    entity, port, repository, McpTokenService  ← no SDK types, returns a neutral principal
apps/api/src/mcp/       OlMcpTokenVerifier implements OAuthTokenVerifier  ← SDK-facing, maps principal → AuthInfo
```

This keeps the SDK dependency in the Interface layer where ADR-033 puts it.

### 🟡 WARNING — `MiddlewareConsumer` has no precedent in this repo

Plan §3.7 proposes `configure(consumer: MiddlewareConsumer)` in `mcp.module.ts`. **Zero matches for `NestModule`
or `MiddlewareConsumer` repo-wide.** The established convention is path-scoped `app.use()` in `main.ts:31-54`
(how `/webhooks` gets its raw-body parser), and `webhooks/http/middleware/raw-body.middleware.ts:28` explicitly
records that a `RawBodyMiddleware` class **was removed in favour of the main.ts hook**.

Not a break — `NestModule` is standard Nest — but it introduces the repo's first instance of a pattern that was
previously backed out. Counter-argument for keeping it: the middleware needs the DI-provided verifier, which is
natural in a module and awkward in `main.ts` (`app.get(...)` after bootstrap). **Decide explicitly and record the
rationale**, rather than letting it land unremarked.

### 🟡 WARNING — migration timestamp: free today, contested at merge

`1831000000003` is **absent from `origin/main`** — the plan's "known collision" is overstated *today*. Local and
`origin/main` tails both end at `1831000000002`. The risk is real but deferred: open PR #1817
(`1786-demo-events-framework`) has re-timestamped its migration to the same slot. Whichever merges second
re-prefixes. `check-migration-timestamps` compares the working tree against `origin/main` and fails loudly, so it
cannot land silently. Plugin dirs scanned: `libs/integrations/allegro/src/migrations` only.

### 🟡 WARNING — FE route contract tests will reject a naive route

`apps/web/src/app/routes/route-lazy.test.ts` and `route-handle.test.ts` walk the route tree and fail any route
that is **not lazy** or **lacks `handle.crumb`**. The new route must match `ai-provider-settings.route.tsx`:
relative `path` (no leading slash), `handle.crumb` typed as `RouteCrumbHandle`, `lazy: async () => import(...)`.
Registration is a manual add to `coreChildren` in `app/routes/root.route.tsx`.

### 🟡 WARNING — `CoreApiClient` namespace registration is a (small) shared-surface edit

Feature API modules are factories composed centrally: `apps/web/src/app/api/api-client.ts` imports
`createXApi` and registers it as a namespace. Adding `mcpTokens` touches that shared file — additive and low risk,
but it is a shared-surface edit the plan didn't name.

### ℹ️ INFO — admin gating is manual, three layers

No guard component exists. Precedent (`ai-provider-settings-page.tsx:26`) is: nav `requiresRole: 'admin'` in
`app/nav-registry.ts`, an in-component early-return `ErrorState`, and `enabled: isAdmin` on the query.
`isAdmin` is copy-pasted (`session.status === 'authenticated' && session.user?.role === 'admin'`) — no shared
helper. Plan §3.10 should name all three layers so the FE checklist is complete.

---

## Confirmed-safe (no action)

- No barrel export removed/renamed — all `libs/core/src/users/index.ts` changes are **additions**.
- No port signature changed; no DTO field removed/retyped; no Symbol token removed.
- New ORM entity + migration is the standard additive path (`docs/migrations.md`); no existing table altered.
- `@Public()` + `VERSION_NEUTRAL` is a real precedent — `webhook.controller.ts:35-41`. (Note: the Allegro OAuth
  callback is `@Public()` but **versioned**, so it is not a second precedent for version-neutrality.)
- `McpModule` slots at the end of `app.module.ts` imports alongside `SystemModule`; `AuthModule` is already
  imported earlier, so the global `APP_GUARD` ordering the plan relies on holds.

---

## Open questions blocking a clean implementation

1. **Where does `McpTokenService` live?** Must be resolved before code — it decides the module layout.
   Gate recommends core/users (option B).
2. **`MiddlewareConsumer` vs `main.ts app.use('/mcp', ...)`** — pick one and record why.
3. **Does the one-time-reveal UI reuse `CopyableId`** (hover-hidden copy button) or need a variant? Cosmetic,
   but it is the single most security-relevant screen in the PR.
4. **Q7 (client accepts a manual bearer header)** — unchanged, still open, still not closeable headlessly.
   Correctly scoped as post-merge validation.

---

## Verdict

**NEEDS-REVISION.** One Critical (cross-context repository-port import) must be fixed in the plan before code.
The recommended fix — moving `McpTokenService` into `libs/core/src/users/application/services/` and exposing
`IMcpTokenService` — removes the violation, avoids growing a tech-debt allow-list, gains
`check-service-interfaces` enforcement, and incidentally prevents a second latent `UserRepositoryPort` violation.
No reuse collisions were found; the feature is genuinely greenfield.
