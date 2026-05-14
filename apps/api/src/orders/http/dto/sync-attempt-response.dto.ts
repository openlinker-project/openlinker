/**
 * Sync Attempt Response DTO
 *
 * One historical attempt to sync an order to a destination. Returned as part
 * of `OrderRecordResponseDto.syncAttempts` so the FE activity timeline can
 * preserve the failure → retry → success narrative on the order detail page.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderSyncStatusFilterValues } from '@openlinker/core/orders';
import { OrderSyncStatusFilter } from '@openlinker/core/orders';

export class SyncAttemptResponseDto {
  @ApiProperty({ description: 'Destination connection ID' })
  destinationConnectionId!: string;

  @ApiProperty({ enum: OrderSyncStatusFilterValues, description: 'Attempt status' })
  status!: OrderSyncStatusFilter;

  @ApiProperty({ description: 'Attempt timestamp (ISO 8601)' })
  attemptedAt!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Error message if attempt failed' })
  error!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'External order ID if attempt produced one',
  })
  externalOrderId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'External order number if attempt produced one',
  })
  externalOrderNumber!: string | null;
}
