# Implementation Plan — #768 InPost shipment-status webhook ingestion (trigger-based, single PR)

**Issue:** #768 · **Parent:** #727 (spec §3.2, AC-8/AC-9) · **Branch:** `768-inpost-shipment-status-webhook`
**Layers:** Interface (third-party-native webhook ingress seam) + CORE (inbound `shipment` domain + targeted refresh) + Integration (InPost) + Worker + FE (runbook) + ADR.
**Shape:** **one PR** (one coherent vertical slice, `Closes #768`, end-to-end int-test). The ingress seam is a clean internal module so it *could* be peeled into a precursor PR **only if** review or diff size demands — not pre-split on spec.

## 1. Goal

InPost pushes shipment-tracking webhooks; OL ingests them as a **low-latency trigger** (OL's webhook=trigger doctrine, #900/#904): verify InPost's signature → confirm `Shipment.Tracking` topic → enqueue a **parcel-targeted** shipment refresh that re-reads authoritative status via the InPost adapter's `getTracking` and propagates via #838 `ShipmentStatusSyncService`. **No payload-status parsing** (sandbox-gated catalogue, OQ-B3 — deferred; the re-read is authoritative).

**Re-scoped** off the issue's 2026-05-17 "bespoke handler parses status + propagates directly" wording (predated #838 + #900/ADR-015). **Decisions this session:** trigger-based; host ingress generalized via per-provider registries (approach **(a)**), not a dedicated InPost controller (b); single PR.

**Non-goals:** payload-of-record fast-path; self-service webhook provisioning (manual InPost-team contact — runbook only).

## 2. Research findings (live contracts)

- **The shared `/webhooks/:provider/:connectionId` controller is an OL-first-party-envelope ingress, not truly generic.** It hard-codes *both*: (i) OL-HMAC (`WebhookAuthService`: `HMAC-SHA256(secret,"{ts}.{rawBody}")→sha256=<hex>`, headers `X-OpenLinker-*`), and (ii) an OL body envelope — `@Body() WebhookRequestDto` (`webhook.controller.ts:59`) with **required** `eventId`, `eventType` `^[a-z]+\.[a-z_]+$`, `object.{type,externalId}`, `occurredAt`. NestJS ValidationPipe ⇒ a non-OL body (InPost native) **400s before the handler runs**. Its only client today is OL's own PS module. **InPost is the first third-party-native inbound webhook** → needs per-provider seams on *both* axes. `req.rawBody` is already available (`webhook.controller.ts:64`).
- **Reuse confirmed:** `ShipmentRepositoryPort.findByProviderShipmentId` exists (`shipment-repository.port.ts:60`); `WebhookEventTranslatorPort`+registry, `WebhookSecretProviderPort`+`WebhookSecretService` (per-connection secret `webhook-secret:<connectionId>`, rotatable), `webhook_deliveries` dedup + `OL_WEBHOOK_SKEW_WINDOW_MS` replay, `events.inbound.webhooks` bus + `WebhookToJobHandler`, `InboundRoutingPolicy` + capability gating, `ShipmentStatusSyncService` per-shipment logic — all reusable.
- **Genuinely new:** per-provider signature verifier + envelope/eventId extractor seams; `shipment` inbound domain; `marketplace.shipment.syncByExternalId` job; InPost adapters; FE runbook. `WebhookSignatureVerifier*` absent; `marketplace.shipment.syncByExternalId` absent.
- `InboundEventDomainValues` is closed `order|inventory|product`; the only exhaustive consumer is `InboundRoutingPolicy.resolveRoute`'s `default: never`. Gate uses `ShippingProviderManager` (exists) — **do not invent a `tracking-webhooks` CoreCapability** (spec label only).

## 3. Steps (one PR; internal modules A→F)

### ADR-021 — third-party-native inbound webhook ingestion
`docs/architecture/adrs/021-third-party-native-inbound-webhook-ingestion.md`: records that the webhook controller becomes provider-agnostic via a per-provider decoder registry; OL-HMAC + the `WebhookRequestDto` envelope become the **OL-module provider's registered default strategy**, not hard-coded; third parties (InPost now, DPD #965 next) register their own. **Decision: one combined `InboundWebhookDecoderPort` (`verify()` + `extractEnvelope()`)** over two single-purpose registries — cohesion, atomic registration (no half-configured provider), one `HostServices` handle. Upstream complement to **ADR-015** (which covers native-event → `CanonicalInboundEvent` → routing *after* ingest); cross-reference it.

### A — host ingress seam (the load-bearing module; keep cohesive/peelable)
| # | File | Change | AC |
|---|---|---|---|
| A1 | `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts` *(new)* + `*.types.ts` + registry + token | **One combined port** (ADR-021), **keyed by `provider`**: `verify(input:{rawBody:Buffer;headers;secret:string}):{ok:boolean;timestampMs?:number}` + `extractEnvelope(rawBody:Buffer, headers): DecodeResult`. `DecodeResult` = discriminated union `{action:'route';envelope} \| {action:'ignore';reason} \| {action:'reject';reason}` (plain union on `action`, mirroring `RoutingOutcome.status` — not the `as const`+Values pattern; it's an internal control-flow discriminant). `InboundWebhookEnvelope` = `Omit<InboundWebhookEvent,'provider'|'connectionId'|'receivedAt'>` — in a `*.types.ts`, not inline. Registry mirrors `WebhookEventTranslatorRegistryService`. **Export `InboundWebhookDecoderPort` / `InboundWebhookEnvelope` / `DecodeResult` from the `@openlinker/core/integrations` top-level barrel and the registry token from `integrations.tokens.ts`** (Symbol DI Re-export Convention) so the plugin imports them via the barrel. Add the registry handle to `HostServices` in `@openlinker/plugin-sdk` (mirrors the translator-registry handle). | additive; atomic registration |
| A2 | `WebhookService.processWebhook` / `webhook.controller.ts` + `apps/api/.../default-webhook-decoder.ts` *(new host default)* | controller takes the **raw body** (drop eager `@Body() WebhookRequestDto` validation on the generic route); resolve the per-**`provider`** decoder; **fall back to a host `DefaultWebhookDecoder`** (verify = current OL-HMAC; extract = construct+`validate()` `WebhookRequestDto`, same pipe options) — a host class registered in the `apps/api` webhooks module as the fallback, **not** via a plugin `register(host)`. Pipeline order **verify → replay(decoder `timestampMs`) → extract → dedup → publish**; the controller (interface layer) maps `route`→publish+202, `ignore`→202 no-publish, `reject`→400. Preserve the **status contract** (202/401/400), not the exact 400 body. | OL default status contract identical; per-provider path used when registered; bad sig → 401 |
| A3 | specs + **pin existing PS webhook int-spec** | add/confirm a PrestaShop-webhook int-spec asserting the current 202/401/400 **status** contract **before** refactor, green after — **incl. reordered-path regressions: stale-but-correctly-signed OL timestamp → 401 (replay), missing timestamp → 401**; new InPost-style path verifies + extracts; bad sig/replay → 401, malformed → 400, unhandled topic → 202 ignore. | green; PS contract unchanged |
| A4 | observability | structured log/counter on the `ignore` (benign: unhandled topic / setup ping) vs `reject`/401 (malformed / misconfig / attack) branches — benign third-party noise must be distinguishable from real failure (ADR-015 invariant 4). | both branches observable |

### B — core: `shipment` inbound domain + targeted refresh job
| # | File | Change |
|---|---|---|
| B1 | `canonical-inbound-event.types.ts` | add `'shipment'` to `InboundEventDomainValues`. |
| B2 | `marketplace-job-payloads.types.ts` + `sync-job.types.ts` | `marketplace.shipment.syncByExternalId` + `MarketplaceShipmentSyncByExternalIdPayloadV1 {schemaVersion:1; externalId:string}` (parcel/providerShipmentId). |
| B3 | `inbound-routing-policy.service.ts` | `case 'shipment'` → `{jobType, requiredCapability:'ShippingProviderManager', payload:{schemaVersion:1, externalId}}` (capability-gated like siblings). |
| B4 | `ShipmentStatusSyncService` (+interface) | extract per-shipment body of `sync()` into `syncOneByProviderShipmentId(connectionId, providerShipmentId)` (reuse `findByProviderShipmentId` → `getTracking` → patch → propagate); paged `sync()` calls it per row (no behavior change). **Connection-scope:** assert the resolved shipment's `connectionId` matches the job's (job carries connectionId at `SyncJobRequest` level; payload carries `externalId`) — guards cross-connection refresh under multi-account (#727 v2). |
| B5 | worker `marketplace-shipment-sync-by-external-id.handler.ts` *(new)* + registration + `sync-worker.module.ts` | thin delegate → `syncOneByProviderShipmentId`; wrap in `SyncJobExecutionError`. |

### C — InPost plugin
| # | File | Change |
|---|---|---|
| C1 | `inpost-inbound-webhook-decoder.adapter.ts` *(new)* → `InpostInboundWebhookDecoderAdapter` | implements the combined `InboundWebhookDecoderPort`: **verify** = base64 HMAC-SHA256 over `"{x-inpost-timestamp}.{rawBody}"`, header `x-inpost-signature`, `timingSafeEqual`, returns the parsed `x-inpost-timestamp` as `timestampMs`; **extractEnvelope** = `x-inpost-topic==='Shipment.Tracking'` → `{action:'route', envelope:{eventId (stable from body; fallback hash parcel-id+event-ts), objectType:'shipment', externalId:<parcel id>}}`; setup ping / other known topic → `{action:'ignore'}`; malformed → `{action:'reject'}`. Reads **only the parcel-id field** — no status enum (sandbox-gated). |
| C2 | `inpost-webhook-event-translator.adapter.ts` *(new)* | `objectType 'shipment'` → `{domain:'shipment', externalId}`; else `null`. |
| C3 | `inpost-plugin.ts` `register(host)` | register **decoder by provider `inpost`** + **translator by adapterKey `inpost.shipx.v1`** (translator resolves downstream where adapterKey is known). |

### D — FE connection-settings runbook
InPost platform contribution: webhook URL `{origin}/webhooks/inpost/{connectionId}` + copy affordance + InPost email template + rotate-secret action.

### E — tests + gate
Unit: verifier (valid/invalid/replay), extractor (topic gate, eventId, parcel id, null), routing `shipment` case (+ungated), `syncOneByProviderShipmentId`. **Integration: HMAC-signed InPost fixture → `POST /webhooks/inpost/:id` → dedup → bus → translate → route → job (mock `getTracking`) → shipment updated + propagated** (the end-to-end correctness signal — the reason this is one PR). `pnpm lint`/`type-check`/`test` + affected `test:integration`.

## 4. Risks
- **Host ingress refactor is the principal risk** (security-sensitive, shared). Mitigation: OL-module default strategy preserves prestashop/allegro byte-for-byte; keep A1–A3 a cohesive module behind the registries so it's independently reviewable (and peelable to a precursor PR **only if** the diff/review demands). ADR records the decision.
- `InboundEventDomainValues` widen — additive published-barrel change; sole exhaustive consumer (routing switch) updated in B3.
- New job type — additive; handler registration (B5) required or enqueue has no handler.
- **No ORM/migration** — reuses `webhook_deliveries`.
- **Sandbox-gated payload** — extractor depends only on the parcel-id field + topic; isolate that access + cover with a documented best-guess fixture; the status re-read via `getTracking` is authoritative regardless.
- **eventId determinism** for dedup from InPost's native body — confirm the field; deterministic fallback hash if absent.
