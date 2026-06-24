# Implementation Plan: ErliOrderSourceAdapter — inbox-poll feed + getOrder + scheduled poll (#993)

**Date**: 2026-06-16
**Status**: Ready for Review
**Estimated Effort**: ~1.5 days (adapter + provisional wire types + cross-file wiring + unit tests)
**Branch**: `993-erli-order-source` (stacked on the Erli chain; the #994 mapper is already present at `libs/integrations/erli/src/infrastructure/adapters/erli-order.mapper.ts`)

---

## 1. Task Summary

**Objective**: Implement `ErliOrderSourceAdapter implements OrderSourcePort` so Erli orders flow into the existing core ingestion pipeline. Three pieces:

1. **`listOrderFeed(input)`** — read Erli's **inbox** (`GET /svc/shop-api/inbox`, ≤500 unread), filter `orderCreated` / `orderStatusChanged` events, map to neutral `OrderFeedItem[]`, derive a `nextCursor` from the newest read inbox message id. **Acks happen on the NEXT poll, not this one**: at the start of each call the adapter marks-read every message with id `<= input.fromCursor` (those are confirmed enqueued in a prior poll, since core commits the cursor only after a successful enqueue), then filters the unread list to messages with id `> input.fromCursor`. The messages it returns are NEVER acked before their `marketplace.order.sync` job is enqueued — this is what gives the at-least-once guarantee (see §8).
2. **`getOrder({ externalOrderId })`** — fetch the full Erli order resource via the existing `ErliHttpClient`, validate the wire shape, and translate to `IncomingOrder` via the **#994 mapper** `mapErliOrderToIncomingOrder` (`libs/integrations/erli/src/infrastructure/adapters/erli-order.mapper.ts:58`).
3. **Scheduled inbox-poll task** — the mandatory backstop (Erli webhooks are fire-once/no-retry per ADR-025 §1, line 12/19/27). Mirrors the existing `erli-offer-status-sync` task in `erli-scheduler-tasks.ts:34`.

Plus the cross-file wiring that makes the capability resolvable: add `'OrderSource'` to the static manifest `supportedCapabilities`, the plugin dispatch table, the factory's returned adapter bundle, and register the scheduler task.

**Context**: Issue #993 is the order-ingestion half of the Erli plugin (ADR-025). Core already drives the whole flow connection-agnostically (`OrderIngestionService` → `listOrderFeed` → enqueue → `getOrder` → `syncOrderFromSource`) and the worker handlers + jobTypes already exist (`marketplace.orders.poll`, `marketplace.order.sync`). Erli just needs to supply the `OrderSource` capability adapter and a scheduler task that enqueues the existing poll job. **No core change is required.**

**Classification**: Integration / Adapter (all changes live under `libs/integrations/erli/`). Zero CORE edits.

---

## 2. Scope & Non-Goals

### In Scope
- `ErliOrderSourceAdapter` (`libs/integrations/erli/src/infrastructure/adapters/erli-order-source.adapter.ts`) implementing `OrderSourcePort.listOrderFeed` + `getOrder`.
- A new provisional wire-types file `erli-inbox.types.ts` (the **single #992 reconciliation point** for the inbox endpoint, event-type names, message-id/cursor semantics, ack shape) beside `erli-order.types.ts`.
- Runtime validation of the wire order in `getOrder` before handing it to the trusting mapper.
- Scheduler task `erli-orders-poll` in `erli-scheduler-tasks.ts`.
- Cross-file wiring: manifest `supportedCapabilities`, plugin dispatch table, factory `ErliAdapters` bundle + construction.
- Unit tests over authored #992-provisional fixtures.

### Out of Scope (explicit non-goals)
- **Identity mapping** — stays downstream in core (`OrderIngestionService`, #995). The adapter emits raw external ids only, exactly as the #994 mapper already does (`erli-order.mapper.ts:18-26`, mirroring `allegro-order-source.adapter.ts:59-61`).
- **Webhook ingestion path** — the inbound webhook translator/route is a separate concern; this PR delivers only the poll backstop. The two paths do NOT dedupe by event key (a webhook carries a different event id than the inbox message, so both enqueue); instead they **converge to one order record** because `syncOrderFromSource` get-or-creates the internal id by `externalOrderId` and UPSERTS (`order-ingestion.service.ts:191,206,274`) — last-write-wins on one record (no work needed here for convergence — see §6 Phase 3).
- **Cancellation stock-restore PATCH** — ADR-025 §4a (line 22) tags this `#993`, but **defers it**: "core has no order-cancellation orchestration yet (`OrderProcessorManagerPort` only has `createOrder`)". There is no core hook from which to trigger the PATCH on observing a `cancelled` status. → **Out of scope here**; flagged as an open follow-up in §5. The adapter faithfully surfaces `cancelled` status through the mapper (`erli-order.mapper.ts:97-98`) so the future orchestration can act on it.
- **Sandbox confirmation of wire shapes** — #992-provisional; this PR ships against authored fixtures and a single reconciliation point.
- Any new core port, entity, DTO, migration, or worker handler — all already exist.

### Constraints
- **#992-provisional**: inbox endpoint path/shape, event-type literals (`orderCreated` / `orderStatusChanged`), message-id ordering/cursor semantics, ack mechanism, and the order-resource fetch path are **UNCONFIRMED** (no sandbox). All inbox wire assumptions concentrate in `erli-inbox.types.ts` with `#992-PROVISIONAL` markers — same discipline as `erli-product.types.ts` / `erli-order.types.ts`.
- **Lockstep manifest rule**: a registered manifest must declare only capabilities its factory can construct (`erli-plugin.ts:5-10` — `IntegrationsService.listCapabilityAdapters` treats any non-`AdapterNotFoundException` factory error as fatal). So manifest + dispatch table + factory bundle must all gain `OrderSource` **in the same PR**.
- Adapter is connection-agnostic and identity-free (no `IdentifierMappingPort` use in the adapter).

---

## 3. Architecture Mapping

**Target Layer**: Integration → `libs/integrations/erli/src/infrastructure/adapters/` (adapter), `.../infrastructure/scheduler/` (task), `.../application/erli-adapter.factory.ts` + `src/erli-plugin.ts` (wiring).

**Capabilities Involved**:
- `OrderSourcePort` (`libs/core/src/orders/domain/ports/order-source.port.ts:41`) — the only capability this PR implements. Methods: `listOrderFeed(OrderFeedInput): Promise<OrderFeedOutput>` (line 48), `getOrder({ externalOrderId }): Promise<IncomingOrder>` (line 57).

**Existing Services Reused** (no edits):
- `OrderIngestionService` (`libs/core/src/orders/application/services/order-ingestion.service.ts:82` `ingestOrders`, `:178` `syncOrderFromSource`) — drives the whole flow; cursor read/commit-after-enqueue safety lives here (`:130-153`).
- `OrdersPollHandler` (`apps/worker/src/sync/handlers/orders-poll.handler.ts:24`) and `MarketplaceOrderSyncHandler` — registered for `marketplace.orders.poll` / `marketplace.order.sync` (`apps/worker/src/sync/handlers/handler-registration.service.ts:59-60`).
- `ErliHttpClient` / `IErliHttpClient` (`libs/integrations/erli/src/infrastructure/http/erli-http-client.interface.ts:17`) — `get/post/patch`; built per-connection by `ErliAdapterFactory.createHttpClient` (`erli-adapter.factory.ts:74`).
- `mapErliOrderToIncomingOrder` (#994, `erli-order.mapper.ts:58`).
- `buildErliSchedulerTasks` (`erli-scheduler-tasks.ts:34`) + `SchedulerTaskConfig` shape.

**New Components Required**:
- `ErliOrderSourceAdapter` (infrastructure adapter).
- `erli-inbox.types.ts` (provisional wire types — inbox listing, inbox event, ack request/response).
- `erli-orders-poll` `SchedulerTaskConfig`.
- Adapter unit spec.

**Core vs Integration Justification**: Per-platform inbox semantics (endpoint, event filter, cursor = newest-read message id, ack mechanic) are platform-specific and belong in the adapter behind the platform-neutral `OrderSourcePort`. Core already exposes the seam and drives it. This is a textbook Integration task — CORE remains untouched (Architecture Overview § Capability Assignment).

---

## 4. External / Domain Research

### External System (Erli) — all #992-PROVISIONAL
- **Auth**: static API key per connection (ADR-025), already resolved by `ErliAdapterFactory.resolveCredentials` (`erli-adapter.factory.ts:84`) and injected into `ErliHttpClient`.
- **Inbox endpoint** (assumed): `GET /svc/shop-api/inbox` returns up to 500 **unread** messages. Each message carries a message id, an event-type discriminator (`orderCreated` / `orderStatusChanged` among others), an order reference, and a timestamp.
- **Ack / read-marking** (assumed): marking a message read removes it from the next "unread" listing — this bounds the unread window (it does NOT itself advance the cursor; core commits the cursor). Modeled provisionally as a `PATCH` (idempotent; `IErliHttpClient.patch` is documented retried — `erli-http-client.interface.ts:27`). Whether ack is per-message or "mark up to id" is #992-open (see §5). **Critical**: because the inbox is unread-filtered and an acked message never returns from a re-read, acking must only ever happen for messages **confirmed behind the last committed cursor** (id `<= input.fromCursor`) — never for the messages a `listOrderFeed` call is currently returning (those are not yet enqueued). This is the ack-on-next-read design (§6 Phase 2, §8).
- **Order resource fetch** (assumed): `GET /svc/shop-api/orders/{id}` returning the `ErliOrder` shape already modeled in `erli-order.types.ts:91`.
- **Webhooks**: fire-once, 5 s timeout, **no retry** (ADR-025 line 12) → poll backstop is mandatory for correctness (line 19/27).
- **Cancellation**: Erli does not restore stock on cancel (ADR-025 line 15) — compensation deferred (§2 Non-Goals).

### Internal Patterns
- **Reference adapter — Allegro** (`allegro-order-source.adapter.ts`): ctor deps `(connectionId, httpClient, _connection)` (`:68-74`); `listOrderFeed` reads an event journal, derives `nextCursor` from a source-provided `lastEventId` with a fall-through to "keep current cursor when empty so it never gets stuck" (`:175-177`), **dedupes by order id keeping the latest event** (`:184-191`), maps to `OrderFeedItem` with `eventKey`/`eventId` (`:193-208`), and filters by `input.eventTypes` (`:208`). `getOrder` fetches the full resource and returns `IncomingOrder` with **raw** buyer ids (`:229-308`). Identity mapping is downstream (`:226-227`). **Note**: Allegro's event journal is NOT unread-filtered (a re-read returns the same events), so Allegro has no ack step — Erli's unread inbox is materially different and forces the ack-on-next-read design. **Do NOT copy Allegro's `logger.debug(JSON.stringify(response.data))` pattern** — the Erli inbox/order payloads carry buyer PII (see §5 No-PII rule).
- **`OrderFeedItem` contract** (`libs/core/src/orders/domain/types/order-feed.types.ts:47`): `externalOrderId` (line 51), `eventType: OrderFeedEventType` (line 56; closed set `['created','updated','cancelled','paid']`, line 20), `occurredAt` ISO string (line 61), `eventKey` (stable dedupe/idempotency key, line 69), optional `eventId` (line 74), optional `raw` (line 79). `OrderFeedOutput = { items, nextCursor }` (line 89); `nextCursor` must be monotonic per connection (line 90-91).
- **`OrderFeedInput`** (line 27): `fromCursor: MarketplaceCursor | null`, `limit: number`, optional `eventTypes?`.
- **Scheduler task pattern** — Erli (`erli-scheduler-tasks.ts:34`): no `ConfigService` (Erli is wired via `createNestAdapterModule`), task registered unconditionally with `enabledEnvVar` re-checked each tick. Allegro orders-poll payload shape (`allegro-scheduler-tasks.ts:66-79`): `{ schemaVersion:1, cursorKey, limit }` + idempotency key `marketplace:${connection.id}:orders:poll:${timestamp}`.
- **Plugin dispatch** (`erli-plugin.ts:89-108`): `createCapabilityAdapter` builds the factory, calls `createAdapters`, and routes through `dispatchCapability<T>(capability, { OfferManager: () => adapters.offerManager }, ERLI_BRAND)`.

---

## 5. Questions & Assumptions

### Open Questions (all #992-PROVISIONAL, isolated in `erli-inbox.types.ts`)
- **Q-INBOX-1 — endpoint & response shape**: Is it `GET /svc/shop-api/inbox`? Is the list under `messages`/`items`/top-level array? Pagination beyond 500? **Assumption**: `GET /svc/shop-api/inbox`, response `{ messages: ErliInboxMessage[] }`, single page ≤500 (poll cadence + 500 cap covers steady state).
- **Q-INBOX-2 — message id ordering & cursor-regression compatibility**: Are message ids monotonic/sortable so "newest read" is well-defined? **Assumption**: ids are ascending with time (mirrors Allegro `lastEventId`); the adapter derives newest by max id among the messages it processed. **Hard constraint** — core's `OrderIngestionService.isCursorRegression(fromCursor, nextCursor)` (`order-ingestion.service.ts:138-176`) compares two cursors **numerically first, else lexicographically**, and SILENTLY refuses to commit a regressing cursor. If the cursor stalls this way, the unread window is never bounded and overflows the 500 cap → silent loss. Therefore the cursor representation MUST be provably non-regressing under that comparison: either consistently numeric-parseable, OR consistently lexicographically-ascending. If ids are numeric but large/variable-width (where lexicographic and numeric order diverge — e.g. `"9"` vs `"10"`), the adapter MUST emit a **zero-padded fixed-width** string so lexicographic order matches numeric order. If ids turn out unordered, the cursor falls back to the per-message timestamp (also monotonic) — single-helper fix. Acceptance/test point added in §9.
- **Q-INBOX-3 — event-type literals**: Exactly `orderCreated` / `orderStatusChanged`? Any others to ignore? **Assumption**: those two literals are order-relevant; all other event types are filtered out.
- **Q-INBOX-4 — ack mechanism**: Per-message `PATCH /svc/shop-api/inbox/{id}` `{ read: true }`, or a bulk "mark read up to id"? **Assumption**: per-message PATCH. **What gets acked, and when**: ack-on-next-read — at the START of each `listOrderFeed(input)` call, the adapter marks-read every unread message whose id is `<= input.fromCursor` (confirmed enqueued in a prior poll). It NEVER acks the messages it is returning in the current call. Modeled in `erli-inbox.types.ts`; behind a private `markRead(messageId)` helper so a bulk "mark up to id" swap is one method.
- **Q-INBOX-5 — order id on the message**: Does the inbox message carry the order id directly, or only a reference needing a second lookup? **Assumption**: message carries `orderId` directly (→ becomes `externalOrderId`).
- **Q-INBOX-6 — order fetch path**: `GET /svc/shop-api/orders/{id}`? **Assumption**: yes; provisional, isolated in `erli-inbox.types.ts` (or a small const in the adapter) and trivially changed.
- **Q-CANCEL (follow-up, not this PR)**: ADR-025 §4a tags the cancel-stock-restore PATCH `#993` but there is no core order-cancellation orchestration to trigger it. **Recommendation**: explicitly defer; raise a follow-up issue once `OrderProcessorManagerPort` gains a cancel/observe hook. Documented in the adapter header so the deferral is discoverable.

### Assumptions (safe defaults)
- Inbox cap 500 is plenty per poll at the planned cadence (default cron `*/5 * * * *`, env-gated).
- Cursor = newest read inbox message id (ADR-025 line 27). On an **empty** inbox the adapter **keeps the incoming cursor** (returns `fromCursor` unchanged) so it never gets stuck — same guard as Allegro (`allegro-order-source.adapter.ts:175-177`).
- **Ack-on-next-read** (the order-loss-safe design): `listOrderFeed` does NOT ack the messages it reads/returns. Instead it acks (at call start) only messages with id `<= input.fromCursor` — those are confirmed behind the last committed cursor, hence already enqueued in a prior poll (core commits the cursor only after a successful enqueue, `order-ingestion.service.ts:130-151`). The messages this call returns get acked by the SUBSEQUENT poll, once core has committed them into `fromCursor`. **Guarantee: at-least-once** — a crash between enqueue and the next-poll ack causes a harmless re-read + re-enqueue (deduped downstream by `syncOrderFromSource`'s externalOrderId-keyed upsert). Never at-most-once / never silent loss. See §8 cursor/ack reasoning.
- **Inbox-item validation**: the inbox list response is NOT trusted. `listOrderFeed` verifies `messages` is an array; per item it SKIPs (drops + `logger.warn` with the message id ONLY) any item missing a string `id` / `orderId` or carrying an unknown `type`. One poisoned item must not throw and abort the whole unread batch.

### No-PII-in-logs rule
- The adapter MUST NOT log inbox or order payloads at **any** level — they carry buyer PII. Do **not** copy Allegro's `logger.debug(JSON.stringify(response.data))`. Error logs use `(error as Error).message` only; the per-item skip warn logs the message **id only**.
- `assertErliOrder` failure MUST construct `ErliApiException` with a **field-level** reason (e.g. `"lineItems missing"`, `"buyer.id not a string"`), and MUST NOT pass the raw malformed order body into `responseBody` (that field "MUST NOT be logged above debug" and would carry PII).

### Documentation Gaps
- No Erli sandbox → wire shapes unverified (the entire #992 thread). Mitigated by the single-reconciliation-point discipline + authored fixtures.

---

## 6. Proposed Implementation Plan

### Phase 1 — Provisional inbox wire types (the #992 reconciliation point)
**Goal**: One file that owns every unconfirmed inbox assumption.

1. **Create `erli-inbox.types.ts`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-inbox.types.ts`
   - **Action**: Define, all marked `PROVISIONAL (#992)` in the header (copy the discipline from `erli-order.types.ts:11-17`):
     - `ErliInboxEventType` — open `string` alias documenting the two known order literals (`'orderCreated'`, `'orderStatusChanged'`), mirroring `ErliOrderPaymentMethod`'s "open string, known literals documented" choice (`erli-order.types.ts:38-44`). Plus two exported `const` literals `ERLI_INBOX_ORDER_CREATED = 'orderCreated'` / `ERLI_INBOX_ORDER_STATUS_CHANGED = 'orderStatusChanged'` so the adapter filter and the spec share one source.
     - `ErliInboxMessage` — `{ id: string; type: ErliInboxEventType; orderId: string; occurredAt?: string; read?: boolean }`.
     - `ErliInboxListResponse` — `{ messages: ErliInboxMessage[] }`.
     - `ErliInboxAckRequest` — `{ read: true }` (provisional ack body).
     - Path constants or a documented note for the inbox GET, ack PATCH, and order GET (Q-INBOX-1/4/6).
     - A documented note on the **cursor representation** (Q-INBOX-2): the value emitted as `nextCursor` MUST be non-regressing under core's `isCursorRegression` numeric-then-lexicographic comparison (`order-ingestion.service.ts:138-176`). If ids are numeric-but-wide, the adapter zero-pads to a fixed width so lexicographic order matches numeric order; if unordered, it falls back to the per-message timestamp. (The transform lives in the adapter; the constraint is documented here.)
   - **Acceptance**: file compiles; only place referencing inbox endpoint/shape literals; header carries `#992-PROVISIONAL` and a "single reconciliation point" note.
   - **Dependencies**: none.

### Phase 2 — The adapter
**Goal**: `ErliOrderSourceAdapter implements OrderSourcePort`.

2. **Create `erli-order-source.adapter.ts`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-order-source.adapter.ts`
   - **Naming**: `*-order-source.adapter.ts` — verified suffix convention (Allegro `allegro-order-source.adapter.ts`, PrestaShop `prestashop-order-source.adapter.ts`). Class `ErliOrderSourceAdapter` (`{Platform}{Capability}Adapter`, engineering-standards § Class Names).
   - **Ctor**: `(connectionId: string, httpClient: IErliHttpClient)` — mirrors `ErliOfferManagerAdapter`'s `(connectionId, adapterKey, httpClient, cache?)` minus the offer-only deps; no `IdentifierMappingPort` (identity is downstream). `private readonly logger = new Logger(ErliOrderSourceAdapter.name)`.
   - **`listOrderFeed(input)`** — **ack-on-next-read** (order-loss-safe; do NOT ack the messages this call returns):
     1. `GET` the inbox via `httpClient.get<ErliInboxListResponse>(<inbox path>, { queryParams: { limit: Math.min(input.limit, 500) } })`. Do NOT log the response body (PII).
     2. **Inbox guard**: verify `response.messages` is an array (else throw `ErliApiException` with a field-level reason — `"inbox response: messages not an array"`, no body). Then per item, SKIP (drop + `logger.warn` with the message **id only**) any item missing a string `id` / `orderId` or carrying an unknown `type`. A single poisoned item must not abort the batch.
     3. **Ack the prior wave (NOT this one)**: from the surviving valid messages, mark-read every message whose id is `<= input.fromCursor` (when `fromCursor` is non-null). These are confirmed behind the last committed cursor — i.e. enqueued in a prior poll — so acking them is safe and bounds the unread window. Call the private `markRead(messageId)` helper per such id; wrap each in try/catch + `logger.warn` (id only) — a failed ack is not fatal (the message stays unread and is re-acked next poll). **No message with id `> input.fromCursor` is ever acked here.**
     4. **Filter to the new wave**: keep only messages with id `> input.fromCursor` (when `fromCursor` is non-null; otherwise keep all). Then filter to the two order event literals (Q-INBOX-3).
     5. **Dedupe by `orderId`, keeping the newest message** (highest id / latest `occurredAt`) — same intent as Allegro's dedupe-by-checkoutFormId (`allegro-order-source.adapter.ts:184-191`). Prevents enqueuing two jobs for one order when both `orderCreated` and `orderStatusChanged` are unread together.
     6. Map each surviving message → `OrderFeedItem`: `externalOrderId = msg.orderId`, `eventType = mapErliInboxEventType(msg.type)` (`orderCreated → 'created'`, `orderStatusChanged → 'updated'`), `occurredAt = msg.occurredAt ?? new Date().toISOString()`, `eventKey = msg.id` (stable per inbox message → idempotency key), `eventId = msg.id`, `raw = { type: msg.type }`.
     7. Apply `input.eventTypes` filter if present (mirror `allegro-order-source.adapter.ts:208`).
     8. Derive `nextCursor`: **newest read id** among the new-wave messages this call returns (max id, emitted in the regression-safe representation from Q-INBOX-2 — zero-padded if numeric-but-wide). If there were no new-wave order events, **return `input.fromCursor` unchanged** (never-stuck guard). The messages reflected in this `nextCursor` are acked by the NEXT poll's step 3, after core has committed `nextCursor`.
     9. Return `{ items, nextCursor }`.
   - **`getOrder({ externalOrderId })`**:
     1. `GET` the order via `httpClient.get<unknown>(<order path>/{externalOrderId})`. Do NOT log the response body (PII).
     2. **Validate the wire order** (`assertErliOrder`) — the mapper is documented as trusting (`erli-order.mapper.ts:24-26`: "a genuinely malformed wire object is the #993 adapter's concern"). Validate the required fields the mapper dereferences without guards: `id: string`, `status` ∈ `ErliOrderStatus`, `buyer.id: string`, `lineItems: array` with each item's `id`/`productExternalId`/`quantity`/`price.amount`, `totals.total: number` + `totals.currency: string`. On failure throw `ErliApiException` (already exported, `index.ts`) with a **field-level reason string** (e.g. `"lineItems missing"`, `"buyer.id not a string"`) — **NEVER pass the raw malformed order body into `responseBody`** (PII; that field MUST NOT be logged above debug). Keeps it inside the typed Erli hierarchy the retry/auth classifiers already understand.
     3. `return mapErliOrderToIncomingOrder(order)`.
   - **Error handling**: let `ErliHttpClient`'s typed exceptions (`ErliApiException` / `ErliAuthenticationException` / `ErliRateLimitException` / `ErliNetworkException`) propagate — the core job runner + the registered retry/auth-failure classifiers (`erli-plugin.ts:75-79`) already handle them. Match Allegro's log+rethrow shape (`allegro-order-source.adapter.ts:214-220`) but with `(error as Error).message` only — **never** `JSON.stringify(response.data)` (PII).
   - **Acceptance**: implements `OrderSourcePort`; `listOrderFeed` returns correctly-shaped `OrderFeedOutput`; `getOrder` returns the mapper's `IncomingOrder`. Type-checks against the core port.
   - **Dependencies**: Phase 1.

### Phase 3 — Wiring (manifest + dispatch + factory + scheduler)
**Goal**: Make `OrderSource` resolvable per-connection and the poll scheduled.

3. **Factory: construct + expose the adapter**
   - **File**: `libs/integrations/erli/src/application/erli-adapter.factory.ts`
   - **Action**: Extend `ErliAdapters` (`:37`) with `orderSource: OrderSourcePort` (import the type from `@openlinker/core/orders`). In `createAdapters` (`:57`) build `new ErliOrderSourceAdapter(connection.id, httpClient)` reusing the same `httpClient` already created at `:63` (one client shared by both adapters, exactly as Allegro shares one — `allegro-order-source.adapter.ts:56-61`).
   - **Acceptance**: `createAdapters` returns `{ offerManager, orderSource }`; existing factory spec still passes (extend it to assert `orderSource`).
   - **Dependencies**: Phase 2.

4. **Plugin: dispatch table + manifest**
   - **File**: `libs/integrations/erli/src/erli-plugin.ts`
   - **Action**: Add `OrderSource: () => adapters.orderSource` to the `dispatchCapability` table (`:104-106`). Add `'OrderSource'` to `erliAdapterManifest.supportedCapabilities` (`:52`) — keeps static + runtime views aligned (#575). Register the new scheduler task (already happens via the `for (const task of buildErliSchedulerTasks())` loop at `:84` — no edit needed beyond Phase 3 step 5).
   - **Acceptance**: `supportedCapabilities` = `['OfferManager', 'OrderSource']`; dispatch resolves `OrderSource`; lockstep rule (`:5-10`) satisfied. Update `erli-plugin.spec.ts` assertions on supported capabilities.
   - **Dependencies**: Phase 3 step 3.

5. **Scheduler: `erli-orders-poll` task**
   - **File**: `libs/integrations/erli/src/infrastructure/scheduler/erli-scheduler-tasks.ts`
   - **Action**: Add a second `SchedulerTaskConfig` to the array returned by `buildErliSchedulerTasks` (`:34`):
     ```
     taskId: 'erli-orders-poll',
     platformType: 'erli',
     jobType: 'marketplace.orders.poll',          // existing core handler (handler-registration.service.ts:59)
     cronExpression: ERLI_ORDERS_POLL_CRON,        // default '*/5 * * * *' (matches Allegro orders-poll)
     enabledEnvVar: 'OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED',
     generatePayload: () => ({ schemaVersion: 1, limit: ERLI_ORDERS_POLL_LIMIT, cursorKey: 'erli.orders.inboxCursor' }),
     generateIdempotencyKey: (connection, timestamp) => `marketplace:${connection.id}:orders:poll:${timestamp}`,
     ```
     Define module consts `ERLI_ORDERS_POLL_CRON = '*/5 * * * *'` and `ERLI_ORDERS_POLL_LIMIT = 200` (≤500 inbox cap). Update the file header to document the second task (cursorKey `erli.orders.inboxCursor`, env gate, ADR-025 backstop rationale).
   - **Acceptance**: `buildErliSchedulerTasks()` returns 2 tasks; the new one uses the existing `marketplace.orders.poll` jobType + a distinct cursor key; env-gated.
   - **Dependencies**: none (independent of Phase 2, but ship together).

### Phase 4 — Tests (authored #992-provisional fixtures)
6. **`erli-order-source.adapter.spec.ts`** — see §9.
7. **Update `erli-plugin.spec.ts` + `erli-adapter.factory.spec.ts`** — assert `OrderSource` is supported/dispatched and the factory builds `orderSource`.

### Implementation Details
- **New Components**: Infrastructure — `ErliOrderSourceAdapter`, `erli-inbox.types.ts`; Scheduler — `erli-orders-poll` task. No domain/application/interface-layer additions.
- **Configuration Changes**: new env var `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED` (gate); cron default `*/5 * * * *` (const, no ConfigService — consistent with `erli-scheduler-tasks.ts:18-22`). Document in `.env.example` if Erli vars are tracked there.
- **Database Migrations**: none.
- **Events**: none emitted by the adapter. The scheduler enqueues `marketplace.orders.poll`; core fans out `marketplace.order.sync` per feed item (`order-ingestion.service.ts:114-128`).
- **Error Handling**: reuse Erli's typed exception hierarchy; `getOrder` raises `ErliApiException` on malformed wire orders; ack failures are warn-logged, not fatal.

---

## 7. Alternatives Considered

### Alt 1 — Cursor = max order id (not inbox message id)
- **Description**: Track the highest order id seen instead of the inbox message id.
- **Rejected**: ADR-025 (line 27) fixes the cursor as "newest-read inbox message id"; order ids aren't guaranteed monotonic vs. inbox arrival, and `orderStatusChanged` for an old order would be missed. Inbox-message-id cursor + "unread" filter is the spec'd, correct model.

### Alt 2 — Don't ack; rely solely on the cursor
- **Description**: Skip the read-marking PATCH and page purely by cursor.
- **Rejected**: the inbox endpoint is "≤500 **unread**" — without acking, the unread set never shrinks and a high-traffic seller overflows 500 between polls, silently dropping events. Acking is what bounds the unread window. (Cursor is still committed by core for replay-safety; ack-on-next-read — acking only messages confirmed behind `fromCursor` — keeps the window bounded without ever acking before enqueue. See §8.)

### Alt 3 — Validate inside the mapper instead of the adapter
- **Description**: Push wire validation into `mapErliOrderToIncomingOrder`.
- **Rejected**: the #994 mapper is deliberately pure/total/trusting (`erli-order.mapper.ts:24-26`) and its security review assigned runtime validation to the #993 adapter. Keeping validation in the adapter preserves the mapper's purity and the documented boundary.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Integration-only; zero CORE edits. Implements the existing `OrderSourcePort` behind the registry seam.
- ✅ Identity mapping stays downstream (adapter emits raw ids) — matches the documented boundary (Architecture Overview § OrderSourcePort; `allegro-order-source.adapter.ts:226-227`).
- ✅ Reuses the connection-agnostic `OrderIngestionService` + existing worker handlers/jobTypes.

### Naming Conventions
- ✅ `erli-order-source.adapter.ts` / `ErliOrderSourceAdapter` (matches Allegro/PrestaShop suffix + `{Platform}{Capability}Adapter`).
- ✅ Types in a dedicated `*.types.ts` (`erli-inbox.types.ts`); `as const` literals for event types.

### Existing Patterns
- ✅ Dedupe-by-order-id, never-stuck-cursor guard, log+rethrow error handling, scheduler `SchedulerTaskConfig` shape, plugin dispatch-table entry — all mirror shipped code (cited above).

### Risks
- **#992 wire drift**: every inbox assumption is wrong-until-sandbox. **Mitigation**: single reconciliation file `erli-inbox.types.ts` + helper-isolated event/cursor/ack logic; sandbox spike updates one file + re-asserts fixtures.
- **Order-loss window (ack ordering) — the BLOCKING concern, resolved by ack-on-next-read**: acking a message before its `marketplace.order.sync` job is enqueued would be catastrophic — the inbox is unread-filtered, an acked message never returns from a re-read, so if core's `enqueueBulk` threw after the ack the message would be gone from the unread list, never enqueued, cursor never committed → permanent silent loss. The design therefore acks ONLY messages with id `<= input.fromCursor` (confirmed already enqueued in a prior poll, since core commits the cursor only after a successful enqueue, `order-ingestion.service.ts:130-151`), and NEVER the messages the current `listOrderFeed` call returns. The current wave is acked by the NEXT poll, after core commits its `nextCursor`. **Guarantee: at-least-once.** A crash between enqueue and next-poll ack → harmless re-read + re-enqueue → converges to one order via `syncOrderFromSource`'s externalOrderId-keyed upsert (`:191,206,274`). Never at-most-once.
- **Cursor regression stalling the unread window**: core's `isCursorRegression` (`order-ingestion.service.ts:138-176`) compares numeric-first, else lexicographic, and silently refuses to commit a regressing cursor. If the chosen `nextCursor` representation regresses under that comparison, the cursor stalls, the ack (which keys off `fromCursor`) never advances, and the unread list overflows the 500 cap → silent loss. **Mitigation**: emit `nextCursor` in a provably non-regressing form (consistently numeric-parseable, or zero-padded fixed-width so lexicographic order matches numeric order); fall back to per-message timestamp if ids are unordered. Asserted in §9 (Q-INBOX-2 test point).
- **Cursor advance correctness (no missed/dup orders)**: handled by (a) committing cursor only after successful enqueue in core (`order-ingestion.service.ts:130-151`), (b) `eventKey = inbox message id` → core dedupe key `marketplace:${conn}:order:${eventKey}` (`:126`), (c) per-order dedupe in the adapter, (d) idempotent `syncOrderFromSource` (get-or-create internal id + upsert). A duplicate read is therefore a no-op, and the "unread" filter + ack-on-next-read prevent unbounded re-reads.
- **Lockstep manifest violation** if any of manifest/dispatch/factory is forgotten → `listCapabilityAdapters` fatal error. **Mitigation**: Phase 3 ships all three together; `erli-plugin.spec.ts` asserts dispatch.

### Edge Cases
- Empty inbox → `items: []`, `nextCursor = fromCursor` (no advance, no ack of new wave).
- Inbox full of non-order events → filtered to `[]`, cursor unchanged.
- Both `orderCreated` + `orderStatusChanged` for one order in one page → deduped to one `OrderFeedItem`.
- A previously-returned message (id `<= fromCursor`) still present in the unread list → acked at the start of the current poll (its job was enqueued last poll), then excluded from the new wave.
- Malformed inbox item (missing `id`/`orderId` or unknown `type`) → SKIPPED with `logger.warn` (id only); the rest of the batch is still processed.
- Malformed order in `getOrder` → `ErliApiException` with a field-level reason (no PII body); job retries via classifier.
- `cancelled` order → mapped through faithfully; no stock-restore (deferred, §2).

### Backward Compatibility
- ✅ Additive only. No existing behaviour changes; the new capability/task is gated by a new env var.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
**File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order-source.adapter.spec.ts`, mocking `IErliHttpClient` (`jest.Mocked`), authored #992-provisional fixtures.

`listOrderFeed`:
- maps unread `orderCreated`/`orderStatusChanged` messages (id `> fromCursor`) → correctly-shaped `OrderFeedItem[]` (externalOrderId/eventType/occurredAt/eventKey/eventId).
- **cursor advances** to the newest read (new-wave) message id.
- **no ack before enqueue (the BLOCKING guarantee)**: with `fromCursor = null` (or below all ids), assert NO `markRead`/PATCH is issued for any returned message — the messages this call returns are never acked. (Their ack is the next poll's job.)
- **ack-on-next-read**: given `fromCursor = X` and an unread list containing both messages with id `<= X` and id `> X`, assert `markRead` is called for exactly the `<= X` messages (the prior wave) and for NONE of the `> X` messages; returned items are exactly the `> X` order events.
- a **failing ack** (of a `<= fromCursor` message) is warn-logged (id only) and does not throw or abort the poll.
- **empty inbox** → `items: []`, `nextCursor === input.fromCursor` (never stuck); no new-wave ack.
- **filters** out non-order event types; respects `input.eventTypes`.
- **dedupes** two messages for the same `orderId` to one item (keeps newest).
- **malformed inbox item is skipped, rest processed**: an item missing `id`/`orderId` or with an unknown `type` is dropped (warn, id only) while sibling valid items still map to `OrderFeedItem`s; the batch does not throw.
- **cursor-regression safety (Q-INBOX-2)**: with numeric-but-wide ids (e.g. `"9"`, `"10"`), the emitted `nextCursor` is non-regressing under `isCursorRegression`'s numeric-then-lexicographic comparison (i.e. the cursor for `"10"` does not compare as a regression vs `"9"`) — assert the chosen representation (e.g. zero-padded) sorts correctly.
- **non-array `messages`** → `ErliApiException` with a field-level reason and no PII body.
- honours `limit` ≤ 500 in the GET query params.

`getOrder`:
- fetches `{externalOrderId}` and returns `mapErliOrderToIncomingOrder(order)` (assert key fields: `externalOrderId`, raw `customerExternalId`, item `productRef.externalId`, totals) — proves composition with #994.
- **rejects a malformed wire order** (missing `lineItems` / non-string `id` / bad `status`) with `ErliApiException` before reaching the mapper; the exception message is field-level (e.g. `"lineItems missing"`) and the raw order body is NOT placed in `responseBody` (no PII).

Plugin/factory specs:
- `erli-adapter.factory.spec.ts`: `createAdapters` returns `orderSource`.
- `erli-plugin.spec.ts`: manifest `supportedCapabilities` includes `'OrderSource'`; dispatch resolves it.
- (Optional) a `buildErliSchedulerTasks` assertion that an `erli-orders-poll` task exists with jobType `marketplace.orders.poll` + cursorKey `erli.orders.inboxCursor`.

### Integration Tests
- None new required for #993 (the Erli offers vertical slice landed in #991; order ingestion is unit-tested over fixtures because there is no sandbox — ADR-025 / #992). Convergence with the future webhook path is a core property already exercised by `OrderIngestionService` tests.

### Mocking Strategy
- Mock `IErliHttpClient`; never hit real `fetch`. Mapper used real (it's pure). No DB.

### Acceptance Criteria
- [ ] `ErliOrderSourceAdapter implements OrderSourcePort`; `listOrderFeed` + `getOrder` return contract-correct shapes.
- [ ] All inbox wire assumptions live in `erli-inbox.types.ts` marked `#992-PROVISIONAL`.
- [ ] Cursor = newest read inbox message id; advances correctly; empty inbox keeps cursor; per-order dedupe; idempotent convergence via externalOrderId-keyed upsert.
- [ ] **Ack-on-next-read**: no message is acked before its job is enqueued; the current wave is acked on the subsequent poll (keyed off `fromCursor`); at-least-once guarantee holds.
- [ ] `nextCursor` is non-regressing under core's `isCursorRegression` comparison (numeric or zero-padded/lexicographic).
- [ ] Inbox response is guarded: non-array `messages` rejected; malformed items skipped (warn, id only) without aborting the batch.
- [ ] No inbox/order payload is logged at any level; `assertErliOrder` raises field-level `ErliApiException` with no raw body in `responseBody`.
- [ ] `getOrder` validates the wire order before the (trusting) mapper.
- [ ] Manifest + dispatch table + factory bundle all gain `OrderSource` (lockstep); scheduler `erli-orders-poll` registered (jobType `marketplace.orders.poll`, cursorKey `erli.orders.inboxCursor`, env `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED`).
- [ ] Unit tests pass; `pnpm lint` + `pnpm type-check` clean.

---

## 10. Alignment Checklist
- [x] Follows hexagonal architecture (Integration adapter behind core port)
- [x] Respects CORE vs Integration boundaries (zero CORE edits)
- [x] Uses existing patterns (Allegro/PrestaShop order-source, Erli scheduler, plugin dispatch)
- [x] Idempotency considered (cursor-after-enqueue, ack-on-next-read at-least-once, per-order dedupe, idempotent core upsert keyed on externalOrderId)
- [x] Event-driven patterns used where applicable (poll enqueues existing jobTypes; converges with webhook path in core via externalOrderId-keyed upsert, not event-key dedupe)
- [x] Rate limits & retries addressed (reuses `ErliHttpClient` retry budget + registered classifiers)
- [x] Error handling comprehensive (typed Erli exceptions; field-level wire validation with no PII; inbox-item skip; best-effort prior-wave ack)
- [x] No PII in logs (no payload logging; field-level exception reasons only)
- [x] Testing strategy complete (unit over authored provisional fixtures)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan saved as markdown file

---

## Related Documentation
- [ADR-025: Erli marketplace adapter](../architecture/adrs/025-erli-marketplace-adapter.md) — reconciliation-first; inbox-poll backstop; cursor = newest-read inbox message id; cancel-restore deferral note
- [Architecture Overview](../architecture-overview.md) — OrderSourcePort, capability assignment, #575/#984/#993 manifest notes
- [Engineering Standards](../engineering-standards.md) — adapter/types naming, interface separation
- [Implementation Plan Generator Guide](../implementation-plan-generator-guide.md)
