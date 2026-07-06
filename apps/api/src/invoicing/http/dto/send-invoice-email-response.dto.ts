/**
 * Send Invoice Email Response DTO (#1353)
 *
 * Small result of `POST /invoices/:invoiceId/send-email`. `delivered` is true
 * when the provider accepted the delivery trigger; `recipient` echoes the
 * address the send was addressed to when known (else null).
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class SendInvoiceEmailResponseDto {
  @ApiProperty({ description: 'True when the provider accepted the delivery request.' })
  delivered!: boolean;

  @ApiProperty({ nullable: true, description: 'The recipient the send was addressed to, if known.' })
  recipient!: string | null;
}
