/**
 * Pricing Sync Setting DTOs (#3146, ADR-072)
 *
 * Validates a `{mode, rule}` pair — reuses `PricingRuleTypeValues` /
 * `PriceRoundingModeValues` / `PriceSyncModeValues` (the runtime arrays
 * `readPricingRule`/`readPriceSyncModeConfig` already validate against at
 * read time) so this DTO can never accept a shape those helpers would
 * silently coerce away.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  PriceRoundingModeValues,
  PriceSyncModeValues,
  PricingRuleTypeValues,
  type PriceRoundingMode,
  type PriceSyncMode,
  type PricingRuleType,
} from '@openlinker/core/identifier-mapping';

export class PricingRuleDto {
  @ApiProperty({ enum: PricingRuleTypeValues })
  @IsIn(PricingRuleTypeValues)
  type!: PricingRuleType;

  @ApiProperty({ description: 'Required (and must be > 0) unless type is passthrough.' })
  @ValidateIf((o: PricingRuleDto) => o.type !== 'passthrough')
  @IsNumber()
  @Min(0.0001)
  percent?: number;

  @ApiProperty({ enum: PriceRoundingModeValues })
  @IsOptional()
  @IsIn(PriceRoundingModeValues)
  rounding?: PriceRoundingMode;
}

export class PricingSyncSettingDto {
  @ApiProperty({ enum: PriceSyncModeValues })
  @IsIn(PriceSyncModeValues)
  mode!: PriceSyncMode;

  @ApiProperty({ type: PricingRuleDto })
  @ValidateNested()
  @Type(() => PricingRuleDto)
  rule!: PricingRuleDto;
}
