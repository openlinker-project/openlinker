/**
 * Top Product Variants Response DTO
 *
 * Response body for `GET /analytics/top-products/:productId/variants`
 * (#2765) — one product's sales split by variant, per channel. Fetched
 * lazily by the Analytics Top Products expand panel, never embedded in
 * `GET /analytics/top-products`'s paged list response — see
 * `TopProductsService.getTopProductVariantSales`'s header for why.
 *
 * `sku`/`attributes`/`totalAvailable` are populated by the apps/api
 * composition service, NOT by the core `VariantSalesView` this DTO otherwise
 * mirrors — same layering as `TopProductRowDto`'s `name`/`sku`.
 * `totalAvailable` is the raw available quantity (never a pre-derived
 * "low/out" label — the frontend already owns that derivation via
 * `deriveStockStatus`, `features/products`, so deriving it twice would risk
 * the two disagreeing); `null` for the `variantId: null` "Unassigned"
 * bucket, which names no real variant to look stock up for.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { VariantChannelBreakdownRow, VariantSalesResult, VariantSalesView } from '@openlinker/core/orders';

export class VariantChannelBreakdownDto {
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
      'The one native currency shared by every order on this channel contributing to unconvertedRevenue, or null when that subset mixes currencies (or unconvertedRevenue is 0).',
  })
  unconvertedCurrency!: string | null;

  @ApiProperty({
    description:
      'VAT-exclusive counterpart of revenue for this channel — see the parent row’s netRevenue for the full definition.',
  })
  netRevenue!: number;

  @ApiProperty({
    description: 'Comparable sum for this channel’s lines excluded from netRevenue due to an unresolvable tax rate.',
  })
  netExcludedRevenue!: number;

  @ApiProperty({ description: 'Count of lines contributing to netExcludedRevenue on this channel.' })
  netExcludedLineCount!: number;

  static fromDomain(row: VariantChannelBreakdownRow): VariantChannelBreakdownDto {
    const dto = new VariantChannelBreakdownDto();
    dto.sourceConnectionId = row.sourceConnectionId;
    dto.units = row.units;
    dto.revenue = row.revenue;
    dto.unconvertedRevenue = row.unconvertedRevenue;
    dto.currency = row.currency;
    dto.unconvertedCurrency = row.unconvertedCurrency;
    dto.netRevenue = row.netRevenue;
    dto.netExcludedRevenue = row.netExcludedRevenue;
    dto.netExcludedLineCount = row.netExcludedLineCount;
    return dto;
  }
}

export class TopProductVariantRowDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Internal variant id, or null for the "Unassigned" bucket — historical order lines written before per-line variant stamping (#1985), or lines that otherwise never resolved to one. Never merged into a real variant\'s figures.',
  })
  variantId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sku!: string | null;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Distinguishing attributes (e.g. Size, Color). Null for a simple product’s synthetic variant.',
  })
  attributes!: Record<string, string> | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Current available quantity across all locations. Null for the "Unassigned" bucket (variantId: null), which names no real variant to look stock up for.',
  })
  totalAvailable!: number | null;

  @ApiProperty()
  units!: number;

  @ApiProperty({ description: 'Comparable (reporting-currency) revenue — see currency.' })
  revenue!: number;

  @ApiProperty({
    description: 'Native-currency sum for this variant’s unstamped orders in range — informational only.',
  })
  unconvertedRevenue!: number;

  @ApiProperty({ description: 'Distinct unstamped orders contributing to unconvertedRevenue.' })
  unconvertedOrderCount!: number;

  @ApiProperty({ type: String, nullable: true })
  currency!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unconvertedCurrency!: string | null;

  @ApiProperty({ type: [VariantChannelBreakdownDto] })
  channels!: VariantChannelBreakdownDto[];

  @ApiProperty({
    description: 'VAT-exclusive counterpart of revenue (net-sales tax-rate epic) — see the top-products row for the full definition.',
  })
  netRevenue!: number;

  @ApiProperty({ description: 'Comparable sum for lines excluded from netRevenue due to an unresolvable tax rate.' })
  netExcludedRevenue!: number;

  @ApiProperty({ description: 'Count of lines contributing to netExcludedRevenue.' })
  netExcludedLineCount!: number;

  static fromDomain(
    view: VariantSalesView,
    catalog: { sku: string | null; attributes: Record<string, string> | null },
    totalAvailable: number | null
  ): TopProductVariantRowDto {
    const dto = new TopProductVariantRowDto();
    dto.variantId = view.variantId;
    dto.sku = catalog.sku;
    dto.attributes = catalog.attributes;
    dto.totalAvailable = totalAvailable;
    dto.units = view.units;
    dto.revenue = view.revenue;
    dto.unconvertedRevenue = view.unconvertedRevenue;
    dto.unconvertedOrderCount = view.unconvertedOrderCount;
    dto.currency = view.currency;
    dto.unconvertedCurrency = view.unconvertedCurrency;
    dto.channels = view.channels.map((row) => VariantChannelBreakdownDto.fromDomain(row));
    dto.netRevenue = view.netRevenue;
    dto.netExcludedRevenue = view.netExcludedRevenue;
    dto.netExcludedLineCount = view.netExcludedLineCount;
    return dto;
  }
}

export class TopProductVariantsResponseDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty({ type: [TopProductVariantRowDto] })
  variants!: TopProductVariantRowDto[];

  static fromDomain(
    result: VariantSalesResult,
    catalogByVariantId: Map<string, { sku: string | null; attributes: Record<string, string> | null }>,
    stockByVariantId: Map<string, number>
  ): TopProductVariantsResponseDto {
    const dto = new TopProductVariantsResponseDto();
    dto.productId = result.productId;
    dto.variants = result.variants.map((view) => {
      const catalog = (view.variantId && catalogByVariantId.get(view.variantId)) || {
        sku: null,
        attributes: null,
      };
      const totalAvailable = view.variantId ? stockByVariantId.get(view.variantId) ?? null : null;
      return TopProductVariantRowDto.fromDomain(view, catalog, totalAvailable);
    });
    return dto;
  }
}
