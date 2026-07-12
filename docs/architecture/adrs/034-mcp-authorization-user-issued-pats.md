# ADR-034: MCP authorization — user-issued Personal Access Tokens (Resource Server); OAuth Authorization Server deferred

- **Status**: Proposed
- **Date**: 2026-07-12
- **Authors**: @piotrswierzy

## Context

[ADR-033](./033-openlinker-as-mcp-server.md) committed OL to expose an MCP server and named the net-new client↔server auth layer as the gating Phase 0. Two rounds of investigation refined it:

1. **First pass** established that the MCP spec makes the server an OAuth 2.1 **Resource Server** and puts the Authorization Server out of scope, and that the official TS SDK v2 removed its AS helpers (RS-only). That pointed at "RS + a pluggable/embedded AS (`node-oidc-provider`)."
2. **Second pass** (this ADR) asked whether OL needs an AS *at all*, and found it does not for v1. **MCP authorization is OPTIONAL** — the OAuth profile is a conditional `SHOULD`, not a `MUST`. A **user-issued Personal Access Token (PAT)** that OL validates as a Resource Server is spec-permissible (undocumented, not banned), and is exactly what real production remote MCP servers already ship: **GitHub** (`Bearer` PAT — the self-hosted server's *primary* method), **Atlassian Rovo** (API token, *mandatory* for Jira Service Management + Bitbucket), **Sentry** (`Sentry-Bearer`). The one OAuth-only counter-example, **Notion**, is OAuth-only *because it is a multi-tenant SaaS* needing per-user delegated consent — a driver a **single-tenant, self-hosted** OL does not share: the operator mints a token for an agent they run themselves.

## Decision

OL's MCP auth layer is an **OAuth 2.1 Resource Server that validates OpenLinker-issued Personal Access Tokens** — **no Authorization Server in v1**:

- The operator **generates an MCP token** from a settings/API surface (GitHub-PAT style), scoped and revocable, and pastes it into their MCP client's config (`Authorization: Bearer …`).
- OL **validates the token on every MCP request** (a bearer guard over the existing user/credential machinery). RFC 9728 Protected Resource Metadata, DCR, and authorize+consent are **not required** — those exist to route a client to an external AS, and OL issues + validates its own tokens. (OL still returns a minimal `WWW-Authenticate: Bearer` on 401, per RFC 6750, so a client can discover that auth is needed rather than see a bare 401.)
- **Scope floor:** at minimum a **read-only vs read-write** scope, so a leaked read-only token can't drive writes; finer per-capability / per-connection scoping is deferred (the Phase 3 per-token connection allow-list is one such refinement).
- **PAT hardening is mandatory:** hash-at-rest, one-time reveal, expiry, per-token revocation, audience binding, rotation.
- **Single-tenant assumption:** this design assumes **one organisation per deployment** (the operator mints a token for an agent they run). A future multi-tenant / multi-user model would reopen the decision — that is when the deferred OAuth AS (per-user delegated consent) earns its keep.
- **The OAuth 2.1 Authorization Server (embedded `node-oidc-provider` or an external IdP) is deferred, not rejected.** A future OAuth token and today's PAT are validated by the **same Resource-Server seam**, so adding OAuth later is *additive*. It buys per-action consent, inherently short-lived tokens, and delegation to distinct client apps — an **optional upgrade gated on demand** (e.g. an enterprise operator wanting short-lived tokens, or a future multi-user model).

## Alternatives considered

- **Embedded / pluggable OAuth 2.1 AS now (`node-oidc-provider`)** — the prior framing. **Deferred, not chosen:** heaviest option (account/consent/persistence integration with OL's existing login), the spec doesn't require an AS, and the PAT model already matches shipping prior art. Retained as the documented upgrade path.
- **Standalone IdP sidecar (Keycloak / Ory Hydra / Zitadel / Logto).** Rejected for v1: a second container + its own user store every self-hoster inherits, to solve a problem (delegated third-party consent) single-tenant OL doesn't have.
- **Require an external IdP for every deployment.** Rejected: unrealistic operator burden for self-hosted OSS. Available via the same RS seam for operators who want it.
- **No auth / local-stdio only.** Rejected: OL is a remote HTTP server over a write-capable commerce backend; unauthenticated is a non-starter.

## Consequences

**Pros:**
- Radically smaller Phase 0 — a token-mint surface + a bearer guard, reusing OL's existing hashed-token precedent; no AS, DCR, consent screen, or `node-oidc-provider`.
- Matches shipping prior art (GitHub / Atlassian / Sentry) and fits the single-tenant operator model exactly.
- The RS seam is shared, so OAuth is a clean later addition — nothing thrown away.

**Cons / trade-offs:**
- A long-lived bearer PAT is **OWASP MCP01 (Token Mismanagement)** — the #1 MCP risk. The **concrete exposure**: the operator pastes the token into a third-party client's config (e.g. Claude Desktop's `claude_desktop_config.json`), which typically sits **in plaintext on disk** — exactly OWASP MCP01's "tokens hard-coded in client configs." Mitigated (not eliminated) by the scope floor + hardening above + audit + HITL-on-writes + the single-tenant/operator-controlled context (the operator authorises their *own* agent). It cannot fully satisfy the spec's "short-lived token" guidance — that is what the deferred OAuth upgrade is for.
- Gives up per-action consent, inherently short-lived tokens, and per-client delegation vs OAuth.
- **Client compatibility is the load-bearing risk** — see Open questions.

**Migration path:** none — additive, inert until Phase 0 ships. Adding OAuth later reuses the RS seam.

## Open questions

- **Client compatibility (validate before Phase 0 code).** Do OL's target MCP clients (Claude Desktop, Claude.ai web, ChatGPT, Cursor…) accept a manual `Authorization` header for a *remote* Streamable-HTTP server? Confirmed at the server/vendor/framework level (GitHub/Atlassian/Sentry/FastMCP), **not** exhaustively per GUI client. A ~1-hour stub test against the actual target client settles it; a client that refuses manual headers forces the OAuth upgrade sooner.
- **Token format:** opaque random string (hash-compared, GitHub-style — trivial revocation, one DB hit per call) vs signed JWT (self-validating claims incl. audience, no DB hit, but harder to revoke). Opaque is the leaning default (revocation matters more than a DB hit for a single-tenant admin surface); decide in Phase 0.
- **Token store:** extend the existing `refresh_tokens` hashing precedent, or a dedicated `mcp_tokens` table? (Distinct audience + scopes argue for a dedicated store.)

## References

- Refines/replaces the auth framing in [ADR-033](./033-openlinker-as-mcp-server.md) Decision #5 (which points here). **ADR-033 itself is not superseded** — it remains the umbrella "expose OL as an MCP server" decision; only its one-line auth framing is replaced here.
- MCP Authorization spec — 2025-06-18 (authorization is OPTIONAL; OAuth is a conditional `SHOULD`) + 2026-07-28 RC (`modelcontextprotocol.io`).
- Prior art: GitHub, Atlassian Rovo, and Sentry MCP servers (config-pasted PAT); FastMCP static-bearer client auth.
- OWASP MCP Top 10 — MCP01 Token Mismanagement (long-lived-token risk + mitigations); RFC 6750 (Bearer), RFC 8707 (resource/audience).
- Deep-research verification passes: 2026-07-11 (spec/SDK, 23/25 confirmed) and 2026-07-12 (PAT viability, 24/25 confirmed) via 3-vote adversarial verification.
- Related issues: #1486 (Phase 0), #1350 (EPIC).
- Implementation plan: [docs/plans/implementation-plan-mcp-server.md](../../plans/implementation-plan-mcp-server.md)
