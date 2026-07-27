/**
 * Attribute Mapping Rule Input DTO
 *
 * Request body for upserting one operator-authored attribute mapping rule
 * (#1841). `id` present ⇒ update; absent ⇒ create. Kind-specific fields are flat
 * and optional here; the controller assembles the discriminated `config` union
 * (and rejects a missing kind-specific field) before handing off to core.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AttributeMappingRuleKindValues,
  PlaceValueSourceValues,
  type AttributeMappingRuleKind,
  type PlaceValueSource,
} from '@openlinker/core/mappings';

export class AttributeRuleValueRemapDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sourceValue!: string;

  @ApiProperty()
  @IsString()
  destinationValue!: string;
}

export class AttributeRuleInputDto {
  @ApiPropertyOptional({ description: 'Rule id; present to update, absent to create' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ description: 'Destination attribute/parameter name to fill' })
  @IsString()
  @IsNotEmpty()
  destinationParameterName!: string;

  @ApiProperty({ enum: AttributeMappingRuleKindValues })
  @IsIn(AttributeMappingRuleKindValues)
  kind!: AttributeMappingRuleKind;

  @ApiProperty({ description: 'Application order; lower runs first, later wins' })
  @IsInt()
  priority!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  sourceConnectionId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  destinationCategoryId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  manufacturerMatch?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  phraseMatch?: string | null;

  @ApiPropertyOptional({ description: 'fixed kind: the constant value' })
  @IsOptional()
  @IsString()
  fixedValue?: string;

  @ApiPropertyOptional({ description: 'copy-remap kind: source attribute key to copy' })
  @IsOptional()
  @IsString()
  sourceAttributeKey?: string;

  @ApiPropertyOptional({ type: [AttributeRuleValueRemapDto], description: 'copy-remap kind: value translations' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeRuleValueRemapDto)
  valueRemap?: AttributeRuleValueRemapDto[];

  @ApiPropertyOptional({ enum: PlaceValueSourceValues, description: 'place-value kind: metadata source' })
  @IsOptional()
  @IsIn(PlaceValueSourceValues)
  placeValueSource?: PlaceValueSource;
}
