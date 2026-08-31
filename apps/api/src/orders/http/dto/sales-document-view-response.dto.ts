/**
 * Sales-Document View Response DTOs (#2517, ADR-065)
 *
 * The wire shape of `SalesDocumentView` - the ONE per-order sales-document
 * read the `/orders` row, the order-detail panel and the settings page's
 * per-market evidence share. The same DTO is served by
 * `GET /orders/:internalOrderId/sales-document` AND carried on every row of
 * the orders list, so the list needs no second request and the two surfaces
 * cannot render the same order differently.
 *
 * Two rules from ADR-065 are structural in this shape, not documentation:
 *
 * 1. **A fiscal receipt has no authority axis.** `document` is a discriminated
 *    union on `kind`, and the receipt member carries no regulatory field at
 *    all - so no surface can render a clearance answer that does not exist.
 *    An optional-field shape was rejected: it would make the missing axis
 *    merely unset rather than unrepresentable.
 * 2. **The reasons are the PERSISTED ones, verbatim.** `blockReason`,
 *    `unresolvedReason` and `blockDetail` are copied off `order_records`
 *    untouched. A surface renders the stored value or renders nothing - it
 *    never re-derives one from the order's country, which is the defect the
 *    ADR was written against.
 *
 * @module apps/api/src/orders/http/dto
 * @see docs/architecture/adrs/065-sales-document-read-surface.md
 */
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import {
  FiscalRegistrationFailureModeValues,
  FiscalRegistrationStatus,
  FiscalRegistrationStatusValues,
} from '@openlinker/core/fiscalization';
import type { FiscalRegistrationFailureMode } from '@openlinker/core/fiscalization';
import {
  DocumentTypeValues,
  InvoiceFailureCodeValues,
  InvoiceFailureModeValues,
  InvoiceStatus,
  InvoiceStatusValues,
  RegulatoryStatus,
  RegulatoryStatusValues,
} from '@openlinker/core/invoicing';
import type { InvoiceFailureCode, InvoiceFailureMode } from '@openlinker/core/invoicing';
import {
  CoreSalesDocumentKindValues,
  SalesDocumentGateBlockReasonValues,
  SalesDocumentUnresolvedReasonValues,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentGateBlockReason,
  SalesDocumentIdentity,
  SalesDocumentOtherRecord,
  SalesDocumentRecordView,
  SalesDocumentUnresolvedReason,
  SalesDocumentView,
} from '@openlinker/core/sales-documents';

export class SalesDocumentIdentityDto {
  @ApiProperty({ description: "The underlying record's own id, for the per-document routes." })
  recordId!: string;

  @ApiProperty({ description: 'The connection that issued or registered it.' })
  connectionId!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Provider identity as the record reports it. `null` when the record exists but no provider ' +
      'has been resolved onto it yet - never a default.',
  })
  providerType!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'The number the document itself bears, whoever allocated it. `null` means no number has been ' +
      'assigned yet, NOT that the document has none: nothing here distinguishes a regime with no ' +
      'numbering from a document not yet issued, and no surface may claim otherwise.',
  })
  documentNumber!: string | null;

  @ApiProperty({ description: 'ISO-8601 instant OpenLinker first recorded the attempt.' })
  createdAt!: string;

  @ApiProperty({
    nullable: true,
    description:
      "ISO-8601 instant the act completed at the provider - an invoice's issuedAt, a registration's " +
      'registeredAt. `null` while the document is still pending, in flight, or failed.',
  })
  completedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'ISO-8601 expiry of the in-flight claim an attempt holds. `null` means no claim is held, which ' +
      'is NOT the same as "not in flight": a lease in the PAST is a crashed attempt, so a surface ' +
      'showing "another attempt is running" must compare this against now rather than test it for presence.',
  })
  inFlightUntil!: string | null;
}

export class SalesDocumentInvoiceViewDto {
  @ApiProperty({ enum: ['invoice'], description: 'Discriminant. An invoice carries BOTH axes below.' })
  kind!: 'invoice';

  @ApiProperty({
    enum: DocumentTypeValues,
    description: 'Neutral document type the provider issued. Open-world (ADR-026).',
  })
  documentType!: string;

  @ApiProperty({
    enum: InvoiceStatusValues,
    description: 'Issuance axis: did the provider create a document. Terminal at issued or failed.',
  })
  status!: InvoiceStatus;

