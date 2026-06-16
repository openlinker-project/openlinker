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
import type { InvoiceStatus, RegulatoryStatus } from '../types/invoicing.types';

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
  ) {}

  /** Pure derivation: the document was successfully issued by the provider. */
  get isIssued(): boolean {
    return this.status === 'issued';
  }
}
