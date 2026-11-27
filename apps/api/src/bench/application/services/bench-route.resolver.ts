/**
 * Bench Route Resolver (#3958)
 *
 * Answers "who ships this box" for the label card: the order's delivery method,
 * resolved through the core routing service, plus the routed connection's name.
 *
 * ## The same resolution the label purchase uses
 *
 * `fulfillment.work.autoDispatch` decides whether to buy a label by calling
 * `IFulfillmentRoutingService.resolve` with the order's source connection and
 * delivery method. This calls exactly that, with exactly those inputs, so the
 * bench can never promise a label the job will not buy, or say the shop ships
 * a box the job is about to buy a label for.
 *
 * ## It never fails the parcel read
 *
 * A route is a presentation fact. A routing read that throws, or a connection
 * that cannot be read, must not blank a parcel a packer is holding, so both
 * degrade: the route to `null` (the card falls back to what the shipment alone
 * says), the name to `null` (the card uses its neutral wording).
 *
 * One parcel at a time, so one `resolve` and at most one connection read per
 * call. The work list carries no label card, so there is no page to batch.
 *
 * @module apps/api/src/bench/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  type FulfillmentRoutingResolution,
  type IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import { Logger } from '@openlinker/shared/logging';

import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';
import { toBenchParcelRoute } from '../bench-parcel-route';
import type { BenchParcelRouteView } from '../types/bench-parcel.types';

/** The three order facts a route is resolved from. Primitives, not the record. */
export interface BenchRouteQuery {
  readonly sourceConnectionId: string;
  readonly sourceDeliveryMethodId: string | null;
  readonly methodLabel: string | null;
}

@Injectable()
export class BenchRouteResolver {
  private readonly logger = new Logger(BenchRouteResolver.name);

  constructor(
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN)
    private readonly routing: IFulfillmentRoutingService,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService
  ) {}

  async resolve(query: BenchRouteQuery | null): Promise<BenchParcelRouteView | null> {
    if (query === null) return null;

    let resolution: FulfillmentRoutingResolution;
    try {
      resolution = await this.routing.resolve({
        sourceConnectionId: query.sourceConnectionId,
        sourceDeliveryMethodId: query.sourceDeliveryMethodId,
      });
    } catch (error) {
      this.logger.warn(
        `Could not resolve the route for a bench parcel on connection ` +
          `${query.sourceConnectionId}; the label card falls back to the shipment: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }

    const processorName =
      resolution.processorConnectionId === null
        ? null
        : await this.readConnectionName(resolution.processorConnectionId);

    return toBenchParcelRoute({ resolution, processorName, methodLabel: query.methodLabel });
  }

  /**
   * `IConnectionService.get`, not `getAdapter`: the latter refuses a disabled
   * connection, and a switched-off carrier is precisely the one whose name the
   * card must still be able to say.
   */
  private async readConnectionName(connectionId: string): Promise<string | null> {
    try {
      const connection = await this.connections.get(connectionId);
      return connection.name.trim().length > 0 ? connection.name : null;
    } catch (error) {
      this.logger.warn(
        `Could not read connection ${connectionId} for a bench parcel's route; the card ` +
          `uses its neutral wording: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }
}
