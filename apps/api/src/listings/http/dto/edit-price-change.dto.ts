/**
 * Edit Price Change DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EditPriceChangeDto {
  @ApiProperty({ description: 'The operator-pinned price to publish instead of the rule-computed one.' })
  @IsNumber()
  @IsPositive()
  manualPriceOverride!: number;

  @ApiPropertyOptional({ description: "Also set this (source, connection) pair's sync mode to `automatic`." })
  @IsOptional()
  @IsBoolean()
  optInAutomatic?: boolean;

  @ApiPropertyOptional({ description: 'The episode version last seen by the caller — the staleness guard.' })
  @IsOptional()
  @IsString()
  expectedVersion?: string;
}
