/**
 * Order Tag Response DTOs (#3532, D34)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderTagColorValues, type OrderTagColor } from '@openlinker/core/orders';

export class OrderTagResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: OrderTagColorValues })
  color!: OrderTagColor;

  @ApiProperty({ description: 'How many orders currently carry this tag.' })
  orderCount!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class BulkAssignOrderTagResponseDto {
  @ApiProperty()
  tagId!: string;

  @ApiProperty({ description: 'Orders that gained the tag by this call.' })
  added!: number;

  @ApiProperty({ description: 'Orders that already carried it.' })
  alreadyTagged!: number;

  @ApiProperty({ description: 'Orders whose row failed (#3545); 0 on a clean run.' })
  failed!: number;

  @ApiProperty({
    description: 'Per-order outcome (#3545), in request order with repeated ids collapsed.',
    type: () => [BulkOrderTagResultDto],
  })
  results!: BulkOrderTagResultDto[];
}

export const BulkOrderTagOutcomeValues = [
  'added',
  'already-tagged',
  'removed',
  'not-tagged',
  'failed',
] as const;
export type BulkOrderTagOutcome = (typeof BulkOrderTagOutcomeValues)[number];

export class BulkOrderTagResultDto {
  @ApiProperty() orderId!: string;

  @ApiProperty({ enum: BulkOrderTagOutcomeValues })
  outcome!: BulkOrderTagOutcome;

  @ApiPropertyOptional({ description: 'PII-free reason, present for `failed`.' })
  reason?: string;

  @ApiPropertyOptional({ description: 'Machine code for `failed`, e.g. ORDER_NOT_FOUND.' })
  code?: string;
}

export class BulkRemoveOrderTagResponseDto {
  @ApiProperty()
  tagId!: string;

  @ApiProperty({ description: 'Orders that lost the tag by this call.' })
  removed!: number;

  @ApiProperty({ description: 'Orders that did not carry it (a no-op, not an error).' })
  notTagged!: number;

  @ApiProperty({ description: 'Orders whose row failed.' })
  failed!: number;

  @ApiProperty({ type: [BulkOrderTagResultDto] })
  results!: BulkOrderTagResultDto[];
}
