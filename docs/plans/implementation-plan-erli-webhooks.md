# Implementation Plan: Erli inbound webhooks — translator + routing + provisioning (#996)

**Date**: 2026-06-16
**Status**: Ready for Review
**Estimated Effort**: ~1 day (plugin-only; unit tests over authored fixtures)
**Branch**: `996-erli-webhooks` (worktree `.claude/worktrees/996-erli-webhooks`), stacked on the Erli chain — contains #994 (order mapper), #993 (OrderSource + inbox poll), #995 (buyer-identity normalizer). Single PR (plan + implementation on one branch).

---

## 1. Task Summary

**Objective**: Lay the **fail-safe scaffolding** for a future low-latency *trigger* path for Erli order ingestion via inbound webhooks, while the #993 inbox poll remains the **only working ingestion path** until #992 lands the native decoder. What #996 ships now is all unit-testable + mergeable; the end-to-end functional webhook path is hard-#992-blocked (see the reframe below). Concretely:

- An `ErliWebhookEventTranslator` that decodes Erli's id-only `orderCreated` / `orderStatusChanged` webhook bodies into a neutral `CanonicalInboundEvent` with `domain: 'order'` (unit-tested against authored fixtures). The translator runs **post-verify** — in production it never receives an Erli event until a native decoder lands (#992).
- Routing of that event to the `marketplace.order.sync` job via the existing core `InboundRoutingPolicy` — **no platform string-matching in the interface layer**; the webhook controller stays a thin dispatcher.
- A `WebhookProvisioningPort` adapter. Since Erli's API-registration support is **#992-unconfirmed**, the safe default is a **documented manual seller-panel setup** (a provisioner that does no remote call and returns a `warning`), with the API-provisioner flagged as a #992 follow-up.
- Idempotent convergence with the #993 poll *once the webhook path is functional*: the SAME order is ingested exactly once. The webhook only triggers the same `OrderIngestionService.syncOrderFromSource` job; dedup/idempotency are downstream.

**🔴 Reframe — what ships now vs. what is #992-blocked.** Verified against code: the host default OL-HMAC `InboundWebhookDecoderPort` requires OL's exact signature scheme (`x-openlinker-timestamp` + `x-openlinker-signature: sha256=<hex>`, HMAC over `{timestamp}.{rawBody}`) **and** OL's bespoke envelope DTO (`WebhookRequestDto`: `schemaVersion`, `eventId`, `eventType` matching `^[a-z]+\.[a-z_]+$`, nested `object`). A third-party Erli seller panel emits **neither**, and Erli webhooks are id-only — so the default decoder **rejects 100% of real Erli webhooks** (401 on signature / 400 on body). That is **fail-closed-SAFE** (no order loss; the #993 inbox poll is authoritative) but **NON-FUNCTIONAL** as an ingestion path. Because the translator runs post-verify, with no native decoder it never receives an Erli event in production.
- **What #996 ships now** = fail-safe scaffolding, all unit-testable + mergeable: the `ErliWebhookEventTranslator` (unit-tested against authored fixtures), the manual-documented `ErliWebhookProvisioningAdapter`, the `erli-webhook.types.ts` provisional types, and their `register(host)` registration. The #993 inbox poll remains the only working ingestion path until #992.
- **What makes the webhook path functional** = the native `ErliInboundWebhookDecoderAdapter` (formerly the conditional "Phase 4"). It is the **load-bearing** component and is hard-**#992-BLOCKED** (Erli's signature scheme, header names, and body shape are all unconfirmed). It is the explicit #992 follow-up that unblocks functional ingestion — **not optional polish**.

