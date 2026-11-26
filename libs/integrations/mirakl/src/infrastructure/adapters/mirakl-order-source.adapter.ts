/**
 * Mirakl Order Source Adapter
 *
 * `OrderSourcePort` over Mirakl OR11 (`GET /api/orders`). Mirakl offers sellers
 * no webhooks and no change journal, so the feed is a poll over closed
 * `last_updated_date` windows (`mirakl-order-feed.policy.ts`).
 *
 * **This read path writes.** Before reading a page, `listOrderFeed` accepts
 * every order waiting for acceptance (OR21) unless the connection sets
 * `orderAcceptance: 'off'`. It is done here deliberately:
 *
 * - On Mirakl an order is not an order until the seller accepts each line, and
 *   it lapses after the operator's deadline (5 days on Empik). Every other
 *   source delivers orders already accepted, so core has no step for it.
 * - The orders poll is the only thing that ever sees a new Mirakl order, so
 *   accepting there is the one place that cannot be skipped.
 * - An accepted order changes `last_updated_date` and so comes back through the
 *   feed itself on this or the next poll; nothing else needs to remember it.
 *
 * A stock-checked or manual acceptance needs a core sub-capability and a job
 * type of its own; that is a follow-up, not this adapter.
 *
 * Orders still in `STAGING` or `WAITING_ACCEPTANCE` are never part of the feed.
 *
 * The same adapter carries the order's way back (#4276), each part in its own
 * class: the status writeback (OR23/OR24 ship, OR29 cancel), the fulfilment
 * readback (OR11), the source options (SH12) and the invoice upload (OR74),
 * the returns feed (RT11, #4279) and the refunds already paid on an order
 * (OR11). Sending a refund (OR28) is opt-in and lives in
 * {@link MiraklRefundingOrderSourceAdapter}, because core finds a refund
 * executor by the presence of `executeRefund`.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 * @implements {OrderStatusWriteback}
 * @implements {OrderFulfillmentReadback}
 * @implements {SourceOptionsReader}
 * @implements {OrderBillingDocumentUploader}
 * @implements {ReturnSourceReader}
 * @implements {RefundSourceReader}
 */
import type {
  IncomingOrder,
  MappingOption,
  OrderBillingDocumentUploader,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderFulfillmentReadback,
  OrderLifecycleEvent,
  OrderSourcePort,
  OrderStatusWriteback,
  OrderWritebackResult,
  SourceFulfillmentReadback,
  SourceOptionsReader,
  UploadBillingDocumentInput,
  ReturnSourceReader,
  UploadBillingDocumentResult,
  ExecuteRefundCommand,
  RefundExecutionResult,
  RefundExecutor,
  RefundSourceReader,
  SourceRefundObservation,
} from '@openlinker/core/orders';
import type { IncomingReturn, ReturnFeedInput, ReturnFeedOutput } from '@openlinker/core/returns';
import type { CachePort } from '@openlinker/shared/cache';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import {
  buildFeedEventKey,
  computeFeedWindow,
  deriveFeedEventType,
  halveFeedWindow,
  INGESTIBLE_ORDER_STATES,
  type MiraklFeedWindow,
} from '../../domain/policies/mirakl-order-feed.policy';
import type { MiraklOrderAcceptance } from '../../domain/types/mirakl-connection.types';
import type { MiraklOrder } from '../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { listAllOffset, MIRAKL_MAX_PAGE_SIZE } from '../http/mirakl-pagination';
import { MiraklFulfillmentReadback } from './mirakl-fulfillment-readback';
import { MiraklOrderAcceptor } from './mirakl-order-acceptor';
import { MiraklOrderDocumentUploader } from './mirakl-order-document-uploader';
import { MIRAKL_ORDERS_PATH, readMiraklOrder } from './mirakl-order-reader';
import { MiraklOrderStatusWriter } from './mirakl-order-status-writer';
import { mapMiraklOrderToIncomingOrder, type MiraklOrderLineRefKind } from './mirakl-order.mapper';
import type { MiraklRefundExecutor } from './mirakl-refunds';
import { MiraklRefundReader } from './mirakl-refunds';
import { MiraklReturnSource } from './mirakl-return-source';
import { MiraklSourceOptions } from './mirakl-source-options';

