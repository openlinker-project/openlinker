/**
 * Sales Document In-Flight Signal
 *
 * "A sales document for this order is being produced right now" - stated as a
 * READ, so a surface can render it without attempting the write that would
 * otherwise be the only way to learn it (ADR-042 amendment #2502, decision 2).
 *
 * Before this, the fact existed only as the 409 a concurrent attempt received.
 * That is the correct answer to a write and useless to a reader: a panel could
 * not tell *someone else is producing this document right now* - reassuring, and
 * requiring no action - from an error.
 *
 * It lives in `sales-documents` because both document kinds need one shape. A
 * fiscal receipt is not an invoice, so neither `invoicing` nor `fiscalization`
 * could own the vocabulary for the other, and a consumer covering both kinds -
 * the per-order sales-document projection - must not have to branch on which
 * context answered.
 *
 * VISIBILITY ONLY. Nothing here changes the lease, the exactly-once guarantee,
 * or the 409 a concurrent write still receives.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import type { SalesDocumentKind } from './sales-document-kind.types';

export interface SalesDocumentInFlight {
  /** Which document is being produced. Never inferred by the reader. */
  documentKind: SalesDocumentKind;
  /** The connection whose provider is being called. */
  connectionId: string;
  /**
   * The record holding the claim. Carried so a surface can point at the same row
   * it is already rendering rather than matching on the order alone.
   */
  recordId: string;
  /**
   * The claim-holding record's last write. It supports an elapsed reading
   * ("running for at least 38s"), which is a fact about the past.
   *
   * A LOWER BOUND on how long the attempt has been running, NOT its start.
   * Nothing persists a claim-start timestamp, and a write to the record inside
   * a live lease moves this value forward: on the invoicing path the numbering
   * allocation runs after the CAS claim and updates the record row, so
   * `updatedAt` advances mid-attempt. `elapsed >= now - since` is true on every
   * path; "the attempt started at `since`" is not, so a surface must not say it.
   *
   * The lease EXPIRY is deliberately NOT carried either, for the opposite
   * reason - it is about the future. It bounds how long the claim blocks a
   * same-key retry and says nothing about how long the provider will take, so a
   * surface handed it would render a countdown that reads as a completion
   * estimate. OpenLinker hands the sale over and waits for one answer; it
   * observes no steps in between and can promise no deadline, so the type must
   * not be able to express one.
   */
  since: Date;
}
