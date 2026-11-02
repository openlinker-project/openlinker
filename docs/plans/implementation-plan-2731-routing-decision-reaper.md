# Implementation Plan: reaper for a routing decision stranded `live`

- **Issue**: #2731 (epic #3511, pilot G07-04, P1)
- **Branch**: `2731-routing-decision-reaper`
- **Builds on (merged)**: #2394 (`routing_decisions`), #2395 (in-doubt rule + resume), #2712 (timeout sweep shape), #3485 (hold + `fulfillment.work.rerouteSweep`), #3476 (holder-cannot-execute refusal + unsubmitted re-drive)
- **Base**: re-verified against `origin/main` at `d92782c95` (release 0.17.0) on 2026-10-27. Nothing in this slice exists yet: no `stranded-past-ttl`, no `routing-stuck`, no reaper job, no controller over `routing_decisions`.
- **Consumed by (open)**: #3557 (frontend), #3558 (operator "Retry routing" endpoint)

---

## 1. Task summary

`RoutingCommitService.leaveInDoubt` leaves a `routing_decisions` row `live` after a `route()` timeout or throw. That is deliberate: freeing the `UNIQUE (orderId) WHERE state = 'live'` index would let the next attempt mint a new decision id, therefore a new idempotency key, which a vendor cannot dedup. Nothing ever closes such a row, so the order waits for ever with block `routing-in-doubt`.

This slice adds: a sweep that abandons a decision stranded `live` past a TTL, a read endpoint for it, a `routing-stuck` attention value, and the hand-off back into routing.

## 2. Scope and non-goals

**In scope**
1. Pure TTL rule + `stranded-past-ttl` abandon reason (core, `fulfillment` leaf).
2. Repository: bounded frontier read of stale `live` decisions; reuse `terminalise` for the reap (it is already one guarded `WHERE state = 'live'` UPDATE).
3. `IRoutingDecisionReaperService` (core) that reports intents, writes no order state.
4. Job `fulfillment.routing.reapSweep`, `bulk` lane, global scope, handler + scheduler task (default ON).
5. `GET /orders/:internalOrderId/routing-decision` (read-only, returns state, router, age, TTL, abandon result).
6. `routing-stuck` in `AuthorityAttentionReasonValues` (non-partitioning, never an `OrderHealth` bucket).
7. After a reap, the order block moves to a re-routable value so `fulfillment.work.rerouteSweep` picks it up.

**Non-goals (decided by D4, 2026-09-28)**
- No operator control that forces, checks or abandons a decision. No "Check with router". No new method on `FulfillmentRouterPort`.
- `manual-route-admissibility.types.ts` (M3) is not touched.
- Frontend is #3557. The operator "Retry routing" endpoint is #3558.

## 3. Architecture mapping

