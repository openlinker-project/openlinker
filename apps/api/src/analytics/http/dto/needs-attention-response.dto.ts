/**
 * Needs Attention Response DTO
 *
 * Response body for `GET /analytics/needs-attention` (#1983). Combines the
 * three "needs attention" aggregates — coverage gaps, stock at risk, and
 * value stuck in failed syncs — each carrying enough identity for the FE to
 * deep-link into the flow that resolves it.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type {
  CoverageGapItem,
  StockAtRiskItem,
} from '@openlinker/core/listings';
import type { FailedSyncValueSummary } from '@openlinker/core/orders';

export class CoverageGapItemDto {
  @ApiProperty()
  variantId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ type: [String] })
  listedOnConnectionIds!: string[];

  @ApiProperty({ type: [String] })
  missingFromConnectionIds!: string[];

  static fromDomain(item: CoverageGapItem): CoverageGapItemDto {
    const dto = new CoverageGapItemDto();
    dto.variantId = item.variantId;
    dto.productId = item.productId;
    dto.listedOnConnectionIds = item.listedOnConnectionIds;
    dto.missingFromConnectionIds = item.missingFromConnectionIds;
    return dto;
  }
}

export class StockAtRiskItemDto {
  @ApiProperty()
  variantId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  masterStock!: number;

  @ApiProperty()
  stockSafetyBuffer!: number;

  @ApiProperty({
    description:
      "The connection's zero threshold. 0 means it is off and the buffer alone accounts for the " +
      'variant publishing nothing.',
  })
  stockZeroThreshold!: number;

  static fromDomain(item: StockAtRiskItem): StockAtRiskItemDto {
    const dto = new StockAtRiskItemDto();
    dto.variantId = item.variantId;
    dto.productId = item.productId;
    dto.connectionId = item.connectionId;
    dto.masterStock = item.masterStock;
    dto.stockSafetyBuffer = item.stockSafetyBuffer;
    dto.stockZeroThreshold = item.stockZeroThreshold;
    return dto;
  }
}

export class FailedSyncValueSummaryDto {
  @ApiProperty()
  count!: number;

  @ApiProperty()
  totalValue!: number;

  @ApiProperty({
    description: 'True when the failed orders span more than one currency (the sum is currency-naive in that case).',
  })
  mixedCurrency!: boolean;

  @ApiProperty({ type: String, nullable: true })
  oldestFailedAt!: string | null;

  static fromDomain(summary: FailedSyncValueSummary): FailedSyncValueSummaryDto {
    const dto = new FailedSyncValueSummaryDto();
    dto.count = summary.count;
    dto.totalValue = summary.totalValue;
    dto.mixedCurrency = summary.mixedCurrency;
    dto.oldestFailedAt = summary.oldestFailedAt ? summary.oldestFailedAt.toISOString() : null;
    return dto;
  }
}

export class NeedsAttentionResponseDto {
  @ApiProperty({ type: [CoverageGapItemDto] })
  coverageGaps!: CoverageGapItemDto[];

  @ApiProperty({
    description: 'Total gap count before the page-size cap was applied — distinguishes "there are more" from "this is everything".',
  })
  coverageGapsTotalCount!: number;

  @ApiProperty({ type: [StockAtRiskItemDto] })
  stockAtRisk!: StockAtRiskItemDto[];

  @ApiProperty({
    description: 'Total at-risk count before the page-size cap was applied.',
  })
  stockAtRiskTotalCount!: number;

  @ApiProperty({ type: FailedSyncValueSummaryDto })
  failedSyncValue!: FailedSyncValueSummaryDto;
}
