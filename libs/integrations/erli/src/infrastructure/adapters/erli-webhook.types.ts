/**
 * Erli Webhook Wire Types
 *
 * Confirmed shapes for Erli's inbound *webhook* bodies (#992 sandbox spike,
 * 2026-07-01) — the low-latency trigger path (#996) that complements the
 * mandatory inbox poll (#993).
 *
 * CONFIRMED AGAINST THE LIVE SANDBOX (#992): unlike the original provisional
 * assumption, Erli's webhook body is **not** an id-only `{ type, orderId }`
 * envelope — it is the **full order resource** (the same shape `GET
 * /orders/{id}` returns: `id`, `status`, `user`, `items`, `delivery`, …), and
 * carries **no event-type discriminator field**. Both the `orderCreated` and
 * `orderStatusChanged` hooks POST this same shape to the same callback URL, so
 * OL cannot distinguish "created" from "status changed" from the body alone —
 * the decoder treats every delivery as a generic "go re-fetch this order"
 * trigger (ADR-025 trigger-not-truth: the real status always comes from the
 * downstream `ErliOrderSourceAdapter.getOrder` call, never the webhook body).
 * The access token Erli echoes back arrives on the standard `Authorization`
 * header (`Bearer <token>`), not a custom `x-access-token` header.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/**
 * Order-relevant webhook event-type discriminators.
 *
 * Used only for hook **registration** (`PUT /hooks/{hookName}`) — the webhook
 * *body* carries no equivalent discriminator (see module doc above).
 *
 * `as const` + union per engineering standards — no runtime enum.
 */
export const ErliWebhookEventTypeValues = ['orderCreated', 'orderStatusChanged'] as const;

export type ErliWebhookEventType = (typeof ErliWebhookEventTypeValues)[number];

/**
 * The body field carrying the external order id (#992-confirmed).
 *
 * The webhook body is the full order resource; `id` is its top-level order
 * id, the same field `ErliOrder` (`GET /orders/{id}`) uses.
 */
export const ERLI_WEBHOOK_ORDER_ID_FIELD = 'id';

/**
 * Confirmed Erli webhook body (#992) — the full order resource. Modelled as a
 * generic record because only `id` is load-bearing for the decoder (the rest
 * is ignored — ADR-025 trigger-not-truth); the translator narrows `id`
 * defensively from `unknown` since it originates from an untrusted body.
 */
export interface ErliWebhookBody {
  /** External Erli order id (`ERLI_WEBHOOK_ORDER_ID_FIELD`). */
  [ERLI_WEBHOOK_ORDER_ID_FIELD]: string;
}

/**
 * Request header Erli sends on each delivery carrying the access token for
 * signature verification (#992-confirmed: the standard `Authorization`
 * header, value `Bearer <token>` — not a custom `x-access-token` header).
 */
export const ERLI_WEBHOOK_ACCESS_TOKEN_HEADER = 'authorization';

/** Prefix Erli prepends to the echoed access token on the `Authorization` header. */
export const ERLI_WEBHOOK_AUTH_HEADER_PREFIX = 'Bearer ';

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

/**
 * Body for `PUT /hooks/{hookName}` (#996): the hook name, callback URL + shared
 * secret. Erli's `HookSave` schema requires `hookName` in the BODY (not only in
 * the path) and rejects unknown properties (`additionalProperties: false`), so
 * the body must repeat the path's hook name verbatim — omitting it yields a 400
 * (confirmed against the live sandbox during the E2E verification run).
 */
export interface ErliHookRegistrationBody {
  hookName: ErliWebhookEventType;
  url: string;
  accessToken: string;
}
