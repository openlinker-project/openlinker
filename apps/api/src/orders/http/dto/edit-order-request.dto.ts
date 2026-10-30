/**
 * Edit Order Request DTOs (#3542)
 *
 * Bodies of `POST /orders/:internalOrderId/edits/{address,lines,delivery-method}`.
 * The actor is never taken from the body: it is stamped from `@CurrentUser()`.
 * Every body accepts `dryRun`, which validates every gate and returns the
 * would-be figures without writing (M1's `edit-review` state).
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class DryRunDto {
  @ApiPropertyOptional({
    description: 'Check every refusal and return the figures after the edit, without saving anything.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class EditOrderAddressRequestDto extends DryRunDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) company?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) address1!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address2?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) city!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) state?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(32) postalCode!: string;
  @ApiProperty({ description: 'ISO 3166-1 alpha-2.' }) @IsString() @Length(2, 2) country!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) phone?: string;
}

export class EditOrderLineDto {
  @ApiProperty({ description: 'The order line id (`orderSnapshot.items[].id`).' })
  @IsString()
  @IsNotEmpty()
  orderLineId!: string;

  @ApiProperty({
    minimum: 0,
    description: 'The new TOTAL quantity of the line. Can only be lower than it is now; 0 removes the line.',
  })
  @IsInt()
  @Min(0)
  quantity!: number;
}

export class EditOrderLinesRequestDto extends DryRunDto {
  @ApiProperty({ type: [EditOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EditOrderLineDto)
  lines!: EditOrderLineDto[];

  @ApiPropertyOptional({
    description:
      'Set to true to lower a line whose work picking has started or an outside warehouse accepted. ' +
      'Without it the request is refused with ORDER_WORK_ACCEPTED_NEEDS_ACK.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeAcceptedWork?: boolean;
}

export class EditOrderPickupPointDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) id!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class EditOrderDeliveryMethodRequestDto extends DryRunDto {
  @ApiProperty({ description: 'The source delivery method id (the key carrier mapping rules match on).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  methodId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) methodName?: string;

  @ApiPropertyOptional({ type: EditOrderPickupPointDto, description: 'Omit to clear the pickup point.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EditOrderPickupPointDto)
  pickupPoint?: EditOrderPickupPointDto;
}
