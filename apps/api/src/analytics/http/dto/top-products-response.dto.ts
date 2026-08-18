/**
 * Top Products Response DTO
 *
 * Response body for `GET /analytics/top-products` (#1988) — a page of
 * products ranked by revenue or units, each carrying its own inline
 * per-channel breakdown, catalog display metadata, and a coverage-gap flag.
 *
 * Currency correctness (#2049/ADR-040), same rule as
 * `sales-analytics-response.dto.ts`: `revenue` sums only reporting-currency-
 * stamped orders — see `currency` for which one, and
 * `unconvertedRevenue`/`unconvertedOrderCount` for what's excluded.
 *
 * `name`/`sku` and `missingFromConnectionIds` are populated by the apps/api
 * composition service (`TopProductsService`), NOT by the core
 * `TopProductView` this DTO otherwise mirrors — see that service's header
 * for why the enrichment lives at this layer.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { ProductChannelBreakdownRow, TopProductView } from '@openlinker/core/orders';

export class ProductChannelBreakdownDto {
  @ApiProperty()
  sourceConnectionId!: string;

  @ApiProperty()
  units!: number;

  @ApiProperty()
  revenue!: number;

  @ApiProperty({
    description: 'Native-currency sum for this channel’s unstamped orders — informational only.',
  })
  unconvertedRevenue!: number;

  @ApiProperty({ type: String, nullable: true })
  currency!: string | null;

  static fromDomain(row: ProductChannelBreakdownRow): ProductChannelBreakdownDto {
    const dto = new ProductChannelBreakdownDto();
    dto.sourceConnectionId = row.sourceConnectionId;
    dto.units = row.units;
    dto.revenue = row.revenue;
    dto.unconvertedRevenue = row.unconvertedRevenue;
    dto.currency = row.currency;
    return dto;
  }
}

export class TopProductRowDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Product display name. Null when the product id could not be resolved to a live catalogue entry.',
  })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sku!: string | null;

  @ApiProperty()
  units!: number;

  @ApiProperty({ description: 'Comparable (reporting-currency) revenue — see currency.' })
  revenue!: number;

  @ApiProperty({
    description:
      'Native-currency sum for this product’s unstamped orders in range — informational, may mix currencies, never reflected in revenue.',
  })
  unconvertedRevenue!: number;

  @ApiProperty({
    description: 'Distinct unstamped orders contributing to unconvertedRevenue.',
  })
  unconvertedOrderCount!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Reporting currency revenue is expressed in. Null when no order is stamped yet.',
  })
  currency!: string | null;

  @ApiProperty({ type: [ProductChannelBreakdownDto] })
  channels!: ProductChannelBreakdownDto[];

  @ApiProperty({
    type: [String],
    description:
      'Listing-capable connection ids where this product has sales but no variant is currently listed.',
  })
  missingFromConnectionIds!: string[];

  static fromDomain(
    view: TopProductView,
    catalog: { name: string | null; sku: string | null },
    missingFromConnectionIds: string[]
  ): TopProductRowDto {
    const dto = new TopProductRowDto();
    dto.productId = view.productId;
    dto.name = catalog.name;
    dto.sku = catalog.sku;
    dto.units = view.units;
    dto.revenue = view.revenue;
    dto.unconvertedRevenue = view.unconvertedRevenue;
    dto.unconvertedOrderCount = view.unconvertedOrderCount;
    dto.currency = view.currency;
    dto.channels = view.channels.map((row) => ProductChannelBreakdownDto.fromDomain(row));
    dto.missingFromConnectionIds = missingFromConnectionIds;
    return dto;
  }
}

export class TopProductsResponseDto {
  @ApiProperty({ type: [TopProductRowDto] })
  items!: TopProductRowDto[];

  @ApiProperty({ description: 'Total distinct products matching scope, before pagination.' })
  total!: number;

  @ApiProperty({
    description:
      'Count of items in this page whose productId could not be resolved to a live catalogue entry (name/sku are null for those rows) — never silently dropped.',
  })
  unresolvedProductCount!: number;
}
