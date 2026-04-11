/**
 * List Customers Query DTO
 *
 * Query parameters for GET /customers. All fields are optional.
 *
 * @module apps/api/src/customers/http/dto
 */
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListCustomersQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive search on emailHash, normalizedEmail, firstName, or lastName',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by last source connection ID' })
  @IsOptional()
  @IsString()
  lastSourceConnectionId?: string;

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
