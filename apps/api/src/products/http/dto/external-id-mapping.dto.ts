/**
 * External ID Mapping DTO
 *
 * Represents an external platform identifier mapped to an internal entity.
 * Used in product and variant detail responses for operator visibility.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class ExternalIdMappingDto {
  @ApiProperty({ description: 'External platform identifier' })
  externalId!: string;

  @ApiProperty({ description: 'Platform type (e.g. prestashop, allegro)' })
  platformType!: string;

  @ApiProperty({ description: 'Connection UUID' })
  connectionId!: string;
}
