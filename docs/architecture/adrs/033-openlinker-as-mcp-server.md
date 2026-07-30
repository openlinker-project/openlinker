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

## Phase 1 amendments (#1487)

Two decisions made while implementing the read-only tool surface, both refining
(not reversing) the decision above.

### Tools are capability-*gated* but OL-store-*backed*

The tool surface stays dynamic and capability-declared as decided above: a tool
is registered iff at least one connection supports and enables its capability.
But the tools **read OpenLinker's own store** (`IProductsService`,
`IInventoryQueryService`, `IOrderRecordService`) rather than calling the
capability port's adapter.

Reaching through `ProductMasterPort` / `InventoryMasterPort` / `OrderSourcePort`
was the obvious first reading of "expose these capabilities as tools", and it is
wrong on four counts:

1. **It makes `OL_STORE_PII` compliance a duplicated policy with an unsafe
   default.** Stated precisely, because the stronger claim is tempting and
   wrong: `OL_STORE_PII` governs *persistence*, so a port-path tool that fetched
   fresh and projected PII away would not literally violate it — nothing is
   stored. What the port path actually costs is worse in practice:
   `IOrderRecordService.persistOrder` already nulls buyer PII at ingestion when
   the operator disables PII storage, whereas `OrderSourcePort.getOrder`
   re-fetches it raw regardless. So (a) the plan's proposed option "honour
   `OL_STORE_PII` as a floor" is **incoherent** on that path — there is no
   stored floor to honour; you would have to *reimplement* `persistOrder`'s
   nulling rule inside the tool, leaving the same privacy policy expressed in
   two places and free to drift — and (b) the **default** behaviour forwards to
   an external LLM vendor exactly what the operator opted out of storing.
   Compliance becomes something a future contributor must remember rather than
   something the read inherits.
2. **It spends the operator's marketplace API quota** — one live platform call
   per tool invocation, on an autonomous agent's behalf. The per-token limiter
   caps OL calls; it cannot cap downstream cost, which is the scarcer resource.
3. **It breaks identifier consistency.** `OrderSourcePort` is an *ingestion*
   port returning external-id-keyed data, which will not join against the
   internal-id-keyed product tools.
4. **It bypasses the variant-keyed inventory model** ([ADR-010](./010-variant-keyed-master-inventory.md)).

Consequence: the gate and the data are now **independent facts** — a passing gate
does not imply data exists, and a disabled connection hides tools whose data OL
still holds. Each tool's description states this, because an agent cannot
otherwise distinguish "no data" from "not configured". A future explicit
`refresh_*` tool can go to the platform *deliberately*, rather than every read
doing so implicitly.

Note this **changes what the gate means**, even though the mechanism is
unchanged. Previously it would have proved the adapter could serve the read; now
it is a proxy for "is this deployment in the products / inventory / orders
business at all". `get_availability` is the clearest case: it is gated on
`InventoryMaster` but takes no `connectionId` and reads globally, so the gate and
the answer are fully decoupled for that tool. That is accepted — the gate's job
is tool-surface minimalism, not data provenance — but Phases 2/3 inherit this
meaning and should not read the gate as a data guarantee.

**How empty is the store in practice?** Narrower than the decoupling suggests.
`SchedulerService` registers `master-product-sync` (`master.product.syncAll`,
default cron `*/20 * * * *`, capability-gated on `ProductMaster`) and
`master-inventory-sync` (`*/15`), and `ConnectionService.enqueueInitialCatalogSync`
enqueues a bootstrap `syncAll` on connection creation precisely so a new
connection populates immediately. The "gate passes but the store is empty" window
is therefore minutes after connection creation, not indefinite.

### `notifications/tools/list_changed` is not implemented

The Phase-1 issue asked that adding/removing a connection republish the tool list
via `notifications/tools/list_changed`. It is **not implementable** under this
ADR's transport choice: `createMcpHandler` builds a fresh `McpServer` per HTTP
request (the stateless, multi-replica-safe model decided above), so there is no
long-lived session to push a notification over. OL therefore does not advertise
`tools.listChanged` and never calls `sendToolListChanged()`.

**This has a real cost, and an earlier draft of this section understated it.**
That draft claimed the notification was also *unnecessary* because "`tools/list`
is recomputed every call, so it cannot go stale". The first half is true and the
conclusion does not follow. The **server** cannot go stale; a **client's cached
tool list** absolutely can, and that is the notification's entire purpose — a
message whose only content is "the list changed" is meaningless unless the
recipient holds a copy. Both halves of the mechanism are live in the SDK
(`sendToolListChanged()` is present and, unlike `sendLoggingMessage`, is **not**
deprecated in this revision), and a sessionful transport exists
(`WebStandardStreamableHTTPServerTransport`; `sessionId` threads through the
API) — so statelessness is our deliberate choice, not a constraint the SDK
imposes.

The accepted consequence: an operator who enables a `ProductMaster` connection
while an agent is already connected will **not** see `search_catalog` appear
until that client reconnects or re-lists. The mitigation is reconnect. This is
accepted rather than solved because gaining the notification means adopting
sessions — reversing the multi-replica-safety property this ADR chose — for one
convenience on a surface whose demand is still unproven. Revisit together with
the sessionful-transport question if real usage makes the gap painful.

## References

- Related issues: #1350 (this EPIC), #1036 / [ADR-023](./023-cross-platform-category-and-attribute-projection.md) (neutral mapping shapes)
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (capability ports + `is{X}` guards), [ADR-006](./006-credentials-encryption-at-rest.md) (credential encryption), [ADR-013](./013-neutral-oauth-completion-port.md) (neutral OAuth-completion port), [ADR-034](./034-mcp-authorization-user-issued-pats.md) (the MCP auth layer — user-issued PATs, RS)
- Implementation plan: [docs/plans/implementation-plan-mcp-server.md](../../plans/implementation-plan-mcp-server.md)
- Primary doc section: [docs/architecture-overview.md § Capability Abstractions](../../architecture-overview.md#capability-abstractions-business-roles)
