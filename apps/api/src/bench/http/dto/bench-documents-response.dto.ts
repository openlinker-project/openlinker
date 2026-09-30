/**
 * Bench documents response DTOs (#2418, `W3b-5`, spec § 2.6)
 *
 * What goes INSIDE the box, and what goes ON it — the organising distinction of
 * this surface, because it is the thing a packer has to get right.
 *
 * The invoice and the label are separate objects with separate states on
 * purpose: a missing document does not stop a box shipping (D17), and a missing
 * label stops it absolutely (F4). Folding them into one status would make the
 * one state this surface exists for indistinguishable from a warning.
 *
 * @module apps/api/src/bench/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class BenchInvoiceResponseDto {
  @ApiProperty({
    enum: ['ready', 'issued-not-printable', 'missing'],
    description:
      'ready: issued, and the provider can produce something printable. issued-not-printable: the document exists but only as machine-readable source, so there is nothing to fold into the box. missing: never issued — see blockReason.',
  })
  state!: string;

  @ApiProperty({ nullable: true, description: 'Null when nothing was issued' })
  invoiceId!: string | null;

  @ApiProperty({ nullable: true })
  documentNumber!: string | null;

  @ApiProperty({ nullable: true })
  issuedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "Why no document was issued, in the sales-document vocabulary the rest of the product already uses (#2100). Null when nothing recorded a reason — itself an answer, rather than something to invent one for. Packing is NEVER refused because of this.",
  })
  blockReason!: string | null;

  @ApiProperty({ nullable: true, description: 'The routing half of the same answer' })
  unresolvedReason!: string | null;
}

export class BenchLabelResponseDto {
  @ApiProperty({
    enum: ['ready', 'unavailable', 'none'],
    description:
      'ready: a label exists and can be printed. unavailable: the box is packed and cannot go out. none: no shipment for this parcel yet.',
  })
  state!: string;

  @ApiProperty({ nullable: true })
  shipmentId!: string | null;

  @ApiProperty({ nullable: true })
  carrier!: string | null;

  @ApiProperty({ nullable: true })
  trackingNumber!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The carrier's own short code. Never redacted — it is a discriminator, not prose.",
  })
  providerCode!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The carrier's own words. Null for a caller without shipments:write, because the raw rejection text may embed address fragments — the same redaction ShipmentResponseDto applies.",
  })
  carrierMessage!: string | null;

  @ApiProperty({
    description:
      'Whether a reason exists that this caller may not see. Lets the surface say "hidden from your role" instead of "the carrier gave no reason", which for a packer would otherwise be false whenever a reason exists.',
  })
  carrierMessageRedacted!: boolean;

  @ApiProperty({ nullable: true })
  failedAt!: string | null;
}

export class BenchFiscalArtefactSummaryResponseDto {
  @ApiProperty({
    enum: ['document', 'markup', 'code', 'link', 'text'],
    description: 'The form the artefact takes. The bench hands over a document or a link only.',
  })
  medium!: string;

  @ApiProperty({
    enum: ['print', 'display', 'send', 'retain'],
    description:
      "The adapter's HINT. Never evidence that anything was printed, shown or sent to the buyer.",
  })
  disposition!: string;

  @ApiProperty({ nullable: true })
  label!: string | null;

  @ApiProperty({ nullable: true })
  contentType!: string | null;
}

/**
 * One nullable shape for both kinds, so a client reads an explicit `null` for a
 * field that does not belong to the kind rather than an absent key (#939).
 */
export class BenchSalesDocumentResponseDto {
  @ApiProperty({ enum: ['invoice', 'fiscal-receipt'] })
  kind!: string;

  @ApiProperty() recordId!: string;

  @ApiProperty() connectionId!: string;

  @ApiProperty({
    nullable: true,
    description:
      "Receipts only: the registering connection's platformType, for a per-integration presentation. Null for an invoice, or when the connection could not be resolved.",
  })
  platformType!: string | null;

  @ApiProperty({
    description:
      "The status on this kind's own axis. Invoice: pending | issuing | issued | failed. Receipt: pending | registering | registered | failed.",
  })
  status!: string;

  @ApiProperty({
    nullable: true,
    enum: ['rejected', 'in-doubt'],
    description:
      'Null unless failed. A failed record with no mode means the same as in-doubt: OpenLinker does not know whether a document exists.',
  })
  failureMode!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'The number the document bears: the invoice number, or the receipt number.',
  })
  documentNumber!: string | null;

  @ApiProperty({ nullable: true })
  completedAt!: string | null;

  @ApiProperty({
    description:
      'Invoices only: issued AND the provider can render something to print. Always false for a receipt - read `artefacts`.',
  })
  printable!: boolean;

  @ApiProperty({
    type: [BenchFiscalArtefactSummaryResponseDto],
    nullable: true,
    description:
      'Receipts only: what the registration produced, without its content. Null for an invoice or a receipt that has produced nothing yet; an empty list is a receipt registered with nothing attached.',
  })
  artefacts!: BenchFiscalArtefactSummaryResponseDto[] | null;
}

export class BenchReceiptLinkResponseDto {
  @ApiProperty({ description: "The provider's own link to the registered receipt" })
  url!: string;
}

export class BenchDocumentsResponseDto {
  @ApiProperty() workId!: string;

  @ApiProperty({
    type: BenchInvoiceResponseDto,
    deprecated: true,
    description:
      'Deprecated since #3646: invoice-only, and reports every non-issued state as missing. Read `document`.',
  })
  invoice!: BenchInvoiceResponseDto;

  @ApiProperty({
    type: BenchSalesDocumentResponseDto,
    nullable: true,
    description: "The order's sales document of either kind, in any status. Null when there is none.",
  })
  document!: BenchSalesDocumentResponseDto | null;

  @ApiProperty({
    nullable: true,
    description:
      'The kind routing resolved for an order with no document. Null when there is a document, or routing has not decided.',
  })
  documentKind!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Why there is no document (#2100 vocabulary). Null whenever a document exists - a reason left over from before it would contradict it. Packing is NEVER refused because of this.',
  })
  blockReason!: string | null;

  @ApiProperty({ nullable: true, description: 'The routing half of the same answer' })
  unresolvedReason!: string | null;

  @ApiProperty({ type: BenchLabelResponseDto, description: 'Goes ON the box' })
  label!: BenchLabelResponseDto;
}

export class BenchUnlabelledParcelResponseDto {
  @ApiProperty() workId!: string;
  @ApiProperty() orderReference!: string;
  @ApiProperty() parcelIndex!: number;
  @ApiProperty() parcelTotal!: number;

  @ApiProperty({ nullable: true })
  closedAt!: string | null;

  @ApiProperty({ nullable: true })
  carrier!: string | null;

  @ApiProperty({
    nullable: true,
    description: "The carrier's own short code. The prose is never on this list, which two audiences read.",
  })
  providerCode!: string | null;
}

export class BenchUnlabelledParcelListResponseDto {
  @ApiProperty({ type: [BenchUnlabelledParcelResponseDto] })
  parcels!: BenchUnlabelledParcelResponseDto[];

  @ApiProperty({ description: 'How many unlabelled parcels this read found' })
  total!: number;

  @ApiProperty({ description: 'Whether the read hit its cap and there may be more' })
  truncated!: boolean;
}
