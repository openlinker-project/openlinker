# Pre-implement Analysis: Erli Inbound Webhook Decoder

**Plan**: `docs/plans/implementation-plan-erli-webhook-decoder.md`  
**Issue**: #996 (decoder gap from PR #1081)  
**Gate run**: 2026-06-25

---

## Verdict: READY

No critical backward-compat breaks. No reuse collisions. All plan assumptions confirmed against the live tree. The only gating uncertainty is the provisional Erli signature scheme (blocked on #992), which the plan explicitly acknowledges and isolates in a single types file — a deliberate design choice, not a plan gap.

---

## Reuse Findings

| Plan artifact | Status | File path |
|---|---|---|
| `ErliInboundWebhookDecoderAdapter` (new class) | **NEW** (confirmed absent) | `libs/integrations/erli/src/infrastructure/adapters/erli-inbound-webhook-decoder.adapter.ts` — does not exist |
| `InboundWebhookDecoderPort` (port to implement) | **ALREADY EXISTS** | `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts` |
| `DecodeResult` (union type) | **ALREADY EXISTS** | Exported from `@openlinker/core/integrations` barrel (`libs/core/src/integrations/index.ts:64`) |
| `WebhookVerifyResult` (type) | **ALREADY EXISTS** | Exported from `@openlinker/core/integrations` barrel (`libs/core/src/integrations/index.ts:63`) |
| `InboundWebhookEnvelope` (type) | **ALREADY EXISTS** | Exported from `@openlinker/core/integrations` barrel (`libs/core/src/integrations/index.ts:61`) |
| `InboundWebhookDecoderRegistryService` | **ALREADY EXISTS** | `libs/core/src/integrations/infrastructure/adapters/inbound-webhook-decoder-registry.service.ts` |
| `host.inboundWebhookDecoderRegistry` (HostServices field) | **ALREADY EXISTS** | `libs/plugin-sdk/src/host-services.ts:134` |
| `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` (new constant) | **NEW** (confirmed absent) | To be added to `libs/integrations/erli/src/infrastructure/adapters/erli-webhook.types.ts` |
| `ERLI_WEBHOOK_EVENT_TYPE_FIELD` (new constant) | **NEW** (confirmed absent) | To be added to `libs/integrations/erli/src/infrastructure/adapters/erli-webhook.types.ts` |
| Decoder registration in `erli-plugin.ts` | **NEW** (confirmed absent) | `libs/integrations/erli/src/erli-plugin.ts` lines 96-105 have translator but no decoder registration |
| `erli-inbound-webhook-decoder.adapter.spec.ts` | **NEW** (confirmed absent) | `libs/integrations/erli/src/infrastructure/adapters/__tests__/` — directory exists, file does not |

Reference pattern (InPost): `InpostInboundWebhookDecoderAdapter` at `libs/integrations/inpost/src/infrastructure/adapters/inpost-inbound-webhook-decoder.adapter.ts` and its registration at `libs/integrations/inpost/src/inpost-plugin.ts:67-70` are a direct structural model for the Erli implementation.

---

## Backward-Compatibility Findings

### Critical issues

None.

### Warnings

| Surface | Finding | Severity |
|---|---|---|
| `erli-webhook.types.ts` barrel isolation | File is **not** exported from `libs/integrations/erli/src/index.ts`. The plan's two new constants are purely additive to an internal file. No published surface is touched. | OK — no action needed |
| `erli-plugin.ts` | One `import` and one `register()` call are added. No existing symbol removed or reordered. | OK — no action needed |
| Host replay-window check bypassed | `verify()` returns `{ ok: true }` without `timestampMs` because Erli may not send a signed timestamp (#992-PROVISIONAL). The host's `±120 s` replay-window check only fires when `timestampMs` is present — its absence silently disables it for Erli. Acceptable under ADR-025 (inbox poll is authoritative backstop), but should be revisited once #992 confirms Erli's timestamp header, if any. | Warning — non-blocking; noted in plan |
| `check:invariants` | Plan imports only `@openlinker/core/integrations` top-level barrel — no deep-path violations. `node:crypto` import pattern already present in the Erli package (`erli-http-client.ts:27`). No cross-context boundary issues. | OK |
| ORM / migrations | No ORM entity or schema change. No migration needed. | OK |

---

## Open Questions

1. **#992-PROVISIONAL — Erli signature scheme.** The plan's `verify()` logic assumes Erli echoes back the provisioned `accessToken` verbatim in an `x-access-token` header (token-echo comparison, `timingSafeEqual`). This is inferred from a provisioner comment ("Erli echoes back"), not confirmed documentation. Once sandbox access is available (#992), the header name and comparison logic must be verified before the adapter goes live. All provisional assumptions are isolated in `erli-webhook.types.ts` (two named constants), making the confirmation edit a single-file change.

2. **#992-PROVISIONAL — Event type field location.** The plan assumes the event type discriminator is a body field (name stored as `ERLI_WEBHOOK_EVENT_TYPE_FIELD = 'type'`). If Erli uses a header instead (as InPost does with `x-inpost-topic`), `extractEnvelope` needs one targeted adjustment. The types isolation contains this.

3. **`ErliWebhookEventTranslator` reads `event.externalId` first.** The translator's `resolveExternalId` prefers `event.externalId`, falling back to `event.payload.orderId`. The plan's decoder sets both, so there is no inconsistency. Confirmed against `erli-webhook-event-translator.adapter.ts:82-93`.

4. **Dedup key quality.** The deterministic `erli-{sha256(orderId:eventType).slice(0,32)}` fallback is consistent with the InPost pattern and provides sufficient dedup for at-most-once delivery given the inbox-poll backstop. No Postgres `uq_webhook_deliveries_event_key` collision risk from a content-addressed key.
