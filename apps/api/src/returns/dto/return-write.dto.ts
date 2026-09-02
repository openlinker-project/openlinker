/**
 * Return Write DTOs (#2376, `W2-39`)
 *
 * Authorize, match-to-order, operator-authored record, and the refund
 * confirmation.
 *
 * No DTO here carries an `actorUserId`. The actor is always taken from the
 * verified token — a body-supplied one would let a caller attribute their own
 * act to someone else in the audit trail these records exist to be, which is the
 * rule the `decline` route already states.
 *
 * @module apps/api/src/returns/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AuthorizeReturnOutcomeValues,
  ReturnMoneyStateValues,
  ReturnOriginValues,
  type AuthorizeReturnOutcome,
  type ReturnMoneyState,
  type ReturnOrigin,
} from '@openlinker/core/returns';
import { RefundReasonValues, type RefundReason } from '@openlinker/core/orders/types';

const NOTE_MAX_LENGTH = 500;

/** Decimal string, matching the `RefundRecord.amount` convention. */
const DECIMAL_AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;

/** ISO 4217, 3 uppercase letters. */
const ISO_4217 = /^[A-Z]{3}$/;

export class AuthorizeReturnResponseDto {
  @ApiProperty({
    enum: AuthorizeReturnOutcomeValues,
    description: '`already-authorized` is a success, not a refusal — the act is idempotent.',
  })
  outcome!: AuthorizeReturnOutcome;

  @ApiProperty({ nullable: true, description: 'The ADR-044 change-proposal row.' })
  changeId!: string | null;

  @ApiProperty({ nullable: true, description: "OpenLinker's own instant, ISO-8601." })
  authorizedAt!: string | null;
}

export class MatchReturnToOrderDto {
  @ApiProperty({
    description:
      'The internal OpenLinker order id to attribute this return to. Proved through ' +
      '`identifier_mappings` — an id OpenLinker never minted is refused.',
    example: 'ol_order_a1b2c3',
  })
  @IsString()
  @IsNotEmpty()
  internalOrderId!: string;
}

export class MatchReturnToOrderResponseDto {
  @ApiProperty({ description: 'The return, now attributed.' })
  returnId!: string;

  @ApiProperty({
    nullable: true,
    description:
      'The attributed order. Attribution is MONOTONIC — there is no unmatch, so this value can be ' +
      'filled in once and never changed.',
  })
  internalOrderId!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO-8601. Null when no operator matched it.' })
  matchedAt!: string | null;
}

export class RecordReturnLineDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sku?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string | null;

  @ApiProperty({ enum: RefundReasonValues })
  @IsIn(RefundReasonValues)
  reason!: RefundReason;

  @ApiProperty({ minimum: 1, description: 'Positive whole units.' })
  @IsInt()
  @Min(1)
  quantityAdvised!: number;

  @ApiPropertyOptional({ nullable: true, maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string | null;
}

export class RecordReturnDto {
  @ApiProperty({ description: 'The internal OpenLinker order id this return is against.' })
  @IsString()
  @IsNotEmpty()
  internalOrderId!: string;

  @ApiProperty({
    description:
      'The channel the return is recorded against. REQUIRED and validated, never guessed: ' +
      'OpenLinker checks the order actually maps there, which also derives the external order id ' +
      'from the winning mapping rather than accepting a typed string.',
  })
  @IsString()
  @IsNotEmpty()
  sourceConnectionId!: string;

  @ApiProperty({ type: [RecordReturnLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecordReturnLineDto)
  lines!: RecordReturnLineDto[];
}

export class RecordReturnResponseDto {
  @ApiProperty() returnId!: string;
  @ApiProperty({ nullable: true }) internalOrderId!: string | null;
  @ApiProperty({
    enum: ReturnOriginValues,
    description: 'Always `operator_authored` on this route.',
  })
  origin!: ReturnOrigin;
  @ApiProperty({ description: 'ISO-8601.' }) openedAt!: string;
}

export class ConfirmReturnRefundDto {
  @ApiProperty({
    description: 'Decimal string, e.g. "19.99".',
    example: '19.99',
  })
  @IsString()
  @Matches(DECIMAL_AMOUNT, {
    message: 'amount must be a decimal string with at most two fraction digits',
  })
  amount!: string;

  @ApiProperty({ description: 'ISO 4217, 3 uppercase letters.', example: 'PLN' })
  @IsString()
  @Matches(ISO_4217, { message: 'currency must be a 3-letter ISO 4217 code' })
  currency!: string;

  @ApiProperty({ enum: RefundReasonValues })
  @IsIn(RefundReasonValues)
  reason!: RefundReason;

  @ApiPropertyOptional({ maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}

export class ConfirmReturnRefundResponseDto {
  @ApiProperty({
    enum: ReturnMoneyStateValues,
    description:
      "The money state the return's claimed lines now carry. `triggered` means OpenLinker recorded " +
      'that the operator moved the money; `refunded` is only ever entered on a source observation.',
  })
  moneyState!: ReturnMoneyState;

  @ApiProperty({ type: [String], description: 'The lines this attempt claimed.' })
  claimedLineIds!: string[];

  @ApiProperty({
    description:
      'Whether money actually moved. `false` for a `denied` / `in_doubt` outcome — the attempt was ' +
      'recorded and there was nothing to write. Distinct from `refundRecordWritten`.',
  })
  moneyMoved!: boolean;

  @ApiProperty({
    description:
      'Whether the linked `RefundRecord` was written. `false` WITH `moneyMoved: true` is the one ' +
      'state that needs an operator action: the money state settled durably but its record did ' +
      'not land, and the fix is to capture it on the order (`POST /orders/:orderId/refunds`). ' +
      'The two writes are not atomic and cannot be — two contexts, two repositories — so the ' +
      'ordering makes this the survivable failure rather than "recorded but still refundable".',
  })
  refundRecordWritten!: boolean;

  @ApiProperty({ nullable: true, description: 'The written record, when one was written.' })
  refundRecordId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Why the record write did not land, when it did not.',
  })
  refundRecordError!: string | null;

  @ApiProperty({ nullable: true, description: "The source's own words, where it said anything." })
  providerMessage!: string | null;
}
