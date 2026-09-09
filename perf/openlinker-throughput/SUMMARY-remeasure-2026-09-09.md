# Re-measurement on the merged epic - summary (2026-09-09)

One tree, one image, one guard chain, for the first time in this campaign.

**Tree** `1f9a52d1b` (`perf-programme-2840`, #3022 merged). Images rebuilt from
that sha; `guard_build` reported `image sha = tree HEAD, product paths
identical` on every scenario that ran after the rebuild. **Host** 28 logical
CPUs, 15 GiB RAM, WSL2, `load_average` 1.4-3.0 throughout - a developer
workstation shared with two other OpenLinker docker stacks, no CPU pinning.
**Dataset** not reseeded: `order_records` 2 013 679 (2 000 000 `perfseed`),
`products` 60 006, `sync_jobs` 164 917 (all terminal at start).

Acceptance criteria and two falsifiable predictions were pre-registered in
`PRE-REGISTRATION-remeasure-2026-09-09.md` before any window opened.

## Verdicts

| Flow | Arm | Verdict | Figure |
|---|---|---|---|
| F3 | `unique` | VALID | 7 112 reqs, 42.9/s achieved, 0 failed, p95 20.3 ms |
| F3 | `replay-committed` | VALID | 7 124 reqs, 43.0/s, 0 failed, p95 13.2 ms |
| F3 | `replay-concurrent` | VALID | 7 124 reqs, 43.0/s, 0 failed, p95 6.3 ms |
| F3 | `concurrent-vus` 2/8/32/128 | VALID x4 | 345 / 459 / 409 / 533 req/s, p95 7 / 24 / 104 / 293 ms |
| F2 | stock propagation | VALID | 24/24 cycles, E2E 2 210 ms |
| F2 | A/B at `fan-out=1/1` | VALID | 24/24 cycles, E2E 1 930 ms |
| F1 | `latency` | VALID | 25/25 to a destination create, E2E p50 4 801 ms |
| F1 | `throughput-baseline` | **VALID** | **1 555 orders/hour** (knee) |
| F1 | `throughput-destination-raised` | **VALID** | **3 220 orders/hour** (knee) |
| F1 | `throughput-lane-raised` | DISCARDED | >=10 658 orders/hour (floor), 2 deferrals |
| F5 | operator read path | VALID (own criterion) | 1 449/1 449 route requests 2xx, at the real 2.01M dataset |
| F10 | dependency-failure matrix | 13 VALID, I3 no verdict | no silent loss on any arm |

Every figure above is **measured** unless stated otherwise. Every
`verdict.txt` was read before any figure from it was quoted.

## Did the figure move, and did the verdict move - the two answers, per flow

**F1 - verdict moved, and the previous figures were never figures.**
All four prior F1 arms were DISCARDED. Their own `verdict.txt` files say why:
34-52 Redis-limiter degradation entries per window, on every arm. A degraded
limiter has fallen back to per-process in-memory limiting, so the earlier
182 / 262 / 295 orders-per-hour were taken while the instrument the system
paces itself with was broken. The ratios against this run (8.5x, 12.3x, 36x)
are **not** speed-ups and must not be published as such. The honest statement
is "a discarded measurement versus a valid one".

**F2 - figure moved 4.0x, verdict unchanged (it was already VALID).**
E2E 8 904 / 9 005 ms -> 2 210 ms, with two independent prior runs agreeing to
1.1%. `drain_http` 500 -> 200 on every cycle.

**F3 - verdict moved against tonight's runs, but the question got easier.**
Tonight's five discarded `unique` windows all failed
`post_guard_generator_saturated` - k6 at 2 600 of 2 600 VUs - because they were
saturation attempts behind the withdrawn ~600 req/s ceiling. This run drove
50/s with about one VU. It passes that guard because it asked an easier
question. **No improvement is demonstrated, and the ~600 req/s claim stays
withdrawn and unreplaced.**

## Two corrections to claims made during this run

**1. "No throughput window ever reached `VALID`" is false, and I asserted it
before checking.** An audit of every `f3-webhook-burst` `verdict.txt` in the
tree finds VALID windows in three worktrees, including before tonight. What
this run adds is a *coherent set*: seven windows of one invocation, all VALID,
on one tree and one image, each carrying a recorded guard list. The F3 report
carries the withdrawal.

**2. The brief's headline premise does not survive its own artefacts.** The
brief states that windows were discarded *"solely by [`post_guard_destination_creates`]'s
unscoped predicate"* and asks whether they now pass. Reading the four prior F1
verdicts: no window was discarded solely by it, and where it did refuse, its
text reads `2 lack syncedAt **on the declared destination**` - the scoped
branch. The refusal was real, not an artefact. The guard that actually
discarded everything was `post_guard_limiter_degraded`.

Pre-registered prediction **P1** (only F1 can move *because of* that repair,
since F2 and F3 pass an empty destination) held. **P2** (if F3 turns VALID it
is not because of the repair) held and was honoured.

**3. P4 was half wrong.** It predicted F5 *"cannot produce a `VALID`/`DISCARDED`
verdict at all"*. F5 indeed runs no post-guard and its verdict carries no
`guard=` line - but it writes its own verdict on its own criterion, `non2xx=0`.
So an F5 `VALID` certifies "no route errored", not "eight post-guards passed",
and reading it as the latter overstates it by seven guards.

## One cause tested and refuted

Hop F of F2 (propagate enqueued -> `offerQuantity` child enqueued) fell from
~5 s to ~1 s. The named candidate was #2609's `fan-out` cap raise from 1/1 to
8/4. **A controlled A/B refutes it**: at `fan-out=1/1`, read back off the
worker's own startup line before the arm began, hop F measured **987.7 ms**
against **981.7 ms** at 8/4 - flat across a 4x cap change.

The design is one-sided and that is part of the result: F2 is serial, so a
per-scope cap has no queue to act on and the A/B could refute but never
confirm. `BLOCK_MS = 5000` is unchanged in the tree, so that mechanism was not
removed either.

**Surviving candidate: host contention**, correlated across two independent
flows - F1's limiter degradation (34-52 entries before, 0 now) and F2's hop
timings - and **not isolated**. The experiment that would settle it is to
re-run under deliberate host load. It was not run: saturating this host is
what OOM-killed the previous measurement session and its `lab-mysql` earlier
the same night.

## The one slow operator route, already decided

At 2.01M orders the needs-attention order list is **384 ms p50 / 1 076 ms p99**
against the plain list's 99 ms - and `pg_stat_statements` names the cause
exactly: the pagination `COUNT(*)` carrying `syncStatus @> jsonb`, 138 calls,
**397 ms mean**, tracking the route's p50 with a matching call count. The plain
list is the same `COUNT(*)` without the filter at 93.5 ms mean.

This is **not a new finding**:
`decision-order-records-syncstatus-index-2026-09-06.md` already decided against
a GIN index here and recorded it in `countByHealth`'s docblock. This run adds
one data point to that document's own "not yet, revisit after #2943/#2957"
clause. It does **not** add a scaling claim - the earlier 142-150 ms figure was
taken by direct `psql` against an idle table and this one from
`pg_stat_statements` under live k6 traffic, so the two are not comparable and
no super-linear growth is asserted.

## F10 - the correctness answer, and it is the good one

F10 asks per fault whether an order is **lost, retried, or silently marked
done**. Across all 13 injected faults (each confirmed `"injected":true`):

**`claimedButAbsentFromPsOrders = 0`, with `readable = 1` on every arm.** No
fault produced an order OpenLinker called `synced` against an id naming no row
in the shop. Because the shop was readable in every window, those are measured
zeros rather than the detector's "nothing was established" zero.

Three findings sit alongside that:

1. **A total Redis outage stalls rather than loses - and kills the api.** I2
   left 12 jobs in flight after 240 s with no recovery, 2 orders carrying no
   `syncStatus` at all, and `lab-api` **exited code 1** on an unhandled `error`
   event from a Redis socket, still down 40 minutes later. Nothing was falsely
   claimed done. The container staying dead is the stand's `restart: 'no'`, not
   a production claim; the crash is a product behaviour, and it contrasts with
   the rate limiter, which has a designed degraded mode for the same condition.
2. **A destination failure is invisible in the job ledger.** D1 failed 6 of 12
   destinations while all 12 `marketplace.order.sync` jobs record
   `succeeded/ok` with `attempts_max = 0`. The failure IS on the order's
   `syncStatus`, so it is not silent loss - but a job-level dashboard or alert
   cannot see it.
3. **D4 leaves 9 orphaned carts in the shop** (`psCartsCreated = 12`,
   `psOrdersCreated = 3`). OL's accounting is honest; the create path is simply
   not transactional across cart-then-order and nothing cleans up.

**I3 (worker killed) is unmeasured.** `guard_scheduler_off` refused it saying
the worker `has OL_SCHEDULER_ENABLED=true`; the worker was not running, and
`lib.sh:567` falls back to `printf 'true'` when `docker exec` fails. Fail-closed
is right, the message is not - it asserts a value it never read, in the one arm
whose purpose is to kill the worker.

**The stand was left broken** and F10 said so: the PrestaShop connection still
pointed at a removed fault proxy, and the api was dead. Both restored by hand.
A restore path that needs the api to `PATCH` a connection cannot run after the
scenario is allowed to kill the api.

## A peer machine measured the same arms - do not average

A second host (EPYC server, branch `2840-remeasure-epyc32-2026-09-09`) ran the
same three F1 throughput arms on the same tree.

| Arm | this host (WSL2 workstation) | peer host (EPYC) | apart |
|---|---|---|---|
| `throughput-baseline` | 1 555 orders/hour | 1 184 orders/hour | 31% |
| `throughput-destination-raised` | 3 220 orders/hour | 3 162 orders/hour | 1.8% |
| `throughput-lane-raised` | 10 658 orders/hour (floor) | 10 983 orders/hour | 3.0% |

**Two different hosts. Do not average, pool, or present as a range.** The two
tuned arms agree to within 2-3%, so those figures travel between hosts; the
divergence is confined to the factory-default arm, whose pacing is tightest and
which is therefore this host's number rather than the platform's. Why only that
arm diverges is not established.

## What this answers about real volume

5 000 orders/day is **208 orders/hour**. Untuned, this host measured
**1 555 orders/hour** and the peer host **1 184 orders/hour** as VALID knees,
so the defensible untuned claim is **at least 1 184 orders/hour** - 5.7x that
question (**derived**: 1 184 / 208). Raising only the destination's own rate
limit takes both hosts to ~**3 200 orders/hour**, also a knee, also VALID.

## Instrument defects found during this run

1. **`lib.sh` defaults `OL_API_URL` to `:13000`; the lab stand publishes api on
   `:19000`.** Port 13000 belongs to a different OpenLinker instance
   (`ol-demo-fresh-api`) with its own database. Fails closed - every
   `ol_api`/`ol_login` call site dies rather than tolerating - so it cannot
   have corrupted a past measurement, but no manifest records the endpoint, so
   no past run can be audited for it either.
2. **F2 is not idempotent across runs without an outbox reset.** Stale
   `pending` rows hold `dedup_key` (released on *claim*, not on delivery), and
   a `pending` backlog starves a fresh row because the drain is oldest-first.
   Both blockers hit this run before it could measure anything.
3. **The scenario-generated F2 report carries a hardcoded sentence that is now
   false** - it states `drain_http_status` reads 500 on every cycle while the
   data in the same file records 200 on all 24.
4. **F2's generated hop B is uninterpretable**: p50 -294 ms, because
   `outbox_created_local` is PrestaShop local time and `outbox_delivered_utc`
   is UTC. No figure depends on it.
5. **`post_guard_limiter_degraded` greps prose, not #2853's stable token.**
   Verified still matching (the phrase survives inside the new message), but
   the token exists precisely to be grepped. Not changed mid-run.

## Blocked

**Nothing is committed.** `commit.gpgsign=true`, signing key
`D99727A48FFC6D86`, and the agent holds no cached key - a signature attempt
fails with `gpg: cannot open '/dev/tty'`. The brief says to stop and say so
rather than reach for `--no-gpg-sign`, so no commit and no PR. Every artefact
is on disk in the `2840-remeasure-merged` worktree.
