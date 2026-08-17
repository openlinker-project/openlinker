/**
 * Order Invoice Projection DTO
 *
 * Neutral (#1224, ADR-026) invoice sub-tree merged into the order-detail snapshot.
 * The FE invoice panel reads this off `orderSnapshot.invoice` on the detail read
 * only. No regime/provider vocabulary crosses here — `regulatoryStatus` is the
 * neutral CTC clearance lifecycle, `confirmationDocumentAvailable` is true
 * once the confirmation document can be downloaded.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  DocumentTypeValues,
  InvoiceStatus,
  InvoiceStatusValues,
  RegulatoryStatus,
  RegulatoryStatusValues,
} from '@openlinker/core/invoicing';

export class OrderInvoiceProjectionDto {
  @ApiProperty({
    description:
      'Internal invoice record id the UPO download endpoint (GET /invoices/:invoiceId/upo) keys on.',
  })
  invoiceId!: string;

  @ApiProperty({
    enum: DocumentTypeValues,
    description:
      'Neutral document type (open-world). Correction documents (`corrected` / `credit-note`) are distinguished from a plain `invoice` so the FE can label them.',
  })
  documentType!: string;

  @ApiProperty({
    enum: InvoiceStatusValues,
    description:
      'Issue lifecycle status of the invoice document (pending → issuing → issued | failed).',
  })
  status!: InvoiceStatus;

  @ApiProperty({
    enum: RegulatoryStatusValues,
    description:
      'Neutral Continuous-Transaction-Controls clearance lifecycle status of the invoice.',
  })
  regulatoryStatus!: RegulatoryStatus;

  @ApiProperty({
    nullable: true,
    description:
      'Neutral provider clearance reference (e.g. the KSeF number on the PL regime); null until cleared.',
  })
  clearanceReference!: string | null;

  @ApiProperty({
    description:
      'True once the authority confirmation document is downloadable (invoice issued and cleared); gates the FE download action.',
  })
  confirmationDocumentAvailable!: boolean;

  /**
   * The domain's own `InvoiceRecord.blocksIssuanceElsewhere`, projected verbatim
   * rather than re-derived client-side (#2100).
   *
   * The FE needs exactly this question — "does a fiscal document plausibly exist
   * for this order?" — to decide whether a persisted sales-document block is
   * still worth explaining, and it is the same question `AutoIssueTriggerService`
   * asks before persisting one. Shipping the derived boolean instead of the raw
   * `failureMode` keeps the two answers from drifting: a `failed` record is NOT
   * automatically "no document", because an `in-doubt` failure means the provider
   * may well have created one.
   */
  @ApiProperty({
    description:
      'True when this record represents a document that plausibly exists at the provider (pending/issuing/issued, or a non-rejected failure). False only for a terminal rejected failure. Mirrors InvoiceRecord.blocksIssuanceElsewhere.',
  })
  blocksIssuanceElsewhere!: boolean;
}
