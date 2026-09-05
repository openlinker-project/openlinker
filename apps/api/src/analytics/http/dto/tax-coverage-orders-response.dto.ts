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
import { ApiProperty } from '@nestjs/swagger';
import type { TaxCoverageLineRateObservation, TaxCoverageOrderRow } from '@openlinker/core/orders';
import {
  TaxRateStateValues,
  TaxRateUnknownReasonValues,
  type TaxRateState,
  type TaxRateUnknownReason,
} from '@openlinker/core/products';

/**
 * One line's resolved (or unresolved) rate observation, mirroring
 * `TaxCoverageLineRateObservation` (#2798) — carried per line so a
 * mixed-rate order's modal row never collapses to a single shared value.
 *
 * Every field is REQUIRED-but-nullable (`@ApiProperty({ nullable: true })`,
 * not `@ApiPropertyOptional`) — the value is always present on the wire,
 * just sometimes `null` (#2802 review); `ApiPropertyOptional` documents a
 * field that may be ABSENT, which is a different, stricter-than-true claim.
 */
export class TaxCoverageLineRateDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty({ nullable: true })
  variantId!: string | null;

  @ApiProperty({
    description: 'Resolved rate code (percent-as-string, or an exemption code) — `null` unless `state` is `known`.',
    nullable: true,
  })
  rateCode!: string | null;

  @ApiProperty({ enum: TaxRateStateValues })
  state!: TaxRateState;

  @ApiProperty({
    enum: TaxRateUnknownReasonValues,
    nullable: true,
    description: 'Why the catalogue named no rate (#2264) — `null` unless `state` is `no-rate` and the catalogue gave a reason.',
  })
  unknownReason!: TaxRateUnknownReason | null;

  static fromObservation(observation: TaxCoverageLineRateObservation): TaxCoverageLineRateDto {
    const dto = new TaxCoverageLineRateDto();
    dto.productId = observation.productId;
    dto.variantId = observation.variantId;
    dto.rateCode = observation.rateCode;
    dto.state = observation.state;
    dto.unknownReason = observation.unknownReason ?? null;
    return dto;
  }
}

export class TaxCoverageOrderDto {
  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty()
  sourceConnectionId!: string;

  @ApiProperty({
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
