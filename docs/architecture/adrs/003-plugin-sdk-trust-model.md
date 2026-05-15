# ADR-003: Plugin SDK trust model

- **Status**: Accepted
- **Date**: 2026-04-30
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made across PRs #570, #572, #593)

## Context

OpenLinker is open-sourcing with a long-term goal of community-contributed marketplace plugins (Shopify, WooCommerce, BigCommerce, eBay, …). Plugins run inside the host process — they implement core's capability ports and execute against connection credentials. This raises a "what can a plugin do?" question that needs an explicit policy before third-party plugins exist in the wild.

The options range from "fully trusted in-process code" (current) to "sandboxed via process isolation / WASM" (heavy). The choice depends on whether plugins are trusted code (curated, signed) or untrusted code (community-uploaded, vetted only by PR review).

## Decision

For the initial OSS phase, **plugins are trusted in-tree code** with the same code-review and signing requirements as core. The plugin SDK (`@openlinker/plugin-sdk`) defines a framework-neutral `AdapterPlugin` contract; in-tree plugins (Allegro, PrestaShop, AI) live under `libs/integrations/<name>/` and ship in the same monorepo. There is no runtime sandbox, no capability allow-list enforced at the JS-engine level, and no process isolation.

What the plugin SDK *does* provide:
- A static manifest (`adapterKey`, `platformType`, `supportedCapabilities`, `version`) so the host can validate "this plugin claims to provide X" against the runtime adapter.
- A curated `HostServices` bag (logger, identifier mapping, credentials resolver, optional cache, typed registries) — plugins receive only this, not the full host context.
- A `dispatchCapability<T>` helper that surfaces structural capability mismatches as readable errors.

Third-party community plugins are deferred. When that pressure arrives, the SDK gives us a starting point — but the *trust* policy will need its own ADR.

## Alternatives considered

- **Sandbox plugins from day one (separate process or WASM)** — Rejected: huge implementation cost, breaks the "plugin = TypeScript file you can read" mental model, and would force every host service call across a boundary. Premature given the current "trusted in-tree" reality.
- **Capability-scoped at the type level only (no `HostServices` contract)** — Rejected: plugins would import directly from `@openlinker/core/*`, coupling to host internals. The `HostServices` bag is the seam that lets the host evolve internals without breaking plugins.
- **Plugin author signs a CLA + we accept the trust model implicitly** — Rejected: trust-by-process-policy doesn't compose with future security boundaries. Explicit SDK shape preserves the option to add isolation later without rewriting every plugin.

## Consequences

**Pros:**
- Authoring a plugin is "TypeScript that implements an interface" — low cognitive overhead.
- `HostServices` is the only surface plugins depend on, so host internals can evolve.
- Manifest enables future tooling (compatibility checks, capability dashboards) without instantiating the plugin.

**Cons / trade-offs:**
- Plugin code runs with full host trust today. A malicious plugin can do anything the host process can.
- "Trusted in-tree" doesn't scale to community-contributed plugins; that's a future-ADR decision, not this one.
- Plugin authors who try to sidestep `HostServices` and reach into core internals will be caught only by code review, not by the type system.

## References

- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § Plugin Manager / Integrations.
- Plugin author guide: [docs/plugin-author-guide.md](../../plugin-author-guide.md).
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (the capability contract plugins implement).
- Related PRs: #570/#571 (adapter registry), #572 (plugin registry composition), #593 (`@openlinker/plugin-sdk` package).
