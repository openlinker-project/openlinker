/**
 * Erli Webhook Wire Types
 *
 * Shapes for Erli's inbound *webhook* bodies — the low-latency trigger path
 * (#996) that complements the mandatory inbox poll (#993). Models the two
 * order-relevant hook names and the id+status webhook body shape.
 *
 * Confirmed against the official Erli Shop API docs (https://erli.pl/svc/shop-api/doc/,
 * the #992 follow-up #1145):
 *   - Delivery auth is `Authorization: Bearer {accessToken}` — Erli echoes the
 *     exact shared secret set via `PUT /hooks`. There is NO HMAC signature, NO
 *     timestamp header, and NO timestamp in the body.
 *   - The delivery body is `{ "id": "...", "status": "..." }` — the order id
 *     rides `id` (NOT `orderId`), alongside the seller-facing `status`.
 *   - The body carries NO event-type discriminator: `orderCreated` and
 *     `orderStatusChanged` are registered hook NAMES (`ErliWebhookEventTypeValues`,
 *     used by the provisioner) but both POST the same shape to the same URL, so
 *     the native decoder cannot tell them apart from the body and defaults to a
 *     re-pull (ADR-015 trigger-not-truth — the #993 poll re-reads authoritative
 *     state regardless).
 *
 * This file is the SINGLE reconciliation point for every webhook wire assumption
 * — `ErliWebhookEventTranslator` and `ErliInboundWebhookDecoderAdapter` read
 * webhook shapes only from here.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/**
 * Order-relevant webhook hook names registered via `PUT /hooks/{hookName}`.
 *
 * NOTE: these are the registration/hook-name vocabulary, NOT a body field — the
 * delivery body does not echo which hook fired (see file header). `as const` +
 * union per engineering standards (no runtime enum).
 */
export const ErliWebhookEventTypeValues = ['orderCreated', 'orderStatusChanged'] as const;

export type ErliWebhookEventType = (typeof ErliWebhookEventTypeValues)[number];

/**
 * The body field carrying the external order id — confirmed `id` (#1145, Erli
 * Shop API docs). Erli webhooks are id-only triggers (ADR-015 trigger-not-truth):
 * the order is pulled downstream by `marketplace.order.sync` via
 * `ErliOrderSourceAdapter.getOrder`; the body is never the source of truth.
 */
export const ERLI_WEBHOOK_ORDER_ID_FIELD = 'id';

/**
 * The body field carrying the seller-facing order status (#1145). Advisory only
 * — used to discriminate distinct status transitions for dedup (`eventId`),
 * never trusted as authoritative state.
 */
export const ERLI_WEBHOOK_ORDER_STATUS_FIELD = 'status';

/**
 * Erli webhook delivery body: `{ id, status }` (#1145). Modelled defensively —
 * the decoder narrows both fields from `unknown` rather than trusting the
 * declared shape (the body is untrusted until the Bearer token is verified).
 */
export interface ErliWebhookBody {
  /** External Erli order id (`ERLI_WEBHOOK_ORDER_ID_FIELD`). */
  [ERLI_WEBHOOK_ORDER_ID_FIELD]: string;
  /** Seller-facing order status (`ERLI_WEBHOOK_ORDER_STATUS_FIELD`); advisory. */
  status?: string;
}

/**
 * Webhook registration (#996), verified against the live Erli Shop API (#992).
 * `PUT /hooks/{hookName}` registers a callback `{ url, accessToken }`; the
 * `accessToken` is the shared secret Erli echoes back on each delivery in the
 * `Authorization: Bearer` header for verification (#1145). hookName enum (full):
 * `checkBuyability`, `productsNeedSync`, `orderCreated`, `orderStatusChanged`,
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
