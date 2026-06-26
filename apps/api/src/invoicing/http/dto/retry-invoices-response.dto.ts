/**
 * Retry Invoices Response DTO (#1245)
 *
 * Result of `POST /invoices/retry` (§7.2): aggregate `retried` / `skipped`
 * counts plus a per-id outcome summary. A `skipped` result carries a neutral,
 * PII-free `reason` (the record was not in a retry-eligible state, or did not
 * exist); a `retried` result carries no reason. Neutral — no provider
 * vocabulary, never the raw provider rejection text.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Per-id outcome of a batch retry. */
export const RetryOutcomeValues = ['retried', 'skipped'] as const;
export type RetryOutcome = (typeof RetryOutcomeValues)[number];

export class RetryInvoiceResultDto {
  @ApiProperty({ description: 'Invoice record id this outcome refers to.' })
  id!: string;

  @ApiProperty({
    description: 'Whether the record was re-attempted or skipped server-side.',
    enum: RetryOutcomeValues,
  })
  outcome!: RetryOutcome;

  @ApiPropertyOptional({
    description:
      'Neutral, PII-free reason a record was skipped (e.g. not in a retry-eligible ' +
      'state, or not found). Absent for retried records.',
  })
  reason?: string;
}

export class RetryInvoicesResponseDto {
  @ApiProperty({ description: 'Number of records re-attempted.' })
  retried!: number;

  @ApiProperty({ description: 'Number of records skipped server-side.' })
  skipped!: number;

  @ApiProperty({ description: 'Per-id outcome summary.', type: [RetryInvoiceResultDto] })
  results!: RetryInvoiceResultDto[];
}
