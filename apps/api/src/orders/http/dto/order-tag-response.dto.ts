/**
 * Order Tag Response DTOs (#3532, D34)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
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
}
