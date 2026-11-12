# Implementation Plan: Shopify inbound webhooks (#3981)

Stacked on #3978 (`3978-shopify-order-processor`), which sits on #3977, #3976,
#3975 and #3974. Branch `3981-shopify-webhooks`.

## 1. Task

Shopify order and product changes reach OpenLinker through webhooks instead of
waiting for the next poll: a decoder that verifies Shopify's HMAC at the host
ingress, a translator to the neutral inbound events, and a provisioner behind
"Configure webhooks". Integration layer plus one core allowlist entry.

### Non-goals

- The "Configure webhooks" button and the callback URL field in the UI (#3982).
  Until then: `openlinkerCallbackBaseUrl` in the connection config JSON and
  `POST /connections/:id/webhooks/install`.
- `inventory_levels/update` (keyed by inventory item and location, not by
  product): stock edits arrive through `products/update`.
- The realtime-lane contention a product burst causes (A16): a separate core issue.
- Dropping the orders poll: it stays as the reconciliation backstop (#904).

## 2. Research

Prototype (`origin/3928-shopify-prototype`): decoder, translator, provisioner,
`shopify-webhook.types.ts`, and `shopify` on `CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS`.

Host contract: `InboundWebhookDecoderPort` (verify + extractEnvelope; no
`timestampMs` means the skew window is skipped, `webhook.service.ts`),
`WebhookEventTranslatorPort` (one event or a list, ADR-049 amendment),
`WebhookProvisioningPort`, `IWebhookSecretService.set` (allowlisted platforms only).

### Shopify API (2026-10), checked against the reference

| Point | Reference says | Effect |
|---|---|---|
| HMAC | `X-Shopify-Hmac-Sha256` = base64 HMAC-SHA256 of the raw body, key = app client secret | constant-time compare of decoded bytes |
| Event id | "Use `X-Shopify-Webhook-Id` to deduplicate individual deliveries"; `X-Shopify-Event-Id` groups deliveries of one merchant action | `X-Shopify-Webhook-Id` is the dedup key |
| Retries | up to 8 times in 4 hours (the prototype said 48 h), then the subscription may be removed | no timestamp window; a 401 must not happen on a valid retry |
| `webhookSubscriptionCreate(topic, webhookSubscription: { uri, format })` | `uri` replaces the deprecated `callbackUrl` | uses `uri` |
| `webhookSubscriptions(first, after) { nodes { id topic uri } }` | paged | page of 100 |
| Topic enum | `ORDERS_CREATE`, `ORDERS_UPDATED`, `ORDERS_CANCELLED` (read_orders), `PRODUCTS_CREATE`, `PRODUCTS_UPDATE`, `PRODUCTS_DELETE` (read_products) | already in the required scopes |
| `webhookSubscriptionDelete(id)` | returns `deletedWebhookSubscriptionId` | removes our old subscriptions |

## 3. Design

- `domain/types/shopify-webhook.types.ts`: headers, topics, topic -> resource, enum names.
- `infrastructure/adapters/webhooks/shopify-inbound-webhook-decoder.adapter.ts`.
- `infrastructure/adapters/webhooks/shopify-webhook-event-translator.adapter.ts`.
- `infrastructure/adapters/webhooks/shopify-webhook-provisioning.adapter.ts`
  plus the pure `planShopifyWebhooks` diff.
- Decoder (keyed by platform type) and translator (keyed by adapter key)
  registered in `shopify-plugin.ts`; provisioner in `ShopifyIntegrationModule`
  (needs `ConnectionPort` + `IWebhookSecretService`), sharing the plugin's
  client runtime so an OAuth refresh during install is written back.
- `openlinkerCallbackBaseUrl` validated by the config parser (optional http(s) URL).
- Core: the caller-supplied secret allowlist (`CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS`) is replaced by the
  adapter-declared `AdapterMetadata.acceptsCallerSuppliedWebhookSecret` (the file's own stated direction once a
  second platform needed it); inFakt and Shopify declare it.

### Changes from the prototype

- Provisioner uses the plugin's runtime, not a fresh token memo (K05 / OAuth rotation).
- Subscriptions of a topic no enabled capability needs are removed; the
  delivery URI carries no secret, so nothing to redact.
- Topics follow the enabled capabilities: orders for `OrderSource`, products for
  `ProductMaster`.

## 4. Steps

1. Types + config parser key + core allowlist (spec updates).
2. Decoder with spec (HMAC ok / wrong / missing / empty secret, topics, ids, big ids).
3. Translator with spec.
4. Provisioner with spec (plan diff, refusals, secret stored before subscribing, failure flag).
5. Plugin + module wiring, plugin spec.
6. README, architecture overview bullet.

## 5. Validation

- Hexagonal: adapters implement core ports; the only core change is a data allowlist.
- Security: HMAC in constant time; the client secret is stored encrypted via
  `IWebhookSecretService`, never logged; the delivery URI carries no credential.
- Tests: decoder, translator, provisioner, plan specs. E2E on the dev store through a tunnel.
