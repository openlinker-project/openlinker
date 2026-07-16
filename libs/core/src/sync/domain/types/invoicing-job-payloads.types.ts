/**
 * Invoicing Job Payload Types (Generic)
 *
 * Canonical payload schemas for `invoicing.*` sync jobs (OL #1120, #1121). The
 * `invoicing.issue` job carries an ALREADY-COMPOSED, fully-serializable issuance
 * command so the worker handler is a pure delegate.
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
  /**
   * Sale date (ISO `YYYY-MM-DD`, #1525) from the order's placement timestamp;
   * absent when the order carries none. Optional additive field - no
   * `schemaVersion` bump (a v1 consumer that ignores it stays correct).
   */
  saleDate?: string;
  /** ISO-4217 currency. */
  currency: string;
  /** Plain invoice lines (numbers, no class). */
  lines: InvoiceLine[];
  /** PLAIN buyer field-set (reconstructed into `BuyerProfile` by the handler). */
  buyer: InvoicingIssueBuyerV1;
  /** The order's source connection (provenance / debugging). */
  sourceConnectionId: string;
  /**
   * Neutral order-origin platformType (#1694) — the source connection's
   * `platformType`, threaded onto the command's `source` axis for numbering
   * routing. Optional additive field (no `schemaVersion` bump); absent = routing
   * falls back past the source axis.
   */
  source?: string;
  /** Only trace token at the seam (D10); optional — NO `correlationId` exists. */
  sourceEventId?: string;
  /** The trigger model that produced this job. */
  trigger: InvoiceTriggerModel;
}

/**
 * Payload for `invoicing.regulatoryStatus.reconcile` (#1121). Carries only the
 * page size — there is NO cursor: the reconciliation frontier is a shrinking set
 * walked from offset 0 every run (plan decision #5).
 */
export interface RegulatoryStatusReconcilePayloadV1 {
  schemaVersion: 1;
  /** Page size: max number of non-terminal records to reconcile this run. */
  limit: number;
}

/**
 * Payload for `invoicing.paymentStatus.refreshByExternalId` (#1354). Carries the
 * provider's invoice id named by the payment webhook; the handler re-reads
 * authoritative payment state for THAT document (webhook is a trigger, not the
 * source of truth) and updates OL's projection. No cursor — it is a single-id
 * refresh, not a sweep.
 */
export interface PaymentStatusRefreshByExternalIdPayloadV1 {
  schemaVersion: 1;
  /** Provider-native invoice id (matches `InvoiceRecord.providerInvoiceId`). */
  externalInvoiceId: string;
}
