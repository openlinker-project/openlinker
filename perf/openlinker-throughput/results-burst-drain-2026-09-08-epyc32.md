# A spike, then the recovery: offered above capacity, then below

> **PRE-REGISTERED — the window has not run yet.** Everything in § 0-§ 2 was
> written and committed **before the window opened**. Results appear in § 3
> and nowhere above. Nothing here may be quoted until this banner is gone.

**Host**: `epyc32` — see `machine-spec-epyc32-2026-09-08.md`. Dedicated perf
stand, **nothing else runs on it**; a queue-depth measurement is meaningless
if a co-tenant is stealing drain capacity, so this is a condition of the
figure and not a footnote.

**Scenario**: `scenarios/sustained-mixed-load.sh` with the ramp schedule this
issue adds (`MIXED_RAMP`). Not a new scenario — the arrival loop already
took a single `MIXED_ORDERS_PER_MIN`; it needed a *schedule*.

## 0. Why this run exists

Every window in this campaign so far offered a **constant** arrival rate.
Two saturated from the first second and never converged (arms A and B of
`results-mixed-load-fixed-2026-09-08.md`); arm C ran below capacity from the
first second. **Nobody has run offered-above-capacity followed by
offered-below-capacity, which is the only shape real retail has.** A
customer's first bad day is a spike, not a Tuesday.

### 0.1 The arithmetic that makes it urgent

| Path | Rate | Label |
|---|---|---|
| webhook accept (routable event → 202) | 3.4 ms, achieved **240 events/s** | measured (F3) |
| order drain (2 realtime slots ÷ 6.014 s service) | **~986 orders/h ≈ 0.27/s** observed; 1 197/h ceiling | measured / derived (arm B) |

That is a **≈750:1 ratio between the front door and the corridor**. One
minute of arrivals at the accept rate queues ~14 400 jobs — on the order of
**12.5 hours of drain**. And there is **no admission control anywhere**: the
accept path returns 202 at 3.4 ms regardless of queue depth, so the system's
only response to overload is unbounded queue growth. Nobody has measured what
that costs.

## 1. Conditions, declared before the run

### 1.1 The rates, and why these integers

`MIXED_ORDERS_PER_MIN` is passed to `of_push_orders` as an **integer count
per one-minute tick**, so the reachable rates are multiples of 60/h. The
drain reference is arm B's **observed 986 orders/h** (not the 1 197/h
ceiling, and not the brief's 0.32/s = 1 152/h, which sits between the two —
both are recorded here so the multiple is auditable).

| Phase | Target | Chosen | Actual multiple of 986/h |
|---|---|---|---|
| burst, 30 min | 3 × drain = 2 958/h | **50/min = 3 000/h** | **3.04×** |
| drain, remainder | 0.5 × drain = 493/h | **8/min = 480/h** | **0.49×** |

### 1.2 What is sampled, and the one distinction that matters most

Every 30 s: **due** queue depth (`status='queued' AND "nextRunAt" <= NOW()`),
**deferred** count (`status='queued' AND "nextRunAt" > NOW()`), `running`,
`dead`, and completions. A queued row whose `nextRunAt` is in the future is
**backing off on its own schedule and is not queue depth** — conflating the
two would make a healthy retry ladder look like a backlog. Plus per-order
end-to-end age percentiles, which is the operator-visible number and the
thing this run exists to produce: *what does the 1000th order in the burst
actually experience.*

### 1.3 Expected backlog, derived before the run

30 min at 3 000/h offers **1 500 orders** while ~493 drain ⇒ backlog ≈
**1 007 orders** at burst end. At 480/h offered against 986/h drain the net
is 506/h ⇒ **≈ 2.0 h to clear**. The drain phase is therefore observed for a
**bounded** period and the remainder **derived from the measured slope**, and
labelled as derived. A 2.5 h wall-clock run is not promised.

## 2. Pre-registered acceptance criteria

Committed before the window opened; **not moved afterwards**.

| # | Criterion | If it fails |
|---|---|---|
| **AC1** | the burst phase genuinely saturates: net due-queue growth over the 30 min is **> 0** | the burst was not above capacity and the run **does not answer the question**; reported as such |
| **AC2** | the drain phase genuinely converges: due-queue slope over the last 20 min of observation is **< 0** | reported as non-converging; **no clearance time is derived** |
| **AC3** | per-order age percentiles resolve for ≥ 200 burst-phase orders | percentiles carry their `n`; not promoted to a headline |
| **AC4** | expiry/death accounting is reported *through* the drain, not only at the end | — |

### 2.1 Three guards are expected to DISCARD this window, and that is pre-registered

`post_guard_attempts`, `post_guard_deferrals` and
`post_guard_destination_creates` all **assume the window drained**. A window
built to saturate cannot satisfy them. `results-mixed-load-fixed` states the
same expectation for its own arms and calls it a scenario-versus-guard
mismatch rather than a fault. So:

- a `DISCARDED` verdict here is **expected and named in advance**, not a
  surprise discovered afterwards, and the § 3 figures travel with that scope;
- `post_guard_destination_creates` is additionally **known-broken**: its
  `failed` arm carries no destination predicate while its message promises
  one, and the stand's WooCommerce connection has no product mappings, so it
  fails every order and has reported counts **exceeding its own population**
  in three separate windows. Expect a spurious firing. It is reported, and
  **the WooCommerce connection is NOT disabled to make it pass** — that would
  hide a guard defect behind a configuration change;
- `post_guard_limiter_degraded` is the one guard whose answer here is a
  **finding rather than an artefact**.

### 2.2 What "what did the spike cost" can and cannot show in 2.5 hours

Stated before the data so the result cannot be quietly overclaimed. Three
clocks run against a backlog:

| Clock | Threshold | Crossable in this window? |
|---|---|---|
| `jobdedup:*` Redis key TTL | **7 days** | **No** |
| `OL_JOB_MAX_DEFERRED_WAIT_SECONDS` (deferral budget, then the job rejoins the retry ladder and can reach `dead`) | **24 h** | **No** |
| reservation `expiresAt` (`OL_RESERVATION_TTL_MS`, 7 d default, clamped [1 h, 90 d]) | **7 days** default | **No** at default |

So the honest pre-registered expectation is that **nothing expires because it
waited**, and the deliverable on that axis is the *arithmetic of when it
would* plus whatever **does** die for other reasons (retry exhaustion,
destination refusal). If the run instead shows an expiry, that is a genuine
and unexpected finding and gets its own section. What must **not** happen is
reporting "nothing expired" as evidence that a backlog is harmless.

## 3. Results

TBD — the window has not run.

## 4. What this did not establish

TBD.
