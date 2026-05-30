# Implementation Plan: WebhookEventTranslator capability + core InboundRoutingPolicy; delete provider switches (#903)

**Date**: 2026-05-30
**Status**: Ready for Review
**Estimated Effort**: ~1.5–2 days
**Issue**: #903 (Phase 2 of epic #900). Depends on #901 (ADR-015) + #902 (Phase 1, merged). Authoritative design: **ADR-015**.

---

## 1. Task Summary

**Objective**: Move webhook-event *translation* into the plugin (a new per-plugin `WebhookEventTranslator` capability) and *routing policy* into core (`InboundRoutingPolicy`), then **delete** the hardcoded `isMasterProvider = provider === 'prestashop'` switch + `mapObjectType` allow-list from `WebhookToJobHandler`, turning it into a thin dispatcher.

**Why**: Per ADR-015 — "is this a source we pull from?" is a **capability** question (`OrderSource`), not a platform-name one; routing orchestration belongs in core, not an `apps/api` handler; and adding a new platform's webhooks must need **no** host PR.

**Classification**: CORE (new domain port + types + core application service) + Integration (PrestaShop translator adapter) + plugin-sdk (HostServices handle) + Interface (handler refactor). No schema, no migration.

---

## 2. Scope & Non-Goals

### In Scope (ADR-015 Phase 2)
1. New per-plugin capability **`WebhookEventTranslatorPort`** + **`WebhookEventTranslatorRegistryService`** (mirrors the `WebhookProvisioning` registry mechanics; semantics match the pure shape-validators).
2. New neutral type **`CanonicalInboundEvent`** (transient, no `schemaVersion`).
3. New core **`InboundRoutingPolicy`** application service: deterministic `domain → required capability → jobType` table, capability-gated via a **metadata read** (not exception-as-control-flow), enqueues the resulting `SyncJobRequest`.
4. **PrestaShop translator adapter** mapping `order.created`/`order.status_changed`/`stock.changed`/`product.saved` → canonical events; registered in `createPrestashopPlugin().register(host)`.
5. **Refactor `WebhookToJobHandler`** to a thin dispatcher (resolve connection → translator → policy). **Delete** `isMasterProvider`, `mapObjectType`, `validateJobType`, `mapToSyncJob`, and the #902 `mapOrderFeedEventType` helper (relocated into the translator/policy).

