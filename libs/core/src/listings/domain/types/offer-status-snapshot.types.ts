/**
 * Offer Status Snapshot Types
 *
 * Type definitions for the persisted, periodically-refreshed marketplace
 * publication status of a mapped offer (#816). Reuses the neutral
 * `OfferPublicationStatus` observation union from `offer-status-read.types.ts`;
 * this module adds the persistence-side shapes (the snapshot props + the
 * upsert command + the status-sync result) that the steady-state sync writes.
 *
 * @module libs/core/src/listings/domain/types
 */
import type { OfferPublicationStatus } from './offer-status-read.types';

/**
 * Persisted snapshot of a mapped offer's live marketplace publication status.
 * Keyed by `(connectionId, externalOfferId)`; `internalVariantId` is carried
 * for reverse navigation to the OL variant.
 */
export interface OfferStatusSnapshotProps {
  id: string;
  connectionId: string;
  /** Marketplace-native offer id (e.g. Allegro `7781562863`). */
  externalOfferId: string;
  /** Internal OL variant id this offer is mapped to. */
  internalVariantId: string;
  /** Last observed marketplace publication status. */
  publicationStatus: OfferPublicationStatus;
  /**
   * Optional opaque platform-specific detail captured alongside the status
   * (today: marketplace validation messages). `null` when none observed.
   */
  statusDetails: OfferStatusSnapshotDetails | null;
  /** When the status was last read from the marketplace. */
  lastStatusSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Platform-neutral detail blob persisted with a snapshot. Kept intentionally
 * loose (a string list) so adapters can attach human-readable context without
 * the snapshot contract growing platform-specific fields.
 */
export interface OfferStatusSnapshotDetails {
  /** Validation messages reported by the marketplace, if any. */
  validationMessages?: string[];
}

/**
 * Upsert command for a single offer's status observation. The repository
 * inserts a new row or updates the existing `(connectionId, externalOfferId)`
 * row, always refreshing `lastStatusSyncedAt`.
 */
export interface UpsertOfferStatusSnapshotCommand {
  connectionId: string;
  externalOfferId: string;
  internalVariantId: string;
  publicationStatus: OfferPublicationStatus;
  statusDetails: OfferStatusSnapshotDetails | null;
  lastStatusSyncedAt: Date;
}

/**
 * Result of one `marketplace.offer.statusSync` run for a connection.
 */
export interface OfferStatusSyncResult {
  /** Mapped offers examined this run (≤ page limit). */
  scanned: number;
  /** Snapshots inserted or updated. */
  updated: number;
  /** Offers whose status changed versus the prior snapshot. */
  transitioned: number;
  /** Offers the marketplace reported as not found (404). */
  notFound: number;
  /** Total mapped offers for the connection (for offset wrap-around). */
  total: number;
  /** Scan offset to persist for the next run (wraps to 0 at catalog end). */
  nextOffset: number;
}
