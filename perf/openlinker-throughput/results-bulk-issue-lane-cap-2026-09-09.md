# Bulk-issue concurrency vs the fiscal lane cap (#2840, scoping follow-up to #3006)

_Stand: `lab` (docker-compose.lab.yml, #2854). Built at `4ff884d8e` (tip of
`perf-programme-2840` at measurement time, `guard_build`-equivalent: images
were built from this exact commit with `--build-arg OL_GIT_SHA=$(git
rev-parse HEAD)`). Machine spec: `MACHINE-SPEC-2026-09-09.md` in this same
directory._

## Scope note (read this first)

This report replaces the originally-briefed "fiscal lane throughput at a
provider latency of 2s/10s/90s" task. That task requires a fixed-latency
`InvoicingPort` stub, which the campaign lead re-scoped out same-day (filed
separately as **#3006**, estimated at a day of work) — building it was a
scoping error on a shared prompt, not a single-window task. **No stub was
built for this report, and no document-per-hour figure is claimed anywhere
below.** This report answers a narrower, immediately-actionable question
instead: does the `fiscal` lane cap actually serialise an operator's
`POST /invoices/bulk-issue` call, as `results-lane-caps-2026-09-07.md` § 4.5
asserted without observation?

## Pre-registered acceptance criteria

Written before any request was fired or any `sync_jobs` row was inspected.

- **H0** (the claim under test, from `results-lane-caps-2026-09-07.md` § 4.5):
  `invoicing.issue` and `fiscalization.register` share one per-order lock
  (`invoiceIssueLockKey`, #2047). An operator's `POST /invoices/bulk-issue`
  over N distinct orders is serialised **by the fiscal lane cap**
  (`perScope: 1`, `total: 2` — `apps/worker/src/sync/sync-job.runner.ts:160-166`)
  — one document at a time — even though the lock itself, being keyed per
  order, would permit all N to proceed in parallel.
- **Test**: fire one `POST /invoices/bulk-issue` over N=20 distinct real
  orders. Sample `sync_jobs` for `(jobType, status='running')` at ~20-30ms
  intervals spanning the call. If H0 holds, expect to observe `invoicing.issue`
  rows reach `running` state, capped at a small number (bounded by the lane's
  admission, ≤2 lane-wide / ≤1 per connection) even though N=20 orders are
  in flight.
- **Detector precondition**: before trusting a zero-`running` reading, prove
  the polling query itself can detect a `running` row that undisputedly
  exists (positive control), per the campaign's standing rule about
  confident-wrong instruments.
- **Verdict rule**: if zero `invoicing.issue` (or any) rows are ever observed
  `running` during the call, and the reason is confirmed in the source (not
  inferred), report H0 **refuted for this endpoint**, and name the actual
  mechanism instead of leaving a bare negative.

## Result: H0 is refuted — `POST /invoices/bulk-issue` never reaches the lane cap at all

**The endpoint does not enqueue a `sync_jobs` row of any kind.** It calls
`InvoiceService.issueInvoice()` directly, in-process, from a plain
sequential loop:

```
apps/api/src/invoicing/http/invoicing.controller.ts:640-651
  async bulkIssueInvoices(@Body() dto: BulkIssueInvoicesRequestDto) {
    const uniqueOrderIds = [...new Set(dto.orderIds)];
    const results: BulkIssueInvoiceResultDto[] = [];
    for (const orderId of uniqueOrderIds) {
      results.push(await this.issueOneForOrder(dto.connectionId, orderId));  // awaited, one at a time
    }
    ...
  }
```

`issueOneForOrder` (line 676) calls `this.invoiceService.issueInvoice(command)`
directly (line 724) — a plain application-service method call, not a job
enqueue. `InvoiceService.issueInvoice` (`libs/core/src/invoicing/application/
services/invoice.service.ts:275-311`) acquires the per-order
`invoiceIssueLockKey` lock via `SyncLockPort` and runs the issuance
**in the same request**, in the API process. There is no `sync_jobs` INSERT
anywhere on this path.

`invoicing.issue` **is** a real registered job type on the `fiscal` lane
(`apps/worker/src/sync/handlers/handler-registration.service.ts:478`,
confirmed live in the worker boot log: `Registered handler for job type:
invoicing.issue (lane: fiscal)`) — but the only caller that ever enqueues it
is the **automatic** per-order issue-on-ready trigger
(`libs/core/src/invoicing/application/services/auto-issue-trigger.service.ts:796`),
a completely different code path from the manual bulk-issue HTTP action.
The lane cap governs *that* path's concurrency. It has no connection at all
to `POST /invoices/bulk-issue`.

So the true mechanism is not "the lock would allow N in parallel but the
lane cap admits only 1" — it is **"there is no parallelism primitive on this
path whatsoever; the controller's own `for` loop processes one order,
completely, before starting the next."** This is arguably the worse defect
of the two: raising `OL_LANE_FISCAL_SCOPE_CAP` (the fix a reader of §4.5
would reach for) would do **nothing** for this endpoint, because it never
touches the lane. Fixing it needs a controller/service-level change (fan the
batch out to the same job queue the automatic trigger uses, or run the
per-order calls concurrently in-process), not a config change.

### Live confirmation

Detector positive control (prove the poll query can see a `running` row
before trusting a zero reading):

```
$ docker exec lab-postgres psql -U postgres -d openlinker -c \
    "UPDATE sync_jobs SET status='running', \"lockedAt\"=now(), \"lockedBy\"='detector-test' WHERE id='...'"
UPDATE 1
$ docker exec lab-postgres psql -U postgres -d openlinker -tAc \
    "SELECT \"jobType\", status, COUNT(*) FROM sync_jobs WHERE status='running' GROUP BY \"jobType\", status"
invoicing.issue|running|1
```

(First attempt at this same query used `COUNT(*)` inside a `||`-concatenated
`GROUP BY` expression and errored on every single poll —
`aggregate functions are not allowed in GROUP BY` — meaning the *first* run
of this experiment silently produced 45 empty-looking samples for the wrong
reason: **the detector was broken, not the finding true.** Caught only
because the positive control was run before trusting the negative. The query
above is the corrected, verified one.)

With the corrected detector, one `POST /invoices/bulk-issue` over 20 real,
distinct, previously-unissued orders (seeded via `seed/seed-orders.sh
TARGET_ORDERS=20`), against the `perf-prestashop` connection (not
invoicing-capable — every order fails at the adapter/capability boundary,
which is expected and does not affect what is being measured here: whether
any job ever reaches `running`, not whether it succeeds):

```
HTTP 200, wall clock 0.164s, {"issued":0,"skipped":0,"failed":20,...}
7 poll samples spanning the call (~20ms apart) — 0 of 7 show ANY row in
`running` state, for ANY jobType.
```

A second, independent run (before the detector fix, so not the number of
record but consistent in shape): 45 samples across the earlier 0.232s call,
same zero-`running` outcome once the query is accounted for.

## What this settles

- `results-lane-caps-2026-09-07.md` § 4.5's claim, as stated, is **false**:
  it is not the lane cap that serialises `POST /invoices/bulk-issue` over N
  orders. The endpoint never enters the lane/job system at all — every
  order is processed by a synchronous, sequential, in-process loop, so its
  concurrency is exactly 1 by construction, independent of any lane cap
  value.
- Raising `OL_LANE_FISCAL_SCOPE_CAP` (to 4, or any value) has **no observable
  effect** on this endpoint's concurrency, because it is never consulted on
  this path — confirmed by code (no lane-cap read anywhere in
  `invoicing.controller.ts` / `invoice.service.ts`'s issue path) and by the
  absence of any `running` `sync_jobs` row during the live call.
- The `fiscal` lane cap **does** govern something real — the automatic
  per-order issue-on-ready trigger (`auto-issue-trigger.service.ts`) — this
  report does not re-verify that path's own admission behaviour; it was out
  of scope for the specific claim under test (§ 4.5 was about the *manual
  bulk* action).

## What this did not establish

- Nothing about documents-per-hour at any provider latency (2s / 10s / 90s).
  That number needs the `InvoicingPort` stub scoped separately as **#3006**
  and is not claimed here, measured or otherwise.
- Whether the *automatic* issue-on-ready trigger's own concurrency actually
  tracks `perScope`/`total` as `f8-lane-caps.sh` would show for other lanes —
  plausible from the code (it does go through `SyncJobRunner`'s normal
  claim/lane-admission path, the same mechanism already validated for other
  lanes), but not independently re-measured here; that would need its own
  window and was outside what the campaign lead asked for.
- Whether the fix (making bulk-issue fan out concurrently) is safe given the
  per-order lock semantics `invoiceIssueLockKey` exists to protect — this
  report only characterises the current defect, not a remediation.
- The response-time scaling of `POST /invoices/bulk-issue` with N was not
  independently characterised beyond the two single data points above (20
  orders, ~0.16-0.23s); no claim is made about its behaviour at, say, N=100
  (the documented request cap).
