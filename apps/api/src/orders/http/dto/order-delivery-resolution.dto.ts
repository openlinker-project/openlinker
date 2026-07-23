/**
 * Order Delivery Resolution DTO
 *
 * Read-only projection (#1791, epic #1776) of how fulfillment routing
 * resolved for an order's delivery method — the outcome
 * `IFulfillmentRoutingService.resolve` already computes, surfaced on the
 * order response so the FE can render a mapping-aware delivery cell without
 * re-deriving routing rules it can't see. No new persistence; the resolution
 * is derived at read time from the live routing rules.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  FulfillmentProcessorKind,
  FulfillmentProcessorKindValues,
  FulfillmentRoutingSource,
  FulfillmentRoutingSourceValues,
} from '@openlinker/core/mappings';

export class OrderDeliveryResolutionDto {
  @ApiProperty({
    enum: FulfillmentRoutingSourceValues,
    description:
      '"rule" when a configured fulfillment-routing rule matched the order\'s ' +
      '(source connection, delivery method); "default" when it fell back to the ' +
      'omp_fulfilled default (today\'s PrestaShop-fulfilled behaviour).',
  })
  source!: FulfillmentRoutingSource;

  @ApiProperty({
    enum: FulfillmentProcessorKindValues,
    description:
      'Where the fulfilling connection sits: "omp_fulfilled" (destination OMP ships via its own ' +
      'carrier setup), "ol_managed_carrier" (OL drives an own-contract carrier), or ' +
      '"source_brokered" (OL drives the order source\'s own shipping brokerage).',
  })
  processorKind!: FulfillmentProcessorKind;

  @ApiProperty({
    nullable: true,
    description:
      'The fulfilling connection id. Null for the omp_fulfilled default (no rule matched) — under ' +
      'fan-out there is no single fulfilling OMP; non-null for an explicit rule.',
  })
  processorConnectionId!: string | null;
}
