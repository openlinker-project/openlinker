/**
 * Product Matching Orders Response DTO
 *
 * Response body for `GET /analytics/coverage/matching/orders` (#2474, Phase
 * 7) — the paginated drill-down behind the mockup's `detail-mapping` modal.
 * Mirrors `TaxCoverageOrderDto` / `CurrencyMismatchOrderDto` shape-for-shape,
 * except it carries no `placedAt`: a `product-matching` row is by
 * construction an order OL could not fully resolve
 * (`recordStatus = 'awaiting_mapping' | 'source_deleted'`), and the #1985
 * `placedAt` denormalization only ever populates for `recordStatus =
 * 'ready'` records — so `createdAt` is the only timestamp this category can
 * ever report.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ProductMatchingErrorOrderRow } from '@openlinker/core/orders';

export class ProductMatchingOrderDto {
  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty()
  sourceConnectionId!: string;

  @ApiProperty({ description: "Why the order couldn't be matched to a mapped product." })
  recordStatus!: 'awaiting_mapping' | 'source_deleted';

  @ApiPropertyOptional({ nullable: true })
  mappingFailureReason!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({
    description:
      'Always `null` (#2799) — an order in this category never resolved its item reference to an internal product id in the first place, so there is no honest value to report. `product-sales-table.tsx` must not cross-reference this category. See `ProductMatchingErrorOrderRow.productId`\'s doc comment for the full rationale.',
    type: String,
    nullable: true,
  })
  productId!: null;

  @ApiPropertyOptional({
    description:
      'Always `null` (#2799) — same reasoning as `productId` above: this category never resolves a variant reference either.',
    type: String,
    nullable: true,
  })
  variantId!: null;

  static fromRow(row: ProductMatchingErrorOrderRow): ProductMatchingOrderDto {
    const dto = new ProductMatchingOrderDto();
    dto.internalOrderId = row.internalOrderId;
    dto.sourceConnectionId = row.sourceConnectionId;
    dto.recordStatus = row.recordStatus;
    dto.mappingFailureReason = row.mappingFailureReason;
    dto.createdAt = row.createdAt;
    dto.productId = row.productId;
    dto.variantId = row.variantId;
    return dto;
  }
}

export class ProductMatchingOrdersResponseDto {
  @ApiProperty({ type: [ProductMatchingOrderDto] })
  items!: ProductMatchingOrderDto[];

  @ApiProperty({ description: 'Total affected orders in the requested range.' })
  total!: number;
}
