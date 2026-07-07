/**
 * Bulk Issue Invoices Response DTO (#1355)
 *
 * Result of `POST /invoices/bulk-issue`: aggregate `issued` / `skipped` /
 * `failed` counts plus a per-order-id outcome summary. Partial success is
 * reported per id (never all-or-nothing) — mirrors `RetryInvoicesResponseDto`.
 *
 *   - `issued`  — a document was issued (or an already-issued row was returned
 *                 verbatim by the idempotent service, carrying `invoiceId`).
 *   - `skipped` — the order already has an issued invoice, or one is in
 *                 progress, on this connection; nothing was re-issued.
 *   - `failed`  — the order was missing / not invoiceable, or the provider
 *                 rejected the request; carries a neutral, PII-free `reason`.
 *
 * Neutral — no provider vocabulary, never the raw provider rejection text.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Per-order-id outcome of a bulk issue. */
export const BulkIssueOutcomeValues = ['issued', 'skipped', 'failed'] as const;
export type BulkIssueOutcome = (typeof BulkIssueOutcomeValues)[number];

export class BulkIssueInvoiceResultDto {
  @ApiProperty({ description: 'Internal order id this outcome refers to.' })
  orderId!: string;

  @ApiProperty({
    description: 'Whether the invoice was issued, skipped (already done / in progress), or failed.',
    enum: BulkIssueOutcomeValues,
  })
  outcome!: BulkIssueOutcome;

  @ApiPropertyOptional({ description: 'Issued invoice record id (present only on `issued`).' })
  invoiceId?: string;

  @ApiPropertyOptional({
    description:
      'Neutral, PII-free reason a record was skipped or failed (e.g. already issued, ' +
      'in progress, order not found, or a correlation id for a provider rejection). ' +
      'Absent for a plain `issued` outcome.',
  })
  reason?: string;
}

export class BulkIssueInvoicesResponseDto {
  @ApiProperty({ description: 'Number of invoices issued.' })
  issued!: number;

  @ApiProperty({ description: 'Number of orders skipped (already issued or in progress).' })
  skipped!: number;

  @ApiProperty({ description: 'Number of orders that failed to issue.' })
  failed!: number;

  @ApiProperty({ description: 'Per-order-id outcome summary.', type: [BulkIssueInvoiceResultDto] })
  results!: BulkIssueInvoiceResultDto[];
}
