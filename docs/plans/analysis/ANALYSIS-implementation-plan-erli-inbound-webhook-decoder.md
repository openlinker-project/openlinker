# Pre-Implementation Readiness Gate: Erli Inbound Webhook Decoder (#1145)

**Date**: 2026-06-23
**Plan**: `docs/plans/implementation-plan-erli-inbound-webhook-decoder.md`
**Branch**: `1145-erli-inbound-webhook-decoder` (stacked on #1081 / `996-erli-webhooks`)
**Gate type**: read-only — reuse audit + backward-compatibility check. No code/plan edited.

---

## Verdict

**Structural: `READY`** — no reuse collisions, no contract-surface breaks. Every artifact the plan assumes pre-exists was confirmed in the live tree; the only net-new file is the decoder adapter + its spec.

**Operational: `GO-with-scaffolding-only`** — implementation can land the full structure (adapter skeleton, registration, unit tests against a fixture-signed scheme), but `verify()` **cannot reach a shippable state** until the plan's BLOCKING Phase 0 sandbox spike confirms Erli's real delivery-time auth scheme (#992). Shipping `verify()` blind risks false-reject (status quo) or false-accept (security hole). This is an Open Question, not a structural defect — hence `READY` on the gate's own taxonomy, with the spike called out below.

---

## Reuse findings (Phase B)

| Plan artifact | Classification | Evidence |
|---|---|---|
| `ErliInboundWebhookDecoderAdapter` (+ spec) | **NEW (confirmed absent)** | `ls libs/integrations/erli/src/infrastructure/adapters/` → no `*decoder*`/`*inbound*` file |
| `InboundWebhookDecoderPort` | **ALREADY EXISTS → reuse** | `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts` |
| `DecodeResult` / `WebhookVerifyResult` / `InboundWebhookEnvelope` types | **ALREADY EXISTS → reuse** | `libs/core/src/integrations/domain/types/inbound-webhook-decoder.types.ts` |
| Decoder registry | **ALREADY EXISTS → reuse** | `libs/core/src/integrations/infrastructure/adapters/inbound-webhook-decoder-registry.service.ts`; exposed as `host.inboundWebhookDecoderRegistry` (`libs/plugin-sdk/src/host-services.ts:134`) |
| Secret-retrieval seam | **ALREADY EXISTS → reuse** | `WebhookSecretProviderPort.getSecret(provider, connectionId)` (`webhook-secret-provider.port.ts:37`); host calls it then passes `secret` into `verify()` — decoder needs no DI |
| Receive pipeline | **ALREADY EXISTS → reuse** | `webhook.service.ts:64` `decoderRegistry.get(provider) ?? defaultDecoder` → `:76` `verify` → `:89` `extractEnvelope` — exactly as the plan assumes |
| InPost precedent (template) | **EXISTS → follow** | adapter + spec both present in `libs/integrations/inpost/.../adapters/` |
| `erli-webhook.types.ts` constants | **PARTIAL (extend)** | file exists; plan adds confirmed header/field-name constants (additive) |
| `ErliWebhookEventTranslator` | **EXISTS → reuse** | already registered at `erli-plugin.ts:102` under `ERLI_ADAPTER_KEY` |
| Port / token / ORM / migration / DTO / capability | **NONE created** | plan adds no new CORE port, Symbol token, ORM entity, migration, controller, DTO, or capability |

No artifact the plan marks "new" already exists; no artifact it assumes exists is missing.

## Backward-compatibility findings (Phase C)

| Surface | Result |
|---|---|
| Top-level barrels (`@openlinker/core/integrations`) | **No change** — decoder consumes existing exports; adds nothing to the barrel |
| Port method signatures | **No change** — implements `InboundWebhookDecoderPort` as-is |
| DTO shapes | **No change** |
| Symbol tokens | **No change** |
| ORM schema / migrations | **None** — no persistence change |
| `erli-plugin.ts` `register()` | **Additive only** — new `host.inboundWebhookDecoderRegistry.register('erli', …)` line beside the existing translator registration (`:102`). Registers by `platformType` (`'erli'`, `:51`), NOT `ERLI_ADAPTER_KEY` — correct per ADR-021 |
| `check:invariants` | **No expected trip** — decoder lives in `libs/integrations/**`, imports the port via the `@openlinker/core/integrations` top-level barrel (no deep import); no cross-context or service-interface rule applies to a pure adapter |

**Intended behavior change (not a break):** registering a native decoder flips `provider='erli'` deliveries from "100% rejected by the OL-HMAC default" to "decoded + verified." No other provider is affected (registry is per-provider).

## Open questions (block a *shippable* verify(), not the structure)

1. **#992 — Erli delivery auth scheme (BLOCKING Phase 0).** Unconfirmed: signature vs. echoed-`accessToken`; header/field names; presence + signature-coverage of a timestamp; how a delivery signals which hook fired; body shape. Until captured from a real sandbox delivery, `verify()` and the `eventId` timestamp component (A4) are assumption-driven. Requires a public callback tunnel + a triggered sandbox order.
2. **Stacked-PR hygiene** — branch carries #1081's diff until it merges; rebase onto `main` before final PR (already in the plan).

---

## One-paragraph summary

The plan is structurally **READY**: every port, registry, type, secret seam, and pipeline stage it relies on was confirmed present in the live tree, the InPost decoder is a faithful template, and the work is purely additive (one new adapter + spec + one `register()` line) with zero CORE/DTO/token/ORM/migration change and no contract-surface break. The single gate-stopping reality is operational, not structural: the BLOCKING Phase 0 spike (#992) — Erli's real delivery-time signature scheme is unknown, so `verify()` and the `eventId` timestamp can be *scaffolded* but not *finalized to ship* without capturing a live sandbox delivery. Recommended posture: **GO-with-scaffolding-only** — build the adapter shape, registration, and unit tests now; gate the final `verify()` implementation + provisional-flag removal on the spike.
