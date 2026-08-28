# ADR-067: Ordering a concurrent write by a single-clock freshness token plus a short per-target lock

- **Status**: Accepted
- **Date**: 2026-08-27
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made across PRs #2617, #2609)

## Context

[ADR-050](./050-workload-isolation-concurrency-lanes.md) made the runner schedule jobs **concurrently** within a lane. It promises nothing about the order in which two jobs touching the same external object finish, and #2609 removed the last accidental serialisation - a `fan-out` per-scope cap of 1, which had been ordering every stock propagation in the installation by starving it.

That turned a latent defect into a live one. Two `marketplace.offerQuantity.update` jobs for the same offer can reach the marketplace out of order, so an older quantity lands last and the listing advertises stale stock until the next change at the master. When the stale number is the higher one, that is overselling. Nothing in the job model expresses "this write is older than one already applied": a job carries no observation time, and the runner cannot invent one, because the two jobs are equally valid work.

Three constraints shaped the answer. There is no per-object serialisation primitive in the queue - lanes isolate by scope, not by target. The write is not idempotent from the platform's point of view; a quantity write is last-writer-wins at the marketplace. And OL already mints exactly the value the ordering needs: `inventory_items.updatedAt`, which #2071 made database-stamped and read back via `RETURNING`.

## Decision

**A write carries the observation it is based on, and a target refuses a write strictly older than the newest one already applied to it.** Two pieces, and both are required:

1. **A freshness token**, threaded end to end from the write that produced the observation to the adapter call (`inventory_items.updatedAt` -> the propagation payload's `inventoryUpdatedAt` -> `UpdateOfferQuantityCommand.observedAt`), compared against a per-target **mark** in the ordinary `connection_cursors` store (`inventory.offerQuantity.observedAt:offer:{offerId}`).
2. **A short per-(connection, target) `SyncLockPort` lock** (`inventory:offerQuantity:{connectionId}:{offerId}`, TTL 30 s) wrapping read-compare-write.

**The mark advances only AFTER a successful platform write.** That single rule is what makes a refusal safe: it always means a newer quantity is already live on the channel, so a newer write that *failed* can never lock an older one out and leave the listing permanently stale.

**The token must come from ONE clock.** This is a precondition of the decision, not an implementation detail - see Consequences.

## Alternatives considered

- **Serialise by lane or by scope.** Rejected: that is what accidentally held before #2609, and it costs throughput across an entire connection to order two writes to one offer. ADR-050 chooses a lane by cost of starvation; making it a mutual-exclusion device for an unrelated correctness property would overload it and would still not order two jobs in different lanes.
- **The lock alone, with no token.** Rejected: a lock orders the two calls that overlap in time, and says nothing about a job that was delayed, deferred or retried and arrives late carrying old data. Ordering in flight is not ordering in fact.
- **The token alone, with no lock.** Rejected: it leaves two windows open - the read-then-write of the mark is not atomic, and two platform calls already in flight arrive in an order OL does not control. The mark's own advance is a plain compare-and-set, so the lock is load-bearing for the mark's monotonicity as well as for the call ordering.
- **A dedicated table and a version column per offer.** Rejected: `connection_cursors` already is a durable, replica-shared per-connection key-value store with a compare-and-set advance (`advanceIfGreater`), and a new table would need its own migration, repository and retention story for no additional property.
- **Refuse an equal observation too.** Rejected: an equal token is a job retry of the same observation and the write is idempotent at that point; refusing it would turn every ordinary retry into a silently dropped stock update.

## Consequences

**Pros:**
- The guard costs **no extra platform call**: it reads a cursor row and takes a Redis lock. An observed batch is guarded per item and the survivors still go out in one `updateOfferQuantitiesBatch`, with only the ids the adapter reported as succeeded advancing their mark.
- It is independent of lane behaviour, so ADR-050 stays free to tune caps without owning this correctness property.
- It degrades to the previous behaviour rather than failing: `observedAt` is **optional**, so the stale-offer pause (#1689, which zeroes a listing on its own authority and has no observation to quote) writes unguarded, a job queued across the deploy behaves exactly as before, and an unparseable value on either side passes.
- Contention is reported as what it is - a `write_contended` failure that the handler turns into a neutral `ContendedWriteError`, which the runner **defers penalty-free** (see the ADR-007 and ADR-050 amendments for #2613). Contention is the guard working, not the job failing, so it must not spend a retry attempt and eventually dead-letter the very write the guard exists to protect.

**Cons / trade-offs:**
- **The single-clock precondition is a real constraint on future change.** The comparison is a plain ordering of two strings written by two different processes; it is sound only because both come from the same Postgres clock. Replacing the stamp with a worker-side `new Date()` would let a process running ahead refuse a genuinely later write and leave the channel stale - strictly worse than the last-write-wins it replaced. The ambiguity the rule accepts is two writes inside the same millisecond, which it lets through.
- One cursor row per mapped target per connection, never deleted, so a removed mapping leaves its row behind. An accepted leak, bounded by target count.
- The key says `offer` but also holds `ShopProduct` external ids on the shop write-back branch. Safe only because the namespace is per connection and a connection carries one mapping kind - a connection that ever carried both would collide.
- Lock-TTL expiry is not a correctness cliff (the window covered is read-compare-write, and past it the mark is already advanced), but a platform call slower than 30 s can leave the lock free while the write is still outstanding.
- A refused *write* is visible as a job outcome; a refused *mark advance* is a `warn` log only and the offer still reports as succeeded, because the intended state is live either way.

**Reusability.** The shape - a monotonic token minted where the fact is written, a per-target mark advanced only after the effect is confirmed, and a short lock around the compare - is not specific to stock. Any OL write to a last-writer-wins external object can adopt it, on the same precondition: the token must be a single-clock stamp of the fact, never of the attempt.

*Reversal gate (prose-only):* a second caller wanting this ordering with a token that is **not** a single database stamp. That is the point at which the comparison needs a real logical clock (a per-target sequence advanced in the same transaction as the fact) rather than a timestamp, and this ADR is superseded rather than widened.

## References

- Related issues: #2617 (the guard), #2609 (the scope fix that removed the accidental ordering), #2071 (the database-stamped `updatedAt` the token depends on), #2613 (penalty-free deferral, which the contention path uses), #1689 (the unguarded pause path)
- Related ADRs: [ADR-050](./050-workload-isolation-concurrency-lanes.md) (concurrency lanes; § Amendment (#2609) and the deferral amendment), [ADR-007](./007-syncjob-status-vs-outcome-split.md) (status vs outcome), [ADR-010](./010-variant-keyed-master-inventory.md) (variant-keyed inventory)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Core Bounded Contexts - Inventory
