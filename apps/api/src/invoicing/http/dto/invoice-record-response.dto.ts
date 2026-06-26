/**
 * Invoice Record Response DTO (#1119)
 *
 * Outbound projection of an `InvoiceRecord`. Fields are enumerated explicitly
 * (never spread from the entity) so the response surface is intentional. Two
 * entity fields are DELIBERATELY EXCLUDED:
 *   - `idempotencyKey` — caller dedup secret, not part of the read contract.
 *   - `errorMessage`   — INTERNAL-ONLY, PII-tainted diagnostic (may echo
 *                        provider buyer data). Never returned to API callers;
 *                        operators read it via the authenticated GET path only.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type {
  InvoiceFailureCode,
  InvoiceFailureMode,
} from '@openlinker/core/invoicing';
import {
  InvoiceFailureCodeValues,
  InvoiceFailureModeValues,
  InvoiceStatus,
  InvoiceStatusValues,
  RegulatoryStatus,
} from '@openlinker/core/invoicing';

export class InvoiceRecordResponseDto {
  @ApiProperty({ description: 'Internal invoice record id' })
  id!: string;

  @ApiProperty({ description: 'Invoicing connection id' })
  connectionId!: string;

  @ApiProperty({ description: 'Internal order id this document was issued for' })
  orderId!: string;

  @ApiProperty({ description: 'Provider identifier (open string, e.g. subiekt)' })
  providerType!: string;

  @ApiProperty({ description: 'Neutral document type (open-world)' })
  documentType!: string;

  // Reference the live const (not a hardcoded array) so the published enum can
  // never drift from InvoiceStatus — `issuing` (#1200) is a serializable value.
  @ApiProperty({ description: 'Issuance lifecycle status', enum: InvoiceStatusValues })
  status!: InvoiceStatus;

  @ApiProperty({ description: 'Provider-assigned document id', nullable: true })
  providerInvoiceId!: string | null;

  @ApiProperty({ description: 'Provider-assigned document number', nullable: true })
  providerInvoiceNumber!: string | null;

  @ApiProperty({ description: 'Neutral CTC clearance status' })
  regulatoryStatus!: RegulatoryStatus;

  @ApiProperty({ description: 'Authority-assigned clearance reference', nullable: true })
  clearanceReference!: string | null;

  @ApiProperty({ description: 'URL of the rendered document PDF', nullable: true })
  pdfUrl!: string | null;

  // W1 failure semantics — let the FE tell a re-attemptable `rejected` failure
  // (safe to retry) from an unsafe `in-doubt` one, and surface a cause-specific,
  // PII-free reason. `errorMessage` stays OMITTED (internal-only, PII-tainted).
  @ApiProperty({
    description: 'Neutral failure discriminator; null unless status is failed',
    enum: InvoiceFailureModeValues,
    nullable: true,
  })
  failureMode!: InvoiceFailureMode | null;

  @ApiProperty({
    description: 'Neutral machine-readable failure code; null unless status is failed',
    enum: InvoiceFailureCodeValues,
    nullable: true,
  })
  failureCode!: InvoiceFailureCode | null;

  @ApiProperty({
    description: 'Short, PII-free failure summary; null unless status is failed',
    nullable: true,
  })
  failureReason!: string | null;

  @ApiProperty({ description: 'When the document was issued (ISO 8601)', nullable: true })
  issuedAt!: string | null;

  @ApiProperty({ description: 'Record creation time (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Record last-update time (ISO 8601)' })
  updatedAt!: string;
}
