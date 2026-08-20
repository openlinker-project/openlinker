# Implementation Plan — Redis stream retention, PEL recovery, and ADR-049 (durability spine)

Covers #2163 (retention + memory policy + ghost stream), #2164 (consumer identity + PEL
recovery), #2165 (ADR-049 — durability spine and the domain-event contract).

Epic: #2162 (Wave 0 defects + Wave 1 decision).

---

## 1. Understand the task

**Goal.** Three related pieces of the async work layer:

1. **#2163** — every Redis stream the system writes is bounded, the bound lives in one place
   reachable from all write sites, the zero-consumer `events.sync.jobs` stream is resolved, and
   the Redis memory policy is a stated decision rather than an inherited default.
2. **#2164** — a worker killed between read and ACK must not lose its message. Requires stable
   consumer identity (precondition), startup drain of own pending history, and orphan reclaim.
3. **#2165** — ADR-049 settles how a domain fact gets from producer to consumer: the spine, whether
   a bus exists, the reader contract, event identity, publication API shape, PII posture, catalog
   enforcement, and the Valkey (#1396) interaction.

**Layer classification.**
- #2163: CORE infrastructure (`libs/core/src/{events,sync}`), `libs/shared/src/redis`, host apps, infra config.
- #2164: host apps only (`apps/api/src/webhooks`, `apps/worker/src/{events,sync}`) + a shared helper.
- #2165: documentation (`docs/architecture/adrs/049-*.md`) + `docs/lessons.md`.

**Non-goals (explicit).**
- No change to delivery semantics or the event contract *in code* — that is Wave 5, gated on this ADR.
- No collapsing of the three consumers into a transactional job write (Wave 5).
- No Valkey swap (that is PR #1396; this plan must merely stay compatible with it).
- No metrics/observability infrastructure.
- No `XDELEX` / `XACKDEL` / `KEEPREF`-`DELREF` trim modes — see the version-floor constraint below.

**Hard constraint discovered during research — the Redis version floor.**
Three environments must all work:

| Environment | Engine | Source |
|---|---|---|
| Dev stack | `redis:8.4-alpine` | `docker-compose.yml:55` |
| Integration tests | `redis:7-alpine` | `libs/test-kit/src/containers.ts:29` |
| Proposed (#1396, open draft) | `valkey/valkey:8-alpine` | PR #1396 |

The intersection is the **Redis 6.2 command floor**: `XAUTOCLAIM`, `XPENDING`, and plain
`MAXLEN ~` trimming. Redis 8.2's PEL-aware trim modes are unavailable on two of the three, so the
design uses the 6.2 floor throughout. This is exactly the fallback #2164 names.

---

## 2. Research findings (live repo, verified)

### 2.1 Every `xAdd` write site

| File:line | Stream | Bounded today? |
|---|---|---|
| `libs/core/src/events/infrastructure/adapters/redis-streams-event-publisher.ts:59` | dynamic arg | only if in `STREAM_MAXLEN` |
| `libs/core/src/sync/infrastructure/adapters/redis-streams-job-enqueue.service.ts:60` | `jobs.sync` | **no** |
| `apps/api/src/webhooks/application/handlers/webhook-to-job.handler.ts:492` | `events.inbound.webhooks.dead` | **no** |
| `apps/worker/src/events/master-deletion-to-job.handler.ts:259` | `events.master.deletion.dead` | **no** |
| `apps/api/src/health/dev-stack-health.service.ts:154` | `healthcheck` | **yes** — `MAXLEN ~ 1` |

`STREAM_MAXLEN` today contains exactly one key (`events.master.deletion: 10_000`). Its own comment
states the default: *"A stream with no entry here is left unbounded."*

**The health-check site is not a defect** — it is the existing, correct precedent for the
`node-redis` TRIM option shape this plan reuses:

```ts
{ TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: N } }
```

**Why extending the map cannot work.** Three of the five sites (`jobs.sync` and both DLQs) never
call `EventPublisherPort.publish`. The policy has to move up, not grow.

### 2.2 Stream names are not centralised

Two are exported constants (`MASTER_DELETION_EVENT_STREAM` in `products`,
`SYNC_JOBS_EVENT_STREAM` in `sync`); six are private literals, two of them duplicated across
lib and app (`jobs.sync`, `events.inbound.webhooks`).

### 2.3 Consumer identity and PEL

All three consumers are structurally identical: `xGroupCreate(stream, group, '$', {MKSTREAM:true})`
then `xReadGroup(group, consumer, [{key, id:'>'}], {BLOCK, COUNT})`.

| File | Consumer name |
|---|---|
| `apps/api/.../webhook-to-job.handler.ts:43` | `` `webhook-handler-${process.pid}` `` |
| `apps/worker/src/events/master-deletion-to-job.handler.ts:47` | `` `master-deletion-offer-pause-${process.pid}` `` |
| `apps/worker/src/sync/job-intake.consumer.ts:27` | `` `job-intake-${process.pid}` `` |

Repo-wide grep for `xClaim` / `xAutoClaim` / `xPending`: **zero source hits**. `id: '>'` returns
only never-delivered entries, so no code path reads a PEL. The misleading comment lives at
`job-intake.consumer.ts:305-307` (*"message will be re-delivered after timeout"*) — there is no
such timeout.

### 2.4 `events.sync.jobs` is write-only

`SyncJobBulkRetryService` (`libs/core/src/sync/application/services/sync-job-bulk-retry.service.ts:55`)
publishes `sync.job.bulk-retry-requested`. Its own type definition
(`sync-job.types.ts:301`) already concedes *"no consumer is attached yet (audit-trail /
observability only)"*. Every other hit is definition, barrel export, spec, or Swagger prose.

### 2.5 Where the policy belongs

`libs/shared/src/redis/` currently holds only `redis-config.module.ts` (the `@Global`
`REDIS_CLIENT` factory). Its header says it is *"shared between apps/api and apps/worker to avoid
cross-app dependencies"*. It is already an exported subpath (`@openlinker/shared/redis`) and is the
**only** module every one of the five write sites can reach without creating a new cross-context
core edge. That is the home.

---

## 3. Design

### 3.1 #2163 — retention policy as a shared, fail-safe module

New file `libs/shared/src/redis/stream-retention.ts`, exported from
`libs/shared/src/redis/index.ts`.

That barrel today exports only `RedisConfigModule`, which pulls `@nestjs/common` / `@nestjs/config` /
`redis`. Adding a constants module to it introduces **no new coupling** — the barrel is already
plugin-facing (`libs/plugin-sdk/src/rate-limit.module.ts:51`,
`libs/integrations/prestashop/src/prestashop-integration.module.ts:74`) and already Nest-coupled. The
new file is nonetheless written **dependency-free**, and its header says so, so it can be split to a
dedicated subpath later without any consumer change.

**The central inversion:** today an unlisted stream is *unbounded*; after this change an unlisted
stream gets a *conservative default bound*. The failure direction flips from "leak forever" to
"trim older entries than anyone should need". This is what makes the acceptance criterion
"a test asserts the trim option is passed for every stream, not only for a mapped one" satisfiable
— the resolver has no `undefined` branch.

```ts
export const REDIS_STREAM_NAMES = {
  inboundWebhooks:     'events.inbound.webhooks',
  inboundWebhooksDead: 'events.inbound.webhooks.dead',
  masterDeletion:      'events.master.deletion',
  masterDeletionDead:  'events.master.deletion.dead',
  jobsSync:            'jobs.sync',
  healthcheck:         'healthcheck',
} as const;

export type RedisStreamName = (typeof REDIS_STREAM_NAMES)[keyof typeof REDIS_STREAM_NAMES];

/** Approximate MAXLEN cap per stream. Exhaustive over RedisStreamName by type. */
const STREAM_MAXLEN: Record<RedisStreamName, number> = { /* see §3.2 */ };

export const DEFAULT_STREAM_MAXLEN = 10_000;

/** A stream is bounded by count (MAXLEN) or by age (MINID). See §3.2 for which and why. */
type StreamBound =
  | { kind: 'maxlen'; threshold: number; exact?: boolean }
  | { kind: 'minid'; maxAgeMs: number };

/** Never returns undefined — an unknown stream gets DEFAULT_STREAM_MAXLEN. */
export function resolveStreamMaxLen(streamName: string): number;

/** The node-redis TRIM options object; always defined. Time-dependent because
    MINID-bounded streams resolve their threshold from `now`. */
export function streamTrimOptions(streamName: string, now?: number): { TRIM: {...} };
```

`Record<RedisStreamName, number>` makes the map **exhaustive over the union** — a registered name
with no retention value fails `pnpm type-check`.

**That is a weaker claim than the first draft made (finding I4).** It says nothing about *call
sites*: `resolveStreamMaxLen(streamName: string)` must take a plain string, because
`EventPublisherPort.publish(streamName: string, …)` is dynamic. A sixth `xAdd` with a fresh literal
would compile clean and silently inherit the default — which is materially wrong for a DLQ or a job
stream. The honest guarantee is *"no stream is unbounded"*, **not** *"the gap cannot reopen"*.

To get the structural property for real, the module also exports the **single write seam**:

```ts
export async function xAddBounded(
  client: RedisStreamClient,          // structural, not RedisClientType — keeps the file dep-free
  streamName: RedisStreamName,        // ← union, so an unregistered literal is a call-site type error
  fields: Record<string, string>,
  now?: number                        // MINID bounds are time-relative; injectable for tests
): Promise<string | null>;
```

All five `xAdd` sites route through it, and a new `scripts/check-stream-writes.mjs` (added to
`check:invariants`, the established pattern — 20 such scripts already exist) fails the build on any
bare `.xAdd(` outside the wrapper. Together those make an unbounded stream unreachable rather than
merely unlikely.

`events.sync.jobs` is deliberately absent from the registry — it is being deleted (§3.3).

**Call-site wiring** (all five):
- `redis-streams-event-publisher.ts` — delete the local `STREAM_MAXLEN`, always spread `streamTrimOptions(streamName)`.
- `redis-streams-job-enqueue.service.ts` — pass `streamTrimOptions(REDIS_STREAM_NAMES.jobsSync)`.
- both DLQ `xAdd` calls — same.
- `dev-stack-health.service.ts` — leave the literal `1`; it is a liveness probe, not a retained stream. Registry entry documents it.

Stream-name literals in the consumers/publishers are repointed at `REDIS_STREAM_NAMES` so the
registry is the single source. `MASTER_DELETION_EVENT_STREAM` (a published contract constant in
`products`, referenced from docs) **stays where it is**; a spec asserts it equals
`REDIS_STREAM_NAMES.masterDeletion`, so drift is caught without inverting the dependency spine
(`events`/`products` must not import each other for this).

### 3.2 Retention values, with reasons

Revised after tech review (B1, I5, I7). Two streams move off `MAXLEN` entirely.

| Stream | Bound | Reason |
|---|---|---|
| `events.inbound.webhooks` | `MAXLEN ~ 50_000` | High volume, consumed within ms. Cap is a crash-backlog buffer. Has a durable Postgres counterpart (`webhook_deliveries`). |
| `events.master.deletion` | `MAXLEN ~ 10_000` | Unchanged from today. Authority is the persisted `isStale` flag, not the event. |
| `jobs.sync` | **`MINID ~ now − 14 d`** | **Not `MAXLEN` — see B1 below.** |
| `events.inbound.webhooks.dead` | `MAXLEN ~ 10_000`, env-overridable | Diagnostic, but the *fact* of dead-lettering is durable in `webhook_deliveries.status='deadlettered'`. Losing old payload detail is acceptable. |
| `events.master.deletion.dead` | **`MINID ~ now − 30 d`**, env-overridable | **Asymmetric with the other DLQ — see I5 below.** |
| `healthcheck` | **exact `MAXLEN 1`** | **Not `~` — see I7 below.** |
| *(unlisted)* | `MAXLEN ~ 10_000` | Fail-safe default. |

**B1 — why `jobs.sync` must not be `MAXLEN`-trimmed.** A job becomes durable only when
`job-intake.consumer.ts:247` writes its `sync_jobs` row; until then the stream entry *is* the job,
and the group is created at `'$'` so nothing replays. Worse, `RedisStreamsJobEnqueueService` sets
`jobdedup:{key}` with a **7-day TTL** *before* the `xAdd` (`:35-38`), so a trimmed-but-unconsumed
entry is both permanently lost **and** un-re-enqueueable for a week — every retry returns
`{isExisting: true}` and silently no-ops. Blast radius is verified to vary by job type: master-sync
keys embed the outer `job.id` (`master-inventory-sync-all.handler.ts:80`) so the next cron tick
self-heals, but webhook-derived keys are `{platformType}:{connectionId}:{sourceEventId}`
(`inbound-job-idempotency-key.ts:23`) — **stable, so an order is lost permanently** while
`webhook_deliveries` still reads `job_enqueued` (`webhook-to-job.handler.ts:369`). That is a second
instance of the exact defect #2164 exists to fix, introduced by the retention fix itself.

A **count** bound silently discards under precisely the load spike it was sized for. A **time**
bound is correlatable with an alertable condition ("intake down > N hours") and — critically — is
chosen at **14 days, longer than the 7-day dedup TTL**, so anything trimmed has already lost its
dedup key and *can* be re-enqueued. Trimmed therefore implies recoverable, which `MAXLEN` cannot
guarantee at any threshold.

**I5 — the two DLQs are not symmetric.** `events.inbound.webhooks.dead` has a Postgres counterpart.
`events.master.deletion.dead` has **none**: `master-deletion-to-job.handler.ts:259-268` writes the
stream entry and nothing else, inside a non-fatal `catch`. It is the *sole record* that a
master-deletion event was discarded. FIFO-drop is backwards on a diagnostic surface — in the
incident that matters (a bad deploy dead-lettering a whole wave) entries 1..N identify the trigger,
and `MAXLEN` discards exactly those. Age-bounding retains them. Both DLQ bounds are env-overridable
so an operator mid-incident can raise them without a deploy.

**I7 — `~` cannot trim below one macro node.** Approximate trimming operates on whole macro-nodes
(`stream-node-max-entries`, default 100), so **`MAXLEN ~ 1` really retains up to ~100 entries**. The
`healthcheck` stream therefore uses **exact** `MAXLEN 1`; it is written once per health poll, so
exact-trim cost is irrelevant. Every other cap is far above 100, where `~` overshoot is bounded by
roughly one node — negligible, and worth the radix-tree savings. A spec asserts every cap is
`> stream-node-max-entries` so this class of error cannot recur.

**Retention is enforced lazily, on write.** Trimming happens only during `XADD`. A stream that has
already grown past its new cap converges over many writes (Redis applies an implicit trim limit),
and a stream that has *stopped* receiving writes never converges at all. Deploying onto an existing
Redis therefore needs a one-time `XTRIM` — see §3.7.

### 3.3 `events.sync.jobs` — delete it

**Decision: remove, not consume.** Recorded in the PR body per the acceptance criterion.

Reasons: it has never had a consumer; its own type doc concedes it is speculative; the bulk retry it
announces already completed its work synchronously before publishing, so the event triggers nothing
and reports nothing not already in `sync_jobs`; and ADR-049 (§3.5) concludes these streams are
commands with zero fan-out. Keeping a write-only stream alive to satisfy a hypothetical consumer is
the shape that created this defect.

Removes: the `publish` call, the `EventPublisherPort` injection and `SCHEMA_VERSION` in
`SyncJobBulkRetryService`, the `SYNC_JOBS_EVENT_STREAM` constant + its barrel export, the interface
docstring claim, the spec case, and the Swagger sentence at `sync.controller.ts:228`.

**This removes a symbol from a published top-level barrel.** `SYNC_JOBS_EVENT_STREAM` is exported
from `@openlinker/core/sync` (`libs/core/src/sync/index.ts:65`) — the contract surface plugins
consume — so by the backward-compatibility rules this is a Critical-class change, not routine
cleanup. It is safe and deliberate: a pre-implement grep confirms **zero consumers outside
`libs/core/src/sync`** (only the service at `:20`, its spec at `:19`, and the definition itself). No
plugin, app, or sibling context imports it. Called out explicitly in the PR body so a reviewer weighs
it rather than skims it.

**Knock-on — the last `sync → events` runtime edge.** `SyncJobBulkRetryService` is the *only*
consumer of `EVENT_PUBLISHER_TOKEN` in the whole `libs/core/src/sync` context. Once its publish call
goes, `sync.module.ts:12,59` imports and registers `EventsModule` to satisfy an injection that no
longer exists. **That import is removed too** — a module import satisfying nothing is exactly the
stale edge this epic exists to clean up — and § Cross-context dependencies in the architecture
overview (including its mermaid map, which carries a `sync --> events` edge) is updated to match.

### 3.4 #2164 — consumer identity, drain, reclaim

Three thin helpers in `libs/shared/src/redis/stream-consumer.ts`, wired into all three consumers.
Deliberately **helpers, not a base class or a unified loop**: the three loops differ materially
(the webhook handler has a shutdown drain, job-intake dead-letters to a DB row rather than a
stream, batch sizes and ack semantics differ). Extracting only the three shared primitives fixes
the defect at single-source without a risky rewrite of three live consumers.

**(1) Stable identity.**
```ts
export function resolveConsumerName(prefix: string): string
// `${prefix}-${process.env.OL_WORKER_ID?.trim() || os.hostname()}`
```
Stable across restarts of the same logical worker; distinct across replicas (container hostnames are
unique per pod and stable for its life). `OL_WORKER_ID` is the explicit override for deployments
where hostname is neither. Replaces all three `process.pid` expressions.

**(2) Startup drain of own history.** Before entering the `'>'` loop, read with `id: '0'`
repeatedly until the reply is empty, handling each entry through the same per-message path. This is
the documented Redis restart pattern and makes recovery immediate rather than deferred.

**(3) Orphan reclaim.** A periodic `xAutoClaim(stream, group, consumerName, minIdleMs, cursor)`
sweep that claims entries idle beyond a threshold, then processes them. `minIdleMs` **must exceed
p99 handler duration** or live work is stolen and double-run. No measurement exists (#1134 is not
built), so it is set **defensible-by-construction** rather than guessed: ≥ 10× the longest handler
timeout and never below a few minutes, as a named constant carrying that rationale plus an env
override. Every reclaim logs at `warn` with the observed idle time, so the first production reclaim
reveals whether the threshold is sane (finding S11).

**(4) The comment.** `job-intake.consumer.ts:305-307` is corrected in the same change — it currently
asserts a guarantee the system does not have, which is precisely why this went unnoticed.

**(5) `TRIMMED` nil-body handling — required, not optional (finding B2).** Once any consumed stream
is trimmed, an entry can remain in the PEL while its data is gone. Redis then returns the id with a
**nil field-value array** from `XREADGROUP ... ID 0`, and `XAUTOCLAIM` silently drops such entries
(7.0+ reports them in a third `deleted_ids` reply element; 6.2 does not — a genuine divergence
across the `redis:7` / `redis:8.4` / `valkey:8` matrix, so the code must not depend on that element).

Feeding a nil body into the existing per-message path is actively harmful: `parseJobRequest`
(`job-intake.consumer.ts:316-326`) throws `Missing required fields`, which routes to `:270-301` and
**persists a bogus dead `sync_jobs` row** keyed `invalid-{messageId}` with a placeholder `jobType`;
the webhook handler would write a spurious DLQ entry and a `deadlettered` delivery row.

So the shared helper detects a nil body explicitly, classifies it `TRIMMED`, logs at `warn` with
stream/group/id, `XACK`s to clean the PEL, and **never** routes it into the handler's error path.
This ships in PR 1 — *before* the retention change that makes the state reachable.

**(6) Guard `markDead` on an actual insert (finding S12).** `persistDeadJob`
(`job-intake.consumer.ts:359-377`) calls `markDead(deadJob.id)` unconditionally after an idempotent
create. Drain and reclaim make redelivery real, so a redelivered message whose job has since
succeeded would flip a live `sync_jobs` row to `dead`. Guard the `markDead` on the create having
actually inserted.

**Idempotency note.** Drain and reclaim both mean a message can now be processed more than once.
This is safe on all three paths: the webhook path enqueues under a Postgres-authoritative
idempotency key (ADR-005), job-intake calls `createIfNotExistsByIdempotencyKey`, and the
master-deletion path re-verifies `isStale` before acting (#1689). Re-delivery was always the
*intended* model — it simply never happened. A spec pins each.

### 3.5 #2165 — ADR-049

`docs/architecture/adrs/049-durability-spine-and-domain-event-contract.md`.

**Number**: 049, per the epic's reallocation comment (`046` → #2203, `047` → #2213 merged). The
reserved-numbers note is being rewritten on the #2166 branch, which lands first — so this branch
adds **only its own index row** and does not touch that note, avoiding a four-way conflict.

Decisions the ADR must land (mapping to the issue's eight):

1. **Spine** — work row written in the same transaction as the business change.
2. **Bus** — build the *contract*, keep one transport implementation; do not build a general bus at
   zero fan-out. **Decided at the plan gate.** The contract is cheap now and expensive to retrofit
   once producers have shipped against its absence; the transport is the opposite. Consistent with
   the epic's framing that most of these ADRs are a decision *not* to build. Reversal gate must be
   observable: a named condition on a second independent consumer of any one stream.
3. **Reader contract** — if a bus: composite cursor + visibility barrier, never scalar `id > cursor`.
4. **Event identity** — `eventId` derived from the business fact, not minted at insert.
5. **Publication API** — no `EntityManager` in a core port signature; composition in the repository
   performing the write, or behind an opaque handle owned by `events`.
6. **PII** — stated posture, not left to convention (`OL_STORE_PII` does not cover a retained log).
7. **Catalog** — registration-time validation (the `AdapterRegistryService` shape), not a central
   type union that would invert the spine.
8. **#1396 / Valkey** — stated explicitly, and it strengthens the Postgres-as-transport case.
9. **Redis persistence posture (added per finding S9)** — an ADR titled *durability spine* that
   specifies retention and eviction but not **persistence** is incomplete. `docker-compose.yml:60-61`
   mounts `redis-data:/data` but declares no `appendonly` / `save` policy, so the default RDB
   snapshotting applies: an unclean stop can lose the last snapshot interval of stream entries **and
   all consumer-group state and PELs**. The ADR must answer the question that follows directly:
   *does Redis ever hold the sole record of a fact?* Today it does, in at least three places —
   `jobdedup:*`, the master-deletion DLQ (§3.2, I5), and every un-ACKed PEL entry. This is a further
   argument for decision 1's same-transaction spine.

Links in the ADR use bare `#NNN` and relative paths — never full GitHub URLs, which
`scripts/check-repo-urls.mjs` rejects at lint time.

Each decision carries an **observable** reversal gate (a measurable condition), not an argued one.
Alternatives that must appear with reasons: broker as system of record; general transactional outbox
with a relay; durable-execution engine (Temporal fails the docker-compose distribution constraint,
DBOS named as the library-in-Postgres alternative); CloudEvents; event-carried state transfer.

Plus `docs/lessons.md` entry for the commit-order gap (id assignment precedes commit, so id order ≠
visibility order) — per the epic acceptance criteria, and it is decision 3's underlying fact.

### 3.6 Redis memory policy — must set `maxmemory`, not just the policy (finding B3)

The first draft set only `--maxmemory-policy noeviction`. **That is inert.** Verified: the `redis`
service (`docker-compose.yml:50-65`) declares no `command:`, no config file, and no `maxmemory`, so
Redis runs `maxmemory 0` (unlimited). With no cap there is no eviction cycle, and
`maxmemory-policy` is never consulted — the flag would change nothing at runtime while creating the
impression the decision had been implemented.

It also would not deliver the back-pressure the draft claimed. Under `maxmemory 0`, Redis grows
until the **OS OOM-killer** takes the container — losing the entire dataset including every consumer
group and PEL. That is strictly worse than the eviction being defended against.

So compose sets **both**:

```yaml
command:
  - redis-server
  - --maxmemory
  - ${REDIS_MAXMEMORY:-512mb}
  - --maxmemory-policy
  - noeviction
```

**Why `noeviction`:** under any `allkeys-*` policy Redis can evict a *whole stream key* — taking its
consumer groups and PELs with it — and **no consumer receives an error**. Silent total loss.
`noeviction` fails writes instead: the correct direction for a queue, and a condition the enqueue
path already handles (`redis-streams-job-enqueue.service.ts:61-67` deletes the dedup key when
`xAdd` throws, so a failed write stays retryable).

**Sizing basis**, stated because a number without one is a guess: dominated by `jobs.sync`. At the
14-day MINID bound with a conservative ~1 KB/entry, 512 MB covers a backlog far beyond any observed
tick. Env-overridable so an operator can raise it; the ADR records that the value is revisable and
that the *policy* choice, not the number, is the durable decision.

### 3.7 Deploying onto an existing Redis (finding I8)

Two one-time operator actions, because code changes do not reach data already in Redis:

1. **`DEL events.sync.jobs`.** Removing every producer (§3.3) does not remove the key. An existing
   install has whatever accumulated while it was unbounded, and after this change **no code path
   will ever trim it** — so #2163's memory goal is not met on any existing deployment without this.
   It is literally the "ghost stream" the issue is named for.
2. **One-time `XTRIM` per bounded stream.** Retention applies lazily on `XADD` (§3.2), so a stream
   already past its new cap converges only over many writes, and an idle stream never converges.

Both go in the PR body and the release notes rather than a startup migration: they are destructive,
one-shot, and an operator should run them knowingly.

---

## 4. Step-by-step plan

### PR 1 — recovery (#2164) + ADR-049 (#2165). Lands first.

| # | File | Change |
|---|---|---|
| 1 | `libs/shared/src/redis/stream-consumer.ts` (new) | `resolveConsumerName`, drain helper, reclaim helper, nil-body `TRIMMED` classifier. Dependency-free. |
| 2 | `libs/shared/src/redis/index.ts` | Export the above |
| 3 | `apps/api/.../webhook-to-job.handler.ts` | Stable identity; startup drain; periodic reclaim; `TRIMMED` handling |
| 4 | `apps/worker/src/events/master-deletion-to-job.handler.ts` | Same |
| 5 | `apps/worker/src/sync/job-intake.consumer.ts` | Same, **plus** correct the misleading redelivery comment (`:305-307`) and guard `markDead` on an actual insert (S12) |
| 6 | `docs/architecture/adrs/049-durability-spine-and-domain-event-contract.md` (new) | ADR-049 — nine decisions, observable gates, rejected alternatives |
| 7 | `docs/architecture/adrs/README.md` | Own index row only |
| 8 | `docs/lessons.md` | Commit-order gap (id assignment precedes commit ⇒ id order ≠ visibility order) |
| 9 | `docs/architecture-overview.md` | § Data Flow: recovery model |
| 10 | Tests | §5, PR 1 block |

### PR 2 — retention (#2163). Branched on PR 1.

| # | File | Change |
|---|---|---|
| 11 | `libs/shared/src/redis/stream-retention.ts` (new) | Name registry, `StreamBound` union, exhaustive map, `resolveStreamBound`, `streamTrimOptions(name, now)`, **`xAddBounded`** |
| 12 | `libs/shared/src/redis/index.ts` | Export the above |
| 13 | `scripts/check-stream-writes.mjs` (new) + `package.json` | Ban bare `.xAdd(` outside the wrapper; wire into `check:invariants` (I4) |
| 14 | `.../redis-streams-event-publisher.ts` | Drop the local map; route through `xAddBounded` |
| 15 | `.../redis-streams-job-enqueue.service.ts` | Route through `xAddBounded` (`jobs.sync` ⇒ MINID) |
| 16 | `webhook-to-job.handler.ts` / `master-deletion-to-job.handler.ts` | DLQ writes through `xAddBounded` |
| 17 | `dev-stack-health.service.ts` | Exact `MAXLEN 1` via the wrapper (I7) |
| 18 | `sync-job-bulk-retry.service.ts` + types + barrel + spec + `sync.controller.ts:228` | Delete `events.sync.jobs` end to end, incl. the `EventPublisherPort` injection |
| 19 | `libs/core/src/sync/sync.module.ts` | Drop the now-dead `EventsModule` import + registration |
| 20 | `docker-compose.yml` | `--maxmemory` **and** `--maxmemory-policy noeviction` (B3) |
| 21 | `docs/architecture-overview.md` | § Cross-context dependencies: drop the `sync --> events` mermaid edge; § Data Flow: retention |
| 22 | PR body / release notes | One-time `DEL events.sync.jobs` + `XTRIM` operator steps (I8) |
| 23 | Tests | §5, PR 2 block |

---

## 4b. Tech-review findings log

Deep review run against the plan before any code. All findings applied.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| B1 | BLOCKING | `MAXLEN`-trimming `jobs.sync` is permanent job loss + 7-day retry poison | §3.2 — `MINID` at 14 d, longer than the dedup TTL, so trimmed ⇒ recoverable |
| B2 | BLOCKING | Trimmed PEL entries return nil bodies; PR 2's drain would feed them into handler error paths, writing bogus dead rows / DLQ entries | §3.4(5) — explicit `TRIMMED` class, shipped in PR 1 *before* trimming exists |
| B3 | BLOCKING | `maxmemory-policy` is inert without `maxmemory`; unbounded growth ends in OOM-kill, not back-pressure | §3.6 — set both, with a stated sizing basis |
| I4 | IMPORTANT | "Compile-time exhaustive" overstated — resolver takes `string` | §3.1 — `xAddBounded` typed on the union + `check-stream-writes.mjs` |
| I5 | IMPORTANT | The master-deletion DLQ has no Postgres counterpart; `MAXLEN` discards the most diagnostic entries | §3.2 — `MINID` 30 d, env-overridable |
| I6 | IMPORTANT | PR order backwards — retention creates the loss surface | §7.1 — order reversed |
| I7 | IMPORTANT | `~` cannot trim below one macro node, so `~1` retains ~100 | §3.2 — exact `MAXLEN 1` for `healthcheck`; spec asserts caps > 100 |
| I8 | IMPORTANT | Deleting producers does not delete the `events.sync.jobs` key | §3.7 — operator steps |
| S9 | SUGGESTION | ADR omits Redis persistence posture | §3.5 — added as decision 9 |
| S10 | SUGGESTION | Tests assert the option object, not behaviour | §5 — real-Redis integration assertions |
| S11 | SUGGESTION | `minIdleMs` understated | §3.4 — defensible-by-construction + `warn` logging |
| S12 | SUGGESTION | `persistDeadJob` calls `markDead` unconditionally | §3.4(6) — guard on actual insert |

---

## 5. Testing strategy

Revised per finding S10: the first draft asserted only that a `TRIM` **option object** was passed.
Every one of those tests can pass while trimming does nothing — wrong strategy name, wrong casing,
node-redis option-shape drift, a zero threshold. Behaviour must be asserted against real Redis.

**PR 1 — recovery (#2164) + ADR (#2165)**

*Unit*
- `stream-consumer.spec.ts` — `resolveConsumerName` honours `OL_WORKER_ID`, falls back to hostname,
  contains no pid, and is identical across two calls.
- Nil-body classification returns `TRIMMED` and never reaches the handler error path (B2).
- `persistDeadJob` does not `markDead` when the create was a no-op (S12).

*Integration (Testcontainers, real Redis)*
- **Crash-then-restart**: publish → read without ACK → simulate death → a new instance with the
  **same identity** starts → the entry is processed, not stranded. This is #2164's named criterion.
- **Orphan reclaim**: an entry pending under a different, dead consumer is claimed after the idle
  threshold.
- **Trimmed-PEL drain** (B2): `xAdd` → read without ack → `XTRIM MAXLEN 0` → drain returns a nil
  body → asserted `TRIMMED`, ACKed, **no** bogus dead `sync_jobs` row and **no** DLQ write.
- Existing webhook-ingestion and job-intake int-specs still pass (consumer-name change touches them).

**PR 2 — retention (#2163)**

*Unit*
- Every registered stream resolves a bound; an **unregistered** name resolves the default (the
  "every stream, not only a mapped one" criterion).
- Every `MAXLEN` cap is `> 0` **and** `> stream-node-max-entries` (100) — this is the assertion that
  would have caught I7.
- `jobs.sync` and `events.master.deletion.dead` resolve **`MINID`**, not `MAXLEN` (B1, I5).
- `healthcheck` resolves **exact** `MAXLEN 1`, not `~` (I7).
- MINID thresholds are computed from the injected `now`, and `jobs.sync`'s horizon is **longer than
  the 7-day dedup TTL** — the property B1's safety rests on.
- Drift spec: `MASTER_DELETION_EVENT_STREAM === REDIS_STREAM_NAMES.masterDeletion`.
- `sync-job-bulk-retry.service.spec.ts` — assert **no** publish occurs.

*Integration (Testcontainers, real Redis — behaviour, not options)*
- Publish `cap + 5_000` entries to a low-cap stream; assert `XLEN` lands inside the expected `~`
  overshoot band. Proves Redis actually bounds it.
- Same for an **unregistered** stream name, proving the default applies at the Redis level.
- A `MINID`-bounded stream retains an entry inside the horizon and drops one outside it.

*Invariant*
- `scripts/check-stream-writes.mjs` self-check plus a fixture proving a bare `.xAdd(` outside
  `xAddBounded` fails the build (I4).

## 6. Validation

- **Architecture.** `libs/shared` has no core/plugin dependencies; adding a pure constants + pure
  functions module to it introduces no edge. No CORE ↔ Integration boundary is crossed. No new
  cross-context core edge (this is why `libs/shared/src/redis` beat `libs/core/src/events`).
- **Naming.** `*.types.ts` conventions; `as const` + derived union per the standards' union-type rule;
  `UPPER_SNAKE_CASE` constants.
- **No `any`, no `console.log`, no secrets.** Uses the shared `Logger`.
- **Migrations.** None — no ORM entity changes.
- **Security.** `resolveConsumerName` reads `os.hostname()` and an env var; neither is user input and
  neither is logged as a secret. No payload content changes.

---

## 7. Risks and open questions

1. **Scope — RESOLVED: two PRs.** Decided at the plan gate.
   **Order REVERSED after tech review (finding I6).** The first split put retention first on the
   grounds that it is "additive, low blast radius". That reasoning was wrong: retention is the PR
   that *creates* a loss surface (B1) and makes the trimmed-PEL `null`-body path reachable (B2),
   while recovery is strictly durability-improving and safe standalone. Shipping retention first
   leaves an interval in which the system is measurably **less durable than today**.

   - **PR 1 — #2164 + #2165**: consumer identity, startup drain, orphan reclaim, `TRIMMED` nil-body
     handling, the corrected comment, the crash-then-restart integration test, and ADR-049. Nothing
     here can lose a message; every part can only recover one.
   - **PR 2 — #2163**: the retention registry, the `xAddBounded` wrapper + its invariant script, all
     write-site wirings, the `events.sync.jobs` deletion, and the compose memory settings. Lands
     only once recovery is in place to absorb it.
   §4 marks each step **[PR1]** or **[PR2]**; §5 splits accordingly.
2. **Behaviour change from drain/reclaim.** Messages that are currently silently dropped will start
   being processed. This is the fix, but it means a backlog of long-stranded PEL entries gets drained
   on first deploy. §3.4's idempotency analysis says that is safe on all three paths; the integration
   tests pin it. Worth stating in the PR body so it is not a surprise in staging.
3. **`minIdleMs` is a guess.** #1134 (k6 harness) does not exist, so p99 handler duration is not
   measured. Chosen conservatively high and made env-overridable; the ADR notes it as an
   observability-dependent value.
4. **ADR number.** Depends on the #2166 branch landing the reservation note first. Mitigated by
   adding only our own row.
