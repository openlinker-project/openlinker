/**
 * Erli Inbox Wire Types
 *
 * Read/ack shapes for Erli's inbox endpoint — the event journal the
 * `ErliOrderSourceAdapter` (#993) polls to discover new/changed orders.
 *
 * Verified against the live Erli Shop API (#992 spike):
 *  - `GET /inbox` returns a TOP-LEVEL ARRAY (not `{ messages: [...] }`), each
 *    item `{ id, shopId, created, read, type, payload }`. The order id lives in
 *    `payload.id` (Erli order id) / `payload.externalOrderId`; the timestamp is
 *    `created`. There is NO `limit` query param.
 *  - Message ids are 24-char Mongo ObjectIds — time-ordered and lexicographically
 *    sortable, so the cursor is a plain string compare (no numeric zero-pad).
 *  - Ack is `POST /inbox/mark-read` with `{ lastMessageId }` (mark-up-to-id) —
 *    NOT a per-message `PATCH /inbox/{id}`.
 *  - `type` vocabulary: `orderCreated`, `orderStatusChanged`, `productsNeedSync`.
 *  - `productsNeedSync` carries NO `payload.id` on the real sandbox (confirmed
 *    live #1322 manual E2E) — it is a generic "some products need syncing"
 *    notification, not tied to one order. `payload.id` is only guaranteed
 *    present on the two order-event types.
 *
 * `ErliInboxMessage` below is the adapter-internal NORMALISED shape (id + the
 * extracted order id + type + timestamp); `validateInboxMessage` maps the raw
 * wire item onto it. This file is the SINGLE reconciliation point for inbox wire
 * assumptions and endpoint paths.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/**
 * Inbox event-type discriminator. Open `string` (forward-compatible) with the
 * known literals documented as exported consts below.
 */
export type ErliInboxEventType = string;

/** Known inbox event literals (#992). */
export const ERLI_INBOX_ORDER_CREATED = 'orderCreated';
export const ERLI_INBOX_ORDER_STATUS_CHANGED = 'orderStatusChanged';
export const ERLI_INBOX_PRODUCTS_NEED_SYNC = 'productsNeedSync';

/**
 * Normalised inbox message the adapter passes around (mapped from the raw wire
 * item by `validateInboxMessage`). `id` is the ObjectId used as the feed
 * `eventKey`/`eventId` AND the cursor; `orderId` is the Erli-native order id
 * extracted from `payload.id` (becomes `externalOrderId`); `occurredAt` is the
 * wire `created` timestamp.
 *
 * `orderId` is optional: it is required (and validated) for the two
 * order-event types, but absent for non-order types like `productsNeedSync`,
 * which the real wire never carries a `payload.id` for.
 */
export interface ErliInboxMessage {
  id: string;
  type: ErliInboxEventType;
  orderId?: string;
  occurredAt?: string;
  read?: boolean;
}

/**
 * Ack (read-marking) request body for `POST /inbox/mark-read` (#992). The
 * mark-up-to-id form: marks every inbox message with id ≤ `lastMessageId` read
 * in one call. (Erli also accepts `{ ids: [...] }`; the adapter uses the
 * high-water-mark form.)
 */
export interface ErliInboxMarkReadRequest {
  lastMessageId: string;
}

/**
 * Erli endpoint paths (#992). Relative to the connection's `/svc/shop-api` base
 * URL already baked into `ErliHttpClient`.
 */
export const ERLI_INBOX_PATH = '/inbox';
export const ERLI_INBOX_MARK_READ_PATH = '/inbox/mark-read';
export const ERLI_ORDER_PATH = '/orders';

/** Builds the order-resource fetch path (`GET /orders/{id}`). */
export function erliOrderPath(orderId: string): string {
  return `${ERLI_ORDER_PATH}/${encodeURIComponent(orderId)}`;
}
