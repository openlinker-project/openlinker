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
import type { TaxCoverageLineRateObservation, TaxCoverageOrderRow } from '@openlinker/core/orders';
import { TaxRateStateValues, type TaxRateState } from '@openlinker/core/products';

/**
 * One line's resolved (or unresolved) rate observation, mirroring
 * `TaxCoverageLineRateObservation` (#2798) — carried per line so a
 * mixed-rate order's modal row never collapses to a single shared value.
 */
export class TaxCoverageLineRateDto {
  @ApiProperty()
  productId!: string;

  @ApiPropertyOptional({ nullable: true })
  variantId!: string | null;

  @ApiPropertyOptional({
    description: 'Resolved rate code (percent-as-string, or an exemption code) — `null` unless `state` is `known`.',
    nullable: true,
  })
  rateCode!: string | null;

  @ApiProperty({ enum: TaxRateStateValues })
  state!: TaxRateState;

  static fromObservation(observation: TaxCoverageLineRateObservation): TaxCoverageLineRateDto {
    const dto = new TaxCoverageLineRateDto();
    dto.productId = observation.productId;
    dto.variantId = observation.variantId;
    dto.rateCode = observation.rateCode;
    dto.state = observation.state;
    return dto;
  }
}

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

  @ApiProperty({
    type: [TaxCoverageLineRateDto],
    description: "Per-line rate observations for every one of the order's lines — never a single order-level rate.",
  })
  lineRates!: TaxCoverageLineRateDto[];

  static fromRow(row: TaxCoverageOrderRow): TaxCoverageOrderDto {
    const dto = new TaxCoverageOrderDto();
    dto.internalOrderId = row.internalOrderId;
    dto.sourceConnectionId = row.sourceConnectionId;
    dto.placedAt = row.placedAt;
    dto.lineRates = row.lineRates.map((observation) => TaxCoverageLineRateDto.fromObservation(observation));
    return dto;
  }
}

export class TaxCoverageOrdersResponseDto {
  @ApiProperty({ type: [TaxCoverageOrderDto] })
  items!: TaxCoverageOrderDto[];

  @ApiProperty({ description: 'Total affected orders in the requested category/range.' })
  total!: number;
}
