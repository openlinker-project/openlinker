/**
 * Invoice Record — Domain Entity
 *
 * OL's projection of a fiscal document issued through a provider for an order
 * on an invoicing connection. Country-agnostic (ADR-026): carries a neutral
 * `documentType`, an issuance `status`, and the neutral regulatory-clearance
 * fields (`regulatoryStatus`/`clearanceReference`) the read-only
 * `RegulatoryStatusReader` reconciliation sub-capability populates by reading
 * authoritative provider/CTC status (KSeF/SDI/SII, #1121) — nullable until first
 * reconciled. A future `RegulatoryTransmitter` is the separate submit-side
 * sub-capability. The provider owns the authoritative document; this is a
 * non-authoritative projection (debug/retry).
 *
 * @module libs/core/src/invoicing/domain/entities
 */
import type {
  InvoiceFailureCode,
  InvoiceFailureMode,
  InvoiceStatus,
  IssuedDocumentContent,
  IssuedLineSnapshot,
  PaymentStatus,
  RegulatoryStatus,
  StoredDocument,
} from '../types/invoicing.types';

export class InvoiceRecord {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly orderId: string,
    /** Provider identifier (open string, e.g. `subiekt`). */
    public readonly providerType: string,
    /** Neutral document type; well-known values in `DocumentTypeValues` (open-world). */
    public readonly documentType: string,
    public readonly status: InvoiceStatus,
    public readonly providerInvoiceId: string | null,
    public readonly providerInvoiceNumber: string | null,
    public readonly regulatoryStatus: RegulatoryStatus,
    /** Authority-assigned reference (KSeF number, SDI id, …); `null` until transmitted. */
    public readonly clearanceReference: string | null,
    /** Echoed from the issue command; backs the exactly-once dedup gate. */
    public readonly idempotencyKey: string | null,
    public readonly pdfUrl: string | null,
    public readonly issuedAt: Date | null,
    public readonly errorMessage: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    /**
     * Neutral failure discriminator (#1200) — `null` unless `status === 'failed'`.
     * `rejected` = provider definitely created no document (safe to re-attempt);
     * `in-doubt` = the request may have issued a document (UNSAFE to re-attempt,
     * surfaced for manual reconciliation). See {@link InvoiceFailureMode}.
     */
    public readonly failureMode: InvoiceFailureMode | null = null,
    /**
     * Neutral machine-readable failure code (W1) — `null` unless `status ===
     * 'failed'`. Lets the FE drive a cause-specific affordance off the closed
     * {@link InvoiceFailureCode} taxonomy without parsing the PII-tainted,
     * never-exposed `errorMessage`.
     */
    public readonly failureCode: InvoiceFailureCode | null = null,
    /**
     * Short, PII-free human-readable failure summary (W1) — `null` unless
     * `status === 'failed'`. Safe to expose to API callers, unlike the
     * INTERNAL-ONLY `errorMessage`.
     */
    public readonly failureReason: string | null = null,
    /**
     * Lease expiry for the `issuing` CAS claim (#1200) — `null` unless this
     * record currently holds the in-flight slot. A claim is only contended while
     * `status === 'issuing'` AND the lease is in the future.
     */
    public readonly leaseExpiresAt: Date | null = null,
    /**
     * Whether the buyer carried a tax identifier at issue time. A neutral,
     * denormalized presence flag (NOT the tax-id value, NOT "nip") that backs the
     * `taxId=with|without` list filter (#1202) without joining to the Order. Set
     * once on the write path; defaults `false` for legacy rows with no backfill.
     */
    public readonly hasBuyerTaxId: boolean = false,
    /**
     * Neutral issued-document content snapshot (§7.3), captured at issue time;
     * `null` until a document is issued (or when the issuing adapter surfaces no
     * content). Backs the FE "Invoice contents" card via `GET /invoices/:id/content`.
     */
    public readonly documentContent: IssuedDocumentContent | null = null,
    /**
     * Neutral persisted source document (the machine-readable document submitted
     * to the authority — PL/KSeF: the FA(3) XML), captured at issue time; `null`
     * until issued (or when the adapter surfaces no source document). Re-served by
     * `GET /invoices/:id/document?kind=source`.
     */
    public readonly sourceDocument: StoredDocument | null = null,
    /**
     * Neutral issuance-time line snapshot (#1297) — the exact `{ buyer, currency,
     * lines }` a correction reconstructs the original document from, captured at
     * issue time so a KOR (or any complete-resubmit correction) diffs against the
     * lines AS ISSUED rather than the order's current state. `null` for rows
     * issued before this column existed (they fall back to order-derived
     * reconstruction) or when no snapshot was captured.
     */
    public readonly issuedLineSnapshot: IssuedLineSnapshot | null = null,
    /**
     * Neutral payment lifecycle (#1354) — refreshed from an authoritative
     * `PaymentStatusReader` read when a provider signals a payment change (e.g.
     * inFakt's `invoice_marked_as_paid` webhook). `unknown` until first read, so
     * it never asserts "unpaid" for a document OL has simply not polled.
     */
    public readonly paymentStatus: PaymentStatus = 'unknown',
    /**
     * Opaque operator-facing clearance diagnostic (#1582) - the authority's
     * rejection description/details captured by the `RegulatoryStatusReader`
     * read, so the detail page can explain WHY a document was rejected. Neutral
     * (ADR-026): a free-text blob, never interpreted in core. `null` until a
     * read surfaces one (typically only on `rejected`).
     */
    public readonly clearanceDetail: string | null = null,
  ) {}

  /** Pure derivation: the document was successfully issued by the provider. */
  get isIssued(): boolean {
    return this.status === 'issued';
  }

  /** Pure derivation (#1354): the provider reports the document fully settled. */
  get isPaid(): boolean {
    return this.paymentStatus === 'paid';
  }

  /**
   * Pure derivation (#1200): a `failed` row is safe to re-attempt ONLY when the
   * provider DEFINITELY created no document — a terminal `rejected` failure. An
   * `in-doubt` failure (or an absent mode) is NEVER re-attemptable: the document
   * may already exist, so it is surfaced for manual reconciliation.
   */
  get isReattemptableFailure(): boolean {
    return this.status === 'failed' && this.failureMode === 'rejected';
  }

  /**
   * Pure derivation (#1200): is this record's `issuing` claim still live at
   * `now`? A live claim means another attempt holds the in-flight slot and a
   * concurrent retry must NOT re-cross the provider boundary.
   */
  isLeaseLive(now: Date): boolean {
    return (
      this.status === 'issuing' &&
      this.leaseExpiresAt !== null &&
      this.leaseExpiresAt.getTime() > now.getTime()
    );
  }
}
