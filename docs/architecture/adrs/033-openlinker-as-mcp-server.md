# ADR-033: Expose OpenLinker as an MCP server

- **Status**: Proposed
- **Date**: 2026-07-11
- **Authors**: @piotrswierzy

## Context

AI agents (Claude, ChatGPT, etc.) increasingly drive back-office software directly. MCP (Model Context Protocol) is the emerging standard for that: a governed open standard (governance moved Dec 2025 to the Linux Foundation's Agentic AI Foundation, with a formal SEP process and a 12-month deprecation-to-removal lifecycle), with 10,000+ production servers. Shopify already ships an official Storefront MCP server; no evidence that BaseLinker / Linnworks / ChannelEngine / Pipe17 do — so there is a real, time-boxed early-mover window for a mid-market multichannel orchestrator.

The question this ADR settles: **should OpenLinker expose itself as an MCP _server_** (agents drive OL), and if so, under what security and architectural model — *before* any runtime code is written. OL-as-MCP-_client_ is explicitly out of scope.

Two facts make the fit unusually clean. First, every adapter call in OL already funnels through one seam — `IIntegrationsService.getCapabilityAdapter<T>(connectionId, capability)` (`libs/core/src/integrations/application/interfaces/integrations.service.interface.ts:48`), with per-connection gating enforced below it (`integrations.service.ts:100,108` throws `CapabilityNotSupportedException` / `CapabilityNotEnabledException`), and credential isolation below _that_ (AES-256-GCM `integration_credentials`, `credentialsRef`, `CredentialsResolverPort` — [ADR-006](./006-credentials-encryption-at-rest.md)). MCP tools bolt onto this seam and inherit isolation for free. Second, secure agent-assisted setup is spec-native: MCP's 2025-11-25 spec adds **URL-mode elicitation** (secrets go browser→server, never through the model) and **bans** form-mode / tool-argument secret entry (also OWASP MCP01) — and OL already has the matching plumbing (`OAuthConnectionService` + `AllegroOAuthCompletionAdapter` + the public `GET /integrations/allegro/oauth/callback`, [ADR-013](./013-neutral-oauth-completion-port.md)).

Countervailing forces: protocol churn (the ~28 Jul 2026 revision is the largest since launch, with breaking changes and a stable TS SDK v2); the security exposure of a write-capable multi-tenant commerce backend (OWASP MCP Top 10; Unit 42's 78.3% cross-server-attack finding); and unproven merchant _demand_ — the case is supply-side + first-mover, not pull.

## Decision

**Conditional yes (medium-high confidence).** Expose OL as an MCP server, as a **new Interface-layer adapter over existing application services** — no CORE ↔ Integration contract changes. Constraints that make it conditional:

1. **Ship on the stable MCP TypeScript SDK v2 (~post-28 Jul 2026)** to avoid the breaking-change window. ADR + plan are authored now; code waits for the stable SDK.
2. **No credential-argument tools, ever.** Secrets enter only via URL-mode elicitation / out-of-band browser entry (reusing the OAuth flow; one net-new OL-hosted key-entry page for API-key platforms). A `save_api_key(key)` tool is permanently out of scope.
3. **`tools/list` is dynamic and capability-declared** — never a static catalog. Each tool declares the capability (or sub-capability) it requires and is registered iff ≥1 in-scope connection supports+enables it (via `listCapabilityAdapters` + the `is{Capability}` guards) — a base read port backs several tools (`ProductMaster` → `search_catalog` + `get_product`), a decomposed port maps one tool per sub-capability (`OfferCreator` → `create_offer`). `connectionId` is a validated argument (stable tool names, bounded list); `notifications/tools/list_changed` on change — so an agent sees only capabilities some connection actually supports and has enabled.
4. **Every write/config tool is admin-scoped and audit-logged.** v1 human-in-the-loop relies on the MCP client's tool-approval UX + the coarse consent implied when the operator minted + installed an admin-scoped MCP token; per-action server-enforced confirmation is a deliberately deferred hardening for the demand-gated Phase 3 write surface (not silently assumed — a named residual risk in the plan).
5. **A net-new client↔server auth layer is required — OL is an OAuth 2.1 Resource Server that validates OpenLinker-issued Personal Access Tokens.** OL has JWT-bearer + `RolesGuard` only today (`apps/api/src/auth/`, no token issuance to third parties; it is an OAuth *client* to Allegro, never an OAuth server). MCP authorization is **optional** (the OAuth profile is a conditional `SHOULD`, not a `MUST`), so Phase 0 does **not** stand up an Authorization Server: the operator generates a scoped, revocable **MCP token** (GitHub-PAT style) and pastes it into their MCP client, and OL validates it as a Resource Server — matching how GitHub / Atlassian / Sentry ship. An OAuth 2.1 AS (embedded or external IdP) is a **deferred, optional upgrade** behind the same RS seam. This is Phase 0 and gates every later phase. **See [ADR-034](./034-mcp-authorization-user-issued-pats.md) for the full decision, alternatives, and rationale.** The MCP token's `sub` maps to an existing OL user and **inherits that user's flat RBAC role** (admin/operator/viewer). OL is **single-tenant per deployment** — `connections` has no owner/tenant column and any authenticated user already sees every connection — so there is no per-user "allowed connections" concept to reuse; per-connection `enabledCapabilities` continues to gate *capabilities* (not *which connections* a principal may touch). Restricting an agent token to a subset of connections is net-new scope, deferred to a **Phase 3 (write) prerequisite** — the higher-blast-radius surface — not a Phase 0/1 concern.

**Wiring**: a NestJS feature module `apps/api/src/mcp/` inside the existing API app (reuses the running HTTP server, global guards, `@Public()`/`VERSION_NEUTRAL` primitives, and the composed plugin/DB/Redis DI graph) — not a standalone third app. Phase the surface as read-only domain tools (P1) → mapping assistant (P2, highest ROI, no secrets) → secure setup (P3), treating P1–P2 as a low-regret spike and gating write-heavy work behind demand evidence.

## Alternatives considered

- **Do nothing.** Rejected: forgoes a credible, closing early-mover window when the architecture fit is unusually low-cost. Reversible later, but the differentiation is time-boxed.
- **MCP-client only** (OL consumes external MCP servers). Rejected: solves a different problem (enriching OL's own automation), doesn't deliver the "agents drive OL" adoption/differentiation thesis. Not mutually exclusive — can follow later.
- **Full read-write tool surface now, on the current SDK.** Rejected: maximizes blast radius (multi-tenant writes) exactly when the protocol and its security guidance are most in flux, and before any demand signal. The phased, demand-gated rollout dominates.
- **Standalone third app** (mirror `apps/worker/`). Rejected for v1: forces a duplicated package, a third hand-synced plugin list, and a fresh HTTP bootstrap for no benefit while MCP shares the API's auth, plugins, and domain services. Revisit only if MCP must scale/deploy independently.

## Consequences

**Pros:**
- Tools inherit per-connection capability gating + encrypted credential isolation for free from the existing seam.
- Spec-native secret handling maps directly onto OL's existing OAuth flow; only one net-new key-entry page.
- Phased, in-API rollout keeps blast radius and effort low; P1/P2 are independently valuable.

**Cons / trade-offs:**
- The auth layer (Phase 0) is security-critical but small — an OAuth 2.1 **Resource Server** validating OL-issued Personal Access Tokens ([ADR-034](./034-mcp-authorization-user-issued-pats.md)); the trade-off is a long-lived bearer token (OWASP MCP01), mitigated by PAT hardening + admin-scope + audit, with the short-lived-token OAuth upgrade deferred.
- New dependency (`@modelcontextprotocol/sdk`) tied to a protocol in active revision; churn risk mitigated by the SDK-timing constraint and the lifecycle policy.
- Multi-tenant write exposure demands sustained HITL + audit discipline; demand remains unproven.

**Migration path:** none for existing behavior — purely additive. The MCP module is opt-in and inert until Phase 0 auth ships.

## References

- Related issues: #1350 (this EPIC), #1036 / [ADR-023](./023-cross-platform-category-and-attribute-projection.md) (neutral mapping shapes)
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (capability ports + `is{X}` guards), [ADR-006](./006-credentials-encryption-at-rest.md) (credential encryption), [ADR-013](./013-neutral-oauth-completion-port.md) (neutral OAuth-completion port), [ADR-034](./034-mcp-authorization-user-issued-pats.md) (the MCP auth layer — user-issued PATs, RS)
- Implementation plan: [docs/plans/implementation-plan-mcp-server.md](../../plans/implementation-plan-mcp-server.md)
- Primary doc section: [docs/architecture-overview.md § Capability Abstractions](../../architecture-overview.md#capability-abstractions-business-roles)
