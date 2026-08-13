/**
 * Invoice Record Response DTO (#1119, #1224)
 *
 * Outbound projection of an `InvoiceRecord`. Fields are enumerated explicitly
 * (never spread from the entity) so the response surface is intentional. Two
 * entity fields are DELIBERATELY EXCLUDED:
 *   - `idempotencyKey` — caller dedup secret, not part of the read contract.
 *   - `errorMessage`   — INTERNAL-ONLY, PII-tainted diagnostic (may echo
 *                        provider buyer data). Never returned to API callers;
 *                        operators read it via the authenticated GET path only.
 *
 * Neutral (#1224, ADR-026) full-record view returned by `GET /invoices/:invoiceId`,
 * backing the FE invoice detail page. Mirrors the `InvoiceRecord` projection minus
 * infrastructure-only fields: `errorMessage`/`idempotencyKey` stay OMITTED, and
 * the rich issued-document content lives behind `GET /invoices/:invoiceId/content`.
 * No regime/provider vocabulary crosses here — `regulatoryStatus` is the neutral
 * CTC clearance lifecycle, `clearanceReference` an opaque authority reference.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  InvoiceFailureCode,
  InvoiceFailureMode,

  InvoiceRecord} from '@openlinker/core/invoicing';
import {
  InvoiceFailureCodeValues,
  InvoiceFailureModeValues,
  InvoiceStatus,
  InvoiceStatusValues,
  RegulatoryStatus,
  RegulatoryStatusValues,
} from '@openlinker/core/invoicing';
import type { OrderSummary } from '@openlinker/core/orders';
import { OrderSummaryProjectionDto } from '../../../orders/http/dto/order-summary-projection.dto';

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

  @ApiProperty({
    enum: RegulatoryStatusValues,
    description: 'Neutral CTC clearance lifecycle status',
  })
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

  @ApiProperty({
    nullable: true,
    type: OrderSummaryProjectionDto,
    description:
      "Order-identity projection (#1995) for the unified Order cell — null when no order record resolves for `orderId`, or its snapshot has no parseable items. Only populated on the list endpoint (`GET /invoices`); single-invoice reads pass null (not fetched there).",
  })
  orderSummary!: OrderSummaryProjectionDto | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'OTHER invoicing connections that also hold a record for this order (#2047). Populated ' +
      'only by `GET /orders/:orderId/invoice` called WITHOUT `connectionId`, and only when the ' +
      'list is non-empty — so its presence means one sale carries documents on more than one ' +
      'provider. The one-invoice-per-order guard makes that unreachable for newly issued ' +
      'documents, but rows that predate it still exist, and a read that returns only the latest ' +
      'record would otherwise hide exactly the duplicates worth looking at.',
  })
  otherInvoicingConnectionIds?: string[];

  /**
   * @param orderSummary Batched order-identity projection (#1995), or `null`
   *   when not resolved for this call site. Required (not defaulted) so a
   *   future read path can't silently omit it.
   */
  static fromDomain(
    record: InvoiceRecord,
    orderSummary: OrderSummary | null,
  ): InvoiceRecordResponseDto {
    const dto = new InvoiceRecordResponseDto();
    dto.id = record.id;
    dto.connectionId = record.connectionId;
    dto.orderId = record.orderId;
    dto.providerType = record.providerType;
    dto.documentType = record.documentType;
    dto.status = record.status;
    dto.providerInvoiceId = record.providerInvoiceId;
    dto.providerInvoiceNumber = record.providerInvoiceNumber;
    dto.regulatoryStatus = record.regulatoryStatus;
    dto.clearanceReference = record.clearanceReference;
    dto.pdfUrl = record.pdfUrl;
    dto.failureMode = record.failureMode;
    dto.failureCode = record.failureCode;
    dto.failureReason = record.failureReason;
    dto.issuedAt = record.issuedAt ? record.issuedAt.toISOString() : null;
    dto.createdAt = record.createdAt.toISOString();
    dto.updatedAt = record.updatedAt.toISOString();
    dto.orderSummary = orderSummary ? OrderSummaryProjectionDto.fromSummary(orderSummary) : null;
    return dto;
  }
}
