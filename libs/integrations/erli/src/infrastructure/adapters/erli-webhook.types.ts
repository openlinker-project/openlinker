/**
 * Erli Webhook Wire Types
 *
 * Provisional shapes for Erli's inbound *webhook* bodies — the low-latency
 * trigger path (#996) that complements the mandatory inbox poll (#993). Models
 * the two order-relevant event literals and the id-only webhook body shape.
 *
 * PROVISIONAL (#992): the webhook body shape, the field that carries the order
 * id, the event-type discriminator vocabulary (`orderCreated` /
 * `orderStatusChanged`), and the signature/header scheme are ALL UNCONFIRMED
 * until the sandbox spike. This file is the SINGLE reconciliation point for
 * every webhook wire assumption — `ErliWebhookEventTranslator` (and the future
 * native `InboundWebhookDecoderPort`, the load-bearing #992 follow-up) read
 * webhook shapes only from here, so confirming the spike is a one-file edit.
 *
 * When #992 lands, these symbols flip:
 *   - `ErliWebhookEventTypeValues` — the literal discriminator strings.
 *   - `ERLI_WEBHOOK_ORDER_ID_FIELD` — the body field carrying the order id.
 *   - `ErliWebhookBody` — the full provisional body shape.
 * (The webhook event-type vocabulary is intentionally mirrored against the
 * inbox vocabulary in `erli-inbox.types.ts`; they are distinct wire surfaces
 * that #992 may reconcile to a single source.)
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/**
 * Order-relevant webhook event-type discriminators (#992-PROVISIONAL).
 *
 * `as const` + union per engineering standards — no runtime enum.
 */
export const ErliWebhookEventTypeValues = ['orderCreated', 'orderStatusChanged'] as const;

export type ErliWebhookEventType = (typeof ErliWebhookEventTypeValues)[number];

/**
 * The body field carrying the external order id (#992-PROVISIONAL).
 *
 * Erli webhooks are id-only triggers (ADR-015 trigger-not-truth): the body
 * carries the order id, not the full order, which is pulled downstream by the
 * `marketplace.order.sync` job via `ErliOrderSourceAdapter.getOrder`.
 */
export const ERLI_WEBHOOK_ORDER_ID_FIELD = 'orderId';

/**
 * Provisional id-only Erli webhook body (#992-PROVISIONAL).
 *
 * Modelled as a generic record because the exact field set is unconfirmed; the
 * translator narrows it defensively from `unknown` rather than trusting the
 * declared shape (the id originates from an untrusted body in the future
 * native-decoder path).
 */
export interface ErliWebhookBody {
  /** External Erli order id — field name provisional (`ERLI_WEBHOOK_ORDER_ID_FIELD`). */
  [ERLI_WEBHOOK_ORDER_ID_FIELD]: string;
}

/**
 * Webhook registration (#996), verified against the live Erli Shop API (#992).
 * `PUT /hooks/{hookName}` registers a callback `{ url, accessToken }`; the
 * `accessToken` is the shared secret Erli echoes back on each delivery for
 * signature verification. hookName enum (full): `checkBuyability`,
 * `productsNeedSync`, `orderCreated`, `orderStatusChanged`,
 * `orderSellerStatusChanged`. The provisioner registers the two order-relevant
 * hooks (`orderCreated`, `orderStatusChanged` — `ErliWebhookEventTypeValues`).
 */
export const ERLI_HOOKS_PATH = '/hooks';

/** Builds the per-hook registration path (`PUT /hooks/{hookName}`). */
export function erliHookPath(hookName: ErliWebhookEventType): string {
  return `${ERLI_HOOKS_PATH}/${encodeURIComponent(hookName)}`;
}

/** Body for `PUT /hooks/{hookName}` (#996): callback URL + shared secret. */
export interface ErliHookRegistrationBody {
  url: string;
  accessToken: string;
}
