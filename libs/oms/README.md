# `@openlinker/oms` — OpenLinker OMS

OpenLinker's own order management system: sourcing/routing, fulfilment execution and the work
objects that carry them.

This is a **first-party product package**, a peer of `libs/core` — not an entry in
`libs/integrations/`. Every `integrations-*` package integrates somebody else's system, so that
prefix would read as "an adapter to somebody's OMS" and would collide outright with future
third-party OMS adapters (`integrations-fluent`, `integrations-linnworks`). This package *is* the
OMS, and its name is the product name.

## Status

**Descriptor.** #2390 (`W3a-1`) established the package and its repo-wide registrations; #2405
(`W3a-16`) adds the plugin descriptor itself — the `openlinker.oms.v1` manifest, `createOmsPlugin`,
and the `AdapterMetadata.requiresCredentials` field that lets an operator create the
credential-less connection ADR-055 specifies. Booting either host now registers the manifest.

**Executor.** #2409 (`W3a-18`) adds `OlFulfillmentExecutorAdapter` (`src/execution/`), the first
implementation of `FulfillmentExecutorPort` anywhere in the tree, and advertises
`FulfillmentExecutor` on the manifest alongside it — a name enters `supportedCapabilities` together
with the adapter that delivers it (the Erli #980 precedent). It **auto-accepts**: the holder is
OpenLinker itself, so there is no third party to negotiate with and no vendor record to reconcile.
It holds no state, which is what makes the port's replay guarantee true rather than claimed — it
creates no assignment for a second call to duplicate — and consequently needs no `oms_*` table, no
TypeORM dependency and no migration, and injects nothing (so `OmsModule` stays on
`createNestAdapterModule`). It deliberately does **not** implement `FulfillmentStatusSource`: that
pull serves a POLLING holder, and here it would read core's own counters and report them back to
core as observed progress. `OmsPluginDeps` still declares the five core services and still injects
none; the router (#2408) lands next.

**No `enabledCapabilities` retro-fill ships, deliberately.** That column is stamped at create and
never back-filled, so an OMS connection created before #2409 does not gain `FulfillmentExecutor` on
upgrade. A migration was considered and rejected on two grounds: the whole OMS wave is unreleased,
so no such row can exist outside a developer's own stack running the wave branch, making the
migration dead code on every real install while spending a scarce migration timestamp; and A3 is an
*authority*, so granting it silently would assign "who holds fulfilment work" on the operator's
behalf. An operator ticks the capability on the connection instead.

The OMS ships no migrations and is therefore deliberately absent from
`apps/api/src/plugin-migrations.ts` and `scripts/plugin-migration-dirs.json` — #2390 deferred that
registration here on the premise that #2405 would carry a table, and it does not (routing lives on
`Connection.config`, work objects in core `fulfillment_works`). The first `libs/oms` migration
registers both lists in its own PR.

## How it plugs in

The OL-OMS is a full `AdapterPlugin` behind a real but **credential-less** `Connection` row
(`platformType: 'openlinker'`, `credentialsRef: ''`), created when an operator enables it and
**never seeded by migration**. Core resolves it through the same
`getCapabilityAdapter(connectionId, capability)` path as any vendor and receives the same port
implementations — there is no privileged path into core. The only asymmetry sits *below* the port
line, where the OL-OMS answers from OpenLinker's own tables instead of a vendor API.

Two consequences follow, and both are enforced rather than merely intended:

- **No HTTP client.** There is no network boundary to adapt across; adding one would put an HTTP hop
  on the ATP publish hot path for an in-process consumer. `libs/oms` is in
  `scripts/check-outbound-http.mjs`'s `SCAN_ROOTS` and in the bare-`fetch` ESLint ban.
- **No credentials machinery.** The connection carries none.

Because it is a plugin-shaped consumer of core, `libs/oms` is held to the same import contract as
every package under `libs/integrations/`: **top-level barrels only**
(`@openlinker/core/<ctx>`), no deep `domain`/`application`/`infrastructure` paths, no
`orm-entities` sub-barrels, no `*.tokens` files. `scripts/check-cross-context-imports.mjs` and the
ESLint deep-path ban both cover this directory.

## Publishing posture

**Publishable, not published.** The package is authored to publishing standard from its first
commit — a complete barrel-only `exports` map, a `files` whitelist, a `license` field, this README
as the product front door — but carries `"private": true`.

The decision point is a single one, at the **end of Wave 3**, when the port contract freezes.
A separate repository was rejected for now: it would force publishing `@openlinker/core` (a living
domain layer, not an SDK) during peak port churn while buying no deployment separation, since the
plugin must be composed in `apps/*/src/plugins.ts` either way.

## References

- [ADR-055 — OL's OMS ships as a credential-less connection-backed plugin](../../docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md)
- [ADR-052 — Independently assignable fulfilment authorities](../../docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md)
- [ADR-054 — `FulfillmentWork` as the unit of assignment](../../docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md)
- `docs/plans/analysis/DESIGN-oms-authority-model.md` §9
