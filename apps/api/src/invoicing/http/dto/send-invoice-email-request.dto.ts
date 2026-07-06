/**
 * Send Invoice Email Request DTO (#1353)
 *
 * Body for `POST /invoices/:invoiceId/send-email`. Every field is optional — a
 * bare `{}` triggers a send to the buyer's provider-stored email in the
 * provider's default language. `locale` is the neutral document-language choice
 * (pl/en); `recipient` overrides the stored email; `sendCopy` CCs the seller.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional } from 'class-validator';
import { InvoiceEmailLocaleValues, type InvoiceEmailLocale } from '@openlinker/core/invoicing';

export class SendInvoiceEmailRequestDto {
  @ApiPropertyOptional({
    enum: InvoiceEmailLocaleValues,
    description: 'Neutral document language for the emailed invoice (defaults per provider).',
  })
  @IsOptional()
  @IsIn(InvoiceEmailLocaleValues)
  locale?: InvoiceEmailLocale;

  @ApiPropertyOptional({
    description: "Override recipient address; omit to use the buyer's provider-stored email.",
  })
  @IsOptional()
  @IsEmail()
  recipient?: string;

  @ApiPropertyOptional({ description: 'Also send a copy to the seller.' })
  @IsOptional()
  @IsBoolean()
  sendCopy?: boolean;
}
