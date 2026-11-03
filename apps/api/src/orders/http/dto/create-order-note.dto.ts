/**
 * Create Order Note DTO (#3531)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateOrderNoteDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ default: false, description: 'PII warning applies — see mockup M3.' })
  @IsOptional()
  @IsBoolean()
  showToPacker?: boolean;
}
