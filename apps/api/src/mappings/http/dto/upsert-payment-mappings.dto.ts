/**
 * Upsert Payment Mappings DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMappingItemDto } from './payment-mapping-item.dto';

export class UpsertPaymentMappingsDto {
  @ApiProperty({ type: [PaymentMappingItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentMappingItemDto)
  items!: PaymentMappingItemDto[];
}
