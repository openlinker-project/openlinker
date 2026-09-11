/**
 * Price Change Auto-Applied Response DTO (#3145, ADR-072 decision 3)
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PriceChangeAutoAppliedView } from '@openlinker/core/listings';

export class PriceChangeAutoAppliedItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() productVariantId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ type: String, nullable: true }) variantLabel!: string | null;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty() destinationConnectionId!: string;
  @ApiProperty() sourceConnectionId!: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Null for a first-ever detection with no recorded baseline (#3159).',
  })
  oldAmount!: number | null;
  @ApiProperty() newAmount!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() appliedAt!: string;

  static fromView(entry: PriceChangeAutoAppliedView): PriceChangeAutoAppliedItemResponseDto {
    const dto = new PriceChangeAutoAppliedItemResponseDto();
    dto.id = entry.id;
    dto.productVariantId = entry.productVariantId;
    dto.productName = entry.productName;
    dto.variantLabel = entry.variantLabel;
    dto.sku = entry.sku;
    dto.destinationConnectionId = entry.destinationConnectionId;
    dto.sourceConnectionId = entry.sourceConnectionId;
    dto.oldAmount = entry.oldAmount;
    dto.newAmount = entry.newAmount;
    dto.currency = entry.currency;
    dto.appliedAt = entry.appliedAt.toISOString();
    return dto;
  }
}
