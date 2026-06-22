/**
 * Order Lifecycle Relay Service
 *
 * Implements the Posture-A lifecycle relay (#1157 / ADR-027). For an order, it
 * resolves the participants OL synced it to (via identifier mappings), excludes
 * the event's origin, and writes the lifecycle event to each via the single
 * `OrderStatusWriteback` capability — **dispatched by the `isOrderStatusWriteback`
 * guard, never by platform type**. Per-target outcomes are collected and
 * surfaced; one participant's failure never blocks the others, and a failure is
 * never silently dropped.
 *
 * This slice (#1158) wires the **inbound cancel → destination** direction:
 * targets are the order's destination (`OrderProcessorManager`) connections.
 * Generalising target resolution to source participants (for dispatch / shop→
 * shop) lands with the bidirectional slices (#1160/#1161).
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderLifecycleRelayService}
 */
import { Injectable, Inject } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { OrderProcessorManagerPort } from '../../domain/ports/order-processor-manager.port';
import { isOrderStatusWriteback } from '../../domain/ports/capabilities/order-status-writeback.capability';
import type { OrderLifecycleEvent } from '../../domain/types/order-lifecycle-event.types';
import type {
  IOrderLifecycleRelayService,
  OrderLifecycleRelayInput,
  OrderLifecycleRelayResult,
  OrderLifecycleRelayTargetResult,
} from '../interfaces/order-lifecycle-relay.service.interface';

const ORDER_PROCESSOR_MANAGER_CAPABILITY = 'OrderProcessorManager';

@Injectable()
export class OrderLifecycleRelayService implements IOrderLifecycleRelayService {
  private readonly logger = new Logger(OrderLifecycleRelayService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService
  ) {}

  async relay(input: OrderLifecycleRelayInput): Promise<OrderLifecycleRelayResult> {
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      input.internalOrderId
    );
    const targets = externalIds.filter((e) => e.connectionId !== input.originConnectionId);

    if (targets.length === 0) {
      this.logger.debug(
        `Lifecycle relay: order ${input.internalOrderId} has no target participants ` +
          `(origin ${input.originConnectionId}); nothing to propagate`
      );
      return { targets: [] };
    }

    const results: OrderLifecycleRelayTargetResult[] = [];
    for (const target of targets) {
      results.push(await this.writeToTarget(input, target.connectionId, target.externalId));
    }
    return { targets: results };
  }

  private async writeToTarget(
    input: OrderLifecycleRelayInput,
    connectionId: string,
    externalOrderId: string
  ): Promise<OrderLifecycleRelayTargetResult> {
    let adapter: OrderProcessorManagerPort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<OrderProcessorManagerPort>(
        connectionId,
        ORDER_PROCESSOR_MANAGER_CAPABILITY
      );
    } catch (error) {
      this.logger.warn(
        `Lifecycle relay: could not resolve OrderProcessorManager adapter for connection ` +
          `${connectionId} (order ${input.internalOrderId}): ${this.message(error)}`
      );
      return { connectionId, outcome: 'unsupported', detail: 'adapter unresolved' };
    }

    if (!isOrderStatusWriteback(adapter)) {
      this.logger.warn(
        `Lifecycle relay: connection ${connectionId} does not implement OrderStatusWriteback — ` +
          `skipping '${input.event.type}' for order ${input.internalOrderId}`
      );
      return { connectionId, outcome: 'unsupported', detail: 'OrderStatusWriteback not implemented' };
    }

    const event: OrderLifecycleEvent =
      input.event.type === 'dispatched'
        ? {
            type: 'dispatched',
            externalOrderId,
            trackingNumber: input.event.trackingNumber,
            carrier: input.event.carrier,
          }
        : { type: 'cancelled', externalOrderId, reason: input.event.reason };

    try {
      const result = await adapter.write(event);
      if (result.outcome === 'applied') {
        this.logger.log(
          `Lifecycle relay: '${input.event.type}' applied to ${connectionId} for order ${input.internalOrderId}`
        );
      } else {
        this.logger.warn(
          `Lifecycle relay: '${input.event.type}' ${result.outcome} on ${connectionId} for order ` +
            `${input.internalOrderId}${result.detail ? ` — ${result.detail}` : ''}`
        );
      }
      return { connectionId, outcome: result.outcome, detail: result.detail };
    } catch (error) {
      const detail = this.message(error);
      this.logger.warn(
        `Lifecycle relay: '${input.event.type}' failed on ${connectionId} for order ` +
          `${input.internalOrderId}: ${detail}`,
        error instanceof Error ? error.stack : undefined
      );
      return { connectionId, outcome: 'rejected', detail };
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
