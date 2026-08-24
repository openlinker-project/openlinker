# ADR-055: OL's OMS ships as a credential-less connection-backed plugin

- **Status**: Proposed
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

OL's own OMS must be a plugin behind the same ports a third-party OMS uses — no privileged path in
core. But `getCapabilityAdapter(connectionId, capability)` is the codebase's only resolution path
and is per-connection; anything not reachable through it forces a second resolution branch at every
call site. Two packaging precedents exist: the fx registry module ("not a plugin" — no connection
axis) and full `AdapterPlugin`s (Allegro, with plugin-shipped migrations; Erli, taking core
services via factory deps rather than `HostServices`).

## Decision

`@openlinker/oms` is a **full `AdapterPlugin` with a real, credential-less
`Connection` row** — `platformType: 'openlinker'`, `credentialsRef: ''` (R1: the shipped
**Subiekt precedent**, resolved only `if (credentialsRef)` — `null` would need a nullable-column
migration, a domain-type change and four guard rewrites, including an unguarded
`.startsWith('db:')` on every list render), plus an advertised
`AdapterMetadata.requiresCredentials?: boolean` relaxing the create guard capability-wise rather
than via a privileged platformType check; no HTTP — one row per **location-set** (default one). The row is **created when an operator enables the OMS, never
seeded by migration**. Persistence: plugin-shipped TypeORM migrations, `oms_`-prefixed tables;
**core owns what crosses the port** (`FulfillmentWork`, the reservation ledger, `order_holds`,
returns), the plugin owns only its private working state. `JobTypeValues` stays a closed union: the
OMS job vocabulary is **core-owned and generic** (`fulfillment.work.route`, `.dispatch`,
`.statusSync`, `fulfillment.availability.recompute`, `returns.disposition.sync`), identical for the
plugin and any vendor adapter. Core services reach the plugin via factory deps
(`createOmsPlugin({inventoryQuery, orderRecords, products, shipping, mappingConfig})` — all
`I*Service`); `HostServices` is not widened.

## Alternatives considered

- **fx-shaped registry module, no `Connection`**: `getCapabilityAdapter` cannot resolve it; every
  call site grows a second branch; the OMS loses config/status/enablement/FE for free. An OMS,
  unlike a published FX rate, emphatically has a connection axis.
- **The synthetic SYSTEM connection id**: has no row, no config, no status, and is not enumerable
  by `listCapabilityAdapters`, which the authority selection functions depend on.
- **Seeding the row in a migration**: a zero-config regression — the row enters every existing
  install's candidate sets and flips single-candidate selections to `ambiguous`, silently stopping
  working behaviour. The highest-risk mechanical detail in the design.
- **Plugin-invented job types**: "actions yes, states no" one layer down; a closed union can be
  opened later, never closed. A vendor needing an inexpressible job type is evidence the contract
  is missing an operation — fixed by core PR.

## Consequences

**Pros:**
- Enablement gating, config jsonb, status, FE, job scoping, and identifier-mapping namespacing all
  come free with the row; the capability seam is provably neutral (two implementers by design).

**Forward-compat rules for out-of-tree adapters (R1):** new port-input fields are optional and
ignorable; union growth requires `default:` arms across the port boundary (never
`never`-exhaustive there); sub-capability guards narrow by runtime method probe (the ADR-046
resolver precedent).

**Repo posture (R2): monorepo package, publishable-but-not-published.** Named
**`@openlinker/oms` at `libs/oms/`** — deliberately *not* `integrations-oms`: every
`integrations-*` package integrates an external system, so that prefix would read as "an adapter
to somebody's OMS" and collide outright with future third-party OMS adapters
(`integrations-fluent`, `integrations-linnworks`), while this package *is* the OMS and its name
is the product name. The no-privileged-path claim rests on the resolution mechanism, not the
naming; the invariant walkers gain `libs/oms/**` as a one-line scope addition. The package is authored
to publishing standard from its first commit — complete `exports` map + `files` whitelist,
`license` field set, imports only published `@openlinker/*` barrels (no deep paths,
ESLint-enforced), no in-repo relative escapes, its own README as the product front door — but
carries `"private": true`. A separate repo was rejected *now* because it forces publishing
`@openlinker/core` (a living domain layer, not an SDK) during peak port churn, while buying no
deployment separation — the plugin must still be composed in `apps/*/src/plugins.ts` and
`plugin-migrations.ts`, so the deployed artifact is the host either way. The **decision point is
the end of Wave 3** (contract freeze): evaluate publishing/extraction once, mechanically, instead
of paying cross-repo lockstep weekly during the build. Marketing separation ("OpenLinker OMS" as
a named product line) needs none of this — it is README/docs/labels, not git topology. Open-core,
if ever chosen, is the GitLab-style license-split directory in this repo, and that choice expires
when the repo's history goes public.

**Cons / trade-offs:**
- A connection row with no credentials is a new shape for the connections UI (trivial tester).
- `SyncJob.connectionId` non-nullability (#1943) is leaned on again; a second consumer of that
  interim scaffold strengthens the case to fix it.

*Reversal gate (prose-only):* the end-of-Wave-3 contract freeze is the standing decision point — publishing
`@openlinker/core` and/or extracting the package is evaluated there, once. The open-core licensing
option expires when the repository's history goes public; past that date only the in-repo
license-split remains.

## References

- Related issues: #1943, #576
- Related ADRs: [ADR-003](./003-plugin-sdk-trust-model.md), [ADR-002](./002-capability-ports-with-sub-capabilities.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §9
