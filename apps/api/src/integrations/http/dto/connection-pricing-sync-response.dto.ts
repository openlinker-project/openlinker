/**
 * Connection Pricing Sync Response DTOs (#3146, ADR-072)
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type {
  ConnectionAsSourceEntry,
  ConnectionPricingSyncSourceEntry,
  ConnectionPricingSyncView,
} from '../../application/types/connection-pricing-sync.types';
import { PricingRuleDto, PricingSyncSettingDto } from './pricing-sync-setting.dto';

export class ConnectionPricingSyncSourceEntryDto {
  @ApiProperty() sourceConnectionId!: string;
  @ApiProperty() sourceLabel!: string;
  @ApiProperty() isCustomOverride!: boolean;
  @ApiProperty({ type: PricingSyncSettingDto }) effective!: PricingSyncSettingDto;
  @ApiProperty() openEpisodeCount!: number;

  static fromDomain(entry: ConnectionPricingSyncSourceEntry): ConnectionPricingSyncSourceEntryDto {
    const dto = new ConnectionPricingSyncSourceEntryDto();
    Object.assign(dto, entry);
    return dto;
  }
}

export class ConnectionPricingSyncResponseDto {
  @ApiProperty({ type: PricingSyncSettingDto }) default!: PricingSyncSettingDto;
  @ApiProperty({ type: [ConnectionPricingSyncSourceEntryDto] }) sources!: ConnectionPricingSyncSourceEntryDto[];

  static fromDomain(view: ConnectionPricingSyncView): ConnectionPricingSyncResponseDto {
    const dto = new ConnectionPricingSyncResponseDto();
    dto.default = view.default;
    dto.sources = view.sources.map((s) => ConnectionPricingSyncSourceEntryDto.fromDomain(s));
    return dto;
  }
}

export class ConnectionAsSourceEntryResponseDto {
  @ApiProperty() destinationConnectionId!: string;
  @ApiProperty() destinationLabel!: string;
  @ApiProperty() effectiveMode!: string;
  @ApiProperty({ type: PricingRuleDto }) effectiveRuleSummary!: PricingRuleDto;
  @ApiProperty() isCustomOverride!: boolean;

  static fromDomain(entry: ConnectionAsSourceEntry): ConnectionAsSourceEntryResponseDto {
    const dto = new ConnectionAsSourceEntryResponseDto();
    Object.assign(dto, entry);
    return dto;
  }
}
