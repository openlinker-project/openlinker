/**
 * Listing Sale Hold Types (#3962)
 *
 * Vocabulary for the record OpenLinker keeps when it takes a listing off sale
 * because the product (or one variant) was deleted at the master. One active
 * hold per listing; releasing it is always an operator action.
 *
 * @module libs/core/src/listings/domain/types
 */

/** The mapping kind the hold is about: a marketplace offer or a shop product. */
export const ListingSaleHoldEntityTypeValues = ['Offer', 'ShopProduct'] as const;
export type ListingSaleHoldEntityType = (typeof ListingSaleHoldEntityTypeValues)[number];

/**
 * How OpenLinker took the listing off sale.
 * - `stock_zero`: an absolute quantity 0 was written.
 * - `unpublished`: the shop product was hidden (draft / inactive).
 * - `none`: nothing could be written; the hold records why.
 */
export const ListingSaleHoldMethodValues = ['stock_zero', 'unpublished', 'none'] as const;
export type ListingSaleHoldMethod = (typeof ListingSaleHoldMethodValues)[number];

/**
 * - `applied`: the write was made (or, for a queued stock write, enqueued).
 * - `not_possible`: the connection cannot make any write that stops the sale.
 * - `failed`: a write was attempted and failed; the hourly sweep retries it.
 */
export const ListingSaleHoldOutcomeValues = ['applied', 'not_possible', 'failed'] as const;
export type ListingSaleHoldOutcome = (typeof ListingSaleHoldOutcomeValues)[number];

/**
 * Why a hold is not `applied`.
 * - `stock_sync_off`: the connection could write stock, but stock updates are switched off.
 * - `no_stock_write`: the connection has no way to write stock (one variant deleted).
 * - `error`: the write failed.
 */
export const ListingSaleHoldReasonValues = ['stock_sync_off', 'no_stock_write', 'error'] as const;
export type ListingSaleHoldReason = (typeof ListingSaleHoldReasonValues)[number];

export interface ListingSaleHoldProps {
  id: string;
  connectionId: string;
  entityType: ListingSaleHoldEntityType;
  externalId: string;
  /** Parent product external id for a variation of a grouped shop product. */
  externalParentId: string | null;
  internalProductId: string;
  /** Null when the hold covers a whole grouped shop product (its parent). */
  internalVariantId: string | null;
  method: ListingSaleHoldMethod;
  outcome: ListingSaleHoldOutcome;
  outcomeReason: ListingSaleHoldReason | null;
  /** The stale transition that caused the hold. */
  staleAt: Date;
  appliedAt: Date;
  releasedAt: Date | null;
  releasedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for recording (or re-recording) the active hold of one listing. */
export interface RecordListingSaleHoldInput {
  connectionId: string;
  entityType: ListingSaleHoldEntityType;
  externalId: string;
  externalParentId: string | null;
  internalProductId: string;
  internalVariantId: string | null;
  method: ListingSaleHoldMethod;
  outcome: ListingSaleHoldOutcome;
  outcomeReason: ListingSaleHoldReason | null;
  staleAt: Date;
  appliedAt: Date;
}

/** One listing a caller wants to check for an active hold. */
export interface ListingRef {
  connectionId: string;
  entityType: ListingSaleHoldEntityType;
  externalId: string;
}
