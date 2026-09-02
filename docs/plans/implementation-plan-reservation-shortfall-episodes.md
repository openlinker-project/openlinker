# Implementation Plan: Reservation shortfall as a named-order fact (persisted episodes)

**Date**: 2026-08-27
**Issue**: #2349 (`W2-12`), Wave 2 stream S1. Consumer: #2350 (`W2-13`).
**Status**: Ready for implementation
**Classification**: CORE (Application + Infrastructure) + Interface, **migration-bearing**

---

## 1. Task Summary

**Objective**: when the master's `availableQuantity` drops below what OL already promised
(`olReservedQuantity`), record a **shortfall on a named order** — never a silently clamped
number — as a **persisted episode with a stable occurrence id**.

**Context**: design §4.2 / story I6. §4.2 deliberately declines the `olReserved <= available`
CHECK precisely so this state is *persistable*. The episode grain is what makes automation
trigger T8 (`W2-23`, spec §5.2, `edge`-classified) implementable: without a stable per-episode
id, "fires on the transition into shortfall" degrades into "fires on every recompute" — the
hourly-email bug.

---

## 2. Scope & Non-Goals

### In scope
- `reservation_shortfall_episodes` table + migration **slot `1861000000000`**.
- `ReservationShortfallEpisode` domain entity, types, repository port + repository.
- `ReservationShortfallService` (`IReservationShortfallService`) — detection, attribution,
  open/close lifecycle.
- Worker handler + job type `inventory.reservations.shortfall` (lane `bulk`) + scheduler task.
- Order-detail projection: `stockAtRisk[]` on `GET /orders/:internalOrderId`.
- Unit specs + one integration spec covering the three lifecycle ACs.

