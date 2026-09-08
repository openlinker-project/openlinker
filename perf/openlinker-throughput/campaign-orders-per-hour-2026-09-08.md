# Orders per hour - every figure the campaign produced, and what each one required

Reconciliation page for epic #2840 (#3008). It **measures nothing**. It collects
every orders-per-hour figure the campaign has put into circulation, states the
conditions each one required, and says which single figure an operator may plan
against.

It exists because the figures travel and their conditions do not. Fifteen
observed rows spanning **182 to 3 356 orders/h - an 18x spread** - all describe
"how fast does OpenLinker load orders", and picking one without its window
length, its destination rate limit and its scheduler posture gets the answer
wrong by an order of magnitude in either direction. Only **two** of the fifteen
ran on the configuration a release actually ships.

**Every figure carries a label**, the same three the campaign reports use:

| Label | Means |
|---|---|
| **observed** | a throughput actually counted over a window, with a named artefact behind it |
| **derived** | arithmetic over measured inputs, stated with the arithmetic. Never an observation |
| **extrapolated** | projected past what was observed. A starting point to verify, never a bound |

**No figure is deleted from this page.** Withdrawn and superseded numbers stay
visible in [§ 4](#4-withdrawn-and-superseded-figures-kept-visible) with what
replaced them, in the style `results-F7-2026-09-06.md` established - a quietly
edited number is worse than a wrong one, because nobody can tell it moved.

---

## 0. The answer

**Plan against 598.3 orders/h.** It is the only figure in the campaign where the
offered rate and the completed rate met **1:1 over three continuous hours**,
with the scheduler on, 30 crons ticking and catalogue sweeps competing - the
conditions an operator actually runs.

**971.3 orders/h is a lower bound, not a rate to plan against.** It was observed
on a window deliberately offered 3 600 orders/h, i.e. one built to saturate, so
it reports what the system managed while permanently behind rather than what it
can sustain.

**Everything above 971.3 is a five-minute isolated window or arithmetic.**

Three facts about the whole table matter more than any single row in it, and
each is easy to miss because a figure never travels with them:

- **Not one throughput window in this campaign reached `VALID`.** Every row is
  `DISCARDED` by the harness's own post-guards. `measured` and `VALID` are
  different claims, and nothing here is the second one -
  [§ 1](#1-every-figure-in-one-table).
- **Only two of the fifteen rows ran on a configuration a release ships** - arm
  B and arm C. Every other row required a destination rate limit of 60, 600 or
  6 000 req/min, or the shared intake Redis client, or both.
- **The true ceiling is unmeasured.** No window found the point at which the
  order path refuses work. The window that would establish it is a **ramp to
  refusal**, named in `results-mixed-load-fixed-2026-09-08.md` § 6.1, and **no
  arm performed one** - so the highest number in the table below is not a
  capacity limit ([§ 7](#7-the-ceiling-is-unmeasured)).

**Two configurations were each measured twice, and the spread is the best
available evidence about how far any single figure can be trusted** -
[§ 1.1](#11-two-figures-are-pairs-and-neither-sibling-is-visible-from-the-other).

---

## 1. Every figure, in one table

Ordered by the number, not by confidence, so nothing hides at the bottom.

**Read the verdict column before the number.** Fourteen of the fifteen rows are
`DISCARDED`, and none of them is `VALID` - see the note under the table, because
`measured` and `VALID` are different claims and the figures have been travelling
with only the first.

| orders/h | Source | Window | Offered | Destination limit | Replicas | Scheduler | **VERDICT** | Label |
|---:|---|---|---|---:|---:|---|---|---|
| **182** | F1 baseline | **300 s** | saturating (900-order backlog) | 60/min | 1 | OFF | **`DISCARDED`** | observed, **withdrawn** (§ 4.1) |
| **200.6** | sustained mixed load, arm A | 3 h (10 783 s) | 3 600/h (saturating) | 300/min | 1 | **ON** | **`DISCARDED`** | observed, **do not quote** (§ 4.2) |
| **207.3** | clean-window retest, arm A | **300 s** x3 | saturating | 60/min | 1 | OFF | **`DISCARDED`** | observed |
| **224.5** | limiter A/B, arm C | **300 s** x2 | saturating | 60/min, 32 concurrent | 1 | OFF | **`DISCARDED`** | observed |
| **225.0** | limiter A/B, arm B | **300 s** x2 | saturating | 600/min | 1 | OFF | **`DISCARDED`** | observed |
| **226.3** | limiter A/B, arm A | **300 s** x3 | saturating | 60/min | 1 | OFF | **`DISCARDED`** | observed |
| **262-295** | F1, destination raised | **300 s** x2 | saturating | 6 000/min | 1 | OFF | **`DISCARDED`** | observed, **withdrawn** (§ 4.1) |
| **281** | clean-window retest, arm D3 | **300 s** x2 | saturating | 60/min | **3** | OFF | **`DISCARDED`** | observed |
| **291.5** | limiter A/B, arm ED | **300 s** x2 | saturating | 60/min, 32 concurrent, lane 16/16 | 1 | OFF | **`DISCARDED`** | observed |
| **333.0** | limiter A/B, arm D | **300 s** x2 | saturating | 60/min | 1 | OFF | **`DISCARDED`** | observed |
| **598.3** | mixed load fixed, **arm C** | **3 h** (10 777 s) | **598.6/h - matched 1:1** | 300/min | 1 | **ON** | order path passed (C3); aggregate C1/C2 failed on a stand artefact (§ 2) | **observed** |
| **971.3** | mixed load fixed, arm B | 3 h (10 802 s) | 3 600/h (saturating) | 300/min | 1 | **ON** | **`DISCARDED`** | observed, **lower bound** (§ 3.1) |
| **2 233.3** | clean-window retest, arm BD | **300 s** x3 | saturating | **600/min** | 1 | OFF | **`DISCARDED`** | observed, **not a shipped configuration** (§ 3.2) |
| **2 279.0** | limiter A/B, arm BD | **300 s** x2 | saturating | **600/min** | 1 | OFF | **`DISCARDED`** | observed, **not a shipped configuration** (§ 3.2) |
| **3 356** | clean-window retest, arm BD3 | **300 s** x2 | saturating | **600/min** | **3** | OFF | **`DISCARDED`** | observed, **not a shipped configuration** (§ 3.2) |

**Twelve of the fifteen rows are 300-second windows**, and window length is the
single most load-bearing condition in the table. A five-minute saturation window
on the slow arms counts 16-19 orders, so **one order is 5-6% of the rate** - the
limiter A/B report says so itself, and it is why that run required `n >= 2` and
interleaved its arms. Such a window also cannot see anything with a period
longer than five minutes: no hourly cron fires, no catalogue sweep cycle
completes, and no accumulating queue has time to change the answer.

### Not one window in this table reached `VALID`

Every row is `DISCARDED` by the harness's own post-guards, and the clean-window
retest states it in as many words: *"Which arms reached `VALID`? One did: F5.
No throughput window did."*

**`measured` and `VALID` are different claims, and this is where a reader is
most likely to conflate them.** The campaign's three labels - measured, derived,
extrapolated - answer *"how was this number arrived at"*. The verdict answers
*"did the window it came from pass the guards that decide whether it may be
presented as a capacity measurement"*. A figure can be honestly `measured` and
`DISCARDED` at the same time, and fourteen of the fifteen rows above are exactly
that. Until this page existed the figures travelled with the label and without
the verdict, so a `measured` figure read as one that had passed something. None
of them has.

`DISCARDED` is also a statement rather than a mechanism - it stops nothing, no
report is prevented from quoting its own number, and nothing downstream checks
it - which is precisely why this page carries it **per row** instead of leaving
it inside each report. The reasons are not equally serious and the reports say
which is which; what is not defensible is presenting any of these figures as a
clean capacity measurement.

Arm C is the closest the campaign came: its order-path criterion (C3) passed on
its own terms, while its install-wide queue criteria (C1, C2) failed for a
reason outside the order path (§ 2). It is the only row on this page whose
verdict column is not the word `DISCARDED`.

### 1.1 Two figures are pairs, and neither sibling is visible from the other

**Two configurations were each measured twice, by two independent runs.** A
reader handed one of those numbers has no way to know it has a sibling, so the
pairs are set out adjacent here - the spread between them is the strongest
available evidence about how much weight any single figure on this page can
carry.

| Configuration | Run A | Run B | Apart |
|---|---:|---:|---:|
| Shared intake client, destination **60 req/min**, 1 replica, isolated, 300 s | **207.3** (retest arm A, n=3) | **226.3** (limiter A/B arm A, n=3) | **9%** |
| Dedicated intake client, destination **600 req/min**, 1 replica, isolated, 300 s | **2 233.3** (retest arm BD, n=3) | **2 279.0** (limiter A/B arm BD, n=2) | **2%** |

Both pairs are the **same configuration on the same day** - 2026-09-07, the same
stand, the same image, the same scenario file. Neither pair is a before-and-after
of anything.

**Do not take a midpoint of the slow pair.** A midpoint would invent a precision
neither measurement has: at 18-19 orders per five-minute window one order is
5-6% of the rate, which is most of the 9%. The clean-window retest's own reading
is the one to adopt, verbatim:

> Both runs' arm A figures should be read as **"about 200-230 orders/h, limited
> by a stall"**, not as two different [measurements].

The fast pair is 2% apart, inside arm BD's own 1.0-2.1% within-run spread, so
either figure may be cited - but citing **both** as separate facts overstates
what was measured. They are two reads of one configuration.

**Two conditions are constant across every row and are stated once here**: a
single seeded PrestaShop destination, on a Docker Compose stand on a contended
developer workstation, with no CPU pinning and no memory limit on any
OpenLinker container. Per the campaign's standing caveat these are floors rather
than ceilings - contention understates what the software can do; it does not
overstate it.

---

## 2. Why 598.3 orders/h is the figure to plan against

Arm C of `results-mixed-load-fixed-2026-09-08.md` § 7.5, window
`2026-09-08T12:31:33Z` + 10 777 s:

| | offered | completed |
|---|---|---|
| whole window | 1 792 ingested = **598.6/h** | 1 791 = **598.3/h** |

**99.94%, for three hours.** It is the only figure in the campaign that is
neither an extrapolation from a five-minute window nor a report of a system
running permanently behind, and it holds under the co-tenancy an operator
actually has: the scheduler on, 30 crons ticking, catalogue and inventory sweeps
competing for the same lanes, one worker replica, and the destination at the
**shipped 300 req/min default** (#2982) with no override.

It is also the owner's own peak figure rather than a proxy for it - 5 000
orders/day is 208/h averaged and 500-600/h at a four-to-six-hour peak - so the
window answers the question that was asked.

**What it licenses**: the order path sustains 600 orders/h at 1:1 with the
limiter clean. That constrains the ceiling **from below**: `ceiling >= 600/h`,
observed.

**What it does not license**: "the queue converges at 600 orders/h". It did not.
Arm C's aggregate criteria C1 and C2 both failed (`verdict = GROWING`,
last-third slope +481.3 jobs/h against a 144.0 noise band; due depth 66 ->
1 367), and no criterion was moved after the fact. The growth was **settled from
terminal states and is a stand artefact**: `perf-webhook-ingress` is an active
PrestaShop `OrderSource` polling the same shop OpenLinker writes into, so OL
re-ingested **1 454 `order_records`** of its own creation inside the window. The
queued/ingested ratio held **0.86-0.99 flat** across the whole window; a
capacity shortfall climbs, a feedback loop tracks the input, and this tracked
the input. The report also records that the loop was present in **all three
arms** (arm A 726, arm B 1 484, arm C 1 454), so it is a constant across the
comparison rather than a confound in it.

---

## 3. Why 971.3, 2 233, 2 279 and 3 356 are real and still not plannable

Each for a different reason, and the reasons do not substitute for one another.

### 3.1 971.3 orders/h - a saturating window, so a lower bound

`results-mixed-load-fixed-2026-09-08.md` § 3.1, arm B, whole window: **988.4/h
ingested, 971.3/h completed, at a 6 344 ms mean per-order service time**
(n=2 919). Steady phase 986.7/h; an independent mid-window read at t+8 622 s
gave ~962/h. The three agree within 2.5%.

The window was offered **3 600 orders/h against a ~988/h drain**, so it was
behind from its first minute by construction. That makes 971.3 an honest
statement about the shipped build - and a **floor** on what the shipped build
sustains, not a rate at which it kept up. The report says so in its own § 6.1:
both arms A and B saturated, so the highest throughput either one observed is a
lower bound on the ceiling rather than the ceiling.

Quote it as *"at least 971 orders/h, measured on a saturating window"*. Do not
quote it as sustainable throughput; 598.3/h is the sustained figure.

### 3.2 2 233, 2 279 and 3 356 orders/h - a configuration no release ships

All three required the destination's `config.rateLimit` set to **600
requests/min**. PrestaShop's shipped manifest default is **300 req/min** as of
#2982 - so 600 is **double the shipped default**, an operator override rather
than anything a release carries.

It is also above what this project's own weak-shop measurement recommends. The
600/min figure was validated against **this** stand's unconstrained 28-core
PrestaShop; #2982 raised the default to 300 explicitly because *"a default is
for everyone, so the figure has to come from the weakest shop an operator runs,
not the strongest one we happen to own"*.

Three further conditions travel with them, and each on its own is enough to stop
the figure being a plan:

- **300-second isolated windows, scheduler OFF.** No cron fired into any of
  them (`guard_scheduler_off` is in that scenario's own guard chain). The whole
  gap between these numbers and the mixed-load ones is the co-tenancy an
  operator has and these windows did not.
- **Every window `DISCARDED`.** All three retest arm BD windows carry the
  identical single reason - one order out of ~190 lacking a destination
  `syncedAt`, which is the harness's in-flight guard firing on a window that
  ended with work legitimately in flight - but the label is `DISCARDED`, and
  this page will not launder it.
- **They are not ceilings either.** At 600/min the retest's arm BD used
  **378 req/min, 63% of its own budget** (the limiter A/B run's own BD windows
  read 382.8 and 388.7, 64-65%), and that report records *"No upper bound on arm
  BD"* in as many words. So 2 233 is what 600/min happened to deliver against
  this stand's per-order cost; a higher limit was never tried.

The **3 356** row adds one variable on top: three worker replicas, which bought
**1.50x** rather than 3x. The reason is visible in the same rows - at one
replica the bind is lane slots (63% of the destination's budget used), at three
it is the shared Redis pace bucket (94%) - so scaling converts a slot-bound
system into a bucket-bound one and then stops, because the bucket is shared by
design.

The **281** row is the same shape read the other way: three replicas at the
then-shipped 60 req/min limit measured **54.5-55.1 req/min, under the
operator's configured limit**, which is what retired F4's withdrawn 2.77x
scaling claim (§ 4.5).

---

## 4. Withdrawn and superseded figures, kept visible

### 4.1 F1's 182 and 262-295 orders/h - withdrawn

> **Withdrawn.** `results-F1-2026-09-07.md` published **182 orders/h** at the
> then-shipped defaults, **262-295 orders/h** with the destination limit lifted,
> and a **p50 66 s** per-order latency.
>
> **Why.** **All four F1 windows were `DISCARDED`**, chiefly on limiter
> degradation (34-52 lines per window) - so every figure is a measurement of a
> system whose outbound limiter was falling back to per-process pacing. #2847
> records the 66 s and 182-295 orders/h figures as withdrawn.
>
> **What replaced them.** The isolated order-path figure is **207.3 orders/h**
> (clean-window retest, arm A, n=3, same shared client, destination at 60/min).
> The figure an operator can apply is **598.3 orders/h** (§ 2). One thing from
> F1 is worth keeping on its own account: because its third arm's lane raise
> never took effect, that arm is an exact repeat of its second, so **262 vs 295
> orders/h is a 12.6% same-configuration repeatability figure** and the best
> available statement of that instrument's spread.

### 4.2 200.6 orders/h - a configuration that never shipped

> **Do not quote it as "what OpenLinker does".**
> `results-sustained-mixed-load-2026-09-08.md` measured 200.6 orders/h completed
> over three hours with the scheduler on, and it is the campaign's first
> realistic-co-tenancy order figure.
>
> **Why it must not travel.** It ran the **new** destination rate limit
> (300 req/min, #2982) against the **old** shared Redis intake client (#2984 not
> yet in its image). No release ever combined those two: the pre-#2982 world
> paced the destination at 60 req/min, and the post-#2984 world has the
> dedicated client. Arm A sits between them and matches neither, so it is a
> **valid control for exactly one comparison** - it isolates the intake client -
> and an invalid figure to quote on its own.
>
> **What replaced it.** Arm B's **971.3 orders/h**, the same window shape with
> that one variable changed (§ 3.1), and arm C's **598.3 orders/h** sustained
> (§ 2). Arm A's companion figures - 217.3/h ingested, 193.3/h steady, 227.3/h
> recovery - carry the same caveat and the same replacement.

### 4.3 1 197 orders/h -> 1 135 orders/h

> **Superseded.** The derived slot-arithmetic ceiling for the fixed build was
> first published as **1 197 orders/h**, from `2 slots x 3600 / 6.014 s` over an
> **interim, mid-window** service time read at t+853 s of 10 800 s.
>
> **What replaced it.** The whole-window mean service time is **6 344 ms**
> (n=2 919), which puts the same arithmetic at **1 135 orders/h**. The
> whole-window figure supersedes the interim one, and the service-time
> improvement over arm A is **5.11x**, not the interim 5.39x.
>
> **A note for readers of the source report.**
> `results-mixed-load-fixed-2026-09-08.md` § 3.1 carries the superseding
> figures - its own header states that they *"supersede § 2's interim"* - while
> its § 6.1 and § 7.2.1 still carry the interim 6 014 ms / 5.39x / 1 197 h. This
> page cites § 3.1. Correcting the source report is that report's own to do;
> nothing here edits it.

### 4.4 962 orders/h -> 971.3 orders/h

> **Superseded, and it was labelled interim when it was published.** ~962
> orders/h was an independent mid-window read of arm B at t+8 622 s (2 304
> orders in 8 622 s), published as *"interim, mid-window, verdict unwritten"*.
> The whole-window figure is **971.3/h completed**. The two differ by ~1%, and
> the difference is the window trim rather than a change in the system.

### 4.5 F4's 2.77x replica scaling - withdrawn

> **Withdrawn, and this one matters because it reached an ADR.** F4 measured
> three replicas draining 600 bulk jobs 2.77x faster.
>
> **Why.** Those replicas hit the destination at **158.4 req/min against the
> 60 req/min it declared**: the shared Redis rate limiter timed out at its own
> 1 s budget and each process fell back to in-memory pacing, so three replicas
> became three independent buckets. It was measuring the defect, not scaling.
>
> **What replaced it.** With the client unshared, three replicas against a
> 60 req/min limit measure **54.5-55.1 req/min - under the limit** (arm D3), and
> the honest replica-scaling figure is **1.50x** (2 233 -> 3 356 at 600/min).
> ADR-050 carries the correction.

### 4.6 One non-orders figure that travels with these

> `results-F3-2026-09-06.md`'s webhook-ingress *"~600 requests per second"* is
> **withdrawn as a ceiling**. Those three runs would be discarded by today's
> guard chain - 19.6% to 26.7% of k6 iterations never dispatched, and k6 at
> 92-97% of its own VU ceiling, i.e. the generator was the thing at its limit -
> yet their `verdict.txt` files still read `VALID`. Cite **300 req/s, labelled
> "at least"**. It is requests per second rather than orders per hour, and it is
> listed here only because it is the other campaign figure most likely to be
> quoted beside these.

---

## 5. Derived and extrapolated figures - none of them an observation

Kept in a table of their own so no reader picks one up believing it was counted.

| Figure | Arithmetic | Inputs from | Label |
|---:|---|---|---|
| **222 orders/h** | `2 slots x 3600 / 32.404 s` | mixed load arm A service time | derived |
| **229 orders/h** | `2 slots / 31.44 s` | sustained mixed load arm A service time | derived |
| **1 135 orders/h** | `2 slots x 3600 / 6.344 s` | mixed load arm B whole-window service time | derived |
| ~~1 197 orders/h~~ | `2 slots x 3600 / 6.014 s` | mixed load arm B **interim** service time | derived, **superseded** (§ 4.3) |
| **~1 636 orders/h** | `300 req/min / ~11 req/order x 60` | the destination pace gate at the shipped limit | derived |
| **319-339 orders/h** | `60 req/min / req-per-order x 60` | per-window pace-gate ceilings at 60/min | derived |
| **153 orders/h** | `3600 x 2 / 47 s` | #2847's pre-campaign planning estimate, from a 2-sample job duration | derived, superseded by every row in § 1 |
| **~22 000 orders/h** | `10 x 2 233` | a 10x peak over the fixed build. Needs ~3 700 req/min = 62 req/s, six times the highest rate the shop ramp tested | extrapolated, **not reachable by raising the limit** |

**The slot arithmetic is the campaign's most quotable trap.** `2 slots x 3600 /
service-seconds` is the `realtime` per-scope cap of 2 divided by a per-order
service time measured **under one set of conditions**, and every arm that put
weight on it came in below it: the sustained window's recovery phase reached
99.3% of its 229/h, and arm B's observed 971.3/h is ~14% under its own 1 135/h.
Quote the arithmetic with the arithmetic shown, or not at all.

---

## 6. Per-window components, for anyone re-deriving a mean

Every mean in § 1 is the mean of these. Recorded so a reader can check the
spread rather than take a mean on faith.

| Arm | Per-window orders/h | Mean | Spread |
|---|---|---:|---:|
| limiter A/B, A | 218, 231, 230 (last = drift control) | 226.3 | 13 (5.7%) |
| limiter A/B, B | 231, 219 | 225.0 | 12 (5.3%) |
| limiter A/B, C | 218, 231 | 224.5 | 13 (5.8%) |
| limiter A/B, D | 339, 327 | 333.0 | 12 (3.6%) |
| limiter A/B, BD | 2 255, 2 303 | 2 279.0 | 48 (2.1%) |
| limiter A/B, ED | 303, 280 | 291.5 | 23 (7.9%) |
| retest, A | 212, 211, 199 (+ drift control 222) | 207.3 | 13 (6.3%) |
| retest, BD | 2 244, 2 235, 2 221 | 2 233.3 | 23 (1.0%) |
| retest, D3 (3 replicas, 60/min) | 281, 281 | 281 | 0 |
| retest, BD3 (3 replicas, 600/min) | 3 344, 3 368 | 3 356 | 24 (0.7%) |
| F1, three arms | 182, 262, 295 | - | 12.6% between the two identical arms |
| sustained mixed, A (phases) | 193.3 steady, 227.3 recovery, 200.6 whole window | - | - |
| mixed load fixed, B (phases) | 986.7 steady, ~962 mid-window read, 971.3 whole window | - | - |
| mixed load fixed, C | 598.3 whole window | - | single window |

**The two pairs are in [§ 1.1](#11-two-figures-are-pairs-and-neither-sibling-is-visible-from-the-other)**
and are not restated here. One detail belongs with the rows rather than with the
summary: the slow pair's degradation counts are comparable across the two runs
(40, 41, 45 and a 49 drift control against 42, 50, 54), which is what makes
*"limited by a stall"* the right reading of both rather than a claim about one.

---

## 7. The ceiling is unmeasured

**No window in this campaign found the point at which the order path refuses
work.** Read § 1 and the honest summary is:

- the saturating windows were offered more than they could take, so they report
  a **floor** on the ceiling;
- the one non-saturating window (arm C) was offered **less** than it could take
  and kept up, so it also reports a **floor** on the ceiling -
  `ceiling >= 600/h`, observed;
- the slot arithmetic reports a number nothing observed.

A floor from below and another floor from below do not meet in the middle.
`results-mixed-load-fixed-2026-09-08.md` § 6.1 names the window that would
settle it:

> **a ramp to refusal, which no arm here performs.**

Concretely: the same three-hour mixed-load shape, with the offered rate stepped
upward across the window until the completed rate stops tracking it and the
order-path queue begins to grow at the offered rate, and the step at which that
happens recorded. Until such a window exists, **the highest observed figure on
this page is not the ceiling**, and no figure here may be presented as one.

Two adjacent things are also unestablished, named so nobody re-discovers them:

- **Why the intake-client fix was worth ~5x under co-tenancy and +47% in
  isolation.** The hypothesis is that the shared-client defect's cost scales
  with how many callers contend for the one client. What would settle it is a
  **per-arm limiter-wait distribution**; the only limiter observable in this
  harness is the degraded-mode log line count, which says the limiter gave up,
  not how long callers waited before it did. A fourth mixed-load arm is not the
  experiment.
- **The third lever on the order path is unowned.** Four cacheable per-order
  requests are worth about **3.1x** on the order path per #2992 § 15, and no
  child of #2840 currently writes that work. Because the ceiling is
  `2 slots x 3600 / service-seconds`, anything that cuts service time again
  multiplies it directly.

---

## 8. Provenance - where each figure lives

| Figure(s) | Report | Branch as of 2026-09-08 |
|---|---|---|
| 182, 262, 295 | `results-F1-2026-09-07.md` | `perf-programme-2840` |
| 224.5, 225.0, 226.3, 291.5, 333.0, 2 279.0 | `results-limiter-ab-2026-09-07.md` | `perf-programme-2840` |
| 207.3, 281, 2 233.3, 3 356 | `results-retest-2026-09-07.md` | `perf-programme-2840` |
| 193.3, 200.6, 217.3, 227.3, 229 | `results-sustained-mixed-load-2026-09-08.md` | `2840-sustained-mixed-load` (unmerged) |
| 598.3, 962, 971.3, 986.7, 1 135, 1 197 | `results-mixed-load-fixed-2026-09-08.md` | `2840-mixed-load-fixed` (unmerged) |
| the operator-facing summary of all of it | `docs/operations/requirements-and-scaling.md` § 11 | `2863-hardware-requirements`, PR #2992 |
| 2.77x (withdrawn) | `results-F4-2026-09-06.md`, plus ADR-050's correction | `perf-programme-2840` |
| 600 req/s (withdrawn), 300 req/s | `results-F3-2026-09-06.md`, `campaign-2026-09-06.md` § 2 | `perf-programme-2840` |

**Three of these reports are on unmerged branches**, which is the second half of
the problem this page exists for: a due-diligence reader handed
`perf-programme-2840` alone reads F1's withdrawn figures as current and cannot
see arm B or arm C at all. Until those branches merge, this page is the index.

**The shipped configuration, stated once**, because **thirteen of the fifteen
rows in § 1 differ from it** - only arm B and arm C ran on it: the job-intake
Redis client is **dedicated unconditionally** as of #2984
(the `OL_JOB_INTAKE_DEDICATED_REDIS` seam is gone - there is deliberately no
shared-client branch), and PrestaShop's manifest `defaultRateLimit` is
**300 req/min** as of #2982, raised from 60. Any figure on this page taken at
60 req/min, 600 req/min or 6 000 req/min was taken on a configuration no release
carries.

---

## Related

- [requirements-and-scaling.md](../../docs/operations/requirements-and-scaling.md) - what to provision, and § 11 on what replicas buy
- [campaign-2026-09-06.md](./campaign-2026-09-06.md) - the campaign's other flows (webhook ingress, read path, upstream latency)
- [perf-lab-stand.md](../../docs/operations/perf-lab-stand.md) - the stand every figure was taken on
