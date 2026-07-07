/**
 * Send Invoice Email Request DTO (#1353)
 *
 * Body for `POST /invoices/:invoiceId/send-email`. Every field is optional — a
 * bare `{}` triggers a send to the buyer's provider-stored email in the
 * provider's default language. `locale` is the neutral document-language
 * choice (pl/en); `sendCopy` CCs the seller. There is deliberately no
 * recipient-override field — the invoice carries buyer PII, so the send
 * always targets the buyer's stored email, never an operator-supplied
 * address.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { InvoiceEmailLocaleValues, type InvoiceEmailLocale } from '@openlinker/core/invoicing';

export class SendInvoiceEmailRequestDto {
  @ApiPropertyOptional({
    enum: InvoiceEmailLocaleValues,
    description: 'Neutral document language for the emailed invoice (defaults per provider).',
  })
  @IsOptional()
  @IsIn(InvoiceEmailLocaleValues)
  locale?: InvoiceEmailLocale;

  @ApiPropertyOptional({ description: 'Also send a copy to the seller.' })
  @IsOptional()
  @IsBoolean()
  sendCopy?: boolean;
}
