/**
 * Currency Mismatch Orders Response DTO
 *
 * Response body for `GET /analytics/coverage/currency/orders` (#2468) — the
 * paginated drill-down behind the mockup's `detail-currency` modal, which
 * `GET /analytics/coverage` deliberately only samples (10 ids) rather than
 * pages.
 *
 * Carries no order number or thumbnail: `order_records` denormalizes no such
 * column, and inventing one here would assert data that does not exist (the
 * same note `CurrencyMismatchOrderRow` carries in core).
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CurrencyMismatchOrderRow } from '@openlinker/core/orders';

/**
 * One distinct product referenced by a {@link CurrencyMismatchOrderDto}'s
 * order (#2799, corrected per #2799 review BLOCKING 1) — an order spanning
 * several products carries one entry per product, never just the first
 * line's.
 */
export class CurrencyMismatchLineProductDto {
  @ApiProperty()
  productId!: string;

  @ApiPropertyOptional({ nullable: true })
  variantId!: string | null;

  static fromRef(ref: { productId: string; variantId: string | null }): CurrencyMismatchLineProductDto {
    const dto = new CurrencyMismatchLineProductDto();
    dto.productId = ref.productId;
    dto.variantId = ref.variantId;
    return dto;
  }
}

export class CurrencyMismatchOrderDto {
  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty()
  sourceConnectionId!: string;

  @ApiPropertyOptional({
    description: "The order's own native currency; `null` for a row predating that column.",
    nullable: true,
  })
  nativeCurrency!: string | null;

  @ApiPropertyOptional({
    description:
      'The reporting currency the order is stamped in; `null` when it has never been stamped at all.',
    nullable: true,
  })
  stampedCurrency!: string | null;

  @ApiPropertyOptional({
    description:
      'When a stamp attempt last concluded. Non-null with a `null` stampedCurrency means the attempt reached a terminal answer.',
    nullable: true,
  })
  stampedAt!: Date | null;

  @ApiProperty({
    type: [CurrencyMismatchLineProductDto],
    description:
      "Every distinct product this order's lines touch (#2799) — the cross-reference join key against `TopProductRow.productId`. Empty only if this order genuinely carries no line items.",
  })
  lineProducts!: CurrencyMismatchLineProductDto[];

  static fromRow(row: CurrencyMismatchOrderRow): CurrencyMismatchOrderDto {
    const dto = new CurrencyMismatchOrderDto();
    dto.internalOrderId = row.internalOrderId;
    dto.sourceConnectionId = row.sourceConnectionId;
    dto.nativeCurrency = row.nativeCurrency;
    dto.stampedCurrency = row.stampedCurrency;
    dto.stampedAt = row.stampedAt;
    dto.lineProducts = row.lineProducts.map((ref) => CurrencyMismatchLineProductDto.fromRef(ref));
    return dto;
  }
}

export class CurrencyMismatchOrdersResponseDto {
  @ApiProperty({ type: [CurrencyMismatchOrderDto] })
  items!: CurrencyMismatchOrderDto[];

  @ApiProperty({ description: 'Total affected orders in the requested range.' })
  total!: number;
}
