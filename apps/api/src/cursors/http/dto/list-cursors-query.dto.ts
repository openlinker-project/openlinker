/**
 * List Cursors Query DTO
 *
 * Query parameters for GET /cursors. All fields are optional.
 *
 * @module apps/api/src/cursors/http/dto
 */
import { IsOptional, IsUUID, IsInt, Min, Max, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListCursorsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by connection ID (UUID)' })
  @IsOptional()
  @IsUUID('4')
  connectionId?: string;

  @ApiPropertyOptional({
    description:
      'Only cursors whose key starts with this text, matched literally (#4023). Used to page through one connection\'s per-listing stock write marks.',
    example: 'inventory.offerQuantity.observedAt:offer:',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyPrefix?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