const ORDERS_PATH = MIRAKL_ORDERS_PATH;
/** Generic name used in operator-facing sentences when no profile is given. */
const DEFAULT_BRAND = 'Mirakl';
/** Mirakl's own default invoice document type. */
const DEFAULT_INVOICE_TYPE_CODE = 'CUSTOMER_INVOICE';

/** Per-connection settings for the order source and its way back. */
export interface MiraklOrderSourceOptions {
  /** Operator name for operator-facing sentences, e.g. `Empik`. */
  readonly brand?: string;
  /** `config.carrierCodes`, already validated. */
  readonly carrierCodes?: Readonly<Record<string, string>>;
  /** The operator profile's OR74 invoice document type. */
  readonly invoiceTypeCode?: string;
  /**
   * The connection is the catalogue master (#4284): order lines name the
   * product (keyed by `shop_sku`) instead of the offer.
   */
  readonly catalogMaster?: boolean;
  /**
   * Host cache, read to skip refunds OpenLinker sent itself when observing
   * refunds (see `mirakl-refunds.ts`).
   */
  readonly cache?: CachePort;
  readonly now?: () => Date;
}
/**
 * How often a window that does not fit the page budget is halved. Sixteen
 * halvings take the 7-day bootstrap window under a minute; past that the read
 * advances anyway and says so.
 */
const MAX_WINDOW_HALVINGS = 16;

