/**
 * Amazon MCF Fulfillment Executor Adapter (#4185)
 *
 * `FulfillmentExecutorPort` over Amazon Multi-Channel Fulfillment: work routed
 * to this connection (an order from Allegro or a shop, stock in Amazon's
 * warehouses) is packed and shipped by Amazon.
 *
 *   - `requestFulfillment`: the MCF order id is derived from the work's
 *     idempotency key (`amazonMcfOrderId`), and the order is read first, so a
 *     retry of the same attempt finds the order it created and answers the same
 *     acceptance instead of creating a second one. A new order is previewed
 *     first: work Amazon cannot fulfil (not in FBA stock, an SKU it does not
 *     know) is rejected, blocking, with Amazon's reasons, as is work whose
 *     variant has no Amazon SKU or whose order has no delivery address (buyer
 *     data not stored or an incomplete address, ADR-062 § Amendment (#4185)). `acceptedAt` is Amazon's
 *     `receivedDate`.
 *   - `requestCancellation`: an order still `New`, `Received` or `Planning` is
 *     cancelled; once Amazon is processing or has shipped it, the cancellation
 *     is refused (not blocking): the parcel is Amazon's to send. An order that
 *     is already cancelled, or that was never created, answers accepted.
 *   - `FulfillmentStatusSource`: `getFulfillmentOrder` as work counters, one
 *     line per order item (the item id IS the work line id), shipped units from
 *     the `SHIPPED` shipments, cancelled and unfulfillable units as cancelled.
 *
 * The Amazon SKU of a work line is the variant's `ProductVariant` mapping on this
 * connection, which Amazon as InventoryMaster creates when it reads FBA stock
 * (#4183); MCF therefore needs the connection to be the stock master too. A
 * connection that only links offers has no such mapping and its work is
 * rejected as `sku-not-on-amazon`.
 *
 * `acceptedAt` is read back right after the create; if Amazon does not list the
 * new order yet it is `null`, and a later replay of the same key reports the
 * `receivedDate`. Core records an acceptance once (`acceptedAt IS NULL`), so
 * the difference changes nothing it stores.
 *
 * Each order's line items carry the work line id as `sellerFulfillmentOrderItemId`
 * (a UUID, within Amazon's 50 characters), which is what maps Amazon's answer
 * back onto the work. The latest MCF order id of a work is kept in the host
 * cache for the status read; without it the read probes the first attempts.
 *
 * Not verified on a live account (#4185 research criterion): the calls need the
 * "Amazon Fulfillment" role and have no static sandbox.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/fulfillment-executor
 * @implements {FulfillmentExecutorPort}
 */
import {
  CORE_ENTITY_TYPE,
  type IdentifierMappingPort,
} from '@openlinker/core/identifier-mapping';
import type {
  FulfillmentCancellationRequest,
  FulfillmentDeliveryAddress,
  FulfillmentExecutorPort,
  FulfillmentProgressLine,
  FulfillmentProgressSnapshot,
  FulfillmentRequest,
  FulfillmentRequestResult,
  FulfillmentStatusSource,
  FulfillmentWorkRef,
} from '@openlinker/core/fulfillment';
import type { CachePort } from '@openlinker/shared';

import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import {
  amazonMcfDisplayableOrderId,
  amazonMcfOrderId,
  dispatchKeyOfCancellation,
} from '../../../domain/policies/amazon-mcf-order-id.policy';
import type {
  AmazonMcfAddress,
  AmazonMcfItemRequest,
  AmazonMcfOrderResponse,
  AmazonMcfShippingSpeed,
} from '../../../domain/types/amazon-mcf.types';
import type { AmazonFulfillmentOutboundClient } from '../../http/amazon-fulfillment-outbound.client';

/** Amazon cancels an MCF order only before it starts processing it. */
const CANCELLABLE_STATUSES = new Set(['New', 'Received', 'Planning']);
const ORDER_COMMENT = 'Thank you for your order.';
/** How many attempts a status read probes when the cache does not know the work's order. */
const MAX_PROBED_ATTEMPTS = 10;
const WORK_ORDER_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface AmazonMcfExecutorOptions {
  readonly connectionId: string;
  readonly marketplaceId: string;
  readonly shippingSpeed: AmazonMcfShippingSpeed;
  readonly now?: () => Date;
}

