# Implementation Plan: MCP Phase 0 — Resource-Server auth via user-issued Personal Access Tokens

**Issue**: #1486 (Phase 0 of EPIC #1350 — gating prerequisite for #1487 / #1488 / #1489)
**Date**: 2026-07-28
**Status**: Revised after SDK-v2 source verification + pre-implement gate
**Branch**: `1486-mcp-pat-resource-server-auth`
**PR shape**: single PR (A1)
**Gate**: `docs/plans/analysis/ANALYSIS-implementation-plan-mcp-pat-resource-server-auth.md` — all findings applied (§9)

> Decision rationale lives in [ADR-033](../architecture/adrs/033-openlinker-as-mcp-server.md) and
> [ADR-034](../architecture/adrs/034-mcp-authorization-user-issued-pats.md). The phased breakdown lives in
> [implementation-plan-mcp-server.md](./implementation-plan-mcp-server.md). This plan is the *what* and *how* of Phase 0 only.

---

## 0. SDK v2 — verified facts

Verified by installing `@modelcontextprotocol/{server,express,node,core}@2.0.0` and reading the shipped `.d.cts`
declarations on 2026-07-28. **This supersedes any doc-derived description**, including the
`createExpressHandler(server)` form that appears in some summaries — **that function does not exist**.

| Fact | Consequence |
|---|---|
| v2 ships as a **scoped package family**, not `@modelcontextprotocol/sdk@2` (that name is the v1 line, `latest: 1.30.0`) | Take `@modelcontextprotocol/server` + `/express` + `/node`, all `^2.0.0` |
| `OAuthTokenVerifier { verifyAccessToken(token): Promise<AuthInfo> }` — *"intentionally narrower than a full OAuth Authorization Server provider — it only covers the verification step a Resource Server needs"* | **OL implements this interface.** No hand-rolled bearer guard |
| `requireBearerAuth({ verifier, requiredScopes?, resourceMetadataUrl? })` handles the 401/403 split, the `WWW-Authenticate` challenge, the OAuth error body, and scope enforcement | Do not reimplement any of the four |
| **Bearer verification rejects tokens whose `AuthInfo.expiresAt` is unset** | **Expiry is mandatory** (§3.2) |
| `AuthInfo.resource?: URL` is the RFC 8707 resource-server id; `checkResourceAllowed` is exported | Use `resource`, not a bespoke `audience` column |
| `AuthInfo.scopes: string[]` | Store scopes as an array; let `requiredScopes` enforce |
| `AuthInfo.extra?: Record<string, unknown>` — *"for any additional data attached to the auth info"* | OL principal rides here |
| `McpRequestContext.authInfo` is where the principal lands — **not** `ctx.http.authInfo`, which appears in the SDK's prose but not its types (verified against `.d.cts`) | Tool handlers read `ctx.authInfo` |
| `toNodeHandler(handler)` → `(req, res, parsedBody?)`; *"When a body parser already consumed the stream (`express.json()`), pass the parsed value as `parsedBody`"*; *"`req.auth` is forwarded as the handler's pass-through `authInfo`"* | Resolves the NestJS global-body-parser collision. Principal flows `requireBearerAuth → req.auth → ctx.authInfo` |
| `createMcpHandler(factory)` builds a **fresh server per request** | Stateless; multi-replica safe, no sticky sessions |
| Modern protocol revision served is **2026-07-28** | Satisfies #1486's "re-verify against the ratified revision" |

---

## 1. Task Summary

**Objective**: Make OpenLinker an OAuth 2.1 **Resource Server that validates its own user-issued Personal Access
Tokens (MCP tokens)**, by implementing the SDK's `OAuthTokenVerifier` seam, and prove it end-to-end with a minimal
authenticated MCP Streamable-HTTP endpoint. No Authorization Server (ADR-034).

**Classification**: **CORE slice** (`libs/core/src/users/` — store *and* service) + **Interface** layer
(`apps/api/src/mcp/` — SDK-facing verifier, controllers, transport) + a **Frontend** slice.

### The layering rule that shapes this plan

`check-cross-context-imports.mjs:24` forbids importing a `*RepositoryPort` across contexts — including into
`apps/{api,worker}/**`. Cross-context callers go through an `I*Service`. Therefore:

