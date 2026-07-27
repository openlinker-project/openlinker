# Implementation Plan: Expose OpenLinker as an MCP Server

**Date**: 2026-07-11
**Status**: Ready for Review
**Estimated Effort**: Planning only (this EPIC). Implementation ≈ Phase 0: 3–5 d (RS bearer guard + PAT mint/store/hardening + admin token-management settings UI — see Q1 / Q4 / ADR-034; no Authorization Server in v1) · Phase 1: 3–5 d · Phase 2: 5–8 d · Phase 3: 5–7 d (per-token connection scoping added — Q5). Each a separate child issue, shipped post-stable-SDK ~28 Jul 2026.

> Decision rationale, security model, and alternatives live in [ADR-033](../architecture/adrs/033-openlinker-as-mcp-server.md). This plan is the *what* and *how*; the ADR is the *why*.

---

## 1. Task Summary

**Objective**: Expose OpenLinker as an **MCP (Model Context Protocol) server** so AI agents (Claude, ChatGPT, …) can query and drive OL's capabilities, as a new Interface-layer adapter over existing application services — **no CORE ↔ Integration contract changes**.

**Context**: MCP is a governed open standard with an open early-mover window for multichannel orchestrators (see ADR-033 § Context). OL's architecture fits unusually cleanly: every adapter call already funnels through one gated seam (`IIntegrationsService.getCapabilityAdapter`), and spec-native secret handling (URL-mode elicitation) maps onto OL's existing OAuth flow.

**Classification**: **Interface** (new MCP adapter over existing application services), with a net-new auth slice (Phase 0) and small Frontend slices (Phase 0 token-management settings UI + Phase 3 key-entry page). No domain/core contract changes.

---

## 2. Scope & Non-Goals

### In Scope
- ADR-033 (done, this EPIC), this plan (this EPIC), and the four phased child issues (this EPIC).
- Phase 0–3 **implementation** ships as the child issues, not here.

