/**
 * Upsert Payment Mappings DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMappingInputDto } from './payment-mapping-input.dto';

export class UpsertPaymentMappingsDto {
  @ApiProperty({ type: [PaymentMappingInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentMappingInputDto)
  items!: PaymentMappingInputDto[];
}
