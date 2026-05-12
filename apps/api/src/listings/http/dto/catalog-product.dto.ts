/**
 * Catalog Product DTOs
 *
 * Request + response DTOs for the catalog-product reader endpoints (#633).
 * Only the request body carries `class-validator` decorators — responses use
 * plain TypeScript types matching the neutral `CatalogProduct*` shapes from
 * `@openlinker/core/listings`, with Swagger annotations via
 * `@ApiProperty` / `@ApiExtraModels` for documentation only.
 *
 * The response of `findProductsByBarcode` is a discriminated union; we
 * document its shape via `@ApiExtraModels` + `oneOf` rather than a single
 * concrete class, because class-validator's polymorphism support is fiddly
 * and these responses don't need runtime validation (the API owns the
 * production side).
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  CatalogProductMatchKindValues,
  type CatalogProductMatchKind,
  type CatalogProduct,
  type CatalogProductSummary,
  type CatalogProductParameter,
} from '@openlinker/core/listings';

export class FindProductsByBarcodeRequestDto {
  @ApiProperty({
    description: 'Product barcode (EAN/GTIN).',
    example: '5901234123457',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  barcode!: string;

  @ApiPropertyOptional({
    description:
      'Marketplace category id to narrow the search. Adapters MAY require it; ' +
      'the Allegro adapter today returns no_match when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;
}

export class CatalogProductParameterResponseDto implements CatalogProductParameter {
  @ApiProperty({ description: 'Stable parameter id; matches CategoryParameter.id.' })
  parameterId!: string;

  @ApiProperty({ description: 'Human-readable parameter name.' })
  name!: string;

  @ApiPropertyOptional({
    description: 'Dictionary value ids (mutually exclusive with valueStrings).',
    type: [String],
  })
  valueIds?: string[];

  @ApiPropertyOptional({
    description: 'Free-text values (mutually exclusive with valueIds).',
    type: [String],
  })
  valueStrings?: string[];
}

export class CatalogProductSummaryResponseDto implements CatalogProductSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  ean?: string;

  @ApiPropertyOptional({ description: 'Thumbnail URL. Often absent on ambiguous summaries.' })
  imageUrl?: string;
}

export class CatalogProductResponseDto implements CatalogProduct {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  ean?: string;

  @ApiPropertyOptional({ description: 'Thumbnail URL (first image).' })
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Ordered list of image URLs.', type: [String] })
  images?: string[];

  @ApiPropertyOptional({ description: 'Optional product description (out of scope today).' })
  description?: string;

  @ApiProperty({
    description: 'Product-section parameters carried by the catalog entry.',
    type: [CatalogProductParameterResponseDto],
  })
  parameters!: CatalogProductParameterResponseDto[];
}

@ApiExtraModels(CatalogProductResponseDto, CatalogProductSummaryResponseDto)
export class FindProductsByBarcodeResponseDto {
  @ApiProperty({
    description: '3-state discriminant: unique / ambiguous / no_match.',
    enum: CatalogProductMatchKindValues,
  })
  kind!: CatalogProductMatchKind;

  @ApiPropertyOptional({
    description: 'Present when kind = "unique". The eager-fetched full product.',
    type: () => CatalogProductResponseDto,
  })
  product?: CatalogProductResponseDto;

  @ApiPropertyOptional({
    description:
      'Present when kind = "ambiguous". Summaries only — call GET ' +
      '/listings/connections/:connectionId/products/:productId after the operator picks one.',
    type: () => [CatalogProductSummaryResponseDto],
  })
  products?: CatalogProductSummaryResponseDto[];
}

/**
 * Swagger schema reference helper — emits a `oneOf` so the discriminated
 * union is rendered cleanly in the OpenAPI doc. The runtime DTO above is the
 * flat union (NestJS serializes it as a plain object); this `oneOf` is for
 * the doc surface only.
 */
export const findProductsByBarcodeResponseSchema: SchemaObject = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['unique'] },
        product: { $ref: getSchemaPath(CatalogProductResponseDto) },
      },
      required: ['kind', 'product'],
    },
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['ambiguous'] },
        products: {
          type: 'array',
          items: { $ref: getSchemaPath(CatalogProductSummaryResponseDto) },
        },
      },
      required: ['kind', 'products'],
    },
    {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['no_match'] } },
      required: ['kind'],
    },
  ],
};
