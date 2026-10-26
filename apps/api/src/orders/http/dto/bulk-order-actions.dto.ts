/**
 * Bulk Order Action DTOs (#3545)
 *
 * Request and response shapes for the bulk cancel and bulk buyer-note-read
 * routes on the orders list. Per-row results, never all-or-nothing; reasons are
 * PII-free and machine `code`s carry the single-order refusal vocabulary.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { OrderCancelReasonValues, type OrderCancelReason } from '@openlinker/core/orders';
import { BULK_ORDER_ACTION_MAX } from '../bulk-row-result';

export class BulkOrderIdsRequestDto {
  @ApiProperty({
    description: 'Internal order ids. Repeated ids are collapsed to one outcome.',
    type: [String],
    maxItems: BULK_ORDER_ACTION_MAX,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_ORDER_ACTION_MAX)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderIds!: string[];
}

export class BulkCancelOrdersRequestDto extends BulkOrderIdsRequestDto {
  @ApiProperty({ enum: OrderCancelReasonValues, description: 'One reason for the whole batch.' })
  @IsIn(OrderCancelReasonValues)
  reason!: OrderCancelReason;

  @ApiPropertyOptional({ description: 'Operator note; required when reason is `other`.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Cancel orders whose fulfilment work a holder already accepted. Applies to every row.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeAcceptedWork?: boolean;
}

export const BulkCancelOutcomeValues = [
  'cancelled',
  'pending',
  'correction-proposed',
  'refused',
  'failed',
] as const;
export type BulkCancelOutcome = (typeof BulkCancelOutcomeValues)[number];

export class BulkCancelOrderResultDto {
  @ApiProperty() orderId!: string;

  @ApiProperty({
    enum: BulkCancelOutcomeValues,
    description:
      '`cancelled`: applied. `pending`: the channel has not answered, request stays open. ' +
      '`correction-proposed`: cancelled and a credit proposal awaits confirmation. ' +
      '`refused`: the order state refuses the cancel (see `code`). `failed`: not found or unexpected error.',
  })
  outcome!: BulkCancelOutcome;

  @ApiPropertyOptional({
    description: 'Machine code of a refusal or failure, e.g. ORDER_ALREADY_SHIPPED, LABEL_NOT_VOIDABLE.',
  })
  code?: string;

  @ApiPropertyOptional({ description: 'PII-free explanation for `refused` / `failed`.' })
  reason?: string;

  @ApiPropertyOptional({ description: 'Pass to POST /orders/:id/changes/:changeId/confirm.' })
  correctionProposalChangeId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Side effects a plain outcome hides: `stock-restored-only:<connectionId>`, `destination-not-notified`, ' +
      '`correction-unavailable:<reason>`, `stock-restore-not-queued`. Empty or absent when none.',
  })
  warnings?: string[];
}

export class BulkCancelOrdersResponseDto {
  @ApiProperty({ description: 'Distinct orders processed.' }) total!: number;
  @ApiProperty() cancelled!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() correctionProposed!: number;
  @ApiProperty() refused!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [BulkCancelOrderResultDto] }) results!: BulkCancelOrderResultDto[];
}

export const BulkBuyerNoteOutcomeValues = [
  'marked',
  'already-read',
  'no-note',
  'not-found',
  'failed',
] as const;
export type BulkBuyerNoteOutcome = (typeof BulkBuyerNoteOutcomeValues)[number];

export class BulkBuyerNoteReadResultDto {
  @ApiProperty() orderId!: string;

  @ApiProperty({
    enum: BulkBuyerNoteOutcomeValues,
    description: '`no-note`: the order has no buyer note, so there is nothing to mark (skipped, not an error).',
  })
  outcome!: BulkBuyerNoteOutcome;

  @ApiPropertyOptional({ description: 'PII-free reason, present for `failed`.' })
  reason?: string;
}

export class BulkBuyerNoteReadResponseDto {
  @ApiProperty() total!: number;
  @ApiProperty() marked!: number;
  @ApiProperty() alreadyRead!: number;
  @ApiProperty() noNote!: number;
  @ApiProperty() notFound!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [BulkBuyerNoteReadResultDto] }) results!: BulkBuyerNoteReadResultDto[];
}
