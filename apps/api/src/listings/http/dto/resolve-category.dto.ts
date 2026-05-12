/**
 * Resolve Category DTOs
 *
 * Request and response DTOs for the category-resolution endpoint (#631).
 * Mirrors `CategoryResolutionInput` / `CategoryResolutionResult` from
 * `@openlinker/core/listings` — the controller delegates straight to the
 * service; this file is the validated boundary.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  CategoryResolutionMethodValues,
  type CategoryResolutionMethod,
} from '@openlinker/core/listings';

export class ResolveCategoryRequestDto {
  @ApiPropertyOptional({
    description: 'EAN or GTIN barcode for auto-detect (step 1). Omit to skip auto-detect.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @ApiPropertyOptional({
    description:
      'Source platform category IDs for mapping fallback (step 2), ordered deepest-first. Omit to skip mapping.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ArrayMaxSize(32)
  sourceCategoryIds?: string[];
}

export class ResolveCategoryResponseDto {
  @ApiProperty({
    description: 'Resolved marketplace category ID, or null if the operator must pick manually.',
    nullable: true,
  })
  allegroCategoryId!: string | null;

  @ApiProperty({
    description: 'Which step of the 3-step fallback produced the result.',
    enum: CategoryResolutionMethodValues,
  })
  method!: CategoryResolutionMethod;
}