**Context**: Per [ADR-025](../architecture/adrs/025-erli-marketplace-adapter.md), Erli order webhooks are *fire-once, 5 s timeout, no retry* — a missed webhook is silently lost (ADR-025 lines 12, 27, 35). The architecture therefore treats webhooks as a latency optimization on top of the mandatory inbox poll (#993), converging idempotently on `syncOrderFromSource`. This issue wires Erli into the provider-agnostic inbound pipeline established by [ADR-015](../architecture/adrs/015-inbound-event-routing-capability-translated.md) (routing) and [ADR-021](../architecture/adrs/021-third-party-native-inbound-webhook-ingestion.md) (per-provider decode), mirroring PrestaShop (#900/#902/#903).

**Classification**: **Integration** (plugin-only — `libs/integrations/erli/**`). Strong expectation, validated below: **no core change required**.

---

## 2. Scope & Non-Goals

### In Scope (#996 — fail-safe scaffolding, all unit-testable + mergeable)
- `ErliWebhookEventTranslator` (`WebhookEventTranslatorPort`) — id-only body → `CanonicalInboundEvent { domain: 'order' }`. Unit-tested against authored fixtures. (Runs post-verify; receives no production Erli event until the native decoder lands — #992.)
- A single `#992-PROVISIONAL` reconciliation point for the webhook wire shape: `erli-webhook.types.ts` (event-type literals, body field names, signature/header names).
- `ErliWebhookEventTranslator` registration in `createErliPlugin().register(host)` against `ERLI_ADAPTER_KEY` (`erli.shopapi.v1`).
- Webhook provisioning: a documented **manual seller-panel** provisioner (`ErliWebhookProvisioningAdapter` implementing `WebhookProvisioningPort`) registered against `ERLI_ADAPTER_KEY`, returning `{ webhooksConfigured: false, testPingTriggered: false, warning: 'manual-setup-required' }` until #992.
- Unit tests over authored fixtures: translator (both event types, malformed → reject/null) and provisioner (returns documented-manual result).

### #992 follow-up (load-bearing — makes the webhook path functional, NOT optional polish)
- The native `ErliInboundWebhookDecoderAdapter` (`InboundWebhookDecoderPort`, ADR-021) — see Phase 4. Until this lands, the host's fail-closed OL-HMAC default rejects 100% of real Erli webhooks and the #993 poll is the only working ingestion path. Hard-#992-blocked: Erli's signature scheme, header names, and body shape are all unconfirmed. This is the explicit follow-up that unblocks functional ingestion.

### Out of Scope
- Any core change to `InboundRoutingPolicy`, `WebhookToJobHandler`, `WebhookController`, or `CanonicalInboundEvent` — confirmed unnecessary (see §3 / §8).
- An Erli **API webhook-registration** provisioner — deferred to the #992 follow-up (Erli sandbox spike). The manual provisioner is the placeholder.
- The native `ErliInboundWebhookDecoderAdapter` build itself — its construction is #992-blocked (signature/header/body unconfirmed); #996 only frames it (Phase 4) as the follow-up that makes ingestion functional.
- Confirming the real Erli webhook wire shape / signature scheme / event-type names — all #992-blocked; this issue builds provisionally against authored fixtures.
- Frontend wiring of the "Configure webhooks" button for Erli (#990 owns the Erli connection FE).
- Integration tests (`*.int-spec.ts`) — the inbound pipeline already has int-specs; #996 adds unit coverage only (per resource-constrained test prefs).

### Constraints
- **#992 not done**: webhook body shape, event-type names, signature/auth mechanism, and API-registration availability are ALL UNCONFIRMED. Every such unknown is isolated behind `erli-webhook.types.ts` and tagged `#992-PROVISIONAL`, and listed in §5.
- Must not break the existing PrestaShop / InPost inbound paths (shared host pipeline).
- Erli webhooks are no-retry/5 s — the design must never depend on webhook delivery for correctness (poll backstop already exists, #993).

---

## 3. Architecture Mapping

**Target Layer**: **Integration** — `libs/integrations/erli/src/infrastructure/adapters/` (translator + provisioner now; native decoder as the load-bearing #992 follow-up) + `.../domain/types/` (provisional wire types) + `erli-plugin.ts` (registration).

**Capabilities / Ports Involved** (all already defined in core; Erli only implements + registers):
- `WebhookEventTranslatorPort` — `libs/core/src/integrations/domain/ports/webhook-event-translator.port.ts:25-32`. `translate(event: InboundWebhookEvent): CanonicalInboundEvent | null`.
- `WebhookProvisioningPort` — `libs/core/src/integrations/domain/ports/webhook-provisioning.port.ts:23-39`. `install(connectionId, actorUserId?): Promise<WebhookProvisioningResult>`.
- `InboundWebhookDecoderPort` (the load-bearing #992 follow-up, ADR-021) — `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts:26-45`. `verify(...)` + `extractEnvelope(...)`. Built under #992; until then the fail-closed OL-HMAC default rejects all real Erli traffic.
- `CanonicalInboundEvent` (translator output) — `libs/core/src/integrations/domain/types/canonical-inbound-event.types.ts:24-39`; domain union `['order','inventory','product','shipment']` at lines 20-22.

**Existing host machinery reused (unchanged)**:
- `WebhookToJobHandler` (thin dispatcher) — `apps/api/src/webhooks/application/handlers/webhook-to-job.handler.ts`. Resolves connection → `adapterKey` → translator via `translatorRegistry.get(adapterKey)`, calls `translate`, then `routingPolicy.route(...)`. Dead-letters on `no-translator` / `undecodable` / `ungated`.
- `WebhookEventTranslatorRegistryService` — `libs/core/src/integrations/infrastructure/adapters/webhook-event-translator-registry.service.ts:21-36`. Keyed by `adapterKey`.
- `InboundRoutingPolicyService` — `libs/core/src/sync/application/services/inbound-routing-policy.service.ts:105-161`. `case 'order': → jobType 'marketplace.order.sync', requiredCapability 'OrderSource'` (lines 113-128). **Keyed purely on `event.domain` — no platform/adapterKey awareness.**
- `WebhookProvisioningRegistryService` (host bag) + `ConnectionService.installWebhooks` dispatch by `adapterKey`.
- `WebhookController` → `WebhookService.processWebhook` pipeline (`verify → replay → dedup → publish`) — `apps/api/src/webhooks/http/webhook.controller.ts`, `apps/api/src/webhooks/application/services/webhook.service.ts:56-223`.
- `OrderIngestionService.syncOrderFromSource` (idempotent externalOrderId-keyed upsert) — `libs/core/src/orders/application/services/order-ingestion.service.ts:186-299`.

**New Components Required** (Erli plugin only):
1. `erli-webhook.types.ts` — `#992-PROVISIONAL` wire-shape reconciliation point (`domain/types/`).
2. `ErliWebhookEventTranslator` (`infrastructure/adapters/erli-webhook-event-translator.adapter.ts`).
3. `ErliWebhookProvisioningAdapter` (`infrastructure/adapters/erli-webhook-provisioning.adapter.ts`) — manual-documented no-op.
4. (#992 follow-up — load-bearing) `ErliInboundWebhookDecoderAdapter` (`infrastructure/adapters/erli-inbound-webhook-decoder.adapter.ts`). Makes the webhook path functional; #992-blocked.
5. Two registration lines now in `erli-plugin.ts:63-95` `register(host)` (translator + provisioner); a third (decoder) added under #992.

**Core vs Integration Justification**: This is a pure Integration extension. The core inbound pipeline is *already* provider-agnostic — routing is keyed only on the neutral `CanonicalInboundEvent.domain` (`inbound-routing-policy.service.ts:113`), and both translator and provisioner are resolved from host-bag registries by `adapterKey`. PrestaShop (`prestashop-plugin.ts:104-109`) demonstrates the same plugin-only seam. Erli adds nothing to core; it implements core ports and self-registers in `register(host)`. **CENTRAL ANSWER: #996 is plugin-only.** The order domain → `marketplace.order.sync` mapping already exists generically, so Erli needs only a translator that emits `domain: 'order'`; no routing or controller edit.

---

## 4. External / Domain Research

### External System (Erli) — all #992-blocked
- **Authentication (inbound)**: Erli's webhook signature/timestamp scheme is **UNCONFIRMED**. The host *default* OL-HMAC decoder requires OL's exact signature scheme (`x-openlinker-timestamp` + `x-openlinker-signature: sha256=<hex>`, HMAC over `{timestamp}.{rawBody}`) AND OL's bespoke `WebhookRequestDto` envelope — neither of which a third-party Erli seller panel emits — so it **rejects 100% of real Erli webhooks** (401/400). It is therefore a **fail-closed safety net, not a functional ingestion path**. Functional ingestion requires an Erli-native `InboundWebhookDecoderPort` (ADR-021, like InPost's `x-inpost-signature`) — the **load-bearing #992 follow-up** (Phase 4). Flagged in A-2 / §5.
- **Body shape**: Per the issue, Erli webhooks are **id-only** — `orderCreated` / `orderStatusChanged` carry the order id, not the full order. This matches the trigger-not-truth model perfectly (ADR-015): the translator only needs the external order id; the full order is pulled by the downstream `marketplace.order.sync` job via `ErliOrderSourceAdapter.getOrder`.
- **Event-type names**: `orderCreated`, `orderStatusChanged` are the issue's working names — **UNCONFIRMED literal strings**; isolated in `erli-webhook.types.ts`.
- **Retry / timeout**: fire-once, 5 s, no retry (ADR-025:12). Correctness must not depend on the webhook — satisfied by the #993 poll backstop.
- **API registration**: whether Erli exposes an API to register webhook endpoints is **UNCONFIRMED** (#992). Safe default = manual seller-panel setup.

### Internal Patterns (reference: PrestaShop #900/#902/#903, ADR-015/021)
- **Translator pattern**: `PrestashopWebhookEventTranslatorAdapter` — `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-webhook-event-translator.adapter.ts:26-58`. `switch (objectType)`; `case 'order' → { domain: 'order', externalId, eventType: orderEventType(...), occurredAt, payload }`; unknown objectType → `return null` (dead-letter). **Total — never throws.** Maps native order verbs to `'created'|'updated'` (lines 60-74).
- **Translator registration**: `prestashop-plugin.ts:106-109` — `host.webhookEventTranslatorRegistry.register('prestashop.webservice.v1', new PrestashopWebhookEventTranslatorAdapter())`.
- **Provisioner pattern**: `PrestashopWebhookProvisioningAdapter.install` — `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-webhook-provisioning.adapter.ts:68-161`. Returns `WebhookProvisioningResult` with `warning` on partial success (e.g. `'ping-not-received'`, `'state-update-failed'`).
- **Provisioner registration**: `prestashop-plugin.ts:100-103` — `host.webhookProvisioningRegistry.register('prestashop.webservice.v1', deps.webhookProvisioningAdapter)`.
- **Decoder pattern (ADR-021)**: `InpostInboundWebhookDecoderAdapter` — `libs/integrations/inpost/src/infrastructure/adapters/inpost-inbound-webhook-decoder.adapter.ts` (+ co-located `.spec.ts`). `verify` returns `{ ok, timestampMs }`; `extractEnvelope` returns `route|ignore|reject`.
- **Decoder registry handle**: `host.inboundWebhookDecoderRegistry` — `libs/plugin-sdk/src/host-services.ts` (the `InboundWebhookDecoderRegistryService` field). Keyed by **`provider`**, not `adapterKey` (ADR-021 line 34).
- **Idempotent convergence**: `ErliOrderSourceAdapter` already converges on `syncOrderFromSource`'s externalOrderId-keyed upsert (`erli-order-source.adapter.ts:23-25` comment; `order-ingestion.service.ts:186-299`). The webhook merely enqueues the same `marketplace.order.sync` job the poll enqueues — both carry `externalOrderId`, both hit the same upsert. Exactly-once by construction (#993).
- **Erli registration seam confirmed**: `createErliPlugin().register(host)` — `erli-plugin.ts:63-95` — already registers six things via the host bag; adding the two/three webhook registrations is the same one-line-each pattern. `HostServices` exposes `webhookEventTranslatorRegistry`, `webhookProvisioningRegistry`, and `inboundWebhookDecoderRegistry` (`host-services.ts` fields documented at the webhook-provisioning / translator / decoder comments).

---

## 5. Questions & Assumptions

### Open Questions (ALL #992-blocked — to confirm in the Erli sandbox spike)
1. **OQ-1 (body shape)**: What is the exact JSON body of Erli's `orderCreated` / `orderStatusChanged` webhooks? Confirmed id-only? What field carries the order id (`id`? `orderId`? nested)? → isolated in `erli-webhook.types.ts`.
2. **OQ-2 (event-type literals)**: Are the event-type discriminators literally `orderCreated` / `orderStatusChanged`, and where do they live (header? body field? URL)? → `ErliWebhookEventType` literals in `erli-webhook.types.ts`.
3. **OQ-3 (signature/auth)**: Does Erli sign webhooks (HMAC? header names? timestamp?), or are they unauthenticated? Determines whether we need an `InboundWebhookDecoderPort` (native scheme) or can use the OL-HMAC default.
4. **OQ-4 (API registration)**: Does Erli expose an API to register a webhook callback URL + secret, or is it manual seller-panel only? Determines whether the manual provisioner stays a no-op or grows into an API call (#992 follow-up).
5. **OQ-5 (occurredAt)**: Does the webhook carry a timestamp usable for replay/`occurredAt`? If absent, the translator omits `occurredAt` (it is advisory only — `canonical-inbound-event.types.ts:34-35`).

### Assumptions (safe defaults)
- **A-1**: Erli order webhooks are **id-only triggers**; the full order is pulled downstream by `marketplace.order.sync` → `ErliOrderSourceAdapter.getOrder`. (Matches ADR-015 trigger-not-truth.)
- **A-2 (signature posture)**: The **host default OL-HMAC decoder is the fail-closed SAFETY NET, not a functional ingestion path.** Verified against code: it requires OL's exact signature scheme (`x-openlinker-timestamp` + `x-openlinker-signature: sha256=<hex>`, HMAC over `{timestamp}.{rawBody}`) **and** OL's bespoke envelope DTO (`WebhookRequestDto`: `schemaVersion`, `eventId`, `eventType` matching `^[a-z]+\.[a-z_]+$`, nested `object`). A third-party Erli seller panel emits **neither** of these, and Erli webhooks are id-only — so the default decoder **rejects 100% of real Erli traffic** (401 on signature / 400 on body). This is **fail-closed-SAFE** (no order loss — the #993 poll is authoritative) but **NON-FUNCTIONAL**: until the native `ErliInboundWebhookDecoderAdapter` (ADR-021, keyed on `provider='erli'`, registered via `host.inboundWebhookDecoderRegistry`) lands under **#992**, real Erli webhooks never reach the translator in production. The translator is unaffected by which decoder runs — it runs post-publish on the neutral `InboundWebhookEvent` — but it only *receives* events once a decoder accepts them. The native decoder is the **load-bearing #992 follow-up that makes the webhook path functional**, not optional polish.
  - **Fail-closed note (ADR-021:37)**: absent any registered Erli decoder, the host applies the *strict* OL-HMAC default — a misconfigured (or any real third-party) Erli webhook 401/400s rather than bypassing verification. This is the safe provisional posture: we do not weaken verification by guessing Erli's scheme. It is a safety net, not an ingestion path.
- **A-3 (provisioning default)**: Erli API webhook-registration is unconfirmed → ship a **manual-documented provisioner** (`install` does no remote call, returns `{ webhooksConfigured: false, testPingTriggered: false, warning: 'manual-setup-required' }`) plus a doc step in the Erli connection setup. API-registration provisioner is the #992 follow-up.
- **A-4 (event mapping)**: `orderCreated → eventType 'created'`, `orderStatusChanged → 'updated'`, any other/unknown order event → `'updated'` (safe re-pull), mirroring PrestaShop's `orderEventType` (`prestashop-webhook-event-translator.adapter.ts:60-74`). Routing coerces via `toOrderFeedEventType` (`inbound-routing-policy.service.ts:120`).
- **A-5 (malformed handling)**: A body the translator can't decode (missing id, unknown event type) → `translate` returns `null`, which the host dead-letters as `undecodable` (`webhook-to-job.handler.ts`). The translator is **total — never throws**.

### Documentation Gaps
- ADR-025 lists the webhook reality (no-retry/5 s) but not the wire shape — expected, since #992 (sandbox) hasn't run. This plan provisions against authored fixtures and flags every gap above.

---

## 6. Proposed Implementation Plan

### Phase 1 — Provisional wire-shape reconciliation point
**Goal**: One file owns every #992-unknown about the Erli webhook wire, so confirming the spike later is a single-file edit.

1. **Create `erli-webhook.types.ts`**
   - **File**: `libs/integrations/erli/src/domain/types/erli-webhook.types.ts`
   - **Action**: Define, all tagged `#992-PROVISIONAL`:
     - `ErliWebhookEventTypeValues = ['orderCreated', 'orderStatusChanged'] as const;` + `type ErliWebhookEventType` (as-const union, per engineering standards).
     - `ErliWebhookBody` interface — the id-only shape (e.g. `{ orderId: string }` — exact field name provisional).
     - Header/field names for the event-type discriminator and (if any) order-id location.
     - Const for the provisional signature header names IF a native decoder is anticipated (else omit).
   - **Acceptance**: File compiles; a header comment cites #992 and lists exactly which symbols flip when the spike confirms.
   - **Dependencies**: none.

### Phase 2 — Translator (the core of #996)
**Goal**: Decode Erli's neutral `InboundWebhookEvent` into a `CanonicalInboundEvent { domain: 'order' }`.

2. **Create `ErliWebhookEventTranslator`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-webhook-event-translator.adapter.ts`
   - **Action**: `class ErliWebhookEventTranslator implements WebhookEventTranslatorPort`. `translate(event: InboundWebhookEvent): CanonicalInboundEvent | null`:
     - **Defensively narrow `event.payload` / `externalId` with type guards** — the id originates from an untrusted body (especially in the native-decoder path). Treat `event.payload` as `unknown`; guard that the order-id field is a non-empty string before use; reject (`null`) anything that fails the guard.
     - Read the event-type discriminator + order id from `event` (mapping from `erli-webhook.types.ts`).
     - Map `orderCreated → 'created'`, `orderStatusChanged → 'updated'`, unknown → `'updated'` (A-4).
     - Return `{ domain: 'order', externalId: <orderId>, eventType, occurredAt: event.occurredAt, payload: event.payload }`.
     - Missing/non-string order id / unrecognized objectType → `return null` (A-5). **Pure + total — no DI, no I/O, never throws.**
   - **Acceptance**: Both event types → correct `CanonicalInboundEvent`; malformed → `null`. Mirrors `prestashop-webhook-event-translator.adapter.ts:26-58`.
   - **Dependencies**: Phase 1.

3. **Register the translator in `register(host)`**
   - **File**: `libs/integrations/erli/src/erli-plugin.ts` (inside `register`, `:63-95`)
   - **Action**: `host.webhookEventTranslatorRegistry.register(ERLI_ADAPTER_KEY, new ErliWebhookEventTranslator());` with a comment citing ADR-015 / #996 and the #992-provisional note.
   - **Acceptance**: After boot, `WebhookToJobHandler` resolves the Erli translator by `adapterKey='erli.shopapi.v1'`. Once a decoder accepts an Erli event (the host default rejects 100% of real Erli traffic — see A-2 — so this is **#992-gated** in production), the translated `domain:'order'` event routes to `marketplace.order.sync`. The registration itself is verified at boot/unit level now; the end-to-end POST → job path is gated on the #992 native decoder.
   - **Dependencies**: Phase 2 step 2.

### Phase 3 — Provisioning (manual-documented default)
**Goal**: A `WebhookProvisioningPort` adapter that, absent confirmed API registration, documents the manual seller-panel step and reports it via `warning`.

4. **Create `ErliWebhookProvisioningAdapter`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-webhook-provisioning.adapter.ts`
   - **Action**: `class ErliWebhookProvisioningAdapter implements WebhookProvisioningPort`. `install(connectionId, actorUserId?)`:
     - Perform **no remote call** (Erli API registration is #992-unconfirmed).
     - Log an operator-actionable message describing the manual seller-panel setup (callback URL `/<host>/webhooks/erli/:connectionId`). **NO secret in logs**: the message references *where* to obtain/rotate the shared secret (the existing rotate API) — it must never embed the secret value.
     - Return `{ webhooksConfigured: false, testPingTriggered: false, warning: 'manual-setup-required' }` (`webhook-provisioning.types.ts:15-38`).
     - Header comment: flags the **API-provisioner as the #992 follow-up** and explains why a no-op is the safe default (guessing an API risks pushing wrong config).
   - **Acceptance**: `install` returns the documented-manual result with `webhooksConfigured: false`; `ConnectionService.installWebhooks` keys off the `webhooksConfigured` boolean — a `false` result is surfaced as the manual-setup `warning` to the operator, **never reported as success**. No secret material in any log line. Mirrors PrestaShop's result shape (`prestashop-webhook-provisioning.adapter.ts:142-160`) without its remote push.
   - **Dependencies**: none (parallel to Phase 2).

5. **Register the provisioner in `register(host)`**
   - **File**: `libs/integrations/erli/src/erli-plugin.ts`
   - **Action**: `host.webhookProvisioningRegistry.register(ERLI_ADAPTER_KEY, new ErliWebhookProvisioningAdapter());` (no plugin-specific deps needed → instantiate inline, unlike PrestaShop which injects a Nest provider).
   - **Acceptance**: `ConnectionService.installWebhooks` for an Erli connection resolves this provisioner by `adapterKey`, keys off the returned `webhooksConfigured` boolean (here `false`), and returns the manual-setup warning (instead of 400 "no provisioner") — without treating the `false` result as success.
   - **Dependencies**: Phase 3 step 4.

### Phase 4 — Native decoder (ADR-021) — the LOAD-BEARING #992 follow-up that makes the webhook path functional
**Goal**: Authenticate + decode Erli's native (non-OL) body at the controller. Until this lands, the host's fail-closed OL-HMAC default rejects 100% of real Erli webhooks (A-2) and the #993 poll is the only working ingestion path. Hard-#992-blocked (signature scheme, header names, body shape all unconfirmed) — framed here, built under #992. **Not optional polish.**

6. **(#992) Create `ErliInboundWebhookDecoderAdapter`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-inbound-webhook-decoder.adapter.ts`
   - **Action**: `implements InboundWebhookDecoderPort` (`inbound-webhook-decoder.port.ts:26-45`). `verify(...)` → `{ ok, timestampMs }` over Erli's signature scheme; `extractEnvelope(...)` → `route|ignore|reject` building an `InboundWebhookEnvelope`. All field/header/scheme constants from `erli-webhook.types.ts`. Mirror `inpost-inbound-webhook-decoder.adapter.ts`.
   - **Acceptance**:
     - A native Erli body verifies + extracts to the neutral envelope; unknown topics → `ignore`; malformed → `reject`.
     - **`verify` MUST return a `timestampMs` sourced from a signature-COVERED field** — otherwise replay protection silently no-ops for Erli (mirror InPost). If Erli's signature does not cover a timestamp, the decoder must reject (no usable replay window) rather than return a forgeable timestamp.
     - **The dedup `eventId` MUST be derived deterministically from immutable event fields** (e.g. a stable hash of the external order id + an immutable event discriminator/occurredAt) — never a per-delivery nonce — so the host Postgres+Redis dedup gate collapses redundant deliveries of the same event.
   - **Dependencies**: Phase 1; **#992-blocked** (Erli signature/header/body unconfirmed).

7. **(#992) Register the decoder**
   - **File**: `libs/integrations/erli/src/erli-plugin.ts`
   - **Action**: `host.inboundWebhookDecoderRegistry.register('erli', new ErliInboundWebhookDecoderAdapter());` — keyed by **`provider`** (`'erli'`), not `adapterKey` (ADR-021:34).
   - **Acceptance**: Erli webhooks at `/webhooks/erli/:connectionId` authenticate via the Erli decoder and reach the translator — the point at which the webhook path becomes functional.
   - **Dependencies**: Phase 4 step 6.

### Phase 5 — Documentation
8. **Document the manual seller-panel setup + #992 follow-ups**
   - **File**: `docs/architecture/adrs/025-erli-marketplace-adapter.md` (append a short "Inbound webhooks" note) and/or the Erli connection setup doc; add a `#992` follow-up bullet for the API provisioner + native-decoder decision.
   - **Acceptance**: An operator can configure Erli webhooks manually; the API-registration follow-up is tracked against #992.
   - **Dependencies**: Phases 2-4.

### Implementation Details
**New Components**:
- **Domain (types)**: `erli-webhook.types.ts` (`#992-PROVISIONAL`).
- **Infrastructure (adapters)**: `ErliWebhookEventTranslator`, `ErliWebhookProvisioningAdapter` (now); `ErliInboundWebhookDecoderAdapter` (load-bearing #992 follow-up).
- **Plugin wiring**: 2 `register(host)` lines now in `erli-plugin.ts` (translator + provisioner); a third (decoder) under #992.

**Configuration Changes**: none required for the default path. (If a native decoder lands, it reuses the existing per-connection webhook secret via `WebhookSecretProviderPort` — no new env.)

**Database Migrations**: none — dedup reuses `webhook_deliveries` (ADR-021:62); no schema change.

**Events**:
- **Consumed (inbound)**: Erli `orderCreated` / `orderStatusChanged` webhooks → host pipeline → `InboundWebhookEvent` → `ErliWebhookEventTranslator` → `CanonicalInboundEvent`.
- **Emitted (enqueued)**: `marketplace.order.sync` job (via `InboundRoutingPolicy`, gated on `OrderSource` which Erli's manifest already declares — `erli-plugin.ts:53`).

**Error Handling**:
- Translator returns `null` on undecodable input → host dead-letters (`undecodable`). No new domain exceptions.
- Provisioner returns a `warning`-bearing result rather than throwing for the manual-setup case (it's expected, not an error).
- Decoder (if built) is total — `reject` for malformed, `ignore` for unhandled topics, never throws (ADR-021).

**Retry / Idempotency**: The webhook only triggers; the `marketplace.order.sync` job converges on `syncOrderFromSource`'s externalOrderId-keyed upsert (`order-ingestion.service.ts:186-299`), the same point the #993 inbox poll hits. Webhook + poll for the same order ⇒ one order record. Host-level dedup (`webhook_deliveries` Postgres gate + Redis) collapses duplicate *deliveries* of the same event (`webhook.service.ts:117-155`).

---

## 7. Alternatives Considered

### Alternative 1: Core routing edit for an Erli-specific order mapping
- **Description**: Add an Erli branch in `InboundRoutingPolicy` / `WebhookToJobHandler`.
- **Why Rejected**: Routing is already generic by `event.domain` (`inbound-routing-policy.service.ts:113`); the dispatcher resolves translators by `adapterKey` from a registry. PrestaShop proves the plugin-only path. A core edit would reintroduce per-platform coupling in the interface layer — the exact thing ADR-015/#900 removed.
- **Trade-off**: none — plugin-only is strictly better.

### Alternative 2: Guess Erli's API webhook-registration and build an API provisioner now
- **Description**: Implement `install` as a real Erli API call to register the callback.
- **Why Rejected**: #992 hasn't confirmed Erli even exposes such an API, nor its shape. Guessing risks pushing wrong config to a live seller account and failing silently (Erli's reconciliation-first posture, ADR-025). A documented-manual no-op is safe and reversible; the API provisioner is a clean #992 follow-up.
- **Trade-off**: Operators do a manual panel step until #992 — acceptable for an MVP marketplace adapter.

### Alternative 3: Build the native `InboundWebhookDecoder` now (guess Erli's signature scheme)
- **Description**: Ship `ErliInboundWebhookDecoderAdapter` in #996 by guessing Erli's signature/header/body shape.
- **Why Rejected**: Erli's signature scheme is #992-unknown. Building it now means *guessing* the scheme, which risks encoding a wrong (and security-relevant) verification path. The host's fail-closed default (ADR-021:37) already 401/400s every unverified body, so **deferring the decoder is safe** (no security hole, no order loss — the #993 poll is authoritative). It is **not** safe to call the decoder optional: without it the webhook path is **non-functional** (the default rejects 100% of real Erli traffic). The decoder is therefore the **load-bearing #992 follow-up** (Phase 4), deferred only because its inputs are unconfirmed — not because it is unnecessary.
- **Trade-off**: Until #992 lands the decoder, the webhook path is non-functional and the poll carries all ingestion. Once #992 confirms the scheme, the decoder is added — isolated, no rework of the translator.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Plugin-only; core untouched. Routing already generic (`inbound-routing-policy.service.ts:113`); translator/provisioner resolved from host-bag registries by `adapterKey` (`webhook-event-translator-registry.service.ts:21-36`; `host-services.ts` webhook fields).
- ✅ Mirrors the PrestaShop reference exactly (`prestashop-plugin.ts:100-109`, `prestashop-webhook-event-translator.adapter.ts`, `prestashop-webhook-provisioning.adapter.ts`).
- ✅ Trigger-not-truth + reconciliation backstop (ADR-025:19, ADR-015) — webhook triggers, poll reconciles, both converge on `syncOrderFromSource`.

### Naming Conventions
- ✅ `*.adapter.ts` for adapters implementing ports; `*.types.ts` for the provisional wire types; class names `Erli{Capability}Adapter` / `ErliWebhookEventTranslator` (matches `PrestashopWebhookEventTranslatorAdapter`). `as const` + union for event-type literals.

### Existing Patterns
- ✅ Translator total/pure (returns `null`, never throws) like PrestaShop. Provisioner returns `WebhookProvisioningResult` with `warning`. Decoder (if any) three-state like InPost.

### Risks
- **R-1 (#992 wire-shape drift)**: Real Erli body/event-type differs from fixtures. **Mitigation**: every unknown isolated in `erli-webhook.types.ts`; confirming the spike is a single-file edit + fixture refresh. Translator/registration/tests structurally unaffected.
- **R-2 (signature unknown → webhook path non-functional until #992)**: A real Erli body (native signature + non-OL envelope) is rejected by the host default decoder (401/400) — so the webhook path is **non-functional**, not merely degraded, until the native decoder lands. **Mitigation**: fail-closed is the *intended* provisional posture (ADR-021:37) and guarantees no order loss; the #993 poll is the only working ingestion path meanwhile; the **load-bearing** Phase 4 decoder (#992) makes the webhook path functional once Erli's scheme is confirmed.
- **R-3 (operator confusion on manual provisioning)**: `warning: 'manual-setup-required'` could read as a failure. **Mitigation**: clear operator log + doc step (Phase 5); poll keeps orders flowing regardless.
- **R-4 (no provisioner → 400 today)**: Without the provisioner registration, `ConnectionService.installWebhooks` 400s for Erli. **Mitigation**: Phase 3 registers it; the manual result is well-formed. Note `ConnectionService.installWebhooks` must key off the `webhooksConfigured` boolean — a `false` result is surfaced as a manual-setup warning, never reported as success.
- **R-5 (unprovisioned webhook secret)**: An Erli connection with no provisioned webhook secret → `getSecret` throws → the host maps to a 4xx; the webhook is **fail-closed, never processed** (no order loss; #993 poll authoritative). **Mitigation**: add a test asserting the unprovisioned path is rejected 4xx and that **no secret material is logged** on that path. The operator-actionable log references *where* to provision/rotate the secret (the existing rotate API), never embeds it.

### Edge Cases
- **Unknown order event type** → translator maps to `'updated'` (safe re-pull, A-4).
- **Missing order id / unknown objectType** → `translate` returns `null` → host dead-letters `undecodable`.
- **Duplicate webhook deliveries** → collapsed by the host Postgres+Redis dedup gate (`webhook.service.ts:117-155`).
- **Webhook + poll race for the same order** → idempotent upsert keyed on `(externalOrderId, connectionId)` ⇒ one record.
- **Unprovisioned webhook secret** → `getSecret` throws → host returns 4xx, fail-closed (never processed); no secret material logged (R-5).

### Backward Compatibility
- ✅ No core change; PrestaShop/InPost inbound paths untouched. New `adapterKey`-keyed registrations are additive. No migration, no DTO change.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests (over authored fixtures — `#992-PROVISIONAL`)
- **Translator** — `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-webhook-event-translator.adapter.spec.ts`:
  - `orderCreated` id-only body → `{ domain: 'order', externalId, eventType: 'created' }`.
  - `orderStatusChanged` → `eventType: 'updated'`.
  - Unknown order event type → `eventType: 'updated'` (safe re-pull).
  - Missing order id / unrecognized event → returns `null` (dead-letter); never throws.
  - `occurredAt` / `payload` passthrough.
- **Provisioner** — `.../__tests__/erli-webhook-provisioning.adapter.spec.ts`:
  - `install(connectionId)` makes no remote call and returns `{ webhooksConfigured: false, testPingTriggered: false, warning: 'manual-setup-required' }`.
  - The operator-actionable log references *where* to provision/rotate the secret (the existing rotate API) and **never embeds the secret value**.
- **Unprovisioned-secret path** (R-5) — assert the unprovisioned webhook path is rejected 4xx (fail-closed, never processed) and **no secret material is logged**. (Placed at whichever seam owns `getSecret`; if the Erli decoder is not yet built, asserted as the host fail-closed default behaviour for an Erli connection lacking a secret.)
- **Decoder (#992 follow-up — Phase 4)** — `.../__tests__/erli-inbound-webhook-decoder.adapter.spec.ts`: `verify` ok/not-ok over a fixture signature, asserting `timestampMs` comes from a signature-covered field (reject when absent); `extractEnvelope` `route`/`ignore`/`reject` with a deterministic `eventId` from immutable event fields. (Written under #992 once Erli's scheme is confirmed.)

### Integration Tests
- None added in #996 (inbound pipeline int-specs already exist; per resource-constrained test prefs, unit-only here). A future int-spec can pin the Erli round-trip once #992 confirms the wire shape.

### Mocking Strategy
- Translator/provisioner are pure / DI-free → no mocks; assert directly on authored fixtures (matches `prestashop-webhook-event-translator` and `inpost-inbound-webhook-decoder` spec style).

### Acceptance Criteria
- [ ] **AC-1 (testable now)**: `ErliWebhookEventTranslator` maps an id-only `orderCreated` / `orderStatusChanged` event → `CanonicalInboundEvent { domain: 'order', eventType: 'created' | 'updated' }` (unit-tested). **End-to-end webhook ingestion** (a real Erli POST reaching `marketplace.order.sync`) is **gated on the #992 native decoder** — the host's fail-closed OL-HMAC default rejects 100% of real Erli traffic until then, so this criterion is **#992-gated** and not achievable in #996.
- [ ] `ErliWebhookEventTranslator` registered at `erli.shopapi.v1`; routing to `marketplace.order.sync` is reachable with no core change *once a decoder accepts the event* (#992).
- [ ] Both event types translate correctly; malformed → `null` (dead-letter), never throws.
- [ ] `ErliWebhookProvisioningAdapter` registered; `installWebhooks` keys off `webhooksConfigured` and returns the documented-manual `warning` (no 400; a `false` result is not reported as success).
- [ ] An Erli connection with no provisioned webhook secret is rejected 4xx (fail-closed) and **no secret material is logged** (asserted by test — see §8 R-5).
- [ ] All Erli webhook unknowns isolated in `erli-webhook.types.ts`, tagged `#992-PROVISIONAL`.
- [ ] Idempotent convergence with #993 documented; webhook + poll ⇒ one order (once the webhook path is functional, #992).
- [ ] Signature/auth provisional posture documented (default OL-HMAC = fail-closed safety net, NOT a functional path; native decoder = load-bearing Phase 4 / #992 follow-up).
- [ ] `pnpm lint` + `pnpm type-check` + scoped `pnpm test` (Erli specs) pass.

---

## 10. Alignment Checklist
- [x] Follows hexagonal architecture (Integration implements core ports; core untouched)
- [x] Respects CORE vs Integration boundaries (plugin-only; routing already generic)
- [x] Uses existing patterns (PrestaShop translator/provisioner, InPost decoder, host-bag registries)
- [x] Idempotency considered (externalOrderId-keyed upsert; webhook+poll convergence; host dedup gate)
- [x] Event-driven patterns used (inbound webhook → translate → route → job)
- [x] Rate limits & retries addressed (no-retry/5 s webhook = trigger only; poll backstop authoritative)
- [x] Error handling comprehensive (translator total/null, provisioner warning, decoder three-state)
- [x] Testing strategy complete (unit over authored fixtures; #992-provisional flagged)
- [x] Naming conventions followed (`*.adapter.ts`, `*.types.ts`, `as const` unions)
- [x] File structure matches standards (`infrastructure/adapters/`, `domain/types/`)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Central Question — Answer

**#996 is plugin-only, and what it ships now is fail-safe scaffolding — the functional webhook path is #992-blocked.** No core routing/controller change is needed:
- `InboundRoutingPolicy` already maps `domain: 'order'` → `marketplace.order.sync` generically (`inbound-routing-policy.service.ts:113-128`), keyed purely on the neutral `CanonicalInboundEvent.domain` — no platform/adapterKey awareness.
- `WebhookToJobHandler` resolves the translator from the host-bag registry by `adapterKey`; `ConnectionService.installWebhooks` resolves the provisioner the same way.
- Erli needs only: a translator emitting `domain: 'order'`, a manual-documented provisioner (both shipped now, unit-tested), and the **load-bearing** native decoder (#992) — all registered in `createErliPlugin().register(host)`. The webhook controller stays a thin dispatcher with zero Erli-specific code.
- **But**: the host's fail-closed OL-HMAC default rejects 100% of real Erli webhooks, so until the #992 native decoder lands the webhook path is non-functional and the #993 poll is the only working ingestion path. #996 delivers mergeable, unit-tested scaffolding; #992 makes it functional.

## Related Documentation
- [Architecture Overview](../architecture-overview.md) § Webhook Ingestion Flow
- [ADR-015: Inbound event routing, capability-translated](../architecture/adrs/015-inbound-event-routing-capability-translated.md)
- [ADR-021: Third-party-native inbound webhook ingestion](../architecture/adrs/021-third-party-native-inbound-webhook-ingestion.md)
- [ADR-025: Erli marketplace adapter](../architecture/adrs/025-erli-marketplace-adapter.md)
- [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md)
