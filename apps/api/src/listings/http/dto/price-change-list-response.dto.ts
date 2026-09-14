/**
 * Price Change List Response DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { PriceChangeQueuePage } from '@openlinker/core/listings';
import { PriceChangeItemResponseDto } from './price-change-item-response.dto';

export class PriceChangeListResponseDto {
  @ApiProperty({ type: [PriceChangeItemResponseDto] })
  items!: PriceChangeItemResponseDto[];

  @ApiProperty({
    description:
      "Episodes excluded from THIS PAGE because their variant's offer mapping is paused/stale (#1689) — mirrors the mockup's `#stale-note`. A per-page count, not a global one: `total` below may include stale episodes no page ever renders.",
  })
  hiddenStaleCount!: number;

  @ApiProperty({
    description:
      'Total episodes matching the SAME filters the page was read with (#3162 review — the read is now paginated), before stale-exclusion.',
  })
  total!: number;

  @ApiProperty({
    description:
      'Whether a further page exists (computed against the raw, pre-stale-filter row count — never against `items.length`). A page can render zero `items` while every one of its rows was merely stale-hidden; read `hasMore` rather than an empty `items` array to decide whether to fetch the next page.',
  })
  hasMore!: boolean;

  static fromDomain(page: PriceChangeQueuePage): PriceChangeListResponseDto {
    const dto = new PriceChangeListResponseDto();
    dto.items = page.items.map((item) => PriceChangeItemResponseDto.fromDomain(item));
    dto.hiddenStaleCount = page.hiddenStaleCount;
    dto.total = page.total;
    dto.hasMore = page.hasMore;
    return dto;
  }
}
