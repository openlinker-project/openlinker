# Implementation Plan: Erli Orders Vertical-Slice Integration Tests (#998)

**Date**: 2026-06-16
**Status**: Ready for Review
**Estimated Effort**: M (3–7 days)
**Issue**: [#998](https://github.com/openlinker-project/openlinker/issues/998) — the FINAL Erli issue; closes the orders half + the integration overall.
**Branch / worktree**: `998-erli-orders-int-specs` at `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/998-erli-orders-int-specs` (stacked on the full Erli chain #994/#993/#995/#996/#997 — all adapters present).
**Single PR**: plan + implementation on one branch; `Closes #998` in the body.

---

## 1. Task Summary

**Objective**: Add deterministic `*.int-spec.ts` coverage for the Erli **orders** vertical slice, running under `pnpm test:integration`, against a *faked Erli API*. Prove the OL-side wiring composes end-to-end: webhook translate→route→sync proven by **direct invocation of the real Erli translator + routing policy** (the live HTTP front door is #992-gated — see §5/Q1); inbox-poll reconciliation; webhook+poll convergence (one order); COD mapping; and status writeback (with tracking omitted for Erli-managed shipments). A separate, security-positive HTTP test proves the host's fail-closed signature posture for the Erli provider (rejected with 401, no side effects).

**Context**: #994 (order mapper), #993 (`ErliOrderSourceAdapter` + `erli-orders-poll` task + `OrderSource` manifest capability), #995 (buyer-identity normalizer), #996 (`ErliWebhookEventTranslator` + provisioner), and #997 (dispatch writeback Half A on the source adapter + stock-restore Half B on the offer adapter) each ship unit-tested. #998 is the **composition** proof that those pieces wire together through real Postgres + Redis + the production adapter-resolution seam — the orders counterpart to #991's offers vertical slice.

**Classification**: Testing/QA (integration test harness only; **no production code, no migration**). Plus one small **test-harness `setup.ts`** edit (scheduler gate) that is test-infra, not production.

---

## 2. Scope & Non-Goals

### In Scope
- One (or two) new `*.int-spec.ts` under `apps/api/test/integration/erli/` covering:
  1. **Webhook translate→route→sync** proven via **direct invocation of the REAL `ErliWebhookEventTranslator` + the REAL `InboundRoutingPolicy`** — construct an `InboundWebhookEvent{eventType:'orderCreated', externalId, payload}`, translate → assert `CanonicalInboundEvent{domain:'order', eventType:'created'}`, then route → assert `marketplace.order.sync` for an Erli connection with `OrderSource` enabled. The live HTTP webhook front door is **structurally unachievable** today (DTO regex vs translator camelCase vocabulary — see §5/Q1) and is #992-gated.
  2. **Fail-closed HTTP webhook (security-positive)** — POST to `/webhooks/erli/{connectionId}` with an invalid/missing `X-OpenLinker-Signature` → assert `401`, no `webhook_deliveries` row, no `marketplace.order.sync` job. Proves the host's fail-closed posture holds for the Erli provider (independent of the translator-vocab issue).
  3. **Inbox-poll reconciliation** ingests a missed order (drive `OrderIngestionService` directly).
  4. **Webhook + poll converge** — the same `externalOrderId` ingested once (externalOrderId-keyed identifier mapping + `internalOrderId`-keyed `order_records` upsert).
  5. **COD** order maps to `processing` + `paymentStatus:'cod'` (via the #994 mapper through the real `getOrder` path).
  6. **Status writeback** — `notifyDispatched` reflects the dispatch PATCH to the fake Erli; **tracking omitted** for an Erli-managed shipment (absent waybill).
- A new test helper: **`erli-test-order-source.helper.ts`** wiring the REAL `ErliOrderSourceAdapter` to the existing fake `IErliHttpClient` through the production registry seam.
- **`setup.ts` edit**: disable the `erli-orders-poll` scheduler (`OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED: 'false'`) — see §5/R1, this is REQUIRED for determinism.
- **Routing-int-spec ripple check + remediation** for the #993 manifest change (adding `OrderSource` to Erli's `supportedCapabilities`).

### Out of Scope
- Per-branch unit coverage already owned by #993–#997 (inbox dedupe, cursor regression, ack-on-next-read, mapper field-by-field, frozen-stock suppression). The int-spec asserts *composition*, not re-litigated unit branches (mirrors #991 plan §2).
- The live **HTTP webhook → translate → route → sync** path end-to-end — **structurally unachievable** today and **#992-blocked**. The `WebhookRequestDto` forces `eventType` to match `/^[a-z]+\.[a-z_]+$/` (lowercase-dotted), but `ErliWebhookEventTranslator.resolveEventType` switches ONLY on camelCase `'orderCreated'`/`'orderStatusChanged'`; no DTO-valid `eventType` both validates AND resolves over the host default-decoder path (the bridge is the #992 native decoder, which doesn't exist). #998 instead proves translate→route→sync by **direct invocation of the real translator + routing policy** (see §5/Q1 — the crux), and separately proves the fail-closed HTTP signature rejection (security-positive). It does not prove Erli's real HMAC or the live HTTP success path — both are #992.
- End-to-end *live trigger* of dispatch writeback (`ShipmentDispatchNotificationService` is awaiting a call-site under #837/#769) and stock-restore on cancel (no core order-cancel observe hook yet, Q-T2). The int-spec drives these by **direct service/adapter invocation** (see §6 Phase 5).
- Any change to `erli-order.types.ts` / `erli-inbox.types.ts` / `erli-order.mapper.ts` — assertions use the #992-provisional documented wire shapes verbatim.

### Constraints
- Deterministic, no real timers (use the fake client's scripted GET queue / sticky responses; never `setTimeout`-then-assert against a cron).
- Full `pnpm test:integration` (including `routing-rules`, `fulfillment-routing`, `app-boot`, `connection-capabilities`) must stay green — the #993 manifest capability change is the ripple surface (AC, §8).
- No new ESLint/type errors; file header per engineering standards; `import` ordering (external → `@openlinker/*` barrels → relative).

---

## 3. Architecture Mapping

**Target Layer**: App integration tests (`apps/api/test/integration/`) + a test helper. Exercises Integration adapters (`libs/integrations/erli`) and CORE orchestration (`libs/core/src/orders`, `libs/core/src/sync`) through the production wiring.

**Capabilities involved**: `OrderSource` (`listOrderFeed` / `getOrder`), `OrderDispatchNotifier` sub-capability (`notifyDispatched`), and `OfferStockRestorer`-style `restoreStockOnCancellation` (on the offer adapter, #997 Half B). No new ports.

**Existing services reused** (all confirmed present in the worktree):
- `OrderIngestionService` — `ingestOrders(connectionId, { cursorKey, limit, eventTypes })` (poll) and `syncOrderFromSource(connectionId, externalOrderId, sourceEventId?)` (hydrate + upsert). `libs/core/src/orders/application/services/order-ingestion.service.ts:82` (poll) and `:178` (sync). Token `ORDER_INGESTION_SERVICE_TOKEN` (`libs/core/src/orders/orders.tokens.ts`).
- `IntegrationsService.getCapabilityAdapter` — gates on BOTH `metadata.supportedCapabilities.includes(cap)` and `connection.enabledCapabilities.includes(cap)` (`libs/core/src/integrations/application/services/integrations.service.ts:94`).
- `AdapterRegistryService` + `AdapterFactoryResolverService` seam (`ADAPTER_REGISTRY_TOKEN` / `ADAPTER_FACTORY_RESOLVER_TOKEN`) — register a test adapterKey + factory (the #991 + echo-guard precedent).
- `ErliWebhookEventTranslator` (REAL, `libs/integrations/erli/.../erli-webhook-event-translator.adapter.ts`) — `translate(InboundWebhookEvent) → CanonicalInboundEvent` (invoked directly, NOT via a fake/test translator) — and `InboundRoutingPolicy` (order domain → `marketplace.order.sync`, requiredCapability `OrderSource`) — `libs/core/src/sync/application/services/inbound-routing-policy.service.ts:113`. The webhook scenario invokes both directly (the live HTTP front door is #992-gated, §5/Q1). `WebhookController` is still exercised by the fail-closed 401 security test.
- `OrderRecordOrmEntity` direct read for assertions (`@openlinker/core/orders/orm-entities`); echo-guard precedent at `apps/api/test/integration/orders/order-reingestion-echo-guard.int-spec.ts:191`.
- `IIdentifierMappingService` (`IDENTIFIER_MAPPING_SERVICE_TOKEN`) — seed `Order` and item `productRef` mappings.
- Integration harness: `getTestHarness` / `resetTestHarness` / `teardownTestHarness` (`apps/api/test/integration/setup.ts`); `createTestConnection` helper; `createTestOrderRecord` fixture (`apps/api/test/integration/fixtures/order.fixtures.ts`).
- The existing fake `ErliFakeHttpClient` (`apps/api/test/integration/helpers/erli-fake-http-client.ts`) — already implements `IErliHttpClient` (`get`/`post`/`patch`, `setProduct`/`enqueueGet`/`rejectNext`/`callsOf`/`reset`). **Reused as-is** for the OrderSource paths.

**New components required**:
- `apps/api/test/integration/helpers/erli-test-order-source.helper.ts` — register a test adapterKey resolving the REAL `ErliOrderSourceAdapter` (ctor `(connectionId, httpClient)`) wired to a (fresh) `ErliFakeHttpClient`.
- The int-spec file(s) under `apps/api/test/integration/erli/`.
- For the **fail-closed 401** test only, a tiny inline helper to build a webhook request with a bad/missing signature (mirror `webhook-ingestion.int-spec.ts:98-118` — no helper exists today). The translate→route→sync scenario needs no HTTP request at all (direct invocation).

**Core vs Integration justification**: Pure test addition. No CORE or integration runtime change. The Erli adapters, the order mapper, and the routing policy are all consumed unchanged through the production seam.

---

## 4. External / Domain Research

### Internal patterns found (file:line)
- **Webhook int-spec drive pattern** (`apps/api/test/integration/webhook-ingestion.int-spec.ts:33`): POST `/webhooks/:provider/:connectionId` with an OL-HMAC signature. The signing is `sha256=hex(HMAC-SHA256(secret, timestamp + '.' + rawBody))` (lines 56–61). Secret resolved from env `OPENLINKER_WEBHOOK_SECRET__{PROVIDER}` (lines 17–21). The harness captures `rawBody` via the express `verify` hook in `setup.ts:23-35`.
- **Default decoder** (`apps/api/src/webhooks/application/decoders/default-webhook-decoder.ts:34` verify, `:72` extractEnvelope): produces an `InboundWebhookEvent` with `eventId/eventType/occurredAt/objectType/externalId/payload` from a `WebhookRequestDto` (`{ schemaVersion, eventId, eventType (matches /^[a-z]+\.[a-z_]+$/), occurredAt (ISO8601), object: { type, externalId }, payload? }`).
- **Handler → routing** (`apps/api/src/webhooks/application/handlers/webhook-to-job.handler.ts`): background Redis consumer (consumer group `webhook-handler`) resolves connection → adapter metadata, looks up the per-adapterKey `WebhookEventTranslatorPort`, translates to `CanonicalInboundEvent`, then `InboundRoutingPolicy.route(...)` enqueues `marketplace.order.sync`. **For Erli the live HTTP path through this handler is structurally unachievable** (DTO `eventType` regex vs translator camelCase vocabulary — see §5/Q1/R2): any DTO-valid `eventType` makes `ErliWebhookEventTranslator.resolveEventType` return `null`, so the handler dead-letters and routing never fires. #998 therefore proves the same two real components — translator + routing policy — by **direct invocation**, not through the handler's HTTP front door. (Contrast PrestaShop's `webhook-ingestion.int-spec.ts`, which CAN drive the HTTP path because PrestaShop emits DTO-valid dotted event types its routing accepts; Erli's camelCase vocabulary is structurally incompatible — this is NOT a like-for-like precedent.)
- **Convergence/dedup** (`order-ingestion.service.ts:178`): `getOrCreateInternalId(Order, externalOrderId, connectionId)` returns the existing internal id for a repeat; `order_records` is keyed by `internalOrderId` (PK) and upserted (`order-record.repository.ts` `upsert` → TypeORM `save`). Both webhook-routed and poll-routed `marketplace.order.sync` jobs converge on the same row. Webhook-layer dedup also blocks a same `eventId` replay via `webhook_deliveries` unique `(provider, connectionId, eventId)`.
- **Item resolution gate** (`order-ingestion.service.ts` ~`:234`): each line item is resolved via `orderItemRefResolver.tryResolve(connectionId, item.productRef)`; a fully-`ready` order requires every item's `productRef.externalId` to have an identifier mapping — otherwise the service persists an `awaiting_mapping` snapshot and throws `MissingOrderItemMappingError`. **The COD / created scenarios must seed item mappings** (or assert the `awaiting_mapping` snapshot — see §5/A3).
- **Direct-ingestion precedent** (`apps/api/test/integration/orders/order-reingestion-echo-guard.int-spec.ts`): the canonical shape for #998's poll/COD scenarios — get `ORDER_INGESTION_SERVICE_TOKEN`, register a stub/real `OrderSource` via the registry seam, call `syncOrderFromSource` directly, read `OrderRecordOrmEntity` for assertions. Schedulers stay disabled.
- **#991 offers harness** (`apps/api/test/integration/helpers/erli-test-offer-manager.helper.ts`): the exact pattern to mirror for the OrderSource helper — `adapterRegistry.register({...})` + `factoryResolver.registerFactory(key, { createCapabilityAdapter })` returning a real adapter wired to the fake client.
- **Dispatch-notify stub precedent** (`apps/api/test/integration/helpers/dispatch-notify-test-stubs.helper.ts`): shows the `OrderDispatchNotifier` shape and how a source adapter's `notifyDispatched` is invoked — for #998 we invoke the REAL `ErliOrderSourceAdapter.notifyDispatched` directly against the fake client.

### #992-provisional caveat
All wire shapes (`ErliOrder`, `ErliInboxMessage`, fulfillment paths) are #992-provisional (single reconciliation points: `erli-order.types.ts`, `erli-inbox.types.ts`, `erli-fulfillment.types.ts`). The int-spec asserts OL-side behavior against **authored fixtures matching those documented shapes** — not real Erli shapes. Add the same banner #991 used (header comment + per-fixture note) so a #992 spike revision is a one-place fixture update. **All authored buyer fixtures use synthetic PII only** — reserved test domain `@example.test` and synthetic names (e.g. "Jan Testowy"); no real or guessed PII (A6).

---

## 5. Questions & Assumptions

### Resolved key questions (the crux items)

**Q1 — Is webhook→sync int-testable without a native Erli decoder? Crux: the live HTTP path is structurally unachievable; prove the real components by direct invocation instead.**

The live HTTP webhook path for Erli **cannot be driven end-to-end** today, and not merely because of the signature. Two facts collide:

1. The host `WebhookRequestDto` forces `eventType` to match `/^[a-z]+\.[a-z_]+$/` (lowercase-dotted, e.g. `'order.created'`) — any other value is **rejected at the DTO** before reaching the translator.
2. The real `ErliWebhookEventTranslator.resolveEventType` switches **only** on the camelCase literals `'orderCreated'` / `'orderStatusChanged'` (`erli-webhook-event-translator.adapter.ts:63`). Any DTO-valid `eventType` (e.g. `'order.created'`) therefore returns `null` → `WebhookToJobHandler` dead-letters → routing never fires.

So **no DTO-valid `eventType` both validates at the DTO AND resolves in the translator** over the host default-decoder HTTP path. The bridge that would reconcile the two vocabularies is the **#992 native `InboundWebhookDecoderPort`**, which does not exist. (The earlier "generic-envelope fallback" idea is also unworkable: routing is gated on the translator returning a non-null `CanonicalInboundEvent`, so a generic order envelope that the translator can't resolve routes nowhere.)

**Resolution — prove translate→route→sync by DIRECT invocation of the REAL components** (no HTTP, no DTO, no fake translator):

- Construct an `InboundWebhookEvent` with `eventType:'orderCreated'` (+ `externalId`, `payload`) — the shape the translator actually reads.
- Call the **REAL** `ErliWebhookEventTranslator.translate(...)` → assert it returns `CanonicalInboundEvent{ domain:'order', eventType:'created', externalId }`.
- Call the **REAL** `InboundRoutingPolicy.route(...)` (the handler's routing step) for an Erli connection with `OrderSource` enabled → assert it yields `marketplace.order.sync`.

This proves the two real, load-bearing OL components (translator + routing policy) end-to-end at the contract level, bypassing the DTO front door that structurally blocks Erli's vocabulary. It does NOT and cannot prove Erli's real signature or the live HTTP success path — both are **#992** (needs the native decoder). Document WHY in the spec header (the DTO regex vs the translator's camelCase vocabulary; the HTTP+DTO path needs the #992 native decoder) and keep the #992-provisional fixture banner (mirror #991). **Use the REAL `ErliWebhookEventTranslator` — do NOT register a fake/test translator.**

**Q2 — Faking the Erli API for `getOrder`/order-source.** Reuse `ErliFakeHttpClient` wired to a REAL `ErliOrderSourceAdapter` via the registry seam. `ErliOrderSourceAdapter`'s ctor is `(connectionId, httpClient)` (`erli-order-source.adapter.ts:124`) — no `IdentifierMappingPort`, no cache. The new helper registers a test adapterKey (e.g. `erli.ordersource.test.v1`) with `supportedCapabilities: ['OrderSource']` and a factory returning `new ErliOrderSourceAdapter(connection.id, fake)`. The connection's `enabledCapabilities` **must include `'OrderSource'`** or `getCapabilityAdapter`/routing throws `CapabilityNotEnabledException` (`integrations.service.ts:108`). The fake's GET paths the adapter hits: `/inbox?limit=` (inbox list), `/orders/{id}` (getOrder), `PATCH /inbox/{id}` (ack), and the fulfillment paths for writeback. The fake keys sticky/queued GETs by full path — script `setProduct`/`enqueueGet` against the literal paths the adapter requests (note: the fake's `pathFor` uses `products/{id}` — the offer convention; for OrderSource paths the spec must script using the **inbox/order paths** the adapter actually calls, so add small fake-scripting that targets `'/inbox'` and `erliOrderPath(id)` literally — see A2).

**Q3 — Poll convergence.** Drive the same `externalOrderId` through both code paths that land a `marketplace.order.sync` and assert ONE `order_records` row. The webhook path's routing is proven separately by direct invocation (Q1) — it cannot land an order over HTTP for Erli. So the convergence assertion models "poll then the webhook-routed sync land the same order" deterministically via **two direct `syncOrderFromSource(connectionId, externalOrderId)` calls** (the second standing in for the webhook-routed job, since both webhook and poll funnel into the identical `syncOrderFromSource` core path). Both converge on `getOrCreateInternalId(Order, externalOrderId, connectionId)` → same `internalOrderId` → single upserted row. Optionally also drive once via `ingestion.ingestOrders(connectionId, { cursorKey:'erli.orders.inboxCursor', limit })` (poll → `listOrderFeed` over the fake inbox). Assert `recordRepo.count() === 1` and the `Order` mapping resolves to one internal id (echo-guard precedent). No Redis-job race — pure direct invocation.

**Q4 — COD.** Fake an `ErliOrder` with `status:'purchased'`, `paymentMethod:'cod'`, one line item; seed the line-item `productRef` mapping; call `syncOrderFromSource`; assert the persisted `order_records` snapshot carries the neutral order status `processing` and `paymentStatus:'cod'` (the #994 mapper's encoding, `erli-order.mapper.ts:116`). Assert via the persisted `orderSnapshot` (the `IncomingOrder`/`Order` is stored on the record).

**Q5 — Writeback (direct invocation, NOT end-to-end trigger).** `notifyDispatched`'s live trigger (`ShipmentDispatchNotificationService`) and the stock-restore's order-cancel hook are not wired (#837/#769, Q-T2). So the int-spec resolves the REAL `ErliOrderSourceAdapter` from the registry seam and calls `notifyDispatched({ externalOrderId, trackingNumber?, carrier? })` directly, asserting against the fake client's recorded calls: (a) a `PATCH` to `erliFulfillmentPath(id)` with `{ status: <dispatched> }`; (b) **with** a `trackingNumber` → an additional waybill `POST` to `erliFulfillmentShipmentsPath(id)`; (c) **without** a `trackingNumber` (Erli-managed shipment) → NO waybill POST (tracking omitted). Be explicit in the spec header that this is direct-invocation. Optionally also cover `restoreStockOnCancellation` via the offer adapter + a stubbed `IInventoryQueryService` (resolve `INVENTORY_QUERY_SERVICE_TOKEN` or pass a fake) — secondary, can defer to keep scope tight.

**Q6 — Routing-int-spec ripple.** Audited (see §8). The only test that directly asserts Erli's capability set is `libs/integrations/erli/src/__tests__/erli-plugin.spec.ts:99`, which **already** expects `['OfferManager','OrderSource']` (written in lockstep with #993). `app-boot.int-spec.ts` uses `arrayContaining` (won't break). `routing-rules`/`fulfillment-routing`/`connection-capabilities` assert PrestaShop/Allegro/InPost capabilities only, not Erli. **No existing assertion breaks from the manifest change.** The plan still mandates running the full suite as the AC.

### Assumptions
- **A1 (translator vocabulary — RESOLVED, drives the direct-invocation decision)**: `ErliWebhookEventTranslator.resolveEventType` switches on `'orderCreated'`/`'orderStatusChanged'` (`erli-webhook-event-translator.adapter.ts:63`), and `resolveExternalId` prefers `event.externalId`. The webhook DTO requires `eventType` to match `/^[a-z]+\.[a-z_]+$/` (`webhook-request.dto.ts`), which `'orderCreated'` does NOT match — and the translator does NOT accept any dotted form. The two vocabularies are **structurally incompatible** over the HTTP path (§5/Q1). There is no DTO-valid envelope that carries Erli's camelCase literal to the translator; the generic-envelope fallback is unworkable (routing requires a non-null translator result). **Therefore the webhook scenario builds the `InboundWebhookEvent{eventType:'orderCreated', externalId, payload}` directly and calls the REAL translator + REAL routing policy**, asserting `CanonicalInboundEvent{domain:'order', eventType:'created', externalId}` then `marketplace.order.sync`. No DTO, no HTTP, no fake translator. The live HTTP path is #992-gated.
- **A2 (fake scripting for OrderSource paths — BLOCKING PREREQUISITE, not minimal)**: The existing `ErliFakeHttpClient` currently scripts **only** `products/{id}` GETs — its `setProduct`/`enqueueGet` go through the private `pathFor` helper that computes the offer convention `products/{id}`. The OrderSource adapter hits `'/inbox'` (inbox list) and `/orders/{id}` (getOrder), which the current fake **cannot script at all**. New raw-path scripting — `setRawGet(path, body)` + `enqueueRawGet(path, responses[])` keyed by the literal request path — **MUST land before any OrderSource scenario can run.** This is a hard prerequisite (Phase 1, step 2), not an optional enhancement. The existing offer methods (`setProduct`/`enqueueGet`) stay untouched so #991 remains green.
- **A3 (item mappings — a `ready` order needs the ProductVariant to EXIST, not just a mapping)**: The item-ref resolver (`order-item-ref-resolver.service.ts:90-100`) first looks up an identifier mapping with entityType `ProductVariant`, **then fetches the variant via `productsService.getVariant`**. A mapping alone is insufficient — if the variant row is absent the fetch fails and the item is unresolved. So a `ready` scenario must seed BOTH the `ProductVariant` identifier mapping AND the `ProductVariant` row. **Decision per scenario**:
  - **COD scenario (step 6)**: seeds the `ProductVariant` mapping AND the variant row → asserts `recordStatus:'ready'` + `processing`/`paymentStatus:'cod'` (the AC says "order created in OL").
  - **Convergence scenario (step 7)**: same — seed mapping + variant row → `ready`; the convergence assertion is about the single upserted row, so a `ready` order keeps the dedup proof clean.
  - **(Negative variant, optional)**: a scenario that seeds neither asserts `recordStatus:'awaiting_mapping'` and expects `MissingOrderItemMappingError` — proves the gate, but is not the primary "created" AC.
  Single pre-mapped line item per fixture. Resolver entity type confirmed as `ProductVariant` (see OQ2).
- **A4 (determinism)**: the webhook translate→route→sync scenario is pure direct invocation — no timers, no Redis race. The convergence count assertion uses direct `syncOrderFromSource` calls (no Redis-job race). For the fail-closed HTTP test, assert the synchronous 401 response, then assert the *absence* of a `webhook_deliveries` row / job; a small bounded poll-until (rather than a fixed `setTimeout`) guards against asserting too early. NOTE: the cited PrestaShop precedent uses fixed `setTimeout` waits — poll-until is an **improvement over** the precedent, not its behavior.
- **A5 (`setup.ts` scheduler gate)**: `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED` is **not** currently set in `setup.ts` (only `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED:'false'`). The gate defaults to enabled (`scheduler.service.ts:97-98`: `get(envVar,'true') !== 'false'`), and the API app boots the real Erli plugin (`apps/api/src/plugins.ts:45`), which registers `erli-orders-poll`. So the cron WOULD fire in the suite (event-loop-alive hang + nondeterminism). **#998 must add `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED: 'false'` to `setup.ts`.** (Required, not optional.)
- **A6 (fake-PII fixture convention)**: all authored buyer fixtures use the reserved test domain `@example.test` for emails (e.g. `jan.testowy@example.test`) and synthetic names (e.g. "Jan Testowy") — **no real or guessed PII**. The webhook secret is a local test constant `OPENLINKER_WEBHOOK_SECRET__ERLI` set to an obviously-fake value within the fail-closed test scope. This convention is mandated in the spec header alongside the #992-provisional banner.

### Open questions (flagged, non-blocking)
- **OQ1 — RESOLVED**: there is no DTO-valid decoder→translator path that carries Erli's camelCase discriminator (the DTO regex and the translator vocabulary are structurally incompatible). The webhook scenario invokes the real translator + routing directly instead (§5/Q1, A1). No implementation-time field-hunt remains.
- **OQ2 — RESOLVED**: the item-ref resolver looks up entityType `ProductVariant` then fetches via `productsService.getVariant` (`order-item-ref-resolver.service.ts:90-100`). A `ready` order needs both the mapping and the variant row seeded (A3).

### Documentation gaps
- None blocking. The #992-provisional banner already documents the wire-shape caveat across the Erli types files.

---

## 6. Proposed Implementation Plan

### Phase 0: Harness determinism (prerequisite)
**Goal**: the suite cannot hang or drift on the Erli orders-poll cron.

1. **Disable the Erli orders-poll scheduler in tests**
   - **File**: `apps/api/test/integration/setup.ts` (env block, ~line 115 next to `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED`).
   - **Action**: add `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED: 'false'` with a one-line comment (matches the "disable all background schedulers" intent; #998 drives the poll directly).
   - **Acceptance**: `pnpm test:integration` no longer leaves the event loop alive via an Erli cron; existing suites unaffected.

### Phase 1: OrderSource test helper
**Goal**: resolve the REAL `ErliOrderSourceAdapter` over the fake HTTP client through the production seam.

2. **Extend the fake client with raw-path GET scripting (BLOCKING PREREQUISITE)**
   - **File**: `apps/api/test/integration/helpers/erli-fake-http-client.ts`.
   - **Why blocking**: the fake today scripts **only** `products/{id}` GETs (via the private `pathFor` offer convention) — it **cannot** script the OrderSource paths `'/inbox'` and `/orders/{id}` at all. No OrderSource scenario (poll, COD, convergence, the negative 404) can run until this lands.
   - **Action**: add `setRawGet(path, body)` and `enqueueRawGet(path, responses[])` that key by the literal request path (so `/inbox` and `/orders/{id}` can be scripted). Leave the existing `setProduct`/`enqueueGet` (offer paths) untouched so #991 stays green.
   - **Acceptance**: `fake.callsOf('GET')` records `/inbox` and `/orders/{id}`; scripted bodies return for those paths; existing offer-path scripting unchanged; offers int-spec still passes.

3. **Create `erli-test-order-source.helper.ts`**
   - **File**: `apps/api/test/integration/helpers/erli-test-order-source.helper.ts`.
   - **Action**: mirror `erli-test-offer-manager.helper.ts`. Register `adapterKey='erli.ordersource.test.v1'`, `platformType='erli'`, `supportedCapabilities:['OrderSource']`, `isDefault:false`; register a factory `createCapabilityAdapter: (connection) => new ErliOrderSourceAdapter(connection.id, fake)`. Return `{ fake, adapterKey, platformType }`. Import `ErliOrderSourceAdapter` from `@openlinker/integrations-erli/infrastructure/adapters/erli-order-source.adapter` (deep import path is the same convention #991's helper uses for the offer adapter).
   - **Acceptance**: `getCapabilityAdapter<OrderSourcePort>(connId,'OrderSource')` returns the real adapter; calls hit the fake.
   - **Dependencies**: step 2.

4. **Seed helper for an Erli OrderSource connection**
   - **File**: in the int-spec (or extend an existing helper).
   - **Action**: seed a `ConnectionOrmEntity` `platformType:'erli'`, `status:'active'`, `adapterKey:'erli.ordersource.test.v1'`, `enabledCapabilities:['OrderSource']` (+ obviously-fake credential row, mirroring #991's `seedErliConnection`).
   - **Acceptance**: routing resolves `OrderSource` for the connection (no `CapabilityNotEnabledException`).

### Phase 2: Poll + COD + convergence scenarios (direct ingestion)
**Goal**: prove `listOrderFeed`/`getOrder` → mapper → core persistence end-to-end, deterministically.

5. **Poll-reconciliation scenario**
   - **Action**: script the fake `/inbox` to return one `orderCreated` message for `externalOrderId=E1`; script `/orders/E1` with a valid `ErliOrder` fixture (synthetic PII, A6); seed BOTH the line-item `ProductVariant` mapping AND the `ProductVariant` row (A3); call `ingestion.ingestOrders(connId,{ cursorKey:'erli.orders.inboxCursor', limit:200 })`; then process the enqueued `marketplace.order.sync` (drive `syncOrderFromSource` directly, or assert the job enqueued + cursor committed). Assert one `order_records` row for `E1` with `recordStatus:'ready'`.
   - **Acceptance**: order persisted (`ready`); cursor advanced; inbox GET recorded.
   - **Dependencies**: step 2 (raw-path scripting).

6. **COD scenario**
   - **Action**: script `/orders/E2` with `status:'purchased'`, `paymentMethod:'cod'`, one line item (synthetic PII, A6); seed BOTH the `ProductVariant` mapping AND the variant row so the order reaches `ready` (A3); call `syncOrderFromSource(connId,'E2')`; assert persisted snapshot status `processing` + `paymentStatus:'cod'`.
   - **Acceptance**: `recordStatus:'ready'`; COD encoding (`processing` / `paymentStatus:'cod'`) present on the persisted record.
   - **Dependencies**: step 2 (raw-path scripting).

7. **Convergence scenario**
   - **Action**: for `externalOrderId=E3`, seed BOTH the `ProductVariant` mapping AND the variant row (A3, so the order is `ready` and the dedup proof is clean); invoke `syncOrderFromSource(connId,'E3')` twice — the second call stands in for the webhook-routed `marketplace.order.sync` (webhook and poll both funnel into the identical `syncOrderFromSource` core path; the Erli webhook cannot land an order over HTTP, Q1/Q3). Optionally also drive once via `ingestOrders`. Assert `recordRepo.count()` for `E3` is 1 and the `Order` identifier mapping resolves to a single `internalOrderId`.
   - **Acceptance**: ingested once; no duplicate row.
   - **Dependencies**: step 2 (raw-path scripting).

### Phase 3: Webhook translate→route→sync (direct invocation) + fail-closed HTTP (security-positive)
**Goal**: prove the REAL Erli translator + REAL routing policy compose to `marketplace.order.sync` (Q1 crux), and that the host's fail-closed signature posture holds for the Erli provider.

8. **Webhook translate→route→sync scenario (DIRECT invocation of the real components)**
   - **Action**: do NOT POST over HTTP and do NOT build a `WebhookRequestDto` (the DTO `eventType` regex structurally rejects Erli's camelCase vocabulary — §5/Q1). Instead:
     1. Construct an `InboundWebhookEvent` with `eventType:'orderCreated'`, `externalId:'E4'`, and a `payload` matching the #992-provisional Erli order-webhook shape.
     2. Call the **REAL** `ErliWebhookEventTranslator.translate(event)` → assert it returns `CanonicalInboundEvent{ domain:'order', eventType:'created', externalId:'E4' }`.
     3. Seed an Erli connection (`adapterKey:'erli.ordersource.test.v1'`, `enabledCapabilities:['OrderSource']`) and call the **REAL** `InboundRoutingPolicy.route(canonical, connection)` (the handler's routing step) → assert it yields `jobType:'marketplace.order.sync'` (requiredCapability `OrderSource`).
   - **Why direct**: the live HTTP front door needs the #992 native decoder; no DTO-valid `eventType` both validates AND resolves in the translator (§5/Q1/R2). Direct invocation proves the same two real, load-bearing components at the contract level. **Use the real `ErliWebhookEventTranslator` — never a fake/test translator.**
   - **Acceptance**: real translator yields the canonical order event; real routing policy yields `marketplace.order.sync`. Deterministic (no Redis/HTTP timing).
   - **Document**: spec header records WHY the HTTP path is bypassed (DTO regex vs translator camelCase vocabulary; the HTTP+DTO path needs the #992 native decoder).

9. **Fail-closed HTTP webhook scenario (security-positive)**
   - **Action**: POST to `/webhooks/erli/{connectionId}` with an invalid (or missing) `X-OpenLinker-Signature` header (mirror `webhook-ingestion.int-spec.ts:98-118`). Assert `401`, NO `webhook_deliveries` row inserted, and NO `marketplace.order.sync` job enqueued.
   - **Why**: proves the host's fail-closed posture holds for the Erli provider — a forged/unsigned webhook is rejected before any side effect. Independent of the translator-vocab issue (this exercises the signature gate, which fires before the DTO/translator).
   - **Acceptance**: 401; no delivery row; no job.

### Phase 4: Status writeback (direct invocation)
**Goal**: prove `notifyDispatched` reflects to Erli; tracking omitted for Erli-managed shipments.

10. **Writeback scenarios**
   - **Action**: resolve the real `ErliOrderSourceAdapter` from the seam (it implements `OrderDispatchNotifier`). Call `notifyDispatched({ externalOrderId:E5 })` (no waybill) → assert exactly one `PATCH erliFulfillmentPath(E5)` with `{status:<dispatched>}` and **no** waybill POST. Call `notifyDispatched({ externalOrderId:E6, trackingNumber:'WB1', carrier:{platformType:'inpost'} })` → assert the status PATCH **plus** a `POST erliFulfillmentShipmentsPath(E6)` carrying `WB1`. Optionally arm `fake.rejectNext(409)` to assert the already-dispatched/stale → success branch.
   - **Acceptance**: dispatch PATCH recorded; tracking attached iff present; header documents direct-invocation (live trigger is #837/#769).

### Phase 5: Routing ripple verification
11. **Run the full integration suite**
    - **Action**: `pnpm test:integration` end-to-end; confirm `routing-rules`, `fulfillment-routing`, `app-boot`, `connection-capabilities`, `erli-offers-vertical-slice`, and the new orders spec all pass.
    - **Acceptance**: green suite (the AC). No remediation expected per §8; if any Erli-capability assertion surfaces, update it to include `OrderSource`.

### Implementation Details
- **New components**: `erli-test-order-source.helper.ts`; `apps/api/test/integration/erli/erli-orders-vertical-slice.int-spec.ts` (single file preferred; split into two only if length warrants). Fake-client raw-path scripting methods.
- **Config changes (test env only)**: `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED:'false'` in `setup.ts`; `OPENLINKER_WEBHOOK_SECRET__ERLI` (an obviously-fake local test constant) set within the fail-closed HTTP scenario only — the translate→route→sync scenario needs no secret (direct invocation, no HTTP).
- **Migrations**: none.
- **Events**: consumes the inbound-webhook → `marketplace.order.sync` path; no new events.
- **Error handling**: assert the typed `ErliApiException` 404 surfaces from `getOrder` of an unscripted order (optional negative case), reusing the fake's default 404.

---

## 7. Alternatives Considered

### Alternative 1: Drive the webhook path end-to-end over HTTP (OL-signed envelope or real Erli signature)
- **Description**: POST a signed body to `/webhooks/erli/{connectionId}` and let `WebhookToJobHandler` translate + route, the way PrestaShop's `webhook-ingestion.int-spec.ts` does.
- **Why rejected**: **structurally unachievable** for Erli, not merely #992-signature-blocked. The DTO forces `eventType` to lowercase-dotted (`/^[a-z]+\.[a-z_]+$/`) while `ErliWebhookEventTranslator` resolves only the camelCase literals `orderCreated`/`orderStatusChanged`; no DTO-valid value both validates and resolves (the translator returns `null` → handler dead-letters → routing never fires). PrestaShop is NOT a like-for-like precedent — it emits DTO-valid dotted event types its routing accepts; Erli's camelCase vocabulary is incompatible. The bridge is the #992 native `InboundWebhookDecoderPort`, which doesn't exist.
- **Trade-off**: #998 instead proves the real translator + routing by direct invocation (the load-bearing OL wiring), and proves the HTTP signature gate via a fail-closed 401 test. The live HTTP success path and Erli's real HMAC are out of scope until #992; documented in the spec header.

### Alternative 2: Stub `OrderSource` (return canned `IncomingOrder`) instead of the real adapter + fake HTTP
- **Description**: register a hand-written `OrderSourcePort` stub (echo-guard style) rather than the real `ErliOrderSourceAdapter`.
- **Why rejected**: it would bypass the Erli inbox parsing, cursor logic, `getOrder` validation, and the #994 mapper — exactly the composition #998 must prove. Faking at the HTTP seam (the #991 decision) keeps the real adapter under test.
- **Trade-off**: the convergence/echo assertions can still use the simpler stub where adapter internals are not the subject (the convergence count is about core upsert, not Erli parsing) — use the real adapter for poll/COD/getOrder, a lighter path where only core dedup matters.

### Alternative 3: Drive every scenario through the worker job runner (full Redis job loop)
- **Description**: enqueue real jobs and let the worker handlers run.
- **Why rejected**: non-deterministic timing in a single-process int-spec; the established precedent (echo-guard, WooCommerce ingest) calls `OrderIngestionService` methods directly. Keeps the suite fast and deterministic.

---

## 8. Validation & Risks

### Routing-int-spec ripple audit (the #993 manifest change)
The #993 change (`erli-plugin.ts:55` now `['OfferManager','OrderSource']`) was audited across `libs/integrations/erli`, `apps/api`, `apps/worker`, `libs/core`:

| Test | Assertion | Breaks? |
|---|---|---|
| `libs/integrations/erli/src/__tests__/erli-plugin.spec.ts:99` | `expect(erliAdapterManifest.supportedCapabilities).toEqual(['OfferManager','OrderSource'])` | **No** — already updated in lockstep with #993. |
| `apps/api/test/integration/app-boot.int-spec.ts:62` | `adapterKeys` via `expect.arrayContaining([...])` | No — `arrayContaining` tolerates Erli. |
| `apps/api/test/integration/connection-capabilities.int-spec.ts:57` | PrestaShop's capability set only | No — not Erli. |
| `fulfillment-routing.int-spec.ts`, `routing-rules.int-spec.ts` | Allegro/PrestaShop/InPost capabilities | No — not Erli. |
| `erli-adapter.factory.spec.ts` | function existence (`isOfferCreator`, `orderSource`) | No — no full-set assertion. |
| `erli-test-offer-manager.helper.ts:63` | test-only adapterKey `['OfferManager']` | No — isolated test fixture (different key). |

**Conclusion**: zero existing assertions break. The plan still **mandates** running the full `pnpm test:integration` (Phase 5) as the binding AC.

### Architecture Compliance
- ✅ Test-only; CORE ↔ Integration boundary untouched. Real adapters consumed through the production registry + `IntegrationsService` seam.
- ✅ Faking at the HTTP-transport seam keeps the real adapter logic + #994 mapper under test (the #991 decision, applied to orders).

### Naming Conventions
- ✅ `*.int-spec.ts`; helper `erli-test-order-source.helper.ts` (mirrors `erli-test-offer-manager.helper.ts`); file header per engineering standards.

### Risks
- **R1 (cron hang / nondeterminism)** — the real Erli plugin registers `erli-orders-poll` and the gate defaults to enabled; without the `setup.ts` env gate the cron fires in-suite. **Mitigation**: Phase 0, step 1 (required `setup.ts` edit). This is the single highest-value finding.
- **R2 (webhook HTTP path structurally unachievable, A1/Q1)** — `eventType` must match `/^[a-z]+\.[a-z_]+$/`, which `orderCreated` fails, while the translator switches only on the camelCase literals. No DTO-valid `eventType` both validates and resolves; the generic-envelope fallback is unworkable (routing needs a non-null translator result). The bridge is the #992 native decoder, which doesn't exist. **Mitigation (not a fallback — the decision)**: prove translate→route→sync by **direct invocation of the real translator + real routing policy** (Phase 3, step 8); cover the host's signature gate with a fail-closed 401 HTTP test (step 9). Fully resolved — no implementation-time field-hunt remains.
- **R3 (item-mapping prerequisite, A3)** — a `ready` order requires seeded line-item mappings. **Mitigation**: single pre-mapped line item per fixture; verify the resolver's entity type (OQ2).
- **R4 (fake path keying, A2)** — the fake's offer-path helpers don't fit `/inbox`/`/orders`. **Mitigation**: add raw-path scripting (Phase 1, step 2) without touching the offer methods.
- **R5 (#992-provisional)** — fixtures encode unconfirmed wire shapes. **Mitigation**: header banner + per-fixture note; single reconciliation point already isolated in the types files.

### Edge Cases
- Unscripted `getOrder` 404 → typed `ErliApiException` (optional negative assertion).
- `notifyDispatched` 409 already-dispatched → treated as success (`erli-order-source.adapter.ts:314`).
- Empty inbox poll → `nextCursor` unchanged (never stuck) — optional assertion.

### Backward Compatibility
- ✅ No production code changed; `setup.ts` env gate only tightens determinism; the fake-client additions are additive.

---

## 9. Testing Strategy & Acceptance Criteria

### Integration Tests (the deliverable)
- **File(s)**: `apps/api/test/integration/erli/erli-orders-vertical-slice.int-spec.ts` (+ helper `helpers/erli-test-order-source.helper.ts`, + fake-client raw-path additions).
- **Real**: Postgres + Redis (Testcontainers via the harness), real `ErliOrderSourceAdapter`, real order mapper, real `OrderIngestionService`/`OrderRecord` persistence, real `IntegrationsService`/routing, real `ErliWebhookEventTranslator` + real `InboundRoutingPolicy` (invoked directly), real `WebhookController` (exercised by the fail-closed 401 test).
- **Faked**: the Erli HTTP transport (`ErliFakeHttpClient`). No fake/test translator — the real Erli translator is used. Buyer fixtures carry only synthetic PII (`@example.test`, "Jan Testowy"); the fail-closed test's webhook secret is an obviously-fake local constant.

### Scenario → AC mapping (end-to-end vs direct-invocation)
| AC | Scenario | Mechanism | Coverage |
|---|---|---|---|
| webhook translate→route→sync proven | Phase 3 step 8 | **direct invocation** of the REAL `ErliWebhookEventTranslator` + REAL `InboundRoutingPolicy` (live HTTP front door is #992-gated) | direct-invocation (real components; not the HTTP/DTO front door) |
| fail-closed HTTP webhook (security) | Phase 3 step 9 | POST bad/missing signature → 401, no delivery row, no job | end-to-end HTTP (signature gate) |
| inbox-poll reconciliation | Phase 2 step 5 | direct `ingestOrders` over fake inbox | end-to-end |
| webhook + poll converge (once) | Phase 2 step 7 | `getOrCreateInternalId` + `order_records` upsert; direct `syncOrderFromSource` ×2 for the deterministic count | end-to-end (core dedup) |
| COD → paid/`purchased` | Phase 2 step 6 | fake `purchased`+`cod` order → mapper → persisted snapshot (variant + mapping seeded → `ready`) | end-to-end |
| status writeback; tracking omitted for Erli-managed | Phase 4 step 10 | **direct** `notifyDispatched` against fake (live trigger #837/#769) | direct-invocation (documented) |
| Full suite incl. routing int-specs green | Phase 5 step 11 | `pnpm test:integration` | binding AC |

### Acceptance Criteria
- [ ] **AC-1**: webhook translate→route→sync proven via direct invocation of the real Erli translator + routing policy; the live HTTP webhook front door is #992-gated (needs the native decoder).
- [ ] Fail-closed HTTP webhook test: bad/missing signature → 401, no `webhook_deliveries` row, no `marketplace.order.sync` job.
- [ ] Integration suite exercises inbox-poll reconciliation, webhook+poll convergence, COD, and status writeback.
- [ ] Runs under `pnpm test:integration`; deterministic (no real timers; poll-until where a background effect must land).
- [ ] Full `pnpm test:integration` (incl. `routing-rules`/`fulfillment-routing`/`app-boot`/`connection-capabilities`) green.
- [ ] `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED:'false'` added to `setup.ts` (no cron hang).
- [ ] No new ESLint/type errors (`pnpm lint`, `pnpm type-check`).
- [ ] Spec header documents WHY the HTTP path is bypassed (DTO regex vs translator camelCase vocabulary; needs the #992 native decoder), the #992-provisional fixture banner, the synthetic-PII convention, and the direct-invocation nature of webhook translate→route→sync and writeback.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (consumes adapters via the production seam; CORE ↔ Integration untouched)
- [x] Respects CORE vs Integration boundaries (test-only, no boundary crossing added)
- [x] Uses existing patterns (#991 offers harness + echo-guard direct-ingestion + webhook-ingestion HMAC)
- [x] Idempotency/convergence covered (externalOrderId-keyed mapping + `internalOrderId` upsert + webhook dedup)
- [x] Event-driven path exercised (real Erli translator → real routing policy → `marketplace.order.sync`, by direct invocation; HTTP front door #992-gated, fail-closed 401 covered)
- [x] Rate limits & retries — n/a (test); typed-exception branches optionally asserted
- [x] Error handling — typed `ErliApiException`/409 branches optionally covered
- [x] Testing strategy complete (scenario→AC mapping; deterministic mechanisms)
- [x] Naming conventions followed
- [x] File structure matches standards (`apps/api/test/integration/erli/`, `helpers/`)
- [x] Plan is execution-ready
- [x] Plan saved as markdown file

---

## Related Documentation
- [Architecture Overview](./../architecture-overview.md) — §6 Listings, §4 Orders, §4 Webhook Ingestion Flow, ADR-025 (Erli)
- [Engineering Standards](./../engineering-standards.md) — naming, imports, test conventions
- [Testing Guide](./../testing-guide.md) — Testcontainers harness, `resetTestHarness`
- [ADR-025: Erli marketplace adapter](./../architecture/adrs/025-erli-marketplace-adapter.md) — reconciliation-first posture, inbox ack-on-next-read, #992 sandbox provisionality
- Reference specs: `apps/api/test/integration/erli/erli-offers-vertical-slice.int-spec.ts` (#991), `apps/api/test/integration/orders/order-reingestion-echo-guard.int-spec.ts` (#940), `apps/api/test/integration/webhook-ingestion.int-spec.ts`
