/**
 * Erli Order Source Adapter
 *
 * Implements `OrderSourcePort` for Erli (#993). Drives order ingestion off
 * Erli's INBOX event journal:
 *   - `listOrderFeed` reads the unread inbox (≤500), filters the two order
 *     event literals, dedupes per order, maps to neutral `OrderFeedItem`s, and
 *     derives a `nextCursor` from the newest read inbox message id.
 *   - `getOrder` fetches the full order resource, VALIDATES the wire shape, and
 *     translates to `IncomingOrder` via the #994 mapper.
 *
 * ## Ack-on-next-read (the order-loss-safe design — see ADR-025 §1)
 *
 * The inbox is "≤500 UNREAD" — a read-marked (acked) message never returns from
 * a re-read. So acking a message BEFORE its `marketplace.order.sync` job is
 * enqueued would be catastrophic (a crash after the ack but before enqueue loses
 * the order forever). This adapter therefore NEVER acks the messages a
 * `listOrderFeed` call returns. Instead, at the START of each call it marks-read
 * only messages with id `<= input.fromCursor` — those are confirmed BEHIND the
 * last committed cursor, hence already enqueued in a prior poll (core commits the
 * cursor only after a successful enqueue). The current wave is acked by the NEXT
 * poll, once core has committed it into `fromCursor`. Guarantee: at-least-once —
 * a crash between enqueue and the next-poll ack causes a harmless re-read +
 * re-enqueue, deduped downstream by `syncOrderFromSource`'s externalOrderId-keyed
 * upsert. Acking is what bounds the unread window below the 500 cap.
 *
 * ## No PII in logs
 *
 * The inbox/order payloads carry buyer PII. This adapter NEVER logs a payload at
 * any level (no `JSON.stringify(response.data)`); error logs use
 * `(error as Error).message` only, and the per-item skip / ack-failure warns log
 * the inbox message ID only. A malformed wire order raises `ErliApiException`
 * with a FIELD-LEVEL reason and NEVER the raw body in `responseBody`.
 *
 * ## Cancellation stock-restore — deferred (ADR-025 §4a / Q-CANCEL)
 *
 * Erli does not restore stock on cancel, and ADR-025 §4a tags the compensating
 * PATCH `#993`, but core has no order-cancellation orchestration hook from which
 * to trigger it (`OrderProcessorManagerPort` only has `createOrder`). The
 * `cancelled` status flows through the mapper faithfully so a future orchestration
 * can act on it; wiring the restore is a follow-up once core grows a cancel/observe
 * hook.
 *
 * Identity resolution stays downstream in core (`OrderIngestionService`, #995):
 * this adapter emits RAW external ids only and holds no `IdentifierMappingPort`,
 * exactly as `AllegroOrderSourceAdapter` does.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 */
