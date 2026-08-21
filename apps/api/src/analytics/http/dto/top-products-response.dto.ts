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
 * for why the enrichment lives at this layer. `coverageGapAvailable` (#2172
 * review, SUGGESTION 5) is response-level: `false` means the coverage-gap
 * enrichment failed for this whole response, so every row's
 * `missingFromConnectionIds` is an unreliable `[]` rather than evidence the
 * product is listed everywhere.
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

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The one native currency shared by every order on this channel contributing to unconvertedRevenue, or null when that subset mixes currencies (or unconvertedRevenue is 0). Computed per-channel — not inherited from the parent row, which may go null on a mixed set this channel’s own subset does not share (#2172 review).',
  })
  unconvertedCurrency!: string | null;

  static fromDomain(row: ProductChannelBreakdownRow): ProductChannelBreakdownDto {
    const dto = new ProductChannelBreakdownDto();
    dto.sourceConnectionId = row.sourceConnectionId;
    dto.units = row.units;
    dto.revenue = row.revenue;
    dto.unconvertedRevenue = row.unconvertedRevenue;
    dto.currency = row.currency;
    dto.unconvertedCurrency = row.unconvertedCurrency;
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

  @ApiProperty({
    description:
      'Comparable (reporting-currency) revenue — see currency. This is LINE revenue (unit price × quantity, at the order’s own implicit FX rate), summed per product — not a per-product slice of an order’s total. It therefore will not sum to the order-level revenue reported by GET /analytics/sales, which also includes shipping, order-level discounts, and anything else an order’s total carries beyond its line sum (#2172 review, IMPORTANT 2). Ranking is also blind to unconvertedRevenue: a product selling entirely in unstamped orders ranks at 0 and may not appear in a top page even though it sells.',
  })
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

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The one native currency shared by every order contributing to unconvertedRevenue, or null when that set mixes currencies (or unconvertedRevenue is 0).',
  })
  unconvertedCurrency!: string | null;

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
    dto.unconvertedCurrency = view.unconvertedCurrency;
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

  @ApiProperty({
    description:
      'False when the coverage-gap enrichment failed for this response — every row’s missingFromConnectionIds is then an unreliable empty array (not evidence the product is listed everywhere), not a real answer. Render the column as unavailable rather than trusting an all-empty result.',
  })
  coverageGapAvailable!: boolean;
}
