# Pre-implement gate: Shoper webhooks (#3644, Slice C)

**Plan**: `docs/plans/implementation-plan-shoper-webhooks.md`
**Issue**: #3644
**Checked against**: branch `3644-shoper-webhooks` (`413f0d22d`, the top of the Shoper stack)

## Verdict: NEEDS-REVISION

No contract break, and the shape of the work (decoder + translator + provisioner + one additive port field) is sound. Two plan errors would have shipped a bug and a duplicated field; both are cheap to fix in the plan:

1. **The routing gate needs `OrderSource` ENABLED, and Shoper ships it opt-in.** `InboundRoutingPolicy` (`libs/core/src/sync/application/services/inbound-routing-policy.service.ts:104-111`) answers `ungated` unless `connection.enabledCapabilities` contains the required capability. PrestaShop and WooCommerce never hit this because every capability is on by default for them; for a Shoper connection `OrderSource` is in `supportedCapabilities` but NOT in `defaultEnabledCapabilities` (#3711). Without a guard, an operator can install the webhooks, see success, and every delivery is authenticated, accepted and then dead-lettered as `ungated`. The plan does not mention it.
2. **The callback-URL field already exists in the host form** (`openlinkerCallbackBaseUrl`, see Reuse findings). The plan's new prefixed field plus `connectionConfig` contribution would be a second copy of it.

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `ShoperInboundWebhookDecoderAdapter` | **NEW** (Shoper has no webhook code) | `grep -i webhook libs/integrations/shoper/src` hits only the module's registry imports, the order source's docblock and a constant. Pattern to follow: `WooCommerceInboundWebhookDecoderAdapter` |
| `ShoperWebhookEventTranslatorAdapter` | **NEW**, follow `WooCommerceWebhookEventTranslatorAdapter` | `libs/integrations/woocommerce/src/infrastructure/adapters/woocommerce-webhook-event-translator.adapter.ts` |
| `ShoperWebhookProvisioningAdapter` | **NEW**, follow `WooCommerceWebhookProvisioningAdapter` | `.../woocommerce-webhook-provisioning.adapter.ts` |
| Per-connection secret (`rotate`) | **EXISTS -> reuse** | `IWebhookSecretService.rotate(provider, connectionId, actorUserId?)` in `libs/core/src/integrations/application/interfaces/webhook-secret.service.interface.ts`; token `WEBHOOK_SECRET_SERVICE_TOKEN` in `integrations.tokens.ts` |
| Registries (decoder / translator / provisioner) | **EXISTS -> reuse** | `host.inboundWebhookDecoderRegistry`, `host.webhookEventTranslatorRegistry`, `WEBHOOK_PROVISIONING_REGISTRY_TOKEN` (already imported by `shoper-integration.module.ts`) |
| Route `order` -> `marketplace.order.sync` | **EXISTS -> reuse, no change** | `inbound-routing-policy.service.ts:164-172` |
| Install endpoint + FE mutation | **EXISTS -> reuse** | `POST /connections/:id/webhooks/install`; `useConfigureWebhooksMutation` (`apps/web/src/features/connections`) |
| `ConnectionActions` "Configure webhooks" | **PARTIAL**: slot exists, copy the PrestaShop component | `apps/web/src/plugins/prestashop/components/prestashop-connection-actions.tsx` |
| **Callback-URL field** (`shoperOpenlinkerCallbackBaseUrl` + `connectionConfig` + declaration merge) | **ALREADY EXISTS -> reuse** | `openlinkerCallbackBaseUrl` is a host-level field in `features/connections/components/edit-connection.schema.ts` (Zod at line 276, form type at 477, merge clause at 697-702 that **deletes the key on empty**). `prestashop-structured-section.tsx` renders it with `form.watch('openlinkerCallbackBaseUrl')` + `syncStructuredToJson`, and `plugins/prestashop/index.ts` supplies `getCallbackUrlDefault`. The backend reads the same wire key. |
| `query?` on `InboundWebhookDecoderPort.verify` | **PARTIAL (extend)** | port in `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts:33-37` |

## Backward-compatibility findings

**Critical:** none.

**Warning:**

| Surface | Finding | Path |
|---|---|---|
| Port signature `InboundWebhookDecoderPort.verify` (also re-exported through `@openlinker/plugin-sdk` `host-services.ts`, so a plugin-facing contract) | Adding an OPTIONAL `query?: Record<string, string>` to the input object is source-compatible: the four implementers (`inpost`, `infakt`, `erli`, `woocommerce`) and `DefaultWebhookDecoder` declare a narrower parameter and stay assignable. Not a break, but it is a published surface, so it needs a contract spec and a line in the plugin author docs. | Add the field optional only; never make it required |
| `IWebhookService.processWebhook` / `WebhookService` | An optional fifth parameter is source-compatible for the controller and the existing `webhook.service.spec.ts`. Specs that build the call with four arguments are unaffected. | Optional parameter, thread `query` only to `verify` |
| Plan's cleared-field semantics | The plan says a cleared callback field writes an explicit `null` (#2610). The existing host merge clause for `openlinkerCallbackBaseUrl` **deletes** the key, and the provisioner reads absent and `''` the same. Following the plan would make Shoper the one platform persisting `null` for this key. | Reuse the host behaviour (delete), drop the `null` claim from the plan |
| ORM schema / migrations | None. | - |
| `check:invariants` | The provisioner imports `ConnectionPort` from `@openlinker/core/identifier-mapping` and `IWebhookSecretService` from `@openlinker/core/integrations`: both are `*Port` / `I*Service` shapes the cross-context rule allows, and WooCommerce does the same. No new deep import. | - |

**Token hygiene (verified):** `grep` finds no `req.url` / `originalUrl` logging in `apps/api/src`, and `WebhookController` logs only provider and connection id, so the query-string token is not echoed by the host today. Keep it that way: do not add the query to any log line or to the `webhook_deliveries` row.

## Open questions (block a clean implementation)

1. **Enabled-capability guard (blocking, see Verdict 1).** What should `install` do when the connection does not have `OrderSource` enabled? Recommendation: **refuse with a 400 that names the remedy** ("enable the Order source capability on this connection first"), because accepting the install produces webhooks whose every delivery dead-letters. The check reads `connection.enabledCapabilities` (never a `platformType` test), mirrors the gate in `InboundRoutingPolicy`, and costs no extra request (the connection is already loaded). The Configure-webhooks button should say the same when the capability is off.
2. **`POST /webhooks` / `PUT /webhooks/:id` body shape** is unverified live (the plan already schedules a throwaway check; keep it first in Phase 4).
3. **A real end-to-end delivery needs a public URL**; without a tunnel the slice is verified by unit and contract tests only, which the PR must state.
