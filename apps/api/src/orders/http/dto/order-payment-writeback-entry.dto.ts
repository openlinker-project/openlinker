/**
 * Order payment writeback entry DTO (#3963)
 *
 * One destination shop's answer to "did the payment that arrived after the
 * shop got this order reach it?". Read by the order detail Payment panel and
 * the list's "payment not sent to shop" marker.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentWritebackReasonValues,
  PaymentWritebackStateValues,
  type PaymentWritebackReason,
  type PaymentWritebackState,
} from '@openlinker/core/orders';

export class OrderPaymentWritebackEntryDto {
  @ApiProperty({ description: 'The destination shop connection this entry is about' })
  destinationConnectionId!: string;

  @ApiProperty({
    enum: PaymentWritebackStateValues,
    description:
      'awaiting = the shop got the order unpaid and waits for the payment; sending = a write is in ' +
      'flight; paid-in-shop = the shop now shows it paid; created-paid = the order was already ' +
      'paid when the shop got it; retrying = the shop did not answer and OpenLinker retries on its ' +
      'own; not-sent = nothing will be sent (see reason); cod = cash on delivery, never marked ' +
      'paid; not-tracked = the shop has no payment status; skipped-by-setting = the connection ' +
      'leaves payment to the operator; handled = an operator dealt with a not-sent entry.',
  })
  state!: PaymentWritebackState;

  @ApiProperty({ description: 'When this entry last changed (ISO 8601)' })
  at!: string;

  @ApiProperty({ description: 'Send attempts made so far' })
  attempts!: number;

  @ApiPropertyOptional({
    enum: PaymentWritebackReasonValues,
    nullable: true,
    description:
      'Why a not-sent entry was not sent. Only retries-exhausted, rejected and no-total are problems an ' +
      'operator has to act on; cancelled and refunded are deliberate.',
  })
  reason!: PaymentWritebackReason | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "The shop's own message for a failed or retried attempt. For Activity, never a label.",
  })
  detail!: string | null;

  @ApiProperty({ description: 'True when an operator has to act: the shop still shows the order unpaid and OpenLinker gave up' })
  problem!: boolean;
}
