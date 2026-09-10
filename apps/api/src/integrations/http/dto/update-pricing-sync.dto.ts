/**
 * Update Pricing Sync DTO (#3146, ADR-072)
 *
 * `sourceOverrides` is validated manually in the controller (a class-validator
 * `Record<string, T>` shape has no first-class nested-validation decorator) —
 * see `PriceChangesController`... actually `ConnectionPricingSyncController`'s
 * `updatePricingSync` for the per-entry pass.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PricingSyncSettingDto } from './pricing-sync-setting.dto';

export class UpdatePricingSyncDto {
  @ApiProperty({ type: PricingSyncSettingDto })
  @ValidateNested()
  @Type(() => PricingSyncSettingDto)
  default!: PricingSyncSettingDto;

  @ApiPropertyOptional({
    description: 'Per-source overrides, keyed by source connection id.',
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/PricingSyncSettingDto' },
  })
  @IsOptional()
  @IsObject()
  sourceOverrides?: Record<string, PricingSyncSettingDto>;
}