export class AmazonMcfFulfillmentExecutorAdapter implements FulfillmentExecutorPort, FulfillmentStatusSource {
  private readonly now: () => Date;

  constructor(
    private readonly outbound: AmazonFulfillmentOutboundClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly options: AmazonMcfExecutorOptions,
    private readonly cache?: CachePort,
  ) {
    this.now = options.now ?? ((): Date => new Date());
  }

  async requestFulfillment(req: FulfillmentRequest): Promise<FulfillmentRequestResult> {
    const orderId = amazonMcfOrderId(req.idempotencyKey);
    const existing = await this.outbound.get(orderId);
    if (existing !== null) {
      await this.rememberOrder(req.work.workId, orderId);
      return accepted(orderId, existing);
    }

    if (req.deliveryAddress === null || req.deliveryAddress === undefined) {
      return req.shipTo.mode === 'hashed'
        ? rejected(
            'buyer-data-not-stored',
            true,
            'OpenLinker does not keep buyer addresses on this installation, so Amazon cannot be told where to ship',
          )
        : rejected(
            'delivery-address-incomplete',
            true,
            'The order has no complete delivery address (name, street, city, postcode and country)',
          );
    }
    const items: AmazonMcfItemRequest[] = [];
    for (const line of req.lines) {
      const sku = await this.amazonSku(line.productVariantId);
      if (sku === null) {
        return rejected('sku-not-on-amazon', true, `variant ${line.productVariantId} has no Amazon SKU on this connection`);
      }
      items.push({ sellerSku: sku, sellerFulfillmentOrderItemId: line.workLineId, quantity: line.quantity });
    }
    const address = toAmazonAddress(req.deliveryAddress);

    const preview = await this.outbound.preview(this.options.marketplaceId, address, items, this.options.shippingSpeed);
    const option = preview.payload?.fulfillmentPreviews?.[0];
    if (option === undefined || option.isFulfillable !== true) {
      const reasons = (option?.unfulfillablePreviewItems ?? []).flatMap((item) =>
        (item.itemUnfulfillableReasons ?? []).map((reason) => `${item.sellerSku ?? '?'}: ${reason}`),
      );
      return rejected(
        'not-fulfillable-by-amazon',
        true,
        reasons.length > 0 ? reasons.join('; ') : 'Amazon cannot fulfil this order from FBA stock',
      );
    }

    try {
      await this.outbound.create({
        marketplaceId: this.options.marketplaceId,
        sellerFulfillmentOrderId: orderId,
        displayableOrderId: amazonMcfDisplayableOrderId(req.orderId),
        displayableOrderDate: this.now().toISOString(),
        displayableOrderComment: ORDER_COMMENT,
        shippingSpeedCategory: this.options.shippingSpeed,
        destinationAddress: address,
        items,
      });
    } catch (error) {
      if (error instanceof AmazonApiError && error.statusCode === 400) {
        // A create that raced a retry is answered by reading the order. An
        // `InvalidInput` refusal (an address field, a listing state) is
        // Amazon's verdict on this order and would be repeated, so it is
        // blocking: a non-blocking rejection lets re-sourcing pick Amazon again
        // for the same work, in a loop (fulfillment-execution types, property
        // (a)). Any other 400 may clear (an SKU still activating) and leaves
        // Amazon a candidate.
        const raced = await this.outbound.get(orderId);
        if (raced !== null) {
          await this.rememberOrder(req.work.workId, orderId);
          return accepted(orderId, raced);
        }
        return rejected('refused-by-amazon', error.errorCode === 'InvalidInput', error.message);
      }
      throw error;
    }
    await this.rememberOrder(req.work.workId, orderId);
    const created = await this.outbound.get(orderId);
    return accepted(orderId, created);
  }

  async requestCancellation(req: FulfillmentCancellationRequest): Promise<FulfillmentRequestResult> {
    const orderId = amazonMcfOrderId(dispatchKeyOfCancellation(req.idempotencyKey));
    const order = await this.outbound.get(orderId);
    const status = order?.payload?.fulfillmentOrder?.fulfillmentOrderStatus;
    if (order === null || status === 'Cancelled' || status === 'Unfulfillable' || status === 'Invalid') {
      return { status: 'accepted', externalWorkId: order === null ? null : orderId, acceptedAt: null };
    }
    if (status === undefined || !CANCELLABLE_STATUSES.has(status)) {
      return rejected('already-processing', false, `Amazon is already handling the order (${status ?? 'unknown'})`);
    }
    try {
      await this.outbound.cancel(orderId);
    } catch (error) {
      if (error instanceof AmazonApiError && error.statusCode === 400) {
        return rejected('cancellation-refused', false, error.message);
      }
      throw error;
    }
    return { status: 'accepted', externalWorkId: orderId, acceptedAt: null };
  }