### Out of Scope
- **Any runtime code in this EPIC** — docs/planning only.
- **OL-as-MCP-client** (OL consuming external MCP servers) — different problem, deferred.
- **Any credential-argument tool** (`save_api_key(key)`, secrets in tool args or returns) — *permanently* out of scope (ADR-033 decision #2; OWASP MCP01).
- CORE ↔ Integration boundary changes; new capability ports; DB schema changes to existing tables.

### Constraints
- **SDK timing**: implement on the **stable MCP TypeScript SDK v2 (~28 Jul 2026)**; the ~28 Jul 2026 revision carries breaking changes. Author now, code after.
- **Phase 0 gates Phases 1–3** — no domain/config tool ships before the client↔server auth layer.
- New dependency: `@modelcontextprotocol/sdk` (MCP protocol server + RS bearer primitives) — none present today. **No `node-oidc-provider`** in v1 (no AS — ADR-034); it becomes a dependency only if/when the deferred OAuth upgrade ships. Node ≥18 / NestJS 10.3 / TS 5.4 / Express — compatible.

---

## 3. Architecture Mapping

**Target Layer**: **App / Interface** — new NestJS feature module `apps/api/src/mcp/` inside the existing API app (ADR-033 § wiring). Reuses the running HTTP server + Express transport, the global `JwtAuthGuard`/`RolesGuard` (`apps/api/src/auth/auth.module.ts:70-71`), the `@Public()` + `VERSION_NEUTRAL` primitives (`apps/api/src/auth/decorators/public.decorator.ts`, used by `webhook.controller.ts:40` and `allegro.controller.ts:147`), and the composed `PluginRegistryModule` / DB / Redis DI graph. **No** standalone third app (rejected — see ADR-033 § Alternatives).

**The one seam everything mounts on**:
- `IIntegrationsService.getCapabilityAdapter<T>(connectionId, capability)` — `libs/core/src/integrations/application/interfaces/integrations.service.interface.ts:48`; token `INTEGRATIONS_SERVICE_TOKEN` (`libs/core/src/integrations/integrations.tokens.ts:13`).
- `listCapabilityAdapters<T>({ capability, platformType?, lazy? })` — same interface, line 82 (drives multi-connection tools + per-connection `tools/list`).
- Runtime two-tier gate (inherited for free): `integrations.service.ts:100` (adapter supports capability → else `CapabilityNotSupportedException`) and `:108` (connection has it enabled → else `CapabilityNotEnabledException`).
- Credential isolation below the seam: `credentialsRef` + `enabledCapabilities` on `connections` (`connection.orm-entity.ts:41,47`), AES-256-GCM `integration_credentials` (ADR-006), `CredentialsResolverPort` (`CREDENTIALS_RESOLVER_TOKEN`).

**Capabilities involved** (read via `is{X}` guards, never a static catalog):
- `ProductMaster`, `InventoryMaster`, `OrderSource` (Phase 1 reads).
- Options readers `DestinationOptionsReader` / `SourceOptionsReader` (`libs/core/src/orders/domain/ports/capabilities/*`), `CategoryBarcodeMatcher` / `EanCategoryMatcher` (`libs/core/src/listings/domain/ports/capabilities/*`) (Phase 2).

**Existing services reused (Phase 2/3 — bind to neutral core interfaces, NOT legacy HTTP DTOs)**:
- `IMappingConfigService` — `MAPPING_CONFIG_SERVICE_TOKEN` (`libs/core/src/mappings/mappings.tokens.ts:9`). Neutral `CategoryMappingInput` (`mappings/domain/types/mapping.types.ts:36`). ⚠️ status/carrier/payment inputs are still `allegro*`/`prestashop*`-named in the domain type (partial neutralization, ADR-023); the MCP layer must not re-import the legacy HTTP DTOs (`apps/api/src/mappings/http/dto/*` still expose `allegroCategoryId` etc.).
- `ICategoryResolutionService` — `CATEGORY_RESOLUTION_SERVICE_TOKEN` (`listings.tokens.ts:16`); `resolveCategory(CategoryResolutionInput)`.
- `IAttributeProjectionService` — `ATTRIBUTE_PROJECTION_SERVICE_TOKEN` (`listings.tokens.ts:7`); `project(AttributeProjectionInput)`.
- `ConnectionService` (`apps/api/src/integrations/application/services/connection.service.ts`) — `create` (:201), `update` (:368, = set-config + enable-capability), `updateCredentials` (:436), `installWebhooks` (:152), `testConnection` (:177), `disable` (:465).
- `OAuthConnectionService` (`oauth-connection.service.ts`) — `generateAuthorizationUrl` (:69), `validateState` (:105), `completeAuthorization` (:129), `checkCompletedState` (:197); public callback `GET /integrations/allegro/oauth/callback` (`allegro.controller.ts:147`).

**New components required**: the `apps/api/src/mcp/` module (transport wiring, per-connection tool registry, the MCP↔OL auth bridge), an admin-only MCP-token-management settings page (Phase 0, FE), plus one net-new OL-hosted branded key-entry page (Phase 3, FE). No new domain entities/ports.

**Core vs Integration justification**: This is a pure Interface adapter. It calls only published application-service interfaces and capability ports through the barrels; it introduces no domain logic and no platform knowledge (platform specifics stay behind the capability guards and the OAuth-completion registry). Nothing here belongs in CORE or in a plugin.

---

## 4. External / Domain Research

### External System — MCP
- **Governance/lifecycle**: Linux Foundation Agentic AI Foundation (Dec 2025); formal SEP process; 12-month deprecation-to-removal policy caps churn.
- **Auth (client↔server)** — verified via two deep-research passes (see [ADR-034](../architecture/adrs/034-mcp-authorization-user-issued-pats.md)): MCP authorization is **OPTIONAL** (the OAuth profile is a conditional `SHOULD`, not a `MUST`), and a **user-issued PAT validated by OL as a Resource Server** is spec-permissible and is how GitHub / Atlassian / Sentry ship. So v1 needs **no Authorization Server** — OL mints its own scoped bearer tokens and validates them. (RFC 9728 PRM / DCR / authorize+consent are only required when routing to an external AS.) **OL has none of this today** (`apps/api/src/auth/` is stateless JWT-bearer + `RolesGuard`; no token issuance to third parties). Trade-off: a long-lived bearer PAT is OWASP MCP01 — mitigated by hardening; the short-lived-token OAuth AS is a deferred upgrade.
- **Secret handling**: 2025-11-25 spec adds **URL-mode elicitation** (browser→server, never through the model) and **bans** form-mode / tool-argument secrets (OWASP MCP01).
- **Security surface**: OWASP MCP Top 10; Unit 42's 78.3% cross-server-attack finding → HITL + audit on every write is non-negotiable.
- **SDK / transport**: official `@modelcontextprotocol/sdk` (stable TS v2 ≈ 28 Jul 2026) over **Streamable HTTP** transport, behind a thin Nest `@Public()`/`VERSION_NEUTRAL` controller. No community NestJS wrapper (Q3). Note the v2 SDK ships **only resource-server** auth primitives (`requireBearerAuth`, `mcpAuthMetadataRouter`, `hostHeaderValidation`) — the AS is OL's (embedded library), not the SDK's.

### Internal Patterns
- **Per-connection capability narrowing**: `MappingOptionsController` (`apps/api/src/mappings/http/mapping-options.controller.ts`) already resolves an adapter and returns 501 when a capability is absent — the exact shape `tools/list` reuses.
- **Public + version-neutral routes**: `@Public()` + `VERSION_NEUTRAL` (webhooks, Allegro callback) — the pattern for MCP `.well-known` + OAuth endpoints that must sit at fixed unauthenticated URLs.
- **Neutral OAuth-completion**: ADR-013's `OAuthCompletionPort` + registry means the "start_connection → URL elicitation" tool is platform-agnostic for OAuth platforms.

---

## 5. Questions & Assumptions

### Open Questions
- **Q1 — MCP token model (RESOLVED — see [ADR-034](../architecture/adrs/034-mcp-authorization-user-issued-pats.md)).** OL is an OAuth 2.1 **Resource Server that validates its own user-issued Personal Access Tokens** — **no Authorization Server in v1**. The operator mints a scoped, revocable MCP token from settings (GitHub-PAT style) and pastes it into the MCP client; OL validates it with a bearer guard. MCP authorization is optional per spec, and this matches GitHub/Atlassian/Sentry prior art. *Deferred (not rejected):* an embedded/external OAuth AS for short-lived tokens + consent, behind the same RS seam. *Rejected for v1:* an IdP sidecar, and requiring an external IdP for every deployment.
- **Q2 — `sub` → OL user mapping store.** How does an MCP token `sub` resolve to an OL user? *Default (resolved):* map `sub` → an existing OL user and inherit its flat RBAC role; there is **no per-user connection scoping** (OL is single-tenant; all connections are already globally visible). A thin `sub`→userId mapping is all Phase 0 needs; per-connection `enabledCapabilities` gates capabilities as today. Any per-token connection restriction is Phase 3 scope (Q5), not this store.
- **Q3 — Library + transport (RESOLVED).** Use the official `@modelcontextprotocol/sdk` directly behind a thin `@Public()`/`VERSION_NEUTRAL` transport controller over **Streamable HTTP** (OL is a hosted server, not a stdio subprocess). No community NestJS-MCP wrapper: it adds a second dependency tracking a churning protocol with no lifecycle guarantee, and its value is static `@Tool()` decorators — which fight our dynamic, capability-driven registration (Q4/§6). Revisit only if a *governed* wrapper emerges.
- **Q4 — Do the FE slices warrant separate FE issues? (RESOLVED — fold both.)** Two small FE surfaces exist: the **Phase 0** admin MCP-token-management settings page (generate / one-time-reveal / list / revoke) and the **Phase 3** branded key-entry page + "connected via agent" affordance. Both are BE-dominant slices tightly coupled to their phase's API. *Decision:* fold each into its own phase's child issue with an explicit FE checklist (per `docs/frontend-architecture.md`), rather than spinning separate FE issues — so #1486 carries the token-UI checklist and #1489 the key-entry-page checklist.
- **Q5 — Per-token connection scoping for writes (Phase 3).** Before write/config tools ship, should an agent token be restrictable to a subset of connections (net-new, since OL has none today)? *Default:* yes — introduce an additive per-token connection allow-list as a Phase 3 write prerequisite (the higher-blast-radius surface); reads (P1) and mapping suggestions (P2) run at the user's existing global scope.
- **Q6 — PII in order-read tools (deferred).** `OrderSource` reads carry buyer PII, which the agent's LLM provider would receive as a de-facto sub-processor. Consciously **deferred for now** — not designed into Phase 1. Flag to revisit before order-read tools ship (options if/when: default PII-minimized reads + explicit opt-in tool; honor `OL_STORE_PII` as a floor).
- **Q7 — MCP client accepts a manual bearer header? (validate before Phase 0 code — the one thing that could kill the PAT model).** The PAT approach requires the target MCP client to accept a static `Authorization` header for a *remote* Streamable-HTTP server. Confirmed at the server/vendor/framework level (GitHub/Atlassian/Sentry/FastMCP), **not** exhaustively per GUI client. *Default:* run a ~1-hour stub-server header check against the actual target (Claude Desktop, etc.) before committing Phase 0. A client that refuses manual headers pulls the deferred OAuth AS forward.

### Assumptions
- "Create the ADR and plan the implementation" = this EPIC produces **ADR + plan + child-issue breakdown only**; runtime code ships as Phase 0–3 children.
- Demand is unproven → P1 (+P2) treated as a **low-regret spike**; write-heavy P3 gated behind demand evidence.
- Node ≥18 / NestJS 10 / TS 5.4 remain MCP-SDK-compatible at implementation time (re-verify against the stable v2 SDK).

### Documentation Gaps
- No existing OL doc covers a resource-server auth model; the Phase 0 child issue should add one (or an ADR addendum) when the token model is chosen.

---

## 6. Proposed Implementation Plan

> **Cross-cutting invariants (apply to every phase)**
> - **Dynamic, capability-declared `tools/list`**: never a static catalog. **Each tool declares the capability (or sub-capability) it requires** and is registered iff **at least one** of the calling principal's in-scope connections supports *and* has enabled it — computed via `listCapabilityAdapters({ capability, lazy: true })` (`lazy` avoids constructing adapters just to list). A **base read port backs several tools** (`ProductMaster` → `search_catalog` + `get_product`); a **decomposed port maps one tool per sub-capability** (`OfferCreator` → `create_offer`, `CategoryBrowser` → `browse_categories`, … across the ~34 sub-capabilities in `docs/capabilities.md`). `connectionId` is a **validated tool argument** (not baked into the tool name — names stay stable: `create_offer`, not `create_offer__allegro-main`); a `list_connections` tool tells the agent which connections back which tool. Call-time `connectionId`→capability validation is enforced by the existing `getCapabilityAdapter` gate (throws `CapabilityNotSupported`/`NotEnabled`). The list mutates with connection/capability state and is republished via `notifications/tools/list_changed`. Bounded by the capability surface (not N connections × M capabilities), with stable, cacheable tool names.
> - **Secret invariant**: no credential-argument tools; secrets only via URL-mode elicitation / out-of-band browser entry. No tool returns a secret.
> - **Write/config invariant (v1)**: every write/config tool is **admin-scoped** (maps to `@Roles('admin')`) and **audit-logged** (`{ actorSub, olUserId, connectionId, tool, args-minus-secrets, timestamp }`). Human-in-the-loop for v1 relies on the **MCP client's tool-approval UX** plus the **coarse consent implied when the operator minted + installed an admin-scoped MCP token** (Phase 0) — not per-action server-side enforcement. Deliberate, bounded choice: admin-scope + audit cap the blast radius, and Phase 3 (the write-heavy phase) is demand-gated and ships last. **Deferred hardening (revisit at Phase 3):** server-enforced two-phase confirmation (a write tool returns a *pending action* + an out-of-band browser confirmation the model can't self-approve) for config/destructive tools, if the write surface warrants it — recorded as a named residual risk (§ 8), not silently assumed.
> - **Abuse invariant**: MCP tool calls carry a **per-token (per-principal) rate limit + concurrency cap**, distinct from adapter-level rate-limit backoff. Adapter backoff protects the downstream marketplace API from OL; this cap protects **OL's own sync-job fairness** (the agent and the scheduler share a connection's upstream quota) and the connection's upstream standing from an autonomous agent that loops. **This limiter is net-new** — the repo has no generic rate-limiter or semaphore to reuse (no `@nestjs/throttler`; `CachePort` has no atomic increment; the shipping ZSET is query-popularity ranking, not a limiter). Build it on the raw `REDIS_CLIENT`, patterned on the ZSET rolling-window mechanics in `redis-pickup-point-query-stats.adapter.ts` and the Lua-atomic `RedisSyncLockService`. The audit log supplies the usage signal to tune limits.

