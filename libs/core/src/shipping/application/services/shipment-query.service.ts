/**
 * Shipment Query Service
 *
 * Read seam for the shipment HTTP API (#846). Thin delegation to
 * `ShipmentRepositoryPort` (list / by-id / active-by-order).
 *
 * NOTE: this service exists deliberately to keep the API controller off
 * `ShipmentRepositoryPort` — the `*RepositoryPort` cross-context import is
 * banned in `apps/**` (`scripts/check-cross-context-imports.mjs`). Do NOT
 * "simplify" by injecting the repository into the controller directly; that
 * reintroduces the boundary violation. The indirection is the point.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentQueryService}
 */

import { Inject, Injectable } from '@nestjs/common';

import type { IShipmentQueryService } from '../interfaces/shipment-query.service.interface';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShipmentDirection } from '../../domain/types/shipment-direction.types';
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
  ShipmentSummary,
  ShipmentSummaryOptions,
} from '../../domain/types/shipment-query.types';
import { ShipmentStatusValues, type ShipmentStatus } from '../../domain/types/shipment-status.types';
import { ShippingMethodValues, type ShippingMethod } from '../../domain/types/shipping-method.types';
import { groupFailedShipmentCauses } from '../../domain/failed-shipment-causes';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

/** "To send": labels not bought yet, or bought and not handed over. */
const TO_SEND_STATUSES: readonly ShipmentStatus[] = ['draft', 'generated'];

/**
 * How many recent failures the cause groups are computed from. Groups are the
 * five largest, so the most recent few hundred failures are what an operator
 * triages; a bigger sample costs a bigger read for the same top five.
 */
const FAILED_CAUSE_SAMPLE = { limit: 500, offset: 0 } as const;

/** The filters with one axis removed - what a tab or option on that axis counts against. */
function without(filters: ShipmentFilters, keys: readonly (keyof ShipmentFilters)[]): ShipmentFilters {
  const rest: ShipmentFilters = { ...filters };
  for (const key of keys) delete rest[key];
  return rest;
}

