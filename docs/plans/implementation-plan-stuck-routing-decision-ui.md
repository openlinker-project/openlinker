# Implementation plan - surface a routing decision stranded `live` (#3557)

Epic G07 (#3511), under #3460. Layer: Frontend (`apps/web`) only. Priority P1.

## 1. Task understanding

#2731 (PR #3836) adds `GET /orders/:id/routing-decision` and the reaper that closes a decision stuck `live`.
#3558 (PR #3837) adds `POST /orders/:id/retry-routing`. This issue renders the operator-facing state on the
order detail page, read only (decision D4): no control forces, checks or aborts a decision.

States built (`data-mk-state`): `stuck`, `resolved`, `healthy`. Not built: `unknown`, `abandon`, `manual`.

### Non-goals
- Any backend change. Both endpoints exist (in the two open PRs this branch is stacked on, locally).
- A manual abandon / "Check with router" control (D4).
- The attention-list copy: #3836 already added `routing-stuck` to `attention-reason.ts` / `.copy.ts`
  (mirror-checked). This issue adds the order-detail surface only.

## 2. Findings

- The detail page already knows whether routing is on (`useOmsRoutingState()` -> `omsRouting`). The new query is
  enabled only when it is `'on'`, so an install without routing makes no extra request and sees no 404. (Same
  precedent as `OrderFulfillmentTasksPanel hideWhenEmpty`, #3505.)
- `GET .../routing-decision` answers 404 when an order has no decision. `useOrderInvoiceQuery` already maps a 404
  to `null` and lets every other error propagate; the same shape is used, so "no decision" is never confused with
  "the read failed".
- The response carries `ttlMs`, `ageMs`, `strandedSince`, `state`, `abandonReason`, `routerConnectionId`. The TTL
  shown is `ttlMs` from the response, never a frontend constant (AC 3).
- Server-owned vocabularies (`state`, `abandonReason`) are parsed as `z.string()` and compared against literals in
  one small lib (the `fulfillment.schema.ts` rule: no `z.enum` on a server-owned vocabulary).
- Router name: `useConnectionQuery(routerConnectionId)`; a failed or pending lookup degrades to a generic phrase
  ("the connection that decides where orders are packed"), never to a raw id as the only text.
- `Retry routing` is gated like the other order writes (`useWriteAccess('orders:write')`; the endpoint admits
  admin and operator). It is offered only while the order is held as `routing-refused` / `routing-failed`, the only
  states the endpoint accepts; otherwise it would certainly 409.
- The mockup M18 (`docs/plans/mockups/oms-mvp/m18-stuck-routing-decision.html`) is NOT in the repository yet (the
  issue says the epic commits it). Its `data-testid`s cannot be copied. Open question 1.

## 3. Design

### 3.1 API layer (`features/fulfillment/api`, `features/orders/api`)
- `fulfillment.types.ts` / `fulfillment.schema.ts`: `RoutingDecisionStatus` + `parseRoutingDecisionStatus`
  (`.nullish()` -> `null`, dates as ISO strings, numbers as numbers).
- `FulfillmentApi.getRoutingDecision(orderId)` -> `GET /orders/:id/routing-decision`.
  It lives on the fulfillment client because the decision belongs to the fulfillment context.
- `fulfillmentQueryKeys.routingDecision(orderId)` under the `['fulfillment', ...]` prefix (invalidated by any
  fulfilment action, which is correct: routing state can change).
- `OrdersApi.retryRouting(orderId)` -> `POST /orders/:id/retry-routing`, result `{ internalOrderId, jobId }`.
- `orders.types.ts`: `RetryOrderRoutingResult`.

### 3.2 Hooks
- `useRoutingDecisionQuery(orderId, { enabled })` - 404 -> `null`; other errors propagate. No polling: the page
  refetches on focus, and the retry mutation invalidates it.
- `useRetryOrderRoutingMutation()` - invalidates `ordersQueryKeys.all` and `fulfillmentQueryKeys.all` on success.

### 3.3 Pure lib: `lib/routing-decision-state.ts`
`resolveRoutingDecisionState(decision, orderBlockReason) -> 'stuck' | 'resolved' | 'healthy' | null`
- `stuck`: `state === 'live'` and `strandedSince !== null` (past the time limit, reaper has not run yet).
- `healthy`: `state === 'committed'` - the router answered and work was assigned. The mockup shows a positive
  line, "Routed automatically" (a `live` decision still within its limit is a transient wait and renders nothing).
- `resolved`: `state === 'abandoned'` and `abandonReason === 'stranded-past-ttl'` (the reaper closed it).
- anything else (`live` within its limit, or abandoned for another reason) -> `null`: nothing to say.
`canRetryRouting(orderBlockReason)`: true for `routing-refused` / `routing-failed`.
Copy lives in `lib/routing-decision.copy.ts`, one entry per state.

### 3.4 Component: `RoutingDecisionPanel` (features/fulfillment/components)
Props: `internalOrderId`, `orderBlockReason`, `enabled`. Four reads of the query are distinguished and none is
reported as another: loading (skeleton line), FAILED (error alert with a Retry of the READ), no decision (renders
nothing, never a "no decision" claim), a decision (the state above).
- `stuck`: warning Alert. Title says OpenLinker is waiting for the router's own answer. Body: how long
  (`formatDurationMs(ageMs)`), the limit (`formatDurationMs(ttlMs)`), the router name, and one sentence that
  OpenLinker stops waiting and chooses again on its own. NO button.
- `healthy`: neutral line "Routed automatically". NO button.
- `resolved`: info Alert "OpenLinker stopped waiting for <router> and chose again" + (when `canRetryRouting` and the
  user may write) a `Retry routing` button. The outcome is reported: enqueued -> success note ("Routing was
  started again. The order updates when it finishes"), 409 -> the reason in plain words
  (not held / not retryable / no router), 503 -> a retryable error, 404 -> order gone. Error copy is mapped from
  the status + `code` field, never the server message.
- `data-testid`: `routing-decision-panel`, and `data-mk-state` carrying the state, plus `routing-decision-retry`.
Mounted in `order-detail-page.tsx` beside `OrderFulfillmentTasksPanel`, keyed per order.

## 4. Steps
1. Types + schema + api + query key (+ tests).
2. Orders api `retryRouting` (+ test) and the two hooks.
3. `routing-decision-state.ts` + copy (+ unit tests, including the three states and the null cases).
4. `RoutingDecisionPanel` (+ component tests per state, per read state, per retry outcome).
5. Mount in `order-detail-page.tsx`.
6. `docs/architecture-overview.md` bullet (frontend half of #2731 / #3558); `docs/frontend-ui-style-guide.md` only
   if a new pattern is introduced (not expected).
7. Gate: type-check, eslint on changed files, targeted vitest, `pnpm check:invariants` (UI-vocabulary + mirrors).

## 5. Tests (vitest + Testing Library)
- state lib: every state and the null arms; `canRetryRouting`.
- panel: stuck shows age, limit from the response (a different `ttlMs` changes the text), router name, no button;
  healthy has no button; resolved with a retryable block shows the button, without it shows none; read-only roles
  see no button; retry success/409/503 messages; a failed read shows an error, not "nothing"; a 404 shows nothing.
- hook: 404 -> null, other error propagates.
- page: query is not issued when `omsRouting !== 'on'`.

## 6. Open questions / risks
1. **Mockup M18 is not in the repo**, so AC "same `data-testid`s as the committed mockup" cannot be met literally.
   Plan: use the ids above and align them once the mockup lands.
2. **Stacked on two unmerged PRs** (#3836, #3837): the code compiles only with both. This branch carries them as
   uncommitted working-tree changes; the PR for this issue must wait for them or be based on them.
3. `healthy` is `committed` ("Routed automatically"), per the mockup; it adds one quiet line to every routed order.
4. Router identity is a connection lookup per order page; acceptable (one cached read), and degrades gracefully.
5. The copy must pass `check-ui-vocabulary`; words such as "decision" / "reaper" stay out of operator text.
