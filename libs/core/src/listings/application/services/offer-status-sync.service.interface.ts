/**
 * Offer Status Sync Service Interface
 *
 * Contract for the steady-state marketplace offer-status refresh (#816):
 * read the live publication status of mapped offers for a connection and
 * persist it into `offer_status_snapshots`. Enumeration is paged via a numeric
 * scan offset; the caller (worker handler) persists `nextOffset` for the next
 * run.
 *
 * @module libs/core/src/listings/application/services
 */
import type { OfferStatusSyncResult } from '../../domain/types/offer-status-snapshot.types';
import type { OfferPublicationStatus } from '../../domain/types/offer-status-read.types';
import type { OfferValidationProblem } from '../../domain/types/offer-validation-problem.types';

export interface OfferStatusSyncOptions {
  /** Page size: number of mapped offers to refresh this run. */
  limit: number;
  /** Scan offset into the connection's offer mappings. Defaults to 0. */
  offset?: number;
}

/** Target of a single-offer snapshot refresh ({@link IOfferStatusSyncService.refreshOne}). */
export interface OfferStatusRefreshTarget {
  externalOfferId: string;
  internalVariantId: string;
}

/**
 * A publication status the caller has **already** observed (#2039) — from a
 * create response or from a poll iteration's live read — handed to
 * {@link IOfferStatusSyncService.recordObservedStatus} for persistence.
 *
 * Deliberately not `OfferStatusReadResult`: that shape belongs to the
 * `OfferStatusReader` capability and carries platform validation *errors*,
 * while a snapshot persists their messages. Keeping this separate lets a
 * create-path caller (which has no `OfferStatusReader` read) supply an
 * observation without pretending to be one.
 */
export interface OfferStatusObservation {
  publicationStatus: OfferPublicationStatus;
  /** Marketplace messages observed alongside the status. Omitted ⇒ none. */
  validationMessages?: string[];
  /**
   * The same refusals in structured form (#2231) - platform code, optional
   * one-line summary, and whether each is about this offer or the seller's whole
   * account. Optional, because a create-path caller has only messages; when it
   * is present it is what gets persisted, so a caller supplying both must not
   * let them disagree (`refreshOne` derives both from one list).
   */
  validationProblems?: OfferValidationProblem[];
  /** When the status was observed. Defaults to "now" at the write. */
  observedAt?: Date;
}

export type { OfferStatusSyncResult };

export interface IOfferStatusSyncService {
  /**
   * Refresh and persist the publication status of one page of the
   * connection's mapped offers. Returns counters plus `nextOffset` (wraps to
   * 0 at the end of the catalog). Connections whose adapter does not support
   * `OfferStatusReader` are skipped with a zeroed result.
   */
  sync(connectionId: string, options: OfferStatusSyncOptions): Promise<OfferStatusSyncResult>;

  /**
   * Re-read and upsert the snapshot for a single offer (#1760). Returns the
   * observed publication status, or `null` when the adapter does not support
   * `OfferStatusReader` or the marketplace reports the offer as not found.
   * Backs both the post-terminal reconcile job and the manual refresh action.
   */
  refreshOne(
    connectionId: string,
    target: OfferStatusRefreshTarget
  ): Promise<OfferPublicationStatus | null>;

  /**
   * Persist a status the caller already observed (#2039), without re-reading
   * the marketplace. Backs the create path (the create response reported the
   * status) and the creation poller's `active` terminal (the poll just read
   * it) — both previously left `offer_status_snapshots` empty, so a freshly
   * published offer had no row until the hourly rolling scan reached it.
   *
   * Throws only on a persistence failure. Callers on the create/poll paths
   * treat that as non-fatal: the offer already exists on the marketplace and
   * the hourly sync is the backstop.
   *
   * Resolves `true` when the observation was persisted, `false` when the
   * repository's freshness guard discarded it because a newer snapshot is
   * already stored. Only a caller that writes a *second*, sibling row off the
   * same observation needs this — `refreshOne` uses it to keep the commercial
   * snapshot (#2024) from being advanced by an observation the status half
   * just rejected. Create/poll-path callers ignore it.
   */
  recordObservedStatus(
    connectionId: string,
    target: OfferStatusRefreshTarget,
    observation: OfferStatusObservation
  ): Promise<boolean>;
}