  @ApiProperty({
    enum: InvoiceFailureModeValues,
    nullable: true,
    description:
      'Whether a failed issuance is known to have created nothing (`rejected`) or may have created a ' +
      'document OpenLinker cannot see (`in-doubt`). `null` unless status is failed; an absent mode on ' +
      'a failed row is treated exactly as `in-doubt` by the write-path guards, so a surface must never ' +
      'read `null` here as "safe to retry".',
  })
  failureMode!: InvoiceFailureMode | null;

  @ApiProperty({
    enum: InvoiceFailureCodeValues,
    nullable: true,
    description: 'Machine-readable failure cause; `null` unless status is failed.',
  })
  failureCode!: InvoiceFailureCode | null;

  @ApiProperty({
    nullable: true,
    description: 'Short PII-free failure summary; `null` unless status is failed.',
  })
  failureReason!: string | null;

  @ApiProperty({
    enum: RegulatoryStatusValues,
    description:
      'Clearance axis: what the authority said. `not-applicable` is an ANSWER (this regime clears ' +
      'nothing), never a stand-in for "not asked yet" - that is `pending-submission`. It moves ' +
      'independently of `status`, so `issued` + `rejected` is a real state and the one a resend acts on.',
  })
  regulatoryStatus!: RegulatoryStatus;

  @ApiProperty({
    nullable: true,
    description:
      'The authority-assigned reference once one exists. `null` until the authority answers, and on ' +
      'every regime that assigns none.',
  })
  clearanceReference!: string | null;

  @ApiProperty({ type: SalesDocumentIdentityDto })
  identity!: SalesDocumentIdentityDto;
}

export class SalesDocumentReceiptViewDto {
  @ApiProperty({
    enum: ['fiscal-receipt'],
    description:
      'Discriminant. A receipt carries ONE axis: the registering mechanism IS the authority, so there ' +
      'is no later answer to wait for and this member has no regulatory field (ADR-042).',
  })
  kind!: 'fiscal-receipt';

  @ApiProperty({
    enum: FiscalRegistrationStatusValues,
    description: 'Registration axis. Terminal at registered or failed.',
  })
  status!: FiscalRegistrationStatus;

  @ApiProperty({
    enum: FiscalRegistrationFailureModeValues,
    nullable: true,
    description:
      'Same semantics as the invoice sibling: `null` unless status is failed, and an absent mode on a ' +
      'failed row is as unsafe to re-attempt as `in-doubt`.',
  })
  failureMode!: FiscalRegistrationFailureMode | null;

  @ApiProperty({
    nullable: true,
    description: 'Short PII-free failure summary; `null` unless status is failed.',
  })
  failureReason!: string | null;

  @ApiProperty({
    description:
      'How many customer-facing artefacts the registration produced. `0` on a registered row is a ' +
      'SUCCESS, not a failure - a pure reporting regime returns identifiers and no artefact at all.',
  })
  artefactCount!: number;

  @ApiProperty({ type: SalesDocumentIdentityDto })
  identity!: SalesDocumentIdentityDto;
}

export class SalesDocumentOtherRecordDto {
  @ApiProperty({
    description:
      'The duplicate record\'s own id, so a surface can LINK to the record it is warning about rather ' +
      'than leaving an operator with a fact and no remedy.',
  })
  recordId!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty({ enum: CoreSalesDocumentKindValues, description: 'Open-world document kind.' })
  kind!: string;

  @ApiProperty({
    description:
      'True when this record is why another connection may not issue. It MIRRORS the write-path guard ' +
      'rather than restating it - a surface must never recompute this from `status`.',
  })
  blocksFurtherIssuance!: boolean;
}

