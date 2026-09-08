# Implementation Plan — #2300 Remove `LegacyInboundWebhookDrain` and the `events.inbound.webhooks` stream

**Issue**: [#2300](https://github.com/openlinker-project/openlinker/issues/2300) — `[TECH-DEBT] API — remove LegacyInboundWebhookDrain and the events.inbound.webhooks stream it drains`
**Branch**: `2300-remove-legacy-inbound-webhook-drain`
**Type**: Deletion / tech-debt. **No new abstraction, no new test, no migration.**

---

## 1. Understand the task

### Goal

Delete the one-shot upgrade-migration artifact shipped with #2280 (ADR-049 decision 1), and with it
the two Redis stream names that now have neither a writer nor a reader anywhere in the tree.

### Layer classification

| Layer | Files |
|---|---|
| **Interface** (api webhooks) | the drain, its spec, its types file, the module registration |
| **Shared** (redis stream registry) | `REDIS_STREAM_NAMES` / `STREAM_BOUNDS` entries |
| **DX** (invariant guards) | two stale `check-cross-context-imports.mjs` ALLOW_LIST rows |
| **Docs** | ops runbook, ADR-049, architecture overview, webhook docs |

### Explicit non-goals

- **Do not touch `libs/shared/src/redis/stream-consumer.ts`.** Its primitives (`toPendingRows`,
  `ackTrimmed`, `resolveConsumerName`) stay — verified below. #2301 is being worked concurrently on
  `apps/worker/src/sync/job-intake.consumer.ts` and
  `apps/worker/src/events/master-deletion-to-job.handler.ts`; **neither file is touched here.**
- No new service seam to replace the drain's `WebhookDeliveryRepositoryPort` coupling — the coupling
  disappears with the file.
- No Redis-side data deletion. The operator note stays advisory (`DEL` is safe, not required).
- No rework of the live ingress path. It is already stream-free since #2280.
- **`CHANGELOG.md:93` is NOT edited.** It carries the released v0.8.0-era `XTRIM events.inbound.webhooks …`
  upgrade instructions. A released changelog is a historical record of what an operator was told at the
  time; rewriting it would falsify that record.
- **`docs/architecture/adrs/051-worker-topology-one-artifact-roles.md:15` is NOT edited.** It names the
  stream in past-tense framing of the consumer #2280 retired — still true.
- **`redis-streams-event-publisher.spec.ts:67` keeps its comment** (*"… became unbounded"*): past tense,
  factually true, compile-safe.

---

## 2. Research — what the repo actually says

### 2.1 Release floor (AC: "PR description names the minimum version")

`#2280` shipped as PR **#2295**, commit `25111eb9`, first tagged **`v0.8.0`** (2026-08-24).

```
$ git tag --contains 25111eb93 --sort=v:refname
v0.8.0
v0.9.0
v0.10.0
```

Current release is **v0.10.0** (2026-09-07). The drain has therefore been present in **three**
shipped releases, satisfying the issue's *"must survive at least one full upgrade cycle"* condition
with two releases to spare.

**Minimum version floor to state in the PR description:** an operator upgrading to the release that
carries this removal (the next minor, v0.11.0) must have **booted v0.8.0, v0.9.0 or v0.10.0 at least
once**. An upgrade straight from **v0.7.0 or earlier** skips every release that carried the drain and
can strand a pre-#2280 `events.inbound.webhooks` backlog. Remedy for such an operator: boot any of
v0.8.0–v0.10.0 once, confirm the `Legacy inbound-webhook drain: …` / `nothing to drain` log line,
then upgrade.

### 2.2 Safety — is anything else using these streams?

Exhaustive grep across `*.ts` / `*.mjs`, excluding `node_modules` and `dist`:

| Stream | Writer | Reader |
|---|---|---|
| `events.inbound.webhooks` | **none** — the publisher went with #2280 (no `publishInboundWebhook`, no `WebhookEventPublisher` in the tree) | **only** `LegacyInboundWebhookDrain` |
| `events.inbound.webhooks.dead` | **none** — its sole writer `webhook-to-job.handler.ts` was deleted by #2280 | **none, ever** |

So `REDIS_STREAM_NAMES`'s own docblock — *"Every stream the system writes"* — is **already false for
both entries** on `main`. Removing them makes that sentence true again.

### 2.3 Shared consumer primitives — confirmed NOT to be deleted

```
apps/worker/src/events/master-deletion-to-job.handler.ts   ackTrimmed, resolveConsumerName
apps/worker/src/sync/job-intake.consumer.ts                ackTrimmed, resolveConsumerName
libs/shared/src/redis/stream-consumer.ts                   toPendingRows — used INTERNALLY by
                                                           readOwnPending() and reclaimOrphans()
```

`toPendingRows` is the only primitive the drain is the sole *external* caller of, and it remains
live inside its own module (two internal callers) and exported for the recovery API. **`stream-consumer.ts`
and `libs/shared/src/redis/index.ts` are not modified.**

### 2.4 Guards that interact with this change

- **`scripts/check-cross-context-imports.mjs`** — since #2791 a **stale ALLOW_LIST row fails the
  build** ("the file does not exist"). The drain holds two rows (`.ts` + `.spec.ts`, both
  `WebhookDeliveryRepositoryPort`). They **must** be deleted in the same commit.
- **`scripts/check-stream-writes.mjs`** — has `MIN_SCANNED_FILES = 100` and a `--self-check`.
  Neither is affected: this change deletes 3 source files (scan count stays in the thousands), adds
  no `.xAdd(` call, and touches no allow-list of that script. Verified by running
  `pnpm check:invariants`.
- **`scripts/check-service-interfaces.mjs`** — scoped to `libs/core/**/application/services/*.service.ts`.
  The drain is a handler in `apps/api`; not in scope.
- **`scripts/check-resolve-stream-mirror.mjs`** — a category-resolve SSE mirror. Unrelated despite the
  name (checked: no reference to any Redis stream).

### 2.5 Files that will break at type-check if only the drain is deleted

| File | Why |
|---|---|
| `apps/api/src/webhooks/application/handlers/webhook-handler.types.ts` | its **only** consumer is the drain → becomes dead code |
| `libs/core/.../__tests__/redis-streams-event-publisher.spec.ts:52` | uses `REDIS_STREAM_NAMES.inboundWebhooks` |
| `libs/shared/src/redis/__tests__/stream-retention.spec.ts:58,98` | uses both removed names |
| `apps/api/test/integration/webhook-ingestion.int-spec.ts` | imports the drain class; `WEBHOOK_HANDLER_CONSUMER_GROUP` becomes unused (`noUnusedLocals`) |

Deleting all three files in `handlers/` leaves the directory empty; git drops it automatically.

---

## 3. Decisions taken (⏸️ points — no user pause per orchestrator instruction)

### D1 — Remove **both** inbound-webhook stream names, not just the primary

The issue AC names only `events.inbound.webhooks`. I am removing `events.inbound.webhooks.dead` as
well.

**Rationale.** The `.dead` stream is *deader* than the one the issue names: the primary at least
still had a reader (the drain), while `.dead` has had neither writer nor reader since #2280 deleted
`webhook-to-job.handler.ts`. Removing one and keeping the other would leave `REDIS_STREAM_NAMES`'s
docblock ("Every stream the system writes") false, keep a retention entry for a stream that cannot
be written, and require a second follow-up issue with no owner — the exact shape of the untracked
follow-up this issue exists to fix. The precedent is #2163, which **removed** `events.sync.jobs`
outright for having a publisher and no consumer.

**Blast radius: nil.** The `.dead` entry is `{ kind: 'maxlen', threshold: 10_000 }`, byte-identical
to `DEFAULT_STREAM_BOUND`, so even a hypothetical out-of-tree writer reaching
`xAddBoundedDynamic` gets exactly the same bound after removal as before. Trimming happens on write
and there are no writes, so an operator's existing stream key is unaffected either way.

### D2 — Keep the int-spec's *negative* assertion that ingress writes no inbound-webhook entry

`webhook-ingestion.int-spec.ts:158` asserts the live path publishes nothing to
`events.inbound.webhooks`. It is kept (with its local constant), because it is the only runtime proof
that ingress does not revive the stream, and `EventPublisherPort.publish(streamName: string, …)`
means a revival would **not** be a compile error. Its comment is updated to say the stream is
retired. The drain-specific `describe` block and `WEBHOOK_HANDLER_CONSUMER_GROUP` constant go.

### D3 — Fix the two webhook docs that this change makes actively wrong

`docs/webhooks/overview.md` (`## Streams` → `### events.inbound.webhooks`, `## Consumer Groups` →
`### webhook-handler`, and the troubleshooting `XREAD`/`XINFO` commands) and
`docs/webhooks/prestashop.md:250` currently instruct an operator to inspect a stream that will no
longer exist. These are outside the AC's named file list but are made *newly* misleading by this
change, so they get a **surgical** edit marking the machinery retired — not a rewrite.

### D4 — `docs/architecture-overview.md` edits kept minimal

Three passages mention the drain (§ Webhook Ingestion Flow bullets 1 and 2, and the
`webhook_deliveries.status` monotonicity bullet). Edits are confined to the clauses that name the
drain. That file is large and concurrently edited; minimal diff = cheap rebase.

---

## 4. Step-by-step implementation

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `apps/api/src/webhooks/application/handlers/legacy-inbound-webhook-drain.ts` | **delete** | file gone |
| 2 | `apps/api/src/webhooks/application/handlers/legacy-inbound-webhook-drain.spec.ts` | **delete** | file gone |
| 3 | `apps/api/src/webhooks/application/handlers/webhook-handler.types.ts` | **delete** | no consumer remains; `handlers/` dir disappears |
| 4 | `apps/api/src/webhooks/webhooks.module.ts` | drop the import + the provider entry + its comment; rewrite the docblock clause that promises the follow-up removal | module compiles; no drain reference |
| 5 | `libs/shared/src/redis/stream-retention.ts` | drop `inboundWebhooks` + `inboundWebhooksDead` from `REDIS_STREAM_NAMES`; drop their two `STREAM_BOUNDS` entries; retune the `masterDeletionDead` comment which contrasts against the removed webhook DLQ | `RedisStreamName` = 4 members; `STREAM_BOUNDS` exhaustive |
| 6 | `libs/shared/src/redis/__tests__/stream-retention.spec.ts` | repoint the DLQ-contrast test onto `masterDeletion` (maxlen, has a durable counterpart) vs `masterDeletionDead` (minid, has none) — the same design point, a live partner; repoint the "approximate trimming" test onto `masterDeletion` | suite green, no assertion lost |
| 7 | `libs/core/src/events/infrastructure/adapters/__tests__/redis-streams-event-publisher.spec.ts` | delete the `inboundWebhooks` test (`:51-62`). **Nothing unique is lost, and the reason is specific**: the "a stream with a configured cap gets a MAXLEN TRIM" case is held by `:38-49` (`masterDeletion`), and the general per-member contract by `it.each(ALL_STREAMS)` in `stream-retention.spec.ts`. What *is* given up is the dynamic-seam path's only assertion at the 50 000 threshold specifically — accepted, since that threshold ceases to exist. Keep the past-tense comment at `:67` | suite green |
| 8 | `apps/api/test/integration/webhook-ingestion.int-spec.ts` | drop the drain import (`:20`) and the whole drain `describe` (`:538-601`); update the file docblock. **The two module-level consts are asymmetric and this is the step's one real trap**: `WEBHOOK_HANDLER_CONSUMER_GROUP` (`:26`) is used ONLY at `:557` inside the deleted block, so it must go or `noUnusedLocals` fails; `INBOUND_WEBHOOK_STREAM` (`:25`) is still used at `:158` by the surviving live-path negative assertion (D2) and must STAY, with its comment updated to say the stream is retired | compiles; remaining suite unchanged in behaviour |
| 9 | `scripts/check-cross-context-imports.mjs` | delete both drain ALLOW_LIST rows and retune the block comment above them | `pnpm check:invariants` green (would fail on a stale row) |
| 10 | `docs/operations/redis-stream-retention.md` | **three regions, not one.** (a) `## One-time cleanup` §2: turn the two `XTRIM` lines (`:50-51`) into `DEL` — an operator upgrading a long-lived stack may still hold both keys, so deleting the lines outright would strand that memory — and drop the now-false "thresholds must match `stream-retention.ts` … source of truth" clause (`:53-55`) for those two, since the file no longer declares them; fix the `XLEN`/`MEMORY USAGE` worked example (`:63-64`), which names the retired stream. (b) drop both rows from the sizing table (`:101-102`). (c) replace `## Webhook-stream sunset (#2280)` with a removed-state note keyed to #2300, stating the version floor and that `DEL` is safe | doc describes the shipped state; no instruction references a stream that cannot exist |
| 11 | `docs/architecture/adrs/049-...md` | amend the decision-1 bullet (`:186`): the drain shipped in v0.8.0 and was removed in #2300 | ADR records the removal |
| 12 | `docs/architecture-overview.md` | **four passages, named precisely** — `:2146` (the drain bullet → one-line removed note); `:2147` (the retention bullet explains `masterDeletionDead`'s age bound *"unlike its webhook sibling"* — the SAME dangling contrast step 6 repoints in the spec, so fix both together or they drift); `:2148` (**load-bearing**: it currently ends *"only the one-shot `LegacyInboundWebhookDrain` still reads the group, reusing these primitives"*, which is the only passage explaining why `toPendingRows` is exported — the rewrite must positively state the `webhook-handler` group now has NO reader while the primitives stay live via `readOwnPending`/`reclaimOrphans`, or the next reader deletes them as dead); `:2153` (drop the drain clause). `:2143` is historical and stays | no stale claim; no invitation to delete a live primitive |
| 13 | `docs/webhooks/overview.md`, `docs/webhooks/prestashop.md` | surgical retirement notes (D3) | no instruction to inspect a non-existent stream |
| 14 | `docker-compose.yml` (`:77-79`) | the `REDIS_MAXMEMORY` rationale counts *"`events.inbound.webhooks` holds up to 50k entries … (~100–250 MB)"* toward the 2 GB floor — the SAME figure as the runbook sizing row in step 10(b), so it moves with it, or an operator sizes memory for a stream that receives no writes | sizing rationale cites only live streams |
| 15 | `libs/core/src/events/domain/ports/event-publisher.port.ts` (`:24`) | the `@param streamName` JSDoc example on a **published core port** names the retired stream; repoint to `events.master.deletion` | no published port advertises a stream that does not exist |

---

## 5. Validation

- **Architecture**: pure deletion. No CORE ↔ Integration boundary crossed; no port, DTO, ORM entity
  or Symbol token changed. `RedisStreamName` narrows — a *contract* narrowing, but every in-tree
  consumer is updated in this commit and the type is not part of a plugin-facing surface
  (`@openlinker/shared/redis` is host/lib-facing; `xAddBoundedDynamic` still accepts any `string`,
  so no out-of-tree writer can break — it degrades to `DEFAULT_STREAM_BOUND`, which for the removed
  `.dead` entry is the identical bound).
- **Testing**: no new tests. Two existing tests are repointed rather than deleted (step 6) so no
  assertion is lost; one is deleted as strictly redundant (step 7). Removed coverage is the drain's
  own unit spec and its int-spec block — correct, since the code under test is gone.
- **Security**: none touched. No secret, no auth path, no route.
- **Gate**: `pnpm lint && pnpm type-check && pnpm test`, plus `pnpm check:invariants` explicitly
  (steps 9 and 5 are exactly what that gate watches).

## 6. Risks

| Risk | Mitigation |
|---|---|
| An operator upgrades from ≤ v0.7.0 straight past the drain | Stated in the PR description and in the ops runbook as the version floor; three releases of soak already elapsed |
| A stale ALLOW_LIST row fails the build | Step 9 is in the same commit; `pnpm check:invariants` run explicitly |
| Removing `.dead` is out of the literal AC | D1 records the reasoning; blast radius is nil (bound identical to the default) |
| `docs/architecture-overview.md` rebase conflict | D4 keeps the diff to four named clauses |

---

## 7. Pre-implement gate outcome

Ran 2026-09-08 with two independent audit agents (symbol reachability, guard-script
interaction). **Verdict: NEEDS-REVISION — no reuse collision, no unaddressed contract break;
six documentation-scope gaps, all applied above.**

What the gate *confirmed* (so it need not be re-litigated in review):

- **No production writer to either stream exists anywhere.** All four `xAddBounded` callers
  resolve to `masterDeletionDead` / `healthcheck` / `jobsSync`, and `xAddBoundedDynamic`'s only
  two production callers both pass `MASTER_DELETION_EVENT_STREAM`. `publishInboundWebhook`,
  `WebhookEventPublisher` and `webhook-to-job.handler.ts` do not exist in the tree.
- **`webhook-handler.types.ts` really is drain-only** — no identically-named type anywhere else,
  and no barrel under `apps/api/src/webhooks` re-exports it.
- **D1 is verified, not merely argued**: `inboundWebhooksDead` has zero production consumer.
- **The `RedisStreamName` narrowing is internal in practice.** `./redis` IS an exported subpath,
  but the only importers outside `libs/shared`/`libs/core`/`apps` are
  `prestashop-integration.module.ts:74` and `plugin-sdk/src/rate-limit.module.ts:51`, and both
  take `RedisConfigModule` only. Zero plugin references to `REDIS_STREAM_NAMES` /
  `RedisStreamName` / `xAddBounded`; `docs/plugin-author-guide.md` never mentions the subpath.
- **`check-stream-writes.mjs` is unaffected in both halves** — measured live at
  `3688 source file(s) checked` against `MIN_SCANNED_FILES = 100`, a 36x margin; deleting three
  files (one a `.spec.ts` its `TEST_PATTERN` never counted) leaves 3686. It references neither
  removed name nor the drain, and `RedisStreamName` appears in its prose comments only.
- **`check-cross-context-imports.mjs` is the one hard break** if the two ALLOW_LIST rows are left:
  `:788-801` pushes them with `why: 'the file does not exist'` and `:803-814` exits 1 — failing
  `pnpm lint`, not merely warning. Step 9 covers it.
- **No count/snapshot assertion on the registry exists.** `Object.values(REDIS_STREAM_NAMES)` is
  iterated once (`stream-retention.spec.ts:22`) with per-member assertions and no cardinality
  claim; the five `it.each` blocks simply run 4 cases instead of 6, which is the intended
  arithmetic of removing two streams.
- Nothing in jest/tsconfig/ESLint/package.json names the `handlers/` path, so emptying it is free.
