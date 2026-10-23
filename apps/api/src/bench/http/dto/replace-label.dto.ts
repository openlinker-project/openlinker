/**
 * Replace-label request (#3654)
 *
 * Parcel data ONLY. The app-wide `ValidationPipe` runs with `whitelist` and
 * `forbidNonWhitelisted`, so any other property (a recipient, an address, a
 * shipment id, an email) is rejected with 400 before the controller runs; this
 * class must therefore never grow one. Exactly one of three shapes is accepted:
 * `{ template }`, `{ lengthMm, widthMm, heightMm, weightGrams }` or
 * `{ weightGrams }` - combinations are refused by {@link toReplaceLabelParcel}.
 *
 * @module apps/api/src/bench/http/dto
 */
import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import type { BenchReplaceLabelParcel } from '../../application/types/bench-label.types';

/** Generous carrier ceilings; the carrier's own preflight is the real limit. */
export const REPLACE_LABEL_MAX_DIMENSION_MM = 3000;
export const REPLACE_LABEL_MAX_WEIGHT_GRAMS = 100_000;

export class ReplaceLabelDto {
  @ApiPropertyOptional({ description: 'A size code the routed carrier supports (e.g. "small").' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,32}$/)
  template?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: REPLACE_LABEL_MAX_DIMENSION_MM })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(REPLACE_LABEL_MAX_DIMENSION_MM)
  lengthMm?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: REPLACE_LABEL_MAX_DIMENSION_MM })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(REPLACE_LABEL_MAX_DIMENSION_MM)
  widthMm?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: REPLACE_LABEL_MAX_DIMENSION_MM })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(REPLACE_LABEL_MAX_DIMENSION_MM)
  heightMm?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: REPLACE_LABEL_MAX_WEIGHT_GRAMS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(REPLACE_LABEL_MAX_WEIGHT_GRAMS)
  weightGrams?: number;
}

export function toReplaceLabelParcel(dto: ReplaceLabelDto): BenchReplaceLabelParcel {
  const { template, lengthMm, widthMm, heightMm, weightGrams } = dto;
  const hasBox = lengthMm !== undefined || widthMm !== undefined || heightMm !== undefined;

  if (template !== undefined && !hasBox && weightGrams === undefined) {
    return { kind: 'template', template };
  }
  if (
    template === undefined &&
    lengthMm !== undefined &&
    widthMm !== undefined &&
    heightMm !== undefined &&
    weightGrams !== undefined
  ) {
    return { kind: 'box', lengthMm, widthMm, heightMm, weightGrams };
  }
  if (template === undefined && !hasBox && weightGrams !== undefined) {
    return { kind: 'weight', weightGrams };
  }
  throw new BadRequestException(
    'Send exactly one of: { template }, { lengthMm, widthMm, heightMm, weightGrams }, { weightGrams }'
  );
}
