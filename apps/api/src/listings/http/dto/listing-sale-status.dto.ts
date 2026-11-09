/**
 * Listing Sale Status DTOs (#3962)
 *
 * Wire shapes for the product page's "Sales channels" section: one row per
 * listing with the channel's own status, the quantity it reported and what
 * OpenLinker did after a master deletion, plus "put back on sale".
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import {
  ListingSaleHoldEntityTypeValues,
  ListingSaleHoldMethodValues,
  ListingSaleHoldOutcomeValues,
  ListingSaleHoldReasonValues,
  ListingSaleStateValues,
  type ListingSaleHoldEntityType,
  type ListingSaleHoldMethod,
  type ListingSaleHoldOutcome,
  type ListingSaleHoldReason,
  type ListingSaleState,
} from '@openlinker/core/listings';

export class ListingSaleRowHoldDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ListingSaleHoldMethodValues }) method!: ListingSaleHoldMethod;
  @ApiProperty({ enum: ListingSaleHoldOutcomeValues }) outcome!: ListingSaleHoldOutcome;
  @ApiPropertyOptional({ enum: ListingSaleHoldReasonValues, nullable: true })
  outcomeReason!: ListingSaleHoldReason | null;
  @ApiProperty() appliedAt!: string;
}

export class ListingSaleRowDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty({ enum: ListingSaleHoldEntityTypeValues }) entityType!: ListingSaleHoldEntityType;
  @ApiProperty({ description: 'Offer id, or shop product id' }) externalId!: string;
  @ApiPropertyOptional({ nullable: true }) externalParentId!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Null for a grouped shop product parent' })
  internalVariantId!: string | null;
  @ApiPropertyOptional({ nullable: true, description: "The channel's own last-read status word" })
  channelStatus!: string | null;
  @ApiPropertyOptional({ nullable: true }) quantity!: number | null;
  @ApiPropertyOptional({ nullable: true }) lastCheckedAt!: string | null;
  @ApiPropertyOptional({ type: ListingSaleRowHoldDto, nullable: true }) hold!: ListingSaleRowHoldDto | null;
  @ApiProperty({ enum: ListingSaleStateValues }) state!: ListingSaleState;
}

export class ProductSaleStatusResponseDto {
  @ApiProperty() productId!: string;
  @ApiProperty({ description: 'At least one variant is deleted at the source' }) deletedAtSource!: boolean;
  @ApiPropertyOptional({ nullable: true }) deletedAt!: string | null;
  @ApiProperty({ type: [String] }) staleVariantIds!: string[];
  @ApiProperty({ description: 'SKUs of the deleted variants (orders link)', type: [String] })
  staleSkus!: string[];
  @ApiPropertyOptional({
    nullable: true,
    description: 'Orders created since the deletion that mention a deleted SKU; null when nothing is deleted',
  })
  ordersSinceDeletion!: number | null;
  @ApiPropertyOptional({ nullable: true }) checkedAt!: string | null;
  @ApiProperty({ type: [ListingSaleRowDto] }) rows!: ListingSaleRowDto[];
}

export class ReleaseSaleHoldsRequestDto {
  @ApiProperty({ type: [String], description: 'Holds to put back on sale' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  holdIds!: string[];
}

export class ReleaseSaleHoldFailureDto {
  @ApiProperty() holdId!: string;
  @ApiProperty() message!: string;
}

export class ReleaseSaleHoldsResponseDto {
  @ApiProperty({ type: [String] }) released!: string[];
  @ApiProperty({ type: [ReleaseSaleHoldFailureDto] }) failed!: ReleaseSaleHoldFailureDto[];
}

export class SaleHoldAttentionCountResponseDto {
  @ApiProperty({ description: 'Products deleted at the source that a channel still sells' })
  productsStillOnSale!: number;
}