@Injectable()
export class ShipmentQueryService implements IShipmentQueryService {
  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
  ) {}

  async list(filters: ShipmentFilters, pagination: ShipmentPagination): Promise<PaginatedShipments> {
    return this.shipments.findMany(filters, pagination);
  }

  /**
   * The list's counts (#4043). Every number is `count()` over the list's own
   * predicate with one axis swapped, so it always equals the list total for
   * the filter a tab or option would apply.
   */
  async summarize(filters: ShipmentFilters, options: ShipmentSummaryOptions): Promise<ShipmentSummary> {
    const withoutStatus = without(filters, ['status', 'statuses']);
    const withoutMethod = without(filters, ['shippingMethod']);
    const withoutProcessor = without(filters, ['shippingMethod', 'hasProviderShipmentId']);
    const withoutConnection = without(filters, ['connectionId']);
    const count = (f: ShipmentFilters): Promise<number> => this.shipments.count(f);

    const connectionIds = await this.shipments.listConnectionIds();
    const [total, statusCounts, omp, carrier, methodCounts, connectionCounts, stuck, toSendAll, toSendOmp, failed] =
      await Promise.all([
        count(withoutStatus),
        Promise.all(ShipmentStatusValues.map((status) => count({ ...withoutStatus, status }))),
        count({ ...withoutProcessor, shippingMethod: 'omp' }),
        count({ ...withoutProcessor, hasProviderShipmentId: true }),
        Promise.all(ShippingMethodValues.map((shippingMethod) => count({ ...withoutMethod, shippingMethod }))),
        Promise.all(connectionIds.map((connectionId) => count({ ...withoutConnection, connectionId }))),
        count({ ...filters, waybillRelayFailureCountAtLeast: options.waybillRelayStuckFloor }),
        count({ ...withoutStatus, statuses: TO_SEND_STATUSES }),
        // `ShipmentFilters` has no "method is not" axis, so the marketplace-fulfilled
        // share is counted and subtracted rather than given a second predicate.
        count({ ...withoutStatus, statuses: TO_SEND_STATUSES, shippingMethod: 'omp' }),
        this.shipments.findMany({ ...withoutStatus, status: 'failed' }, FAILED_CAUSE_SAMPLE),
      ]);

    return {
      total,
      byStatus: Object.fromEntries(ShipmentStatusValues.map((s, i) => [s, statusCounts[i] ?? 0])) as Record<
        ShipmentStatus,
        number
      >,
      byProcessor: { omp, carrier },
      byMethod: Object.fromEntries(ShippingMethodValues.map((m, i) => [m, methodCounts[i] ?? 0])) as Record<
        ShippingMethod,
        number
      >,
      byConnection: Object.fromEntries(
        connectionIds.map((id, i) => [id, connectionCounts[i] ?? 0]).filter(([, n]) => n !== 0),
      ) as Record<string, number>,
      waybillRelayStuck: stuck,
      toSend: Math.max(toSendAll - toSendOmp, 0),
      failedCauseGroups: groupFailedShipmentCauses(failed.items),
    };
  }

  async getById(id: string): Promise<Shipment | null> {
    return this.shipments.findById(id);
  }

  async getActiveByOrderId(orderId: string): Promise<Shipment | null> {
    // Outbound only (#2373) — this backs the order-detail "Shipment" panel.
    return this.shipments.findActiveByOrderId(orderId, 'outbound');
  }

  async getOutboundByOrderId(orderId: string): Promise<readonly Shipment[]> {
    return this.shipments.findByOrderId(orderId, 'outbound');
  }

  /**
   * The contract — batching, the absent-vs-empty convention and why `direction`
   * is required — is documented once on
   * {@link IShipmentQueryService.findByFulfillmentWorkIds}.
   */
  async findByFulfillmentWorkIds(
    workIds: readonly string[],
    direction: ShipmentDirection,
  ): Promise<Map<string, Shipment[]>> {
    const byWork = new Map<string, Shipment[]>();
    const shipments = await this.shipments.findByFulfillmentWorkIds(workIds, direction);
    for (const shipment of shipments) {
      // Non-null by construction: the repository filtered on `IN (workIds)`, so
      // an unlinked row cannot be in this result.
      const workId = shipment.fulfillmentWorkId;
      if (workId === null) continue;
      const bucket = byWork.get(workId);
      if (bucket === undefined) byWork.set(workId, [shipment]);
      else bucket.push(shipment);
    }
    return byWork;
  }

  /** The contract is documented once on {@link IShipmentQueryService.getLatestOutboundTrackingNumber}. */
  async getLatestOutboundTrackingNumber(orderId: string): Promise<string | null> {
    const shipments = await this.shipments.findByOrderId(orderId, 'outbound');
    // A cancelled or failed label's number points at a parcel that never left;
    // `delivered` stays in, because that number is real.
    const withTracking = shipments
      .filter(
        (shipment) =>
          shipment.status !== 'cancelled' &&
          shipment.status !== 'failed' &&
          typeof shipment.trackingNumber === 'string' &&
          shipment.trackingNumber.length > 0,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return withTracking[0]?.trackingNumber ?? null;
  }

  /**
   * The contract — why the marker and not the ledger, why ANY shipment, and why
   * the fold rather than a repository `EXISTS` — is documented once on
   * {@link IShipmentQueryService.hasConsumedReservations}.
   */
  async hasConsumedReservations(orderId: string): Promise<boolean> {
    // Outbound only (#2373). Reservation consumption is an outbound concept —
    // a return label brings goods back and never consumes a hold — and since
    // #2373 an inbound row shares this table, so an unscoped read would fold
    // over a cohort that can never carry the marker.
    const shipments = await this.shipments.findByOrderId(orderId, 'outbound');
    return shipments.some((shipment) => shipment.reservationConsumedAt !== null);
  }
}
