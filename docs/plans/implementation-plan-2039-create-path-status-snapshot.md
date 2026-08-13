# Implementation Plan — #2039: write an `offer_status_snapshots` row on the create path

**Issue**: [#2039](https://github.com/openlinker-project/openlinker/issues/2039)
**Branch**: `2039-offer-create-status-snapshot` (base: `origin/main` @ `648cfc6e6`)
**Type**: CORE + Integration (Allegro adapter) + Infrastructure (persistence)

---

## 1. Understand the task

**Goal.** A successful offer create must persist the publication status it already learned, instead of
leaving `offer_status_snapshots` empty until the hourly rolling scan reaches the row (~40 h worst case on a
4,000-offer catalog).

**Layer classification**
- CORE — `libs/core/src/listings`: neutral contract field, one new service method, two call sites.
- Infrastructure — the snapshot repository's `upsert` becomes multi-writer-safe.
- Integration — the Allegro adapter reports the status it already receives.

**Non-goals** (mirrored from the issue's *Out of scope*)
- Any Erli coverage — an Erli create reports no publication status; #992 owns Erli status reads.
- The `refreshSnapshot` idempotency-key collision (pre-existing #1760 defect; no ladder caller is added here).
- The reconcile ladder's not-found-is-terminal behaviour and rung widths.
- The unreachable FE `Refresh` button.
- The `createdAt DESC` offset-scan paging on `main`.

---

## 2. Research — what already exists

| Fact | Location |
|---|---|
| `upsert` has exactly two callers, both in one service | `offer-status-sync.service.ts:99`, `:162` |
| That service already owns the snapshot port | `offer-status-sync.service.ts:52-53` |
| `toStatusDetails` already maps `{message}[]` → `OfferStatusSnapshotDetails` | `offer-status-sync.service.ts:180-187` |
| The poll service holds a live read at the `Active` terminal | `offer-status-poll.service.ts:155`, branch `:184-190` |
| The create path's terminal record write | `offer-creation-execution.service.ts:186-191` |
| Post-create side effects are deliberately non-throwing | `:149-180`, `:200-207`, `:221-227` |
| `loadOrCreateRecord` has no terminal guard ⇒ a throw re-runs `createOffer` | `:293-300`, `:129` |
| Allegro holds the raw publication status at create time | `allegro-offer-manager.adapter.ts:1516` |
| Allegro already has a raw→neutral mapper | `allegro-offer-manager.adapter.ts:695` |
| Precedence-guarded upsert precedent (raw parameterized `ON CONFLICT`) | `webhook-delivery.repository.ts` (#1916) |
| Multi-writer `*_snapshots` rule + "prove it with an integration test" | `docs/lessons.md:180-182` |
| Unique key for `ON CONFLICT` | `offer-status-snapshot.orm-entity.ts:28-30` |

**Reuse collision check** (pre-implement gate, inline): `recordObservedStatus`, `OfferStatusObservation`
and a `publicationStatus?` field on `CreateOfferResult` do not exist anywhere in `libs/` or `apps/`. No new
DI token, no new ORM entity, no new job type, no migration.

---

## 3. Design

```
Allegro adapter                        core
─────────────────────────────────────  ─────────────────────────────────────────────
createOffer()                          OfferCreationExecutionService.executeCreation
  response.publication?.status  ──────▶  result.publicationStatus?  (optional field)
                                           │  present → recordObservedStatus (best-effort)
                                           │  absent  → nothing (honest "no row")
OfferStatusPollService.pollOnce             ▼
  Active terminal, result in hand ────▶ IOfferStatusSyncService.recordObservedStatus
                                              └─▶ snapshots.upsert  (freshness-guarded SQL)
```

**Why the write lives on `IOfferStatusSyncService`.** It already owns the snapshot port and both existing
`upsert` callers, so the table keeps a single owning service and the transition-logging stays in one place.
`OfferStatusSyncService` depends on integrations + offer mappings + snapshots only, so injecting it into the
poll and execution services introduces no DI cycle.

**Why an optional adapter-supplied field, not a core-side coercion.** `CreateOfferResultStatus`
(`draft | validating | active`) is a create vocabulary explicitly warned apart from `OfferPublicationStatus`
(`offer-create.types.ts:260-261`). Only the adapter can honestly translate. An adapter with nothing
authoritative omits the field, and core writes nothing.

**Why freshness, not status rank.** `active → ended → active` is legitimate, so the #1916 rank-by-value
pattern does not transfer. The monotonic key is `lastStatusSyncedAt`.

---

## 4. Steps

1. **`libs/core/src/listings/domain/types/offer-create.types.ts`** — add optional
   `publicationStatus?: OfferPublicationStatus` to `CreateOfferResult`, documenting that it is set only when
   the create response carried an authoritative status and that its absence means "do not write a snapshot".
   *AC*: type-checks; existing adapters compile untouched.

2. **`libs/core/src/listings/application/services/offer-status-sync.service.interface.ts`** — add
   `OfferStatusObservation { publicationStatus; validationMessages?; observedAt? }` and
   `recordObservedStatus(connectionId, target, observation): Promise<void>`.
   *AC*: exported from the listings barrel.

3. **`offer-status-sync.service.ts`** — implement `recordObservedStatus`: upsert + the same transition log
   the other two callers emit. No adapter call (the caller already observed the status).
   *AC*: unit test asserts the upserted command fields and the transition log condition.

4. **`offer-status-snapshot.repository.ts`** — replace find-then-save with a raw parameterized
   `INSERT … ON CONFLICT ("externalOfferId","connectionId") DO UPDATE` whose overlay columns are guarded by
   `stored.lastStatusSyncedAt <= EXCLUDED.lastStatusSyncedAt`, with
   `lastStatusSyncedAt = GREATEST(stored, EXCLUDED)`. Keep the pre-read for `previousStatus` (port contract).
   Update the port docblock's "always refreshing `lastStatusSyncedAt`" claim.
   *AC*: an int-spec proves a stale observation does not overwrite a fresher row.

5. **`offer-status-poll.service.ts`** — on the `Active` terminal, call `recordObservedStatus` with the in-hand
   `result`; wrap in try/catch + warn (a snapshot write must not fail the poll iteration, same posture as
   `scheduleSnapshotReconcile`). `POLL_TIMEOUT` / `Draft` ladders unchanged.
   *AC*: existing spec assertion at `:179` narrowed to the poll job type; new test asserts the upsert.

6. **`offer-creation-execution.service.ts`** — after the terminal record write, one unconditional branch:
   `result.publicationStatus` present → `recordObservedStatus`, wrapped so it can never throw; absent → skip.
   *AC*: a rejecting write still returns `outcome: 'ok'` and does not re-enter `createOffer`.

7. **`allegro-offer-manager.adapter.ts`** — set `result.publicationStatus` from `response.publication?.status`
   via `mapAllegroPublicationStatus`, **only when the raw value is present** (never the mapper's `inactive`
   default). *AC*: adapter spec covers `ACTIVE` / `ACTIVATING` / absent.

8. **Docs** — `docs/architecture-overview.md` (§ Listings offer-status), ADR-009 § Consequences bullet 2 +
   the #1760 amendment.

---

## 5. Validation

- **Architecture**: no platform name enters core; the adapter→core seam is one optional neutral field;
  the repository port keeps its shape; no cross-context import added.
- **Naming**: `*.service.interface.ts` contract extended, `OfferStatusObservation` in the interface file
  beside its consumer (matches `OfferStatusRefreshTarget` precedent).
- **Testing**: unit specs for the three services + the adapter; one int-spec for the SQL guard
  (`docs/lessons.md:180-182` — a mocked repository cannot exercise it).
- **Security**: raw SQL is parameterized; column names are a fixed entity whitelist, never user input.
- **Migration**: none — no schema change.
