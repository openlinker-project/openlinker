/**
 * Invoicing Job Payload Types (Generic)
 *
 * Canonical payload schema for `invoicing.issue` sync jobs (OL #1120). The job
 * carries an ALREADY-COMPOSED, fully-serializable issuance command so the worker
 * handler is a pure delegate.
 *
 * SERIALIZATION CONTRACT (#12): the `buyer` field is the PLAIN field-set of
 * `BuyerProfile` (no class, no `isCompany` getter) — a `BuyerProfile` class
 * instance cannot survive the jsonb round-trip. The handler reconstructs
 * `new BuyerProfile(...)` from this shape.
 *
 * PII NOTE (D11): this payload deliberately carries the real buyer name/address
 * (a fiscal document legally requires them). Therefore NO log/error path — in the
 * policy service OR the worker handler — may serialize `payload` / `buyer` /
 * `lines`.
 *
 * `schemaVersion: 1` pins the contract; future breaking changes bump it and
 * handlers must accept every version seen in persisted jobs until drained.
 *
 * @module libs/core/src/sync/domain/types
 */
import type {
  BuyerAddress,
  BuyerType,
  InvoiceLine,
  TaxIdentifier,
} from '@openlinker/core/invoicing';
import type { InvoiceTriggerModel } from '@openlinker/core/invoicing';

/** PLAIN, serializable counterpart of `BuyerProfile` (no class, no getter). */
export interface InvoicingIssueBuyerV1 {
  name: string;
  /** Scheme-tagged tax id, or `null` for B2C. */
  taxId: TaxIdentifier | null;
  address: BuyerAddress;
  type: BuyerType;
}

/**
 * Payload for `invoicing.issue` jobs (OL #1120). Connection id is duplicated in
 * `connectionId` (the issuance connection) AND available on `job.connectionId`.
 */
export interface InvoicingIssuePayloadV1 {
  schemaVersion: 1;
  /** The invoicing connection the document is issued on. */
  connectionId: string;
  /** OL internal order id. */
  orderId: string;
  /**
   * Deterministic exactly-once key — the SAME string used as the SyncJob row
   * `idempotencyKey` AND the `IssueInvoiceCommand.idempotencyKey` (F4).
   */
  idempotencyKey: string;
  /** Neutral document type; pass-through, adapter derives when absent. */
  documentType?: string;
  /** ISO-4217 currency. */
  currency: string;
  /** Plain invoice lines (numbers, no class). */
  lines: InvoiceLine[];
  /** PLAIN buyer field-set (reconstructed into `BuyerProfile` by the handler). */
  buyer: InvoicingIssueBuyerV1;
  /** The order's source connection (provenance / debugging). */
  sourceConnectionId: string;
  /** Only trace token at the seam (D10); optional — NO `correlationId` exists. */
  sourceEventId?: string;
  /** The trigger model that produced this job. */
  trigger: InvoiceTriggerModel;
}
