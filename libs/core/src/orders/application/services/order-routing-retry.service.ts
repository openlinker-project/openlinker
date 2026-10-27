/**
 * Order Routing Retry Service (#3558, epic #3511)
 *
 * Routes a HELD order again, on demand or when a stock change makes that worth
 * trying, by enqueueing `fulfillment.work.route` under the selected router's
 * connection. See {@link IOrderRoutingRetryService} for the four properties the
 * design rests on; this file only carries what is specific to the code.
 *
 * Router selection mirrors `OrderIngestionService.resolveRoutingTarget` and
 * `FulfillmentWorkRerouteSweepHandler`: every connection, whatever its status,
 * reduced to a claimant and handed to the pure `selectPrimaryFulfillmentRouter`,
 * so the retry, the sweep and the route job itself pick the same router.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderRoutingRetryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { REROUTABLE_FULFILLMENT_BLOCK_REASONS } from '@openlinker/core/fulfillment';
import {
  selectPrimaryFulfillmentRouter,
  type AuthorityClaimantInput,
} from '@openlinker/core/fulfillment-authority';
import {
  CONNECTION_PORT_TOKEN,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import type {
  IOrderRoutingRetryService,
  OrderRoutingRetryResult,
  RerouteHeldOrdersForVariantInput,
  RerouteHeldOrdersResult,
} from '../interfaces/order-routing-retry.service.interface';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';

/** Held orders re-driven per stock change: bounds the burst one stock write can cause. */
export const STOCK_REROUTE_PAGE_LIMIT = 50;

/** One stock-triggered attempt per order per UTC hour (see the interface, property 4). */
export const buildStockRerouteJobKey = (orderId: string, now: Date): string =>
  `fulfillment:work:route:stock:${orderId}:${now.toISOString().slice(0, 13)}`;

/** A fresh key per operator click (see the interface, property 3). */
export const buildRetryRerouteJobKey = (orderId: string, nowMs: number): string =>
  `fulfillment:work:route:retry:${orderId}:${String(nowMs)}`;

@Injectable()
export class OrderRoutingRetryService implements IOrderRoutingRetryService {
  private readonly logger = new Logger(OrderRoutingRetryService.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async retryRouting(internalOrderId: string): Promise<OrderRoutingRetryResult> {
    const order = await this.orderRecords.getOrderRecord(internalOrderId);
    if (!order) return { status: 'order-not-found' };

    const block = order.fulfillmentBlock;
    if (block === null) return { status: 'refused', reason: 'not-held' };
    if (!(REROUTABLE_FULFILLMENT_BLOCK_REASONS as readonly string[]).includes(block.reason)) {
      return { status: 'refused', reason: 'not-retryable' };
    }

    const routerConnectionId = await this.selectRouterConnectionId();
    if (routerConnectionId === null) return { status: 'refused', reason: 'no-router' };

    try {
      const { jobId } = await this.jobEnqueue.enqueueJob({
        jobType: 'fulfillment.work.route',
        connectionId: routerConnectionId,
        payload: { schemaVersion: 1, orderId: internalOrderId },
        idempotencyKey: buildRetryRerouteJobKey(internalOrderId, Date.now()),
      });
      this.logger.log(
        `Routing retried by an operator: jobId=${jobId} order=${internalOrderId} ` +
          `router=${routerConnectionId}`
      );
      return { status: 'enqueued', jobId };
    } catch (error) {
      // The message is logged, never returned (interface property 2).
      this.logger.error(
        `Routing retry enqueue failed: order=${internalOrderId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined
      );
      return { status: 'enqueue-failed' };
    }
  }

  async rerouteHeldOrdersForVariant(
    input: RerouteHeldOrdersForVariantInput
  ): Promise<RerouteHeldOrdersResult> {
    const none: RerouteHeldOrdersResult = { candidates: 0, enqueued: 0 };
    try {
      const orderIds = await this.orderRecords.listOrderIdsHeldForVariant(
        REROUTABLE_FULFILLMENT_BLOCK_REASONS,
        input.variantId,
        STOCK_REROUTE_PAGE_LIMIT
      );
      if (orderIds.length === 0) return none;

      const routerConnectionId = await this.selectRouterConnectionId();
      if (routerConnectionId === null) {
        // Held orders wait: releasing them to the product masters is not a stock
        // change's decision (the same rule the sweep follows).
        return { candidates: orderIds.length, enqueued: 0 };
      }

      const now = new Date();
      let enqueued = 0;
      for (const orderId of orderIds) {
        try {
          await this.jobEnqueue.enqueueJob({
            jobType: 'fulfillment.work.route',
            connectionId: routerConnectionId,
            payload: { schemaVersion: 1, orderId },
            idempotencyKey: buildStockRerouteJobKey(orderId, now),
          });
          enqueued += 1;
        } catch (error) {
          this.logger.warn(
            `Stock-triggered re-route enqueue failed: order=${orderId} ` +
              `variant=${input.variantId}: ${error instanceof Error ? error.name : 'UnknownError'}`
          );
        }
      }
      this.logger.log(
        `Stock change re-routed held orders: variant=${input.variantId} ` +
          `candidates=${String(orderIds.length)} enqueued=${String(enqueued)}` +
          (input.observedAt ? ` observedAt=${input.observedAt}` : '')
      );
      return { candidates: orderIds.length, enqueued };
    } catch (error) {
      this.logger.warn(
        `Stock-triggered re-route skipped: variant=${input.variantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return none;
    }
  }

  /** The selected router's connection id, or `null` when none / ambiguous. */
  private async selectRouterConnectionId(): Promise<string | null> {
    const connections = await this.connections.list();
    const selection = selectPrimaryFulfillmentRouter(this.toClaimants(connections));
    return selection.holder;
  }

  private toClaimants(connections: readonly Connection[]): AuthorityClaimantInput[] {
    return connections.map((connection) => ({
      connectionId: connection.id,
      isActive: connection.status === 'active',
      supportedCapabilities: [],
      enabledCapabilities: connection.enabledCapabilities,
      config: connection.config,
    }));
  }
}
