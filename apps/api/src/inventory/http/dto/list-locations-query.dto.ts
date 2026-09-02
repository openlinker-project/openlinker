/**
 * List Inventory Locations Query DTO
 *
 * Query parameters for GET /inventory/locations (#2316). All filters optional
 * and AND-combined.
 *
 * **Pagination is `page`/`limit`, not the `limit`/`offset` its sibling
 * `ListInventoryQueryDto` uses.** That divergence is bound by the core
 * `InventoryLocationPagination` contract, which is 1-based page/limit; echoing
 * it verbatim keeps the transport honest about what the read actually did
 * rather than translating between two pagination models at the boundary.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  InventoryLocationKindValues,
  InventoryLocationStatusValues,
  type InventoryLocationKind,
  type InventoryLocationStatus,
} from '@openlinker/core/inventory';

export class ListLocationsQueryDto {
  @ApiPropertyOptional({ enum: InventoryLocationKindValues })
  @IsOptional()
  @IsIn(InventoryLocationKindValues)
  kind?: InventoryLocationKind;

  @ApiPropertyOptional({
    enum: InventoryLocationStatusValues,
    description:
      'Opt-in. Absent means every status is listed, including `inactive` — soft retirement keeps a location visible.',
  })
  @IsOptional()
  @IsIn(InventoryLocationStatusValues)
  status?: InventoryLocationStatus;

  @ApiPropertyOptional({
    description: 'ISO-3166-1 alpha-2. Matched case-insensitively (uppercased by the controller).',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryIso2?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive prefix match on code' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  codePrefix?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: '1-based page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}
