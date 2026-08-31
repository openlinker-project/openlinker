/**
 * Tax Coverage Orders Response DTO
 *
 * Response body for `GET /analytics/coverage/tax/orders` (#2474, Phase 7) —
 * the paginated drill-down behind the mockup's `detail-tax` / `detail-novat`
 * / `detail-postrollout` modals, which `GET /analytics/coverage` deliberately
 * only samples (10 ids) rather than pages. Mirrors
 * `CurrencyMismatchOrderDto` shape-for-shape.
 *
 * Carries no order number or thumbnail, for the same reason
 * `CurrencyMismatchOrderDto` doesn't: `order_records` denormalizes no such
 * column.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TaxCoverageOrderRow } from '@openlinker/core/orders';

export class TaxCoverageOrderDto {
  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty()
  sourceConnectionId!: string;

  @ApiPropertyOptional({
    description: '`order_records.placedAt` — `null` for a historical row with no resolvable placement date.',
    nullable: true,
  })
  placedAt!: Date | null;

  static fromRow(row: TaxCoverageOrderRow): TaxCoverageOrderDto {
    const dto = new TaxCoverageOrderDto();
    dto.internalOrderId = row.internalOrderId;
    dto.sourceConnectionId = row.sourceConnectionId;
    dto.placedAt = row.placedAt;
    return dto;
  }
}

export class TaxCoverageOrdersResponseDto {
  @ApiProperty({ type: [TaxCoverageOrderDto] })
  items!: TaxCoverageOrderDto[];

  @ApiProperty({ description: 'Total affected orders in the requested category/range.' })
  total!: number;
}
