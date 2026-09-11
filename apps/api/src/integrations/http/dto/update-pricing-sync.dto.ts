/**
 * Update Pricing Sync DTO (#3146, ADR-072)
 *
 * `sourceOverrides` is validated by `@ValidateSourceOverrides` (#3163 review,
 * finding 8) — class-validator has no first-class nested decorator for a
 * `Record<string, T>` map's values, let alone its keys, so an undecorated
 * `@IsObject()` would let the global pipe's `whitelist`/`forbidNonWhitelisted`
 * pass straight through untouched. See
 * `validate-source-overrides.decorator.ts` for what this closes.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PricingSyncSettingDto, SourceOverrideSettingDto } from './pricing-sync-setting.dto';
import { ValidateSourceOverrides } from './validate-source-overrides.decorator';

export class UpdatePricingSyncDto {
  @ApiProperty({ type: PricingSyncSettingDto })
  @ValidateNested()
  @Type(() => PricingSyncSettingDto)
  default!: PricingSyncSettingDto;

  @ApiPropertyOptional({
    description: 'Per-source overrides, keyed by source connection id.',
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/SourceOverrideSettingDto' },
  })
  @IsOptional()
  @IsObject()
  @ValidateSourceOverrides(() => SourceOverrideSettingDto)
  sourceOverrides?: Record<string, SourceOverrideSettingDto>;

  @ApiPropertyOptional({
    description:
      "Optimistic-concurrency guard: the connection's `updatedAt` as last read by the caller. " +
      'When present, a mismatch against the persisted value refuses the write with a 409 ' +
      "(#3162's `optInAutomatic` and the review queue's Undo write the same config keys from " +
      'other call sites).',
  })
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}
