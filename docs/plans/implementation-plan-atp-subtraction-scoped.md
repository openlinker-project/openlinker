# Implementation Plan: ATP subtraction for OL-computed scopes + `olHeldNotReflected` (#2345)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day

---

## 1. Task Summary

**Objective**: make OpenLinker's own advisory reservation ledger actually reduce what a channel may
promise — but only for scopes where **OL computes ATP itself**. An authority-answered scope is taken
as-is, and OL's ledger rows for it are reported alongside as `olHeldNotReflected`, never subtracted.

**Context**: #2321 shipped `IAvailabilityService` with the ledger term already in the formula, bound
to `EmptyReservationLedgerReader`. #2323 rewired every read site onto that seam. #2343/#2344 shipped
the ledger's write half with a **stamped** `atpEffect` column. This issue changes one computation and
one provider binding — nothing else — which is exactly why W1b-7 gated it.

**Classification**: CORE (application + domain types) + Infrastructure (one repository-backed reader).

---

## 2. Scope & Non-Goals

### In scope
- A real, Postgres-backed `ReservationLedgerReaderPort` implementation.
- Swapping the `RESERVATION_LEDGER_READER_TOKEN` binding away from the empty stand-in.
- The §4.2 scoped-subtraction rule as a **pure** function, plus `olHeldNotReflected` on
  `PromisableQuantity`.
- Unit + integration tests, including the Story I1 (empty-ledger byte-identity) regression.

