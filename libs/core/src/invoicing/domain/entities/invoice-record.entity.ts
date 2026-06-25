/**
 * Invoice Record — Domain Entity
 *
 * OL's projection of a fiscal document issued through a provider for an order
 * on an invoicing connection. Country-agnostic (ADR-026): carries a neutral
 * `documentType`, an issuance `status`, and the neutral regulatory-clearance
 * fields (`regulatoryStatus`/`clearanceReference`) a future `RegulatoryTransmitter`
 * adapter populates (KSeF/SDI/SII) — nullable until then. The provider owns the
 * authoritative document; this is a non-authoritative projection (debug/retry).
 *
 * @module libs/core/src/invoicing/domain/entities
 */
import type {
  InvoiceFailureCode,
  InvoiceFailureMode,
  InvoiceStatus,
  RegulatoryStatus,
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
  ) {}

  /** Pure derivation: the document was successfully issued by the provider. */
  get isIssued(): boolean {
    return this.status === 'issued';
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
