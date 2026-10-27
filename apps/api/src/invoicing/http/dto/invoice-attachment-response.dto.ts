/**
 * Invoice Attachment Response DTO (#3548)
 *
 * What a caller can attach for an issued document. Carries no bytes: for a PDF
 * it names the existing download route instead, so one response never embeds a
 * customer-facing document. `url` and `downloadPath` are mutually exclusive and
 * both `null` for `waiting` and `none`.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  InvoiceAttachmentStateValues,
  type InvoiceAttachment,
  type InvoiceAttachmentState,
} from '@openlinker/core/invoicing';

export class InvoiceAttachmentResponseDto {
  @ApiProperty({
    enum: InvoiceAttachmentStateValues,
    description:
      '`pdf` - real bytes at `downloadPath`; `link` - a public `url`; `waiting` - not cleared yet, ' +
      'try again later; `none` - cleared and there is still nothing to attach.',
  })
  state!: InvoiceAttachmentState;

  @ApiProperty({ type: String, nullable: true, description: 'Public url, for `link` only' })
  url!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Route that streams the PDF, for `pdf` only',
  })
  downloadPath!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'MIME type, for `pdf` only' })
  contentType!: string | null;

  static fromDomain(
    invoiceId: string,
    attachment: InvoiceAttachment
  ): InvoiceAttachmentResponseDto {
    const dto = new InvoiceAttachmentResponseDto();
    dto.state = attachment.state;
    dto.url = attachment.state === 'link' ? attachment.url : null;
    dto.downloadPath =
      attachment.state === 'pdf'
        ? `/invoices/${encodeURIComponent(invoiceId)}/document?kind=rendered`
        : null;
    dto.contentType = attachment.state === 'pdf' ? attachment.contentType : null;
    return dto;
  }
}
