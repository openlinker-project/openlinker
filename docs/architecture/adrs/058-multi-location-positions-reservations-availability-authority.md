# ADR-058: Multi-location inventory positions with provenance

- **Status**: Proposed.
  R1: **narrowed** — reservations and `AvailabilityAuthority` moved to
  [ADR-061](./061-advisory-reservations-and-availability-authority.md); this ADR now carries only
  the Wave-1 location/provenance decisions, which are independently shippable.
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

`inventory_items` is nominally location-aware but behaviourally single-location: a non-null
`locationId` disables propagation outright, and the row carries no connection provenance — the
reason the #1904 rival-master guard is detect-and-withhold. Both partial unique indexes include
the **nullable** `locationId`, which is NULL-distinct in Postgres, so duplicate locationless
positions are permitted today and summed by the availability read. The repo's migrations run in a
single transaction (`CREATE INDEX CONCURRENTLY` unavailable), so any index recreation holds
`ACCESS EXCLUSIVE` on the live oversell table.

## Decision

**(1)** First-class `inventory_locations` rows: operator-defined identity (`code`, `name`,
`kind`), `ownerConnectionId` as *provenance* (never authority), `externalRef`, `status` — **plus
`countryIso2`, `postcode`, optional geo** (R1: the routing filters are unimplementable without
them, and the table is cheapest to get right while new). **(2)** `locationId IS NULL` permanently
means "the master declines to locate its stock" — never a default location; same-source
NULL/non-NULL coexistence is a contradiction the sync enforces; cross-source coexistence is
legitimate and is why provenance is mandatory. **(3)** `inventory_items.sourceConnectionId`
lands by a **three-step ladder** (R1): (i) additive nullable column; (ii) `'legacy'` sentinel
backfill as a batched job (`runBoundedSweep`), never a migration; (iii) `SET NOT NULL` + unique-
index recreation **deferred** behind a cleanliness check, preceded by a **duplicate-position
detection pass** (the existing indexes already NULL-dup on `locationId`; recreation fails outright
on a dirty install — the recreated indexes key `locationId` via sentinel/`COALESCE`, decided at
step iii). Until step (iii) the #1904 withhold guard stays in force as the documented fallback.
**(4)** Provenance also enters the row **lookup** — `findByProductAndVariant`/`getInventory` gain
the connection axis (R1: an index cannot prevent cross-source clobber when row identity is found
without it) — and `olReservedQuantity` (ADR-061) is classified into a **new OL-owned column
group**, beside the master-owned and DB-managed groups. **(5)** The `locationId !== null`
propagation skip is retired — a verified no-op for every in-tree adapter, and **declared breaking
for out-of-tree `InventoryMaster` plugins** that populate `locationId` (the #2163 precedent).

## Alternatives considered

- **`NOT NULL` + index recreation in one Wave-1 migration**: rejected (R1) — single-transaction
  mode makes it a deploy-blocking `ACCESS EXCLUSIVE` hold on the oversell path; the ADR-010
  backfill precedent does not carry the analogy (it was explicitly no-schema-change, no-index).
- **Migrating NULL locations to a synthetic DEFAULT location**: rejected — rewrites the
  unique-index surface on the live path and asserts a location fact OL does not have.
- **A `locations` bounded context**: rejected — no independent lifecycle; a cross-context read on
  every ATP query.

## Consequences

**Pros:** attributable prunes (the #1904 retirement path); cross-source coexistence becomes safe;
the riskiest DDL leaves the critical path entirely.
**Cons:** until step (iii), position dedup rests on the sync's own discipline plus the retained
guard rather than a DB constraint; the release notes carry a plugin-facing breaking change.

## References

- Related issues: #1904, #1689
- Related ADRs: [ADR-010](./010-variant-keyed-master-inventory.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md), [ADR-061](./061-advisory-reservations-and-availability-authority.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §4
- Review record: [REVIEW-oms-authority-model](../../plans/analysis/REVIEW-oms-authority-model.md)