import type {
  IncomingOrder,
  OrderFeedEventType,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderSourcePort,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import type { IErliHttpClient } from '../http/erli-http-client.interface';
import { mapErliOrderToIncomingOrder } from './erli-order.mapper';
import type { ErliOrder, ErliOrderStatus } from './erli-order.types';
import {
  ERLI_INBOX_MARK_READ_PATH,
  ERLI_INBOX_ORDER_CREATED,
  ERLI_INBOX_ORDER_STATUS_CHANGED,
  ERLI_INBOX_PATH,
  erliOrderPath,
  type ErliInboxMarkReadRequest,
  type ErliInboxMessage,
} from './erli-inbox.types';

/** The two order-relevant inbox event literals (#992 / Q-INBOX-3). */
const ERLI_ORDER_EVENT_TYPES: ReadonlySet<string> = new Set([
  ERLI_INBOX_ORDER_CREATED,
  ERLI_INBOX_ORDER_STATUS_CHANGED,
]);

const ERLI_ORDER_STATUSES: ReadonlySet<ErliOrderStatus> = new Set<ErliOrderStatus>([
  'pending',
  'purchased',
  'cancelled',
  'returned',
]);

export class ErliOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(ErliOrderSourceAdapter.name);

  /**
   * Shares the per-connection `ErliHttpClient` with the sibling
   * `ErliOfferManagerAdapter` (both built by `ErliAdapterFactory.createAdapters`).
   * No `IdentifierMappingPort`: identity resolution is downstream in core (#995).
   */
  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IErliHttpClient,
  ) {}

  /**
   * Read Erli's unread inbox and emit neutral `OrderFeedItem`s. Ack-on-next-read:
   * marks-read only messages confirmed behind `input.fromCursor`; NEVER acks the
   * messages this call returns. Returns `fromCursor` unchanged on an empty new
   * wave so the cursor never gets stuck.
   */
  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    let response;
    try {
      // `GET /inbox` returns up to 500 unread events as a TOP-LEVEL ARRAY and
      // takes no query params (the unread cap is server-fixed).
      response = await this.httpClient.get<unknown>(ERLI_INBOX_PATH);
    } catch (error) {
      this.logger.error(
        `Failed to list Erli inbox (connection: ${this.connectionId}): ${(error as Error).message}`,
      );
      throw error;
    }

    // Inbox guard — the listing is NOT trusted. A non-array body is a wire-shape
    // failure (field-level reason, no PII body).
    const rawMessages: unknown = response.data;
    if (!Array.isArray(rawMessages)) {
      throw new ErliApiException('Erli inbox response is not an array', response.status);
    }

    // Per-item validation: SKIP (drop + warn, id only) any malformed item. One
    // poisoned item must not abort the whole unread batch.
    const valid: ErliInboxMessage[] = [];
    for (const candidate of rawMessages) {
      const msg = this.validateInboxMessage(candidate);
      if (msg) {
        valid.push(msg);
      }
    }

    const fromCursor = input.fromCursor;

    // Ack the PRIOR wave in ONE call: `POST /inbox/mark-read { lastMessageId }`
    // marks every message with id ≤ fromCursor read, so a single high-water-mark
    // call replaces per-message acks. Erli ids are 24-char ObjectIds — time-
    // ordered and lexicographically sortable — so every comparison is a plain
    // string compare (no numeric zero-pad). Best effort: a failed ack is
    // warn-logged, not fatal (the messages stay unread and re-ack next poll).
    if (fromCursor !== null) {
      await this.markReadUpTo(fromCursor);
    }

    // The NEW wave is EVERY message past the cursor, regardless of type — the
    // cursor (and next poll's ack high-water mark) must advance over consumed
    // non-order events (`productsNeedSync`) too, else a high-id non-order message
    // never gets acked and accumulates against Erli's 500-unread cap, eventually
    // pushing real orders off the listing (PR1079-TECH-01).
    const newWave = valid.filter((msg) => fromCursor === null || msg.id > fromCursor);

    // Only the order-event literals become feed items to enqueue.
    const orderEvents = newWave.filter((msg) => ERLI_ORDER_EVENT_TYPES.has(msg.type));

    // Dedupe by orderId, keeping the newest message (highest id) — prevents
    // enqueuing two jobs for one order when orderCreated + orderStatusChanged are
    // both unread together.
    const byOrder = new Map<string, ErliInboxMessage>();
    for (const msg of orderEvents) {
      const existing = byOrder.get(msg.orderId);
      if (!existing || msg.id > existing.id) {
        byOrder.set(msg.orderId, msg);
      }
    }
    const deduped = Array.from(byOrder.values());

    const items: OrderFeedItem[] = deduped
      .map((msg) => ({
        externalOrderId: msg.orderId,
        eventType: mapErliInboxEventType(msg.type),
        occurredAt: msg.occurredAt ?? new Date().toISOString(),
        eventKey: msg.id,
        eventId: msg.id,
        raw: { type: msg.type },
      }))
      .filter((item) => !input.eventTypes || input.eventTypes.includes(item.eventType));

    // nextCursor = newest id across the ENTIRE new wave (any type), so consumed
    // non-order messages advance the cursor. Empty new wave → keep fromCursor
    // (never stuck).
    const nextCursor = newWave.reduce<string | null>(
      (max, msg) => (max === null || msg.id > max ? msg.id : max),
      fromCursor,
    );

    return { items, nextCursor };
  }

  /**
   * Hydrate a full Erli order by native id. Validates the wire shape BEFORE the
   * (trusting) #994 mapper; raises `ErliApiException` with a field-level reason
   * on a malformed body (never the raw body — PII). A 404 surfaces as the typed
   * `ErliApiException` the retry classifier already treats as non-retryable, so
   * the sync job fails terminally without a retry-storm (no special handling
   * needed — same propagate-and-classify shape as Allegro).
   */
  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    let response;
    try {
      response = await this.httpClient.get<unknown>(erliOrderPath(input.externalOrderId));
    } catch (error) {
      this.logger.error(
        `Failed to fetch Erli order ${input.externalOrderId} (connection: ${this.connectionId}): ${(error as Error).message}`,
      );
      throw error;
    }

    const order = assertErliOrder(response.data);
    return mapErliOrderToIncomingOrder(order);
  }

  /**
   * Ack every inbox message up to (and including) `lastMessageId` via
   * `POST /inbox/mark-read { lastMessageId }` (#992). One high-water-mark call
   * per poll. Best effort: a failed ack is warn-logged (no PII) and not fatal —
   * the messages stay unread and are re-acked next poll.
   */
  private async markReadUpTo(lastMessageId: string): Promise<void> {
    const body: ErliInboxMarkReadRequest = { lastMessageId };
    try {
      await this.httpClient.post(ERLI_INBOX_MARK_READ_PATH, body, { idempotent: true });
    } catch (error) {
      this.logger.warn(
        `Failed to mark Erli inbox read up to a prior cursor (connection: ${this.connectionId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Validate + normalise one raw inbox item. The wire item is
   * `{ id, shopId, created, read, type, payload }` (#992); the order id lives in
   * `payload.id` and the timestamp in `created`. Returns the normalised message
   * when it carries a string `id`, a non-empty `type`, and a `payload.id`;
   * otherwise drops it with a warn (id only when available) and returns `null`.
   * Unknown event types are NOT skipped here (they're filtered later).
   */
  private validateInboxMessage(candidate: unknown): ErliInboxMessage | null {
    if (typeof candidate !== 'object' || candidate === null) {
      this.logger.warn(
        `Skipping malformed Erli inbox item (not an object) (connection: ${this.connectionId})`,
      );
      return null;
    }
    const c = candidate as Record<string, unknown>;
    const id = typeof c.id === 'string' ? c.id : undefined;
    if (!id) {
      this.logger.warn(
        `Skipping malformed Erli inbox item: missing string id (connection: ${this.connectionId})`,
      );
      return null;
    }
    if (typeof c.type !== 'string' || c.type.length === 0) {
      this.logger.warn(
        `Skipping malformed Erli inbox message ${id}: missing string type (connection: ${this.connectionId})`,
      );
      return null;
    }
    const payload =
      typeof c.payload === 'object' && c.payload !== null
        ? (c.payload as Record<string, unknown>)
        : undefined;
    const orderId = payload && typeof payload.id === 'string' ? payload.id : undefined;
    if (!orderId) {
      this.logger.warn(
        `Skipping malformed Erli inbox message ${id}: missing payload.id (connection: ${this.connectionId})`,
      );
      return null;
    }
    return {
      id,
      orderId,
      type: c.type,
      occurredAt: typeof c.created === 'string' ? c.created : undefined,
      read: typeof c.read === 'boolean' ? c.read : undefined,
    };
  }
}

/** Map the known Erli inbox event literals onto the neutral `OrderFeedEventType`. */
function mapErliInboxEventType(type: string): OrderFeedEventType {
  return type === ERLI_INBOX_ORDER_CREATED ? 'created' : 'updated';
}

/**
 * Runtime guard over the wire order before the trusting #994 mapper. Validates
 * exactly the fields the mapper dereferences without its own guards; on failure
 * throws `ErliApiException` with a FIELD-LEVEL reason and NO raw body (PII).
 * Shapes verified against the live Erli API (#992): `user.email`, `items[]`,
 * `delivery.cod`, integer `totalPrice` — no `buyer`/`lineItems`/`totals`.
 */
function assertErliOrder(body: unknown): ErliOrder {
  if (typeof body !== 'object' || body === null) {
    throw new ErliApiException('Erli order: response body is not an object');
  }
  const o = body as Record<string, unknown>;

  if (typeof o.id !== 'string' || o.id.length === 0) {
    throw new ErliApiException('Erli order: id missing or not a string');
  }
  if (typeof o.status !== 'string' || !ERLI_ORDER_STATUSES.has(o.status as ErliOrderStatus)) {
    throw new ErliApiException(`Erli order ${o.id}: status invalid`);
  }

  const user = o.user;
  if (typeof user !== 'object' || user === null) {
    throw new ErliApiException(`Erli order ${o.id}: user missing`);
  }
  if (typeof (user as Record<string, unknown>).email !== 'string') {
    throw new ErliApiException(`Erli order ${o.id}: user.email not a string`);
  }

  const items = o.items;
  if (!Array.isArray(items)) {
    throw new ErliApiException(`Erli order ${o.id}: items missing`);
  }
  items.forEach((item, idx) => assertItem(o.id as string, item, idx));

  const delivery = o.delivery;
  if (typeof delivery !== 'object' || delivery === null) {
    throw new ErliApiException(`Erli order ${o.id}: delivery missing`);
  }
  if (typeof (delivery as Record<string, unknown>).cod !== 'boolean') {
    throw new ErliApiException(`Erli order ${o.id}: delivery.cod not a boolean`);
  }

  if (typeof o.totalPrice !== 'number') {
    throw new ErliApiException(`Erli order ${o.id}: totalPrice not a number`);
  }

  // Timestamps are optional but, when present, the mapper passes them through to
  // the neutral ISO-string date fields; reject a present-but-non-string value
  // here rather than leaking a malformed type downstream.
  for (const field of ['purchasedAt', 'created', 'updated'] as const) {
    if (o[field] !== undefined && typeof o[field] !== 'string') {
      throw new ErliApiException(`Erli order ${o.id}: ${field} present but not a string`);
    }
  }

  return body as ErliOrder;
}

/** Validate the line-item fields the mapper dereferences (externalId/qty/unitPrice/name). */
function assertItem(orderId: string, item: unknown, idx: number): void {
  if (typeof item !== 'object' || item === null) {
    throw new ErliApiException(`Erli order ${orderId}: items[${idx}] not an object`);
  }
  const i = item as Record<string, unknown>;
  if (typeof i.externalId !== 'string') {
    throw new ErliApiException(`Erli order ${orderId}: items[${idx}].externalId not a string`);
  }
  if (typeof i.quantity !== 'number') {
    throw new ErliApiException(`Erli order ${orderId}: items[${idx}].quantity not a number`);
  }
  if (typeof i.unitPrice !== 'number') {
    throw new ErliApiException(`Erli order ${orderId}: items[${idx}].unitPrice not a number`);
  }
  if (typeof i.name !== 'string') {
    throw new ErliApiException(`Erli order ${orderId}: items[${idx}].name not a string`);
  }
}
