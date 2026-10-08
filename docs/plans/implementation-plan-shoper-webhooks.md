# Implementation plan - Shoper webhooks (#3644, Slice C)

Branch `3644-shoper-webhooks`, stacked on `3711-shoper-order-source` (#3714), the top of the Shoper stack. Supersedes `implementation-plan-shoper-webhook-backstop.md` (written before Shoper had `OrderSource`).

## 1. Goal

An order changed in the Shoper admin panel reaches OpenLinker within seconds instead of waiting for the next poll, the way it does for PrestaShop and WooCommerce: a webhook is a **trigger only**, the authoritative order is re-read through `OrderSource` (#904).

**Layers:** Integration (`libs/integrations/shoper`), one additive CORE port change (`libs/core/src/integrations`), one host change (`apps/api/src/webhooks`), Frontend (`apps/web/src/plugins/shoper`).

**Non-goals:** the destination read-back (`FulfillmentStatusReader` + scheduler task, old Slice A), a new `destination-order` inbound domain (old Slice B - unnecessary, see 2.2), verifying Shoper's own `x-webhook-sha1` (algorithm still unknown).

## 2. What the codebase and the live shop already decide

### 2.1 How PrestaShop and WooCommerce do it (the basis for this slice)

Three small pieces, registered per plugin, then the generic host path:

| Piece | WooCommerce | Where it registers |
|---|---|---|
| Decoder (`InboundWebhookDecoderPort`): `verify` + `extractEnvelope` | `WooCommerceInboundWebhookDecoderAdapter` (HMAC of the body) | `host.inboundWebhookDecoderRegistry` in `register()` |
| Translator (`WebhookEventTranslatorPort`): envelope -> `CanonicalInboundEvent` (`domain: 'order'`) | `WooCommerceWebhookEventTranslatorAdapter` | `host.webhookEventTranslatorRegistry` in `register()` |
| Provisioner (`WebhookProvisioningPort.install`) | `WooCommerceWebhookProvisioningAdapter` + `WooCommerceWebhookProvisioningModule` (needs `ConnectionPort` + `IWebhookSecretService`, which are not in `HostServices`) | `WebhookProvisioningRegistryService` in a Nest module `onModuleInit` |

After that the delivery is generic: `InboundRoutingPolicy` maps `domain: 'order'` to `marketplace.order.sync` gated on `OrderSource`, the job re-reads the order through `OrderSourcePort.getOrder`, and `OrderIngestionService.syncOrderFromSource` update-or-creates it (#909). Installing is an **operator action** (`POST /connections/:id/webhooks/install`), not a side effect of creating a connection.

### 2.2 Why no core routing change is needed (this differs from the old plan)

The old plan assumed Shoper was destination-only, so an `order` event would dead-letter as `ungated` and a new `destination-order` domain would be needed. Since #3711 Shoper has `OrderSource`, so the existing route applies unchanged.

### 2.3 The one real gap: the host never shows `verify` the URL

`WebhookService.processWebhook` calls `decoder.verify({ rawBody, headers, secret })`. Shoper's signature (`x-webhook-sha1`) is unknown (13 formulas ruled out in SPIKE-3638 X5; the capture that would let it be solved has since expired), so authentication is a **token in the delivery URL**, which `verify` cannot see today. The fix is additive and source-compatible: an OPTIONAL `query?: Record<string, string>` on `verify`'s input, threaded from the controller (`@Query()`) through `processWebhook`. Existing decoders ignore it.

### 2.4 Shoper's webhook model (live, read-only `GET /webhooks`, 6 Oct 2026)

A webhook row: `{ webhook_id, url, active, format, events: [...], secret? }`. **One webhook carries many events** (webhook 5 carries 25), so one registration covers all order events. Event names seen: `order.create`, `order.edit`, `order.paid`, `order.status`, `order.delete`. Deliveries carry the full order object (SPIKE-3638 X3) and headers `x-webhook-name`, `x-webhook-id`, `x-shop-domain`, `x-shop-license`, `x-webhook-sha1`.

**Verified live (6 Oct 2026, throwaway webhooks 6 and 7, both deleted; webhooks 1-5 untouched):**
- `POST /webhooks` requires `url`, `events[]`, **`format`** (send `0`) and `active`; `secret` is optional. It answers the new webhook id as a bare number (HTTP 200).
- `PUT /webhooks/:id` accepts a **partial** body (a body with only `url` worked) and answers `1`.
- **A query string in `url` is accepted** (`?token=...`), which the token-in-URL design depends on. A `.invalid` host is refused (`'...' nie jest poprawnym adresem URL`), so the callback URL must be a resolvable host.
- `secret` is **readable** back through `GET /webhooks/:id` (it echoes `''` when none was set).
- `GET /webhooks?filters[url]=...` filters by URL **equality** only, so ours is found by listing (paged, `limit` 50) and matching the URL prefix client-side.
- `DELETE /webhooks/:id` answers `1`.

Note: the trial shop still holds webhook 5, left by the spike, pointing at an expired webhook.site endpoint. It is not touched here.

## 3. Design

### 3.1 Events

Provisioned: `order.create`, `order.edit`, `order.paid`, `order.status`. **`order.delete` is deliberately not provisioned**: a re-read of a deleted order answers 404 and the job would retry a condition retrying cannot change.

Translator mapping into the order domain's advisory vocabulary (the authoritative order is fetched downstream): `order.create` -> `created`, everything else -> `updated`. The status-derived `cancelled` event stays the feed's job; a webhook only nudges a re-read.

### 3.2 Decoder

- `verify`: `query.token` against the stored per-connection secret, `timingSafeEqual` on equal-length buffers; missing token or secret -> `{ ok: false }`. No `timestampMs` (Shoper sends no signed timestamp), the same posture as WooCommerce and Erli.
- `extractEnvelope`: parse the body, require `order_id` (a body without one - e.g. any non-order delivery - is `ignore`, so it is a 202 without publish and no retry storm); `eventType` from `x-webhook-name` (default `order.edit`); `payload: { id }` only - **never the order body** (trigger model).
- `eventId`: `sha256(x-webhook-name + ':' + rawBody)`. A retried delivery of the identical body re-hashes to the same id and is caught by the Postgres dedup gate; a real change alters the body (`status_id`, `status_date`, `sum`, ...). Never derived from `Date.now()` (it would defeat dedup, the WooCommerce docblock's own warning).

### 3.3 Provisioner

`ShoperWebhookProvisioningAdapter.install(connectionId, actorUserId)`:

0. **Refuse when `OrderSource` is not enabled** on the connection (a 400 naming the remedy). The routing gate (`InboundRoutingPolicy`) answers `ungated` unless `connection.enabledCapabilities` contains `OrderSource`, and Shoper ships it opt-in (#3711), so without this guard an install would succeed while every delivery is authenticated, accepted and then dead-lettered. Read from the connection already loaded; never a `platformType` test (pre-implement gate, open question 1).
1. Read `config.openlinkerCallbackBaseUrl` (required; refuse with a 400 that names the key, as WooCommerce does) and the connection credentials.
2. `IWebhookSecretService.rotate('shoper', connectionId, actorUserId)` -> plaintext secret (one-shot).
3. Delivery URL: `${base}/webhooks/shoper/${connectionId}?token=${encodeURIComponent(secret)}`.
4. List the shop's webhooks (paged, `limit` 50). **Find ours by URL prefix without the query** (`${base}/webhooks/shoper/${connectionId}`): the token changes on every install, so matching the full URL would duplicate the registration each time. `PUT` it when found, `POST` otherwise - idempotent, no duplicates on re-run.
5. On failure: fail closed - best-effort flip `config.webhooksConfigured` to `false` and surface the reason (the secret was already rotated, re-running is safe), the WooCommerce shape. On success: `webhooksConfigured: true`.

Registered from `ShoperIntegrationModule.onModuleInit` (it already imports `IntegrationsModule` and injects the registries), which needs `ConnectionPort` + `IWebhookSecretService` added to its injections; no separate module is needed unless the cycle appears in Phase 4.

### 3.4 Config and the callback-URL field

`ShoperConnectionConfig` gains optional `openlinkerCallbackBaseUrl` and `webhooksConfigured`. The shape validator checks the first is an absolute `http(s)` URL when present.

**The field already exists in the host form, so it is reused, not redeclared** (pre-implement gate): `openlinkerCallbackBaseUrl` is a host-level field in `features/connections/components/edit-connection.schema.ts` (Zod + form type + a merge clause that deletes the key when the field is cleared) and the backend reads the same wire key. The operator sets it **in the UI** through a small `StructuredConfigSection` for Shoper that renders that existing field, the way `prestashop-structured-section.tsx` does (`form.watch('openlinkerCallbackBaseUrl')` + `syncStructuredToJson`), with `getCallbackUrlDefault` returning `window.location.origin` as PrestaShop does. No new `connectionConfig` contribution, no declaration-merge entry and no platform-prefixed field. A cleared field **deletes** the key (the existing host behaviour); the provisioner reads absent and `''` the same, so this needs nothing from #2610's explicit-`null` rule.

The section must show the operator whether `OrderSource` is enabled, because the install is refused without it (3.3, step 0).

### 3.5 Frontend

`ShoperConnectionActions` ("Configure webhooks"), a copy of the PrestaShop action shape (`useConfigureWebhooksMutation`, toasts for configured / failed, `ReadOnlyLock`, a `webhooksConfigured` badge), registered as `platform.ConnectionActions` in `plugins/shoper/index.ts`. No test ping exists for Shoper, so there is no "ping received" state; the success toast says so.

## 4. Files

New:
- `libs/integrations/shoper/src/infrastructure/adapters/shoper-inbound-webhook-decoder.adapter.ts`
- `libs/integrations/shoper/src/infrastructure/adapters/shoper-webhook-event-translator.adapter.ts`
- `libs/integrations/shoper/src/infrastructure/adapters/shoper-webhook-provisioning.adapter.ts`
- `libs/integrations/shoper/src/domain/types/shoper-webhook.types.ts` (provider key, header names, order events, wire rows)
- `apps/web/src/plugins/shoper/shoper-connection-actions.tsx` (+ test)
- `apps/web/src/plugins/shoper/components/shoper-structured-section.tsx` (+ test): renders the existing host field `openlinkerCallbackBaseUrl`
- a spec per adapter

Changed:
- `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts` (additive `query?`)
- `apps/api/src/webhooks/http/webhook.controller.ts`, `application/services/webhook.service.ts`, `application/interfaces/webhook.service.interface.ts` (thread `query`)
- `libs/integrations/shoper/src/shoper-plugin.ts` (register decoder + translator), `shoper-integration.module.ts` (register provisioner)
- `libs/integrations/shoper/src/domain/types/shoper-config.types.ts`, `.../shoper-connection-config-shape-validator.adapter.ts`
- `apps/web/src/plugins/shoper/index.ts` (register `StructuredConfigSection`, `ConnectionActions`, `getCallbackUrlDefault`), `libs/integrations/shoper/README.md`, `docs/plugin-author-guide.md` (the new optional `verify` input)

## 5. Tests

Unit: decoder (valid token, wrong token, missing token, different length, missing `query`, no order id -> ignore, malformed JSON -> reject, same body twice -> same `eventId`, changed body -> different), translator (create vs the rest, unknown object type -> null), provisioner (refuses without callback URL, refuses when `OrderSource` is not enabled, rotates the secret, URL carries the token, finds ours by prefix and PUTs, POSTs when absent, never duplicates on re-run, fails closed and flips the flag), config validator, web action (toasts, read-only lock), structured section (renders the host field, keeps the other config keys). Host: `WebhookService` passes `query` to `verify`; an existing decoder is unaffected. A contract spec that no `verify` implementation in the tree breaks on the new optional field.

## 6. Risks / open questions

1. ~~`POST /webhooks` body unverified~~ - settled live (2.4).
2. **Public reachability**: Shoper must reach `openlinkerCallbackBaseUrl`; a local stack needs a tunnel, so the end-to-end delivery check is only possible with one. Without it, the unit and contract tests are what verifies this slice, and that must be stated in the PR.
3. **The token sits in a URL** and can reach access logs (OL's and any proxy's). Its blast radius is a forced re-read of a single connection's orders, which is why the plan accepts it; the controller must not log the query string.
4. **No signature check on top of the token** until Shoper's `x-webhook-sha1` algorithm is resolved (SPIKE-3638 risk 1).
5. **Identical edits dedupe**: two `order.edit` deliveries with byte-identical bodies are treated as one. The re-read they would trigger reads the same state, so nothing is lost.
6. A structured section must not drop the other Shoper config keys (`baseUrl`, `defaults`, `webhooksConfigured`) when it saves; covered by a test through the host merge path (`mergeStructuredIntoConfig`).
7. **The install is refused unless `OrderSource` is enabled** (3.3, step 0); a spec pins it, and the UI says why.

## 7. Pre-implement gate

`docs/plans/analysis/ANALYSIS-shoper-webhooks.md` returned **NEEDS-REVISION** (no contract break). Revised above: the missing `OrderSource` enabled-capability guard (3.3 step 0) and the callback-URL field reuse (3.4). **Re-gate after the revision:** no new artifact was added; the guard reads `connection.enabledCapabilities` (an existing field, the same one `InboundRoutingPolicy` reads), and the section reuses the host's existing field and merge clause, so both reuse and compatibility findings stand as READY.
