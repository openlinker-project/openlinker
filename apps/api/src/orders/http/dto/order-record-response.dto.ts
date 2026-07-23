/**
 * Order Record Response DTO
 *
 * Response shape for a single order record. Used in both list and detail responses.
 * Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderRecordStatusValues,
  SYNC_ATTEMPTS_PER_DESTINATION_CAP,
  SlaStateValues,
  FulfillmentRollupStateValues,
} from '@openlinker/core/orders';
import { OrderRecordStatus, SlaState, FulfillmentRollupState } from '@openlinker/core/orders';
import { OrderSyncStatusResponseDto } from './order-sync-status-response.dto';
import { SyncAttemptResponseDto } from './sync-attempt-response.dto';
import type { OrderInvoiceProjectionDto } from './order-invoice-projection.dto';
import { OrderDeliveryResolutionDto } from './order-delivery-resolution.dto';

export class OrderRecordResponseDto {
  @ApiProperty({ description: 'Internal order ID (e.g. ol_order_...)' })
  internalOrderId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Internal customer ID' })
  customerId!: string | null;

  @ApiProperty({ description: 'Source connection ID' })
  sourceConnectionId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Source event ID for tracking' })
  sourceEventId!: string | null;

  @ApiProperty({
    description:
      'Order snapshot (PII-aware). On the detail read only (#1224), it may carry an optional neutral ' +
      '`invoice` sub-tree (shape: OrderInvoiceProjectionDto) when a latest invoice record exists for the order; ' +
      'the list read never includes it.',
  })
  orderSnapshot!: Record<string, unknown> & { invoice?: OrderInvoiceProjectionDto };

  @ApiProperty({ type: [OrderSyncStatusResponseDto], description: 'Sync status per destination' })
  syncStatus!: OrderSyncStatusResponseDto[];

  @ApiProperty({
    type: [SyncAttemptResponseDto],
    description:
      `Per-destination attempt history (append-only, capped at ${SYNC_ATTEMPTS_PER_DESTINATION_CAP} ` +
      'most-recent entries per destination). Used by the activity timeline to preserve ' +
      'failure → retry → success narrative.',
  })
  syncAttempts!: SyncAttemptResponseDto[];

  @ApiProperty({ description: 'Order creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({
    description:
      'Record resolution status. "ready" = all item refs resolved (orderSnapshot contains internal IDs). ' +
      '"awaiting_mapping" = item refs unresolved (orderSnapshot contains raw IncomingOrder with external offer refs).',
    enum: OrderRecordStatusValues,
  })
  recordStatus!: OrderRecordStatus;

  @ApiProperty({ description: 'Order last-update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Marketplace dispatch (ship-by) deadline (ISO 8601), derived from the source dispatch window (#927). ' +
      'null when the source exposes no dispatch SLA. Surfaced top-level so the list SLA column / sort / filter ' +
      'and the detail countdown read it without parsing the snapshot.',
  })
  dispatchByAt!: string | null;

  @ApiProperty({
    description:
      'True when `dispatchByAt` is an OL-side ESTIMATE rather than a marketplace-authoritative ' +
      'commitment (#1776). Derived from the snapshot dispatch window\'s `estimated` flag: Erli derives ' +
      'its ship-by from per-offer (falling back to connection-default) handling time and marks it estimated; ' +
      'Allegro carries the platform-authoritative dispatch time and leaves it false. The FE renders a subtle ' +
      '"~" qualifier next to the ship-by badge when true.',
  })
  dispatchByEstimated!: boolean;

  @ApiProperty({
    enum: FulfillmentRollupStateValues,
    description:
      'Per-order fulfillment rollup (#1108) of the order\'s shipment lifecycle. "not-shipped" when no shipment has progressed (also the default for orders with no shipments).',
  })
  fulfillmentState!: FulfillmentRollupState;

  @ApiProperty({
    enum: SlaStateValues,
    description:
      'Ship-by SLA bucket (#1108), server-derived from dispatchByAt + fulfillmentState (cleared to "none" once shipped). The single source of truth the list badge + filter agree on; the FE renders only the live countdown from dispatchByAt.',
  })
  slaState!: SlaState;

  @ApiPropertyOptional({
    type: OrderDeliveryResolutionDto,
    description:
      'Read-only projection (#1791) of how fulfillment routing resolved for this order\'s delivery ' +
      'method — the outcome IFulfillmentRoutingService.resolve computes. Present on both the list and ' +
      'detail reads when the order carries a source delivery method; absent otherwise. Never changes ' +
      'routing behaviour — a pure derived read.',
  })
  deliveryResolution?: OrderDeliveryResolutionDto;
}
