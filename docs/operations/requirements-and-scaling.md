# Hardware requirements and scaling

What to provision for a self-hosted OpenLinker install, written from the
measurements the #2840 performance campaign actually took.

**Read the warning first, because it decides whether this page is the right one
for your problem.** The campaign found that the flow an operator most often
wants faster - order ingestion - is bounded by *configuration*, not by the
machine. The order path measured ~207 orders/h on the then-shipped defaults and
**2 233 orders/h on the same hardware** once one Redis client and one
destination rate limit changed, while adding two more worker replicas bought
only **1.50x** on top of that. If your queue is not draining, this page is
probably not your answer;
[§ 11](#11-scaling-what-replicas-buy-and-what-they-do-not) is.

---

## 1. How to read this page

**Every figure carries a label**, the same three the campaign reports use:

| Label | Means |
|---|---|
| **measured** | read off an instrument during a run, with a named artefact behind it |
| **derived** | arithmetic over measured figures, stated with the arithmetic |
| **extrapolated** | projected beyond what was observed. A starting point to verify, never a bound |

**No minimum on this page was tested.** No OpenLinker container in the campaign
was ever run on constrained hardware - the stand pinned no CPUs and declared no
memory limit on any container. So every "minimum" here is *derived from observed
usage plus headroom*, and it is a starting point rather than a floor somebody
proved. The campaign's own standing caveat applies to all of it:

> These are floors, not ceilings. A figure taken under contention understates
> what the software can do on dedicated hardware; it does not overstate it.

**One instrument caveat governs every memory number on this page.**
`docker stats` MemUsage includes the cgroup's page cache, which for a database
container is most of it. Measured directly on the stand at one instant:
`lab-postgres` read **1.412 GiB** by `docker stats` against **17.4 MiB** of
anonymous RSS and 1.53 GiB of reclaimable cache - a factor of 83, and a later
sample put the same divergence at 157x.

**The harness's only memory collector is `docker stats`** (`lib.sh`, feeding the
`docker_stats_json` column of every `timeseries.csv`). No campaign report quotes
a per-container memory figure from it, and none should. Every RAM number in
[§ 6](#6-ram) instead comes from a cgroup `memory.stat` sampler that was
**started by hand, out of band, mid-window, on one run** - it is not part of the
harness on this branch. That provenance is a real limitation and
[§ 6](#6-ram) states what it costs.

`docker stats` **CPU** percent is unaffected by that problem and is used here -
noting it is relative to **one core**, so 100% is one core, not one machine.

---

## 2. The machine every number came from

All of it. There is no second host and no dedicated hardware anywhere in the
campaign.

| Axis | Value |
|---|---|
| CPU | 28 logical CPUs |
| RAM | **15 912 MB** (~15.5 GiB) as recorded by the run manifest |
| Disk | 847 GB free |
| Platform | Docker Compose on a developer workstation, WSL2 |
| Isolation | none - no `cpuset`, no `cpus`, no `deploy.resources`, no container memory limit |
| Co-tenancy | two other full OpenLinker stacks throughout (13 further containers), plus other agents' scenarios |
| Load average entering the sustained window | 0.88 / 1.16 / 1.27 |

Reports state the host RAM variously as 15 GB, 15.9 GB and ~16 GB; the manifest
figure above is the recorded one. The stand is `docker-compose.lab.yml`; its
runbook is [perf-lab-stand.md](./perf-lab-stand.md), which states **no host CPU,
RAM or disk requirement of its own** - this page is the first document that does.

Postgres and Redis configuration is in [§ 8](#8-postgres-configuration) and
[§ 10](#10-redis).

> One correction to carry forward:
> `results-sustained-mixed-load-2026-09-08.md` § 2.4.1 states `shared_buffers`
> is "only 160 MiB". That run's own manifest records `128MB`, and
> `shared_buffers = 16384` 8 kB blocks confirms it. **128 MiB is the value.**

**Frame every figure as an observation on that machine.** None of it is portable
as an absolute.

---

## 3. Datasets the footprint was sampled at

This matters more than usual, because the coverage is uneven and the gaps are
where a sizing mistake would come from.

| Dataset | Orders | `order_line_items` | Catalogue | Database size | What was sampled |
|---|---:|---:|---|---|---|
| F5 small | 10 000 | 24 995 | 10 006 products / 20 000 variants | not recorded | read latency |
| F5 medium | 100 000 | 249 836 | same | not recorded | read latency |
| F5 large | 1 000 000 | 2 499 313 | same | not recorded | read latency, **bytes/order** |
| Sustained mixed load | **2 003 176** | not recorded | 60 006 products / 111 678 variants (50 006 in the shop) | **4 817.6 MiB** | **RSS, page cache, CPU, connections, disk growth** |

**The only footprint sample is at ~2 million orders.** There is no RAM, CPU,
page-cache or connection figure at 10 000 or 100 000 orders anywhere in the
campaign. Where this page states a smaller-dataset figure it is
**extrapolated** and says so.

F5 held `sync_jobs` constant at 122 869 rows across all three sizes, so its
read-latency curve is a pure order-history curve and says nothing about a large
job history. The order and product counts for the sustained run come from that
run's write-up, not from its own manifest, which records `sync_jobs` rows and
nothing else about dataset size - a provenance gap, recorded rather than
smoothed.

---

## 4. Minimum and recommended - OpenLinker's own host

Two independent axes: **dataset size** and **worker replica count**. The
campaign measured replica counts **1 and 3**; a 4th is structurally refused (see
[§ 9](#9-the-connection-budget-is-a-production-requirement)). Your destination
shop needs sizing too, and that is [§ 12](#12-the-destination-shop-needs-sizing-too).

### 4.1 Single worker replica

| | Minimum | Recommended | Label |
|---|---|---|---|
| **vCPU** | 2 | 4 | derived |
| **RAM** | 4 GB | 8 GB | derived |
| **Disk (SSD)** | 20 GB | 100 GB | derived - read [§ 7](#7-disk) before accepting either |

At **≤ 100 000 orders**, **2 vCPU / 4 GB / 20 GB** is a reasonable recommended
tier - **extrapolated**, from the page-cache-to-database ratio in
[§ 6](#6-ram) applied to a database an order of magnitude smaller. Nothing was
sampled there.

### 4.2 Three worker replicas

| | Minimum | Recommended | Label |
|---|---|---|---|
| **vCPU** | 4 | 6 | extrapolated |
| **RAM** | 5 GB | 9 GB | derived (RSS) + extrapolated (headroom) |
| **Disk** | unchanged | unchanged | derived |
| **`max_connections`** | **≥ 163** | 200 | derived - and mandatory, see [§ 9](#9-the-connection-budget-is-a-production-requirement) |

The RAM add is the measured worker RSS - peak **143.3 MB** per replica, so two
extra replicas are ~0.3 GB, plus one extra Redis connection each. The CPU add is
**extrapolated and deliberately generous**: no run made worker CPU the binding
constraint (mean 2.5% of one core across the whole sustained window), so 1 vCPU
per extra replica is headroom, not a measurement.

**Before provisioning for three replicas, read
[§ 11](#11-scaling-what-replicas-buy-and-what-they-do-not).** Three replicas
were measured at **1.50x** the order throughput of one, not 3x.

### 4.3 Where these numbers come from

The whole derivation, so it can be checked or rejected:

| Term | Value | Label |
|---|---|---|
| Non-reclaimable RAM, four OpenLinker containers, peak | **~527 MB** (399 MB anonymous RSS + 128 MiB `shared_buffers`) | measured + derived |
| Postgres page cache the workload wanted at a 4.8 GiB database | **~1.6 GB**, reclaimable | measured |
| Redis `maxmemory` cap as shipped | 2 GB (a cap, not a reservation; observed usage 39-52 MB) | configured / measured |
| Peak CPU of any single container under mixed load | 0.60 core (worker; Postgres 0.54) | measured |
| Peak CPU under webhook saturation (~600 req/s) | ~1.17 core (api) + ~1.04 core (Postgres) | measured |
| Database growth under the measured composition | **9.9 MiB/h** | derived from measured |

`2 vCPU / 4 GB` covers the mixed-load composition with room; it does **not**
cover a webhook burst approaching 600 req/s, which on its own wants ~2.2 cores
between api and Postgres. `4 vCPU / 8 GB` covers both simultaneously with the
page cache Postgres asked for.

> **`REDIS_MAXMEMORY=2gb` is shipped as a cap the host must be able to honour.**
> The policy is `noeviction`, deliberately - under any `allkeys-*` policy Redis
> can evict a whole stream key together with its consumer groups and pending
> entries lists, with no error to any consumer. For sizing that means: on a host
> with 4 GB total, a Redis that ever reached its 2 GB cap leaves very little for
> everything else. Lower `REDIS_MAXMEMORY` deliberately at the minimum tier
> rather than discovering it under load; [§ 10](#10-redis) has the stream
> arithmetic the 2 GB is sized from.

---

## 5. CPU

### Under the mixed-load composition

30 crons ticking, catalogue sweeps competing, ~200 orders/h draining, one worker
replica, 2M-order history. `docker stats` CPU percent relative to one core,
n=330 samples over 3.00 h:

| Container | mean | max | Label |
|---|---:|---:|---|
| `lab-postgres` | 4.50% | **54.36%** | measured |
| `lab-worker-1` | 2.53% | **59.87%** | measured |
| `lab-redis` | 0.48% | 14.11% | measured |
| `lab-api` | **0.016%** | 1.79% | measured |

**The api figure is not a small number, it is an absent one.** The api was
effectively idle for the whole window: this scenario drove no operator read
traffic through it. **Do not size the api tier from this run.**

### Under webhook saturation

F3, the api-heavy path, and the only CPU data that exercises the api at all:

| | 43 req/s | ~600 req/s | Label |
|---|---:|---:|---|
| `lab-api` CPU | 16.2% mean / 33.7% max | **~50% mean, up to 116.8% max** | measured |
| `lab-postgres` CPU | 10.2% mean / 22.9% max | **~70% mean, up to 103.7% max** | measured |
| Peak active DB connections | 1-3 of 80 | **41-42** | measured |
| Postgres wait event | none | **`LWLock:WALWrite`** | measured |

The campaign's cross-flow report cites peak single-sample reads of 97.7% and
78.2% for the same two containers from the same artefacts - a different sample
tick, the same finding. Zero requests failed at any rate.

**What binds this path, and the operator conclusion that follows.** Three limits
arrive together at ~600 req/s: the api process saturates one core, the
connection pool reaches its configured ceiling (41 observed against
`OL_DB_POOL_MAX` of 40, i.e. the api's own pool), and Postgres begins waiting on
write-ahead-log flushes. **No index contention was observed at any rate, on any
arm**, which contradicts the hypothesis the scenario was built around. So an
operator scaling webhook ingress **adds api processes and faster WAL storage**;
index tuning buys nothing here.

Two limits on the 600 req/s figure. It is **a floor on the ceiling, not the
ceiling** - reached on a contended workstation and not settled on a quiet one.
And the campaign's own guidance is to **cite the 300 req/s arm rather than the
600 req/s one** for a headline number, because the 600 arm ran under markedly
worse host contention than the rest of the report (its high-rate sweep is
`DISCARDED` for a saturated load generator).

**Never measured**: worker CPU at a rate that made it the constraint; api CPU
under operator read load at any dataset size.

---

## 6. RAM

cgroup `memory.stat`, sampled per container at 60 s, at the 2M-order dataset
with one worker replica. **Cut at the run's own end** (n=131 per container over
2.21 h). All figures MB:

| Container | first | last | min | max | mean | band | slope | Label |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `lab-api` | 126.3 | 121.8 | 121.8 | 126.4 | 126.0 | 4.6 | −0.74 MB/h | measured |
| `lab-worker-1` | 133.1 | 116.2 | 98.4 | **143.3** | 114.9 | 44.8 | **+1.81 MB/h** | measured |
| `lab-postgres` (anonymous only) | 77.1 | 9.5 | 3.0 | 77.1 | 14.1 | 74.1 | −0.74 MB/h | measured |
| `lab-redis` | 45.5 | 45.2 | 44.9 | 51.8 | 47.8 | 6.8 | +1.09 MB/h | measured |

**This is the campaign's only cgroup memory series, and the instrument was not
part of the harness.** It was started by hand, out of band, at roughly t+2 900 s
of a 10 783 s window, so it covers **73.9%** of one run - the first 48 minutes
have `docker stats` figures only, which for Postgres cannot be read as memory at
all. Every other run in the campaign has no trustworthy per-process memory
figure of any kind.

> ### Correction, 2026-09-08 - the published worker RSS slope is withdrawn
>
> **Withdrawn.** `results-sustained-mixed-load-2026-09-08.md` § 4 states
> *"Worker RSS **+0.67 MB/h** inside a 75-143 MB oscillation band"*, with
> `first = 133.1`, `last = 133.6` and the reading *"its first and last samples
> are 0.5 MB apart, so it is not distinguishable from sawtooth GC behaviour …
> **No leak is detectable over three hours**"*. **That slope, and the
> first-versus-last argument resting on it, are withdrawn.**
>
> **Why.** The window it is computed over ends at `08:57:35Z`, **3 min 10 s
> after the run's own end at `08:54:25Z`**, and the sampler was still appending
> through container teardown and restart. Inside those three minutes the worker
> RSS series goes `116.21 -> 75.06` (shutting down), `80.84 -> ~0` (container
> gone - the raw sample is a signed underflow), then `~0 -> 133.64` (a **fresh
> container's startup RSS**). So the quoted `last = 133.6 MB` is not the run's
> last sample, it is a **different, restarted process**, and the quoted
> `min = 75.1 MB` is a shutting-down one. Nothing errored: the least-squares fit
> succeeded over well-formed rows and returned a plausible number. That is the
> same class of defect as everything else this campaign has found - the
> arithmetic worked and the answer was quietly wrong.
>
> **What is recoverable.** All of it. `rss-timeseries.csv` still holds the
> series, so the honest cut is available rather than lost. Cut at the run's end
> (n=131 per container, 06:40:39 -> 08:53:27) the worker slope is **+1.81 MB/h**
> - 2.7x the withdrawn figure - and first-versus-last is `133.09 -> 116.21`,
> which is 16.9 MB apart rather than 0.5.
>
> **What replaces it.** The table above, and this reading: **the run does not
> clear the worker either way.** +1.81 MB/h sits *inside* the ±1-2 MB/h that
> three hours cannot distinguish from jitter against a 45 MB oscillation band,
> so the honest answer is *not measured*, not *no leak*. The original report's
> own bound was right even though its number was not - *"a leak slower than
> ~1 MB/h would be invisible here; ruling one out needs a 24-hour window"* -
> and no 24-hour window was run.
>
> **Where this withdrawal has to land.** The report it corrects is **not on
> `perf-programme-2840`**; it exists only on `2840-sustained-mixed-load` and
> `2840-mixed-load-fixed`, neither merged. This block is the withdrawal; it
> needs copying into that report's § 4 by whoever lands those branches.

**What the corrected figures do and do not establish.** Two of the four slopes
are negative, so nothing in the series looks like a runaway. But **no leak is
ruled out**: against these oscillation bands a slope under roughly ±1-2 MB/h is
not distinguishable from jitter over three hours, and the worker's corrected
+1.81 MB/h sits inside that floor. For sizing purposes, use the measured
**maxima** in the table rather than any slope - a slope this run cannot resolve
should not enter a provisioning decision in either direction.

### Postgres memory is three numbers, not one

Getting this wrong is how a sizing figure ends up an order of magnitude out.

| Term | At this dataset | Reclaimable? |
|---|---|---|
| `shared_buffers` (SysV shared memory) | 128 MiB, configured | no |
| Anonymous RSS (per-backend) | 3-77 MB, oscillating | no |
| Page cache (`total_cache`) | 1 248-1 687 MB, mean **1 594 MB** | **yes** |

cgroup `total_rss` excludes shared memory, which is why the Postgres RSS column
above reads single-digit MB for a database serving a 4.8 GiB dataset.

### The 1.6 GB page cache is an appetite, not a requirement

Postgres will use whatever page cache it is given. What the measurement shows is
that at **this dataset** it stopped wanting more: the cache filled during the
first ~48 minutes as the hourly sweeps first touched the 2 003 176-row
`order_records` heap (F5 measured that heap at **~613 MB**) and the
50 006-product catalogue, then **plateaued** - 1 574 MB at the first sample,
1 608 MB at the run's end. It is that plateau which proves the earlier 8.8x rise
seen through `docker stats` was cache fill and not growth.

So **1.6 GB is ~33% of a 4.8 GiB database, at a 2M-order history**. Give it less
and Postgres reads from disk more often; give it more and it will cache more.
Reading it as a hard requirement produces a recommendation that is far too large
for a small install and still too small for a large one - **always tie a
page-cache figure to the dataset size it was observed at**.

There is one measured reason to care about this number rather than shrug at it.
At 1M orders, a single execution of the filtered orders-list `COUNT` read
**69 155 buffers from disk - roughly 540 MB pulled through the buffer pool on
every open of that page** (see [§ 7.4](#74-the-read-path-degrades-with-order-history-and-only-on-one-shape)).
Page cache is what keeps that off the disk.

The container carried **no memory limit** (`HostConfig.Memory = 0`; Postgres and
Redis are not even listed in the run's `containerLimits`), so the cache was
bounded by host pressure rather than by a cap. That is also a deployment fact -
see [§ 14](#14-two-deployment-facts-that-are-not-hardware-requirements).

---

## 7. Disk

Two figures, and they answer different questions. Using either for the other's
question is wrong by a factor of about twenty.

### 7.1 What an order costs on disk - **measured**

`order_records` + `order_line_items` together occupied **2 334 MB at 1 000 000
orders** (`pg_total_relation_size`, indexes included) - **~2.4 KB per order**.

Across **~3.5 rows** per order: 2 499 313 `order_line_items` over 1 000 000
`order_records` is 2.4993 lines per order, plus the order row itself. **That
3.5 is derived here, from F5's own row counts - F5 states no rows-per-order
figure**, and the number is a property of the synthetic seed's line-item
distribution (every seeded order gets 1-4 lines), not an observed production
write amplification. It also counts those two tables only.

**The 2.4 KB is explicitly a floor.** F5's own words: the seeded `orderSnapshot`
is a minimal synthetic document - `totals`, one `shippingAddress` field, an
`items` array of placeholder objects - and a real snapshot carries the full buyer
address, payment details and richer line items, so it is larger per row. F5 also
**refuses to derive a "days until 1M orders" figure**, because no arrival rate
was fixed for that scenario. Neither does this page.

An independent cross-check, **derived**: projecting 2.4 KB/order onto the
sustained run's 2 003 176 orders gives ~4 675 MiB against a measured database of
4 817.6 MiB, i.e. the two order tables account for **~97%** of that database. At
a large order history, order rows *are* the disk.

### 7.2 How fast the disk actually grows - **measured**

Under the sustained mixed-load composition (30 crons, catalogue sweeps, ~200
orders/h draining against a deliberately saturating 3 600 orders/h offered, at a
2M-order history and a 50 006-product catalogue):

| | Value | Label |
|---|---|---|
| Database, window start → end | 4 817.6 MiB → 4 847.4 MiB | measured |
| Growth over 3.00 h | **+29.8 MiB** | measured |
| **Rate** | **9.9 MiB/h** | derived |
| Per day | ~239 MiB/day | derived |
| Per year, nothing pruning | **~85 GiB/year** | extrapolated |

> A unit correction: the source report labels these MB where the underlying
> `pg_database_size` bytes are MiB. In decimal MB the same figures read
> 5 051.7 → 5 082.9 MB, +31.2 MB, 10.4 MB/h.

**Most of that growth is not orders.** The window ingested **651 orders** and
wrote **15 810 `sync_jobs` rows** (140 772 → 156 582). At 2.4 KB/order the orders
account for ~1.5 MiB, i.e. about **5%** of the 29.8 MiB. The rest is job rows and
index growth.

**So the two figures must not be substituted for each other.** 2.4 KB/order
sizes an order *history*; 9.9 MiB/h sizes a *disk*, and it is a property of the
cron composition and the offered rate, not of the order volume. **Do not scale it
by orders per day.**

### 7.3 Nothing prunes any of this

**Nothing in the OpenLinker database is deleted by age today.** There is no
retention job, no cron and no operator action that prunes history - 39 of the 79
tables grow without bound and nothing deletes from them. The ~85 GiB/year above
therefore accumulates.

- The inventory, the per-table policy, and what an operator loses when a row
  goes: [data-retention.md](./data-retention.md)
- The mechanism that would enforce it:
  [ADR-072](../architecture/adrs/072-append-only-table-retention.md) - designed,
  **not registered**
- **The retention epic: #2862.** Two tables already have their own issues -
  `sync_jobs` (#2946) and `automation_runs` (#2948) - and `sync_jobs` is the one
  the growth figure above is dominated by.

Provision disk you can grow, and treat #2862 as the thing that changes this
section.

### 7.4 The read path degrades with order history, and only on one shape

Not a hardware requirement, but it is what a large history costs. Median latency
through the HTTP API, **measured**, zero failed requests at every size:

| Route | 10k | 100k | 1M | 10k → 1M |
|---|---:|---:|---:|---:|
| orders list, needs-attention filter | 11.4 ms | 47.7 ms | **149.0 ms** | **13x** |
| orders list | 7.9 ms | 14.8 ms | 37.9 ms | 4.8x |
| whole page load | 28.0 ms | 35.0 ms | 58.0 ms | 2.1x |
| order detail | 5.9 ms | 5.9 ms | 6.0 ms | 1.0x |
| products list | 10.4 ms | 10.9 ms | 10.8 ms | 1.0x |
| sync-jobs list | 33.4 ms | 35.1 ms | 34.6 ms | 1.0x |

A hundred times the orders moved two routes and left four unchanged. Both movers
pay a `COUNT` over `order_records`; the four flat routes do not. At 100k,
39.6 ms of the filtered route's 47.7 ms is one `COUNT(*)` with a non-sargable
jsonb containment - the same table and the same predicate as the paged read
beside it, **155x apart**, because the paged read stops after 20 matches on an
index while the COUNT must evaluate every row.

**The pattern is "any list that reports an exact total", not "orders".** Faster
storage does not fix it; not asking for the total does.

---

## 8. Postgres configuration

Everything the campaign touched or recorded. **Nothing here was tuned** - the
stand ran `postgres:17-alpine` and neither compose file overrides
`shared_buffers` or `work_mem`, so those are image defaults that were *recorded*
into every manifest rather than chosen.

| Setting | Stand value | Status |
|---|---|---|
| `max_connections` | **200** | **set deliberately.** See [§ 9](#9-the-connection-budget-is-a-production-requirement) - this is the one you must compute for yourself |
| `shared_buffers` | 128 MiB | image default, untuned |
| `work_mem` | 4 MB | image default, untuned |
| `max_parallel_workers_per_gather` | 2 | image default, untuned |
| `max_wal_size` / `min_wal_size` | 1024 MB / 80 MB | image defaults |
| `statement_timeout` | 30 s | **stand-only**, not a product default |
| `shared_preload_libraries` | `pg_stat_statements,auto_explain` | **stand-only**, instrumentation |
| Extensions installed | `pg_trgm`, `pg_stat_statements` | `pg_trgm` is a product concern (category search) |

Three things this implies, all honest about their own limits.

**No `shared_buffers` recommendation is offered, because no other value was
measured.** The workload's ~1.6 GB of page-cache appetite was served by the
kernel, not by `shared_buffers`, and a run at a different setting does not exist.
Do not read 128 MiB as a recommendation either - read it as the value every
figure on this page was taken at.

**`work_mem` at 4 MB has one measured consequence.** In the campaign's own
`order_records`/`syncStatus` index decision, 4 MB made a GIN bitmap **lossy**,
and raising it to 64 MB eliminated that. **A production topology's actual
`work_mem` and `max_parallel_workers_per_gather` are unmeasured**, and that
decision doc says so itself.

**WAL flush is a measured binding constraint at webhook saturation**
(`LWLock:WALWrite` at ~600 req/s, [§ 5](#5-cpu)), which is why the operator lever
for that path is faster WAL storage rather than a larger machine or a tuned
index.

> **Do not copy `statement_timeout = 30s` onto a role your application pool
> shares** without understanding what it does. On the stand it was applied
> `ALTER ROLE`-wide and **cancelled a 1M-order bulk seed mid-transaction** - a
> 900k-row `INSERT` legitimately takes ~90 s. The fix was a session-scoped
> `SET statement_timeout = 0` in the seeder, and the general shape - a
> role-scoped setting silently reaching a migration or a bulk-admin job that
> shares that role - applies to a production topology too.

---

## 9. The connection budget is a production requirement

Stated today only in `apps/worker/.env.example` and in the perf harness's own
pre-flight guard, neither of which an operator sizing an install will read. It
belongs here.

### The arithmetic

```
OL_DB_POOL_MAX x (1 api + N workers)  <  Postgres max_connections
```

`OL_DB_POOL_MAX` defaults to **40** and bounds **one process**. It is *derived*
rather than picked: ADR-050's lane caps allow 26 concurrent handlers in one
worker (4 realtime + 12 bulk + 2 fiscal + 8 fan-out), every one of them does
database work, and a few hold a transaction connection while issuing a second
pooled query - so the floor is one connection per handler slot plus headroom for
that nesting and for the runner's own claim and heartbeat queries.

`OL_DB_POOL_CONNECTION_TIMEOUT_MS` defaults to **10 000 ms**.

| Workers | Processes | Budget | Needs `max_connections` ≥ |
|---:|---:|---:|---|
| 1 | 2 | 80 | 83 |
| 2 | 3 | 120 | 123 |
| 3 | 4 | **160** | **163** |
| 4 | 5 | **200** | 203 - **does not fit** a 200-connection server |

The `+3` is Postgres's own `superuser_reserved_connections` default. The stand
ran `max_connections=200`, which is why its own guard **refuses a fourth worker
replica** - correctly, and before the run rather than as a mid-window failure.

### What was actually observed

| Run | Replicas | Budget | Peak backends | of `max_connections` |
|---|---:|---:|---:|---:|
| Sustained mixed load | 1 | 80 | **46** | 23% |
| F4 bulk drain | 1 | 80 | 11 | 6% |
| F4 bulk drain | 3 | 160 | 30 | 15% |
| F3 webhook, 43-300 req/s | 1 | 80 | 1-3 | ~2% |
| F3 webhook, ~600 req/s | 1 | 80 | **41-42** | 21% |

All **measured**. Three readings are load-bearing:

**A peak of 46 against a pool of 40 is the api and worker pools summing, not a
violation.** The budget is per process.

**Idle pool connections count against `max_connections`.** At that peak of 46,
mean *active* backends was **1.02** and max 4 - so 45 of the 46 were idle pool
connections holding a server slot. **Size `max_connections` from the budget
arithmetic, never from the number of queries you expect to run at once.**

**At ~600 webhooks/s the pool is part of what saturates**, not spare capacity
sitting under a CPU limit: 41-42 observed against the api's own ceiling of 40.

### The failure mode, named

**An over-subscribed pool queues silently, then fails at
`connectionTimeoutMillis`.** pg's own `connectionTimeoutMillis` defaults to `0`,
meaning wait without limit - so on the library default, exhaustion is a stall
with no error anywhere and the symptom is *"the configuration change did
nothing"*. OpenLinker sets 10 s instead, so exhaustion surfaces as a job failure
that walks the ordinary retry ladder and appears on the jobs surface. A handler
holding a transaction connection while awaiting a second pooled query - the
order read model's line-item upsert, the webhook gate - can also **deadlock** the
pool once every connection is held that way, which is why the pool carries
headroom above the handler count rather than matching it.

**Past the pool, the server answers `sorry, too many clients already`
mid-window.** That is the failure the table above exists to prevent, and at the
application it is indistinguishable from a fault in whatever happened to be
running.

**Rule when you change a lane cap:** keep `OL_DB_POOL_MAX` at or above the sum of
the four TOTAL caps, per process, then re-check the table above. Every worker
replica also holds **one extra Redis connection** for its job-intake consumer.

---

## 10. Redis

| | Value | Label |
|---|---|---|
| Observed memory, sustained window | 38.7-51.8 MB (`used_memory` 38.65 MiB; cgroup RSS mean 47.8 MB) | measured |
| Observed memory, isolated flows | 18.4-18.5 MB, ~82 000 keys, ~98 ops/s | measured |
| Command latency | 0.12-0.18 ms over ~300 samples | measured |
| CPU | 0.48% mean, 14.11% max of one core | measured |
| Shipped `maxmemory` | **2 GB** (`REDIS_MAXMEMORY`) | configured |
| Shipped `maxmemory-policy` | **`noeviction`** | configured |

**Both settings are required and the policy alone is inert.** With the upstream
default `maxmemory 0` there is no eviction cycle, so `maxmemory-policy` is never
consulted and Redis grows until the OS OOM-killer takes the container - losing
the whole dataset, including every consumer group and pending entries list.

**`noeviction` is a decision, not a default.** Under any `allkeys-*` policy Redis
can evict a **whole stream key**, taking its consumer groups and PELs with it,
and no consumer receives an error - silent total loss. Failing the write instead
is the correct direction for a queue: back-pressure over data loss, and the
enqueue path already treats a failed `XADD` as retryable.

**2 GB is a declared floor with headroom, not a measured value.** It is sized
from the stream retention horizons, and total footprint cannot be read off the
retention table because `jobs.sync` is bounded by **age**, not count: at 50 000
jobs/day its 14-day horizon is ~700 000 entries (~350 MB) by itself, and
`events.inbound.webhooks` holds up to 50 000 entries whose payloads run 2-5 KB
(~100-250 MB). Raise it before widening any `maxAgeMs`.

> **Upgrading an existing install whose streams grew before retention existed:**
> run the one-time cleanup in
> [redis-stream-retention.md](./redis-stream-retention.md) **first**. Retention
> is applied lazily, on write, so a Redis that boots already above its cap
> refuses the very `XADD` that would trim it - a state it cannot leave on its
> own. `XTRIM` is not a `denyoom` command and is the way out.

---

## 11. Scaling: what replicas buy, and what they do not

### The order path is slot-bound, not resource-bound

Measured twice, independently, over the sustained window's steady phase:

| Method | Result |
|---|---|
| Little's law (`L = lambda x W`, n=405, W=31.44 s) | **L = 1.941** |
| Direct interval overlap (105 probes at 60 s) | mean 1.95, **max 2**, 0 probes above 2 |

The `realtime` per-scope cap is **2**, and it was binding at 100 of 105 probes.
The capacity model closes: `2 slots / 31.44 s = 229 orders/h` **derived**, and the
recovery phase measured **227.3 orders/h** - 99.3% of it.

Meanwhile the destination shop saw **~37 req/min against the 300 req/min it
declares - about 12% of its budget**. So the shop was not the constraint, and
neither was CPU, memory nor the pool. **A slot cap was.** Provisioning a bigger
machine moves none of those terms.

### What did move it - none of it hardware

| Configuration | Orders/h | Label |
|---|---:|---|
| **Then**-shipped defaults (shared intake Redis client, destination 60 req/min), isolated order path | ~207 | measured |
| Dedicated intake client, destination 600 req/min, **1 replica** | **2 233** | measured |
| Dedicated intake client, destination 600 req/min, **3 replicas** | **3 356** | measured |
| Shared intake client, destination 300 req/min, **under mixed load** (30 crons + sweeps) | **200.6** | measured, window `DISCARDED`, **and a configuration that never shipped** - see the banner below |
| **Today's shipped configuration, under mixed load** (dedicated client, destination 300 req/min) | **~962** | **interim, mid-window, verdict unwritten** |

**One software fix plus one destination rate limit bought ~10.8x on unchanged
hardware. Tripling the workers on top bought 1.50x.** The A/B isolates the two:
raising the request limit 10x alone changed nothing (226 → 225 orders/h); fixing
the wiring alone bought +47% (226 → 333); both together bought 10x.

The reason 3 replicas buy 1.50x rather than 3x is visible in the same run: at one
replica the bind is slots (63% of the destination's request budget used); at
three it is the shared Redis pace bucket (94%). Scaling converts a slot-bound
system into a bucket-bound one and then stops, because the bucket is shared by
design. The remaining ~6% is three processes contending on one Redis bucket.

> ## Do not quote 200.6 orders/h as "what OpenLinker does"
>
> **It is a configuration that never shipped.** Both of the changes that moved
> the order path are now defaults: the dedicated job-intake Redis client is
> **unconditional** as of #2984 (the `OL_JOB_INTAKE_DEDICATED_REDIS` seam is
> gone - there is deliberately no shared-client branch), and PrestaShop's
> manifest `defaultRateLimit` is **300 req/min** as of #2982, raised from 60 on
> the strength of [§ 12](#12-the-destination-shop-needs-sizing-too).
>
> The 200.6 orders/h mixed-load run carried the **new 300 req/min limit with the
> OLD shared client**, because its images predated #2984. So it is neither the
> old shipped configuration nor the new one, and reading it as *"what OpenLinker
> did before the fixes"* describes a build nobody ever ran.
>
> **There is no completed, verdicted capacity measurement of today's shipped
> configuration under mixed load.** The run that would produce one is in flight:
> arm B of the same scenario, one variable changed, and at **t+8 622 s of
> 10 800 s** it has completed **2 304 orders in 8 622 s - about 962 orders/h
> observed**, with the limiter-degradation counter at **0** against arm A's
> **1 454**. Per-order service time over the same arm fell from **32 404 ms to
> 6 014 ms** (5.39x), and 262 of 263 of its orders carry a destination
> `syncedAt`, so it is not fast failures.
>
> **Treat 962 as interim, not final.** It is a mid-window reading from a
> deliberately saturating window whose verdict is not yet written, and it is
> coming in roughly **20% below the 1 197 orders/h** the slot arithmetic
> (`2 slots x 3600 / 6.014 s`) predicts - the expected direction, since that
> arithmetic used an isolated service time. It is nonetheless the **honest
> statement about the shipped build**, and a stronger one than an extrapolation.
> The final figure and its verdict belong to that run's own report.

> **A `2.77x` replica scaling figure from F4 is withdrawn and must not be
> quoted.** That run's three replicas drained 600 bulk jobs 2.77x faster by
> hitting the destination at **158.4 req/min against the 60 req/min it
> declared** - the shared Redis rate limiter timed out at its own 1 s budget and
> fell back to per-process pacing, so three replicas became three independent
> buckets. It was measuring the defect, not scaling. With the client unshared,
> three replicas against a 60 req/min limit measured **54.5-55.1 req/min -
> under** the limit. The observation was real; **the attribution was wrong**, and
> ADR-050 carries the correction.

### What is and is not horizontally trivial

Verified against the wiring, not aspirational:

| Component | Scales how |
|---|---|
| **api** | stateless - JWT auth, state in Postgres/Redis. Run N behind a load balancer. This is the tier to add for webhook ingress ([§ 5](#5-cpu)) |
| **worker, `jobs` role** | add replicas. Correctness is the existing `FOR UPDATE SKIP LOCKED` claim; F4 measured work shared 33.4 / 33.3 / 33.3% across three replicas with no coordination beyond that, and the claim query's per-call cost stayed flat (0.087 → 0.086 ms) while replicas tripled |
| **worker, `scheduler` role** | **a fleet singleton, enforced by a Redis lease** (`singleton:scheduler`, TTL `OL_SCHEDULER_LEASE_TTL_MS`, default 60 s, heartbeated at TTL/3). Exactly one process ticks; a dead holder is replaced within one TTL. Scaling the api used to multiply every cron's fan-out by N - that is why the scheduler moved into the worker |
| **worker, `maintenance` role** | needs no lease - stuck-job recovery is an idempotent conditional UPDATE on a stale `lockedAt` |
| Postgres / Redis | single instances. All shared state lives here |

`OL_WORKER_ROLE` selects roles by **module import**, so a role that is off
contributes no providers, no consumers and no timers. An unknown role name fails
at boot rather than producing a worker that silently carries nothing.

**Lane caps and the DB pool both bound one process, deliberately** (ADR-050
§ Amendment (#2851 / #2867) adopts this as a decision, not an omission). So
`OL_LANE_BULK_SCOPE_CAP=8` on three replicas is up to 24 concurrent bulk children
per connection, and `OL_DB_POOL_MAX=40` on three replicas plus an api is 160
connections. Both multiply by the replica count; neither is enforced fleet-wide.

**No compose file in the repository declares `replicas`.** Multi-replica is
`docker compose up --scale worker=N`, and the worker service carries no
`container_name` so that it can be scaled at all. See
[perf-lab-stand.md](./perf-lab-stand.md) § "Scaling the worker".

---

## 12. The destination shop needs sizing too

The one place in the campaign where anything was measured against **explicit
cgroup CPU and memory limits** - and it is the shop, not OpenLinker. Six
PrestaShop profiles, 38 steps, 10 800 status-checked samples, on a 50 000-product
catalogue, with the verdict rule pre-registered before any constrained sample
existed. All **measured**.

| Profile | PrestaShop | MySQL | p99 at 5 req/s | CFS throttle events | Verdict |
|---|---|---|---:|---:|---|
| `P0-baseline` | unconstrained | unconstrained | 19.8 ms | 0 | **FREE** |
| `P1-vps2` | 2.0 cpu / 2 GiB | unconstrained | 18.5 ms | 0 | **FREE** |
| `P2-vps1` | 1.0 cpu / 1 GiB | unconstrained | 18.5 ms | 0 | **FREE** |
| `P3-shared` | 0.5 cpu / 1 GiB | 0.5 cpu / 1 GiB | 78.1 ms | 1 (354 ms) | **FREE** |
| `P4-shared-min` | 0.25 cpu / 1 GiB | 0.25 cpu / 1 GiB | 143.2 ms | 5 (1.3 s) | **DEGRADING** |
| `P5-boundary` | 0.1 cpu / 1 GiB | 0.1 cpu / 1 GiB | 598.1 ms | 38 (14.9 s) | **DEGRADING** |

Four findings that matter for provisioning:

**A constrained shop DEGRADES, it does not REFUSE.** 100% expected status at
every step of every profile - zero 429s, 503s, resets or timeouts, including a
tenth of a core at 10 req/s where p99 was 4.1 s.

**The median never moves.** p50 stayed 10.7-11.7 ms at 5 req/s on every profile
from 28 unconstrained cores down to a tenth of one. **The cost of a constrained
shop is entirely in the tail**, which is the shape CFS throttling predicts. So a
median-latency health check will not see it.

**One core is comfortably enough at these rates; half a core is not at 10 req/s.**
10 req/s is free at ≥ 1.0 cpu (p99 20.0 ms) but p99 is **616.7 ms at 0.5 cpu** and
**2 125.6 ms at 0.25 cpu**.

**This does not license an arbitrary request limit.** A `display=full` catalogue
page costs 395 ms unconstrained and **1 021 ms at a quarter core** - roughly 70x a
create-path read - and OpenLinker's limiter is **weight-blind**: it counts
requests, not cost. What bounds the damage is `maxConcurrent: 4`. The report's
own recommendation, labelled a judgement, was to raise PrestaShop's
`requestsPerMinute` 60 → 300 and **only** PrestaShop's; #2982 did exactly that.

**Memory was deliberately held realistic and non-binding** (PHP
`memory_limit=512M`), so these profiles measure shop **CPU** and say nothing
about shop RAM.

---

## 13. Which platforms these numbers cover

| Platform | In the measurements? |
|---|---|
| **PrestaShop** | **yes, real** - a live shop with a 50 006-product catalogue, the destination for the order path and the catalogue sweeps, and the only platform measured under constrained hardware ([§ 12](#12-the-destination-shop-needs-sizing-too)) |
| **Allegro** | **a stub, not Allegro.** `ol-perf:allegro-stub-2978`, with upstream latency *pinned* to the #2861 Allegro sandbox p50s (`events` 276 ms, `checkout` 1106 ms). Its quantity latency (120 ms) is assumed, not measured |
| **WooCommerce** | **present but not driven.** A connection existed and its crons ticked; no WooCommerce load was applied and no WooCommerce figure exists |
| **Erli** | **no.** No Erli arm exists anywhere in the campaign |
| **Invoicing / fiscalization** | **no.** The only fiscal probe was a latency probe with a deliberately invalid payload, rejected before any adapter was touched. Nothing ran against a real invoicing or fiscalization provider |
| **Shipping carriers (InPost, DPD)** | **no.** Their status-sync crons ticked; no label or tracking load was driven |

So the resource footprint is **one real shop plus a stubbed marketplace**. Real
Allegro latency - and therefore real per-order service time on that path - is
unmeasured; the sandbox figures replayed by the stub are the only ones the
campaign has.

Two further reasons every per-order **request** count on this page is a floor:
the stand's shop is **untaxed**, so a taxed catalogue pays about 2 more requests
per distinct product per order; and its buyers are **warm**, so a genuinely cold
deployment pays about 4 more per order for customer and address provisioning.

---

## 14. Two deployment facts that are not hardware requirements

Both were found by the campaign, and both change what an operator has to provide
around the machine.

**No compose service declares a restart policy.** `docker-compose.yml`,
`docker-compose.demo.yml` and `docker-compose.lab.yml` carry no `restart:` on
`api`, `worker`, `web`, `postgres` or `redis` - only the one-shot `migrate`
service carries an explicit `restart: 'no'`. This was found live: `lab-api` was
discovered `Exited (1)`, killed roughly two hours earlier and never restarted,
while sibling containers read healthy and nothing noticed. **Whatever supervises
your deployment has to restart these processes; the compose files will not.** See
[getting-started.md](../getting-started.md) and
[public-domain-demo-deployment-guide.md](../public-domain-demo-deployment-guide.md)
for the deployment story this belongs to.

**No OpenLinker container declares a CPU or memory limit.** Every run manifest
records `cpu_nanocpus: none` and `memory_bytes: none` for api and worker, and does
not list Postgres or Redis at all. Combined with Redis's `noeviction`, the OS
OOM-killer is the only backstop, and Postgres's page cache is bounded by host
pressure rather than by a cap. Every figure on this page was taken under those
conditions.

---

## 15. What this does not establish

Carried from the campaign's own reports, plus what this page adds.

### About the figures themselves

- **Any ceiling.** No flow was driven to failure on hardware that could be
  described as representative. **Every figure is a floor.**
- **Behaviour on dedicated hardware.** One contended workstation, pinning no
  CPUs, sharing ~15.5 GiB with two other full OpenLinker stacks. The isolated lab
  the campaign specifies **does not exist yet**, and these figures should be
  retaken when it does.
- **Any minimum.** No OpenLinker container was ever run on constrained hardware,
  so no minimum on this page was tested - every one is derived from observed
  usage.
- **The sustained mixed-load window is `DISCARDED`** by the harness's own rules:
  1 454 limiter-degradation lines, 650 orders with a failed `syncStatus` entry,
  474 jobs with `attempts > 1`. It is a legitimate *before* figure for the
  intake-client fix and legitimate evidence for the concurrency finding; it is
  **not a clean capacity measurement**, and the footprint figures in
  [§ 6](#6-ram) and [§ 7](#7-disk) travel with that verdict attached.
- **A completed capacity measurement of today's shipped configuration under
  mixed load.** Both of the changes that moved the order path by 10x are now
  defaults, and the run measuring them together with the crons and sweeps is
  still in flight: the honest figure is an **interim ~962 orders/h at t+8 622 s
  of 10 800 s**, verdict unwritten. **And 200.6 orders/h is not the "before"
  figure for it** - that run carried the new rate limit with the old shared
  client, a configuration that never shipped. Both points are set out in
  [§ 11](#11-scaling-what-replicas-buy-and-what-they-do-not).
- **F1's order-path figures are withdrawn** (#2847): all four runs are
  `DISCARDED` and their 66 s latency and 182-295 orders/h numbers must not be
  quoted.
- **F4's `2.77x` replica scaling is withdrawn** - see
  [§ 11](#11-scaling-what-replicas-buy-and-what-they-do-not).
- **F7's `degraded_mode_entries = 0` is withdrawn**, as is its 32x/35x
  queued-depth ratio: its post-guard filtered `docker logs` with
  `--since "@epoch"`, a form Docker accepts while matching nothing, so no
  scenario in this campaign could see a degraded line until it was fixed.
- **The sustained run's `+0.67 MB/h` worker RSS slope is withdrawn**, and with it
  the *"no leak is detectable"* reading that rested on it - the slope was fitted
  over a window ending past the run, whose last sample is a **restarted
  container**. The withdrawal, the honest `+1.81 MB/h`, and the note that it
  still has to be copied into the report it corrects are in
  [§ 6](#6-ram).
- **Every worker-side timing figure in this campaign is a debug-level figure.**
  `apps/worker/src/main.ts` hardcodes the logger array with no env override, so
  nothing measured OpenLinker's own service times at a production log level.
  Debug logging inflates them.

### About memory

- **No leak is ruled out.** Three hours cannot see a slope under ~1-2 MB/h
  against these oscillation bands, and the worker's corrected +1.81 MB/h sits at
  that floor. A 24-hour window is what would settle it, and none was run.
- **There is one cgroup memory series in the whole campaign**, produced by an
  out-of-band sampler that is not in the harness on this branch, covering 73.9%
  of one run. Every other run has no trustworthy per-process memory figure at
  all, because the harness collects memory only through `docker stats`.
- **The page-cache figure is dataset-bound.** 1.6 GB is what Postgres wanted at a
  4.8 GiB database with a 2M-order history. It is not a requirement and does not
  transfer to another dataset size.

### About coverage

- **No footprint sample below ~2M orders.** No RAM, CPU, page-cache or connection
  figure exists at 10 000 or 100 000 orders.
- **No api-tier CPU under operator read load, at any dataset size.** The sustained
  window's api was idle (mean 0.016% of one core).
- **No worker CPU at a rate that made it the constraint.**
- **Read-path cost at a large history of the *other* tables.** F5 seeded
  `order_records` and `order_line_items` to 1M and held `sync_jobs` constant. The
  other 37 unbounded tables were not seeded, so a read joining against a large
  `sync_jobs`, `webhook_deliveries` or `automation_runs` history is unmeasured -
  and the sync-jobs list is already the slowest route.
- **No production Postgres tuning.** `shared_buffers`, `work_mem` and
  `max_parallel_workers_per_gather` were image defaults on every run, and no
  alternative value was measured except the one `work_mem` observation in
  [§ 8](#8-postgres-configuration).
- **No stock churn independent of the order rate.** The sustained window carried
  the incidental stock path every order fires, but no operator-originated churn.
- **Nothing at 4 or more worker replicas.** The connection budget refuses it at
  `OL_DB_POOL_MAX=40` against `max_connections=200`.
- **Nothing about a second destination connection.** One `bulk`-capable
  connection existed, so the `bulk` lane's TOTAL cap was never binding and
  cross-scope fairness was not exercised at all.
- **Production upstream latency.** The Allegro figures are sandbox figures,
  replayed by a stub.
- **Which of the 30 crons costs what.** The runs measure the aggregate. Nothing
  in the tree exports per-task cost - the metrics exporter (#2850) does not
  exist, which the campaign calls its biggest single gap in answering "slots or
  the loop?".
- **Shop RAM.** [§ 12](#12-the-destination-shop-needs-sizing-too) deliberately
  held shop memory non-binding, so it measures shop CPU only.
- **The persona these premises were written for has moved.** Several shipped
  decisions cite a volume of 10-100 orders/day in their own reasoning while the
  programme now targets ~1000 orders/day. The decisions may still be right; the
  arguments for them name a number that is out by 10x. See **#2886**.

### Still open, and not closed by this page

- **How to read the rate-limit budget.** #1136 asks for a sizing page *and* a
  scaling story; this page answers the sizing half and the statelessness half
  ([§ 11](#11-scaling-what-replicas-buy-and-what-they-do-not)). It does **not**
  give an operator a procedure for reading a destination's rate-limit budget and
  deriving what their own install can push - which is the term that actually
  moved the order path by 10x, whose governing arithmetic is
  `orders/hour ceiling = requestsPerMinute / requests-per-order x 60`, and where
  the campaign separately found that removing four cacheable per-order requests
  would raise that ceiling ~3.1x with the shop's request rate untouched. No child
  of #2840 writes it. **#1136 stays open for that half.**

---

## Related

- [perf-lab-stand.md](./perf-lab-stand.md) - the stand every figure came from,
  and how to scale its worker
- [data-retention.md](./data-retention.md) - what grows, and what nothing deletes
- [redis-stream-retention.md](./redis-stream-retention.md) - the Redis caps and
  the one-time upgrade cleanup
- [ADR-050](../architecture/adrs/050-workload-isolation-concurrency-lanes.md) -
  the lane caps, the DB pool derivation, and why both stay per-process
- [ADR-051](../architecture/adrs/051-worker-topology-one-artifact-roles.md) -
  worker roles and the scheduler singleton
- [ADR-072](../architecture/adrs/072-append-only-table-retention.md) - the
  retention mechanism, designed and not registered
- `perf/openlinker-throughput/campaign-2026-09-06.md` and the `results-*.md`
  beside it - the runs themselves
- **#2840** the performance campaign - **#2862** retention - **#1136** the
  original request - **#2886** the persona change - **#2853** rate-limiter
  degraded mode
