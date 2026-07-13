# Pre-Implement Analysis: implementation-plan-mcp-server.md

**Gate date**: 2026-07-11
**Plan**: [docs/plans/implementation-plan-mcp-server.md](../implementation-plan-mcp-server.md)
**Issue**: #1350 (EPIC — MCP server ADR + plan)
**Reviewer**: OpenLinker Tech Lead (read-only readiness gate)

---

## Verdict: **READY** (with one accuracy correction)

The plan is greenfield and implementable — every artifact it proposes to create is confirmed absent, and it changes no published contract surface (the only edit to existing code is one additive `imports[]` line in `app.module.ts` + a new npm dependency). **One reuse claim is inaccurate** (the rate-limiter "reuse") and should be corrected to "net-new, patterned on X" so the effort estimate and implementation aren't misled — but it is not a collision or a contract break, so it does not gate.

---

## Reuse findings (does it already exist?)

| Plan artifact | Class | Evidence |
|---|---|---|
| `apps/api/src/mcp/` module, `McpModule`, mcp tokens/controllers | **NEW** | ABSENT — no `mcp` source dir anywhere; only the plan/ADR docs match `mcp` |
| `@modelcontextprotocol/sdk` dependency | **NEW** | ABSENT in all 20 workspace `package.json`s — no version collision |
| OAuth 2.1 **Authorization Server** (`/authorize`, `/token`, DCR RFC 7591, `.well-known/oauth-*`, consent) | **NEW** | ABSENT as an AS. OL's `OAuthConnectionService` (`oauth-connection.service.ts:69`) is an OAuth *client* to Allegro — distinct, no collision. `auth/registration.service.ts` is user-account registration, **not** RFC 7591 DCR |
| `sub` → OL-user mapping store | **NEW** | No external-identity/SSO/api-key/PAT table exists. `refresh_tokens` (`migrations/1796000000000-add-refresh-tokens.ts:18`) maps an OL-issued token hash → user (login sessions), **not** an external subject — prior-art *pattern* only, do not reuse verbatim |
| Dynamic, sub-capability-keyed `tools/list` via `listCapabilityAdapters` + `is{X}` guards | **REUSE (seam exists)** | `IIntegrationsService.listCapabilityAdapters` (`integrations.service.interface.ts:82`), `getCapabilityAdapter` (`:48`); `is{X}` guards in `listings`/`orders` `domain/ports/capabilities/**` |
| Read/mapping/setup tools over existing services | **REUSE (seams exist)** | `ConnectionService` (create/update/updateCredentials/installWebhooks/testConnection), `OAuthConnectionService`, `IMappingConfigService`/`ICategoryResolutionService`/`IAttributeProjectionService` — all confirmed in the research phase |
| Per-token **rate limit + concurrency cap** | **NEW (plan overstated reuse)** | ⚠️ The claimed "existing rolling-window limiter (shipping dispatch)" **does not exist**. The shipping ZSET (`redis-pickup-point-query-stats.adapter.ts:40`) is query-popularity ranking (#849), not a limiter. No `@nestjs/throttler`, no generic `RateLimiter`/`TokenBucket`; `CachePort` has no atomic increment. Effectively net-new |

## Backward-compatibility findings

| Surface | Assessment |
|---|---|
| Top-level barrels (`@openlinker/core/<ctx>`) | **No change** — MCP consumes existing barrel exports; adds none |
| Port method signatures | **No change** — reuses `getCapabilityAdapter`/`listCapabilityAdapters` as-is |
| DTO shapes | **No change** to existing DTOs; MCP tool schemas are new |
| Symbol tokens | **No change** — new `mcp` tokens only; no existing token removed/renamed |
| ORM schema | **New tables only** (`sub`→user store, optional client-registration) ⇒ standard forward migration per `docs/migrations.md`. **No change to existing tables.** Warning-level only in that migrations must be authored in the Phase 0 child issue |
| `check:invariants` | **No expected trip** — MCP lives in `apps/api` (not a `libs/core` cross-context path); no deep-barrel imports planned; repo-URL guard already passes on the docs |
| `app.module.ts` | Additive `imports: [McpModule]` — non-breaking |

## Open questions (from the plan, unchanged by this gate)

- **Q1 (resolved — superseded by two post-gate deep-research passes → ADR-034)**: OL is an OAuth 2.1 **Resource Server that validates its own user-issued Personal Access Tokens** — **no Authorization Server in v1** (MCP auth is optional; PAT matches GitHub/Atlassian/Sentry prior art). This supersedes both the in-grill "OL is its own AS" framing and the interim "RS + embedded AS (node-oidc-provider)" framing; the OAuth AS is a deferred optional upgrade. Net effect on this gate: Phase 0 shrinks (no AS/DCR/consent), and the "AS greenfield" backward-compat row above becomes moot for v1. See [ADR-034](../../architecture/adrs/034-mcp-authorization-user-issued-pats.md).
- **Q2 (resolved)**: `sub` → OL user; inherit RBAC role; no per-user connection scoping (single-tenant).
- **Q5**: per-token connection scoping for writes — net-new, Phase 3 prerequisite.
- **Q6**: PII in order-read tools — consciously deferred.
- **Machine-token signing**: reusing `JwtService`/`JWT_SECRET` (HS256, 15m, `{sub,username,role}`) verbatim would conflate login JWTs with long-lived machine tokens — Phase 0 should use a distinct audience/key/expiry for MCP tokens.

## Recommended correction before implementation

1. **Fix the rate-limiter reuse claim** in the plan's *Abuse invariant* and Phase 1 step 4: change "reuses the existing Redis/Valkey rolling-window limiter (as used in shipping dispatch)" → "**net-new** per-token limiter on the raw `REDIS_CLIENT`, patterned on the ZSET rolling-window mechanics in `redis-pickup-point-query-stats.adapter.ts` and the Lua-atomic `RedisSyncLockService`; `CachePort` cannot do atomic increments." Effort +~1 d.
2. (Phase 0 note) Author MCP-token signing with a distinct audience/key from login JWTs — don't reuse `JWT_SECRET`/`refresh_tokens` verbatim.

Neither is a contract break or a reuse collision; the plan is **READY** once the wording is corrected.
