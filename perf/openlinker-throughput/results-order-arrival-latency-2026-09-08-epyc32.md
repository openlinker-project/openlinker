# How long after a buyer places an order does it appear in OpenLinker?

> **PRE-REGISTERED — the window has not run yet.** Everything in § 0-§ 2 was
> written and committed **before the window opened**. Results appear in § 3
> and nowhere above. Every `TBD` is a figure this run has not produced.
> Nothing here may be quoted until this banner is gone.

**Host**: `epyc32` — see `machine-spec-epyc32-2026-09-08.md`, captured
2026-09-08T11:02:45Z. Dedicated perf stand, **nothing else runs on it**; that
is a *condition of this measurement*, not a footnote — see § 1.1.

**Scenario**: `scenarios/f1-order-ingestion.sh --latency-only` with
`F1_SCHEDULER_ON=1` (this issue's addition).

## 0. Why this run exists, and what is different about it

F1 measured a per-order latency ladder but **excluded the poll wait by
construction**: the scheduler was off and the harness enqueued every
`marketplace.orders.poll` itself, so F1's own header calls hop A "a cadence
this script chose … NOT a figure any deployment experiences". On top of that
every F1 window is `DISCARDED` and #2847 **withdrew** its 66 s and
182-295 orders/h figures.

So the campaign has no answer to the question a buyer actually arrives with,
and which six competitors publish:

| Vendor | Published claim | Shape |
|---|---|---|
| Apilo | orders appear **within 5 minutes** of placement | latency |
| Channable | 5 minutes | cadence |
| Pipe17 | 5 minutes | cadence |
| BaseLinker | 10 minutes default (1 min on a paid accelerator) | cadence |
| ShipStation | **2 hours** import floor | cadence |
| Linnworks | hourly (CSV) | cadence |

This run turns hop A into a **measurement of the running scheduler**.

## 1. Conditions, declared before the run

### 1.1 The dedicated host is a condition of the figure

Every other figure in this campaign was taken on a workstation carrying two
or three co-tenant Docker stacks. This measurement is latency, serial, and
single-order: it is the figure most sensitive to a neighbour stealing a core
at the wrong instant. It was moved to a dedicated host for that reason, and
the report states it because a reader reproducing this on a shared machine
should expect a worse and noisier number, not conclude the instrument is
broken.

### 1.2 Scheduler ON, and the guard waived deliberately

`guard_scheduler_off` is **deliberately not called**, and the waiver is
recorded in the manifest as `schedulerPosture` /
`guardSchedulerOffWaived: true`. That guard's own docblock authorises a
scenario that wants the scheduler on to skip it, provided it records the
resolved task inventory and the cadences — which § 3.1 does.

The trap this must not fall into is F1's own words: **"a scenario that
silently measures a configuration it did not request is the worst failure
mode this harness has."** So hop A must not become a second harness-chosen
constant under a different name. Two rules follow, both enforced in code
rather than asserted in prose:

1. **Every scheduler fact is read back from the worker's own startup log**
   (`Registered scheduler task: <taskId> (scope: …, jobType: …, cron: …)`),
   never inferred from config or from the code's default. This is the pattern
   `scenarios/sustained-mixed-load.sh` already uses (`mixed_wait_for_scheduler`).
2. **The poll attributed to a sample must be a scheduler-minted poll.** The
   scheduler's key is `marketplace:{connId}:orders:poll:{timestamp}`; the
   harness's own is `marketplace:{connId}:orders:poll:{tag}:{ms}`. The sample
   loop matches `…:orders:poll:[0-9]+$` so a harness-enqueued poll can never
   be mistaken for a scheduled one.

### 1.3 The compose passthrough defect this run had to fix first

The brief asks for the master catalogue sweeps to be disabled so `fan-out`
co-tenancy stays controlled — `master.product.syncAll` and
`master.inventory.syncAll` parents share the `fan-out` lane with
`marketplace.orders.poll` itself.

**Setting those env vars would have changed nothing.** `docker-compose.lab.yml`
substitutes `${VAR}` only for keys the service itself lists, and the `worker`
service listed none of `OL_PRODUCT_SYNC_ENABLED`,
`OL_INVENTORY_SYNC_ENABLED`, `OL_MASTER_PRODUCT_RECONCILE_ENABLED`. This is
the identical trap the file's own `OL_JOB_INTAKE_DEDICATED_REDIS` comment
records ("exporting this around `docker compose up` … changed NOTHING before
this line existed") and the identical trap `assert_lane_caps` was added for.
Left unfixed, this window would have run with all three sweeps live while the
manifest claimed they were off — exactly the failure § 1.2 quotes.

The three keys are therefore added to the worker service, and AC2 below
**verifies the result in the worker's own task inventory** rather than
trusting the variable.

### 1.4 Held constant

Source `perf-allegro-a` (`ALLEGRO_A_CONNECTION_ID`), destination the **real
local PrestaShop** (never the stub), WooCommerce disabled for the arm so the
`syncStatus[].syncedAt` late-bias is removed structurally (F1's existing
single-destination arrange), 25 serial samples, one order in flight at a
time, images as built at 2026-09-08T11:12/11:17Z carrying #2984.

## 2. Pre-registered acceptance criteria

These were committed before the window opened and are **not moved
afterwards**. If the run fails one, that is the result.

| # | Criterion | If it fails |
|---|---|---|
| **AC1** | ≥ 20 of 25 samples reach a destination `syncedAt` | figures reported with the reduced `n` stated beside every percentile; not promoted to a headline |
| **AC2** | the worker's task inventory contains `allegro-orders-poll` at cron `*/1 * * * *`, and contains **none** of `master.product.syncAll`, `master.inventory.syncAll`, `master.product.reconcile` | window **DISCARDED** for uncontrolled `fan-out` co-tenancy — never silently reported |
| **AC3** | hop A median ∈ [0 s, 60 s] and p90 ≤ 60 s | the poll is not firing at `*/1`; the cadence claim is **void** and no end-to-end figure may be quoted |
| **AC4** | no `post_guard_limiter_degraded` firing inside the window | count reported as a finding; figures scoped (this is the #2984 regression check) |
| **AC5** | claim-instant provenance printed; any hop with n < 20 carries its n | that hop is reported but excluded from the headline ladder |

### 2.1 The falsifiable prediction, stated before the data

Mean poll wait at `*/1` is **30 s** (derived: uniform arrival over a 60 s
period). Added to F1's ladder the expected end-to-end median is **≈ 90-100 s**.

**That prediction leans on a withdrawn figure and is therefore weak
evidence, and is written down anyway so it can be wrong in public**: F1's 66 s
was withdrawn by #2847, so the ladder term is *not* a citable input. If the
measured end-to-end median lands materially above **150 s**, the "well under
Apilo's five minutes" claim this run exists to support is **void** and must
not be quoted.

## 3. Results

TBD — the window has not run.

## 4. What this did not establish

TBD.
