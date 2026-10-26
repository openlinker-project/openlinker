/**
 * Connection Pricing Sync Response DTOs (#3146, ADR-072)
 *
 * Dedicated RESPONSE classes, distinct from the request-side `PricingRuleDto`
 * / `PricingSyncSettingDto` (`pricing-sync-setting.dto.ts`) (#3163 review,
 * finding 2 — a re-review). `@nestjs/swagger` keys generated OpenAPI schema
 * definitions by CLASS NAME, so reusing a request DTO on a response schema
 * makes both directions share one published shape: a later validation
 * tightening on the request side (e.g. narrowing `percent`'s floor further)
 * would silently narrow the documented response too, and `class-validator`
 * decorators on a class that is never validated (a response is never passed
 * through `ValidationPipe`) read as active constraints in the generated
 * Swagger document when they are not. These classes carry `@ApiProperty`
 * only — no `class-validator` decorators at all.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  PriceRoundingModeValues,
  PriceSyncModeValues,
  PricingRuleTypeValues,
  type PriceRoundingMode,
  type PriceSyncMode,
  type PricingRule,
  type PricingRuleType,
} from '@openlinker/core/identifier-mapping';
import type {
  ConnectionAsSourceEntry,
  ConnectionPricingSyncSetting,
  ConnectionPricingSyncSourceEntry,
  ConnectionPricingSyncView,
} from '../../application/types/connection-pricing-sync.types';

export class PricingRuleResponseDto {
  @ApiProperty({ enum: PricingRuleTypeValues })
  type!: PricingRuleType;

  @ApiProperty({ description: 'Present (0 or more) unless type is passthrough.', required: false })
  percent?: number;

  @ApiProperty({ enum: PriceRoundingModeValues, required: false })
  rounding?: PriceRoundingMode;

  static fromDomain(rule: PricingRule): PricingRuleResponseDto {
    const dto = new PricingRuleResponseDto();
    dto.type = rule.type;
    dto.percent = rule.percent;
    dto.rounding = rule.rounding;
    return dto;
  }
}

export class PricingSyncSettingResponseDto {
  @ApiProperty({ enum: PriceSyncModeValues })
  mode!: PriceSyncMode;

  /**
   * `null` means "no rule configured" — see `ConnectionPricingSyncSetting`'s
   * own docblock (`connection-pricing-sync.types.ts`). Reported verbatim,
   * never synthesized into `{type: 'passthrough'}` (#3163 review, finding 3).
   */
  @ApiProperty({ type: PricingRuleResponseDto, nullable: true })
  rule!: PricingRuleResponseDto | null;

  static fromDomain(setting: ConnectionPricingSyncSetting): PricingSyncSettingResponseDto {
    const dto = new PricingSyncSettingResponseDto();
    dto.mode = setting.mode;
    dto.rule = setting.rule ? PricingRuleResponseDto.fromDomain(setting.rule) : null;
    return dto;
  }
}

export class ConnectionPricingSyncSourceEntryDto {
  @ApiProperty() sourceConnectionId!: string;
  @ApiProperty() sourceLabel!: string;
  @ApiProperty({ description: 'True when this source has its own sync-mode override.' })
  modeOverridden!: boolean;
  @ApiProperty({ description: 'True when this source has its own pricing-rule override.' })
  ruleOverridden!: boolean;
  @ApiProperty({ type: PricingSyncSettingResponseDto }) effective!: PricingSyncSettingResponseDto;
  @ApiProperty() openEpisodeCount!: number;

  static fromDomain(entry: ConnectionPricingSyncSourceEntry): ConnectionPricingSyncSourceEntryDto {
    const dto = new ConnectionPricingSyncSourceEntryDto();
    dto.sourceConnectionId = entry.sourceConnectionId;
    dto.sourceLabel = entry.sourceLabel;
    dto.modeOverridden = entry.modeOverridden;
    dto.ruleOverridden = entry.ruleOverridden;
    dto.effective = PricingSyncSettingResponseDto.fromDomain(entry.effective);
    dto.openEpisodeCount = entry.openEpisodeCount;
    return dto;
  }
}

export class ConnectionPricingSyncResponseDto {
  @ApiProperty({ type: PricingSyncSettingResponseDto }) default!: PricingSyncSettingResponseDto;
  @ApiProperty({ type: [ConnectionPricingSyncSourceEntryDto] })
  sources!: ConnectionPricingSyncSourceEntryDto[];

  static fromDomain(view: ConnectionPricingSyncView): ConnectionPricingSyncResponseDto {
    const dto = new ConnectionPricingSyncResponseDto();
    dto.default = PricingSyncSettingResponseDto.fromDomain(view.default);
    dto.sources = view.sources.map((s) => ConnectionPricingSyncSourceEntryDto.fromDomain(s));
    return dto;
  }
}

export class ConnectionAsSourceEntryResponseDto {
  @ApiProperty() destinationConnectionId!: string;
  @ApiProperty() destinationLabel!: string;
  @ApiProperty({ enum: PriceSyncModeValues }) effectiveMode!: PriceSyncMode;
  @ApiProperty({ type: PricingRuleResponseDto, nullable: true })
  effectiveRuleSummary!: PricingRuleResponseDto | null;
  @ApiProperty({
    description: 'True when this connection has its own sync-mode override on the destination.',
  })
  modeOverridden!: boolean;
  @ApiProperty({
    description: 'True when this connection has its own pricing-rule override on the destination.',
  })
  ruleOverridden!: boolean;

  static fromDomain(entry: ConnectionAsSourceEntry): ConnectionAsSourceEntryResponseDto {
    const dto = new ConnectionAsSourceEntryResponseDto();
    dto.destinationConnectionId = entry.destinationConnectionId;
    dto.destinationLabel = entry.destinationLabel;
    dto.effectiveMode = entry.effectiveMode;
    dto.effectiveRuleSummary = entry.effectiveRuleSummary
      ? PricingRuleResponseDto.fromDomain(entry.effectiveRuleSummary)
      : null;
    dto.modeOverridden = entry.modeOverridden;
    dto.ruleOverridden = entry.ruleOverridden;
    return dto;
  }
}
