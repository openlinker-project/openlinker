/**
 * Price Change Item Response DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PriceChangeQueueItem } from '@openlinker/core/listings';

export class PriceChangeRuleSummaryDto {
  @ApiProperty() type!: string;
  @ApiProperty() percent!: number;
  @ApiProperty() rounding!: string;
}

export class PriceChangeItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() productVariantId!: string;
  @ApiProperty() productName!: string;
  @ApiPropertyOptional({ nullable: true }) variantLabel!: string | null;
  @ApiPropertyOptional({ nullable: true }) sku!: string | null;

  @ApiProperty() sourceConnectionId!: string;
  @ApiProperty() sourceLabel!: string;
  @ApiProperty() sourceOldAmount!: number;
  @ApiProperty() sourceNewAmount!: number;
  @ApiProperty() sourceCurrency!: string;

  @ApiProperty() destinationConnectionId!: string;
  @ApiProperty() destinationLabel!: string;
  @ApiPropertyOptional({
    nullable: true,
    description:
      "The destination's own currency — `null` when unresolvable (mirrors `blockReason: 'destination-currency-unknown'`).",
  })
  destinationCurrency!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "`null` when this episode has no recorded baseline (a brand-new mapping's first detection).",
  })
  computedOldAmount!: number | null;
  @ApiProperty() computedNewAmount!: number;
  @ApiPropertyOptional({ nullable: true, description: '`null` when `computedOldAmount` is `null`.' })
  deltaPct!: number | null;
  @ApiProperty() isSteep!: boolean;

  @ApiProperty({ type: PriceChangeRuleSummaryDto }) ruleSummary!: PriceChangeRuleSummaryDto;

  @ApiPropertyOptional({ nullable: true }) blockReason!: string | null;
  @ApiProperty() needsRefresh!: boolean;
  @ApiProperty() version!: string;

  @ApiPropertyOptional({ nullable: true }) manualPriceOverride!: number | null;
  @ApiPropertyOptional({ nullable: true }) resolution!: string | null;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) resolvedByUserId!: string | null;
  @ApiProperty() detectedAt!: string;

  static fromDomain(item: PriceChangeQueueItem): PriceChangeItemResponseDto {
    const dto = new PriceChangeItemResponseDto();
    Object.assign(dto, item);
    return dto;
  }
}
