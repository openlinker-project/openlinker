/**
 * List Users Query DTO
 *
 * Query parameters for GET /users. Uses class-transformer @Type to coerce
 * string query params to numbers before class-validator @IsInt runs.
 *
 * @module apps/api/src/users/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { UserStatusValues } from '@openlinker/core/users';
import type { UserStatus } from '@openlinker/core/users';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: UserStatusValues, description: 'Filter by account status' })
  @IsOptional()
  @IsIn(UserStatusValues)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Zero-based page number', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size (1–100)', default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
