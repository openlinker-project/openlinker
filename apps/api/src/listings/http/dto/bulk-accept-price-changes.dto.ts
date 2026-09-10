/**
 * Bulk Accept Price Changes DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkAcceptPriceChangeItemDto {
  @ApiProperty({ description: 'The price-change episode id.' })
  @IsString()
  id!: string;

  @ApiPropertyOptional({ description: "Also set this item's (source, connection) pair to `automatic`." })
  @IsOptional()
  @IsBoolean()
  optInAutomatic?: boolean;
}

export class BulkAcceptPriceChangesDto {
  @ApiProperty({ type: [BulkAcceptPriceChangeItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkAcceptPriceChangeItemDto)
  items!: BulkAcceptPriceChangeItemDto[];
}
