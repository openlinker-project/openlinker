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
XTRIM events.inbound.webhooks       MAXLEN ~ 50000
XTRIM events.inbound.webhooks.dead  MAXLEN ~ 10000
XTRIM jobs.sync                     MINID  ~ <now_ms - 14 days>
XTRIM events.master.deletion.dead   MINID  ~ <now_ms - 30 days>
```

`events.master.deletion` was already bounded and needs nothing. Thresholds must
match `libs/shared/src/redis/stream-retention.ts`; treat that file as the source
of truth if these drift.

Check what you are dealing with first:

```
XLEN events.inbound.webhooks
MEMORY USAGE events.inbound.webhooks
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
| `events.inbound.webhooks` | 50 000 entries | 100–250 MB (payloads run 2–5 KB) |
| `events.inbound.webhooks.dead` | 10 000 entries | 20–50 MB (carries the original entry again) |
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

## Webhook-stream sunset (#2280)

`events.inbound.webhooks` no longer receives writes — routing runs at ingress
and no event is published. The always-on `webhook-handler` consumer loop is
retired; the only remaining reader is the one-shot `LegacyInboundWebhookDrain`,
which runs at every api boot and drains any pre-upgrade backlog (the group's
full PEL plus unread entries) into durable `sync_jobs` / `webhook_deliveries`
rows. Practical consequences:

- **Do not delete the stream or the `webhook-handler` group until at least one
  post-upgrade api boot has completed cleanly** (look for the
  `Legacy inbound-webhook drain: … routed, … deadlettered` log line, or the
  `nothing to drain` debug line). A transiently-failing entry is left un-ACKed
  and retried on the next boot.
- After a clean drain, `DEL events.inbound.webhooks` (which also removes the
  group) and `DEL events.inbound.webhooks.dead` are safe and reclaim their
  memory; the retention caps for both become irrelevant. A later release removes
  the drain and the stream names.
- If you skip the manual `DEL`, nothing breaks — the streams simply sit at
  whatever size the last trim left them, since a stream with no writes is never
  trimmed again (lazy trimming, above).

## Related

- [ADR-049](../architecture/adrs/049-durability-spine-and-domain-event-contract.md) — durability spine and the domain-event contract
- `libs/shared/src/redis/stream-retention.ts` — the bounds themselves, with per-stream rationale
- `docs/architecture-overview.md` § Data Flow — how retention fits the wider picture
