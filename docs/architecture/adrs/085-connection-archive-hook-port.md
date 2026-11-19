# ADR-085: A plugin may drop its own per-connection state when a connection is archived

- **Status**: Accepted
- **Date**: 2026-11-17
- **Authors**: @norbert-kulus-blockydevs

## Context

Archiving a connection (#3657) deletes the stored credential and evicts the connection's HTTP
transport. It cannot see state a plugin derived from that credential and parked outside the
connection row. The first case is Shopify (#3974): a minted access token lives in the shared
cache and stays valid for hours after the credential that minted it is gone, so an archived
connection kept a working token.

## Decision

Add `ConnectionArchiveHookPort` (`onArchived(connection)`) to the plugin contract, registered by
`adapterKey` in `ConnectionArchiveHookRegistryService` from the plugin's NestJS module - the
webhook-provisioner pattern. `ConnectionService.archive` calls it AFTER the row is archived and
logs a rejection instead of failing the archive. It is best effort, so an implementation must be
safe to retry.

It is deliberately NOT added to `HostServices`: that bag stays limited to what every plausible
plugin needs ([ADR-062](./062-trust-posture-authority-holding-capabilities.md) decision 4), and a
single consumer fails that test.

## Alternatives considered

- **Widen `HostServices` with a cache-eviction method**: rejected, one consumer does not justify
  a bag member every plugin then has to understand.
- **Core evicts cache keys by a naming convention**: rejected, core would have to know each
  plugin's key scheme, which is exactly the platform knowledge the boundary forbids.
- **Fail the archive when the hook throws**: rejected, the row is already archived and a plugin
  fault must not leave an operator unable to archive.

## Consequences

**Pros:**
- A plugin owns the cleanup of state only it understands; the archive path stays platform-neutral.

**Cons / trade-offs:**
- Best effort: a hook that rejects leaves its state until the cache TTL. The rejection is logged.
- `ConnectionService` gains one more constructor dependency (the registry), on top of the roughly
  twenty it already takes. A follow-up candidate is to group the plugin-registry dependencies
  (config validator, credentials validator, rewriter, archive hook, OAuth completion) behind one
  facade service so the constructor stops growing per plugin hook.

## References

- Related issues: #3657, #3974
- Related ADRs: [ADR-003](./003-plugin-sdk-trust-model.md), [ADR-062](./062-trust-posture-authority-holding-capabilities.md)