### Out of scope
- The RS-S inert-state reason value (`W2-15` owns the authority-status reason union; it does
  not exist on this branch — emitting into a sink that does not exist would make an unhandled
  condition read as handled, the #2346 `escalated` precedent).
- Any FE surface (#2350).
- Any remediation action. The operator's fix is off-system.
- Any repair of the numbers. **The reconciler writes to no other table.**

### Constraints
- Migration slot is exactly `1861000000000`; 1849–1860 and 1862 are held by siblings.
- `inventory` must never import `shipping` (#2348 handover item 4).
- The `publish-quantity-parity` int-spec must stay byte-identical green.

---

## 3. Architecture Mapping

**Target layers**: CORE `libs/core/src/inventory/` (domain + application + infrastructure),
`apps/worker/src/sync/handlers` + `apps/worker/src/scheduler`, `apps/api/src/orders/http`.

**No new core cross-context edge.** The order-detail projection is composed in the **host app's**
interface layer (`OrdersController` injects `IReservationShortfallService` from
`@openlinker/core/inventory`), exactly as it already injects `IInvoiceService`. Adding
`orders -> inventory` inside `libs/core` would buy nothing and widen the map.

**Reused**: `ReservationRepositoryPort` (relative, intra-context — never on the barrel),
`resolveSweepBudget` / `resolveSweepLockTtlMs` (`apps/worker/src/sync/bounded-sweep.ts`),
`SyncLockPort`, `ConnectionCursorRepositoryPort` (the `marketplace.offer.statusSync` scan-offset
shape), `SYSTEM_CONNECTION_ID` global-scope precedent.

---

## 4. Design

### 4.1 The episode, and why its id is stable

One row is one **episode**: opened once on the transition into shortfall, closed by an explicit
write, never reopened. `id` (uuid PK) is the **occurrence id** `W2-23`'s T8 keys on.

Its stability rests on one structural property, not on discipline: a **partial unique index**

```
UQ_reservation_shortfall_open  ON (orderRecordId, inventoryItemId)  WHERE "closedAt" IS NULL
```

The open write is `INSERT ... ON CONFLICT DO NOTHING` against that index. So while an episode is
open, **every re-detection conflicts and writes nothing** — the id cannot change, cannot be
re-minted, and cannot be duplicated by two concurrent runs. A recurrence after a close does not
conflict (the closed row is outside the partial index), so it mints a **new** id. That is the
same idiom `UQ_reservations_active_line` already uses, and it is what makes
"re-fires only if the shortfall clears and then recurs" implementable rather than aspirational.

**There is deliberately no `lastObservedAt`.** A re-observation column would make every run write
to every open episode, which is exactly what the AC forbids and exactly what would tempt a future
level-triggered reader.

### 4.2 The grain: `(orderRecordId, inventoryItemId)`

The issue words the grain as `(order, sku)`. The key is the **position**, because:

- `olReservedQuantity > availableQuantity` is a POSITION-level fact. It is not observable at any
  other grain, and merging two positions of one variant into one episode would require inventing
  a shortfall number no single position observed.
- One position resolves to exactly one variant, hence one sku — so on every shipped install the
  two grains coincide (WooCommerce leaves `locationId` undefined and PrestaShop never sets it,
  #2322/#2324, so a variant has one pooled position per source).
- `product_variants.sku` is **nullable** and not unique, so it cannot carry a uniqueness index.

`productVariantId` and `sku` are denormalised onto the row **as a snapshot at open time**, so the
operator can still read what was short after the variant is re-mapped.

**The sku is NOT obtained by a SQL join.** Joining `product_variants` — a *products*-context
table — from an inventory repository is the raw-table cross-context join ADR-036 restricts, and it
would fail that rule's own test: the join would be display enrichment alone, which must go through
the owning context's `I*Service`. `ReservationShortfallService` therefore resolves the variant via
`IProductsService` (the `inventory -> products` edge already exists) and passes `sku` into
`openEpisode` as a plain input. A resolution failure degrades to `sku: null` — an episode naming an
order and a variant is still worth recording; refusing to record it would trade a fact for nothing.

### 4.3 Attribution: youngest-first, a STATED POLICY

Shortfall on a position is `olReservedQuantity - availableQuantity`. It is attributed to that
position's `held` reservations ordered `createdAt DESC` (ties broken by `id` for determinism),
greedily, until exhausted. "The last promise made is the one at risk" is a **policy OL chose**,
not an inference about which buyer will actually go unserved — documented on the reconciler.

Each attributed reservation contributes one episode candidate for its `orderRecordId`. Two lines
of one order on one position collapse into a single episode whose `shortQuantity` is their sum,
because the episode grain is the order, not the line.

### 4.4 Two close triggers, and the second one is the reason the close pass exists

Handover item 2: `released` is now a reachable terminal status. So:

| `closeReason` | Trigger |
|---|---|
| `recovered` | the position is no longer short (`olReserved <= available`) |
| `reservation-closed` | the order holds **no** `held` reservation on that position any more — cancellation (`released`), dispatch (`consumed`), or expiry |

A shortfall episode therefore closes by **cancellation** as well as by the master recovering, and
that is not an edge case: cancelling the at-risk order is one of the two remediations an operator
actually has. Both are explicit `closedAt` writes — the row is never removed from a predicate and
never derived away. A closed episode stays readable.

The close pass **cannot be driven from the detection page**: a recovered position simply stops
matching the shortfall predicate, so nothing in that page mentions it. It is driven from the open
episodes themselves — the same inversion `master.product.reconcile` (#2222) makes for deletions.

### 4.5 Budget + resumption: scan-offset, in BOTH halves

`bounded-sweep.ts` distinguishes the scan-offset family from taxonomy's frontier-as-query. This
pass is scan-offset in both halves, and that is a correctness choice, not a copy:

- **Detection half.** The reconciler repairs nothing, so a short position **stays** in the
  predicate across runs. Frontier-as-query would re-read the same head page forever and never
  reach the tail. The offset advances by rows **READ**.
- **Close half.** A closed episode leaves the set, so this half *is* self-consuming — but unlike
  the expiry sweep, **skipping is harmless**: an episode not visited stays open and is therefore
  still in the set next tick. An offset buys starvation-freedom at no cost, so it is used, and
  wraps to `0` on a short page.

**Both halves order by `id ASC`.** Not `openedAt` / `updatedAt`: rows leave the close set *from the
head* under a recency ordering, which makes the offset over-advance systematically rather than
randomly. `id` is a stable total order over a set that shrinks from arbitrary positions.

Two cursor keys on `connection_cursors` under the nil-UUID system connection (reservations carry
no connection axis, per the #2346/#2347 precedent):
`inventory.reservationShortfall.detectOffset` and `inventory.reservationShortfall.closeOffset`.
The handler owns the cursor (the `marketplace.offer.statusSync` #816 shape), takes its own lock
(`inventory:reservations:shortfall:{scope}`) and its own budget.

### 4.6 Every non-recording exit is observable

- A position short but with **no** `held` reservations is a defect signal (the counter disagrees
  with the ledger) and is `error`-logged as `reservation_shortfall_unattributable`, counted as
  `unattributed` on the result. It records no episode, because there is no order to name.
- A position whose held reservations sum to **less** than the shortfall leaves a residue; that is
  the same defect and is logged and counted the same way.
- Per-candidate write failures are counted (`failed`) and logged with the position and order;
  they never abort the run. A whole-page failure logs distinctly.
- Every counter reaches the job log with job context. Nothing declines silently.

### 4.6b Indexes, because the detection predicate cannot be indexed directly

`olReservedQuantity > availableQuantity` is a cross-column comparison, so **no index serves it** and
a naive pass sequentially scans `inventory_items` — the table every published quantity derives from
— on every tick. Two partial indexes bound it:

- `IDX_inventory_items_ol_reserved ON inventory_items ("id") WHERE "olReservedQuantity" > 0` —
  narrows the candidate set to positions carrying any hold at all, which on a real install is a
  small fraction of the catalogue. The scan then costs the size of the LEDGER, not the catalogue.
  Declared on `InventoryItemOrmEntity` **and** in the same migration (the parity rule).
- `IDX_reservation_shortfall_open_id ON reservation_shortfall_episodes ("id") WHERE "closedAt" IS NULL`
  — backs the close half's `closedAt IS NULL ORDER BY id` page. The partial UNIQUE index cannot
  serve that ordering.

### 4.7 Nothing is clamped

The service holds only the shortfall repository and the reservation repository. It issues no
UPDATE against `inventory_items` and no write against `reservations`. `availableQuantity`,
`olReservedQuantity` and every reservation quantity are read-only here. A spec asserts the
service's collaborators expose no such call and that no write mock is touched.

---

## 5. Implementation Steps

### Phase 1 — domain + persistence
1. `libs/core/src/inventory/domain/types/reservation-shortfall.types.ts` — `ReservationShortfallCloseReasonValues`/`...CloseReason` (`as const` union), `OpenShortfallEpisodeInput`, `CloseShortfallEpisodeInput`, `ShortfallPositionRow`, `ShortfallAttribution`.
2. `.../domain/entities/reservation-shortfall-episode.entity.ts` — anemic readonly entity + a pure `isOpen()` derivation (ADR-011).
3. `.../domain/ports/reservation-shortfall-repository.port.ts` — `listShortfallPositions(limit, offset)`, `listHeldForPositions(inventoryItemIds)`, `openEpisode(input)`, `listOpenEpisodes(limit, offset)`, `closeEpisode(id, reason, at)` (guarded `WHERE closedAt IS NULL`), `listOpenByOrderRecordId(orderRecordId)`. **`openEpisode` returns `ReservationShortfallEpisode | null`** — `null` means "an episode is already open for this key, nothing was written". `ON CONFLICT DO NOTHING` still *executes* every run, so a row count is the only honest measure of "one open-write", and this return value is what a caller and a test read it from.
4. `.../infrastructure/persistence/entities/reservation-shortfall-episode.orm-entity.ts` — partial unique index declared class-level with the SAME NAME the migration uses (the `reservations` precedent, because the int harness builds by `synchronize`), plus `@Check('CHK_reservation_shortfall_quantity_positive', '"shortQuantity" > 0')` and a supporting `(orderRecordId)` index for the order-detail read.
5. `.../infrastructure/persistence/repositories/reservation-shortfall.repository.ts` — TypeORM, domain errors only.
6. `apps/api/src/migrations/1861000000000-create-reservation-shortfall-episodes.ts` — hand-authored, `up`/`down`, verified MECHANICALLY against the `synchronize`-built table.

### Phase 2 — application
7. `.../application/services/reservation-shortfall.service.interface.ts` + `.service.ts` implementing it.
8. Tokens (`RESERVATION_SHORTFALL_SERVICE_TOKEN`, `RESERVATION_SHORTFALL_REPOSITORY_TOKEN`), module wiring, barrel exports (**repository port stays off the barrel**).

### Phase 3 — worker
9. `JobTypeValues` += `inventory.reservations.shortfall`.
10. `apps/worker/src/sync/handlers/reservation-shortfall.handler.ts` + module + registration at lane `bulk` (same reasoning as its two siblings: no children, bounded local writes, and a tick's delay is harmless).
11. Scheduler task `reservation-shortfall-sweep`, `OL_RESERVATION_SHORTFALL_SWEEP_ENABLED`, default ON, `*/20 * * * *`.

### Phase 4 — interface
12. `apps/api/src/orders/http/dto/order-stock-shortfall.dto.ts`; `stockAtRisk` on `OrderRecordResponseDto`; populated in `getOrder` only (never in the shared `toDto`, so the list read takes no N+1).

### Phase 5 — tests + docs
13. Unit specs: service (attribution order, open-idempotency, both close reasons, unattributable, no-clamp), repository, handler, entity.
14. Integration spec `apps/api/test/integration/reservation-shortfall-episodes.int-spec.ts` — three runs over one standing shortfall ⇒ one episode, one open-write; recovery closes; recurrence mints a NEW id; cancellation (release) closes with `reservation-closed`.
15. `docs/architecture-overview.md` § Inventory bullet.

---

## 6. Alternatives Considered

- **A boolean/derived flag on `inventory_items` or on the order.** Rejected by the issue itself:
  a level-triggered fact gives T8 nothing to key on. Also unattributable — the flag would live on
  a row that names no order.
- **Close by predicate (the row stops matching).** Rejected: the AC requires the closed episode to
  remain readable, and a derived close leaves no `closedAt` for an operator or for T8's
  "cleared then recurred" test.
- **Key the episode on `(orderRecordId, sku)`.** Rejected: `sku` is nullable, so it cannot back a
  unique index, and the shortfall is only observable per position (§4.2).
- **Frontier-as-query for the detection half.** Rejected: the reconciler repairs nothing, so the
  predicate never shrinks and the head page would repeat forever (§4.5).
- **Repair the counter toward the ledger in the same pass.** Rejected: outside this issue, and it
  would make the pass a writer of the very numbers the AC forbids clamping.

---

## 7. Risks & Edge Cases

| Risk | Handling |
|---|---|
| A position short with no held reservations | Logged `error`, counted `unattributed`, no episode (no order to name) |
| Concurrent runs | Lock; and the partial unique index makes a double-open impossible regardless |
| Episode open for an order that no longer exists | `orderRecordId` carries no FK (the `reservations` precedent); close still fires via `reservation-closed` |
| Variant deleted after open | `sku`/`productVariantId` are open-time snapshots |
| Detection offset skips a position | Position stays short, opened next cycle — latency, never loss (documented) |
| Migration ↔ entity drift | Verified mechanically (DDL applied to scratch Postgres, `information_schema.columns` + `pg_indexes` diffed against the `synchronize`-built table) |

---

## 8. Acceptance Criteria mapping

- Lowering master quantity below reserved ⇒ episode naming order + sku → int-spec S1.
- No number clamped → service spec asserts no write collaborator exists/is called.
- Stable occurrence id → `id` uuid PK + partial unique index (§4.1).
- Three runs, one episode, one open-write → int-spec S2, asserted as **one row created plus two `null` returns from `openEpisode`**.
- Recovery closes by explicit `closedAt` write; row stays readable → int-spec S3.
- Recurrence mints a NEW id → int-spec S4.
- Budgeted + resumable → two scan-offset cursors + budget (§4.5).
