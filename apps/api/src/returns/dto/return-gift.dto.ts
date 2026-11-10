/**
 * Return Gift DTOs (#3943, gifts spec section 9)
 *
 * No DTO carries an actor: it always comes from the verified token. The refund
 * is never changed by these routes; `refundDeductionGross` is a figure the
 * operator reads and chooses to apply.
 *
 * @module apps/api/src/returns/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ReturnGiftDecisionValues, type ReturnGiftDecisionValue } from '@openlinker/core/returns';

export class ReturnGiftDto {
  @ApiProperty({ description: 'The order line id of the gift.' })
  giftLineId!: string;
  @ApiProperty({ nullable: true }) sku!: string | null;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty({ enum: ['channel', 'cart-rule', 'ol-rule', 'operator'] }) giftSource!: string;
  @ApiProperty({
    nullable: true,
    description: 'What the gift costs the customer if bought alone, gross, for the whole quantity. Null when the catalogue has no price.',
  })
  standalonePriceGross!: number | null;
  @ApiProperty({ enum: ReturnGiftDecisionValues, nullable: true, description: 'Null until the operator decides.' })
  decision!: ReturnGiftDecisionValue | null;
  @ApiProperty({ nullable: true }) deductionGross!: number | null;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty({ nullable: true }) decidedAt!: string | null;
}

export class ReturnGiftsResponseDto {
  @ApiProperty({ type: [ReturnGiftDto] }) gifts!: ReturnGiftDto[];
  @ApiProperty({ nullable: true }) currency!: string | null;
  @ApiProperty({ description: 'Sum of the recorded `deduct` amounts. A hint for the refund; never applied by itself.' })
  refundDeductionGross!: number;
}

export class DecideReturnGiftDto {
  @ApiProperty({ enum: ReturnGiftDecisionValues })
  @IsIn(ReturnGiftDecisionValues)
  decision!: ReturnGiftDecisionValue;

  @ApiPropertyOptional({
    description:
      'Only for `deduct`: the gross amount to take off the refund. Defaults to the gift\'s standalone price.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  deductionGross?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
