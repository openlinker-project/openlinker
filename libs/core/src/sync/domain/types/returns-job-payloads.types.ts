/**
 * Returns Job Payload Types (#2330, ADR-060)
 *
 * Canonical payload schemas for the three `marketplace.return*` sync jobs.
 *
 * **Why three and not two.** A source that reports returns does not report
 * CHANGES to them: Allegro's `CustomerReturn` carries `createdAt` and no
 * `updatedAt`, and `/order/events` has no return event type at all (SPIKE-2289
 * E7/E8). A cursor over the feed can therefore only ever discover that a return
 * EXISTS — it can never observe one moving `CREATED -> DELIVERED -> FINISHED`.
 * Discovery and lifecycle are consequently separate passes with separate
 * cadences and separate cursors, which is the same split
 * `master.product.syncAll` (enumeration) and `master.product.reconcile` (state
 * re-check) already draw for the catalog.
 *
 * @module libs/core/src/sync/domain/types
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 */

/**
 * Payload for `marketplace.returns.poll` (pass 1 — discovery, `fan-out` lane).
 *
 * The returns counterpart of `MarketplaceOrdersPollPayloadV1`, and deliberately
 * the same shape: one cursor key, one page size. The cursor value is OPAQUE —
 * core never interprets it, and a source that must bootstrap from a creation
 * timestamp does so behind that opacity rather than by having core learn which
 * sources page by id and which by date.
 */
export interface MarketplaceReturnsPollPayloadV1 {
  schemaVersion: 1;
  /** Connection-cursor key holding the opaque feed cursor. */
  cursorKey: string;
  /** Page size: number of feed items to request per run. */
  limit: number;
}

/**
 * Payload for `marketplace.return.sync` (the per-return child, `realtime` lane).
 *
 * Mirrors `MarketplaceOrderSyncPayloadV1` minus the event vocabulary: a return
 * feed reports existence, not events (see the module docblock), so there is no
 * `eventType` to carry and inventing one would fabricate semantics no shipped
 * source can honour.
 *
 * Connection id comes from `job.connectionId`, not the payload.
 */
export interface MarketplaceReturnSyncPayloadV1 {
  schemaVersion: 1;
  /** Source-native return id to hydrate. */
  externalReturnId: string;
  /**
   * The feed item's stable dedupe key, carried for traceability. For a source
   * whose feed IS the return listing this is tautologically the return id; the
   * field is kept so a source with a real event journal needs no contract
   * change.
   */
  eventKey?: string;
  /** When the source reports the feed item occurred (ISO 8601). */
  occurredAt?: string;
}

/**
 * Payload for `marketplace.returns.statusSync` (pass 2 — lifecycle, `bulk` lane).
 *
 * Enumerates OL's OWN non-terminal return rows and re-reads each one through
 * the source, because no change feed exists to subscribe to. Paced by a rolling
 * numeric **scan offset** on the connection cursor — the
 * `MarketplaceOfferStatusSyncPayloadV1` (#816) /
 * `MarketplaceShipmentStatusSyncPayloadV1` (#838) shape, for the same reason:
 * the work list is OL's own rows, so there is no marketplace cursor to hold.
 *
 * The sweep enqueues NOTHING. It re-reads inline, like its two siblings, so a
 * bounded page of re-reads cannot fan out into an unbounded child wave.
 */
export interface MarketplaceReturnsStatusSyncPayloadV1 {
  schemaVersion: 1;
  /** Page size: number of non-terminal returns to re-read per run. */
  limit: number;
  /**
   * Connection-cursor key under which the rolling numeric scan offset is
   * persisted. Omitted → the handler falls back to
   * `allegro.customerReturns.scanOffset`.
   */
  cursorKey?: string;
  /**
   * Age bound in days: only returns opened within this window are candidates.
   *
   * **Non-optional in effect** — the handler defaults it rather than allowing
   * an unbounded sweep. Without a bound, a return whose source status OL does
   * not recognise as terminal is re-read on every run forever, and the sweep's
   * cost grows monotonically with the connection's whole history rather than
   * with its open work.
   */
  lookbackDays?: number;
}
