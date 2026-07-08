# ADR-030: Demo-only, vendor-neutral analytics/integration config seam on `/system/config`

- **Status**: Proposed
- **Date**: 2026-07-08
- **Authors**: @norbert-kulus-blockydevs

## Context

OpenLinker wants session recording / product analytics (PostHog) on the public demo instance only, to observe how visitors explore the product, without shipping telemetry into normal self-hosted installs. A sibling issue (support-chat widget) needs the same demo-only gating mechanism shortly after.

Two constraints rule out the naive approach:

1. **OSS optics.** Bundling `posthog-js` as an unconditional dependency in the public tree reads as "phone-home" to self-hosters, even if gated at runtime, and is dead weight in the bundle they'll never use.
2. **One-image deploy model** (ADR-029 Axis 4: the same built image serves prod and demo, distinguished only by a runtime flag). A build-time `VITE_POSTHOG_KEY` cannot differ per environment from a single image — the analytics config must be resolved at **runtime**, not baked in at build time.

`SystemService` / `GET /system/config` (#1127, PR #1264) already established the precedent: a server-authoritative, runtime-fetched config surface gated on `OL_DEMO_MODE`, consumed once by the FE via `useSystemConfigQuery` (`staleTime: Infinity`).

## Decision

Extend the existing `/system/config` seam with an optional, **per-provider-namespaced** `demoIntegrations` block (e.g. `demoIntegrations.posthog = { key, host }`), populated by `SystemService` only when demo mode is active and the corresponding env vars are set. The frontend loads the vendor SDK via a **dynamic `import()`** gated on that config, so the SDK is never fetched — and its code never runs — on a normal install. Each future demo-only third-party integration (support-chat, etc.) adds its own namespaced sub-key (`demoIntegrations.<provider>`) to the same DTO, rather than inventing a parallel mechanism.

## Alternatives considered

- **Flat fields per vendor** (`demoIntegrations.posthogKey`, `demoIntegrations.posthogHost`): simpler DTO shape, but not actually vendor-neutral — every new demo integration bolts more flat, prefixed fields onto the same object, and the "vendor-neutral seam" framing from the originating issue becomes cosmetic rather than structural. Rejected in favor of namespacing per provider.
- **Private overlay/fork carrying the demo-only code**: contradicts the #1127 "configured as a demo, not a fork" principle, and duplicates the deploy pipeline for a single flag's worth of behavior. Rejected.
- **Build-time `VITE_POSTHOG_KEY`**: incompatible with the one-image deploy model — the same built artifact must serve both prod and demo. Rejected.

## Consequences

**Pros:**
- One consistent, server-authoritative pattern for every current and future demo-only third-party integration.
- Self-hosters' `/system/config` response and bundle are provably unaffected — nothing to audit per new provider.
- Adding a second provider (support-chat) is an additive DTO change, not a reshape.

**Cons / trade-offs:**
- Slightly more DTO ceremony than a flat shape for the first provider (a nested `PosthogDemoIntegrationDto` instead of two scalar fields).
- The `demoIntegrations` object can grow into a small provider registry over time; if that growth becomes unwieldy, a follow-up ADR should revisit whether a generic key-value config bag is preferable to one field per provider.

**Migration path:**
- N/A — this is new surface area; no existing consumers of `/system/config` depend on its absence.

## References

- Related issues: #1301 (this ADR), #1127 (originating `/system/config` seam)
- Related PRs: #1264
- Primary doc section: [docs/architecture-overview.md § Sync Manager / System](../../architecture-overview.md)