| Piece | Layer / location |
|---|---|
| TTL resolver, reason, stranded predicate | `libs/core/src/fulfillment/domain/types/routing-decision-ttl.types.ts` (pure-rule exception) |
| Repo read `findStrandedLive({ olderThan, limit })` | port + `routing-decision.repository.ts` |
| Reaper service + interface + token | `libs/core/src/fulfillment/application/services/routing-decision-reaper.service.ts` |
| Handler | `apps/worker/src/sync/handlers/routing-decision-reaper.handler.ts` |
| Job type, payload, lane, scheduler task | `sync-job.types.ts`, `fulfillment-job-payloads.types.ts`, `handler-registration.service.ts`, `scheduler.service.ts` (one surgical block each, contended with #2728) |
| Read endpoint + DTO | `apps/api/src/fulfillment/http/` (or `orders`), `@Roles('admin','operator','viewer')` |
| Attention value | `authority-attention-reason.types.ts` + descriptor table |

The `fulfillment` leaf may not inject `orders`: the service reports `{ orderId, block, attention }` intents and the worker writes them with `IOrderRecordService.markFulfillmentBlock` / `markOmsAttention` (the #2712 split; zero new entries in the no-injection or barrel-purity allow-sets).

## 4. Safety argument (the AC "proven, not argued")

Two distinct races, handled differently:

1. **Late answer from the in-process router after a reap.** Already closed: `RoutingCommitService.commit` creates the work rows and calls `terminalise(committed)` in one transaction, and throws `RoutingDecisionNoLongerLiveError` when it loses, rolling the work rows back. The reap and a late commit both go through `WHERE state = 'live'`, so exactly one wins. Test: overlapping real-Postgres int-spec (a sequential test passes against no guard at all).
2. **A vendor router that committed on its own side before the reap.** Not detectable: the port has no status call and D4 forbids adding one. The only mitigation is the TTL floor: it must exceed the longest period a router can still be committing. Reaping then mints a new key, so the residual risk for an out-of-tree router is a double plan. State it in the ADR-style note on the TTL constant. For the only shipped router (`openlinker.oms.v1`, in-process, local DB) this risk does not exist.

The clock is `createdAt`, not `updatedAt`: a resume re-derives the same key and re-calls the router without writing the row, so `updatedAt` does not move, and adding a writer to restart the clock would be a second mutation path on a one-writer table.

## 5. Steps

1. **Types**: add `'stranded-past-ttl'` to `RoutingDecisionAbandonReasonValues`; update `routing-decision.types.spec.ts`. Add `resolveRoutingDecisionTtlMs(raw)` (env `OL_ROUTING_DECISION_TTL_MS`, default **1 h**, clamp `[15 min, 7 d]`, invalid falls back to default) and `describeRoutingDecisionTtl`. A spec asserts the floor is above `MAX_ROUTE_LOCK_TTL_MS` (10 min), so no configuration can reap a decision while its `route()` call may still be inside its budget (see section 4). Export the max lock TTL from `routing-commit-lock.ts` for that assertion rather than restating the number. One constant feeds the cutoff, the stamped detail and the read endpoint.
2. **Port + repo**: `findStrandedLive` ordered oldest-first, limited, `state = 'live' AND createdAt < cutoff`. No migration: the partial live index keeps the scan on the small live set. `abandonReason` is `varchar(64)`.
3. **Reaper service**: for each candidate call `terminalise({ state: 'abandoned', abandonReason: 'stranded-past-ttl' })` (`routerDecisionRef: null`; a silence is OL's inference, never recorded as the router declaring something, #2243). `false` counts as `raced`. Report `{ orderId, block: routing-failed, attention }` intents for reaped rows; counters `examined / reaped / raced / failed`; error log `routing_decision_reap_page_all_failed` when a whole page fails; age bound `routing_decision_stuck_unresolvable` for a candidate that keeps failing (the #2346 shape).
4. **Worker handler**: lock `fulfillment:routing:reap:{scopeId}`, frontier-as-query (no cursor), `resolveSweepBudget` / `resolveSweepLockTtlMs`, best-effort writes of the intents, `outcome: 'ok'`. Register job + `bulk` lane, scheduler task hourly at a minute offset from the existing sweeps, `.env.example` entries.
5. **Read endpoint**: `GET /orders/:internalOrderId/routing-decision` returns `{ state, routerConnectionId, ageMs, ttlMs, abandonReason, terminalisedAt }`, 404 when the order has no decision. Controller goes through a new `IRoutingDecisionQueryService` (the repository port is not reachable from `apps/api`).
6. **Attention**: add `routing-stuck` to the closed union and the descriptor table (counted, surfaces `order`), update its totality spec, and the FE mirror held identical by `scripts/check-attention-reason-mirror.mjs` (present on main) plus its copy table.
7. **Docs**: one bullet in `architecture-overview.md` § 26, `.env.example`, this plan.

## 6. Testing

- Unit: TTL resolver (clamp, invalid input), reaper service (reaped / raced / failed, intents), handler (lock held, best-effort writes), registration + lane coverage.
- Int-spec (real Postgres): stale `live` row is reaped and leaves the live index; a fresh decision can then be claimed; **overlapping reap vs `commit`**: exactly one wins and no work row survives a lost commit.
- Endpoint spec: shape, 404, roles.

## 7. Open questions (need a decision before step 1)

1. **TTL default — resolved (2026-10-27).** The issue gives no number, only the rules: the threshold must relate to the router's own timeout, and a reap must not free a slot while a call may still be committing. On main, one `route()` call is budgeted at half the routing lock TTL (`routing-commit-lock.ts`: lock default 120 s, clamp 10 s – 10 min, so the budget is 60 s by default and 5 min at most), and a timed-out result is discarded, so the in-process OL router can never commit late. Chosen: default 1 h, floor 15 min (above the 10 min maximum lock TTL), ceiling 7 d. 24 h was rejected: an order would sit invisible for a full day in a pilot that ships same or next day.
2. **`line-unfulfillable` after a reap.** The issue asks for it, but that reason means "a line cannot ship from anywhere" (a refund/return decision), while a stranded decision says nothing about lines. Proposal: set block `routing-failed` (re-routed by the existing sweep) and write `routing-stuck` attention, and do not write `line-unfulfillable` unless the re-route then refuses with unfulfillable lines (which #3485 already does). Confirm or override.
3. **Retry path before #3558.** `fulfillment.work.rerouteSweep` already re-drives `routing-failed`, so automatic retry works now; only the operator button waits for #3558.

## 8. Implementation notes (2026-10-27)

Deviations from the plan above, decided while implementing:

- **Hand-off is a route child, not a block write.** After a reap the worker records `routing-stuck` under the order's `routing` producer and enqueues `fulfillment.work.route` under the stranded decision's router (key `fulfillment:work:route:reap:{decisionId}`). That job routes under the routing lock and writes the real hold state and `routing` attention itself. Writing `routing-failed` unconditionally would race it (a concurrent route could clear the block and be overwritten), so `routing-failed` is written ONLY when the enqueue fails, as the fallback for `fulfillment.work.rerouteSweep`.
- **`routing-stuck` lives under the existing `routing` producer.** `AUTHORITY_ATTENTION_PRODUCER_REASONS` now maps each producer to a list (`routing: ['line-unfulfillable', 'routing-stuck']`), so the re-route's own outcome replaces or clears it. A separate producer would have needed a second writer to clear it after a successful route.
- **Job name** is `fulfillment.routing.reapSweep`; scheduler task `fulfillment-routing-reap-sweep` at `4,19,34,49 * * * *` (every 15 minutes, so an order waits at most TTL + one tick), env `OL_FULFILLMENT_ROUTING_REAP_SWEEP_ENABLED` (default on).
- **Read endpoint** lives in `apps/api/src/fulfillment/http/routing-decision.controller.ts` (`GET /orders/:internalOrderId/routing-decision`), served by `IRoutingDecisionReaperService.getStatusForOrder`, so `apps/api` never reaches the decision repository port.
- **No separate age-bound counter.** A reap always terminalises, so a decision cannot be recycled forever; a router that keeps going in doubt is re-reaped every TTL and each reap warn-logs `routing_decision_reaped`, which is the visible trace.
- **Review follow-up (2026-10-28): the reaper takes the routing lock.** The TTL is measured from `createdAt`, and a resume re-calls the router without writing the row, so the floor alone did not prove that no call was in flight. The reaper now reaps only while holding `fulfillment:route:{orderId}` (passed in as `RoutingLockPort`, the `RoutingCommitService` shape) and counts a held lock as `busy`, leaving the decision live for the next tick.
- **Review follow-up (2026-10-28): no hand-off to a route job that cannot route.** `fulfillment.work.route` returns without writing when no connection claims routing or no router resolves, which would leave a `routing-in-doubt` block naming an abandoned decision. The worker now resolves the routing holder and its router once per run first; when either is missing it writes the `routing-failed` fallback instead of enqueueing, and the route child carries the selected holder as its connection. The operator copy says routing "will be retried", never "was restarted".
- Open questions 2 and 3 resolved as proposed: no `line-unfulfillable` on a reap; the operator "Retry routing" button stays #3558.

### Tests
- Unit: TTL rules, reaper service, worker handler, controller, registration lanes, scheduler task list, attention vocabulary.
- Integration: `apps/api/test/integration/routing-decision-reaper.int-spec.ts` (stale decision reaped and slot freed, fresh and terminal decisions untouched, overlapping reap vs late commit with exactly one winner, a held routing lock leaving the decision live, latest-decision read).