### Out of Scope
- Poll backstop → **#904** (Phase 3).
- Destination idempotency → already shipped (#906); #909 is the full-A′ follow-up.
- Unified webhook/poll dedup-key derivation (ADR-015 invariant 2) — an optimization; **invariant 1 (idempotency, done in #906) is the correctness guarantee**. Tracked separately if pursued.
- DLQ metric/alert surface (ADR-015 invariant 4) — the DLQ stream already has no consumer; this PR preserves the existing DLQ behavior and does not add observability tooling. Note as a follow-up.
- Allegro translator — Allegro is **poll-only** (no inbound webhook); per ADR orthogonality table it ships `OrderSource` without a translator. No translator registered.

### §4a — Master payload contract (verified before delete)

`libs/core/src/sync/domain/types/master-job-payloads.types.ts` + the worker handlers (`master-inventory-sync.handler.ts:71-102`, `master-product-sync.handler.ts`):
- `MasterProductSyncByExternalIdPayloadV1 = { schemaVersion:1; externalId; objectType: 'Product' }`
- `MasterInventorySyncByExternalIdPayloadV1 = { schemaVersion:1; externalId; objectType: 'Inventory' | 'Product' }`
- Handlers **require** `externalId` + `objectType` (throw if missing), validate `objectType` ∈ {inventory,product} case-insensitively, and **ignore `eventType`** (`getPayload` drops it). → The policy reproduces these exactly via `satisfies`; it must emit PascalCase `objectType` and need not emit `eventType`.

### Constraints
- **Acceptance**: no platform-name string-matching or objectType map left in `WebhookToJobHandler`; PS order/stock/product all route through translator + policy; source/destination decision is capability-driven; a new plugin's webhooks need no core/interface edit; **full `pnpm test:integration` green**.
- No regression to product/stock routing (they become routing-table rows).

---

## 3. Architecture & Placement Decisions

Layer dependencies introduced (all **type/interface/token-only** → cycle-safe per the documented rule, since none of the targets import back at value level):
- `integrations → events` (translator port references `InboundWebhookEvent`). Acyclic (`events` doesn't import `integrations`).
- `sync → integrations` (policy references `CanonicalInboundEvent`, `IIntegrationsService`, `Connection`). Acyclic (`integrations` doesn't import `sync`).
- `sync → orders` already exists (policy validates `OrderFeedEventType`).

### New components

| Component | Location | Notes |
|---|---|---|
| `CanonicalInboundEvent` (+ `InboundEventDomainValues`/`InboundEventDomain`) | `libs/core/src/integrations/domain/types/canonical-inbound-event.types.ts` | Lives with the port (its return type). `domain: 'order'\|'inventory'\|'product'` (closed, additive — the routing key). `eventType: string` **advisory** (see §4 A1). `externalId: string`; `occurredAt?`, `payload?`. |
| `WebhookEventTranslatorPort` | `libs/core/src/integrations/domain/ports/webhook-event-translator.port.ts` | `translate(event: InboundWebhookEvent): CanonicalInboundEvent \| null` — pure, no I/O; `null` = undecodable (ADR invariant 5: return, don't throw unbounded). |
| `WebhookEventTranslatorRegistryService` | `libs/core/src/integrations/infrastructure/adapters/webhook-event-translator-registry.service.ts` | Exact clone of `WebhookProvisioningRegistryService`: `Map<adapterKey, port>`, `register/get/has`. |
| `WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN` | `libs/core/src/integrations/integrations.tokens.ts` | + provide/bind/export in `integrations.module.ts`. |
| `webhookEventTranslatorRegistry` handle | `libs/plugin-sdk/src/host-services.ts` | 9th well-known registry on `HostServices`. |
| `InboundRoutingPolicy` (+ `IInboundRoutingPolicy` interface) | `libs/core/src/sync/application/services/inbound-routing-policy.service.ts` (+ `application/interfaces/inbound-routing-policy.service.interface.ts`) | Sync-orchestration policy (ADR: "orchestration in core"). Deps: `IIntegrationsService` (gate) + `JobEnqueuePort` (enqueue) — exactly the two ADR-015 §Decision names. |
| `INBOUND_ROUTING_POLICY_TOKEN` + `RoutingOutcome` type | `libs/core/src/sync/sync.tokens.ts` + `.../inbound-routing-policy.types.ts` | |
| `PrestashopWebhookEventTranslatorAdapter` | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-webhook-event-translator.adapter.ts` | No-dep class; registered via `new`. |

### Routing table (in `InboundRoutingPolicy`)

Payloads are **verified against the worker handlers** (§4a) and typed via `satisfies` against the existing payload interfaces:

| `domain` | gate capability | `jobType` (typed `JobType`) | payload built (`satisfies` the existing type) |
|---|---|---|---|
| `order` | `OrderSource` | `marketplace.order.sync` | `MarketplaceOrderSyncPayloadV1` — `{ schemaVersion:1, externalOrderId, sourceEventId, eventType: OrderFeedEventType, occurredAt }` |
| `inventory` | `InventoryMaster` | `master.inventory.syncByExternalId` | `MasterInventorySyncByExternalIdPayloadV1` — `{ schemaVersion:1, externalId, objectType: 'Inventory' }` |
| `product` | `ProductMaster` | `master.product.syncByExternalId` | `MasterProductSyncByExternalIdPayloadV1` — `{ schemaVersion:1, externalId, objectType: 'Product' }` |

`domain` is the routing key; capability is only the **gate**. **Gate = `metadata.supportedCapabilities.includes(cap) && connection.enabledCapabilities.includes(cap)`** (decision below) — both reads, no exception-as-control-flow. The canonical `eventType` feeds **only** the order payload (master payloads carry no `eventType` — §4a). Job-type strings are compile-time `JobType` literals (no runtime `validateJobType`). Idempotency key: `${connection.platformType}:${connection.id}:${sourceEventId}` — `sourceEventId` (= source `eventId`) is passed by the dispatcher (§4 A3), not carried on `CanonicalInboundEvent`.

---

## 4. Questions & Assumptions

- **A1 — `CanonicalInboundEvent.eventType` is an advisory `string`, not a per-domain union.** ADR-015 says "order → `OrderFeedEventType`", but typing the canonical event as a discriminated union would force `integrations → orders` (a type-only cycle; documented-safe but avoidable). Decision: keep `eventType: string` on the neutral type (translator emits `'created'`/`'updated'` for orders, `'stock.changed'`/`'product.saved'` passthrough otherwise); the **policy** validates/coerces it to `OrderFeedEventType` (default `'updated'`) when building the order payload (it's in `sync`, which already imports `orders`). Keeps `integrations` free of an `orders` import. *(Alternative — discriminated union with order→`OrderFeedEventType` — is viable if we accept the type-only cycle; flagged for review.)*
- **A2 — `InboundRoutingPolicy` enqueues** (owns `JobEnqueuePort`), returning a `RoutingOutcome` (`{ status: 'enqueued', jobId, jobType }` | `{ status: 'ungated', domain, requiredCapability }`). The dispatcher DLQs on `ungated`. This matches ADR-015 §Decision ("depends on IIntegrationsService **and** JobEnqueuePort") and keeps the dispatcher thin (no enqueue in the interface layer).
- **A3 — `eventId` for the idempotency key**: not part of `CanonicalInboundEvent` (which is domain-routing data). The dispatcher passes the source `eventId` + the resolved `connection` into `route(canonical, connection, sourceEventId)`. Idempotency key derivation stays `${platformType}:${connectionId}:${eventId}` (unchanged from #902/existing).
- **A4 — Policy wiring**: `InboundRoutingPolicy` (core class) is **provided in the `apps/api` webhooks module**, where `INTEGRATIONS_SERVICE_TOKEN` + `JOB_ENQUEUE_TOKEN` are already available — precedent: `ContentSuggestionService` is bound in `apps/api/.../content.module.ts`. Avoids a core `SyncModule ↔ IntegrationsModule` import cycle. *(Verify no cycle at impl; fall back to wiring in `SyncModule` with token-only imports if cleaner.)*
- **A5 — Translator input** is the existing `InboundWebhookEvent` (already carries provider `objectType`/`eventType`/`externalId`/`payload`). Envelope parsing (`mapToInboundWebhookEvent`) stays in the handler — that's transport decode, not domain translation. The translator maps provider vocabulary → canonical domain.
- **A6 — `getAdapter` throws** (connection not found / disabled) → DLQ (config fault, not transient). Genuinely transient infra errors (Redis) keep the existing "don't ACK, rethrow, redeliver" path. The gate uses capability **reads**, never exception-as-control-flow (ADR invariant 3). **Behavior change (intentional)**: the old `mapToSyncJob` had no connection-status check; the new dispatcher DLQs webhooks for **disabled** connections (the `WebhookController` validates "active" at receipt, so this only bites a disable between receipt and processing — DLQ, not silent drop, is acceptable). DLQ reason strings distinguish `connection-unavailable` / `no-translator` / `ungated:<capability>` for future invariant-4 observability.
- **A7 — Gate decision: `supportedCapabilities && enabledCapabilities`.** The downstream `IntegrationsService.getCapabilityAdapter` (called by `OrderIngestionService`/master syncs) enforces **both** adapter-level `supportedCapabilities` and connection-level `enabledCapabilities`. So the routing gate checks both too — a connection that *supports* but has *disabled* a capability must **not** enqueue a job that's guaranteed to fail downstream with `CapabilityNotEnabledException`. The policy holds the `connection` (so `enabledCapabilities` is in hand) and resolves `metadata` for `supportedCapabilities`. *(ADR-015 invariant 3 says "supportedCapabilities"; this is a stricter, connection-scoped superset — worth a one-line ADR clarification in a follow-up, non-blocking.)*
- **A8 — Master payloads carry no `eventType`.** Verified (§4a): the master worker handlers read only `externalId` + `objectType` and **require** `objectType` (PascalCase literal `'Inventory'`/`'Product'`). The canonical `eventType` is dropped for the master domains and used only to derive the order payload's `OrderFeedEventType`.

---

## 5. Implementation Plan

### Phase A — core `integrations`: capability + registry + type
1. `canonical-inbound-event.types.ts` — `InboundEventDomainValues = ['order','inventory','product'] as const`; `InboundEventDomain`; `CanonicalInboundEvent` interface.
2. `webhook-event-translator.port.ts` — `WebhookEventTranslatorPort.translate(event: InboundWebhookEvent): CanonicalInboundEvent | null`.
3. `webhook-event-translator-registry.service.ts` — clone `WebhookProvisioningRegistryService`.
4. `integrations.tokens.ts` — `WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN`. `integrations.module.ts` — provide + `useExisting` bind + export. Barrel already `export * from tokens`; add type/port exports to `integrations/index.ts`.
5. Unit test: registry `register/get/has`.

### Phase B — plugin-sdk
6. `host-services.ts` — add `webhookEventTranslatorRegistry: WebhookEventTranslatorRegistryService` to `HostServices` (import type from `@openlinker/core/integrations`).

### Phase C — core `sync`: routing policy
7. `inbound-routing-policy.types.ts` — `RoutingOutcome` union.
8. `inbound-routing-policy.service.interface.ts` — `IInboundRoutingPolicy.route(event, connection, sourceEventId): Promise<RoutingOutcome>`.
9. `inbound-routing-policy.service.ts` — table + gate (`resolveAdapterMetadata().supportedCapabilities.includes(required)`) + per-domain payload build + `jobEnqueue.enqueueJob`. Implements the interface; injected via tokens.
10. `sync.tokens.ts` — `INBOUND_ROUTING_POLICY_TOKEN`. Barrel exports service + interface + types + token.
11. Unit test: each domain → correct jobType+payload+idempotencyKey; gate-pass enqueues; gate-fail → `ungated`; order eventType coercion (`created`/unknown→`updated`).

### Phase D — PrestaShop translator
12. `prestashop-webhook-event-translator.adapter.ts` — `implements WebhookEventTranslatorPort`. Map by `objectType` (case-insensitive): `order`→domain `order` (eventType `order.created`→`created`, `order.status_changed`→`updated`, else `updated`); `stock`→domain `inventory` (eventType passthrough); `product`→domain `product`; else `null`. (`test.*` never reaches here — handler short-circuits.)
13. Register in `createPrestashopPlugin().register(host)`: `host.webhookEventTranslatorRegistry.register('prestashop.webservice.v1', new PrestashopWebhookEventTranslatorAdapter())`. Add the registry to the `HostServices` bag built in `PrestashopIntegrationModule.onModuleInit` (inject the new token).
14. Unit test: order/stock/product/unknown→null mappings.

### Phase E — refactor the dispatcher (apps/api)
15. `webhook-to-job.handler.ts`:
    - Inject `INTEGRATIONS_SERVICE_TOKEN` (`IIntegrationsService`), `WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN` (registry), `INBOUND_ROUTING_POLICY_TOKEN` (policy). Drop `JOB_ENQUEUE_TOKEN` (policy enqueues).
    - New `processMessage` body after the `test.*` skip: `getAdapter(connectionId)` → `{connection, metadata}`; `translator = registry.get(metadata.adapterKey)` (null → DLQ "no translator"); `canonical = translator.translate(event)` (null → DLQ "undecodable"); `outcome = policy.route(canonical, connection, event.eventId)`; `ungated` → DLQ (`no <capability> capability`); `enqueued` → `recordDelivery(job_enqueued, downstreamJobId/Type)` + ACK. `getAdapter` throw → DLQ.
    - **Delete**: `mapToSyncJob`, `mapObjectType`, `normalizeObjectType` (verify no other caller), `validateJobType`, `mapOrderFeedEventType`, `isMasterProvider`. Drop now-unused imports (`JobTypeValues`, `MarketplaceOrderSyncPayloadV1`, `OrderFeedEventType`, `JobEnqueuePort`).
16. apps/api webhooks module — provide `InboundRoutingPolicy` bound to `INBOUND_ROUTING_POLICY_TOKEN` (deps resolve from already-imported Integrations + sync tokens); ensure `WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN` + `INTEGRATIONS_SERVICE_TOKEN` are importable.
17. Rewrite `webhook-to-job.handler.spec.ts` to the dispatch flow (mock `getAdapter`, registry, policy): order/stock/product route; no-translator→DLQ; undecodable→DLQ; ungated→DLQ; `test.*` skip unchanged; idempotency-key shape preserved.

### Phase F — quality gate
18. `pnpm lint && pnpm type-check && pnpm test`, then **full `pnpm test:integration`** (acceptance; per the manifest-capability→routing-int-spec ripple lesson, run the whole suite, not just webhook specs).

---

## 6. Alternatives Considered
- **`CanonicalInboundEvent.eventType` as a discriminated union** (order→`OrderFeedEventType`): more type-safe but forces a type-only `integrations→orders` cycle. Deferred to `string` + policy-side coercion (A1).
- **Policy returns a `SyncJobRequest`, dispatcher enqueues**: leaves enqueue orchestration in the interface layer; rejected per ADR ("orchestration in core") — policy enqueues (A2).
- **Translator as a method on `OrderSourcePort`**: rejected by ADR-015 (inbound webhooks are multi-domain per connection; translation is api-side/pure vs OrderSource's worker-side I/O).
- **Wire policy in core `SyncModule`**: risks a `SyncModule↔IntegrationsModule` cycle; binding in `apps/api` (ContentSuggestionService precedent) is safer (A4).

---

## 7. Risks
- **Module cycle** when wiring the policy (`sync` service needing `IIntegrationsService`). Mitigated by binding in `apps/api` (A4) + token/interface-only cross-context imports.
- **Spec churn**: the existing `webhook-to-job.handler.spec.ts` is built around `mapToSyncJob`/`mapObjectType` — it's substantially rewritten. The #902 order-routing tests are relocated into the translator + policy specs. Risk of losing a behavior assertion → mitigate by mapping each deleted test to its new home.
- **Int-spec ripple**: webhook-ingestion / routing int-specs may assert the old DLQ-for-order or master-routing behavior. Run the **full** integration suite; update any that encode the pre-refactor routing.
- **`normalizeObjectType` / `validateJobType` external callers**: confirm nothing else imports them before deleting (grep).
- **DLQ semantics change**: previously `order` → DLQ ("unsupported"); now `order` with no `OrderSource` → DLQ ("ungated"), and `order` with `OrderSource` → enqueued. Net-better, but the DLQ *reason strings* change — update any test asserting them.

---

## 8. Acceptance Criteria (from #903)
- [ ] No `provider === '...'` / objectType map in `WebhookToJobHandler` (it only resolves connection → translator → policy).
- [ ] PS order/stock/product webhooks route through the plugin translator + core policy.
- [ ] Source/destination is capability-driven (`OrderSource` gate) — one PS connection can be both without contradiction.
- [ ] A new plugin's webhook events need **no** core/interface edit — only `register(host)` + a translator class.
- [ ] `pnpm lint && type-check && test` green; **full `pnpm test:integration` green**.

---

## 9. Alignment Checklist
- [x] Hexagonal: port in domain, registry in infrastructure, policy in application; adapter in plugin.
- [x] Capability registered via `HostServices` (mirrors #583/#586/#587); keyed by `adapterKey`.
- [x] Routing orchestration in **core**, not `apps/api`.
- [x] Capability gate is a metadata read, not exception-as-control-flow (ADR invariant 3).
- [x] Translator total (returns `null`, never unbounded throw — invariant 5).
- [x] No new job type / schema / migration; reuses #902's `marketplace.order.sync` + master jobs.
- [x] Cross-context edges are type/interface/token-only (cycle-safe).

---

## Related
- ADR-015 (authoritative design). Epic #900. Phase 1 #902 (merged), Phase 3 #904. Idempotency prerequisite #906 (merged).
