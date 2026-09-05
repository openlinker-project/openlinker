/**
 * Allegro Order Source Adapter
 *
 * Implements `OrderSourcePort` for Allegro. Handles incremental order-event
 * ingestion from Allegro's order-events journal and full-order hydration via
 * the checkout-form endpoint. Split out of the legacy `AllegroMarketplaceAdapter`
 * as part of #328.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 */

import { PAYMENT_STATUS, readSourceBuyerTaxId } from '@openlinker/core/orders';
import type {
  OrderSourcePort,
  SourceOptionsReader,
  OrderStatusWriteback,
  OrderLifecycleEvent,
  OrderWritebackResult,
  DispatchCarrierHint,
  MappingOption,
  ReturnSourceReader,
  ReturnDecliner,
} from '@openlinker/core/orders';
import type {
  IncomingReturn,
  ReturnDeclineCommand,
  ReturnDeclineResult,
  ReturnFeedInput,
  ReturnFeedItem,
  ReturnFeedOutput,
} from '@openlinker/core/returns';
import {
  ReturnDeclineInvalidRequestError,
  ReturnDeclineRejectedBySourceError,
} from '@openlinker/core/returns';
import type {
  OrderFeedInput,
  OrderFeedOutput,
  OrderFeedEventType,
  IncomingOrder,
  IncomingOrderAddress,
  OrderShipping,
  OrderPickupPoint,
  OrderPickupPointType,
  OrderDispatchWindow,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { getAllegroSalesCenterOrderUrl } from '../http/allegro-hosts';
import { Logger } from '@openlinker/shared/logging';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import type {
  AllegroCheckoutForm,
  AllegroDeliveryMethodsResponse,
  AllegroOrderEventsResponse,
  AllegroShippingRatesResponse,
  AllegroShippingRateDetailResponse,
} from '../../domain/types/allegro-api.types';
import { ALLEGRO_ORDER_STATUS_OPTIONS } from '../../domain/types/allegro-order-status.types';
import { ALLEGRO_PAYMENT_TYPE_OPTIONS } from '../../domain/types/allegro-payment-type.types';
import {
  ALLEGRO_CARRIER_BY_PLATFORM_TYPE,
  ALLEGRO_FULFILLMENT_STATUS_SENT,
  ALLEGRO_FULFILLMENT_STATUS_CANCELLED,
  ALLEGRO_OTHER_CARRIER_ID,
} from '../../domain/types/allegro-order-fulfillment.types';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { AllegroOrderDispatchRejectedException } from '../../domain/exceptions/allegro-order-dispatch-rejected.exception';
import { deriveAllegroPaymentStatus } from './allegro-payment-status';
import {
  ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE,
  ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES,
  ALLEGRO_RETURN_REJECTION_CODES,
  ALLEGRO_RETURN_REJECTION_REASON_MAX_LENGTH,
  ALLEGRO_RETURN_REJECTION_REASON_REQUIRED_FOR,
} from '../../domain/types/allegro-customer-return.types';
import type {
  AllegroCustomerReturnsResponse,
  AllegroCustomerReturnWire,
} from '../../domain/types/allegro-customer-return.types';
import { toIncomingReturn, toReturnFeedItem } from './allegro-customer-return.mapper';
import { toNeutralTaxRate } from './allegro-tax-rate.mapper';

type OrderFeedItem = OrderFeedOutput['items'][number];

/**
 * The HTTP statuses on which Allegro is DETERMINISTICALLY refusing OL's decline
 * request (#2333) — a bad code for this return, a return whose state does not
 * permit rejection, a seller not entitled to the write.
 *
 * Deliberately narrow. `401` / `403` are auth conditions the existing
 * auth-failure classifier owns and a re-auth resolves; `408` / `429` and every
 * 5xx leave OL not knowing whether Allegro applied the change. All of those stay
 * platform-native and propagate, so the ADR-044 proposal stays OPEN (in doubt)
 * rather than being recorded as a refusal OL cannot support. `422` is handled
 * separately — it means "already rejected".
 */
const DETERMINISTIC_DECLINE_REFUSAL_STATUSES: readonly number[] = [400, 404, 409];

/**
 * Allegro Order Source Adapter
 *
 * Shares the Allegro HTTP client with its sibling `AllegroOfferManagerAdapter`
 * through the per-connection factory (`AllegroAdapterFactory.createAdapters`) —
 * each connection gets one HTTP client instance that both adapters hold by
 * reference. Identifier mapping for ingested orders happens downstream in
 * `OrderIngestionService` against the `IncomingOrder` payload, so the adapter
 * does not need the identifier-mapping port itself.
 */
export class AllegroOrderSourceAdapter
  implements
    OrderSourcePort,
    SourceOptionsReader,
    OrderStatusWriteback,
    ReturnSourceReader,
    ReturnDecliner
{
  private readonly logger = new Logger(AllegroOrderSourceAdapter.name);

  /**
   * Allegro environment (`production` | `sandbox`), read from connection config
   * to build the seller Sales Center order deep link (#1713). Defaults to '' so
   * the host resolver falls back to sandbox on an absent/unknown value.
   */
  private readonly environment: string;

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IAllegroHttpClient,
    connection: Connection
  ) {
    const env = connection.config?.environment;
    this.environment = typeof env === 'string' ? env : '';
  }

  /**
   * `OrderStatusWriteback` (#1159 / ADR-027): the single event-as-data writeback
   * the lifecycle relay dispatches through. `dispatched` reuses the mark-sent +
   * waybill mechanics; `cancelled` sets Allegro's fulfillment status to
   * `CANCELLED`. Reports the per-participant outcome via `OrderWritebackResult`
   * and never throws (mirrors the PrestaShop adapter's `write`).
   *
   * A `cancelled` write Allegro refuses (incl. a 409 — e.g. the order is already
   * `SENT`) is reported `rejected`, NOT swallowed as success: the operator must
   * see the conflict. (We do not reuse the mark-sent `409 ⇒ success` branch here
   * — its semantics are only safe for SENT.) Exact cancel transition rules are
   * `needs-sandbox-probe`. No refund is issued — OL is never the money book of
   * record (ADR-027).
   */
  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    try {
      switch (event.type) {
        case 'dispatched': {
          await this.markSent(event.externalOrderId, event.trackingNumber, event.carrier);
          return { outcome: 'applied' };
        }
        case 'cancelled': {
          await this.putFulfillment(event.externalOrderId, ALLEGRO_FULFILLMENT_STATUS_CANCELLED);
          return { outcome: 'applied' };
        }
        default: {
          // Unreachable in-tree: the binding is the compile break when an
          // `OrderLifecycleEvent` member is added without an arm here (#2286).
          // It still degrades rather than throwing, so a caller compiled against
          // a widened union gets a surfaced no-op, not a `rejected` from the
          // enclosing catch (ADR-055 forward-compat).
          const unhandled: never = event;
          return {
            outcome: 'unsupported',
            detail: `unsupported order lifecycle event: ${JSON.stringify(unhandled)}`,
          };
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `OrderStatusWriteback '${event.type}' rejected for Allegro order ` +
          `${event.externalOrderId}: ${detail} (connection: ${this.connectionId})`,
      );
      return { outcome: 'rejected', detail };
    }
  }

  /**
   * Mark the Allegro order sent, and attach the waybill when one is supplied
   * (own-contract branch). For the source-brokered branch (Allegro Delivery) no
   * `trackingNumber` is passed — Allegro already holds the waybill it issued —
   * so only the fulfillment status is set. Drives the `OrderStatusWriteback`
   * `dispatched` path. Throws `AllegroOrderDispatchRejectedException` on a
   * non-idempotent failure; `write` catches it and reports `rejected`.
   */
  private async markSent(
    externalOrderId: string,
    trackingNumber?: string,
    carrier?: DispatchCarrierHint,
  ): Promise<void> {
    // 1. Mark sent. Treat a 409 (stale optimistic-lock revision / already-sent)
    //    as success for idempotency. `needs-sandbox-probe`: exact 409 semantics.
    try {
      await this.putFulfillment(externalOrderId, ALLEGRO_FULFILLMENT_STATUS_SENT);
    } catch (error) {
      if (this.isAlreadySentOrStale(error)) {
        this.logger.debug(
          `Allegro order ${externalOrderId} fulfillment already sent / stale revision — treating as success (connection: ${this.connectionId})`,
        );
      } else {
        throw this.toRejected(error, `mark Allegro order ${externalOrderId} sent`);
      }
    }

    // 2. Attach the waybill when present (own-contract branch).
    if (trackingNumber) {
      const { carrierId, carrierName } = this.resolveCarrier(carrier);
      try {
        await this.httpClient.post(
          `/order/checkout-forms/${externalOrderId}/shipments`,
          { carrierId, waybill: trackingNumber, ...(carrierName ? { carrierName } : {}) },
        );
      } catch (error) {
        // A 409 here means this waybill is already attached — e.g. a retry after
        // a partial success where the fulfillment PUT landed but this POST's
        // response was lost. Treat it as success so the flow converges instead of
        // reporting `rejected` while the waybill is in fact attached. Mirrors the
        // Erli adapter's external-shipment registration, which took the same
        // decision for the same failure shape (#1947; PR1082-TECH-03 there).
        //
        // Defence in depth only: at-most-once for this call is owned upstream by
        // the `Shipment.waybillRelayedAt` claim, so this branch should be rare.
        if (this.isWaybillAlreadyAttached(error)) {
          this.logger.debug(
            `Allegro order ${externalOrderId} already carries this waybill — treating as success (connection: ${this.connectionId})`,
          );
        } else {
          throw this.toRejected(error, `attach waybill to Allegro order ${externalOrderId}`);
        }
      }
    }
  }

  /**
   * Set the Allegro order's fulfillment status. The single wire shape behind
   * both the `dispatched` mark-sent step and the `cancelled` writeback — callers
   * own their own success/failure semantics (idempotent-409 for SENT, surface for
   * CANCELLED), so this helper stays a thin one-liner with no error handling.
   */
  private async putFulfillment(externalOrderId: string, status: string): Promise<void> {
    await this.httpClient.put(`/order/checkout-forms/${externalOrderId}/fulfillment`, { status });
  }

  /** Map the neutral carrier hint → Allegro's fixed carrier vocab (OTHER+name fallback). */
  private resolveCarrier(carrier?: DispatchCarrierHint): { carrierId: string; carrierName?: string } {
    const platformType = carrier?.platformType;
    const known = platformType ? ALLEGRO_CARRIER_BY_PLATFORM_TYPE[platformType] : undefined;
    if (known) {
      return { carrierId: known };
    }
    return { carrierId: ALLEGRO_OTHER_CARRIER_ID, carrierName: platformType ?? 'Carrier' };
  }

  private isAlreadySentOrStale(error: unknown): boolean {
    return (
      error instanceof AllegroApiException &&
      (error.statusCode === 409 || /already/i.test(error.message))
    );
  }

  /**
   * Waybill-attach idempotency, keyed STRICTLY on the 409 status (#1947).
   *
   * Deliberately narrower than {@link isAlreadySentOrStale}: that predicate also
   * matches `/already/i` on the message, which is tolerable for the fulfillment
   * PUT (a status write that is idempotent by nature) but not here. The waybill
   * POST creates a resource, so a message-text match could swallow a genuine
   * non-409 validation failure — an unattached waybill silently reported as
   * `applied`, which is the very defect class this issue fixes. Same reasoning
   * the Erli adapter records for its own registration guard.
   */
  private isWaybillAlreadyAttached(error: unknown): boolean {
    return error instanceof AllegroApiException && error.statusCode === 409;
  }

  private toRejected(error: unknown, context: string): Error {
    if (error instanceof AllegroApiException) {
      return new AllegroOrderDispatchRejectedException(`Failed to ${context}: ${error.message}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * List incremental order feed items from Allegro's order-events journal.
   *
   * Uses cursor-based pagination; cursor is the Allegro-assigned event ID
   * (opaque to the caller, monotonic per seller).
   */
  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    this.logger.debug(
      `Listing Allegro order feed (connection: ${this.connectionId}, fromCursor: ${input.fromCursor || 'none'}, limit: ${input.limit})`
    );

    try {
      const queryParams: Record<string, string | number> = {};
      if (input.fromCursor) {
        queryParams.from = input.fromCursor;
      }
      queryParams.limit = input.limit;

      const response = await this.httpClient.get<AllegroOrderEventsResponse>('/order/events', {
        queryParams,
      });

      this.logger.debug(
        `Allegro /order/events raw response (connection: ${this.connectionId}): ${JSON.stringify(response.data)}`
      );

      const events = response.data.events || [];

      // Determine nextCursor:
      // 1. Use lastEventId from API if provided (most reliable)
      // 2. Fall back to last event's ID if events exist
      // 3. If no events and no lastEventId, keep the current cursor so the
      //    cursor does not get stuck when Allegro returns empty results.
      const nextCursor =
        response.data.lastEventId ||
        (events.length > 0 ? events[events.length - 1]?.id : input.fromCursor || null);

      this.logger.debug(
        `Fetched ${events.length} order events (connection: ${this.connectionId}, nextCursor: ${nextCursor || 'none'})`
      );

      // Deduplicate by checkoutFormId, keeping the latest event (highest ID).
      const eventMap = new Map<string, (typeof events)[number]>();
      for (const event of events) {
        const checkoutFormId = event.order.checkoutForm.id;
        const existing = eventMap.get(checkoutFormId);
        if (!existing || event.id > existing.id) {
          eventMap.set(checkoutFormId, event);
        }
      }

      const items: OrderFeedItem[] = Array.from(eventMap.values())
        .map((event) => {
          const externalOrderId = event.order.checkoutForm.id;
          const occurredAt = event.occurredAt;
          const eventType = mapAllegroEventType(event.type);

          return {
            externalOrderId,
            eventType,
            occurredAt,
            eventKey: event.id,
            eventId: event.id,
            raw: { type: event.type },
          };
        })
        .filter((i) => !input.eventTypes || input.eventTypes.includes(i.eventType));

      return {
        items,
        nextCursor,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list Allegro order feed (connection: ${this.connectionId}): ${(error as Error).message}`,
        error
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // ReturnSourceReader (#2330) — customer returns
  //
  // Two methods and one declaration, all against Allegro's `[BETA]`
  // customer-returns resource. The `[BETA]` media type is set PER REQUEST via
  // the caller-header hook rather than on the shared client: every other Allegro
  // call in the tree wants `public.v1`, and a client-wide default would silently
  // retag them all. The client applies headers in the order
  // defaults -> caller -> structural, so a caller `Accept` wins while
  // `Authorization` and `X-Trace-Id` stay owned by the token/trace machinery.
  // ---------------------------------------------------------------------------

  /**
   * The source statuses that mean "finished", published so core's pass-2 sweep
   * can exclude them IN THE QUERY instead of re-reading and discarding.
   *
   * Core treats this as an opaque set. The same constant backs the
   * per-observation `isTerminalAtSource` hint (see the mapper), which is what
   * stops the two answers drifting apart.
   */
  readonly terminalRawStatuses: readonly string[] = ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES;

  /**
   * One cursor-paged page of the customer-returns feed.
   *
   * Four properties are load-bearing, and each is a risk from SPIKE-2289 rather
   * than a style choice.
   *
   * **`from` only, NEVER `offset`.** Allegro's `from` is a documented cursor
   * ("the ID of the last seen customer return"); `offset` is a live 504 risk at
   * depth and has a field report of out-of-sequence pages (risk 4 / E6) — and
   * bootstrapping a busy seller is exactly the deep-offset case. This method
   * never sends `offset` at all.
   *
   * **Termination is an empty array, never `count`.** `count`'s semantics are
   * unstated (risk 8): read as a total it would loop forever, read as a page
   * size it would stop early and lose returns silently.
   *
   * **`from` is never composed with a filter.** Whether the cursor applies
   * before or after `status` / `createdAt` filtering is documented nowhere
   * (risk 1), so this method designs around the question rather than guessing:
   * the bootstrap window below is used ONLY when there is no cursor, and a
   * cursored request carries `from` and `limit` and nothing else.
   *
   * **A null cursor bootstraps a window; it does not mean "since the epoch".**
   * A bare unbounded first call would page a seller's entire return history
   * through deep offsets — precisely the 504 case. `createdAt.gte` bounds it,
   * inside the adapter and behind the opaque cursor, so core never has to learn
   * that this source bootstraps by date and pages by id.
   */
  async listReturnFeed(input: ReturnFeedInput): Promise<ReturnFeedOutput> {
    const queryParams: Record<string, string | number> = { limit: input.limit };

    if (input.fromCursor) {
      queryParams.from = input.fromCursor;
    } else {
      queryParams['createdAt.gte'] = this.resolveReturnsBootstrapSince();
      this.logger.log(
        `No returns cursor for connection ${this.connectionId}: bootstrapping from ${queryParams['createdAt.gte']}`
      );
    }

    const response = await this.httpClient.get<AllegroCustomerReturnsResponse>(
      '/order/customer-returns',
      {
        queryParams,
        headers: { Accept: ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE },
      }
    );

    const wireItems = response.data.customerReturns ?? [];
    const items: ReturnFeedItem[] = [];
    let dropped = 0;
    for (const wire of wireItems) {
      const item = toReturnFeedItem(wire);
      if (item === null) {
        // Dropped here rather than emitted with a blank id: core REFUSES a blank
        // key (it has no conflict target, so every re-sync would insert another
        // copy), and the page must still be consumed or one malformed row wedges
        // the cursor permanently.
        dropped += 1;
        continue;
      }
      items.push(item);
    }
    if (dropped > 0) {
      this.logger.warn(
        `Dropped ${dropped} customer-return feed item(s) without an id (connection: ${this.connectionId})`
      );
    }

    // The cursor is the last id of THIS page. An empty page yields the cursor we
    // came in with, so the caller holds rather than blanking it — and a page
    // whose every row was dropped likewise cannot advance past rows nothing was
    // able to name.
    const lastItem = items[items.length - 1];
    const nextCursor = lastItem ? lastItem.externalReturnId : input.fromCursor;

    this.logger.debug(
      `Fetched ${items.length} customer return(s) (connection: ${this.connectionId}, nextCursor: ${nextCursor ?? 'none'})`
    );

    return { items, nextCursor: nextCursor ?? null };
  }

  /**
   * Hydrate one customer return by its Allegro-native id.
   *
   * This is both the hydration path for a newly discovered return AND — because
   * `CustomerReturn` carries no `updatedAt` and `/order/events` has no return
   * event type — the ONLY channel through which OL can ever observe one moving.
   * Identifier mapping happens downstream in core, never here.
   */
  async getReturn(input: { externalReturnId: string }): Promise<IncomingReturn> {
    const response = await this.httpClient.get<AllegroCustomerReturnWire>(
      `/order/customer-returns/${input.externalReturnId}`,
      { headers: { Accept: ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE } }
    );

    return toIncomingReturn(response.data);
  }

  // ---------------------------------------------------------------------------
  // ReturnDecliner (#2333) — the ONE customer-returns write
  //
  // `POST /order/customer-returns/{id}/rejection`, verified against
  // developer.allegro.pl/swagger.yaml (`CustomerReturnRefundRejectionRequest`).
  // Same `[BETA]` media type as the two reads, set per request — and here on
  // Content-Type as well as Accept, since this call has a body.
  // ---------------------------------------------------------------------------

  /**
   * Allegro's own rejection-code vocabulary, published to core as an opaque set.
   *
   * Core never interprets a member; an operator surface offers the choice. Same
   * contract as `terminalRawStatuses`, and the same reason: the source's
   * language stays adapter-side.
   */
  readonly declineReasonCodes: readonly string[] = ALLEGRO_RETURN_REJECTION_CODES;

  /**
   * Ask Allegro to reject a customer return's refund.
   *
   * Three behaviours are load-bearing rather than incidental.
   *
   * **The success body IS the confirmation.** A 200 returns the full
   * `CustomerReturn`, so `rejection.createdAt` is Allegro's own decline instant
   * and the proposed-then-confirmed cycle completes inside one call. That value
   * is passed straight through; this adapter never substitutes its own clock,
   * because core stamps `ReturnRecord.declinedAt` from it and an invented
   * instant would be indistinguishable from a marketplace observation.
   *
   * **A 422 means "already rejected", not "failed"** (the spec says so in as
   * many words). Treating it as an error would make a retry permanently red on
   * a return that is in fact declined, so the adapter re-reads the return and,
   * where the re-read shows a `rejection`, reports a normal success carrying the
   * real instant. A 422 whose re-read shows NO rejection is still a failure and
   * is rethrown — an unexplained 422 must not be laundered into a success.
   *
   * **Deterministic 4xx becomes the neutral refusal**, so core records "the
   * marketplace said no" as an ADR-044 outcome instead of a swallowed error.
   * 401/403/408/429 and every 5xx stay platform-native and propagate: OL does
   * not know whether Allegro applied the change, and the proposal must stay open
   * (in doubt) rather than be recorded as refused.
   */
  async declineReturn(command: ReturnDeclineCommand): Promise<ReturnDeclineResult> {
    const code = this.requireRejectionCode(command);
    const reason = this.resolveRejectionReason(command, code);

    const rejection: Record<string, unknown> = { code };
    if (reason !== null) {
      rejection.reason = reason;
    }

    let wire: AllegroCustomerReturnWire;
    try {
      const response = await this.httpClient.post<AllegroCustomerReturnWire>(
        `/order/customer-returns/${command.externalReturnId}/rejection`,
        { rejection },
        {
          headers: {
            Accept: ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE,
            'Content-Type': ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE,
          },
        }
      );
      wire = response.data;
    } catch (error) {
      return this.handleDeclineFailure(command.externalReturnId, error);
    }

    return this.toDeclineResult(wire);
  }

  /**
   * Validate the operator's code against Allegro's closed enum BEFORE the call.
   *
   * The platform states the vocabulary, so a miss is knowable here and answering
   * it locally turns a 400 into an immediate, explainable refusal. The neutral
   * error type is what keeps `AllegroApiException` — and the code list itself —
   * out of core.
   *
   * It is `ReturnDeclineInvalidRequestError`, NOT the by-source refusal: no
   * request has been made at this point, so recording OL's own message as
   * Allegro's would attribute a local validation fault to the marketplace.
   */
  private requireRejectionCode(command: ReturnDeclineCommand): string {
    const code = command.reasonCode?.trim() ?? '';
    if (!(ALLEGRO_RETURN_REJECTION_CODES as readonly string[]).includes(code)) {
      throw new ReturnDeclineInvalidRequestError(
        command.externalReturnId,
        'reasonCode',
        `"${command.reasonCode}" is not an Allegro rejection code (expected one of: ${ALLEGRO_RETURN_REJECTION_CODES.join(', ')})`
      );
    }
    return code;
  }

  /**
   * Apply Allegro's own conditional requirement on `reason`.
   *
   * Required when the code is `REFUND_REJECTED`, capped at 250 characters, and
   * blank-or-absent otherwise. Enforced here for the same reason as the code
   * check — and the cap TRUNCATES rather than refusing, because a long operator
   * comment is not a reason to abandon a decline the operator meant.
   */
  private resolveRejectionReason(
    command: ReturnDeclineCommand,
    code: string
  ): string | null {
    const comment = command.comment?.trim() ?? '';

    if (comment.length === 0) {
      if (code === ALLEGRO_RETURN_REJECTION_REASON_REQUIRED_FOR) {
        // Local, pre-request — see `requireRejectionCode`.
        throw new ReturnDeclineInvalidRequestError(
          command.externalReturnId,
          'comment',
          `Allegro requires a reason when the rejection code is ${ALLEGRO_RETURN_REJECTION_REASON_REQUIRED_FOR}`
        );
      }
      return null;
    }

    if (comment.length > ALLEGRO_RETURN_REJECTION_REASON_MAX_LENGTH) {
      this.logger.warn(
        `Truncating the decline reason for return ${command.externalReturnId} to Allegro's ${ALLEGRO_RETURN_REJECTION_REASON_MAX_LENGTH}-character limit`
      );
      return comment.slice(0, ALLEGRO_RETURN_REJECTION_REASON_MAX_LENGTH);
    }

    return comment;
  }

  /**
   * Turn a failed rejection POST into either a success (already rejected), the
   * neutral refusal, or a rethrow.
   */
  private async handleDeclineFailure(
    externalReturnId: string,
    error: unknown
  ): Promise<ReturnDeclineResult> {
    if (!(error instanceof AllegroApiException) || error.statusCode === undefined) {
      throw error;
    }

    if (error.statusCode === 422) {
      // "Might occur when customer return has already been rejected" — so ask.
      const existing = await this.httpClient.get<AllegroCustomerReturnWire>(
        `/order/customer-returns/${externalReturnId}`,
        { headers: { Accept: ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE } }
      );
      if (existing.data.rejection !== undefined) {
        this.logger.log(
          `Customer return ${externalReturnId} was already rejected at Allegro; reporting the existing rejection`
        );
        return this.toDeclineResult(existing.data);
      }
      throw error;
    }

    if (DETERMINISTIC_DECLINE_REFUSAL_STATUSES.includes(error.statusCode)) {
      throw new ReturnDeclineRejectedBySourceError(
        externalReturnId,
        this.describeAllegroErrors(error)
      );
    }

    throw error;
  }

  /**
   * Project the returned `CustomerReturn` onto the neutral result.
   *
   * An unparseable or absent `rejection.createdAt` degrades to `null` — the
   * "decline sent, not yet reported as a fact" state — rather than to
   * `new Date()`. Core is explicit that a 2xx alone must never read as
   * "declined by Allegro".
   */
  private toDeclineResult(wire: AllegroCustomerReturnWire): ReturnDeclineResult {
    const createdAt = wire.rejection?.createdAt;
    let declinedAt: Date | null = null;
    if (createdAt !== undefined) {
      const parsed = new Date(createdAt);
      if (Number.isNaN(parsed.getTime())) {
        this.logger.warn(
          `Allegro reported an unparseable rejection.createdAt "${createdAt}" for return ${wire.id ?? 'unknown'} — reporting the decline as sent but unconfirmed`
        );
      } else {
        declinedAt = parsed;
      }
    }

    return { declinedAt, rawStatus: wire.status ?? null, raw: wire };
  }

  /** Allegro's own words, never this adapter's interpretation of them. */
  private describeAllegroErrors(error: AllegroApiException): string {
    const details = (error.allegroErrors ?? [])
      .map((entry) => entry.userMessage ?? entry.message ?? entry.code)
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);

    return details.length > 0 ? details.join('; ') : error.message;
  }

  /**
   * The bootstrap floor for a connection with no cursor yet, as an ISO instant.
   *
   * Deliberately a WINDOW and not "everything" — see `listReturnFeed`. A first
   * run therefore does NOT backfill a seller's full return history; the
   * operator-facing backfill is a named follow-up rather than something this
   * method quietly half-does.
   */
  private resolveReturnsBootstrapSince(): string {
    const raw = Number(process.env.OL_ALLEGRO_RETURNS_BOOTSTRAP_DAYS);
    const days = Number.isFinite(raw) && raw > 0 ? raw : 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  /**
   * Hydrate a full order by Allegro-native checkout form id.
   *
   * Returns an `IncomingOrder` with the raw buyer details; identifier mapping
   * and identity resolution happen downstream in `OrderIngestionService`.
   */
  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const checkoutFormId = input.externalOrderId;
    this.logger.debug(
      `Fetching Allegro order by checkout form ID: ${checkoutFormId} (connection: ${this.connectionId})`
    );

    try {
      const response = await this.httpClient.get<AllegroCheckoutForm>(
        `/order/checkout-forms/${checkoutFormId}`
      );

      const checkoutForm = response.data;

      // #1160 follow-up: a checkout-form cancelled on Allegro's side — either
      // the transaction itself voided (`status === 'CANCELLED'`) or the
      // seller manually cancelling via the panel's "Status zamówienia"
      // dropdown (`fulfillment.status === 'CANCELLED'`, the ANULOWANE option)
      // — must surface as 'cancelled' here, or a resync that re-hydrates the
      // full order (as opposed to reacting to a `/order/events` CANCEL-type
      // feed entry) silently keeps reporting 'processing' forever, breaking
      // both the PrestaShop OrderStatusWriteback relay and the marketplace
      // stock-restore hook, which both key off `incoming.status ===
      // 'cancelled'`. Confirmed live during manual E2E testing of #1322: a
      // real Allegro sandbox order cancelled via the seller-panel dropdown
      // stayed 'processing' in OL after a poll re-synced it.
      const isCancelled =
        checkoutForm.status === 'CANCELLED' || checkoutForm.fulfillment?.status === 'CANCELLED';
      const status = isCancelled
        ? 'cancelled'
        : checkoutForm.payment.finishedAt
          ? 'processing'
          : 'pending';
      // Allegro's checkout-form carries no order-level created timestamp, so
      // `createdAt` is OpenLinker's ingestion time. The buyer-placed time lives
      // on `lineItems[].boughtAt` and is surfaced separately as `placedAt` (#926).
      const createdAt = new Date().toISOString();
      const updatedAt = checkoutForm.updatedAt ?? createdAt;
      const placedAt = this.resolvePlacedAt(checkoutForm.lineItems);

      // #454 — split totals: derive subtotal from line items, shipping from
      // delivery.cost (or fallback). Previously we used `totalToPay` as both
      // subtotal and total, which left PrestaShop with `total_shipping=0` and
      // a `Payment error` reconciliation gap on every Allegro order.
      const subtotal = checkoutForm.lineItems.reduce(
        (acc, item) => acc + Number.parseFloat(item.price.amount) * item.quantity,
        0
      );
      const total = Number.parseFloat(checkoutForm.summary.totalToPay.amount);
      const shipping = checkoutForm.delivery?.cost
        ? Number.parseFloat(checkoutForm.delivery.cost.amount)
        : Math.max(0, total - subtotal);

      // #1435 — for a cash-on-delivery order the buyer pays the full order total
      // on delivery, so the collectable amount is `summary.totalToPay` verbatim
      // (decimal string preserved, no float round-trip). Keyed off the neutral
      // payment status (reusing `deriveAllegroPaymentStatus`, not a duplicate
      // COD-type compare); absent for prepaid / awaiting orders.
      const paymentStatus = deriveAllegroPaymentStatus(checkoutForm.payment);
      const codToCollect =
        paymentStatus === PAYMENT_STATUS.Cod
          ? {
              amount: checkoutForm.summary.totalToPay.amount,
              currency: checkoutForm.summary.totalToPay.currency,
            }
          : undefined;

      const resolvedShippingAddress = this.resolveShippingAddress(checkoutForm);

      return {
        externalOrderId: checkoutFormId,
        orderNumber: checkoutFormId,
        // Seller Sales Center deep link (#1713) — checkoutFormId is Allegro's
        // native order id; the FE renders this as the source "Open order" link.
        externalUrl: getAllegroSalesCenterOrderUrl(this.environment, checkoutFormId),
        status,
        customerExternalId: checkoutForm.buyer.id,
        customerEmail: checkoutForm.buyer.email,
        items: checkoutForm.lineItems.map((lineItem) => {
          // #2249: Allegro's per-line tax, read as the CHANNEL rung of the
          // resolution chain. Nullable throughout, and a null stays absent -
          // never `0`, which would state a zero-rated sale. Offers OL published
          // before this epic report nothing here at all, which is exactly the
          // gap the propagation half closes.
          const neutralTaxRate = toNeutralTaxRate(lineItem.tax);
          return {
            id: lineItem.id,
            productRef: { type: 'offer' as const, externalId: lineItem.offer.id },
            quantity: lineItem.quantity,
            price: Number.parseFloat(lineItem.price.amount),
            sku: lineItem.offer.id,
            name: lineItem.offer.name,
            ...(neutralTaxRate ? { taxRate: neutralTaxRate } : {}),
            // imageUrl intentionally omitted — Allegro's checkout-form endpoint
            // does not expose a product image URL. Future enrichment from the
            // internal product catalog is tracked as a separate follow-up.
          };
        }),
        totals: {
          subtotal: roundCurrency(subtotal),
          tax: 0,
          shipping: roundCurrency(shipping),
          total: roundCurrency(total),
          currency: checkoutForm.summary.totalToPay.currency,
          // Allegro reports buyer-paid GROSS prices (line `price.amount` and
          // `summary.totalToPay` include tax); it does not decompose tax.
          // Destinations that price net use this to convert before pinning
          // (#895 / ADR-014).
          taxTreatment: 'inclusive',
        },
        shippingAddress: resolvedShippingAddress,
        billingAddress: this.resolveBillingAddress(checkoutForm, resolvedShippingAddress),
        shipping: this.resolveShipping(checkoutForm),
        pickupPoint: this.resolvePickupPoint(checkoutForm),
        deliverySmart: checkoutForm.delivery?.smart,
        paymentStatus,
        codToCollect,
        dispatchTime: this.resolveDispatchTime(checkoutForm),
        placedAt,
        createdAt,
        updatedAt,
        metadata: {
          buyer: {
            email: checkoutForm.buyer.email,
            login: checkoutForm.buyer.login,
          },
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch Allegro order ${checkoutFormId} (connection: ${this.connectionId}): ${(error as Error).message}`,
        error
      );
      throw error;
    }
  }

  /**
   * Resolve the shipping address from the checkout form.
   *
   * Resolution chain:
   *   1. `delivery.address` (#457) — buyer's checkout-time ship-to when present
   *      with real geography.
   *   2. `delivery.pickupPoint.address` (#458) — locker geography for pickup-point
   *      orders, where `delivery.address` is typically empty `{}`.
   *   3. `buyer.address` — the buyer's stored profile address as a final fallback.
   *
   * Empty-object guard for `delivery.address`: Allegro returns `{}` on pickup-point
   * orders (the locker address lives on `delivery.pickupPoint`). Without the guard
   * we'd emit empty strings for every address field — worse than the fallbacks.
   */
  private resolveShippingAddress(
    checkoutForm: AllegroCheckoutForm
  ): IncomingOrderAddress | undefined {
    const deliveryAddr = checkoutForm.delivery?.address;
    const hasDeliveryAddress = Boolean(
      deliveryAddr && (deliveryAddr.street || deliveryAddr.city || deliveryAddr.zipCode)
    );

    if (hasDeliveryAddress && deliveryAddr) {
      this.logger.debug(
        `Using delivery.address as shippingAddress for ${checkoutForm.id} (connection: ${this.connectionId})`
      );
      return {
        firstName: deliveryAddr.firstName,
        lastName: deliveryAddr.lastName,
        company: deliveryAddr.companyName,
        address1: deliveryAddr.street ?? '',
        city: deliveryAddr.city ?? '',
        postalCode: deliveryAddr.zipCode ?? '',
        country: deliveryAddr.countryCode ?? '',
        phone: deliveryAddr.phoneNumber,
      };
    }

    const pickupAddr = checkoutForm.delivery?.pickupPoint?.address;
    const hasPickupAddress = Boolean(
      pickupAddr && (pickupAddr.street || pickupAddr.city || pickupAddr.zipCode)
    );
    if (hasPickupAddress && pickupAddr) {
      this.logger.debug(
        `Using delivery.pickupPoint.address as shippingAddress for ${checkoutForm.id} (connection: ${this.connectionId})`
      );
      // The recipient is still the buyer; only the geography comes from the locker.
      return {
        firstName: checkoutForm.buyer.firstName,
        lastName: checkoutForm.buyer.lastName,
        address1: pickupAddr.street ?? '',
        city: pickupAddr.city ?? '',
        postalCode: pickupAddr.zipCode ?? '',
        country: pickupAddr.countryCode ?? '',
        phone: checkoutForm.buyer.phoneNumber,
      };
    }

    if (checkoutForm.buyer.address) {
      this.logger.debug(
        `Using buyer.address as shippingAddress fallback for ${checkoutForm.id} (connection: ${this.connectionId})`
      );
      return {
        firstName: checkoutForm.buyer.firstName,
        lastName: checkoutForm.buyer.lastName,
        address1: checkoutForm.buyer.address.street ?? '',
        city: checkoutForm.buyer.address.city ?? '',
        postalCode: checkoutForm.buyer.address.zipCode ?? '',
        country: checkoutForm.buyer.address.countryCode ?? '',
        phone: checkoutForm.buyer.phoneNumber,
      };
    }
    return undefined;
  }

  /**
   * Resolve `billingAddress` from the checkout form's VAT-invoice block
   * (#2822). Present only when the buyer requested a VAT invoice — a
   * private (non-invoice) checkout carries no `invoice.address.company` at
   * all, and `taxId` then stays `undefined` (unknown), never a false
   * asserted-none.
   *
   * Allegro's invoice block carries no street address of its own (only the
   * company name + tax id), so the result is the resolved SHIPPING address
   * with the company/tax-id fields overlaid — never a standalone object with
   * blank required fields, which would be truthy and defeat a caller's
   * `billingAddress ?? shippingAddress` fallback (e.g. the invoice-issuance
   * buyer-profile resolver) with an address that has no real street data.
   *
   * When `shippingAddress` itself could not be resolved (delivery address,
   * pickup-point address, and buyer profile address all absent/empty — see
   * `resolveShippingAddress`), there is no real address data to overlay the
   * company/tax-id onto, so `billingAddress` is `undefined` too rather than
   * falling back to the same blank-but-truthy stub this method exists to
   * eliminate. The company/tax-id are dropped in that (narrow) case; a
   * caller needing them without a real address has no representable answer
   * to give.
   *
   * Note this address is also consumed by destination-side provisioning
   * (`OrderProcessorManagerPort` adapters gate a second, billing-type
   * address creation on `order.billingAddress && order.customerId`) — a
   * VAT-invoice order therefore provisions a second destination address
   * carrying the same street data as the shipping one, plus this company
   * name (no `company`/`taxId` field reaches the destination address
   * itself; that is destination-adapter scope, not this adapter's).
   */
  private resolveBillingAddress(
    checkoutForm: AllegroCheckoutForm,
    shippingAddress: IncomingOrderAddress | undefined
  ): IncomingOrderAddress | undefined {
    const company = checkoutForm.invoice?.address?.company;
    if (!company || !shippingAddress) {
      return undefined;
    }

    // First-of-`ids[]`-wins is deliberate, pending a real multi-id sample:
    // `ids[].type` enumerates `PL_NIP | CZ_ICO | CZ_DIC | OTHER`, and a CZ
    // buyer may legitimately carry both `CZ_ICO` (company registration) and
    // `CZ_DIC` (VAT) — array order then decides which identifier is read.
    // `buyerHasTaxId` presence checks don't care which one wins; the value
    // is carried verbatim into invoice issuance, so a future sample of a
    // real multi-id payload should inform an explicit type preference here.
    const rawTaxId = company.ids?.[0]?.value ?? company.taxId;

    return {
      ...shippingAddress,
      company: company.name,
      taxId: readSourceBuyerTaxId(rawTaxId),
    };
  }

  /**
   * Resolve the source-side shipping reference (#455).
   *
   * Returns `{ methodId, methodName? }` when Allegro provides `delivery.method.id`.
   * Carrier mapping at the destination consumes `methodId`.
   */
  private resolveShipping(checkoutForm: AllegroCheckoutForm): OrderShipping | undefined {
    const method = checkoutForm.delivery?.method;
    if (!method?.id) {
      return undefined;
    }
    return { methodId: method.id, methodName: method.name };
  }

  /**
   * Resolve the buyer-placed timestamp (#926) from the earliest valid
   * `lineItems[].boughtAt` ("ISO date when offer was bought" — the field
   * Allegro itself sorts orders by). The line items of one checkout form are
   * bought together, so the earliest present value is the order-placed time.
   *
   * Unparseable / missing values are skipped so a malformed source value
   * degrades to `undefined` rather than producing an Invalid Date that would
   * throw downstream when the snapshot serializes it.
   */
  private resolvePlacedAt(lineItems: AllegroCheckoutForm['lineItems']): string | undefined {
    let earliestMs: number | undefined;
    let earliestIso: string | undefined;
    for (const item of lineItems) {
      if (typeof item.boughtAt !== 'string') {
        continue;
      }
      const ms = Date.parse(item.boughtAt);
      if (Number.isNaN(ms)) {
        continue;
      }
      if (earliestMs === undefined || ms < earliestMs) {
        earliestMs = ms;
        earliestIso = item.boughtAt;
      }
    }
    return earliestIso;
  }

  /**
   * Resolve the pickup-point reference (#458).
   *
   * Returns `{ id, name?, description? }` when Allegro provides `delivery.pickupPoint.id`.
   * Decoupled from `shippingAddress` so it survives address normalization and is
   * greppable for downstream module-aware integrations.
   */
  private resolvePickupPoint(checkoutForm: AllegroCheckoutForm): OrderPickupPoint | undefined {
    const pp = checkoutForm.delivery?.pickupPoint;
    if (!pp?.id) {
      return undefined;
    }
    return {
      id: pp.id,
      name: pp.name,
      description: pp.description,
      pointType: this.classifyPickupPointType(pp.id, pp.name),
    };
  }

  /**
   * Infer the InPost point kind (#1433) from the id/name only — no network
   * call in the ingestion hot path. A POP-prefixed id (case-insensitive) or a
   * "PaczkoPunkt" label ⇒ `pop`. Returns `undefined` when neither a POP signal
   * nor any other classifiable signal is present: Allegro exposes no locker-vs-
   * partner-point discriminator here, so absent a POP signal we stay truthful
   * (`undefined`) rather than confidently guessing `apm`.
   *
   * This is the heuristic half of the authoritative InPost classifier; it is
   * duplicated here as a tiny local rule rather than imported from
   * `@openlinker/integrations-inpost` to avoid an integration→integration
   * package dependency. Keep in sync with `classifyInpostPointType` in the
   * InPost ShipX mapper, whose ShipX `type`-based authoritative path runs where
   * a `/v1/points` lookup already happens (the pickup-point finder).
   *
   * The result is therefore best-effort at ingestion time: a `pop` here is a
   * heuristic match, and it (or the `undefined`) is superseded by the
   * authoritative ShipX `type`-based classification once the `/v1/points`
   * path resolves the point.
   */
  private classifyPickupPointType(id: string, name?: string): OrderPickupPointType | undefined {
    const idIsPop = id.toLowerCase().startsWith('pop-');
    const nameIsPop = (name ?? '').toLowerCase().includes('paczkopunkt');
    return idIsPop || nameIsPop ? 'pop' : undefined;
  }

  /**
   * Resolve the marketplace dispatch (ship-by) window (#927).
   *
   * Reads `delivery.time.dispatch.{from,to}` — the shipment window Allegro
   * populates for all delivery methods. `dispatch.to` is the ship-by deadline
   * the SLA surfaces. The deprecated, Kurier-X-press-only `delivery.time.guaranteed`
   * is intentionally NOT consumed. Returns `undefined` when neither bound is
   * present (older orders / sources without a dispatch SLA → graceful no-deadline).
   */
  private resolveDispatchTime(checkoutForm: AllegroCheckoutForm): OrderDispatchWindow | undefined {
    const dispatch = checkoutForm.delivery?.time?.dispatch;
    if (!dispatch?.from && !dispatch?.to) {
      return undefined;
    }
    return { from: dispatch.from, to: dispatch.to };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SourceOptionsReader (#472 / #474)
  //
  // `listOrderStatuses` and `listPaymentMethods` are static lookups — Allegro
  // does not expose live endpoints for these (see the doc-link comments in
  // `allegro-order-status.types.ts` and `allegro-payment-type.types.ts`).
  // `listDeliveryMethods` is the only live one: it walks the seller's rate-
  // tables (`/sale/shipping-rates` + per-id details) and flattens the
  // underlying carrier methods, deduped by methodId.
  // ─────────────────────────────────────────────────────────────────────────

  listOrderStatuses(): Promise<MappingOption[]> {
    return Promise.resolve([...ALLEGRO_ORDER_STATUS_OPTIONS]);
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return Promise.resolve([...ALLEGRO_PAYMENT_TYPE_OPTIONS]);
  }

  async listDeliveryMethods(): Promise<MappingOption[]> {
    // Step 1: list the seller's rate-tables AND fetch the canonical method
    // catalogue per relevant marketplace in parallel. The catalogue
    // (`/sale/delivery-methods`) is **per-marketplace-scoped**: querying
    // `?marketplace=allegro-pl` returns only PL-side methods. Polish sellers
    // doing cross-border have cenniki referencing methods from destination
    // marketplaces too (the buyer-side variant of an "International ... do
    // Czech" method lives under `allegro-cz`, etc.). To resolve every id a
    // PL-seller's cenniki can reference, we union the catalogues across PL +
    // CZ + SK + HU. Per-marketplace scoping is non-negotiable: dropping the
    // param entirely returns an empty list on sandbox.
    //
    // The set is hardcoded because OL today only supports PL-anchored
    // sellers; revisit when other Allegro markets come online.
    const sellerMarketplaces = ['allegro-pl', 'allegro-cz', 'allegro-sk', 'allegro-hu'] as const;
    const [rateSets, ...catalogueResponses] = await Promise.all([
      this.httpClient.get<AllegroShippingRatesResponse>('/sale/shipping-rates'),
      ...sellerMarketplaces.map((marketplace) =>
        this.httpClient.get<AllegroDeliveryMethodsResponse>('/sale/delivery-methods', {
          queryParams: { marketplace },
        })
      ),
    ]);
    const rateSetIds = (rateSets.data.shippingRates ?? []).map((r) => r.id);

    // Union catalogues across marketplaces. First-seen wins, but in practice
    // names are stable per id across markets — Allegro uses one global id
    // namespace per method. Per-marketplace sizes logged below for diagnostic.
    const nameById = new Map<string, string>();
    const perMarketplaceSizes = new Map<string, number>();
    for (let i = 0; i < sellerMarketplaces.length; i += 1) {
      const marketplace = sellerMarketplaces[i];
      const methods = catalogueResponses[i].data.deliveryMethods ?? [];
      perMarketplaceSizes.set(marketplace, methods.length);
      for (const method of methods) {
        if (!nameById.has(method.id)) {
          nameById.set(method.id, method.name);
        }
      }
    }

    this.logger.debug(
      `listDeliveryMethods: connection=${this.connectionId} rateSetIds=${rateSetIds.length} ` +
        `catalogue=${nameById.size} (per-marketplace: ${[...perMarketplaceSizes.entries()]
          .map(([m, n]) => `${m}=${n}`)
          .join(', ')})`
    );

    if (rateSetIds.length === 0) {
      this.logger.warn(
        `Allegro returned no shipping-rates for connection ${this.connectionId} — listDeliveryMethods is empty. Operator likely needs to configure cenniki in the seller portal first.`
      );
      return [];
    }

    // Step 2: fetch each rate-table's details in parallel. N+1 in the strict
    // sense but bounded — sellers typically have <20 rate-tables, and this is
    // an operator-driven endpoint (called when opening the carrier-mapping UI),
    // not a hot path. Caching is deferred to a follow-up if latency bites.
    const details = await Promise.all(
      rateSetIds.map((id) =>
        this.httpClient.get<AllegroShippingRateDetailResponse>(`/sale/shipping-rates/${id}`)
      )
    );

    // Step 3: flatten + dedup by methodId. Allegro returns the method object
    // under `deliveryMethod` per developer.allegro.pl/documentation#operation/getShippingRateUsingGET
    // — #494 fixed an earlier `rate.method` typo that silently produced [].
    // Resolve labels via the catalogue (#496); fall back to the rate's own
    // name if present, then the id (defensive — should be rare for properly-
    // configured cenniki).
    const seen = new Map<string, string>();
    for (const detail of details) {
      for (const rate of detail.data.rates ?? []) {
        const id = rate.deliveryMethod?.id;
        if (!id) continue;
        if (!seen.has(id)) {
          seen.set(id, nameById.get(id) ?? rate.deliveryMethod?.name ?? id);
        }
      }
    }
    const result = Array.from(seen.entries()).map(([value, label]) => ({ value, label }));

    // Defensive: if N rate-tables yielded M total rates but zero recognised
    // delivery methods, the API shape has likely regressed (or the parser is
    // looking at the wrong field). Surface it loudly so the next #494-class
    // bug doesn't ship silent.
    if (result.length === 0) {
      const totalRates = details.reduce((n, d) => n + (d.data.rates?.length ?? 0), 0);
      this.logger.warn(
        `Walked ${rateSetIds.length} rate-tables with ${totalRates} rates for connection ${this.connectionId} but produced 0 delivery methods — possible API shape regression.`
      );
    }

    // Diagnostic: any method id whose label fell through to the id itself
    // means the catalogue lookup missed. A few misses are tolerable (Allegro
    // can have legacy method-ids no longer in the catalogue), but a high
    // ratio means the marketplace scope is wrong, the catalogue is paginated,
    // or the id namespaces have drifted. Helps next-time-this-breaks debug.
    const unresolved = result.filter((r) => r.value === r.label);
    if (unresolved.length > 0) {
      this.logger.warn(
        `listDeliveryMethods: ${unresolved.length}/${result.length} method ids could not be resolved from /sale/delivery-methods catalogue (size=${nameById.size}) for connection ${this.connectionId} — labels falling back to UUIDs.`
      );
    }
    return result;
  }
}

function mapAllegroEventType(type: string): OrderFeedEventType {
  const t = type.toUpperCase();
  if (t.includes('CANCEL')) return 'cancelled';
  if (t.includes('PAID')) return 'paid';
  if (t.includes('BOUGHT')) return 'created';
  return 'updated';
}

/**
 * Round a number to 2-decimal currency precision.
 *
 * MVP: assumes 2-decimal currencies (PLN, EUR, USD). Allegro PL is the only
 * marketplace today, so PLN coverage is sufficient. Revisit when a non-2-decimal
 * currency surfaces (JPY = 0, BHD = 3, etc.) — likely via an Allegro CZ/SK seller.
 */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}
