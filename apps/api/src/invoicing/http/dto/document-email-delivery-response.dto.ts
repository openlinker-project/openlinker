/**
 * Document Email Delivery Response DTO (#3550)
 *
 * One row of `GET /orders/:orderId/document-emails`, for the order timeline
 * ("Invoice emailed to buyer" / "Email to buyer failed"). Deliberately carries NO
 * recipient: operator and viewer may read the outcome, not the buyer's address.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  DocumentEmailFailureReasonValues,
  DocumentEmailOutcomeValues,
  DocumentEmailSentViaValues,
  type DocumentEmailDelivery,
  type DocumentEmailFailureReason,
  type DocumentEmailOutcome,
  type DocumentEmailSentVia,
} from '@openlinker/core/sales-documents';
import { ORDER_DOCUMENT_EMAIL_REFUSAL_MESSAGE } from '@openlinker/core/orders';

export class DocumentEmailDeliveryResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty({ description: '`invoice` or `fiscal-receipt`.' })
  documentKind!: string;

  @ApiProperty() documentId!: string;

  @ApiProperty({ nullable: true, enum: DocumentEmailSentViaValues })
  sentVia!: DocumentEmailSentVia | null;

  @ApiProperty({ enum: DocumentEmailOutcomeValues })
  outcome!: DocumentEmailOutcome;

  @ApiProperty({ nullable: true, enum: DocumentEmailFailureReasonValues })
  failureReason!: DocumentEmailFailureReason | null;

  @ApiProperty({
    nullable: true,
    description: 'The readable reason for a failure, in the same words the send route answered with.',
  })
  failureMessage!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: DocumentEmailDelivery): DocumentEmailDeliveryResponseDto {
    const dto = new DocumentEmailDeliveryResponseDto();
    dto.id = row.id;
    dto.documentKind = row.documentKind;
    dto.documentId = row.documentId;
    dto.sentVia = row.sentVia;
    dto.outcome = row.outcome;
    dto.failureReason = row.failureReason;
    dto.failureMessage = row.failureReason
      ? ORDER_DOCUMENT_EMAIL_REFUSAL_MESSAGE[row.failureReason]
      : null;
    dto.createdAt = row.createdAt;
    return dto;
  }
}
