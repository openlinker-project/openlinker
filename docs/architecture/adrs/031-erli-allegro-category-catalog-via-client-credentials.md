# ADR-031: Erli category/parameter browsing via an Erli-owned Allegro client-credentials token

- **Status**: Proposed
- **Date**: 2026-07-07
- **Authors**: @norbert-kulus-blockydevs

## Context

Erli borrows Allegro's category/attribute taxonomy verbatim (ADR-023 §40/§83, ADR-025, #1045): `ErliOfferManagerAdapter` declares `TaxonomyBorrower.getBorrowedTaxonomy() → 'allegro'` but implements neither `CategoryBrowser` nor `CategoryParametersReader`. Today this means the Erli single-offer wizard has no source of category/parameter *definitions* to render — the operator types a raw Allegro category ID into a plain text field, and required parameters (e.g. "Stan"/condition) can silently go unset because the borrows-provenance branch of `AttributeProjectionService.project()` only passes through pre-configured `AttributeMapping` rows; it never fetches a schema.

Allegro's `/sale/categories` and `/sale/categories/{id}/parameters` endpoints are documented as public catalog data, reachable via a `bearer-token-for-application` obtained through `grant_type=client_credentials` (Basic auth `client_id:client_secret`, no seller/user context). Today, however, every Allegro API call in this codebase (`AllegroAdapterFactory`, `AllegroTokenRefreshService`, `AllegroConnectionTokenState`) is wired exclusively around a per-seller OAuth token obtained via authorization-code + `refresh_token` grant, tied to a `Connection` row of `platformType: 'allegro'`. Requiring every Erli-only operator (who may never sell on Allegro at all) to create and maintain a full Allegro seller connection just to browse a public category tree is an unnecessary and confusing operational burden.

Plugin packages in this codebase (`libs/integrations/<platform>`) are architecturally independent — each self-registers against the host via `AdapterPlugin`/`HostServices` and never imports another plugin's package. Introducing a hard dependency from `@openlinker/integrations-erli` on `@openlinker/integrations-allegro` for this feature would be the first cross-plugin package dependency in the codebase and would make Erli unusable standalone (a contributor shipping only the Erli plugin would fail to build).

## Decision

Erli owns its own small Allegro client-credentials HTTP client (`AllegroCategoryCatalogClient`, `libs/integrations/erli/src/infrastructure/http/`). An Erli connection optionally stores an Allegro app's `allegroClientId` + `allegroClientSecret` in its own `credentialsRef` payload (alongside the existing `apiKey`). `ErliAdapterFactory.createAdapters` resolves these; when both are present and non-empty, it constructs the per-connection `ErliOfferManagerAdapter` with the catalog client wired in, which causes the adapter *instance* (not the class) to expose working `fetchCategories`/`fetchCategoryParameters` methods — otherwise those methods are absent from the instance. `isCategoryBrowser`/`isCategoryParametersReader` are structural (`typeof adapter.fetchCategories === 'function'`) so this correctly and dynamically reflects per-connection configuration state through the *existing* generic capability-resolution path (`IIntegrationsService.getCapabilityAdapter`, `CategoriesCacheService.getAllegroCategories`, `GET /listings/connections/:connectionId/categories/:categoryId/parameters`) — **no new HTTP endpoints** for the actual category/parameter reads.

**Correction (found during #1383 implementation)**: the connection-list DTO's `supportedCapabilities` field is populated from the static, per-`adapterKey` `AdapterMetadata.supportedCapabilities` declared at plugin registration — it is **not** computed by resolving each connection's live adapter instance and running the `is*` guards. It therefore cannot differ between two Erli connections regardless of whether either has Allegro app credentials configured, and the bulk-wizard's `connection.supportedCapabilities.includes('CategoryBrowser')` gate (#1367) is consequently **unaffected** by this feature (it stays `false` for Erli either way — a pre-existing bulk-wizard limitation, unchanged, and out of scope here per the plan's non-goals). The frontend single-offer wizard therefore needs its own, per-connection-instance-visible signal: a new non-secret `ErliConnectionConfig.allegroCategoryAccessEnabled?: boolean` field, written/cleared by the backend in the same operation that writes/clears `allegroClientId`/`allegroClientSecret`, and read directly by the FE from the connection's `config` (already returned verbatim by the generic connection-read endpoints — no DTO changes needed). This keeps the mechanism entirely inside Erli's own plugin-local config shape; it does not touch the generic capability system.

## Alternatives considered

- **Require a real Allegro seller `Connection`, resolve its taxonomy from there**: rejected — forces Erli-only operators to create and maintain an unrelated Allegro seller account/connection just to browse a public catalog; also reintroduces the "which of N Allegro connections is the owner" ambiguity noted in `category-mapping.repository.ts`'s existing "Ambiguous borrowed-taxonomy category mapping" log.
- **Cross-plugin package dependency** (`@openlinker/integrations-erli` imports `@openlinker/integrations-allegro`'s HTTP client): rejected — breaks plugin independence (ADR-003 trust model), the first such dependency in the codebase, and makes Erli non-standalone.
- **A single OpenLinker-wide, non-tenant-scoped Allegro app credential** (mirroring the AI-provider `ai-provider:{provider}` global-ref pattern in `integration_credentials`): rejected for v1 — different tenants/operators may reasonably want their own Allegro app registration (rate limits are per-app), and a global key raises multi-tenant blast-radius and key-rotation-ownership questions out of scope for this feature. Left as a future evolution if a hosted-SaaS deployment model needs it.
- **Always implement `CategoryBrowser`/`CategoryParametersReader` on the `ErliOfferManagerAdapter` class (static, always present) and throw a domain exception when unconfigured**: rejected as the sole mechanism — it would make `isCategoryBrowser` return `true` for *every* Erli connection regardless of configuration, silently reintroducing the exact regression #1367 fixed for Allegro (bulk wizard would show a parameter step, including a required "Stan" field, for unconfigured Erli connections with no way to fill it).

## Consequences

**Pros:**
- No new HTTP endpoints for actual category/parameter reads; the existing generic capability-resolution machinery (`CategoriesCacheService`, `listings.controller.ts`) works unchanged for an Erli `connectionId`.
- The FE gating signal (`allegroCategoryAccessEnabled` in `config`) is a one-field, plugin-local addition — no changes to the generic capability system or connection DTOs.
- No cross-plugin package coupling; Erli remains independently shippable.
- Operators never touching Allegro directly can still get full category/parameter UX on Erli.

**Cons / trade-offs:**
- Small, self-contained duplication of OAuth `client_credentials` + category-fetch logic between the Allegro and Erli packages (~100-150 lines) rather than one shared implementation.
- Per-connection Allegro app credentials mean each operator manages their own Allegro Developer Portal app registration (extra setup step, mitigated by the optional/recommended framing in the connection wizard).
- Category/parameter data is genuinely seller-independent, so a future multi-tenant SaaS deployment may still want the shared-credential alternative — deferred, not precluded, by this design.

**Migration path (if applicable):**
- Purely additive: existing Erli connections without `allegroClientId`/`allegroClientSecret` keep today's plain-text category-ID behavior unchanged.

## References

- Related ADRs: [ADR-023](./023-cross-platform-category-and-attribute-projection.md), [ADR-025](./025-erli-marketplace-adapter.md), [ADR-003](./003-plugin-sdk-trust-model.md)
- Primary doc section: [docs/architecture-overview.md § Listings (Offers)](../../architecture-overview.md)
