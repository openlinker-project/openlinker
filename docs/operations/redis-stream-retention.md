# Redis stream retention — upgrade and operations

Covers the one-time steps required when upgrading a stack that ran **before**
stream retention existed (#2163), and the ongoing operational facts worth
knowing.

## Why an upgrade step exists at all

`XACK` removes an entry from a consumer group's Pending Entries List, **not from
the stream**. Before #2163 only one of seven streams carried a retention bound,
so on any stack that has been running a while the others hold every entry they
ever received.

Two properties of the fix make that history a problem rather than a detail:

1. **Retention is applied lazily, on write.** Redis trims as part of `XADD`; it
   never runs a background sweep. A stream that has stopped receiving writes
   never converges, and one far above its new cap converges only gradually.
2. **`maxmemory` is now set, with `maxmemory-policy noeviction`.**

Together those create a state a stack cannot leave on its own: if Redis boots
with more data than `maxmemory` allows, every `denyoom` command — `XADD`, `SET`,
and so the job queue, the `jobdedup:*` gate, sync locks and the cache — fails
with `OOM command not allowed`. The write that *would* trim the stream is the
write being refused.

`XTRIM` is **not** a `denyoom` command. It is the way out, and it is why the
cleanup below must run before or immediately after the first boot on the new
compose file.

## One-time cleanup

Run against the stack's Redis (`docker compose exec redis redis-cli`, or
`valkey-cli` after #1396).

### 1. Delete the ghost stream

```
DEL events.sync.jobs
```

`events.sync.jobs` had a publisher and, in its entire life, no consumer. #2163
removed the producer, but **removing the producer does not remove the key**, and
no code path will ever trim it again. Without this, the memory the issue was
filed about is still held.

### 2. Trim the streams that grew unbounded

```
XTRIM jobs.sync                     MINID  ~ <now_ms - 14 days>
XTRIM events.master.deletion.dead   MINID  ~ <now_ms - 30 days>
```

`events.master.deletion` was already bounded and needs nothing. Thresholds must
match `libs/shared/src/redis/stream-retention.ts`; treat that file as the source
of truth if these drift.

### 2b. Delete the retired webhook streams

```
DEL events.inbound.webhooks
DEL events.inbound.webhooks.dead
```

These are **deleted, not trimmed** (#2300). #2280 moved webhook routing to
ingress, retiring the only writer, and #2300 removed the one-shot drain that was
their last reader — so neither stream can receive another entry and neither
appears in `stream-retention.ts` any more. Trimming them to a cap would leave a
permanently frozen residue; a `DEL` reclaims all of it.

A long-lived stack may still hold real entries here, which is why this is a step
rather than a note. See *Webhook-stream sunset* below for the one precondition.

Check what you are dealing with first:

```
XLEN jobs.sync
MEMORY USAGE jobs.sync
INFO memory
```

### 3. Confirm

```
CONFIG GET maxmemory
CONFIG GET maxmemory-policy
INFO memory      # used_memory_human should sit well under maxmemory
```

## Why `noeviction`

Under any `allkeys-*` policy Redis can evict a **whole stream key** — taking its
consumer groups and Pending Entries Lists with it — and **no consumer receives an
error**. That is silent, total, undetectable loss.

`noeviction` fails the write instead. For a queue that is the correct direction:
back-pressure over data loss, and a failed `XADD` is already treated as retryable
by the enqueue path (`RedisStreamsJobEnqueueService` deletes its dedup key so the
attempt can be repeated).

The cost is the boot hazard described above, which is why it comes with an
operator step rather than being left implicit.

## Sizing `REDIS_MAXMEMORY`

Default: `2gb` (override in `.env`).

The default is a **floor with headroom, not a measured value**. It cannot be
derived from the caps table, because the largest stream is bounded by age rather
than by count:

| Stream | Bound | Rough worst case |
|---|---|---|
| `jobs.sync` | 14 days | **unbounded by count** — ~700k entries (~350 MB) at 50k jobs/day |
| `events.master.deletion` | 10 000 entries | ~5 MB |
| `events.master.deletion.dead` | 30 days | small, but unbounded by count |
| `healthcheck` | 1 entry (exact) | negligible |

That `jobs.sync` has no count ceiling is the deliberate cost of choosing an age
bound — see the module comment for why a count bound is unsafe there. **Raise
`REDIS_MAXMEMORY` before widening any `maxAgeMs`.**

## Operational facts worth knowing

**Approximate (`~`) trimming cannot go below one macro node.** Redis trims whole
nodes (`stream-node-max-entries`, default 100), so `MAXLEN ~ 1` really retains
about 100 entries. Only the `healthcheck` stream needs exact trimming; every
other cap is far above one node, where the overshoot is negligible and the radix
tree walk is worth avoiding.

**A trimmed `jobs.sync` entry is un-blocked, not recovered.** The 14-day horizon
is deliberately longer than the 7-day `jobdedup:*` TTL, so a trimmed entry's
dedup key has certainly expired and a re-enqueue will no longer no-op with
`{isExisting: true}`. That removes the *silent* failure mode — it does **not**
mean anything re-enqueues the job automatically. Nothing in the system does:

- The `jobs.sync` consumer's recovery is PEL-based, and a trimmed-but-never-
  delivered entry was never in a PEL.
- A source redelivering the same webhook is stopped at the durable Postgres dedup
  gate (`webhook_deliveries`), which outlives every TTL here.

So recovery is **operator-driven**. For a webhook-derived job, that means
deleting the corresponding `webhook_deliveries` row before the source's
redelivery can get through. `GET /sync/jobs/lookup?platformType&connectionId&eventId`
returning 404 for a delivery whose row reads `job_enqueued` is how you find one.

**Since #2280 this gap is closed for the webhook path**: a webhook-derived job
commits straight to `sync_jobs` in the same transaction as its
`webhook_deliveries` row (ADR-049 decision 1) and never transits `jobs.sync` or
`jobdedup:*`. The recovery recipe above still applies to any pre-upgrade loss,
and the trim-vs-TTL reasoning still governs the stream's remaining non-webhook
writers (scheduler, cron sweeps, API-triggered enqueues).

## Poison entries — the `stream_dead_letters` table (#2301)

A **poison entry** is a stream entry whose handler keeps throwing, so it stays
in the consumer group's Pending Entries List and every recovery pass retries it.
Before #2301 that retry never ended, and the only trace was one log line from a
counter that reset on every worker restart. It now has a **terminal, queryable
home in Postgres**.

**What happens.** The two consumers that still own a PEL — `job-intake` (stream
`jobs.sync`) and `master-deletion-offer-pause` (stream `events.master.deletion`)
— count failed recovery attempts per entry in Redis
(`poison:{stream}:{group}:{entryId}`, a 7-day sliding TTL, so a restart no
longer resets the count). When an entry reaches `MAX_RECOVERY_ATTEMPTS` (10):

1. the worker logs `Stream entry <id> has now failed recovery 10 times (…);
   writing it to stream_dead_letters and acking it`;
2. it writes one `stream_dead_letters` row with the entry's **raw stream fields**,
   exactly as Redis returned them, plus the attempt count and the last error;
3. **only then** it `XACK`s the entry.

A failed write leaves the entry pending, and the next recovery pass tries again.
A crash between the write and the `XACK` redelivers the entry, and the row is
re-written in place (one row per `(stream, consumer_group, entry_id)`;
`first_seen_at` keeps the first sighting, `attempts` / `last_error` /
`last_seen_at` track the latest). Recovery passes run at most every 5 minutes
per worker, so an entry is dead-lettered after at least ~50 minutes of
continuous failure. A transient fault (a database blip, a marketplace timeout)
normally clears well before then.

**What it is not.** A *malformed* master-deletion event, one that cannot be
parsed at all, does **not** land here. It is moved to the
`events.master.deletion.dead` Redis stream on its first read (see the sizing
table above), and that stream remains its only record. A *trimmed* entry,
whose body retention removed before it was processed, is acked and logged
(`Discarding trimmed stream entry …`), not recorded. If one does reach the
table, its `raw_fields` is `{}`.

### Finding them

- **UI:** *Diagnostics > Jobs & Logs*, section **Poison stream entries**. The
  heading shows the total. The list is read-only (most recently seen first,
  with stream, consumer group, entry id, attempts and last error), and there is
  no replay action yet.
- **API:** `GET /sync/stream-dead-letters?stream=jobs.sync&limit=20&offset=0`
  and `GET /sync/stream-dead-letters/count?stream=…` (admin, operator, viewer).
  The list returns `rawFields` as stored.
- **SQL:**

  ```sql
  SELECT stream, consumer_group, entry_id, attempts, last_error,
         first_seen_at, last_seen_at, raw_fields
  FROM stream_dead_letters
  ORDER BY last_seen_at DESC;
  ```

### Using them during recovery

A row means the entry has been **acked**: Redis will not redeliver it, and
nothing replays it automatically. The row is the record of work that did not
happen. Recovery is operator-driven:

1. **Fix the cause first.** `last_error` is the error from the latest attempt.
   Ten identical errors over ~50 minutes point to a deterministic fault (a bad
   payload or a handler bug), not to a flaky dependency.
2. **`jobs.sync` rows** (`consumer_group = 'job-intake'`): the entry *was* the
   job, and normally no `sync_jobs` row exists for it. `raw_fields` carries
   `jobType`, `connectionId`, `payloadJson` and `idempotencyKey`. Look the key
   up in `sync_jobs` first, since the insert is idempotent on it, and a row
   there means the job did land and only the `XACK` kept failing. Otherwise,
   re-trigger the work through the normal path. A re-enqueue that carries the **same**
   `idempotencyKey` no-ops with `{isExisting: true}` while
   `jobdedup:<idempotencyKey>` is alive (7 days), so `DEL` that key first.
   Recurring jobs whose key changes per tick need nothing: the next tick
   enqueues a fresh job.
3. **`events.master.deletion` rows** (`consumer_group =
   'master-deletion-offer-pause'`): `raw_fields` is the event envelope, and
   `payloadJson` names the deleted master product (`internalProductId`,
   `variantIds`) whose marketplace offers were due to be paused. Those offers
   were **not** paused. Check them on the marketplace and pause any that are
   still live.
4. **Housekeeping.** Nothing else reads this table and it has no foreign keys,
   so deleting a row you have dealt with is safe. Nothing prunes it on its own.
   That is deliberate, and the reasoning is on
   `StreamDeadLetterRepositoryPort`.

## Webhook-stream sunset — completed (#2280, #2300)

`events.inbound.webhooks` and `events.inbound.webhooks.dead` are **retired**.
#2280 moved routing to ingress, so nothing publishes to either; #2300 deleted
`LegacyInboundWebhookDrain`, their last reader, and removed both names from
`libs/shared/src/redis/stream-retention.ts`. Neither stream has a writer, a
reader or a declared retention bound any more.

**The version floor.** The drain shipped in **v0.8.0** and ran at every api boot
through v0.10.0. An operator upgrading to the release carrying #2300 must have
**booted v0.8.0, v0.9.0 or v0.10.0 at least once** — that boot is what drained
any pre-#2280 backlog into durable `sync_jobs` / `webhook_deliveries` rows.
Upgrading straight from **v0.7.0 or earlier** skips every release that carried
the drain and can strand that backlog: those webhooks were recorded `published`
with no job, so the source's redelivery bounces off the Postgres gate without
creating one. If you are on v0.7.0 or earlier, boot any of v0.8.0–v0.10.0 once
and confirm the `Legacy inbound-webhook drain: … routed, … deadlettered` log
line (or the `nothing to drain` debug line) before upgrading further.

Practical consequences:

- `DEL events.inbound.webhooks` (which also removes the `webhook-handler`
  consumer group) and `DEL events.inbound.webhooks.dead` are safe once that
  boot has happened, and reclaim all their memory — see § 2b above.
- If you skip the `DEL`, nothing breaks — the streams simply sit at whatever
  size the last trim left them, since a stream with no writes is never trimmed
  again (lazy trimming, above). They are inert, not dangerous.

## Related

- [ADR-049](../architecture/adrs/049-durability-spine-and-domain-event-contract.md) — durability spine and the domain-event contract
- `libs/shared/src/redis/stream-retention.ts` — the bounds themselves, with per-stream rationale
- `docs/architecture-overview.md` § Data Flow — how retention fits the wider picture