```
libs/core/src/users/        McpToken entity · McpTokenRepositoryPort · repository · McpTokenService
                            └── NO @modelcontextprotocol/* import. Returns a NEUTRAL principal.
apps/api/src/mcp/           OlMcpTokenVerifier implements OAuthTokenVerifier (SDK-facing)
                            └── injects IMcpTokenService via MCP_TOKEN_SERVICE_TOKEN; maps principal → AuthInfo
```

This is not merely lint compliance — it is the correct seam. Core owns "is this token valid and whose is it";
the Interface layer owns "how MCP expresses that". It also keeps the SDK dependency in the Interface layer
where ADR-033 puts it, and avoids a second violation: resolving the owning `User` for role inheritance from
`apps/api` would need `UserRepositoryPort`, likewise deny-listed.

> **Rejected**: adding `apps/api/src/mcp/...` entries to the checker's `ALLOW_LIST`. That list is tracked tech
> debt (#718 / #722) being paid down; the `RefreshTokenService` precedent passes only because it is grandfathered
> there. Greenfield code must not grow it.

**Named tension — this service diverges from its three siblings, deliberately.** Every other user-token service
(`RefreshTokenService`, `PasswordResetService`, `EmailConfirmationService`) lives in `apps/api/src/auth/`, and
`libs/core/src/users/` has **no `application/` layer at all** today — this PR creates the first one. The
divergence is forced, not stylistic: those three pass `check-cross-context-imports` only because they are
grandfathered in its `ALLOW_LIST` (`scripts/check-cross-context-imports.mjs:156-201`, tracked by #722), and new
code cannot be. Placing `McpTokenService` in core is therefore the only compliant option — and it moves one step
*toward* #722's end state rather than adding to its backlog. Reviewers should read the inconsistency that way.

---

## 2. Scope & Non-Goals

### In Scope
1. `McpToken` domain entity, repository port, ORM entity, repository, DI tokens, migration.
2. **`McpTokenService` in `libs/core/src/users/application/services/`** implementing `IMcpTokenService` —
   mint / list / revoke / `resolvePrincipal`.
3. **`OlMcpTokenVerifier implements OAuthTokenVerifier`** in `apps/api/src/mcp/` — the RS seam.
4. `requireBearerAuth` wired onto the MCP route (§3.7).
5. Token → OL principal, carried in `AuthInfo.extra`, role inherited from the owning user.
6. Admin-only REST surface: `POST|GET /mcp/tokens`, `DELETE /mcp/tokens/:id`.
7. `McpModule` wired into `app.module.ts`.
8. Minimal MCP Streamable-HTTP endpoint exposing one `whoami` tool (auth proof, Option A).
9. FE: admin token-management page (generate → one-time reveal → list → revoke).
10. Docs: ADR-034 open-question resolutions, plan dependency correction, standards + lessons entries.

### Out of Scope (explicitly deferred)
- **Domain tools + dynamic capability-declared `tools/list`** → #1487. No `ToolRegistryService`, no
  `getCapabilityAdapter`. `whoami` is an auth proof, not a tool surface.
- **Per-token rate/concurrency cap** → #1487.
- **Per-token connection scoping** → #1489 (single-tenant; ADR-034 Q5).
- **OAuth 2.1 Authorization Server** → deferred upgrade; swaps the verifier implementation only.
- **RFC 9728 PRM / DCR / consent** — `mcpAuthMetadataRouter` exists but only matters when routing clients to an
  *external* AS. OL issues its own tokens, so it is deliberately not mounted. (Recorded so the omission isn't
  read as an oversight.)
- Automated token rotation (mint + revoke makes manual rotation possible).

### Constraints
- SDK v2 stable as of 2026-07-27 (§0).
- **Q7 (client accepts a manual bearer header) remains open** and is not closeable headlessly. Option A makes it
  answerable against a real endpoint post-merge. Residual risk; re-pointed at #1487.

---

## 3. Design

### 3.1 Token format — opaque random, SHA-256 hashed at rest

Resolves ADR-034 § Open questions: **opaque**, not JWT. Revocation is immediate and total; per-call cost is one
indexed unique-hash lookup, as in `RefreshTokenService.rotate`. A JWT would need a revocation list — the DB hit it
was meant to avoid — plus key management.

**Wire format**: `olmcp_<43-char base64url>` from `randomBytes(32)`. The prefix makes the credential greppable by
secret scanners and unmistakable in a client config file. Only the SHA-256 of the **full** string is stored.

### 3.2 Expiry is mandatory

Driven by the SDK constraint in §0, not preference: `verifyBearerToken` **rejects** an `AuthInfo` with unset
`expiresAt`. `expires_at` is **NOT NULL**; the mint API takes `expiresInDays` (default **90**, max **365**).
`AuthInfo.expiresAt` is emitted as epoch **seconds**.

### 3.3 Scopes — `mcp:read` / `mcp:write`

`McpTokenScopeValues = ['mcp:read', 'mcp:write'] as const`. Stored as a text[] array; surfaced verbatim as
`AuthInfo.scopes`. `mcp:write` implies `mcp:read` — the service **stores both** when write is requested, so the
SDK's plain `requiredScopes` superset check suffices and no implication logic lives in the verifier.

> **Accepted trade-off**: storing both denormalizes the implication rule into the data, so a future change to
> implication semantics can't be applied retroactively without a data migration. Taken deliberately — it keeps
> implication logic out of the verifier and lets the SDK's unmodified superset check do the enforcing.
Enforcement is the SDK's: `requireBearerAuth({ requiredScopes: ['mcp:read'] })` today; a write-scoped route in
#1489 passes `['mcp:write']`.

### 3.4 Resource binding (RFC 8707) — replaces the bespoke `audience`

Each token stores `resource` (the MCP endpoint URL it is valid for, from `OL_MCP_RESOURCE_URL`, defaulting to the
deployment's public `/mcp` URL). The verifier populates `AuthInfo.resource` and validates with the exported
`checkResourceAllowed`. This makes "OL only ever accepts its own tokens" a *checked* property, and is the standard
field a future OAuth token carries.

### 3.5 Core service — `IMcpTokenService`

```ts
// libs/core/src/users/application/services/mcp-token.service.interface.ts
export interface IMcpTokenService {
  mint(input: MintMcpTokenInput): Promise<MintedMcpToken>;      // rawToken returned ONCE
  list(userId?: string): Promise<McpTokenSummary[]>;            // never returns rawToken or hash
  revoke(id: string, reason: McpTokenRevocationReason): Promise<void>;
  resolvePrincipal(rawToken: string): Promise<McpPrincipal | null>;
}
```

`McpPrincipal` is **neutral** — `{ tokenId, tokenName, userId, role, scopes, expiresAt, resource }`. No SDK type
appears in core. `resolvePrincipal` returns `null` for unknown / revoked / expired / inactive-owner, so the
Interface layer decides the protocol-level failure shape.

`resolvePrincipal` also stamps `lastUsedAt` best-effort (non-blocking; failure logged, never thrown).

### 3.6 The verifier — the whole RS seam

```ts
// apps/api/src/mcp/auth/ol-mcp-token.verifier.ts
export class OlMcpTokenVerifier implements OAuthTokenVerifier {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const p = await this.mcpTokens.resolvePrincipal(token);
    if (!p || !checkResourceAllowed(...)) throw new OAuthError(OAuthErrorCode.InvalidToken, ...);
    return { token, clientId: p.tokenId, scopes: p.scopes,
             expiresAt: Math.floor(p.expiresAt.getTime() / 1000),
             resource: new URL(p.resource),
             extra: { olUserId: p.userId, olRole: p.role, tokenName: p.tokenName } };
  }
}
```

Failures throw `OAuthError` with `OAuthErrorCode.InvalidToken`; the SDK's bearer helpers map that to `401` + the
`WWW-Authenticate` challenge. **OL writes no challenge headers and no OAuth error bodies itself.**

`clientId` is the token id, not the user id: it identifies the *credential*, which is what an MCP client is;
user identity stays in `extra`.

**Token-passthrough prohibition is structural** — the verifier reads only OL's own store, and nothing in this
module touches upstream marketplace credentials.

### 3.6.1 🔴 `AuthInfo` carries the raw credential — never log it

`AuthInfo.token` is, by the SDK's contract, **the raw bearer token presented by the client**. That object is
attached to `req.auth` and surfaced to every tool handler as `ctx.authInfo`. Therefore:

- **Never log, serialize, or return an `AuthInfo` wholesale.** Not in `onerror`, not in an audit log, not in an
  error body, not in a test snapshot.
- Anything that needs to record the caller logs a **redacted projection built from `extra`** —
  `{ mcpTokenId, olUserId, olRole, scopes }` — never `token`, never `tokenHash`.
- This is a **standing invariant for the whole `apps/api/src/mcp/` tree**, not just Phase 0. #1487 inherits it:
  its "audit-log every call with principal + connection + tool" requirement MUST consume the redacted
  projection. A naive `logger.log({ authInfo })` there would write live credentials to disk.

Enforced by test: the `whoami` result and every log call in this module are asserted to contain no substring of
the presented raw token (§5).

### 3.7 Two auth models, two controllers — and the middleware decision

| Surface | Auth |
|---|---|
| `/mcp/tokens` (admin CRUD) | Global `JwtAuthGuard` + `@Roles('admin')` — a human minting from the UI |
| `/mcp` (protocol) | `@Public()` + `VERSION_NEUTRAL` + `requireBearerAuth` middleware |

`@Public()` + `VERSION_NEUTRAL` follows `webhook.controller.ts:35-41`. `VERSION_NEUTRAL` is **required**, not
cosmetic: `main.ts` sets `defaultVersion: v1`, and a URL pasted into a client config must not drift to `/v1/mcp`.
(Note the Allegro OAuth callback is `@Public()` but *versioned*, so it is not a second precedent.)
`RolesGuard` no-ops without `@Roles()`; `CsrfGuard` is per-route, not global — `POST /mcp` is unobstructed.

> **Decision — `MiddlewareConsumer`, not `main.ts app.use()`.** The gate correctly flagged that this repo has
> **zero** `NestModule`/`MiddlewareConsumer` usages, and that `RawBodyMiddleware` was once *removed* in favour of
> a `main.ts` hook. That removal was driven by **body-parse ordering at bootstrap** (raw bytes must be captured
> before `express.json()`), a constraint that does not apply to bearer auth. Weighed against it: `requireBearerAuth`
> needs the DI-provided verifier, which is natural in a module and awkward in `main.ts`; and keeping the wiring
> inside `McpModule` keeps the feature cohesive and independently testable. **Chosen: `McpModule implements
> NestModule`.** Recorded here so the first instance of this pattern is deliberate and reviewable, not incidental.

### 3.8 Transport wiring

```ts
// mcp.module.ts
configure(consumer: MiddlewareConsumer): void {
  consumer.apply(requireBearerAuth({ verifier: this.verifier, requiredScopes: ['mcp:read'] }))
          .forRoutes({ path: 'mcp', method: RequestMethod.ALL });
}

// mcp-transport.controller.ts — @Public(), VERSION_NEUTRAL
@All()
async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
  await this.nodeHandler(req, res, req.body);   // parsedBody — see §0
}
```

`createMcpHandler`'s `onerror` is wired to the shared `Logger`.

### 3.9 Module layout

```
libs/core/src/users/
  domain/entities/mcp-token.entity.ts
  domain/ports/mcp-token-repository.port.ts
  domain/types/mcp-token.types.ts
  application/services/mcp-token.service.ts            # implements IMcpTokenService
  application/services/mcp-token.service.interface.ts
  application/types/mcp-token.types.ts                 # MintMcpTokenInput, McpPrincipal, …
  infrastructure/persistence/entities/mcp-token.orm-entity.ts
  infrastructure/persistence/repositories/mcp-token.repository.ts
  users.tokens.ts | users.module.ts | index.ts         # additions only

apps/api/src/mcp/
  mcp.module.ts
  auth/ol-mcp-token.verifier.ts | auth/mcp-principal.types.ts
  http/mcp-tokens.controller.ts | http/dto/*.dto.ts
  transport/mcp-transport.controller.ts | transport/mcp-server.factory.ts

apps/api/src/migrations/1831000000003-add-mcp-tokens.ts
apps/web/src/features/mcp-tokens/{api,hooks,components}/
apps/web/src/app/routes/mcp-tokens.route.tsx
```

New Symbol tokens in `users.tokens.ts` (picked up automatically by the existing `export *`):
`MCP_TOKEN_REPOSITORY_TOKEN`, `MCP_TOKEN_SERVICE_TOKEN`.

**No `users/orm-entities.ts` sub-barrel** — the TypeORM CLI discovers the new entity via the
`**/*.orm-entity.{ts,js}` glob in `apps/api/src/database/data-source.ts`, and no host or fixture imports it.

### 3.10 Schema — `mcp_tokens`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | → `AuthInfo.clientId` |
| `user_id` | uuid, indexed, **FK → `users(id)` ON DELETE CASCADE** | owner; role inherited at verification time |
| `name` | varchar(100) | operator label |
| `token_hash` | varchar(64) **unique** | SHA-256 hex of the raw token |
| `scopes` | text[] | `mcp:read` / `mcp:write` |
| `resource` | varchar(512) | RFC 8707 binding (§3.4) |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz **NOT NULL** | §3.2 |
| `last_used_at` | timestamptz nullable | best-effort |
| `revoked_at` | timestamptz nullable | |
| `revoked_reason` | varchar(64) nullable | |

**FK + `ON DELETE CASCADE` follows the `refresh_tokens` precedent exactly.**

> **Correction (implementation):** an earlier revision of this plan and the pre-implement report both claimed
> `refresh_tokens` has "no FK". That was wrong — `1796000000000-add-refresh-tokens.ts` declares
> `"user_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`. Only the *ORM entity* omits a relation
> decorator. So the cascade here is the established convention, not a divergence, and the ORM entity likewise
> carries a plain `user_id` column with no `@ManyToOne` — matching its sibling exactly.

`apps/api/src/users/http/users.controller.ts` exposes a permanent `DELETE /users/:id`; the cascade means deleting
a user destroys their credentials structurally rather than leaving orphaned rows that merely happen to fail the
verifier's user lookup. Covered by an explicit orphan-token test case (§5).

Migration `1831000000004` — next free synthetic slot, per `docs/migrations.md`
(**not** a real `Date.now()` prefix). **The predicted collision materialised**: PR #1817 merged to `main` mid-implementation and took
`1831000000003`, so this migration was re-prefixed `…003 → …004`. `check-migration-timestamps` caught it at
lint time exactly as designed — it could not have landed silently.

### 3.11 Frontend

Route precedent is `ai-provider-settings.route.tsx` (a token *list* with per-row revoke outgrows the
`mailer-settings` tile+dialog shape), plus an admin-only tile on `/settings` linking to it.

Contract requirements the route tests enforce (`route-lazy.test.ts`, `route-handle.test.ts`):
relative `path` (no leading slash), `handle.crumb` typed as `RouteCrumbHandle`, `lazy: async () => import(...)`.
Register by adding to `coreChildren` in `app/routes/root.route.tsx`.

> ⚠️ **`route-lazy.test.ts:72` hard-codes `EXPECTED_LAZY_ROUTE_COUNT = 49`.** Adding this route makes it **50**;
> the suite fails until the constant is bumped in the same commit (`frontend-architecture.md` § Routing
> Conventions documents this explicitly).

**Nav placement — settings-tile only, no nav-registry entry.** The route is reached from an admin-only tile on
`/settings`. `frontend-ui-style-guide.md` § Left Navigation defines a fixed four-group IA with no natural home
for a rare admin credential surface, and adding both a nav entry *and* a settings tile would create two paths
into one low-traffic page. So admin gating is **two**-layered here, not three:
1. in-page early-return `ErrorState` ("Admin role required"), per `ai-provider-settings-page.tsx:26`;
2. `enabled: isAdmin` on the query.
`isAdmin` = `session.status === 'authenticated' && session.user?.role === 'admin'` from `useSession()`.
(The tile itself is already `{isAdmin ? … : null}` on the settings page, so the nav-visibility layer has no
equivalent to gate.)

**API seam**: `features/mcp-tokens/api/mcp-tokens.api.ts` exports `createMcpTokensApi(request)`; register it as an
`mcpTokens` namespace in `apps/web/src/app/api/api-client.ts` (a small shared-surface edit). Sibling
`.query-keys.ts` / `.types.ts`; one mutation per hook file. No raw `fetch`.

**Feature barrel**: ship `features/mcp-tokens/index.ts` even though it isn't strictly required (today's consumers
are a page and `app/api/api-client.ts`, both still permitted to deep-import). `frontend-architecture.md`
§ Feature Public Surface calls that exemption a documented gap being migrated away from — one line now beats a
refactor later.

**One-time reveal**: a **dedicated** component, not `CopyableId` — the latter hover-hides its copy button
(`.copyable-id__copy`), which is the wrong affordance for the single most security-relevant screen in the PR.
The raw token lives in component state only: never persisted, never re-fetchable, cleared on dismiss.
Reuse `shared/ui/data-table.tsx` for the list (or the lighter `ai-provider-table.tsx` shape),
`confirm-dialog.tsx` for revoke, `feedback-state.tsx` for loading/error.

---

## 4. Implementation Steps

| # | Step | Acceptance |
|---|---|---|
| 1 | Domain types + entity | `as const` scope union; readonly entity, pure `isActive(now)`/`isRevoked()` only (ADR-011) |
| 2 | Repository port | `insert`, `findByHash`, `findByUserId`, `findById`, `revoke`, `touchLastUsed`; domain entities only |
| 3 | ORM entity + repository | private `toDomain`/`toOrm`. **Unique-violation decision:** a 256-bit-random `token_hash` collision is not realistically reachable, so **no domain exception is introduced** — the infrastructure error propagates. Recorded here so it isn't decided ad-hoc in the diff |
| 4 | `McpTokenService` + interface **in core** | `implements IMcpTokenService`; raw returned exactly once; expiry defaulted/clamped; revoke idempotent; `resolvePrincipal` returns neutral principal or null. Passes `check-service-interfaces` |
| 5 | DI tokens + module + barrel | both tokens via `export *`; port exported as `type`; `UsersModule` registers repo + service and exports `MCP_TOKEN_SERVICE_TOKEN` |
| 6 | Migration `1831000000003` | `up`/`down`; FK + `ON DELETE CASCADE`; class suffix matches filename; invariant green |
| 7 | `OlMcpTokenVerifier` | implements `OAuthTokenVerifier`; injects `MCP_TOKEN_SERVICE_TOKEN`; throws `OAuthError(InvalidToken)`; never writes headers; **never logs `AuthInfo`** (§3.6.1) |
| 8 | Admin REST surface | `@Roles('admin')` per method; class-validator input; raw value only in the create response |
| 9 | Transport + `McpModule implements NestModule` | **`McpModule` imports `UsersModule`** (source of `MCP_TOKEN_SERVICE_TOKEN`); `@Public()` + `VERSION_NEUTRAL` + `requireBearerAuth`; `whoami` returns identity, never a token. `whoami` lives in `mcp-server.factory.ts`, **not** a `*.tool.ts` file — #1487 owns registering that convention in `engineering-standards.md`, and pre-empting it here would fork the decision |
| 10 | `app.module.ts` wiring | API boots; existing routes unaffected |
| 11 | FE feature + barrel + route + tile + api-client namespace | §3.11; **bump `EXPECTED_LAZY_ROUTE_COUNT` 49 → 50**; loading/empty/error states; `app→pages→features→shared`; no raw `fetch` |
| 12 | Tests | §5 |
| 13 | Docs | §6 |

---

## 5. Testing Strategy

**Unit** (`pnpm test`):
- `mcp-token.entity.spec.ts` — `isActive` across expired / revoked / valid.
- `mcp-token.service.spec.ts` — raw returned once and not re-derivable; hash stored not raw; expiry default +
  clamp; `mcp:write` stores both scopes; revoke idempotent; `list` omits `tokenHash` and raw;
  `resolvePrincipal` → null for unknown / revoked / expired / inactive owner.
- **`ol-mcp-token.verifier.spec.ts` — the security core.** Table: valid read, valid write, unknown, revoked,
  expired, resource mismatch, owner deactivated, **owner deleted (orphan token)**, malformed. Each asserts the
  thrown `OAuthError` **code** (not HTTP status — that's the SDK's job) and that `expiresAt` is always populated.
  Plus `extra` carries the principal.
  **Leak assertions (§3.6.1)**: the returned `AuthInfo` is never passed to a logger, and no log call made during
  verification contains any substring of the presented raw token (spy on the injected `Logger`).
  *Deliberately not tested here*: challenge-header shape and the 401/403 split — SDK-owned, asserted end-to-end below.
- `mcp-server.factory.spec.ts` — `whoami` returns `{ userId, role, scopes, tokenName }` and its serialized output
  contains no substring of the raw token (§3.6.1).
- `mcp-tokens.controller.spec.ts` — admin-only; raw value present exactly on create.
- FE: list rendering, one-time-reveal modal, revoke confirm, loading/empty/error, admin gating.

**Integration** (`pnpm test:integration`, Testcontainers) — `mcp-token-auth.int-spec.ts`:
mint via admin API → call `/mcp` with the raw token → 200, `whoami` returns the minting user;
revoked → 401 **with `WWW-Authenticate`**; expired → 401; `mcp:read` against an `mcp:write` requirement → 403;
no header → 401. This is where the SDK's real header/status behaviour is asserted.

> Per `reference_int_spec_login_once_per_test`: call `loginAsAdmin` **once** per test; thread http+token into helpers.

---

## 6. Documentation Impact

- **ADR-034** — resolve both open questions: token format (**opaque + SHA-256**) and store (**dedicated
  `mcp_tokens`**). Add that the SDK's `OAuthTokenVerifier` *is* the RS seam the ADR predicted, making the
  deferred-OAuth path a verifier swap. Q7 stays open, re-pointed at #1487.
- **`implementation-plan-mcp-server.md`** — correct the stale dependency line (`@modelcontextprotocol/sdk` is the
  v1 line; v2 is a scoped family). Record that Phase 0 shipped the auth seam + minimal transport.
- **`docs/architecture-overview.md`** — under the MCP paragraph in § Capability Abstractions: OL is an RS
  validating its own PATs via `OAuthTokenVerifier`; principal reaches tools as `ctx.authInfo`.
- **`docs/engineering-standards.md`** — MCP-protocol routes are `@Public()` + `VERSION_NEUTRAL` +
  `requireBearerAuth`; they never rely on the global `JwtAuthGuard`.
- **`apps/api/.env.example` + `docs/dev-environment.md`** — document the new `OL_MCP_RESOURCE_URL` (RFC 8707
  resource binding, §3.4): what it is, its default-derivation rule, and that a mismatch presents as a bare 401
  with no further diagnostic. Every other operator-facing `OL_*` var in this repo is documented
  (`OL_WEBHOOK_SKEW_WINDOW_MS`, `OL_CUSTOMER_IDENTITY_MODE`, `OL_STORE_PII`, …); this one must be too.
- **`docs/lessons.md`** — three entries, all observed this session:
  1. `@modelcontextprotocol/sdk` is the **v1** line; v2 shipped as a scoped package family. Checking the v1 name
     for a `2.x` tag reports "v2 not released" and is wrong.
  2. Verify a new SDK's API against installed `.d.ts` files, not a fetched doc summary — the summary produced a
     `createExpressHandler` that does not exist.
  3. A service in `apps/api` may not inject a core `*RepositoryPort` — `check-cross-context-imports` denies it,
     and the `RefreshTokenService` precedent passes only via a grandfathered ALLOW_LIST entry (#718/#722).
     Put the service in the owning context and cross the boundary through an `I*Service`.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Q7 unresolved** — client may refuse a manual `Authorization` header | High | Testable against a real endpoint post-merge. If negative, verifier + store survive; only issuance is superseded by an AS — a smaller blast radius now the seam is the SDK's standard interface |
| SDK v2 is days old; API may churn | Medium | Surface kept to one verifier + one factory + one controller. `server-legacy` + `codemod` packages exist as escape hatches |
| First `MiddlewareConsumer` in the repo | Low | Deliberate, rationale recorded (§3.7); reversible to a `main.ts` hook without touching the verifier |
| Migration timestamp contested at merge with #1817 | Low | Free on `origin/main` today; invariant fails loudly |
| Long-lived bearer PAT = OWASP MCP01 | Accepted (ADR-034) | Scope floor + hash-at-rest + **mandatory** expiry + revocation + resource binding + admin-scope + single-tenant |
| `whoami` leaking data | Low | Returns `{ userId, role, scopes, tokenName }` — never token, hash, or credential |
| **`AuthInfo` carries the raw bearer token** | **High if mishandled** | §3.6.1 invariant: never logged/serialized wholesale; redacted projection only; enforced by leak assertions in §5. Inherited by #1487's audit log |
| No throttle on `/mcp` before verification | Accepted | Per-token rate/concurrency cap is #1487's (it is a fairness cap, not a DoS control). Brute-forcing a 256-bit opaque token is infeasible, so the residual exposure is an unauthenticated flood doing one indexed lookup per request — recorded as an accepted gap, not an oversight |

---

## 8. Validation Checklist

- [ ] **File header comment on every new source file** (`engineering-standards.md` § File Headers — a missing
      header is a 🔴 blocking finding per `code-review-guide.md`)
- [ ] **`AuthInfo` never logged / serialized / returned wholesale; redacted projection only** (§3.6.1)
- [ ] Domain layer free of NestJS/TypeORM imports
- [ ] **`libs/core` imports no `@modelcontextprotocol/*`** (§1)
- [ ] **No `*RepositoryPort` imported from `apps/api`** — `check-cross-context-imports` green, ALLOW_LIST unchanged
- [ ] `McpTokenService` passes `check-service-interfaces` (now in scope, `libs/core`)
- [ ] Repository port in `domain/ports/`, impl in `infrastructure/persistence/repositories/`
- [ ] Symbol DI tokens in `users.tokens.ts`, re-exported via `export *`
- [ ] Migration timestamp synthetic + ordered
- [ ] No `any`, no `console.log`, no hardcoded secrets; raw token never logged
- [ ] `AuthInfo.expiresAt` always populated (§3.2)
- [ ] FE route is lazy + carries `handle.crumb`; registered in `coreChildren`
- [ ] FE: three-layer admin gating; no raw `fetch`; nothing secret persisted client-side
- [ ] `pnpm lint` / `pnpm type-check` / `pnpm test` green; `pnpm test:integration` for the auth slice

---

## 9. Gate findings applied

| Gate finding | Resolution |
|---|---|
| 🔴 Cross-context `*RepositoryPort` import from `apps/api` | **Fixed** — `McpTokenService` moved to `libs/core/src/users/application/services/`; `apps/api` injects `IMcpTokenService` via `MCP_TOKEN_SERVICE_TOKEN` (§1, §3.5, §3.9). ALLOW_LIST untouched |
| 🔴 (second-order) `UserRepositoryPort` needed for role inheritance | **Fixed** — `resolvePrincipal` returns the role from core; `apps/api` never touches `UserRepositoryPort` |
| 🟡 `MiddlewareConsumer` has no precedent | **Decided + recorded** (§3.7) — keep it, rationale and reversibility stated |
| 🟡 Migration collision overstated | **Corrected** (§3.10) — free on `origin/main`; contested only at merge |
| 🟡 FE route contract tests | **Added** (§3.11) — lazy + `handle.crumb` + `coreChildren` registration |
| 🟡 `CoreApiClient` namespace registration unnamed | **Added** (§3.11) |
| ℹ️ Admin gating is manual/three-layer | **Added** (§3.11) |
| ℹ️ `CopyableId` hover-hides its copy button | **Addressed** (§3.11) — dedicated reveal component instead |

## 10. Tech-review findings applied

| Finding | Resolution |
|---|---|
| 🔴 `AuthInfo` carries the raw bearer token; nothing forbade logging it | **Fixed** — new §3.6.1 standing invariant + §5 leak assertions + §7 risk row + §8 checklist item. Explicitly inherited by #1487's audit log |
| 🟡 Core placement diverges from 3 sibling token services, unnamed | **Named** (§1) — siblings pass only via the grandfathered ALLOW_LIST (#722); core is the only compliant home and moves toward #722's end state |
| 🟡 `EXPECTED_LAZY_ROUTE_COUNT = 49` would fail the suite | **Fixed** (§3.11, step 11) — bump to 50 in the same commit |
| 🟡 User-deletion leaves orphaned credential rows; untested | **Fixed** (§3.10) — FK + `ON DELETE CASCADE` (deliberate divergence from `refresh_tokens`) + orphan-token test case (§5) |
| 🟡 `OL_MCP_RESOURCE_URL` undocumented | **Fixed** (§6) — `.env.example` + `dev-environment.md`, incl. default-derivation and the bare-401 failure mode |
| 🟡 Unique-violation exception unnamed; `McpModule`→`UsersModule` import unstated | **Fixed** (steps 3, 9) — no domain exception (collision unreachable at 256 bits), stated explicitly; module import named |
| 🟡 File headers missing from the checklist | **Fixed** (§8) |
| 🟢 Scope denormalization trade-off | **Recorded** (§3.3) |
| 🟢 Feature barrel | **Adopted** (§3.11) |
| 🟢 `whoami` vs `.tool.ts` convention | **Stated** (step 9) — deliberately deferred to #1487 |
| 🟢 No throttle before verification | **Recorded as accepted** (§7) |
| 🟢 Nav placement ambiguity | **Decided** (§3.11) — settings-tile only, no nav entry; gating is two-layered |