### Out of scope
- The expiry sweep (#2346), consume-as-claim (#2347), the ADR-028 cancellation repoint (#2348), the
  shortfall episode model (#2349).
- Any `AvailabilityAuthority` adapter or dispatch. `provenance: 'authority'` remains declared and
  never produced (Wave 3). The authority arm of the scoped rule is therefore tested at the pure-rule
  level, which is where the rule lives — asserting it through the service would require faking a
  capability that does not exist.
- Any schema change. **No migration slot is used.**

### Constraints
- `apps/api/test/integration/publish-quantity-parity.int-spec.ts` must stay green, unchanged.
- `provenance: 'unknown'` continues to mean *suppress the publish and alert* — never `0`.
- A variant with no positions stays `'computed'` 0.
- `inventory_items.reservedQuantity` is never subtracted.
- Cross-source summing is preserved (ADR-058 decision 2).

---

## 3. Architecture Mapping

**Target layer**: `libs/core/src/inventory/` — domain types + application service + one infrastructure
reader. ADR-052's A1 row assigns availability to this context.

**Ports involved**: `ReservationLedgerReaderPort` (existing, unchanged signature),
`IAvailabilityService` (existing; `PromisableQuantity` widened).

**Reused**: `ReservationOrmEntity`, `InventoryItemOrmEntity`, `computeAtp`, `applyStockSafetyBuffer`,
the `AVAILABILITY_PARITY_CASES` fixture.

**New**: `ReservationLedgerReader` (infrastructure), `applyScopedLedgerSubtraction` + `AtpAnswer`
(domain types, pure-rule exception per `engineering-standards.md`).

**Core vs Integration**: entirely CORE — the ledger is OpenLinker's own store; no platform is
involved.

---

## 4. Design

### 4.1 The reader

`libs/core/src/inventory/infrastructure/reservations/reservation-ledger.reader.ts`

```sql
SELECT inv."productVariantId", SUM(r."quantity")
FROM reservations r
JOIN inventory_items inv ON inv.id = r."inventoryItemId"
WHERE r."status" = 'held'
  AND r."atpEffect" = $stamp
  AND inv."productVariantId" IN ($variantIds)
  AND inv."isStale" = false
GROUP BY inv."productVariantId"
```

Four properties are load-bearing:

1. **The stamp is a column test, never an inference** (#2344's contract clause 1). `atpEffect` comes
   from the caller and is bound as a parameter; the reader never derives it. `diagnostic` rows can
   therefore affect no published number under any configuration, because the query cannot see them.
2. **Only `held` rows count** (clause 5). Terminal rows are kept forever, so filtering by row
   existence would subtract every release the system has ever performed.
3. **`isStale = false` mirrors the numerator.** `findAvailabilityByVariantIds` excludes stale
   positions (#1478); a hold against a staled position must be excluded too, or the subtraction runs
   against a total that never included it and the variant silently under-publishes.
4. **The reservation quantity is grouped by the position's `productVariantId`**, which is what makes
   the ledger term commensurable with the availability term — both are variant-keyed sums across all
   locations and all sources.

The `scope` argument is deliberately **not** a filter for the two answered scopes: a hold is a claim
on physical stock, so it reduces what *any* channel may promise, and `global` and `channel` see the
same sum. The three unanswered scopes (`location` / `order` / `work`) throw
`UnsupportedAvailabilityScopeError` here as well as in the service — not redundancy but a second
door: a future caller reaching the reader directly must not receive an unfiltered sum dressed as a
location-scoped one.

Numeric coercion follows `findAvailabilityByVariantIds`: Postgres returns `SUM` as a string through
TypeORM's raw path, so `Number()` at the boundary.

### 4.2 The scoped-subtraction rule

`availability.types.ts` gains a discriminated input and one pure function:

```ts
export type AtpAnswer =
  | { readonly answeredBy: 'computed'; readonly totalAvailable: number }
  | { readonly answeredBy: 'authority'; readonly availableToPromise: number };

export function applyScopedLedgerSubtraction(
  answer: AtpAnswer,
  olReservedPublished: number,
  buffer: number
): { quantity: number; olHeldNotReflected: number | null };
```

- `computed` → `{ quantity: computeAtp(totalAvailable, olReservedPublished, buffer),
  olHeldNotReflected: null }`. `null` because the holds **are** reflected in `quantity`; reporting `0`
  there would say "nothing outstanding", which is a different and usually false claim.
- `authority` → `{ quantity: applyStockSafetyBuffer(max(0, availableToPromise), buffer),
  olHeldNotReflected: olReservedPublished }`. The authority's number is passed through untouched by
  the ledger; `0` here is meaningful and means "OL holds nothing this answer does not already know
  about".

The **buffer still applies** on the authority arm: ADR-061 decision 3 makes it a Control — the
operator's own cushion on top of whatever produced the promise — not part of the promise. Reconciling
it against a future `AvailabilityAnswer.controlsApplied` is Wave 3's, and is noted in the docblock.

`PromisableQuantity` gains `olHeldNotReflected: number | null`; `toPromisableQuantity` takes it plus
an optional `provenance` (defaulting to `'computed'`, so the Wave-3 arm is assemblable without a
second factory); `unknownPromisableQuantity` reports `null` — an unknown answer knows nothing about
outstanding holds either.

### 4.3 The service

`AvailabilityService.getPromisableQuantities` keeps its existing shape and swaps its per-variant
assembly onto the rule with `answeredBy: 'computed'` — the only value Wave 2 can produce. One
comment names the single Wave-3 flip point. Both batch-wide `'unknown'` exits are unchanged, as are
both `applyPublishControls*` methods (neither has a variant id, so neither has a ledger term).

### 4.4 The empty reader

`EmptyReservationLedgerReader` moves to `libs/core/src/inventory/testing/`, keeping its class name,
and is dropped from the module providers and the main barrel. Its own docblock said it must be
deleted rather than extended once Wave 2 lands, and that is honoured for production: it is no longer
reachable from any runtime path. It survives as the zero-ledger fixture the parity unit specs need —
deleting it outright would have those specs hand-roll the same stub twenty times.

---

## 5. Steps

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `domain/types/availability.types.ts` | add `AtpAnswer`, `applyScopedLedgerSubtraction`, widen `PromisableQuantity` / `toPromisableQuantity` / `unknownPromisableQuantity` | both arms unit-tested; `computeAtp` untouched |
| 2 | `infrastructure/reservations/reservation-ledger.reader.ts` | new reader | unit spec pins the predicate + the numeric coercion |
| 3 | `testing/` + `index.ts` + `inventory.module.ts` | relocate the empty reader; swap the token binding | no production import of the empty reader remains |
| 4 | `application/services/availability.service.ts` | assemble through the rule | existing specs pass unchanged except for the new field |
| 5 | `application/services/__tests__/availability.service.spec.ts` | published-lowers / diagnostic-does-not cases | both directions asserted |
| 6 | `apps/api/test/integration/atp-subtraction.int-spec.ts` | real Postgres slice | published lowers, diagnostic does not, stale position excluded |
| 7 | quality gate | lint / type-check / test / parity int-spec | parity green, byte-identical |

---

## 6. Alternatives Considered

**Filter the ledger by scope in SQL.** Rejected: reservations carry no channel axis and inventing one
would mean a hold placed by one channel's order does not reduce another channel's promise — an
oversell by construction.

**Report `olHeldNotReflected: 0` on the computed path.** Rejected: it reads as "no outstanding holds"
when the truth is "the holds are already inside the number".

**Delete `EmptyReservationLedgerReader` outright.** Rejected: the parity unit matrix genuinely needs a
zero ledger, and twenty inline stubs is how a fixture drifts. Removing it from every production path
satisfies the intent of its own docblock.

**Add a `sourceConnectionId` / location filter now.** Rejected: out of scope, and deduplicating
physical stock is #2319/#2325's problem (ADR-058 decision 2).

---

## 7. Risks & Edge Cases

- **Every published quantity in the system flows through this seam.** Mitigated by the parity
  int-spec (unchanged, must stay byte-identical on an empty ledger) plus the `OL_RESERVATIONS_ENABLED`
  default and #2344's rule that a default install stamps every hold `diagnostic` — so Story I1 holds
  by *data*, not merely by the empty reader.
- **Stale positions**: covered by the `isStale = false` predicate and an explicit int-spec case.
- **Empty `variantIds`**: the service short-circuits before the reader; the reader also returns an
  empty map without issuing a statement (`IN ()` is a syntax error).
- **A reader failure** keeps the existing batch-wide `'unknown'` behaviour — never a zero ledger term,
  which would publish the un-reserved quantity and oversell by exactly the outstanding holds.

---

## 8. Testing Strategy

- Unit: pure-rule both arms; reader predicate + coercion; service published-vs-diagnostic.
- Integration: new `atp-subtraction.int-spec.ts` against real Postgres (`reservations` is already in
  the harness truncation list).
- Regression: `publish-quantity-parity.int-spec.ts` unchanged and green.

---

## 9. Alignment Checklist

- [x] Hexagonal layering respected (pure rule in domain, reader in infrastructure, assembly in
      application)
- [x] Repository ports imported relatively — no `@openlinker/core/inventory` self-import
- [x] `as const` union pattern for the new discriminant
- [x] No `any`, no `console.log`, no migration
- [x] Tests added; parity regression named as an acceptance gate
