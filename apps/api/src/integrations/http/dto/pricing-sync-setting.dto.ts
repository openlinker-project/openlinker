/**
 * Pricing Sync Setting DTOs (#3146, ADR-072)
 *
 * Validates a `{mode, rule}` pair — reuses `PricingRuleTypeValues` /
 * `PriceRoundingModeValues` / `PriceSyncModeValues` (the runtime arrays
 * `readPricingRule`/`readPriceSyncModeConfig` already validate against at
 * read time) so this DTO can never accept a shape those helpers would
 * silently coerce away.
 *
 * `percent`'s floor is `@Min(0)`, not a positive epsilon (#3163 review,
 * finding 4): `coercePricingRule` coerces a missing/non-finite `percent` to
 * `0`, and `ConnectionService.validateOnePricingRule` accepts `percent: 0` —
 * so `{type: 'markup', percent: 0}` is a legal, GET-able config. A stricter
 * floor here would make this endpoint refuse a payload its own GET produced
 * the moment an operator round-trips it unchanged. The margin ceiling
 * (`percent < 100` for `type: 'margin'`) mirrors
 * `ConnectionService.validateOnePricingRule`'s own refusal verbatim — that
 * validator is still the authoritative gate (reached via
 * `ConnectionService.update`), this is a same-shaped, faster 400 at the
 * boundary.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  Min,
  ValidateIf,
  ValidateNested,
  Validate,
  type ValidationArguments,
  type ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  PriceRoundingModeValues,
  PriceSyncModeValues,
  PricingRuleTypeValues,
  type PriceRoundingMode,
  type PriceSyncMode,
  type PricingRuleType,
} from '@openlinker/core/identifier-mapping';

@ValidatorConstraint({ name: 'pricingRuleMarginCeiling', async: false })
class PricingRuleMarginCeilingConstraint implements ValidatorConstraintInterface {
  validate(percent: unknown, args: ValidationArguments): boolean {
    const rule = args.object as PricingRuleDto;
    if (rule.type !== 'margin' || typeof percent !== 'number') {
      return true;
    }
    return percent < 100;
  }

  defaultMessage(): string {
    return (
      'percent must be below 100 for a margin rule. To add more than the catalogue price, ' +
      'use a markup instead.'
    );
  }
}

export class PricingRuleDto {
  @ApiProperty({ enum: PricingRuleTypeValues })
  @IsIn(PricingRuleTypeValues)
  type!: PricingRuleType;

  @ApiProperty({ description: 'Required (0 or more) unless type is passthrough.' })
  @ValidateIf((o: PricingRuleDto) => o.type !== 'passthrough')
  @IsNumber()
  @Min(0)
  @Validate(PricingRuleMarginCeilingConstraint)
  percent?: number;

  @ApiProperty({ enum: PriceRoundingModeValues })
  @IsOptional()
  @IsIn(PriceRoundingModeValues)
  rounding?: PriceRoundingMode;
}

/** The connection's default mode + rule — `rule` is REQUIRED but NULLABLE. */
export class PricingSyncSettingDto {
  @ApiProperty({ enum: PriceSyncModeValues })
  @IsIn(PriceSyncModeValues)
  mode!: PriceSyncMode;

  /**
   * `null` means "no rule configured" (`applyPricingRule`'s pure-passthrough
   * arm — no rounding, no float cleanup), and is a DISTINCT, legal state
   * from an explicit `{type: 'passthrough'}` rule, which does apply rounding
   * (#3163 review, finding 3). `buildView` reports this verbatim rather than
   * synthesizing a passthrough default, so a GET→Save round-trip on a
   * connection that has never configured a rule can never silently switch
   * rounding on.
   */
  @ApiProperty({ type: PricingRuleDto, nullable: true })
  @ValidateIf((o: PricingSyncSettingDto) => o.rule !== null)
  @ValidateNested()
  @Type(() => PricingRuleDto)
  rule!: PricingRuleDto | null;
}

/**
 * A per-source override (#3163 review, finding 5): `mode` and `rule` are
 * INDEPENDENT and both optional, mirroring the two separate
 * `Connection.config.pricingRule.sourceOverrides` /
 * `.priceSyncMode.sourceOverrides` maps storage actually keeps. Welding them
 * into one required pair (the pre-review `PricingSyncSettingDto` reused
 * as-is) would materialize a rule override nobody authored the moment an
 * operator opts a source into `automatic` (which writes ONLY the mode half)
 * and a naive client round-trips the resulting `effective.rule` back as an
 * override.
 */
export class SourceOverrideSettingDto {
  @ApiPropertyOptional({ enum: PriceSyncModeValues })
  @IsOptional()
  @IsIn(PriceSyncModeValues)
  mode?: PriceSyncMode;

  @ApiPropertyOptional({ type: PricingRuleDto, nullable: true })
  @IsOptional()
  @ValidateIf((o: SourceOverrideSettingDto) => o.rule !== null && o.rule !== undefined)
  @ValidateNested()
  @Type(() => PricingRuleDto)
  rule?: PricingRuleDto | null;
}
