# Implementation Plan — WooCommerce Inbound Webhook Decoder (#1563)

## 1. Task

Implement a WooCommerce-specific `InboundWebhookDecoderPort` (ADR-021 seam) so real
WooCommerce webhook deliveries authenticate end-to-end at the host ingress, instead of
being dropped by the host default decoder (`DefaultWebhookDecoder`, which expects
OpenLinker's own HMAC scheme).

This is the deferred second half of #1548 (acceptance criterion 4). The provisioning
adapter (`WooCommerceWebhookProvisioningAdapter`) and the event translator
(`WooCommerceWebhookEventTranslatorAdapter`) already shipped via epic PR #1568.

**Layer:** Integration (WooCommerce adapter package). No CORE changes — the port,
types, and `InboundWebhookDecoderRegistryService` already exist.

**Non-goals:** no new core ports/tokens/entities; no migration; no changes to
provisioning or translator; no change to the poll backstop.

## 2. WooCommerce signature facts (from provisioning adapter + WC types)

- Header: `X-WC-Webhook-Signature: <base64(HMAC-SHA256(rawBody, secret))>`.
- Secret: the per-connection rotated webhook secret (`IWebhookSecretService`,
  provider key `woocommerce`) — the host supplies it to `verify` via
  `authService.getSecret('woocommerce', connectionId)`.
- **No signed timestamp header** → `verify` omits `timestampMs` → host skips the
  replay-window check (same posture as Erli).
- Delivery headers also carry `X-WC-Webhook-Topic` (`order.created` / `order.updated`),
  `X-WC-Webhook-Resource` (`order`), `X-WC-Webhook-Event` (`created` / `updated`).
- Order body is the full WC order resource (`{ id, status, date_modified_gmt, ... }`).
  The creation "ping" body is `{ "webhook_id": N }` — signed, but has no order id.

## 3. Design

New file: `libs/integrations/woocommerce/src/infrastructure/adapters/woocommerce-inbound-webhook-decoder.adapter.ts`
implementing `InboundWebhookDecoderPort` — mirrors `ErliInboundWebhookDecoderAdapter`.

- `verify`: read `X-WC-Webhook-Signature`, compute `base64(HMAC-SHA256(rawBody))`
  keyed by `secret`, `timingSafeEqual`. Missing header / length mismatch → `{ ok:false }`.
  No `timestampMs` (WC sends none).
- `extractEnvelope`:
  - Parse JSON. Non-JSON / non-object → `reject`.
  - No numeric/string `id` (e.g. the `{webhook_id}` ping) → `ignore` (well-formed,
    not an order — 202, no publish, no source-side retry storm).
  - Otherwise `route` with envelope:
    - `objectType: 'order'`
    - `externalId: String(body.id)`
    - `eventType`: the `X-WC-Webhook-Topic` header (fallback: `order.` + `X-WC-Webhook-Event`,
      fallback `order.updated`). Translator already accepts full topic or bare action.
    - `occurredAt`: `date_modified_gmt` / `date_modified` / `date_created` → ISO, else now.
    - `eventId`: deterministic hash `wc-sha256(orderId:status:topic:modified)` so retries
      of the identical state dedupe while a real status/topic change stays distinct.
      Uses the body timestamp only (never decode-time `now`) so retried deliveries hash
      identically (same rationale as Erli's `deriveEventId`).
- No `detectHandshake` — WC has no echo handshake; the ping is handled by `ignore`.

Constants (topic/resource/event/signature header names) live in the existing
`woocommerce-webhook.types.ts` (extend it; keep WC vocabulary in one place).

Registration: one line in `woocommerce-plugin.ts` `register(host)`, keyed by
`woocommerceAdapterManifest.platformType` (`'woocommerce'`), next to the existing
translator registration. The `inboundWebhookDecoderRegistry` is already threaded into
the plugin's `HostServices` bag by `woocommerce-integration.module.ts`.

## 4. Steps

1. Extend `woocommerce-webhook.types.ts` with the delivery header-name constants
   (`X-WC-Webhook-Signature`, `-Topic`, `-Resource`, `-Event`) and the resource value.
2. Add `woocommerce-inbound-webhook-decoder.adapter.ts` (the port impl above).
3. Register it in `woocommerce-plugin.ts` `register(host)`.
4. Unit spec `__tests__/woocommerce-inbound-webhook-decoder.adapter.spec.ts`:
   valid signature passes; tampered/short/missing → fail; order body → `route` with
   correct envelope; ping body → `ignore`; non-JSON → `reject`; deterministic eventId
   across retries; distinct eventId across a status change.
5. Optional: assert the plugin registers the decoder (extend the plugin spec).
6. Quality gate: scoped `type-check` + `lint` + `test` on `@openlinker/integrations-woocommerce`.

## 5. Validation

- Architecture: adapter implements a CORE port; no CORE edit; no cross-context violation.
- Naming: `*.adapter.ts`, `Woo...Adapter`, `*.spec.ts` — matches conventions.
- Security: secret only compared via `timingSafeEqual`, never logged.
- `detectHandshake` intentionally omitted (optional on the port).
