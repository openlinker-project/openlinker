/**
 * Order Sync Status Response DTO
 *
 * Response shape for an individual destination sync status within an order record.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderDeliveryRefusalReasonValues,
  OrderDeliveryUpdateOutcomeValues,
  type OrderDeliveryRefusalReason,
  type OrderDeliveryUpdateOutcome,
} from '@openlinker/core/orders';
import { OrderSyncStatusFilterValues } from '@openlinker/core/orders';
import { OrderSyncStatusFilter } from '@openlinker/core/orders';

/**
 * What the last attempt to carry a changed delivery point (pickup locker,
 * shipping method) to a destination copy did (#4195).
 */
export class OrderDeliveryUpdateResponseDto {
  @ApiProperty({ enum: OrderDeliveryUpdateOutcomeValues })
  outcome!: OrderDeliveryUpdateOutcome;

  @ApiPropertyOptional({
    enum: OrderDeliveryRefusalReasonValues,
    nullable: true,
    description: 'Why the destination declined to edit its copy (outcome "refused" only)',
  })
  reason!: OrderDeliveryRefusalReason | null;

  @ApiPropertyOptional({ nullable: true, description: 'Operator-facing elaboration' })
  detail!: string | null;

  @ApiProperty({ description: 'When the relay was attempted (ISO 8601)' })
  at!: string;
}

export class OrderSyncStatusResponseDto {
  @ApiProperty({ description: 'Destination connection ID' })
  destinationConnectionId!: string;

  @ApiProperty({ enum: OrderSyncStatusFilterValues, description: 'Sync status' })
  status!: OrderSyncStatusFilter;

  @ApiPropertyOptional({ nullable: true, description: 'Timestamp when sync completed (ISO 8601)' })
  syncedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'External order ID in destination system' })
  externalOrderId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'External order number in destination system',
  })
  externalOrderNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Error message if sync failed' })
  error!: string | null;

  @ApiPropertyOptional({
    type: OrderDeliveryUpdateResponseDto,
    nullable: true,
    description: 'Last delivery-point relay to this destination, absent when none was attempted',
  })
  deliveryUpdate!: OrderDeliveryUpdateResponseDto | null;
}
