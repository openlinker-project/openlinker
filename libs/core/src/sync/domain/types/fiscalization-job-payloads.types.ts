/**
 * Fiscalization Job Payload Types (#2156, ADR-041 decision 7)
 *
 * Canonical payload schema for `fiscalization.register` sync jobs — the
 * `fiscal-receipt` sibling of `invoicing-job-payloads.types.ts`'s
 * `InvoicingIssuePayloadV1`. `AutoIssueTriggerService` composes an
 * ALREADY-BUILT `RegisterTransactionCommand` (via the fiscalization context's
 * `toRegisterTransactionCommand` mapper) into this flat, fully-serializable
 * shape, so `FiscalizationRegisterHandler` is a pure delegate that only
 * reconstructs and calls `IFiscalRegistrationService.register`.
 *
 * SERIALIZATION CONTRACT: `RegisterTransactionCommand.occurredAt` is a `Date`;
 * this payload carries it as an ISO-8601 string (`occurredAt`) because a jsonb
 * round-trip cannot preserve a `Date` instance — the handler restores it via
 * `new Date(...)`. Every other field is already plain (numbers/strings), so no
 * further flattening is needed.
 *
 * `schemaVersion: 1` pins the contract; future breaking changes bump it and
 * handlers must accept every version seen in persisted jobs until drained.
 *
 * @module libs/core/src/sync/domain/types
 */
import type { FiscalRecipient, FiscalTransactionLine } from '@openlinker/core/fiscalization';

/**
 * Payload for `fiscalization.register` jobs (#2156). Connection id is
 * duplicated in `connectionId` (the fiscalization connection) AND available on
 * `job.connectionId`, mirroring `InvoicingIssuePayloadV1`.
 */
export interface FiscalizationRegisterPayloadV1 {
  schemaVersion: 1;
  /** The fiscalization connection the sale is registered on. */
  connectionId: string;
  /** OL internal order id. */
  orderId: string;
  /**
   * Deterministic exactly-once key — the SAME string used as the SyncJob row
   * `idempotencyKey` AND `RegisterTransactionCommand.idempotencyKey`.
   */
  idempotencyKey: string;
  /** ISO-4217 currency of every amount below. */
  currency: string;
  /** Plain transaction lines (numbers, no class). */
  lines: FiscalTransactionLine[];
  /** Buyer-paid gross total of the sale. */
  totalGross: number;
  /**
   * ISO-8601 instant the sale occurred at the source, or absent when the
   * order carries no `placedAt`. See the module doc for why this is a string,
   * not a `Date`.
   */
  occurredAt?: string;
  /** Where a customer-facing artefact could be delivered, when known. */
  recipient?: FiscalRecipient | null;
  /** The order's source connection (provenance / debugging). */
  sourceConnectionId: string;
  /** Only trace token at the seam (D10); optional — NO `correlationId` exists. */
  sourceEventId?: string;
}