  async getWorkFulfillmentStatus(workRef: FulfillmentWorkRef): Promise<FulfillmentProgressSnapshot> {
    const found = await this.findWorkOrder(workRef.workId);
    if (found === null) {
      return { work: workRef, externalWorkId: null, lines: [], observedAt: null };
    }
    const { orderId, order } = found;
    const payload = order.payload;
    const shipped = new Map<string, number>();
    for (const shipment of payload?.fulfillmentShipments ?? []) {
      if (shipment.fulfillmentShipmentStatus !== 'SHIPPED') continue;
      for (const item of shipment.fulfillmentShipmentItem ?? []) {
        if (item.sellerFulfillmentOrderItemId === undefined) continue;
        shipped.set(
          item.sellerFulfillmentOrderItemId,
          (shipped.get(item.sellerFulfillmentOrderItemId) ?? 0) + count(item.quantity),
        );
      }
    }
    const lines: FulfillmentProgressLine[] = (payload?.fulfillmentOrderItems ?? []).map((item) => {
      const total = count(item.quantity);
      const cancelled = Math.min(total, count(item.cancelledQuantity) + count(item.unfulfillableQuantity));
      return {
        workLineId: item.sellerFulfillmentOrderItemId,
        fulfilledQuantity: Math.min(total - cancelled, shipped.get(item.sellerFulfillmentOrderItemId) ?? 0),
        cancelledQuantity: cancelled,
      };
    });
    return {
      work: workRef,
      externalWorkId: orderId,
      lines,
      observedAt: toDate(payload?.fulfillmentOrder?.statusUpdatedDate),
    };
  }

  // ── Helpers ─────────────────────────────────────────────────

  private async amazonSku(productVariantId: string): Promise<string | null> {
    const mappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.ProductVariant, productVariantId);
    return mappings.find((mapping) => mapping.connectionId === this.options.connectionId)?.externalId ?? null;
  }

  private cacheKey(workId: string): string {
    return `amazon:mcf-order:${this.options.connectionId}:${workId}`;
  }

  private async rememberOrder(workId: string, orderId: string): Promise<void> {
    await this.cache?.set(this.cacheKey(workId), orderId, WORK_ORDER_TTL_SECONDS).catch(() => undefined);
  }

  /** The work's latest MCF order: from the cache, else the highest of the first attempts that exists. */
  private async findWorkOrder(workId: string): Promise<{ orderId: string; order: AmazonMcfOrderResponse } | null> {
    const cached = this.cache ? await this.cache.get<string>(this.cacheKey(workId)).catch(() => null) : null;
    if (cached) {
      const order = await this.outbound.get(cached);
      if (order !== null) return { orderId: cached, order };
    }
    let found: { orderId: string; order: AmazonMcfOrderResponse } | null = null;
    for (let attempt = 1; attempt <= MAX_PROBED_ATTEMPTS; attempt += 1) {
      const orderId = amazonMcfOrderId(`work:${workId}:${attempt}`);
      const order = await this.outbound.get(orderId);
      if (order === null) break;
      found = { orderId, order };
    }
    return found;
  }
}

function accepted(orderId: string, order: AmazonMcfOrderResponse | null): FulfillmentRequestResult {
  return {
    status: 'accepted',
    externalWorkId: orderId,
    acceptedAt: toDate(order?.payload?.fulfillmentOrder?.receivedDate),
  };
}

function rejected(reason: string, blocking: boolean, detail: string): FulfillmentRequestResult {
  return { status: 'rejected', reason, blocking, detail };
}

function toAmazonAddress(address: FulfillmentDeliveryAddress): AmazonMcfAddress {
  return {
    name: address.recipientName,
    addressLine1: address.addressLine1,
    ...(address.addressLine2 ? { addressLine2: address.addressLine2 } : {}),
    city: address.city,
    ...(address.region ? { stateOrRegion: address.region } : {}),
    postalCode: address.postalCode,
    countryCode: address.countryIso2,
    ...(address.phone ? { phone: address.phone } : {}),
  };
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
