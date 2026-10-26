/**
 * Shoper Order Status Writer
 *
 * The one `OrderStatusWriteback` implementation for a Shoper order, whatever role
 * the shop plays in it. The lifecycle relay (ADR-027) resolves a participant
 * through its destination capability first and its source capability second, so
 * a Shoper shop that only SOURCES an order is reached through the order source
 * adapter and one that only RECEIVES it through the order processor; both
 * delegate here, so the two roles cannot write the same event differently.
 *
 * - `dispatched` -> a parcel carrying the tracking number (#3643), written under
 *   the order's own shipping method first so it carries the carrier the buyer
 *   chose. Shoper's API refuses a parcel for some methods (the carrier-integrated
 *   ones) with "Nie znaleziono wartości"; on exactly that answer the parcel falls
 *   back to `defaults.parcelShippingId`, else the shop's first plain method, and
 *   the refusal is remembered so it costs one rejected call per method, not one
 *   per dispatch.
 * - `cancelled` -> the order moves to a cancelled-type status (`PUT /orders/:id`).
 * - `in-progress` -> the order moves to an in-progress-type status.
 * - `delivered` -> unsupported: Shoper has no delivered status.
 *
 * Never throws: a failure is reported as `rejected` with the reason, since the
 * relay surfaces outcomes to the operator rather than retrying a throw.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/order-status
 * @implements {OrderStatusWriteback}
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type {
  OrderLifecycleEvent,
  OrderStatusWriteback,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import type {
  ShoperOrderShipping,
  ShoperOrderStatusUpdate,
  ShoperParcel,
  ShoperParcelTrackingUpdate,
  ShoperShippingRow,
} from '../../../domain/types/shoper-api.types';
import type { ShoperStatusWritebackTarget } from '../../../domain/types/shoper-order-status.types';
import type {
  ShoperParcelPostOutcome,
  ShoperParcelShippingChoice,
} from '../../../domain/types/shoper-parcel.types';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchAllShoperRows } from '../../http/shoper-pagination';
import { readDefaults, toPositiveInt } from '../../mappers/shoper-order-input.mapper';
import {
  buildShoperParcelCreateRequest,
  normalizeTrackingNumber,
  planShoperParcelWrite,
  selectShoperParcelFallbackShipping,
} from '../../mappers/shoper-parcel.mapper';
import {
  pickShoperWritebackStatus,
  planShoperStatusWriteback,
} from '../../mappers/shoper-status-writeback.mapper';
import type { ShoperOrderReferenceProvider } from '../../shop-context/shoper-order-reference.provider';
import { ShoperParcelShippingRefusalProvider } from '../../shop-context/shoper-parcel-shipping-refusal.provider';

const ORDER_ID = /^\d+$/;

/** Config key named in every "no usable method" refusal, so the operator knows what to set. */
const PARCEL_SHIPPING_KEY = 'defaults.parcelShippingId';

const STATUS_KEY: Readonly<Record<ShoperStatusWritebackTarget, string>> = {
  cancelled: 'defaults.cancelledStatusId',
  'in-progress': 'defaults.inProgressStatusId',
};

const STATUS_LABEL: Readonly<Record<ShoperStatusWritebackTarget, string>> = {
  cancelled: 'cancelled',
  'in-progress': 'in progress',
};

