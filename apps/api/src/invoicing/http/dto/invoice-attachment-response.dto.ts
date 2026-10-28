/**
 * Invoice Attachment Response DTO (#3548)
 *
 * What a caller can attach for an issued document. Carries no bytes and is built
 * without downloading any: for a PDF it names the existing download route
 * instead, so one response never embeds a customer-facing document and a status
 * check never spends a provider call. `url` and `downloadPath` are mutually
 * exclusive and both `null` for `waiting` and `none`.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  InvoiceAttachmentStateValues,
  type InvoiceAttachmentState,
  type InvoiceAttachmentSummary,
} from '@openlinker/core/invoicing';

export class InvoiceAttachmentResponseDto {
  @ApiProperty({
    enum: InvoiceAttachmentStateValues,
    description:
      '`pdf` - real bytes at `downloadPath`; `link` - a public `url`; `waiting` - nothing to ' +
      'attach right now (not cleared yet, or the provider did not answer), try again later; ' +
      '`none` - cleared and there is still nothing to attach.',
  })
  state!: InvoiceAttachmentState;

  @ApiProperty({ type: String, nullable: true, description: 'Public url, for `link` only' })
  url!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Route that streams the PDF, for `pdf` only. Relative to the versioned API base ' +
      '(the same base this response was served from, e.g. `/v1`), not a full url.',
  })
  downloadPath!: string | null;

  static fromDomain(
    invoiceId: string,
    attachment: InvoiceAttachmentSummary
  ): InvoiceAttachmentResponseDto {
    const dto = new InvoiceAttachmentResponseDto();
    dto.state = attachment.state;
    dto.url = attachment.state === 'link' ? attachment.url : null;
    dto.downloadPath =
      attachment.state === 'pdf'
        ? `/invoices/${encodeURIComponent(invoiceId)}/document?kind=rendered`
        : null;
    return dto;
  }
}
