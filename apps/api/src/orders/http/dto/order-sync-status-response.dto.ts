/**
 * Order Sync Status Response DTO
 *
 * Response shape for an individual destination sync status within an order record.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderSyncStatusFilterValues } from '@openlinker/core/orders';
import type { OrderSyncStatusFilter } from '@openlinker/core/orders';

export class OrderSyncStatusResponseDto {
  @ApiProperty({ description: 'Destination connection ID' })
  destinationConnectionId!: string;

  @ApiProperty({ enum: OrderSyncStatusFilterValues, description: 'Sync status' })
  status!: OrderSyncStatusFilter;

  @ApiPropertyOptional({ nullable: true, description: 'Timestamp when sync completed (ISO 8601)' })
  syncedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'External order ID in destination system' })
  externalOrderId!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'External order number in destination system' })
  externalOrderNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Error message if sync failed' })
  error!: string | null;
}
