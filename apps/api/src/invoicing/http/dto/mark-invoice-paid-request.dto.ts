/**
 * Mark Invoice Paid Request DTO (#1362)
 *
 * Body for `POST /invoices/:invoiceId/mark-paid`. `paidDate` is optional - a
 * bare `{}` marks the invoice as paid today (UTC). The provider-native
 * `externalInvoiceId` is never accepted here; the controller always derives
 * it server-side from the resolved `InvoiceRecord.providerInvoiceId`.
 *
 * `paidDate` is a calendar date (`YYYY-MM-DD`), not a datetime: payment
 * settlement is a day, and a full ISO datetime near local midnight would let
 * the adapter-side `.toISOString().slice(0, 10)` roll the date back a day. The
 * date-only shape is enforced with `@Matches` (format) alongside `@IsISO8601`
 * (rejects impossible calendar dates like `2026-13-45`).
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';

export class MarkInvoicePaidRequestDto {
  @ApiPropertyOptional({
    description: 'Calendar date the payment was settled (YYYY-MM-DD). Defaults to today (UTC) when omitted.',
    example: '2026-07-08',
    format: 'date',
  })
  @IsOptional()
  @IsISO8601()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'paidDate must be a calendar date (YYYY-MM-DD)' })
  paidDate?: string;
}
