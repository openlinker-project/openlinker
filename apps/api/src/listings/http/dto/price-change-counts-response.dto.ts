/**
 * Price Change Counts Response DTO (#3325)
 *
 * The review queue's connection filter-bar chip counts, exact rather than
 * bounded by a page-size ceiling — split out of #3237/#3164 review, whose
 * `CHIP_COUNTS_LIMIT = 200` client-side bucketing under-counted the long
 * tail on an install with more than 200 open episodes across every
 * connection.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class PriceChangeConnectionCountDto {
  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  count!: number;
}

export class PriceChangeCountsResponseDto {
  @ApiProperty({
    description:
      'Total open episodes across every destination connection — the sum of `byConnection`, computed in one `GROUP BY` read rather than a second `COUNT`.',
  })
  total!: number;

  @ApiProperty({
    type: [PriceChangeConnectionCountDto],
    description:
      'Open-episode count per destination connection. A connection with zero open episodes is absent from this list, never present with `0`.',
  })
  byConnection!: PriceChangeConnectionCountDto[];

  static fromCounts(counts: ReadonlyMap<string, number>): PriceChangeCountsResponseDto {
    const dto = new PriceChangeCountsResponseDto();
    dto.byConnection = Array.from(counts, ([connectionId, count]) => ({ connectionId, count }));
    dto.total = dto.byConnection.reduce((sum, entry) => sum + entry.count, 0);
    return dto;
  }
}
