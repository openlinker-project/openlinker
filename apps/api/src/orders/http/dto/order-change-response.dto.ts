/**
 * Order Change Response DTO (#3540)
 *
 * One operator-facing row of `GET /orders/:internalOrderId/changes`: what an
 * operator asked of an order (a cancel) and the credit proposal it left behind.
 * Codes and facts only. The note is operator-authored text, never buyer data.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { CancelCorrectionProposalLineDto } from './cancel-order-response.dto';

export class OrderChangeCancelRequestPayloadDto {
  @ApiProperty({ description: 'The closed reason code the operator chose.' })
  reason!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Operator free text; never sent to a channel.' })
  note!: string | null;
}

export class OrderChangeCorrectionPayloadDto {
  @ApiProperty() invoiceRecordId!: string;
  @ApiProperty({ nullable: true, type: String }) documentNumber!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [CancelCorrectionProposalLineDto] }) lines!: CancelCorrectionProposalLineDto[];
}

export class OrderChangePayloadDto {
  @ApiProperty({ type: OrderChangeCancelRequestPayloadDto, nullable: true })
  cancelRequest!: OrderChangeCancelRequestPayloadDto | null;

  @ApiProperty({ type: OrderChangeCorrectionPayloadDto, nullable: true })
  correction!: OrderChangeCorrectionPayloadDto | null;
}

export class OrderChangeResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty({ enum: ['order.cancel_request', 'order.cancel_correction'] })
  kind!: string;

  @ApiProperty({ description: 'Raw proposal status: pending | requested | confirmed | declined | canceled | expired.' })
  status!: string;

  @ApiProperty({
    description:
      'Whether the proposal is still open. A requested row past its TTL is not open even though its stored status has not been moved yet.',
  })
  open!: boolean;

  @ApiProperty() requestedAt!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Set only when the proposal was confirmed.' })
  confirmedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Why the authority refused, when it did.' })
  declinedReason!: string | null;

  @ApiProperty({ type: OrderChangePayloadDto })
  payload!: OrderChangePayloadDto;
}
