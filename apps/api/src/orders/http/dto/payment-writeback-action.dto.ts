/**
 * Payment writeback action DTOs (#3963)
 *
 * Body and answer of the two operator actions on orders whose payment did not
 * reach a shop: Retry (send again) and Mark as handled (dealt with in the shop).
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class PaymentWritebackActionRequestDto {
  @ApiProperty({ type: [String], description: 'Internal order ids, 1 to 200', maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  internalOrderIds!: string[];
}

export class PaymentWritebackRetryResponseDto {
  @ApiProperty({ description: 'How many shop writes were queued again' })
  enqueued!: number;
}

export class PaymentWritebackHandledResponseDto {
  @ApiProperty({ description: 'How many orders had a problem entry marked as handled' })
  updated!: number;
}
