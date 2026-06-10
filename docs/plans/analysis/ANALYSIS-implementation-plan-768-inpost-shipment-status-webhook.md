# Pre-implement analysis — #768 InPost shipment-status webhook ingestion (trigger-based)

> **Re-gate (revised single-PR plan, approach (a)) → ✅ READY.** The revision adds the **inbound envelope/eventId extractor seam (Phase A2)** alongside the signature-verifier seam (A1) — directly closing the only blocker (the controller's rigid OL-envelope `WebhookRequestDto` couldn't ingest InPost's native body). Both seams fall back to an **OL-module default strategy** (current OL-HMAC + `WebhookRequestDto`), so prestashop/allegro stay byte-for-byte unchanged → additive, no contract break. Reuse picture unchanged from below (`findByProviderShipmentId`, translator/secret/dedup/routing all reused). Remaining items are **implementation risks/open-questions, not blockers**: (1) the host ingress refactor is security-sensitive — preserve the default path + keep A1–A3 a cohesive, independently-reviewable module (peelable to a precursor PR only if review/diff demands); (2) InPost `eventId` determinism for dedup (sandbox — deterministic fallback hash); (3) sandbox-gated payload isolated to the parcel-id field (status re-read via `getTracking` is authoritative). Proceed.
>
> The original verdict below is retained for the record.

---

**Original verdict (pre-revision): NEEDS-REVISION** — no reuse collision and no removed/renamed contract symbol, but the plan **under-scopes the host webhook ingress**: the existing `/webhooks/:provider/:connectionId` path assumes an **OL-shaped inbound envelope** (rigid `WebhookRequestDto`) in addition to OL's HMAC scheme. InPost is the first *third-party-native* inbound webhook; its native body + signature can't traverse the current controller. The plan addresses the signature seam (Phase A) but not the envelope/eventId seam. Revise before coding.

Gated on a fresh worktree at `origin/main` (1112ed5c), reusing two Explore architecture maps from planning.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `WebhookSignatureVerifierPort` + registry (Phase A1/A2) | **NEW** | no `WebhookSignatureVerifier*` anywhere; `WebhookAuthService` is hard-coded to OL HMAC |
| `ShipmentRepositoryPort.findByProviderShipmentId` (B4) | **ALREADY EXISTS → reuse** | `shipment-repository.port.ts:60` (plan said "verify/add" — it exists; takes `providerShipmentId` only, no connectionId arg) |
| `'shipment'` in `InboundEventDomainValues` (B1) | **PARTIAL (widen closed union)** | `canonical-inbound-event.types.ts` = `['order','inventory','product']` |
| `marketplace.shipment.syncByExternalId` job + `…PayloadV1` (B2) | **NEW** | grep → none; mirrors `master.product.syncByExternalId` |
| `InboundRoutingPolicy` `shipment` case (B3) | **PARTIAL (extend switch)** | `inbound-routing-policy.service.ts` `resolveRoute` has `default: never` — the case is required for exhaustiveness |
| `ShipmentStatusSyncService.syncOneByProviderShipmentId` (B4) | **PARTIAL (extract from `sync()`)** | per-shipment body exists inside the paged loop |
| worker handler for the new job (B5) | **NEW** | mirrors `MarketplaceShipmentStatusSyncHandler` |
| `WebhookEventTranslatorPort` + registry (C2/C3) | **EXISTS → reuse** | `webhook-event-translator.port.ts`; PrestaShop reference adapter + `register(host)` |
| Per-connection webhook secret + rotation (verifier secret source) | **EXISTS → reuse** | `WebhookSecretProviderPort` / `WebhookSecretService` (ref `webhook-secret:<connectionId>`) |
| Postgres dedup / replay-window | **EXISTS → reuse** | `webhook_deliveries` unique `(provider,connectionId,eventId)`; `OL_WEBHOOK_SKEW_WINDOW_MS` |
| `ShippingProviderManager` capability gate (B3) | **EXISTS → reuse** | already InPost's declared capability — **do not invent a `tracking-webhooks` CoreCapability** (it's a spec label, not in `CoreCapabilityValues`) |
| InPost translator + signature-verifier adapters (C1/C2) | **NEW (plugin)** | none today |
| FE connection-settings runbook (D1) | **NEW (plugin platform contribution)** | — |

## Backward-compat findings

| Surface | Severity | Finding / migration path |
|---|---|---|
| **Webhook ingress envelope (`WebhookRequestDto`)** | **Critical (gap)** | The controller validates a rigid OL envelope (`eventId`, `eventType` `^[a-z]+\.[a-z_]+$`, `object.{type,externalId}`, `occurredAt`) **before** translation. InPost's native body fails this → 400 before verify/translate. The plan's per-provider **signature** seam is insufficient; a per-provider **raw-body + eventId-derivation** path is also required. This is the load-bearing revision. |
| `WebhookAuthService` provider-dispatch (Phase A) | Warning | Additive if the OL-HMAC default stays the fallback; must preserve PrestaShop/Allegro byte-for-byte. Security-sensitive shared path. |
| `InboundEventDomainValues` widen | Warning | Additive to a published `@openlinker/core/integrations` barrel type; the only exhaustive consumer is the routing-policy switch (B3 supplies the case); `RoutingOutcome` union widens safely. |
| New `JobType` + payload | Warning | Additive to `JobTypeValues`; the worker handler-registration must register it (B5) or an enqueued job has no handler at runtime. |
| ORM schema | None | No new column — dedup reuses `webhook_deliveries`. No migration. |
| `check:invariants` | None expected | New core service method keeps `IShipmentStatusSyncService` in sync (service-interface check); plugin imports the new port via the top-level barrel; no new `plugins.ts` entry (InPost already present) → no jest-mapper change. |

## Open questions (must resolve in the revised plan)

1. **Third-party-native ingress (the big one).** Decide the approach: **(a)** generalize the shared controller — per-provider signature verifier **+** per-provider envelope/eventId extraction (translate the *raw* body; derive `eventId` per provider), likely meriting a short ADR ("third-party-native inbound webhook ingestion"); or **(b)** a dedicated InPost webhook controller in the InPost API surface that verifies + derives eventId + publishes to the same `events.inbound.webhooks` bus, leaving the OL-module controller untouched. (a) is more reusable for future carriers (DPD #965); (b) is lower-blast-radius now.
2. **eventId for dedup** from InPost's native body — which field is stable/unique? (sandbox-gated, OQ-B3). Needs a deterministic fallback (e.g. hash of parcel-id + status + timestamp).
3. **Scope/split.** This is M+ across 5 layers. Recommend splitting: **(1)** host third-party-native ingress seam (signature verifier + envelope/eventId) — own PR + ADR; **(2)** core `shipment` inbound-routing + targeted `syncByExternalId` job; **(3)** InPost translator/verifier + FE runbook.
4. **Sandbox-gated payload** — translator reads only the parcel id (avoids the status-enum blocker); isolate that one field access behind a documented best-guess fixture.

## Summary
The trigger-based design is architecturally right and most of it reuses existing seams (translator registry, secret provider, dedup, `findByProviderShipmentId`, `ShipmentStatusSyncService`). But the gate surfaced one thing the plan missed: the shared webhook controller is built for **OL-enveloped** events from OL's own modules, so InPost — the first **third-party-native** inbound webhook — can't traverse it on **either** the signature **or** the body-envelope/eventId axis. Phase A must grow to a full third-party-native ingress seam (or a dedicated InPost controller), ideally with an ADR, and the work should be split into ~3 PRs. **NEEDS-REVISION.**
