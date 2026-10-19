# Implementation Plan — Routed work stranded in `unsubmitted` (#3476)

## 1. Task

A routed `FulfillmentWork` stays in `requestStatus = 'unsubmitted'` for ever when
the OMS connection that holds it lacks an enabled `FulfillmentExecutor`:

1. `OlFulfillmentRouter` names the OMS connection as holder of every candidate
   without checking it can execute.
2. `FulfillmentWorkDispatchHandler` resolves the executor BEFORE the handshake
   claims the work, so every attempt throws a retryable error, the job
   dead-letters, and the work never leaves `unsubmitted`.
3. Nothing recovers it: the #2712 sweep reaps `submitted` only, re-routing is
   `already-routed`, and the dispatch dedupe key has no generation.

**Layer**: CORE (`libs/core/src/fulfillment`) + OMS (`libs/oms`) + Worker.

**Non-goals**
- A one-off backfill of `enabledCapabilities` (the issue lists it as an
  alternative; the guard is needed anyway because an operator can untick it).
- Remedy for `rejected` work (out of scope per the issue; #2395).
- A new job type — the stuck-work pass extends the #2712 timeout sweep.
- No migration: no schema change.

## 2. Design

### A. Refuse at assignment (AC1)

- `createOmsFulfillmentRouterResolver` already reads the connection to check
  `platformType`. It additionally reads
  `connection.enabledCapabilities.includes('FulfillmentExecutor')` and passes it
  to the router as a **required** dep `holderCanExecute: boolean` (required so a
  new caller cannot forget it).
- `RoutingFacts` gains `nonExecutingHolderIds: ReadonlySet<string>`; the router
  fills it with its own connection id when `holderCanExecute` is false.
- `evaluateRouting` (pure) eliminates candidates whose holder is in that set
  BEFORE any operator filter, emitting one explanation step **only when it
  eliminates something** (keeps the "no rules ⇒ empty explanation" invariant).
  When that guard is what emptied the candidate set, every line is unfulfillable
  with the stable reason
  *"the holding connection does not have the FulfillmentExecutor capability
  enabled, so no work can be dispatched to it"*.
- The committer refuses the plan as `plan-carries-unfulfillable` (unchanged), the
  order is held `routing-refused`, and #3485's reroute sweep re-routes it every
  tick — so once the operator enables the capability the order routes with no
  further action.
- **Visibility**: today the per-line reason is dropped — the block detail is just
  `plan-carries-unfulfillable`. `RoutingCommitOutcome`'s `refused` arm gains an
  optional `unfulfillableReasons: readonly string[]` (distinct, sorted router
  reasons), and `deriveRoutingHoldOutcome` puts them in `block.detail` and the
  UF-L `detail`. Router reasons are fixed sentences (no ids, no PII) and so are
  stable across re-routes, keeping the `IS DISTINCT FROM` guards effective.
  Side effect, accepted: existing out-of-stock held orders get a more specific
  detail once (one `updatedAt` bump each).

### B. Surface stuck `unsubmitted` work (AC2)

- `deriveAcceptanceAttention(works, options?)` gains
  `options.stalledUnsubmittedBefore?: Date`. A non-terminal work that is
  `unsubmitted`, holds a holder, and has `updatedAt` before the cutoff counts as
  unaccepted alongside `rejected`. Without the option, the behaviour is unchanged.
- `recomputeAcceptanceAttention(orderId, options?)` threads the option through.
  The dispatch handler passes the same cutoff (`now - dispatch timeout`), so a
  sibling's acceptance cannot clear a flag a stuck sibling should keep
  (split-safe, level-triggered).
- New repository read `listStalledUnsubmittedWorks({ idleBefore, afterWorkId,
  limit })`: non-terminal, `requestStatus = 'unsubmitted'`,
  `updatedAt < idleBefore`, `id > afterWorkId`, ordered by `id`.
  **Keyset, not frontier**: raising attention does not write the work row, so a
  frontier-as-query would re-read the same head page for ever. The cursor lives
  in `connection_cursors` (`fulfillment.unsubmitted.after`) and wraps on a short
  page — the reroute-sweep shape.
- New service method `findStalledUnsubmitted(...)` on
  `IFulfillmentDispatchTimeoutService` returns the works plus the attention
  intents for their orders (core reports, the worker writes — ADR-053).
- The threshold is the existing `OL_FULFILLMENT_DISPATCH_TIMEOUT_MS` (one
  resolution path, #2229). It is intentionally shorter than the dispatch retry
  ladder, so the operator hears about it while the job is still retrying.

### C. Make it re-drivable (AC3)

- `buildFulfillmentDispatchDedupeKey(workId, generation?)` → with a generation:
  `fulfillment:dispatch:{workId}:redrive:{generation}`. With none it stays the
  same, so existing producers are unchanged.
- In the timeout sweep handler, for each stalled `unsubmitted` work whose holder
  connection **now** has `FulfillmentExecutor` enabled (read via `ConnectionPort`;
  the core leaf cannot), enqueue `fulfillment.work.dispatch` with
  `generation = floor(now / timeoutMs)`. At most one re-drive per work per
  timeout window, and none while the connection is still misconfigured, so the
  queue does not fill with dead jobs.
- Safe against a still-retrying original job: both run `claimDispatchAttempt`,
  which yields exactly one claim (#2399).

## 3. Steps

1. `libs/oms/src/routing/routing-facts.types.ts` — add `nonExecutingHolderIds`.
2. `libs/oms/src/routing/evaluate-routing.ts` — the guard, the explanation step,
   and the specific unfulfillable reason.
3. `libs/oms/src/routing/ol-fulfillment-router.ts` — the `holderCanExecute` dep
   and filling the facts.
4. `libs/oms/src/routing/oms-fulfillment-router.resolver.ts` — read
   `enabledCapabilities`; warn when it is missing.
5. `libs/core/src/fulfillment/application/types/routing-commit.types.ts` +
   `routing-commit.service.ts` — carry `unfulfillableReasons` on `refused`.
6. `routing-hold-outcome.types.ts` — put the reasons in the details.
7. `fulfillment-dispatch-timeout.types.ts` — the `deriveAcceptanceAttention`
   option.
8. The repository port and its implementation — `listStalledUnsubmittedWorks`.
9. The `fulfillment-dispatch-timeout` service, its interface and sweep types —
   `findStalledUnsubmitted`, plus the option on `recomputeAcceptanceAttention`.
10. `fulfillment-dispatch-enqueue.types.ts` — the generation on the dedupe key,
    and the docblock updated (the constraint is now honoured).
11. `fulfillment-work-timeout-sweep.handler.ts` — the second pass: cursor,
    attention write, capability-gated re-drive.
12. `fulfillment-work-dispatch.handler.ts` — pass the stalled cutoff to recompute.
13. Tests: `evaluate-routing` guard and reason; the resolver passes the flag;
    `deriveRoutingHoldOutcome` details; `deriveAcceptanceAttention` stalled arm;
    service and handler (attention plus re-drive gated on the capability, the
    generation key); repository int-spec for the stalled read.
14. Docs: architecture overview § 26 — a short bullet.

## 4. Risks / open questions

- The A3-X descriptor reads "rejected or timed out"; stalled-unsubmitted is the
  same operator fact ("nobody has taken this work"), but the detail sentence
  differs so it can be told apart.
- Re-drive uses a time bucket rather than an attempt counter, because
  `assignmentAttempt` never moves while the work is unsubmitted.
