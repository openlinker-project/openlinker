/**
 * Category Parameter Response DTO
 *
 * Wire shape returned by
 * `GET /listings/connections/:connectionId/categories/:categoryId/parameters`
 * (#410). Mirrors the marketplace-neutral `CategoryParameter` from
 * `@openlinker/core/listings` 1:1 — the controller hands the FE the same
 * structure CORE exposes so there is no transport-level remapping to keep in
 * sync. Restricts the surface to read-only.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

import { CategoryParameterTypeValues } from '@openlinker/core/listings';

export class CategoryParameterDictionaryEntryResponseDto {
  @ApiProperty({ description: 'Allegro-issued dictionary entry ID.' })
  id!: string;

  @ApiProperty({ description: 'Human-readable label for the entry (operator-language).' })
  value!: string;

  @ApiProperty({
    type: [String],
    required: false,
    description:
      'Entry-level dependency. When non-empty, this entry is selectable only when the parent parameter (identified by the parameter\'s `dependsOn.parameterId`) has one of these value IDs.',
  })
  dependsOnValueIds?: string[];
}

export class CategoryParameterRestrictionsResponseDto {
  @ApiProperty({ required: false })
  multipleChoices?: boolean;
  @ApiProperty({ required: false })
  range?: boolean;
  @ApiProperty({ required: false })
  min?: number;
  @ApiProperty({ required: false })
  max?: number;
  @ApiProperty({ required: false })
  minLength?: number;
  @ApiProperty({ required: false })
  maxLength?: number;
  @ApiProperty({ required: false })
  precision?: number;
  @ApiProperty({
    required: false,
    description: 'Maximum number of values the user may submit (e.g. 1 for single, 5/20 for capped multi-text).',
  })
  allowedNumberOfValues?: number;
  @ApiProperty({
    required: false,
    description: 'Dictionary allows free-text entries alongside the dictionary list (combobox).',
  })
  customValuesEnabled?: boolean;
}

export class CategoryParameterDependsOnResponseDto {
  @ApiProperty({ description: 'Parent parameter ID this parameter depends on for visibility.' })
  parameterId!: string;

  @ApiProperty({
    type: [String],
    description: 'Parent value IDs that activate this parameter (any-of).',
  })
  valueIds!: string[];
}

export class CategoryParameterResponseDto {
  @ApiProperty({ description: 'Stable parameter ID (Allegro-issued).' })
  id!: string;

  @ApiProperty({ description: 'Human label (operator-language, typically Polish).' })
  name!: string;

  @ApiProperty({ enum: CategoryParameterTypeValues })
  type!: (typeof CategoryParameterTypeValues)[number];

  @ApiProperty({ description: 'Whether the parameter is required for offer creation.' })
  required!: boolean;

  @ApiProperty({ required: false, description: 'Optional unit label (e.g. "mm", "kg", "Mpx").' })
  unit?: string;

  @ApiProperty({
    type: [CategoryParameterDictionaryEntryResponseDto],
    required: false,
    description: 'Present when type === "dictionary".',
  })
  dictionary?: CategoryParameterDictionaryEntryResponseDto[];

  @ApiProperty({ type: CategoryParameterRestrictionsResponseDto })
  restrictions!: CategoryParameterRestrictionsResponseDto;

  @ApiProperty({
    type: CategoryParameterDependsOnResponseDto,
    required: false,
    description:
      'Parameter-level visibility dependency. Distinct from `dictionary[i].dependsOnValueIds`, which filters dictionary entries within an already-visible parameter.',
  })
  dependsOn?: CategoryParameterDependsOnResponseDto;
}

export class CategoryParametersListResponseDto {
  @ApiProperty({ type: [CategoryParameterResponseDto] })
  parameters!: CategoryParameterResponseDto[];
}
