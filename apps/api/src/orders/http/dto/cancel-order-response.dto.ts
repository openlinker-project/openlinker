/**
 * Cancel Order Response DTOs (#3540)
 *
 * Codes and facts only; operator copy is the frontend's.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  CancelCorrectionUnavailableReasonValues,
  CancelParticipantEffectValues,
  type CancelCorrectionUnavailableReason,
  type CancelParticipantEffect,
} from '../../application/types/order-cancellation.types';

export class CancelParticipantOutcomeDto {
  @ApiProperty() connectionId!: string;

  @ApiProperty({ enum: ['source', 'destination'] }) role!: 'source' | 'destination';

  @ApiProperty({
    enum: CancelParticipantEffectValues,
    description:
      'What the cancel amounted to there: notified, stock-restored-only (the channel has no confirmed cancel call), not-supported, unreachable or refused.',
  })
  effect!: CancelParticipantEffect;

  @ApiProperty({ nullable: true, type: String }) detail!: string | null;
}

export class CancelCorrectionProposalLineDto {
  @ApiProperty() originalLineNumber!: number;
  @ApiProperty() name!: string;
  @ApiProperty() previousQuantity!: number;
  @ApiProperty() newQuantity!: number;
}

export class CancelCorrectionProposalDto {
  @ApiProperty({ description: 'Pass to POST /orders/:id/changes/:changeId/confirm to issue the credit.' })
  changeId!: string;

  @ApiProperty() invoiceRecordId!: string;
  @ApiProperty({ nullable: true, type: String }) documentNumber!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [CancelCorrectionProposalLineDto] }) lines!: CancelCorrectionProposalLineDto[];
}

export class CancelOrderResponseDto {
  @ApiProperty({
    enum: ['cancelled', 'pending'],
    description:
      '`pending` (HTTP 202): the sales channel has not answered; the request stays open and the order reads `amending`.',
  })
  status!: 'cancelled' | 'pending';

  @ApiProperty() changeId!: string;
  @ApiProperty({ nullable: true, type: String }) cancelledAt!: string | null;
  @ApiProperty({ type: [CancelParticipantOutcomeDto] }) participants!: CancelParticipantOutcomeDto[];

  @ApiProperty({ description: 'The destination shops could not be told at all (the relay itself failed).' })
  otherParticipantsRelayFailed!: boolean;

  @ApiProperty({ type: [String] }) voidedShipmentIds!: string[];
  @ApiProperty({ type: [String] }) cancelledWorkIds!: string[];
  @ApiProperty() stockRestoreEnqueued!: boolean;

  @ApiProperty({ type: CancelCorrectionProposalDto, nullable: true })
  correctionProposal!: CancelCorrectionProposalDto | null;

  @ApiProperty({ enum: CancelCorrectionUnavailableReasonValues, nullable: true })
  correctionUnavailableReason!: CancelCorrectionUnavailableReason | null;
}

export class ConfirmOrderChangeResponseDto {
  @ApiProperty() changeId!: string;
  @ApiProperty() kind!: string;
  @ApiProperty({ enum: ['confirmed'] }) status!: 'confirmed';
  @ApiProperty({ nullable: true, type: String, description: 'The issued correction; null for a refund confirmation.' })
  invoiceRecordId!: string | null;
  @ApiProperty({ nullable: true, type: String }) invoiceStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) documentNumber!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '`order.discount_refund`: the refund record the confirmation wrote; null otherwise.',
  })
  refundRecordId!: string | null;
}
