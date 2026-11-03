/**
 * Order Open Return DTO (#2998)
 *
 * The "open return" badge projected onto the order — count of open returns
 * plus a stage hint. "Open" is the `/returns` list's own `all_open` segment
 * predicate (`docs/architecture-overview.md § Returns`), reused verbatim
 * rather than redefined here.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ReturnStageValues, type ReturnStage } from '@openlinker/core/returns';

export class OrderOpenReturnDto {
  @ApiProperty({ description: 'How many open returns this order currently has. Always >= 1.' })
  count!: number;

  @ApiProperty({
    enum: ReturnStageValues,
    description:
      'The derived stage of the most-recently-opened open return on this order — the badge hint.',
  })
  stage!: ReturnStage;
}
