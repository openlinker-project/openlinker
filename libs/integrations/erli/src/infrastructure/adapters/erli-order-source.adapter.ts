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
 * ## Lifecycle writeback — `OrderStatusWriteback.write` (Half A of #997)
 *
 * Implements the platform-neutral `OrderStatusWriteback` capability (#1157 /
 * #1168 / ADR-027): the lifecycle relay dispatches an {@link OrderLifecycleEvent}
 * through the single `write(event)` contract via `isOrderStatusWriteback`, with
 * no platform-type branching. Mirrors `AllegroOrderSourceAdapter.write`. Each
 * event maps onto Erli's API and reports its per-participant outcome via
 * {@link OrderWritebackResult} — `write` never throws.
 *
 * - **`dispatched`** — mark the order dispatched via
 *   `PATCH /orders/{id}/status { status: 'sent' }` (the enum has no `dispatched`;
 *   `sent` is the dispatch state), then register an external shipment via
 *   `POST /shipping/external` ONLY when a waybill is present.
 * - **`cancelled`** — reported `unsupported`: Erli's order-status enum has no
 *   operator-driven cancel verb, and the compensating stock-restore (#997 Half B)
 *   lives in `ErliOfferManagerAdapter.restoreStockOnCancellation`, wired by the
 *   future cancel-observe hook (Q-T2 / #1146), NOT by this status writeback.
 *
 * #992 RELEASE GATE (#1086 review): the endpoint/verb/status token are
 * #992-PROVISIONAL (`erli-fulfillment.types.ts`). To avoid writing to an
 * unconfirmed endpoint on a live order, the `dispatched` write is **opt-in /
 * default OFF** — it reports `unsupported` (surfaced, not silent) unless
 * `OL_ERLI_DISPATCH_WRITEBACK_ENABLED=true`. Enable only once the sandbox
 * confirms the wire shapes (same posture as offer-status-sync, #1063).
 *
 * Tracking inversion (omit-on-absence, §5.4): attach `trackingNumber` ⇔ it is
 * present (a non-Erli carrier with a real waybill); OMIT it when absent (an
 * Erli-managed / `omp_fulfilled` shipment produces no OL-side waybill — Erli
 * generates and owns it server-side). NO `carrier.platformType === 'erli'`
 * guard: the hint is the SHIPPING carrier's type (inpost/dpd/…), never `'erli'`.
 *
 * Identity resolution stays downstream in core (`OrderIngestionService`, #995):
 * this adapter emits RAW external ids only and holds no `IdentifierMappingPort`,
 * exactly as `AllegroOrderSourceAdapter` does.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 * @implements {OrderStatusWriteback}
 */
import type {
  DispatchCarrierHint,
  IncomingOrder,
  OrderFeedEventType,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderLifecycleEvent,
  OrderSourcePort,
  OrderStatusWriteback,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliOrderDispatchRejectedException } from '../../domain/exceptions/erli-order-dispatch-rejected.exception';
import {
  ERLI_EXTERNAL_SHIPPING_PATH,
  ERLI_OL_TO_ORDER_STATUS,
  erliOrderStatusPath,
  type ErliExternalShipmentBody,
  type ErliOrderStatusBody,
} from './erli-fulfillment.types';
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

export class ErliOrderSourceAdapter implements OrderSourcePort, OrderStatusWriteback {
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

    // Map to neutral feed items, then apply the optional `eventTypes` filter
    // BEFORE dedupe (PR1086 review). Filtering after dedupe can silently drop an
    // order: if both orderCreated + orderStatusChanged are unread for one order,
    // dedupe keeps the newest (→ `updated`); a caller passing
    // `eventTypes: ['created']` would then filter that survivor out while
    // `nextCursor` still advances past it — the order vanishes. Filtering first
    // lets the wanted-type event survive dedupe.
    const mapped: OrderFeedItem[] = orderEvents
      .map((msg) => ({
        externalOrderId: msg.orderId,
        eventType: mapErliInboxEventType(msg.type),
        occurredAt: msg.occurredAt ?? new Date().toISOString(),
        eventKey: msg.id,
        eventId: msg.id,
        raw: { type: msg.type },
      }))
      .filter((item) => !input.eventTypes || input.eventTypes.includes(item.eventType));

    // Dedupe by orderId, keeping the newest surviving event (highest id) —
    // prevents enqueuing two jobs for one order when orderCreated +
    // orderStatusChanged are both unread together.
    const byOrder = new Map<string, OrderFeedItem>();
    for (const item of mapped) {
      const existing = byOrder.get(item.externalOrderId);
      if (!existing || item.eventKey > existing.eventKey) {
        byOrder.set(item.externalOrderId, item);
      }
    }
    const items: OrderFeedItem[] = Array.from(byOrder.values());

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
   * `OrderStatusWriteback` (#1157 / #1168 / ADR-027; mirrors
   * `AllegroOrderSourceAdapter.write`). The single event-as-data writeback the
   * lifecycle relay dispatches through. Reports the per-participant outcome via
   * `OrderWritebackResult` and NEVER throws.
   *
   * - `dispatched` → `markDispatched` (PATCH status `sent` + optional waybill).
   *   #992-gated default-OFF: when the gate is off, reported `unsupported`
   *   (surfaced, not a silent success) so the relay/operator sees nothing was
   *   propagated to the live order. A write failure is reported `rejected`.
   * - `cancelled` → `unsupported`: Erli has no operator-driven cancel verb; the
   *   compensating stock-restore is `ErliOfferManagerAdapter.restoreStockOnCancellation`,
   *   wired by the future cancel-observe hook (Q-T2 / #1146), not this writeback.
   *
   * `externalOrderId` is resolved upstream by the relay (this adapter does no
   * identifier mapping). Log hygiene: NEVER log `trackingNumber` / `externalOrderId`
   * at info/warn (waybill = PII); error wrapping is message-only.
   */
  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    if (event.type === 'cancelled') {
      return {
        outcome: 'unsupported',
        detail:
          'Erli has no operator-driven order-cancel writeback; stock-restore is the ' +
          'offer-adapter compensating path wired by the Q-T2 cancel-observe hook (#1146).',
      };
    }

    // event.type === 'dispatched'
    // #992 release gate (#1086 review): the writeback wire shapes
    // (PATCH /orders/{id}/status {status:'sent'} + POST /shipping/external) are
    // PROVISIONAL until the #992 sandbox confirms them. Default OFF so OL never
    // writes to an unconfirmed endpoint on a LIVE order; opt in only once #992
    // lands (mirrors the offer-status-sync opt-in posture, #1063). Reporting
    // `unsupported` (not `applied`) surfaces the skip to the operator.
    if (process.env.OL_ERLI_DISPATCH_WRITEBACK_ENABLED !== 'true') {
      this.logger.warn(
        `Erli dispatch writeback skipped — gated OFF until #992 ` +
          `(set OL_ERLI_DISPATCH_WRITEBACK_ENABLED=true to enable) [connectionId=${this.connectionId}]`,
      );
      return {
        outcome: 'unsupported',
        detail: 'Erli dispatch writeback is gated OFF until #992 (OL_ERLI_DISPATCH_WRITEBACK_ENABLED).',
      };
    }

    try {
      await this.markDispatched(event.externalOrderId, event.trackingNumber, event.carrier);
      return { outcome: 'applied' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // No PII: connectionId only, never order id / waybill.
      this.logger.warn(
        `OrderStatusWriteback 'dispatched' rejected for Erli order (connection: ${this.connectionId}): ${detail}`,
      );
      return { outcome: 'rejected', detail };
    }
  }

  /**
   * Mark the order dispatched (PATCH status `sent`) and register the external
   * shipment when a waybill is present. Throws `ErliOrderDispatchRejectedException`
   * on a non-idempotent failure; `write` catches it and reports `rejected`.
   *
   * Tracking inversion (omit-on-absence, §5.4): a non-Erli carrier with a real
   * waybill → register; an Erli-managed / `omp_fulfilled` shipment (no waybill) →
   * omit (Erli owns the waybill server-side). NO `carrier.platformType === 'erli'`
   * guard — the hint is the SHIPPING carrier's type, never `'erli'`.
   */
  private async markDispatched(
    externalOrderId: string,
    trackingNumber?: string,
    carrier?: DispatchCarrierHint,
  ): Promise<void> {
    // 1. Mark dispatched via the order status enum: PATCH /orders/{id}/status
    //    { status: 'sent' }. The OL-lifecycle→Erli-status map is the single
    //    source of the dispatch token. A 409 (stale revision / already sent) is
    //    treated as success for idempotency.
    const statusBody: ErliOrderStatusBody = { status: ERLI_OL_TO_ORDER_STATUS.dispatched };
    try {
      await this.httpClient.patch(erliOrderStatusPath(externalOrderId), statusBody);
    } catch (error) {
      if (this.isAlreadyDispatchedOrStale(error)) {
        this.logger.debug(
          `Erli order status already sent / stale revision — treating as success (connection: ${this.connectionId})`,
        );
      } else {
        throw this.toDispatchRejected(error, 'mark Erli order sent');
      }
    }

    // 2. Register the external shipment ONLY when a waybill is present
    //    (omit-on-absence, §5.4) via POST /shipping/external. Erli requires a
    //    `vendor` per entry, so we register only when the carrier hint also
    //    carries a platformType (a real non-Erli shipment always does). Absent
    //    tracking is the natural Erli-managed case — nothing to register.
    const vendor = carrier?.platformType;
    if (trackingNumber && vendor) {
      // Body is an ARRAY of shipment entries (#992).
      const shipmentBody: ErliExternalShipmentBody[] = [
        { vendor, orderId: externalOrderId, trackingNumber },
      ];
      try {
        await this.httpClient.post(ERLI_EXTERNAL_SHIPPING_PATH, shipmentBody, { idempotent: true });
      } catch (error) {
        // A 409 here means the shipment is already registered — e.g. a retry after
        // a partial success where the status PATCH landed but this POST's response
        // was lost. Treat it as success so the job converges instead of failing
        // permanently while the shipment is in fact registered (PR1082-TECH-03).
        if (this.isAlreadyDispatchedOrStale(error)) {
          this.logger.debug(
            `Erli external shipment already registered / stale revision — treating as success (connection: ${this.connectionId})`,
          );
        } else {
          throw this.toDispatchRejected(error, 'register external shipment on Erli order');
        }
      }
    }
  }

  /**
   * Treat a 409 as an idempotent success — the guarded step already happened
   * (order already sent, or external shipment already registered) or hit a stale
   * optimistic-lock revision. Keyed STRICTLY on the 409 status: an `/already/i`
   * message match would also swallow genuine non-409 validation failures whose
   * message happens to contain "already" (PR1082-TECH-02).
   */
  private isAlreadyDispatchedOrStale(error: unknown): boolean {
    return error instanceof ErliApiException && error.statusCode === 409;
  }

  /**
   * Wrap a dispatch-writeback failure in the typed rejection. Message is the
   * static context only — NEVER the order id or waybill (PII / log hygiene).
   */
  private toDispatchRejected(error: unknown, context: string): Error {
    if (error instanceof ErliApiException) {
      return new ErliOrderDispatchRejectedException(`Failed to ${context}: ${error.message}`);
    }
    return error instanceof Error ? error : new Error(String(error));
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
