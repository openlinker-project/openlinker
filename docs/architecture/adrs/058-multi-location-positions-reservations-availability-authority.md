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

## Amendment (#3206, 2026-09-14): decision (2) is narrowed to the MASTER, and reversal is no longer half free

Decision (2) has always been read as an absolute: `locationId IS NULL` permanently means "the master
declines to locate its stock", never a default location. Two things change, and only the first narrows
the decision.

**1. The rule binds the MASTER's silence, not the operator's assertion.** Neither shipped
`InventoryMasterPort` adapter can report a `locationId` — PrestaShop only through the rarely-enabled
Advanced Stock Management module, WooCommerce not at all — so on those installs every position is
permanently pooled, the fulfilment router's `loadStock()` skips it, and an install with active
locations and routable rules still resolves every line `unfulfillable`. `Connection.config.stockLocationOverride`
(#3206) admits one per-connection **operator-supplied** answer, applied as
`inventory.locationId ?? override ?? null` inside `MasterInventorySyncService` before the row is
written. What decision (2) forbids is unchanged and still holds: OpenLinker never invents a location
the master declined to give, and no synthetic DEFAULT location is minted anywhere. A different
speaker supplying the fact is not the sync guessing it, and a real adapter-reported location always
wins — so the override becomes a silent no-op the day an adapter starts answering. The persisted
`locationId` is therefore never a NULL standing in for something: it is either the master's answer,
or the operator's, or genuinely absent.

**2. Reversal needs code, and the Consequences note saying otherwise is withdrawn.** #2322 shipped the
pooled-to-located repair (`markLocationlessStaleForSource`) and recorded that the mirror direction was
out of scope because `markStaleExceptVariants` prunes per VARIANT and keeps every location row of a
variant the master still reports. That left a documented double-count: a source that stops locating
re-creates and un-stales its pooled row through the ordinary upsert while the abandoned located row
stays live, and `getPromisableQuantities` sums across every location in `global` scope
([ADR-061](./061-advisory-reservations-and-availability-authority.md), #2321) — so the variant's
available-to-promise doubles, with every counter internally consistent, nothing thrown and nothing
logged. An oversell invisible until a buyer hits it.

That gap was unreachable in-product while no shipped adapter set `locationId`. #3206 makes it one
`PATCH` away, and back again, so the mirror ships with the feature that reaches it:
`markLocatedStaleForSource` soft-stales the SAME source's located rows for the variants it just
reported pooled, under the same provenance rule, with the same no-`updatedAt`-bump raw statement, the
same absence of a `master.variant.stale` emission (re-pooling is not a deletion — firing it would
pause live offers for stock that is there, #1689), and its own `inventory.propagateToMarketplaces`
enqueue, since the pooled row's own write can legitimately no-op while this pass changes the aggregate.

Two bounds on the mirror are deliberate. A variant reported BOTH pooled and located in one payload is
subtracted from the mirror's key set, so "located wins" survives and the variant can never be staled
from both sides into a live-position-less known zero. And it is strictly the decision-(2) mirror, not
multi-location pruning: a variant the master reports at ANY location is untouched, so a master that
drops one of two locations still leaves the abandoned row behind. That gap stays out of scope.

**Write-time gate.** An override is validated against `inventory_locations` on the transition —
compared against the persisted config, the #2407 rule — and must name a location that exists AND is
`active`. An `inactive` location is retired ("keep historical positions pointing at a row that
exists", #2316) and the router filters it out, so accepting one would persist a configuration that
decides nothing. The standing degraded state — a location retired or deleted AFTER the override was
set — is not enforced there, because `config` is replaced wholesale and every unrelated patch
re-asserts the stored value; `deleteLocation`'s referential refusal counts `inventory_items` rows and
cannot see a config key, so closing that needs either a widened refusal there or an observable
degradation at resolve time. Neither ships here.

**Status of decision (3) is unchanged.** No FK, no `SET NOT NULL`, no four-column index; the #1904
withhold guard stays in force.

## References

- Related issues: #1904, #1689, #2322, #3206
- Related ADRs: [ADR-010](./010-variant-keyed-master-inventory.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md), [ADR-061](./061-advisory-reservations-and-availability-authority.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §4
- Review record: [REVIEW-oms-authority-model](../../plans/analysis/REVIEW-oms-authority-model.md)
