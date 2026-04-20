/**
 * Order Record Response DTO
 *
 * Response shape for a single order record. Used in both list and detail responses.
 * Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderRecordStatusValues } from '@openlinker/core/orders';
import type { OrderRecordStatus } from '@openlinker/core/orders';
import { OrderSyncStatusResponseDto } from './order-sync-status-response.dto';

export class OrderRecordResponseDto {
  @ApiProperty({ description: 'Internal order ID (e.g. ol_order_...)' })
  internalOrderId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Internal customer ID' })
  customerId!: string | null;

  @ApiProperty({ description: 'Source connection ID' })
  sourceConnectionId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Source event ID for tracking' })
  sourceEventId!: string | null;

  @ApiProperty({ description: 'Order snapshot (PII-aware)' })
  orderSnapshot!: Record<string, unknown>;

  @ApiProperty({ type: [OrderSyncStatusResponseDto], description: 'Sync status per destination' })
  syncStatus!: OrderSyncStatusResponseDto[];

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
}