### Phase 0 — Client↔server MCP auth (gating prerequisite, net-new)
**Goal**: OL is an OAuth 2.1 **Resource Server that validates OpenLinker-issued Personal Access Tokens** (Q1 / [ADR-034](../architecture/adrs/034-mcp-authorization-user-issued-pats.md)) — **no Authorization Server in v1**. The operator mints a scoped MCP token from settings, pastes it into the MCP client (`Authorization: Bearer …`), and OL validates it. Maps the token → OL user (inheriting its RBAC role; no per-user connection scoping — Q2). Adversarially reviewed against the OWASP MCP Top 10 before any tool ships.

> **Validate first (Q7, ~1 h):** before building, confirm the target MCP client (Claude Desktop, etc.) accepts a manual `Authorization` header for a *remote* Streamable-HTTP server — a stub-server header check. A client that refuses manual headers forces the deferred OAuth upgrade sooner. See ADR-034 § Open questions.

**Steps**:
1. **MCP token mint + store (API)** — admin-scoped mint/list/revoke endpoints (`@Roles('admin')`) that generate a scoped, revocable MCP token (GitHub-PAT style), plus a store (extend the `refresh_tokens` hashing precedent, or a dedicated `mcp_tokens` table — Q2). The settings UI that drives these is step 5. **Token format** (decide here): opaque random string, hash-compared (leaning default — trivial revocation) vs signed JWT (ADR-034 § Open questions). **Scope floor:** at minimum a **read-only vs read-write** scope so a leaked read-only token can't drive writes. **Hardening (mandatory):** hash-at-rest, one-time reveal, expiry, per-token revocation, audience binding, rotation. *Acceptance*: an admin mints a token (with a scope) shown once; it is stored hashed; revoke/expiry work; a read-only token is refused on a write; the raw token never re-appears in any read.
2. **Resource-Server bearer guard** — `apps/api/src/mcp/auth/mcp-token.guard.ts`: validates the presented bearer against the store (hash compare), checks scope + expiry + revocation, and rejects otherwise (401 with a minimal `WWW-Authenticate: Bearer`, per RFC 6750, for client discovery). **Token-passthrough prohibition**: OL only accepts its own tokens and never forwards the client's token to upstream marketplace APIs (Allegro/PrestaShop) — OL holds its own upstream credentials separately. *Acceptance*: valid token → authorized; expired/revoked/unknown/wrong-scope → 401; a passthrough (non-OL) token is refused; unit-tested against crafted tokens.
3. **Token → OL principal mapping** — resolve the token to its owning OL user and **inherit that user's flat RBAC role** (admin/operator/viewer). OL is single-tenant per deployment (no owner/tenant column on `connections`; any authenticated user already sees every connection), so **all connections are in scope exactly as a human session sees them today** — there is no per-user "allowed connections" concept. Per-connection `enabledCapabilities` continues to gate *capabilities*, not *which connections*. *Acceptance*: resolves an OL user + role; unknown token → 401. **Per-token connection scoping is out of scope here — deferred to Phase 3 (§ Phase 3).**
4. **Wire the module** — add `McpModule` to `apps/api/src/app.module.ts` imports; MCP routes sit behind the bearer guard. *Acceptance*: API boots; existing routes unaffected.
5. **MCP-token management UI (FE, net-new — folded per Q4)** — an admin-only settings page in `apps/web` (e.g. `/settings/mcp-tokens`): a *Generate token* form (name + scope + expiry), a **one-time-reveal modal** (shows the raw token once with a copy button, then never again — the UX half of step 1's one-time-reveal hardening), an active-token list (name / scope / created / last-used / expiry, no raw value), and a revoke action with confirm. Server state via TanStack Query, form via RHF + Zod, driven by the step-1 endpoints; nothing secret persisted client-side. *Acceptance*: an admin generates a token and sees the raw value exactly once; copy works; the list shows active tokens without the raw value; revoke removes a token; FE checklist per `docs/frontend-architecture.md` (loading/empty/error states, `app→pages→features→shared` direction, no raw `fetch`).

**Deferred (optional upgrade, not v1 — ADR-034):** an OAuth 2.1 Authorization Server (embedded `node-oidc-provider` or external IdP) for short-lived tokens / per-action consent / delegation. It plugs into the **same RS bearer seam** (step 2), so it's additive when demand warrants (enterprise/multi-user).

**Dependencies**: none (net-new). **Gates**: Phases 1–3.

### Phase 1 — Read-only domain tools (low-regret spike)
**Goal**: Highest-utility, lowest-blast-radius tools: catalog search + `getProduct` (`ProductMaster`), availability reads (`InventoryMaster`), order-status reads (`OrderSource`).

**Steps**:
1. **Capability-gated tool registry** — `apps/api/src/mcp/tools/tool-registry.service.ts` — builds `tools/list` for the calling principal: each tool declares a required capability and is registered iff ≥1 in-scope connection supports+enables it (`listCapabilityAdapters({ capability, lazy: true })`). A base read port backs several tools (`ProductMaster` → `search_catalog` + `get_product`); `connectionId` is a validated argument; plus a `list_connections` tool. Emits `notifications/tools/list_changed` when the capability inventory changes. *Acceptance*: a capability no in-scope connection supports has all its tools absent from `tools/list`; a call naming a `connectionId` that lacks the capability is rejected by the `getCapabilityAdapter` gate; adding/removing a connection republishes the list.
2. **Read tools** — `apps/api/src/mcp/tools/read/*.tool.ts` — each resolves its adapter via `getCapabilityAdapter` and returns neutral read models. *Acceptance*: tool calls succeed for capable connections, return the capability-not-enabled error shape otherwise.
3. **Audit log (reads)** — lightweight structured log per call (no HITL needed for reads). *Acceptance*: every call logged with principal + connection + tool.
4. **Per-token rate/concurrency cap** — enforce the abuse invariant with a **net-new** limiter on the raw `REDIS_CLIENT` (no reusable primitive exists — see the invariant). *Acceptance*: a token exceeding its call-rate or concurrency ceiling is throttled (429-equivalent MCP error) without starving the scheduler's share of the connection's upstream quota.

**Dependencies**: Phase 0.

### Phase 2 — Mapping assistant (highest ROI; no secrets, correctable mistakes)
**Goal**: Read/discovery + suggestion tools over the neutral mapping/resolution seams; write tools HITL-gated. Ship a `configure-mappings` Skill.

**Steps**:
1. **Discovery tools** — options via `DestinationOptionsReader`/`SourceOptionsReader`; category suggestions via `ICategoryResolutionService.resolveCategory` + `EanCategoryMatcher`; attribute projections via `IAttributeProjectionService.project`. *Acceptance*: read-only; bind to neutral core interfaces (⚠️ not legacy `allegro*` HTTP DTOs).
2. **Write tools** — `upsertCategoryMapping` etc. via `IMappingConfigService`, using neutral `CategoryMappingInput`. *Acceptance*: admin-scoped, audit-logged; human approval via the MCP client's tool-approval UX (v1 model — these writes are correctable/no-secrets, so client-trust is appropriate here).
3. **Skill** — `configure-mappings` procedure doc. *Acceptance*: encodes the discover→suggest→confirm→write loop.

**Dependencies**: Phase 0 (Phase 1 helpful, not required).

### Phase 3 — Secure connection setup (Skills + MCP + out-of-band)
**Goal**: `start_connection` returns a URL-mode elicitation; OAuth platforms reuse the existing flow; API-key platforms use one net-new branded key-entry page. Non-secret orchestration tools for status/test/webhooks/config/capability.

**Steps**:
1. **`start_connection` tool** — returns a URL-mode elicitation; OAuth path calls `OAuthConnectionService.generateAuthorizationUrl`; API-key path returns the new key-entry page URL. *Acceptance*: never accepts a secret as a tool arg.
2. **Branded key-entry page (FE, net-new)** — posts to `PUT /connections/:id/credentials` (`ConnectionService.updateCredentials`). *Acceptance*: secret goes browser→server only; page is the sole API-key entry surface for agent-assisted setup. (Per Q4, folded into this issue with an FE checklist.)
3. **Orchestration tools (writes)** — `check_connection_status` / `test_connection` (`testConnection`), `install_webhooks` (`installWebhooks`), `set_connection_config` + `enable_capability` (`update`). *Acceptance*: all admin-scoped, audit-logged; **never** a `save_api_key(key)` tool. **Phase 3 is where the deferred HITL-hardening decision is made** (server-enforced two-phase confirmation vs. continued client-trust) — these are the higher-blast-radius, less-reversible writes; default recommendation is server-enforced two-phase for the config/destructive subset.
4. **Per-token connection scoping (net-new, Q5)** — introduce an additive per-token connection allow-list so a write-capable agent token can be restricted to a subset of connections (OL has no such scoping today; §3 read/suggestion tools run at the user's existing global scope). *Acceptance*: a write/config tool call against a connection outside the token's allow-list is refused; default (no allow-list) preserves current global behavior for backward compatibility.

**Dependencies**: Phase 0.

### Configuration Changes
- New dependency in `apps/api/package.json`: `@modelcontextprotocol/sdk` (see ADR-034). No `node-oidc-provider` in v1.
- Env: MCP resource identifier / expected audience (names decided in Phase 0).

### Database Migrations
- Only the Phase 0 **MCP-token store** (`mcp_tokens`, or an extension of `refresh_tokens` — Q2): hashed token, owner user id, scopes, audience, expiry, revoked-at. **New table only — no changes to existing tables.** (No OAuth client-registration table — no AS in v1.)
- Each new migration must follow the **synthetic sequential timestamp** convention (`migrations.md § Timestamp uniqueness invariant`) — re-prefix the `migration:generate` output to the next free synthetic timestamp, don't ship a raw `Date.now()` prefix (the ordering guard fails `pnpm lint` otherwise). Author it in the Phase 0 child issue (#1486).

### File-naming note (for the child issues)
- The MCP tool files (`tools/**/*.tool.ts`) introduce a `.tool.ts` suffix not yet in `engineering-standards.md § Files and Folders` — decide/register the convention in the Phase 1 issue (#1487) before code.
- The Phase 0 MCP-token service + `tool-registry.service.ts` (Phase 1) follow the service-interface rule (an `implements` clause on an `I*Service` or a `*Port`). The `check-service-interfaces` invariant only scans `libs/core/src`, so `apps/api` won't fail the build, but the standard still applies.

### Events / Error Handling
- No new domain events. Reuse `CapabilityNotSupportedException` / `CapabilityNotEnabledException` (map to the MCP capability-not-available error shape). Auth failures → 401/403 via the Phase 0 guard.

---

## 7. Alternatives Considered

*(Full treatment in [ADR-033](../architecture/adrs/033-openlinker-as-mcp-server.md) § Alternatives.)*

- **Standalone third app** (mirror `apps/worker/`) — rejected: duplicated package + a third hand-synced plugin list (`apps/worker/src/plugins.ts` is already a maintained divergence) + a fresh HTTP bootstrap, for no benefit while MCP shares the API's auth/plugins/domain DI. Revisit only if MCP must scale/deploy independently.
- **Full read-write surface now, on the current SDK** — rejected: maximizes blast radius during the protocol's most volatile window and before any demand signal.
- **Static `tools/list`** — rejected: would advertise tools a connection can't service, breaking the capability contract and leaking a misleading surface to agents.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Pure Interface adapter over published application-service interfaces + capability ports; no CORE ↔ Integration change; no new domain logic. (ADR-033; `docs/architecture-overview.md § Capability Abstractions`.)

### Naming Conventions
- ✅ `*.controller.ts` / `*.service.ts` / `*.guard.ts` / `*.tool.ts` under `apps/api/src/mcp/`; Symbol DI tokens per `engineering-standards.md § Symbol DI Token Re-export Convention`.

### Existing Patterns
- ✅ Reuses `@Public()`/`VERSION_NEUTRAL`, `getCapabilityAdapter`, `is{X}` guards, `OAuthConnectionService`, `ConnectionService` — no new abstraction invented.

### Risks
- **Protocol churn** → mitigated by the stable-SDK-timing constraint + the 12-month lifecycle policy.
- **Write exposure via an agent token** (OL is single-tenant, so this is blast-radius within one org, not cross-tenant) → mitigated by admin-scope + audit on every write, coarse consent at OAuth-grant time, and demand-gating Phase 3.
- **Residual risk — v1 relies on the MCP client's tool-approval UX for per-action HITL** (an auto-approving or prompt-injected client can invoke a write without a fresh human confirmation). Accepted for v1 because reads (P1) need no gate and P2 writes are correctable/no-secrets; the named trigger to revisit is Phase 3's config/destructive writes, where server-enforced two-phase confirmation is the recommended hardening. Mapped to OWASP MCP (missing server-side authorization on state-changing operations).
- **The MCP auth layer is net-new & security-critical** (RS validating user-issued PATs, ADR-034) → isolated as Phase 0, adversarially reviewed (OWASP MCP Top 10 checklist) before any tool ships.
- **Long-lived bearer PAT = OWASP MCP01 (Token Mismanagement)** → mitigated (not eliminated) by hash-at-rest, expiry, scopes, one-time reveal, revocation, audience binding, rotation, plus admin-scope + audit + HITL-on-writes + the single-tenant/operator-controlled context. The short-lived-token OAuth AS is the deferred upgrade if this trade-off ever proves insufficient.
- **Client-compatibility (load-bearing)** → a target MCP client that refuses a manual `Authorization` header would break the PAT model; validate per Q7 (~1 h) *before* Phase 0 code. **Spec is mid-transition** — re-verify against the ratified 2026-07-28 revision before code freeze.
- **Partial mapping-shape neutralization (ADR-023)** → MCP binds to neutral core service interfaces, never the legacy `allegro*`/`prestashop*` HTTP DTOs.

### Backward Compatibility
- ✅ Purely additive; the MCP module is opt-in and inert until Phase 0 ships. No existing behavior changes.

---

## 9. Testing Strategy & Acceptance Criteria

*(For the child issues — this EPIC ships no code and needs no tests.)*

### Unit Tests
- Phase 0: token validation (audience/issuer/resource/PKCE), `sub`→principal mapping, `.well-known` shape.
- Phase 1: `tool-registry` per-connection narrowing (capable vs. not-enabled vs. not-supported).
- Phase 2/3: HITL gate (rejected confirmation → no write), audit-log emission, the no-secret-in-args/returns invariant.

### Integration Tests
- One vertical slice per phase against Testcontainers (auth handshake → `tools/list` → a read tool; a HITL write round-trip).

### Acceptance Criteria (this EPIC)
- [x] ADR authored at `docs/architecture/adrs/033-openlinker-as-mcp-server.md` per the README template (decision, confidence, alternatives, capability-port→tool mapping, spec-native secret model, net-new auth gap, SDK-timing constraint).
- [x] ADR registered in `docs/architecture/adrs/README.md` and cross-linked from `docs/architecture-overview.md § Capability Abstractions`.
- [x] Implementation plan at `docs/plans/implementation-plan-mcp-server.md` covering all four phases, exact seams/services per phase, and the chosen wiring (`apps/api/src/mcp/` module vs standalone app).
- [x] Plan documents the per-connection dynamic `tools/list` requirement (runtime `is{X}` guards) and the HITL-gating + audit-logging model for every write/config tool.
- [x] Child issues drafted for Phase 0–3 and linked from EPIC #1350 as sub-issues: #1486 (P0), #1487 (P1), #1488 (P2), #1489 (P3) — Phases 1–3 declare a blocked-by-#1486 dependency (§ 11).
- [x] Security model states the "no credential-argument tools; URL-mode elicitation / out-of-band entry only" invariant, mapped to OWASP MCP Top 10 + the MCP auth spec.
- [x] No runtime code changes in this EPIC; no architecture boundary changes.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (Interface adapter over application services)
- [x] Respects CORE vs Integration boundaries (no change to either)
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (reuses idempotent connection/OAuth seams; reads are safe)
- [x] Event-driven patterns used where applicable (n/a — no new events)
- [x] Rate limits & retries addressed (inherited from adapters below the seam)
- [x] Error handling comprehensive (reuses capability exceptions; auth 401/403)
- [x] Testing strategy complete (per-phase, above)
- [x] Naming conventions followed
- [x] File structure matches standards (`apps/api/src/mcp/`)
- [x] Plan is execution-ready (per phase, seam-precise)
- [x] Plan is saved as markdown file

---

## 11. Child-Issue Breakdown (to create + link from EPIC #1350 on ship)

Each is a sub-issue of #1350; Phases 1–3 declare a **blocked-by Phase 0** dependency.

1. **Phase 0 — `[MCP] Client↔server OAuth 2.1 resource-server auth layer`** (CORE/Interface + security). Deliver: `.well-known/oauth-protected-resource`, token validation (PKCE/RFC 8707/RFC 9207/audience), `sub`→OL-principal mapping (+ store), `McpModule` wired into `app.module.ts`. **Gates all others.** Labels: `enhancement`, `security`.
2. **Phase 1 — `[MCP] Read-only domain tools (ProductMaster / InventoryMaster / OrderSource)`** (Interface). Deliver: per-connection dynamic `tools/list`, read tools over `getCapabilityAdapter`, read audit log. Blocked-by Phase 0. Labels: `enhancement`.
3. **Phase 2 — `[MCP] Mapping assistant tools + configure-mappings Skill`** (Interface). Deliver: discovery/suggestion tools over neutral `IMappingConfigService`/`ICategoryResolutionService`/`IAttributeProjectionService`/options-readers/EAN matcher; HITL write tools; Skill. Bind to neutral core interfaces (not legacy HTTP DTOs). Blocked-by Phase 0. Labels: `enhancement`.
4. **Phase 3 — `[MCP] Secure connection setup (URL-mode elicitation + branded key-entry page)`** (Interface + small Frontend). Deliver: `start_connection` (OAuth reuse + API-key page), the net-new key-entry page → `PUT /connections/:id/credentials`, non-secret orchestration tools (status/test/webhooks/config/capability), all HITL for writes. Blocked-by Phase 0. Labels: `enhancement`, `security`.

---

## Related Documentation
- [ADR-033: Expose OpenLinker as an MCP server](../architecture/adrs/033-openlinker-as-mcp-server.md)
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