export class ShoperOrderStatusWriter implements OrderStatusWriteback {
  private readonly logger = new Logger(ShoperOrderStatusWriter.name);

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly connection: Connection,
    private readonly reference: ShoperOrderReferenceProvider,
    /**
     * Shipping methods Shoper refused a parcel for. The factory passes one backed
     * by the host cache; the default remembers for this instance only, which
     * degrades to "try the order's method, then fall back" on every dispatch.
     */
    private readonly parcelShippingRefusals: ShoperParcelShippingRefusalProvider =
      new ShoperParcelShippingRefusalProvider(),
  ) {}

  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    // Path-traversal defence: the id is interpolated into a URL path.
    if (!ORDER_ID.test(event.externalOrderId)) {
      return {
        outcome: 'rejected',
        detail: `Invalid externalOrderId "${event.externalOrderId}" - expected a Shoper order id`,
      };
    }

    try {
      switch (event.type) {
        case 'dispatched':
          return await this.writeDispatched(event.externalOrderId, normalizeTrackingNumber(event.trackingNumber));

        // No cancel is written at all, so there is nowhere for a cancel reason to
        // go (#3540); it stays in OpenLinker.
        case 'cancelled':
          return await this.writeStatus(event.externalOrderId, 'cancelled');

        case 'in-progress':
          return await this.writeStatus(event.externalOrderId, 'in-progress');

        case 'delivered':
          // Shoper's status types stop at "completed"; no status says delivered.
          return {
            outcome: 'unsupported',
            detail: 'Shoper has no delivered order status; the order stays in its completed status',
          };

        default: {
          // Compile break when a lifecycle member is added (#2286); returns rather
          // than throws so a widened union degrades to a surfaced no-op (ADR-055).
          const unhandled: never = event;
          return {
            outcome: 'unsupported',
            detail: `unsupported order lifecycle event: ${JSON.stringify(unhandled)}`,
          };
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `OrderStatusWriteback '${event.type}' failed for Shoper order ${event.externalOrderId}: ` +
          `${detail} (connection: ${this.connection.id})`,
        error instanceof Error ? error.stack : undefined,
      );
      return { outcome: 'rejected', detail };
    }
  }

  // ─── dispatched ────────────────────────────────────────────────────────────

  private async writeDispatched(
    externalOrderId: string,
    trackingNumber: string | undefined,
  ): Promise<OrderWritebackResult> {
    const parcels = await this.client.get<{ list?: readonly ShoperParcel[]; pages?: number | string }>(
      '/parcels',
      { 'filters[order_id]': externalOrderId, limit: SHOPER_MAX_PAGE_SIZE },
    );
    const rows = parcels.data.list ?? [];
    // Every guard below is downstream of this read, and an ignored filter would
    // look exactly like "this order has no parcels" - a duplicate shipment record
    // that no retry undoes. A row of ANOTHER order is positive proof the filter
    // was not honoured, so refuse rather than conclude anything from the rest.
    if (rows.some((p) => String(p.order_id) !== externalOrderId)) {
      return {
        outcome: 'rejected',
        detail:
          `Shoper returned parcels of other orders for order ${externalOrderId}, so the ` +
          '`filters[order_id]` filter on /parcels was not honoured; refusing to write a parcel ' +
          'it cannot check for duplicates',
      };
    }
    // The filter works but the answer is incomplete: the parcel we would find or
    // conflict with may be on a page this read never saw.
    if (Number(parcels.data.pages ?? 1) > 1) {
      return {
        outcome: 'rejected',
        detail:
          `Shoper order ${externalOrderId} has more than ${SHOPER_MAX_PAGE_SIZE} parcels, ` +
          'which this read does not page through; refusing to write a parcel it cannot check for duplicates',
      };
    }
    // No lock around read-then-write, deliberately: a conditional claim is already
    // the serialisation point, so two triggers for one dispatch cannot both reach
    // this method. Which claim depends on the route: `Shipment.waybillRelayedAt`
    // (#1947) for a shipment-grain dispatch, `fulfillment_works.dispatchRelayedAt`
    // (#2401) for a router-fulfilled work, which has no Shipment at all.
    const plan = planShoperParcelWrite(rows, trackingNumber);

    if (plan.kind === 'conflict') {
      return {
        outcome: 'rejected',
        detail:
          `Shoper order ${externalOrderId} already has a parcel under a different tracking number; ` +
          'a second shipment cannot be written because partial shipment is not supported',
      };
    }

    if (plan.kind === 'already-applied') {
      this.logger.debug(
        `Shoper order ${externalOrderId} already has a parcel for this dispatch (connection: ${this.connection.id})`,
      );
      return { outcome: 'applied' };
    }

    if (plan.kind === 'attach-tracking' && trackingNumber !== undefined) {
      const body: ShoperParcelTrackingUpdate = plan.alreadySent
        ? { shipping_code: trackingNumber }
        : { shipping_code: trackingNumber, sent: true };
      await this.client.put(`/parcels/${plan.parcelId}`, body);
      this.logger.log(
        `Attached tracking to Shoper parcel ${plan.parcelId} of order ${externalOrderId} ` +
          `(connection: ${this.connection.id})`,
      );
      return { outcome: 'applied' };
    }

    return this.createParcel(externalOrderId, trackingNumber);
  }

  /**
   * Create the order's parcel. The order's own shipping method is tried first,
   * unless Shoper is already known to refuse it; only Shoper's "value not found"
   * answer moves the parcel to a fallback method. That answer is a validation
   * refusal, so Shoper created nothing and the second POST cannot duplicate the
   * first. Any other failure ends the attempt with the reason.
   */
  private async createParcel(
    externalOrderId: string,
    trackingNumber: string | undefined,
  ): Promise<OrderWritebackResult> {
    const order = await this.readOrder(externalOrderId);
    if (order === null) {
      return { outcome: 'rejected', detail: `Shoper order ${externalOrderId} not found` };
    }

    const orderShippingId = toPositiveInt(order.shipping_id);
    let refusedOrderMethod = false;
    if (orderShippingId !== null) {
      refusedOrderMethod = await this.parcelShippingRefusals.isRefused(orderShippingId);
      if (!refusedOrderMethod) {
        const own: ShoperParcelShippingChoice = { shippingId: orderShippingId, source: 'order' };
        const attempt = await this.postParcel(externalOrderId, own, trackingNumber);
        if (attempt.kind === 'created') {
          return { outcome: 'applied' };
        }
        if (attempt.kind === 'rejected') {
          return { outcome: 'rejected', detail: describeParcelFailure(attempt.error, own) };
        }
        refusedOrderMethod = true;
        await this.parcelShippingRefusals.remember(orderShippingId);
        this.logger.log(
          `Shoper refused a parcel under order ${externalOrderId}'s own shipping method ${orderShippingId} ` +
            `(${attempt.error.message}); using the fallback method (connection: ${this.connection.id})`,
        );
      }
    }

    const fallback = await this.chooseFallbackShipping(
      externalOrderId,
      refusedOrderMethod ? orderShippingId : null,
    );
    if ('refusal' in fallback) {
      return { outcome: 'rejected', detail: fallback.refusal };
    }
    const attempt = await this.postParcel(externalOrderId, fallback, trackingNumber);
    if (attempt.kind === 'created') {
      return { outcome: 'applied' };
    }
    return {
      outcome: 'rejected',
      detail:
        `${describeParcelFailure(attempt.error, fallback)}. ` +
        'Shoper accepts a parcel only for a shipping method that is not carrier-integrated; ' +
        `set connection config "${PARCEL_SHIPPING_KEY}" to the id of such a method in the shop`,
    };
  }

  private async postParcel(
    externalOrderId: string,
    choice: ShoperParcelShippingChoice,
    trackingNumber: string | undefined,
  ): Promise<ShoperParcelPostOutcome> {
    try {
      await this.client.post<unknown>(
        '/parcels',
        buildShoperParcelCreateRequest(Number(externalOrderId), choice.shippingId, trackingNumber),
      );
    } catch (error) {
      if (error instanceof ShoperApiError && error.statusCode === 400) {
        return error.isValueNotFound() ? { kind: 'method-refused', error } : { kind: 'rejected', error };
      }
      throw error;
    }
    this.logger.log(
      `Created Shoper parcel for order ${externalOrderId} under shipping method ${choice.shippingId} ` +
        `(${choice.source})${trackingNumber === undefined ? ' without a tracking number' : ''} ` +
        `(connection: ${this.connection.id})`,
    );
    return { kind: 'created' };
  }

  /**
   * The method a parcel falls back to. A configured id needs no read; otherwise
   * the shop's methods are read to find a plain one, skipping the order's own
   * method when that is the one Shoper just refused.
   */
  private async chooseFallbackShipping(
    externalOrderId: string,
    refusedShippingId: number | null,
  ): Promise<ShoperParcelShippingChoice | { readonly refusal: string }> {
    const configured = readDefaults(this.connection).parcelShippingId;
    if (configured !== undefined) {
      return { shippingId: configured, source: 'config' };
    }
    const shippings = await fetchAllShoperRows<ShoperShippingRow>(this.client, '/shippings', {
      order: 'shipping_id ASC',
    });
    const choice = selectShoperParcelFallbackShipping({
      configuredShippingId: undefined,
      shippings,
      excluded: new Set(refusedShippingId === null ? [] : [refusedShippingId]),
    });
    if (choice === null) {
      return {
        refusal:
          `Shoper order ${externalOrderId} uses a shipping method Shoper does not accept a parcel for ` +
          'and the shop has no plain (non-integrated) active shipping method to use instead; ' +
          `set connection config "${PARCEL_SHIPPING_KEY}" to the id of one`,
      };
    }
    return choice;
  }

  // ─── cancelled / in-progress ───────────────────────────────────────────────

  private async writeStatus(
    externalOrderId: string,
    target: ShoperStatusWritebackTarget,
  ): Promise<OrderWritebackResult> {
    const order = await this.readOrder(externalOrderId);
    if (order === null) {
      return { outcome: 'rejected', detail: `Shoper order ${externalOrderId} not found` };
    }

    const currentId = toPositiveInt(order.status_id);
    const current = currentId === null ? null : await this.reference.getStatus(String(currentId));
    const plan = planShoperStatusWriteback(current, target);
    if (plan.kind === 'already-applied') {
      this.logger.debug(
        `Shoper order ${externalOrderId} is already ${STATUS_LABEL[target]} (status ${String(currentId)}, ` +
          `connection: ${this.connection.id})`,
      );
      return { outcome: 'applied' };
    }
    if (plan.kind === 'refused') {
      return {
        outcome: 'rejected',
        detail: `Shoper order ${externalOrderId} is not moved to ${STATUS_LABEL[target]}: ${plan.reason}`,
      };
    }

    const statusId = await this.resolveTargetStatus(target);
    if (statusId === null) {
      return {
        outcome: 'rejected',
        detail:
          `The shop lists no active ${STATUS_LABEL[target]} order status to move order ${externalOrderId} to; ` +
          `set connection config "${STATUS_KEY[target]}" to the id of one`,
      };
    }
    if (statusId === currentId) {
      return { outcome: 'applied' };
    }

    const body: ShoperOrderStatusUpdate = { status_id: statusId };
    await this.client.put(`/orders/${externalOrderId}`, body);
    this.logger.log(
      `Moved Shoper order ${externalOrderId} to status ${statusId} (${STATUS_LABEL[target]}) ` +
        `(connection: ${this.connection.id})`,
    );
    return { outcome: 'applied' };
  }

  private async resolveTargetStatus(target: ShoperStatusWritebackTarget): Promise<number | null> {
    const defaults = readDefaults(this.connection);
    const configured = target === 'cancelled' ? defaults.cancelledStatusId : defaults.inProgressStatusId;
    if (configured !== undefined) {
      return configured;
    }
    const picked = pickShoperWritebackStatus(await this.reference.listStatuses(), target);
    return picked === null ? null : toPositiveInt(picked);
  }

  /** The order's shipping method and status, or null when Shoper reports no such order. */
  private async readOrder(externalOrderId: string): Promise<ShoperOrderShipping | null> {
    try {
      const { data } = await this.client.get<ShoperOrderShipping>(`/orders/${externalOrderId}`);
      return data;
    } catch (error) {
      if (error instanceof ShoperApiError && error.isResourceNotFound()) {
        return null;
      }
      throw error;
    }
  }
}

function describeParcelFailure(error: ShoperApiError, choice: ShoperParcelShippingChoice): string {
  return `${error.message} (shipping method ${choice.shippingId}, chosen from ${choice.source})`;
}
