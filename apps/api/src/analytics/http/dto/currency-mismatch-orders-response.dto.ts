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

  static fromRow(row: CurrencyMismatchOrderRow): CurrencyMismatchOrderDto {
    const dto = new CurrencyMismatchOrderDto();
    dto.internalOrderId = row.internalOrderId;
    dto.sourceConnectionId = row.sourceConnectionId;
    dto.nativeCurrency = row.nativeCurrency;
    dto.stampedCurrency = row.stampedCurrency;
    dto.stampedAt = row.stampedAt;
    return dto;
  }
}

export class CurrencyMismatchOrdersResponseDto {
  @ApiProperty({ type: [CurrencyMismatchOrderDto] })
  items!: CurrencyMismatchOrderDto[];

  @ApiProperty({ description: 'Total affected orders in the requested range.' })
  total!: number;
}
