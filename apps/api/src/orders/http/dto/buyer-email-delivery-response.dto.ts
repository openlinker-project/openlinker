/**
 * Buyer Email Delivery Response DTO (#3554)
 *
 * One row of `GET /orders/:internalOrderId/buyer-emails`, for the order timeline
 * ("Shipped email sent to buyer" / "suppressed: emails are off" / "bounced").
 * Deliberately carries NO recipient: operator and viewer may read the outcome,
 * not the buyer's address.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  BuyerEmailTemplateValues,
  type BuyerEmailTemplate,
} from '@openlinker/core/identifier-mapping';
import {
  BUYER_EMAIL_SUPPRESSION_MESSAGE,
  BuyerEmailOutcomeValues,
  BuyerEmailSuppressionReasonValues,
  type BuyerEmailDelivery,
  type BuyerEmailOutcome,
  type BuyerEmailSuppressionReason,
} from '@openlinker/core/orders';

export class BuyerEmailDeliveryResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty() connectionId!: string;

  @ApiProperty({ enum: BuyerEmailTemplateValues })
  templateKey!: BuyerEmailTemplate;

  @ApiProperty({
    description: 'What the email was about: the return id for `return-received`, else the order id.',
  })
  subjectRef!: string;

  @ApiProperty({ enum: BuyerEmailOutcomeValues })
  outcome!: BuyerEmailOutcome;

  @ApiProperty({ nullable: true, enum: BuyerEmailSuppressionReasonValues })
  suppressionReason!: BuyerEmailSuppressionReason | null;

  @ApiProperty({ nullable: true, description: 'Why nothing was sent, in readable words.' })
  suppressionMessage!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: BuyerEmailDelivery): BuyerEmailDeliveryResponseDto {
    const dto = new BuyerEmailDeliveryResponseDto();
    dto.id = row.id;
    dto.connectionId = row.connectionId;
    dto.templateKey = row.templateKey;
    dto.subjectRef = row.subjectRef;
    dto.outcome = row.outcome;
    dto.suppressionReason = row.suppressionReason;
    dto.suppressionMessage = row.suppressionReason
      ? BUYER_EMAIL_SUPPRESSION_MESSAGE[row.suppressionReason]
      : null;
    dto.createdAt = row.createdAt;
    return dto;
  }
}
