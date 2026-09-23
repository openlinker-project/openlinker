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
     * The numbering series the {@link documentNumber} was allocated from (#1575);
     * `null` for a provider that numbers documents itself.
     */
    public readonly numberingSeriesId: string | null = null,
    /**
     * The OpenLinker-allocated legal document number (#1575); `null` for a
     * non-`DocumentNumberConsumer` provider (its own number lives on
     * `providerInvoiceNumber`). Immutable once assigned.
     */
    public readonly documentNumber: string | null = null,
    /**
     * The sequence integer allocated from {@link numberingSeriesId} for this
     * document's {@link documentNumber} (#8, gap-audit); `null` for a provider
     * that numbers documents itself. Backs integer-based gap detection in the
     * numbering audit read model. Immutable once assigned.
     */
    public readonly allocatedSeq: number | null = null,
    /**
     * The buyer tax identity as it stood when this document was issued (#3188),
     * three-state encoded exactly as `order_records.buyerTaxId` is: `null` =
     * the source asserted nothing, `''` = it asserted the buyer has none,
     * otherwise the id the document carries.
     *
     * FROZEN, not joined. An invoice is an immutable fiscal document, while the
     * order's own column is rewritten by every re-ingestion — reading the order
     * live would let this list show a number the issued document does not
     * carry. `hasBuyerTaxId` above stays the filter's predicate; this is the
     * value that filter was hiding.
     *
     * Read it through `decodeBuyerTaxIdColumn`, never with a bare `!== null`,
     * which reports true for the asserted-none row. `null` on every row issued
     * before this column existed — there is nothing to backfill it from.
     */
    public readonly buyerTaxId: string | null = null,
    /**
     * How many of this document's lines the provider could not link to its own
     * catalogue and issued as free text — see
     * {@link IssueInvoiceResult.unlinkedCatalogueLines} for the tri-state and
     * for why `0` is not a provider guarantee.
     *
     * `null` on every row issued before this column existed, and on every row
     * from a provider that does not report linkage. Both read as "not
     * reported" — a surface must test `> 0` rather than nullability, which
     * {@link hasUnlinkedCatalogueLines} does as a convenience for a caller
     * that only needs the yes/no question; a caller naming the count (e.g.
     * "2 lines") reads this field directly instead.
     */
    public readonly unlinkedCatalogueLines: number | null = null,
  ) {}

  /**
   * Did this document go out with lines the provider could not link to its
   * catalogue? Pure read of the column, so a surface never has to decide what
   * `null` means for itself: only a positive count is a claim, and `null`
   * (not reported) and `0` (all linked) both answer false.
   */
  get hasUnlinkedCatalogueLines(): boolean {
    return this.unlinkedCatalogueLines !== null && this.unlinkedCatalogueLines > 0;
  }

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
   * Pure derivation (#2047): does this record forbid issuing a SECOND document
   * for the same order on a DIFFERENT connection? One sale is one invoice, so
   * the only record that leaves another provider unblocked is one where the
   * provider DEFINITELY created nothing — a terminal `rejected` failure.
   *
   * Blocks `pending` / `issuing` / `issued`, and `failed` with any
   * `failureMode` other than `rejected` (absent / unknown included). That last
   * arm is the fiscally dangerous one: an `in-doubt` failure means "we do not
   * know whether a document exists at the provider", so issuing elsewhere is
   * exactly how one sale ends up with two invoices. The `issuing` arm is
   * lease-INDEPENDENT on purpose: an expired lease means the attempt crashed
   * mid-flight, not that it created nothing (`claimForIssue` may re-claim it on
   * ITS OWN connection, which does not double-issue; another connection would).
   */
  get blocksIssuanceElsewhere(): boolean {
    if (this.status === 'failed') {
      return this.failureMode !== 'rejected';
    }
    return this.status === 'pending' || this.status === 'issuing' || this.status === 'issued';
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
