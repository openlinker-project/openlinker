# ADR-005: Postgres-authoritative job dedup with Redis Streams as transport

- **Status**: Accepted
- **Date**: 2026-05-13
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made in #711)

## Context

OpenLinker's webhook ingestion path was initially Redis-only for dedup: incoming webhooks were checked against a Redis `SET`-based "seen-events" cache, then published to Redis Streams for downstream processing. This worked for the happy path but had a fundamental durability gap — if Redis was wiped or restarted between the original delivery and a source-side retry, the dedup gate would no longer block the replay. A platform-shipped retry (PrestaShop, Allegro) could replay events from hours or days ago that we'd already processed; Redis dedup keys had typically expired.

We needed event dedup that survives Redis-state loss while keeping the Redis-Streams-based transport.

## Decision

Make **Postgres authoritative for dedup**, with Redis as a fast-path safety net:

1. Webhook arrives. Validate timestamp + signature first.
2. **Postgres dedup gate**: `INSERT ... ON CONFLICT DO NOTHING` on `webhook_deliveries (provider, connection_id, event_id)`. Returns whether the row was newly inserted.
3. **Redis inner gate** (`markProcessing`): fast-path safety net while Postgres row is in flight.
4. Publish to the Redis Stream.
5. On success: `UPDATE` the row to `status='published'`, `markDone` in Redis.
6. On publish failure: `DELETE` the row + `clearProcessing` in Redis, so the source's retry can re-enter the gate cleanly.

The `uq_webhook_deliveries_event_key` unique constraint on `(provider, connection_id, event_id)` is the durability primitive. Failed-validation webhooks (bad signature, stale timestamp) do NOT insert a row — they're logged-only — so the unique constraint never blocks a legitimate retry of a previously-rejected event.

## Alternatives considered

- **Redis-only with longer TTLs** — Rejected: longer TTLs delay the inevitable; durability gap remains. A Redis wipe (operations event, version upgrade, infra migration) reopens the replay window.
- **Postgres-only (no Redis fast path)** — Rejected: every webhook hits Postgres twice (insert + update), serializing through the row-level lock. Redis fast-path absorbs the high-concurrency case.
- **Use the Redis Stream's `XADD` MAXLEN to bound history + idempotency at consumer-group level** — Rejected: consumer-group dedup is brittle across consumer restarts and doesn't survive `XADD` MAXLEN truncation. Pushes correctness onto downstream consumers, where we want it at the ingestion gate.

## Consequences

**Pros:**
- Dedup survives Redis state loss; the durable record is the Postgres row.
- Failed-publish path explicitly deletes the row so retries work — no "stuck" rows blocking legitimate replays.
- Validation failures (bad signature, stale timestamp) are gated *before* the dedup write, so they don't pollute the dedup table.
- Replay-window timestamp validation is independently configurable (`OL_WEBHOOK_SKEW_WINDOW_MS`, default 120 s, clamped to `[1 s, 300 s]`).

**Cons / trade-offs:**
- Every webhook now hits Postgres on the happy path (one insert + one update). Higher baseline DB load than Redis-only.
- Two-gate dedup (Postgres outer + Redis inner) means careful failure-handling on both sides; the "what if Postgres succeeds but Redis fails" branch needed explicit logic.
- The `webhook_deliveries` table grows linearly with webhook volume; needs a periodic compaction policy (deferred — see #711 follow-up notes).

## Amendment (#2886) — the deferred compaction policy is now a real gap, and a delicate one

The Cons above defer a `webhook_deliveries` compaction policy to a "#711 follow-up" that was never
filed. #2886 re-checked it after the programme-wide persona change to ~1000 orders/day
(`product-spec-oms-wave3b-scan-pick-pack.md` § 1.1). Three things are now true.

**The table has no retention, and neither does anything else.** `DemoAccountCleanupService` is
still the only Postgres row-deletion retention anywhere in the tree. `webhook_deliveries` gains one
row per verified inbound delivery, so its growth tracks *event* volume rather than order volume —
at P-D that is plausibly several rows per order per connection, but **nobody has measured the
per-order event fan-out on a real install and this amendment will not invent one.**

**Compaction here is not ordinary retention, and that is why it deserves a design rather than a
sweep.** The row IS the replay guard: `uq_webhook_deliveries_event_key` is what makes a redelivered
event a no-op, and #2280 additionally made the row and its `sync_jobs` row commit together. Deleting
a delivery row **reopens the replay window for that event id**, permanently and silently, for any
source that redelivers outside the pruned horizon. Any policy therefore has to argue a horizon from
the sources' own redelivery behaviour, not from table size — the opposite of the argument a growth
problem invites.

**Status: needs measurement, then its own design — tracked as #2949.** The gap is filed so it is found deliberately;
this ADR's decision — Postgres as the authoritative dedup gate — is unchanged and unchallenged by
it.


## References

- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § Webhook Ingestion Flow.
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md) (the downstream SyncJob status model that consumes these events).
- Related PRs: #711 (the original implementation).
