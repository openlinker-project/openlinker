/**
 * Send Document Email Response DTO (#1353, widened by #3550)
 *
 * Small result of `POST /invoices/:invoiceId/send-email` and
 * `POST /fiscal-registrations/:id/send-email`. `sentVia` names who delivered it
 * ("Sent via", mockup M24): the provider's own mechanism, or OpenLinker's mailer.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { DocumentEmailSentViaValues, type DocumentEmailSentVia } from '@openlinker/core/sales-documents';

export class SendInvoiceEmailResponseDto {
  @ApiProperty({ description: 'True when the message was handed to the sender.' })
  delivered!: boolean;

  @ApiProperty({ nullable: true, description: 'The recipient the send was addressed to, if known.' })
  recipient!: string | null;

  @ApiProperty({
    enum: DocumentEmailSentViaValues,
    description:
      "Who delivered it: `provider` (the connection's own email capability) or `openlinker` (OpenLinker's mailer).",
  })
  sentVia!: DocumentEmailSentVia;
}
