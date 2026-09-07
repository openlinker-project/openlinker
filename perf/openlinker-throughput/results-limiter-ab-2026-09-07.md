# Rate limiter A/B - what raising the limit actually buys

**Runs**: `results/limiter-ab/limiterab1788770658` (nine windows, arms A/B/C/D)
and `results/limiter-ab/limiterabBDED1788775906` (four windows, arms BD/ED).
**Date**: 2026-09-07. Thirteen windows of 300 s, n >= 2 per arm.
**Image** at `8c1c0bbe7ee52cf8683cf2a888c926457626ef7a` for every window -
`guard_build ok`, product paths identical to the working tree. One worker
replica (`lab-worker-1`).
**Scenario**: `perf/openlinker-throughput/scenarios/limiter-ab.sh` (#2840).

> **The stand is a Docker Compose project on a contended developer
> workstation, not an isolated lab.** Every figure below carries that. Numbers
> are labelled **measured**, **derived** (arithmetic over measured inputs) or
> **extrapolated** (a projection past what was measured). The sections
> "Verdicts" and "What this did not establish" are not optional reading.

---

## 1. The answer, in plain language

An adopter's question is: *"if I raise OpenLinker's request limit for my shop,
do I get more orders through?"*

**On the shipped build: no. After a one-file wiring fix: about ten times as
many.** Same setting, opposite answers - and the reason the setting does
nothing today is a defect, not a design choice.

| What we changed | Orders per hour | vs shipped |
|---|---:|---:|
| **Nothing** - shipped defaults (60 requests/min, 4 at a time) | **226** | - |
| Raised the request limit **10x**, to 600/min | **225** | **no change** |
| Raised how many requests may overlap **8x**, to 32 | **225** | **no change** |
| Left every setting alone and **fixed the wiring** | **333** | **+47%** |
| Fixed the wiring **and** raised the request limit 10x | **2 279** | **10x** |

All five figures are **measured**, each the mean of at least two independent
five-minute windows. The fourth row changes nothing an operator can see: it
gives one internal component its own connection to Redis instead of sharing
one. The fifth row is the fourth plus the setting that did nothing on its own.

The short version: **OpenLinker's speed limit was not what held it back - a
stall inside the component that enforces the limit was.** While that stall was
happening, OpenLinker used only about two-thirds of the speed it was already
allowed, and raising the allowance changed nothing because it was never
reaching the old one. Fix the stall and the limit becomes real: it is then
worth a factor of ten.

**What this means for anyone tuning a deployment**: the request limit is the
knob that matters, the "how many at once" knob is not (§ 6), and **neither is
worth touching until the wiring fix is in** (§ 5).

---

## 2. Why it was already settled how the limit works

Read out of the source, not inferred from the measurement, and stated first so
the results are read against a prediction rather than turned into one
afterwards.

`libs/shared/src/rate-limit/rate-limiter.ts:198`:

```ts
const minIntervalMs = 60_000 / requestsPerMinute;
this.nextAvailableAt = Math.max(this.nextAvailableAt, nowMs) + minIntervalMs;
```

**One timestamp, no budget counter.** At 60 requests/minute that is a minimum
of one second between the *starts* of two requests to the same connection.
`Math.max(nextAvailableAt, nowMs)` is what makes idle time earn no credit: a
connection quiet for a minute does not bank sixty requests' worth of
allowance, it simply becomes eligible again and then pays the full interval for
its next request. The Redis path is the same arithmetic in a Lua script
(`redis-rate-limiter.adapter.ts:195-214`, called at `:667`) - one key holding
`nextTs = now + interval`, with a TTL, and again no counter.

Both gates are checked in one loop and both must pass (`rate-limiter.ts:168`
concurrency, `:179` pace), on **one bucket per connection**. The pace gate
limits **admission**, not completion, so requests may overlap in flight but can
only *start* one interval apart. That is why raising `maxConcurrent` cannot
rescue the spacing - the prediction arms C and ED exist to falsify.

PrestaShop declares `{requestsPerMinute: 60, maxConcurrent: 4}`
(`prestashop-plugin.ts:84`), wired through `host.http.forConnection` for every
capability adapter.

---

## 3. The arms

One variable per arm. This is the gap the run exists to close: F1
(`results-F1-2026-09-07.md`) raised `requestsPerMinute` 60 -> 6000 **and**
`maxConcurrent` 4 -> 32 in one step, so it could not say which mattered.

| Arm | req/min | at a time | realtime lane | Redis client | Isolates |
|---|---:|---:|---:|---|---|
| **A** | 60 | 4 | 4/2 | shared | the shipped default |
| **B** | 600 | 4 | 4/2 | shared | the spacing term alone |
| **C** | 60 | 32 | 4/2 | shared | the concurrency term alone |
| **D** | 60 | 4 | 4/2 | **dedicated** | the degradation, at shipped settings |
| **BD** | 600 | 4 | 4/2 | **dedicated** | the spacing term, on a CLEAN instrument |
| **ED** | 60 | 32 | **16/16** | **dedicated** | concurrency made genuinely REACHABLE |

Arms A/B/C ran **interleaved** (A B C / A B C), not blocked, so a slow period
on a contended workstation lands across every arm instead of on one. They also
share ONE worker process, because they need no restart: the policy is resolved
fresh on every outbound call
(`libs/shared/src/http/http-transport-factory.ts:148`) and passed into
`limiter.acquire(policy, ...)`, so a `config.rateLimit` change lands on the
next request. The arms that change worker environment cannot join that block,
so they ran as consecutive pairs, and a **drift-control repeat of arm A** ran
last to show whether the stand had moved underneath them.

Arm A writes an **explicit** `60/4` rather than deleting the key, reversing
F1's choice deliberately. An explicit value equal to the manifest default is a
different *persisted* state but not a different *effective* one - resolution is
`config.rateLimit ?? defaultRateLimit` and the manifest declares exactly
`{60, 4}`, so both hand the same object to the same function. Writing it keeps
A -> B a change in `requestsPerMinute` only and A -> C a change in
`maxConcurrent` only. Every arm's persisted value is read back from the API and
recorded in its own manifest, and every worker setting is read back off the
worker's own log line.

---

## 4. Results - every window, not just the means

All **measured**. `dest req/min` is PrestaShop's own access log over the
window. `max running` is an **upper bound** on concurrency
(`sync_jobs.status` over-reads: a handler that finished before its terminal
write committed still reads `running`).

| Arm | Window | Orders | Orders/h | dest req/min | budget used | req/order | max running | degraded lines |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| A | r1 | 18 | 218 | 41.0 | 68% of 60 | 11.28 | 3 | 42 |
| A | r2 | 19 | 231 | 43.0 | 72% of 60 | 11.16 | 3 | 54 |
| A | drift | 19 | 230 | 42.0 | 70% of 60 | 10.95 | 3 | 50 |
| B | r1 | 19 | 231 | 45.0 | **7.5% of 600** | 11.68 | 3 | 58 |
| B | r2 | 18 | 219 | 40.7 | **6.8% of 600** | 11.17 | 3 | 34 |
| C | r1 | 18 | 218 | 41.8 | 70% of 60 | 11.50 | 3 | 43 |
| C | r2 | 19 | 231 | 41.6 | 69% of 60 | 10.79 | 3 | 56 |
| **D** | r1 | 28 | 339 | **60.0** | **100% of 60** | 10.61 | 2 | **0** |
| **D** | r2 | 27 | 327 | **60.0** | **100% of 60** | 11.00 | 3 | **0** |
| **BD** | r1 | 186 | 2 255 | 382.8 | 64% of 600 | 10.19 | 2 | **0** |
| **BD** | r2 | 190 | 2 303 | 388.7 | 65% of 600 | 10.13 | 3 | **0** |
| **ED** | r1 | 25 | 303 | 53.1 | 88% of 60 | 10.52 | **17** | **0** |
| **ED** | r2 | 23 | 280 | 51.7 | 86% of 60 | 11.09 | **17** | **0** |

Per arm (**derived** from the rows above):

| Arm | n | Orders/h per run | Mean | Spread | vs A | vs D |
|---|---:|---|---:|---:|---:|---:|
| A (baseline) | 3 | 218, 231, 230 | **226.3** | 13 (5.7%) | - | |
| B (10x rate, shared) | 2 | 231, 219 | **225.0** | 12 (5.3%) | **-0.6%** | |
| C (8x concurrency, shared) | 2 | 218, 231 | **224.5** | 13 (5.8%) | **-0.8%** | |
| D (dedicated client) | 2 | 339, 327 | **333.0** | 12 (3.6%) | **+47.1%** | - |
| BD (10x rate, dedicated) | 2 | 2 255, 2 303 | **2 279.0** | 48 (2.1%) | **+907%** (10.1x) | **6.84x** |
| ED (reachable concurrency) | 2 | 303, 280 | **291.5** | 23 (7.9%) | +28.8% | **-12.5%** |

**The instrument's resolution on the slow arms is one order.** At 18-19 orders
per five-minute window a single order is 5.4% of the rate, and *every* A/B/C
window produced either 18 or 19. The difference between those three arms is
entirely which windows happened to land 19 - which is why n >= 2 and
interleaving were requirements rather than niceties, and why a single-run
comparison would have reported a 6% "gain" for whichever arm drew the 19.

**The drift control holds.** Arm A repeated last, after both arm D windows and
two worker recreates, and measured 230 orders/h - inside the 218-231 band its
earlier repeats set. The stand did not improve over the hour, so arm D's
327-339 is the change under test and not the clock.

---

## 5. The finding: one shared Redis client was the first ceiling

**The degradation is eliminated, not reduced: 34-58 lines per window became 0,
in all six windows on the dedicated client.** Measured, by a guard proved able
to fail before any zero was believed (§ 8).

The defect is in the wiring. `JobIntakeConsumer` blocks on `xReadGroup` with
`BLOCK: 5000` in a loop (`apps/worker/src/sync/job-intake.consumer.ts`) on the
worker's shared `'REDIS_CLIENT'`, and `RateLimitModule` builds the outbound
rate limiter's registry on that **same** client
(`libs/plugin-sdk/src/rate-limit.module.ts:70`, `inject: ['REDIS_CLIENT']`).
Redis serves no further commands from a connection parked in a blocking read,
so a pace `EVAL` queued behind an in-flight block waits out that block's
residual - up to 5 s, against the limiter's own 1000 ms timeout. Past it the
limiter logs *"falling back to per-process in-memory limiting"* and stops being
the thing it was configured to be.

`apps/worker/src/events/events-consumer.module.ts:23-26` already carries a
comment describing this exact hazard and gives its own stream consumer a
dedicated client. The limiter never got that treatment. **The fix is one
provider**, and the seam this run used to measure it is
`OL_JOB_INTAKE_DEDICATED_REDIS`.

**The budget column is what makes it legible.** On the shipped build the
limiter never reaches its own allowance - 41 to 45 of 60 requests per minute,
about 70%. With the dedicated client it saturates it **exactly**: 60.0 req/min
in both arm D windows. And the resulting throughput lands on the arithmetic
ceiling the pace gate implies, to within one order per hour:

| Window | req/order (measured) | ceiling = 60 / req-per-order x 60 (derived) | measured orders/h |
|---|---:|---:|---:|
| D r1 | 10.61 | 339.3 | **339** |
| D r2 | 11.00 | 327.3 | **327** |
| A r1 | 11.28 | 319.1 | 218 (68% of it) |
| A r2 | 11.16 | 322.6 | 231 (72% of it) |

So the pace gate **is** a hard ceiling of `60 / requests-per-order` orders per
hour - and on the shipped build you never reach it, because the degradation
takes about a third of it away first.

**And that is why arm B measured nothing.** Arms B and BD apply the *identical*
rate-limit change, 60 -> 600 requests/min. On the shared client it is worth
-0.6%; on the dedicated client it is worth 6.84x. The degradation was not
merely costing throughput, it was **masking the entire effect of the setting** -
which is the strongest reason to read this as a defect to fix rather than a
figure to tune around.

**What this run does not attribute** is the arithmetic of the 47% in arm D.
About 48 timeouts per 300 s window at 1000 ms each is ~48 s of stall, and with
at most 2-3 concurrent requesters that does not by itself account for a third
of the throughput; the per-process fallback also resets pacing state, and the
two contributions were not separated. The **effect** is measured twice and is
unambiguous; the **decomposition** is not established.

---

## 6. Did arm C falsify the mechanism? No - it is confirmed, and ED is why

**No.** Raising `maxConcurrent` 4 -> 32 alone moved the rate by -0.8%, inside
the 5.8% spread arm A shows against itself. The prediction that concurrency
cannot rescue the spacing is **not** falsified.

Arm C on its own would not have been enough to say so, and the scenario said
this before the run: a null on arm C has two available explanations.

- **(a)** the pace gate binds regardless of concurrency - the hypothesis; or
- **(b)** `maxConcurrent: 4` was **never the binding constraint**, so raising
  it could not have done anything either way.

**(b) was true.** `max running` never exceeded 3 in any A/B/C/D/BD window,
against a limiter ceiling of 4. The reason is one level up:
`OL_LANE_REALTIME_SCOPE_CAP` defaults to 2 (`sync-job.runner.ts`; the worker's
own boot line reads `realtime=4/2`), so at most two order syncs run at once per
connection and each makes its destination calls sequentially. Two concurrent
requesters never reach a ceiling of four.

**Arm ED settles it.** It raises the realtime lane to 16/16 - verified from the
runner's own startup line, `realtime=16/16` - so concurrency becomes genuinely
reachable, and holds the pace budget at the shipped 60. Observed concurrency
rose from 3 to **17**. Throughput did **not** rise: 291.5 orders/h against arm
D's 333.0, i.e. **12.5% lower**, and the destination request rate stayed at
52-53 of the 60 allowed rather than the 60.0 arm D achieved with two workers.

So explanation (a) is now positively demonstrated rather than merely
consistent: **with 8x the reachable concurrency and the same pace budget,
throughput did not improve - it got slightly worse.** Seventeen workers all
queueing on one pace bucket pay coordination cost for admissions the bucket was
never going to grant faster. One of the two ED windows also recorded a genuine
destination-create *failure* (§ 9), which no other window in the campaign did.

**The operational reading**: raising the concurrency knob, or the lane cap
behind it, is at best neutral and can be negative. The request limit is the
knob that moves the number - and only after § 5's fix.

---

## 7. What binds after the limit is raised

At 600 req/min on the dedicated client, arm BD used only **64%** of its budget
(383-389 of 600) while observed concurrency stayed at 2-3. So the pace gate is
no longer the ceiling there; the ceiling is **two concurrent order syncs times
the per-order work each does**. **Derived** from arm BD: 186-190 orders per
297 s across 2 slots is ~3.2 s per order per slot, for ~10.2 destination
requests - about 310 ms per request of non-paced time, against a shop that F1
measured answering create-path calls in 11-20 ms.

That is consistent with F1's conclusion that ~99.5% of the destination hop is
OpenLinker-side, and it names the next thing to look at. It is **not** an
instruction to raise the lane cap: arm ED did exactly that at the shipped rate
limit and lost 12.5%. The pair to test is a raised lane cap *together with* a
raised rate limit, which this run did not measure.

---

## 8. Instruments, and the guard proved before it was trusted

**`post_guard_limiter_degraded` counts the degradation, and it was verified
able to FAIL.** It answered zero on every scenario of this campaign before
#2851 fixed it, because `docker logs --since "@<epoch>"` is accepted without
error and returns nothing - a bare epoch is required. A guard that cannot see
reads exactly like a clean run, so before any zero in this report was believed
it was checked against real Docker (not the `lib-test.sh` stub) with a
throwaway container emitting one degraded-mode line at a known instant:

| Check | Result |
|---|---|
| the guard, window containing the line | `DISCARDED ... 1 degraded-mode log line(s)` |
| the guard, window before the line | `ok` |
| the broken `@epoch` form, same window | 0 lines |

That check is `--smoke` in the scenario, so it is re-runnable rather than a
claim in a report. **The zeros in § 4 are measured absences, not unseen
presences.**

**Requests-per-order is measured per arm, never reused.** It varies with buyer
warmth (F1 measured 14.06 with all-cold buyers; this run's windows are
10.13-11.68), so the derived ceilings move with it and a figure carried over
from another run would have made every ceiling in § 5 wrong. It comes from
PrestaShop's own access log - `/api/` requests plus `POST /index.php` module
calls, both counted because both pass through the same per-connection bucket.

**Every applied setting is read back, never assumed.** `set_rate_limit`
re-reads the connection through the API; `assert_intake_client` reads the
worker's own log line rather than `printenv`, because `printenv` proves the
request arrived and only the log line proves the code took the branch;
`assert_lane_caps` reads the runner's own startup line. All three refusals
earned themselves during this work - one on an unanchored `grep` that matched
the `DEDICATED` inside `OL_JOB_INTAKE_DEDICATED_REDIS`, one on a JSON
comparison that failed on key order alone, and one on an `ARM_SPECS=""` that
`${VAR:-default}` silently replaced with the full default set. All three are in
`docs/lessons.md`.

**Load was never the limit.** Every one of the thirteen windows reports
`queue growth: YES` and a minimum available work of 800-899, so the system was
offered more than it took throughout and each sustained rate is the service
rate - the knee, not a floor on the offered load.

---

## 9. Verdicts: which figures may travel

**Every window is labelled DISCARDED, and the causes are not equally serious.**

| Arms | Discard reasons |
|---|---|
| A, B, C, drift (7 windows) | `post_guard_destination_creates` (1-2 orders lack `syncedAt`) **and** `post_guard_limiter_degraded` (34-58 lines) |
| **D, BD, ED (6 windows)** | `post_guard_destination_creates` **only** - the limiter guard answered `ok` |

`post_guard_destination_creates` **fires structurally on any saturation
window**: the point of one is to end with work in flight, so orders created
inside the window and still mid-create when it closes necessarily lack
`syncedAt`. This run supplies unusually direct evidence that it is structural -
the count tracks concurrency, not health: 1-3 orders at 2-3 concurrent workers,
and **16-17 at ED's 17**. F1 recorded the same guard gap, needing either a
bound at `window_stop - max_expected_duration` or an explicit "in-flight is
expected" input.

The one substantive exception: **ED r1 also recorded 1 order with a genuinely
FAILED `syncStatus` entry** - the only real destination-create failure anywhere
in the thirteen windows, and it appeared at 17-way concurrency. That is
reported as part of arm ED's result rather than filtered out.

`post_guard_attempts`, `post_guard_deferrals`, `post_guard_requeues`,
`post_guard_containers_stable` and `post_guard_feed_starved` answered `ok`
everywhere.

So, plainly:

- **The dedicated-client arms' figures may travel** (D, BD, ED), with the
  standing stand caveat. Their only discard is the structural one, their
  degradation counts are verified zeros, and each is reproduced twice.
- **The A -> D and D -> BD comparisons may travel.** Each is one variable, on
  one image, with the drift control ruling out the clock.
- **The A/B and A/C nulls may travel as operator-facing answers** - raising
  either knob on the shipped build changes nothing - and § 5 explains *why*
  rather than leaving them as bare nulls.
- **No figure here is a published OpenLinker throughput number.** They measure
  one seeded stand, one destination, one worker replica.

The harness's `DISCARDED` label stops nothing mechanically; it is a statement,
and this section is where it is honoured.

---

## 10. What this did not establish

- **No decomposition of arm D's 47%.** The effect is measured twice; whether it
  is the 1000 ms timeouts, the per-process fallback's reset pacing state, or
  both, is not attributed. That needs instrumentation on the limiter, not
  another window.
- **No reproduction of F1's exact raised arm.** F1 reported 262-295 orders/h
  for 6000/min with 32 concurrent on the shared client. Arms B and C show
  neither knob moves the number alone there, and § 5 shows why - so F1's gain
  is most consistent with run-to-run variance on a degraded instrument. But
  that configuration was **not** re-run, so it is an inference, not a
  measurement.
- **No lane-cap-plus-rate-limit arm.** § 7 names it as the next pair to test.
  ED raised the lane at the shipped rate limit and lost 12.5%; whether it helps
  once the rate limit is also raised is unmeasured.
- **No multi-replica figure.** One worker process. The limiter divides its
  policy by replica count (`dividePolicy`) and the lane caps are per process,
  so nothing here extrapolates to a scaled fleet.
- **No upper bound on arm BD.** At 600/min it used 64% of its budget, so the
  10x figure is not a ceiling - it is what 600/min happened to deliver against
  this stand's per-order cost. A higher limit was not tried.
- **No second destination.** PrestaShop only. WooCommerce is unmeasurable on
  this stand for an unrelated reason F1 documented: the seeded WooCommerce
  product mappings carry no numeric WC product ids, so no order can resolve a
  line item there.
- **No warm-buyer figure.** Every window calls `of_new_run`, so every order
  mints a new destination customer and requests-per-order is the **all-cold**
  figure. A warm-buyer deployment pays about 4 fewer requests per order, which
  would *raise* every derived ceiling in § 5.
- **Nothing about a real shop's own latency.** F1 measured PrestaShop answering
  create-path calls in 11-20 ms. This run did not re-measure it, and § 7's
  310 ms-per-request figure is derived arithmetic, not a profile.

---

## 11. Reproducing it

```bash
export PS_CONTAINER=lab-prestashop PS_MYSQL_CONTAINER=lab-mysql WC_CONTAINER=lab-woocommerce \
       PG_CONTAINER=lab-postgres REDIS_CONTAINER=lab-redis OL_API_CONTAINER=lab-api \
       OL_API_URL=http://127.0.0.1:19000 OL_ADMIN_USER=admin OL_ADMIN_PASSWORD=admin
set -a; . perf/openlinker-throughput/stand-ids.env; set +a

perf/openlinker-throughput/scenarios/limiter-ab.sh --smoke   # rig self-test, opens no window
perf/openlinker-throughput/scenarios/limiter-ab.sh           # arms A/B/C interleaved, then D, then the drift control
```

Arms are data, so a further arm is a config line rather than an edit - this is
exactly how BD and ED were run:

```bash
ARM_SPECS="" DRIFT_CONTROL="" \
  RECREATE_ARM_SPECS="BD:600:4:::true ED:60:32:16:16:true" \
  perf/openlinker-throughput/scenarios/limiter-ab.sh
```

The spec is
`name:requestsPerMinute:maxConcurrent:laneScopeCap:laneCap:dedicatedRedis`; an
empty lane cap means the runner's own default, which is never asserted against
a number the script invents.

### The one change left on the stand

The stand's `ol-perf:api` and `ol-perf:worker` images were **rebuilt** at
`8c1c0bbe7ee52cf8683cf2a888c926457626ef7a` and both containers recreated onto
them, because the images in place were built from a commit whose `apps/worker`
tree differed from the branch tip and `guard_build` therefore refused to
measure. They are left there rather than rebuilt backwards: the previous images
could not pass `guard_build` for anyone on this branch, and the only product
difference the new ones carry is the `OL_JOB_INTAKE_DEDICATED_REDIS` seam,
which defaults to the shipped behaviour - the worker's own boot line reads
`Job intake Redis client: SHARED` with it unset.

Everything else was restored by the scenario's own exit trap and verified after
the last window: both connections back to their original `enabledCapabilities`
with `config.rateLimit` absent, the runner back to `WORKER_RUNNER_ENABLED=false`,
the compose override file removed, the stand lock released, and no queued or
running `sync_jobs` rows left anywhere.

The stand's compose project is discovered from the running worker's own compose
labels rather than assumed to be the checkout the scenario runs from - the
worker service carries a relative bind mount to a generated, untracked TLS
certificate and an untracked `.env.lab`, and from the wrong directory compose
creates a *directory* where the certificate should be and recreates the worker
against the wrong database, both silently.
