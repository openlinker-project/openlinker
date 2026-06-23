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
 * Targets are resolved **role-agnostically** (#1159): each participant's order
 * capability (`OrderProcessorManager` for shops, `OrderSource` for marketplaces)
 * is tried in turn and narrowed via the guard — so the relay reaches both
 * destinations and source marketplaces (e.g. Allegro) with no platform-type
 * branching.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderLifecycleRelayService}
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  CapabilityNotSupportedException,
} from '@openlinker/core/integrations';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import {
  isOrderStatusWriteback,
  type OrderStatusWriteback,
} from '../../domain/ports/capabilities/order-status-writeback.capability';
import type { OrderLifecycleEvent } from '../../domain/types/order-lifecycle-event.types';
import type {
  IOrderLifecycleRelayService,
  OrderLifecycleRelayInput,
  OrderLifecycleRelayResult,
  OrderLifecycleRelayTargetResult,
} from '../interfaces/order-lifecycle-relay.service.interface';

// Order-participant capabilities the relay can write back to, in resolution
// preference order: a destination shop first, then a source marketplace.
const ORDER_PARTICIPANT_CAPABILITIES = ['OrderProcessorManager', 'OrderSource'] as const;

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
    let resolved: { adapter: OrderStatusWriteback; capability: string } | null;
    try {
      resolved = await this.resolveWriteback(connectionId);
    } catch (error) {
      // Connection-level failure (disabled / not-found / construction) — distinct
      // from a plain capability mismatch; surface it rather than masking it.
      this.logger.warn(
        `Lifecycle relay: could not resolve an order adapter for connection ` +
          `${connectionId} (order ${input.internalOrderId}): ${this.message(error)}`
      );
      return { connectionId, outcome: 'unsupported', detail: 'adapter unresolved' };
    }

    if (!resolved) {
      this.logger.warn(
        `Lifecycle relay: connection ${connectionId} exposes no order-writeback capability — ` +
          `skipping '${input.event.type}' for order ${input.internalOrderId}`
      );
      return { connectionId, outcome: 'unsupported', detail: 'no order-writeback capability' };
    }
    const { adapter, capability } = resolved;

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
          `Lifecycle relay: '${input.event.type}' applied to ${connectionId} (${capability}) for order ${input.internalOrderId}`
        );
      } else {
        this.logger.warn(
          `Lifecycle relay: '${input.event.type}' ${result.outcome} on ${connectionId} (${capability}) for order ` +
            `${input.internalOrderId}${result.detail ? ` — ${result.detail}` : ''}`
        );
      }
      return { connectionId, outcome: result.outcome, detail: result.detail };
    } catch (error) {
      const detail = this.message(error);
      this.logger.warn(
        `Lifecycle relay: '${input.event.type}' failed on ${connectionId} (${capability}) for order ` +
          `${input.internalOrderId}: ${detail}`,
        error instanceof Error ? error.stack : undefined
      );
      return { connectionId, outcome: 'rejected', detail };
    }
  }

  /**
   * Resolve the participant's order-writeback adapter, role-agnostically (#1159).
   * Tries each order-participant capability (destination first, then source); a
   * capability mismatch on this connection falls through to the next candidate,
   * while a connection-level failure (disabled / not-found) propagates so the
   * caller surfaces it. Returns null when no order capability on the connection
   * implements `OrderStatusWriteback`.
   */
  private async resolveWriteback(
    connectionId: string
  ): Promise<{ adapter: OrderStatusWriteback; capability: string } | null> {
    for (const capability of ORDER_PARTICIPANT_CAPABILITIES) {
      try {
        const adapter = await this.integrations.getCapabilityAdapter<object>(
          connectionId,
          capability
        );
        if (isOrderStatusWriteback(adapter)) {
          return { adapter, capability };
        }
      } catch (error) {
        // CapabilityNotEnabledException extends CapabilityNotSupportedException,
        // so this catches both: the connection just isn't this role — try next.
        if (error instanceof CapabilityNotSupportedException) {
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
