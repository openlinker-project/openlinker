/**
 * Mapping Option Response DTO
 *
 * Single option item returned by helper endpoints used to populate
 * FE dropdowns (Allegro/PrestaShop available values).
 *
 * Mirrors the neutral `MappingOption` shape from `@openlinker/core/orders`.
 * The optional `kind` discriminator (#517) lets the FE decorate runtime-
 * dynamic options (e.g. the OpenLinker PS Dynamic carrier) without
 * platform-specific type branches.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  MappingOptionKind,
  MappingOptionKindValues,
} from '@openlinker/core/orders';

export class MappingOptionResponseDto {
  @ApiProperty({ description: 'Option value used in mapping configuration' })
  value!: string;

  @ApiProperty({ description: 'Human-readable label for display' })
  label!: string;

  @ApiPropertyOptional({
    description:
      "Behaviour discriminator. 'dynamic' means shipping cost is computed at runtime by an external module (e.g. OpenLinker PS Dynamic carrier). Static options omit this field.",
    enum: MappingOptionKindValues,
  })
  kind?: MappingOptionKind;
}