export class MiraklOrderSourceAdapter
  implements
    OrderSourcePort,
    OrderStatusWriteback,
    OrderFulfillmentReadback,
    SourceOptionsReader,
    OrderBillingDocumentUploader,
    ReturnSourceReader,
    RefundSourceReader
{
  private readonly logger = new Logger(MiraklOrderSourceAdapter.name);
  private readonly now: () => Date;
  private readonly statusWriter: MiraklOrderStatusWriter;
  private readonly readback: MiraklFulfillmentReadback;
  private readonly options: MiraklSourceOptions;
  private readonly documentUploader: MiraklOrderDocumentUploader;
  private readonly returns: MiraklReturnSource;
  private readonly refunds: MiraklRefundReader;
  private readonly lineRef: MiraklOrderLineRefKind;
  readonly terminalRawStatuses: readonly string[];

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly acceptance: MiraklOrderAcceptance,
    settings: MiraklOrderSourceOptions = {}
  ) {
    const brand = settings.brand ?? DEFAULT_BRAND;
    this.now = settings.now ?? ((): Date => new Date());
    this.lineRef = settings.catalogMaster === true ? 'product' : 'offer';
    this.statusWriter = new MiraklOrderStatusWriter(
      connectionId,
      httpClient,
      brand,
      settings.carrierCodes ?? {}
    );
    this.readback = new MiraklFulfillmentReadback(connectionId, httpClient, brand);
    this.options = new MiraklSourceOptions(httpClient);
    this.documentUploader = new MiraklOrderDocumentUploader(
      connectionId,
      httpClient,
      brand,
      settings.invoiceTypeCode ?? DEFAULT_INVOICE_TYPE_CODE
    );
    this.returns = new MiraklReturnSource(connectionId, httpClient, this.now);
    this.refunds = new MiraklRefundReader(connectionId, httpClient, settings.cache);
    this.terminalRawStatuses = this.returns.terminalRawStatuses;
  }

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    if (this.acceptance === 'auto') {
      await new MiraklOrderAcceptor(this.connectionId, this.httpClient).acceptWaitingOrders();
    }

    const maxPages = Math.max(1, Math.ceil(input.limit / MIRAKL_MAX_PAGE_SIZE));
    let window = computeFeedWindow(input.fromCursor, this.now());
    let orders = await this.readWindow(window, maxPages);
    for (let halvings = 0; orders.truncated && halvings < MAX_WINDOW_HALVINGS; halvings++) {
      window = halveFeedWindow(window);
      orders = await this.readWindow(window, maxPages);
    }
    if (orders.truncated) {
      this.logger.error(
        `Order feed on connection ${this.connectionId} still did not fit ${maxPages} page(s) ` +
          `after ${MAX_WINDOW_HALVINGS} halvings (window ${window.from.toISOString()} - ` +
          `${window.to.toISOString()}); advancing past it, so orders in it may be missed`
      );
    }

    return {
      items: this.toFeedItems(orders.items, window, input.eventTypes),
      nextCursor: window.to.toISOString(),
    };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const order = await readMiraklOrder(this.httpClient, input.externalOrderId);
    if (!order) {
      throw new MiraklApiException(
        `Mirakl order ${input.externalOrderId} not found`,
        404,
        'ORDER_NOT_FOUND'
      );
    }
    return mapMiraklOrderToIncomingOrder(order, { lineRef: this.lineRef });
  }

  write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    return this.statusWriter.write(event);
  }

  readFulfillment(input: { externalOrderId: string }): Promise<SourceFulfillmentReadback> {
    return this.readback.readFulfillment(input);
  }

  listOrderStatuses(): Promise<MappingOption[]> {
    return this.options.listOrderStatuses();
  }

  listDeliveryMethods(): Promise<MappingOption[]> {
    return this.options.listDeliveryMethods();
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return this.options.listPaymentMethods();
  }

  uploadBillingDocument(input: UploadBillingDocumentInput): Promise<UploadBillingDocumentResult> {
    return this.documentUploader.uploadBillingDocument(input);
  }

  listReturnFeed(input: ReturnFeedInput): Promise<ReturnFeedOutput> {
    return this.returns.listReturnFeed(input);
  }

  getReturn(input: { externalReturnId: string }): Promise<IncomingReturn> {
    return this.returns.getReturn(input);
  }

  listRefunds(input: { externalOrderId: string }): Promise<SourceRefundObservation[]> {
    return this.refunds.listRefunds(input);
  }

  private readWindow(
    window: MiraklFeedWindow,
    maxPages: number
  ): Promise<{ items: MiraklOrder[]; truncated: boolean }> {
    return listAllOffset<MiraklOrder>(this.httpClient, ORDERS_PATH, {
      itemsKey: 'orders',
      maxPages,
      queryParams: {
        order_state_codes: INGESTIBLE_ORDER_STATES.join(','),
        start_update_date: window.from.toISOString(),
        end_update_date: window.to.toISOString(),
      },
    });
  }

  private toFeedItems(
    orders: readonly MiraklOrder[],
    window: MiraklFeedWindow,
    eventTypes: OrderFeedInput['eventTypes']
  ): OrderFeedItem[] {
    const items: OrderFeedItem[] = [];
    const seen = new Set<string>();
    for (const order of orders) {
      if (!order.order_id) {
        this.logger.warn(`Skipping an order without order_id on connection ${this.connectionId}`);
        continue;
      }
      const eventKey = buildFeedEventKey(
        order.order_id,
        order.last_updated_date,
        order.created_date
      );
      const eventType = deriveFeedEventType(order.order_state);
      // Offset paging over a set that changes while it is read can return an
      // order twice; one event per change is enough.
      if (seen.has(eventKey) || (eventTypes && !eventTypes.includes(eventType))) {
        continue;
      }
      seen.add(eventKey);
      items.push({
        externalOrderId: order.order_id,
        eventType,
        occurredAt: order.last_updated_date ?? window.to.toISOString(),
        eventKey,
        eventId: eventKey,
      });
    }
    return items;
  }
}

/**
 * The order source of a connection that opted in to sending refunds
 * (`config.refundsThroughMarketplace: true`). A class of its own rather than a
 * flag: core treats any adapter with `executeRefund` as a refund executor.
 *
 * @implements {RefundExecutor}
 */
export class MiraklRefundingOrderSourceAdapter
  extends MiraklOrderSourceAdapter
  implements RefundExecutor
{
  constructor(
    connectionId: string,
    httpClient: IMiraklHttpClient,
    acceptance: MiraklOrderAcceptance,
    settings: MiraklOrderSourceOptions,
    private readonly refundExecutor: MiraklRefundExecutor
  ) {
    super(connectionId, httpClient, acceptance, settings);
  }

  executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    return this.refundExecutor.executeRefund(command);
  }
}
