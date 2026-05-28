# ADR-013: Neutral OAuth-completion port — relocate Allegro OAuth into the plugin

- **Status**: Accepted
- **Date**: 2026-05-28
- **Authors**: @pjswierzy

## Context

The host (`apps/api`) owned the entire Allegro OAuth surface in `AllegroOAuthService` (~700 lines): environment→base-URL mapping, the `/auth/oauth/authorize` URL, the `POST /auth/oauth/token` exchange (with the Allegro-shaped token response), and — after #820 — the `/me` seller-identity check via a host-injected `AllegroAccountReader`. The host therefore value-imported `@openlinker/integrations-allegro` and hard-coded Allegro API knowledge, violating the modularity model (#546): platform specifics belong behind a neutral host-facing registry, exactly as webhook provisioning (#583, [ADR not needed]) and config/credentials shape validation (#586/#587) already are. #859 tracked closing this last host→plugin coupling. The OAuth *runtime* refresh was already plugin-owned (`AllegroTokenRefreshService`); only the *completion* flow was misplaced.

## Decision

Introduce a neutral **`OAuthCompletionPort`** in CORE with three methods — `buildAuthorizationUrl` (pure, sync), `exchangeCode` (returns an opaque normalized credential blob), and `fetchAccountIdentity` (returns a neutral `{ accountId, label? }` or throws) — resolved per-connection by `adapterKey` through a new **`OAuthCompletionRegistryService`** (the 11th `HostServices` registry). Allegro implements it in `AllegroOAuthCompletionAdapter` and self-registers in `register(host)`. The host's `AllegroOAuthService` is replaced by a neutral **`OAuthConnectionService`** that owns everything platform-agnostic — Redis state/CSRF, idempotent-replay markers, credential + connection persistence, and the same-account re-auth guard (#820), now keyed on a neutral `config.oauthAccountId` (with a `config.sellerId` read-fallback for #820-era connections). The Allegro-named `AllegroController` and its routes are unchanged.

## Alternatives considered

- **Combined `exchangeCode` returning identity in one call**: fewer round-trips, but conflates "get credentials" with "verify identity", hides the optional-identity case, and doesn't match #820's standalone reader. Rejected for a protocol-honest 3-method split.
- **First-class `connections.external_account_id` column** (instead of `config.oauthAccountId`): cleaner queryability, but a disproportionate `Connection`-aggregate + migration churn for one OAuth platform. Deferred; the jsonb key needs no migration and the non-whitelisting Allegro config validator tolerates it.
- **Extend an existing registry** (e.g. connection-tester): semantically wrong — OAuth completion is its own capability with its own lifecycle. Rejected.

## Consequences

**Pros:**
- The host imports no Allegro OAuth knowledge; a future OAuth platform ships a port impl + one `register(host)` line, no host PR.
- The registry seam makes the neutral flow unit-testable against a fake `OAuthCompletionPort` (a net testing gain).
- Behaviour preserved: callback ordering, #819 re-auth, #820 guard-before-rotation, and the token-exchange 400-vs-500 split (via a neutral `OAuthCodeExchangeException`).

**Cons / trade-offs:**
- `OAuthConnectionService.validateConnection` retains Allegro-aware config checks (env-value validation), the one residual coupling — left verbatim per scope (overlaps #587; tracked for relocation behind the plugin's config-shape validator).
- The Allegro-named controller hosting a neutral service is transitional; a generic `/integrations/:platform/oauth/*` route is the next thing this seam unlocks (deferred).

**Migration path:**
- No DB migration. New connections persist `config.oauthAccountId`; #820-era `config.sellerId` connections are read via fallback and backfilled on next re-auth. New credential refs use `oauth_{adapterKey}_…`; existing `db:`-prefixed refs are unaffected (resolution is by exact ref).

## References

- Related PRs: #859 (this change)
- Related issues: #859, #546 (modularity epic), #820 (same-account guard), #819 (re-auth in place)
- Related ADRs: [ADR-003](./003-plugin-sdk-trust-model.md), [ADR-008](./008-auth-failure-classifier-connection-reauth.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Plugin Manager / Integrations

## Updates

- **2026-05-28 (#864):** the deferred Allegro-coupling in `OAuthConnectionService.validateConnection` (first Cons line above) was resolved by dropping the redundant `GET /integrations/allegro/connections/:id/validate` endpoint and its backing service method. The host now value-imports zero plugin packages. The decision recorded in this ADR is unchanged; this is a pointer to the trade-off's closure.
