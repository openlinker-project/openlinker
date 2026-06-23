# Pre-Implement Readiness Gate — #996 Erli Inbound Webhooks

**Date**: 2026-06-16
**Plan**: `docs/plans/implementation-plan-erli-webhooks.md`
**Branch**: `996-erli-webhooks` (stacked on `995-erli-buyer-identity`)
**Gate type**: read-only readiness

## Verdict: ✅ READY

Plugin-only fail-safe scaffolding: a `WebhookEventTranslator` + a manual `WebhookProvisioning` adapter + provisional types + `register(host)` registration. All seams exist; the core inbound pipeline is provider-agnostic. Zero CORE change; no migration; no contract break. The **functional** webhook path (native decoder) is explicitly #992-blocked and out of #996's scope — correctly framed in the plan after the security re-review.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `erli-webhook-event-translator.adapter.ts` | **NEW** | no erli webhook files exist |
| `erli-webhook-provisioning.adapter.ts` (manual) | **NEW** | — |
| `erli-webhook.types.ts` (#992-provisional) | **NEW** | — |
| `register(host)` translator + provisioner registration | **NEW** (lines in `erli-plugin.ts`) | mirrors `prestashop-plugin.ts` |
| native `ErliInboundWebhookDecoderAdapter` | **OUT OF SCOPE** (#992 follow-up) | — |

## Seam-accuracy findings (confirmed)

| Seam | Status | Evidence |
|---|---|---|
| `WebhookEventTranslatorPort` (`translate→CanonicalInboundEvent\|null`) | exported | `core/integrations/index.ts:30`; port `webhook-event-translator.port.ts:25-32` (review) |
| `CanonicalInboundEvent` (domain/eventType/externalId) | exported | `core/integrations/index.ts:56` |
| `WebhookProvisioningPort` + `WebhookProvisioningResult` | exported | `core/integrations/index.ts:29,54` |
| `InboundWebhookEvent` (objectType/externalId/payload) | exported | `core/integrations/index.ts` (review-confirmed) |
| `HostServices.webhookEventTranslatorRegistry` / `.webhookProvisioningRegistry` | on host bag | `host-services.ts:124, :115` |
| `InboundRoutingPolicyService`: `domain:'order'`→`marketplace.order.sync` (gated `OrderSource`), generic | core, no platform branching | `inbound-routing-policy.service.ts:113-128` (review) |
| `WebhookToJobHandler` thin dispatcher (translator by adapterKey, route, dead-letter) | present | `webhook-to-job.handler.ts:277-312` (review) |
| Default OL-HMAC decoder applies when no per-provider decoder; fail-closes (401) | present | `webhook.service.ts:64,77-82`; `default-webhook-decoder.ts` (review) |
| `ConnectionService.installWebhooks` 400 when no provisioner (manual adapter fixes it) | present | `connection.service.ts:134-139` (review) |
| PrestaShop translator + registration (reference) | present | `prestashop-webhook-event-translator.adapter.ts`, `prestashop-plugin.ts:106-109` |
| Idempotent convergence with #993 poll (externalOrderId upsert + host dedup) | present | `order-ingestion.service.ts:189-206`; `webhook.service.ts:117-136` (review) |
| `ERLI_ADAPTER_KEY` / `platformType='erli'` | `'erli.shopapi.v1'` / `'erli'` | `erli.constants.ts:10`, `erli-plugin.ts:50` |

## Backward-compatibility findings

None. New adapters + registration + provisional types only; CORE untouched.

## Open questions (non-blocking, all #992-blocked, flagged in plan §5)

- Webhook body shape, event-type literal strings, signature/auth scheme, whether Erli offers API webhook-registration, presence of a usable timestamp. All isolated in `erli-webhook.types.ts` + the #992 native-decoder follow-up. The functional end-to-end webhook path is #992-blocked (the default decoder rejects all real Erli traffic — fail-closed-safe; the #993 poll is authoritative until then).
