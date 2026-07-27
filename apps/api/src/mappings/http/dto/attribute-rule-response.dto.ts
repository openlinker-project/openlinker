/**
 * Attribute Mapping Rule Response DTO
 *
 * Wire shape for attribute mapping rule endpoints (#1841). Flattens the
 * discriminated core `config` union into the same flat kind-specific fields the
 * input DTO uses, so the FE editor round-trips one shape.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttributeMappingRuleKind } from '@openlinker/core/mappings';
import type {
  AttributeMappingRule,
  AttributeRuleValueRemap,
  PlaceValueSource,
} from '@openlinker/core/mappings';

export class AttributeRuleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  destinationConnectionId!: string;

  @ApiProperty()
  destinationParameterName!: string;

  @ApiProperty()
  kind!: AttributeMappingRuleKind;

  @ApiProperty()
  priority!: number;

  @ApiPropertyOptional({ nullable: true })
  sourceConnectionId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  destinationCategoryId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  manufacturerMatch!: string | null;

  @ApiPropertyOptional({ nullable: true })
  phraseMatch!: string | null;

  @ApiPropertyOptional({ nullable: true })
  fixedValue!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceAttributeKey!: string | null;

  @ApiPropertyOptional({ type: [Object], nullable: true })
  valueRemap!: AttributeRuleValueRemap[] | null;

  @ApiPropertyOptional({ nullable: true })
  placeValueSource!: PlaceValueSource | null;

  static fromDomain(rule: AttributeMappingRule): AttributeRuleResponseDto {
    const dto = new AttributeRuleResponseDto();
    dto.id = rule.id;
    dto.destinationConnectionId = rule.destinationConnectionId;
    dto.destinationParameterName = rule.destinationParameterName;
    dto.kind = rule.kind;
    dto.priority = rule.priority;
    dto.sourceConnectionId = rule.sourceConnectionId;
    dto.destinationCategoryId = rule.destinationCategoryId;
    dto.manufacturerMatch = rule.manufacturerMatch;
    dto.phraseMatch = rule.phraseMatch;
    dto.fixedValue = rule.config.kind === 'fixed' ? rule.config.value : null;
    dto.sourceAttributeKey =
      rule.config.kind === 'copy-remap' ? rule.config.sourceAttributeKey : null;
    dto.valueRemap = rule.config.kind === 'copy-remap' ? rule.config.valueRemap : null;
    dto.placeValueSource = rule.config.kind === 'place-value' ? rule.config.source : null;
    return dto;
  }
}