@ApiExtraModels(SalesDocumentInvoiceViewDto, SalesDocumentReceiptViewDto)
export class SalesDocumentViewResponseDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty({
    enum: CoreSalesDocumentKindValues,
    nullable: true,
    description:
      "The kind this order's document is on: the existing record's kind when there is one, otherwise " +
      'the kind routing resolves for the order. OPEN-WORLD, unlike `document.kind`, which is closed on ' +
      'the two kinds this projection knows how to describe. `null` means routing has NOT decided - the ' +
      'surface says so and points at the settings; it never falls back to asking which document to ' +
      "issue, and it never guesses a kind from the order's country.",
  })
  documentKind!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The document itself, or `null` when none exists yet. `null` with a non-null documentKind is the ' +
      'ordinary "routing decided, nothing issued yet" state; `null` with a null kind is the ' +
      'unconfigured one. Discriminated on `kind`.',
    oneOf: [
      { $ref: getSchemaPath(SalesDocumentInvoiceViewDto) },
      { $ref: getSchemaPath(SalesDocumentReceiptViewDto) },
    ],
  })
  document!: SalesDocumentInvoiceViewDto | SalesDocumentReceiptViewDto | null;

  @ApiProperty({
    enum: SalesDocumentGateBlockReasonValues,
    nullable: true,
    description:
      'The PERSISTED gate reason, verbatim from `order_records`. `null` means the gate reported no block ' +
      'on its last run, not that it never ran. Never re-derived by a surface.',
  })
  blockReason!: SalesDocumentGateBlockReason | null;

  @ApiProperty({
    enum: SalesDocumentUnresolvedReasonValues,
    nullable: true,
    description:
      'The PERSISTED routing reason, verbatim. Non-null only alongside blockReason = unresolved-routing, ' +
      'which is the bridge value carrying it.',
  })
  unresolvedReason!: SalesDocumentUnresolvedReason | null;

  @ApiProperty({
    nullable: true,
    description:
      'Free-text detail the gate stored with the reason; `null` when it stored none. Never parsed by a ' +
      'surface - it is displayed or dropped.',
  })
  blockDetail!: string | null;

  @ApiProperty({
    type: [SalesDocumentOtherRecordDto],
    description:
      'Records for this order on OTHER connections. Empty for the overwhelming majority of orders; a ' +
      'non-empty list is surfaced, never hidden behind the single-record panel.',
  })
  otherRecords!: SalesDocumentOtherRecordDto[];
}

/**
 * Project a core {@link SalesDocumentView} onto the wire shape above.
 *
 * Written out field by field rather than spread, following the same rule the
 * MCP tool projections follow: a field added to the core type later must be a
 * deliberate edit here before it reaches an HTTP client, and a field the DTO
 * declares can never silently go unpopulated. The mapping is otherwise
 * one-to-one - the core type is already wire-shaped (ISO-8601 strings, no
 * `Date`), so nothing is converted or re-derived on the way out.
 */
export function toSalesDocumentViewDto(view: SalesDocumentView): SalesDocumentViewResponseDto {
  return {
    orderId: view.orderId,
    documentKind: view.documentKind,
    document: view.document === null ? null : toRecordDto(view.document),
    blockReason: view.blockReason,
    unresolvedReason: view.unresolvedReason,
    blockDetail: view.blockDetail,
    otherRecords: view.otherRecords.map(toOtherRecordDto),
  };
}

function toRecordDto(
  record: SalesDocumentRecordView
): SalesDocumentInvoiceViewDto | SalesDocumentReceiptViewDto {
  // Switching on the discriminant rather than testing for a field keeps the
  // receipt branch structurally unable to carry a regulatory answer: adding a
  // third kind to the core union fails this switch at compile time instead of
  // falling through into one of the two shapes.
  switch (record.kind) {
    case 'invoice':
      return {
        kind: 'invoice',
        documentType: record.documentType,
        status: record.status,
        failureMode: record.failureMode,
        failureCode: record.failureCode,
        failureReason: record.failureReason,
        regulatoryStatus: record.regulatoryStatus,
        clearanceReference: record.clearanceReference,
        identity: toIdentityDto(record.identity),
      };
    case 'fiscal-receipt':
      return {
        kind: 'fiscal-receipt',
        status: record.status,
        failureMode: record.failureMode,
        failureReason: record.failureReason,
        artefactCount: record.artefactCount,
        identity: toIdentityDto(record.identity),
      };
  }
}

function toIdentityDto(identity: SalesDocumentIdentity): SalesDocumentIdentityDto {
  return {
    recordId: identity.recordId,
    connectionId: identity.connectionId,
    providerType: identity.providerType,
    documentNumber: identity.documentNumber,
    createdAt: identity.createdAt,
    completedAt: identity.completedAt,
    inFlightUntil: identity.inFlightUntil,
  };
}

function toOtherRecordDto(record: SalesDocumentOtherRecord): SalesDocumentOtherRecordDto {
  return {
    recordId: record.recordId,
    connectionId: record.connectionId,
    kind: record.kind,
    blocksFurtherIssuance: record.blocksFurtherIssuance,
  };
}
