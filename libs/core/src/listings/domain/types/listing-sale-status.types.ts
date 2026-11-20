/**
 * Listing Sale Status Types (#3962)
 *
 * The product page's answer to "is this product still on sale anywhere?":
 * one row per listing (marketplace offer or shop product) with the channel's
 * own last-read status, the quantity it reported, and what OpenLinker did
 * when the product was deleted at the master.
 *
 * `deriveListingSaleState` is the one rule for turning those facts into
 * on sale / off sale, so the API and every caller agree.
 *
 * @module libs/core/src/listings/domain/types
 */
import type {
  ListingSaleHoldEntityType,
  ListingSaleHoldMethod,
  ListingSaleHoldOutcome,
  ListingSaleHoldReason,
} from './listing-sale-hold.types';

/**
 * - `on_sale`: buyers can still order it.
 * - `off_sale`: it cannot be bought (hidden, ended, or 0 in stock).
 * - `unknown`: OpenLinker has no reading for it and holds nothing about it.
 */
export const ListingSaleStateValues = ['on_sale', 'off_sale', 'unknown'] as const;
export type ListingSaleState = (typeof ListingSaleStateValues)[number];

/** Channel statuses (offer or shop vocabulary) that mean "cannot be bought". */
const OFF_SALE_CHANNEL_STATUSES: ReadonlySet<string> = new Set([
  'inactive',
  'inactivating',
  'ended',
  'draft',
  'unpublished',
  'removed',
]);

export interface ListingSaleStateInput {
  channelStatus: string | null;
  quantity: number | null;
  hold: { outcome: ListingSaleHoldOutcome; active: boolean } | null;
}

export function deriveListingSaleState(input: ListingSaleStateInput): ListingSaleState {
  if (input.hold?.active && input.hold.outcome === 'applied') return 'off_sale';
  if (input.channelStatus !== null && OFF_SALE_CHANNEL_STATUSES.has(input.channelStatus)) {
    return 'off_sale';
  }
  if (input.quantity === 0) return 'off_sale';
  if (input.hold?.active) return 'on_sale';
  if (input.channelStatus !== null || (input.quantity !== null && input.quantity > 0)) {
    return 'on_sale';
  }
  return 'unknown';
}

export interface ListingSaleRowHold {
  id: string;
  method: ListingSaleHoldMethod;
  outcome: ListingSaleHoldOutcome;
  outcomeReason: ListingSaleHoldReason | null;
  appliedAt: Date;
}

export interface ListingSaleRow {
  connectionId: string;
  entityType: ListingSaleHoldEntityType;
  externalId: string;
  /** Present for a grouped shop product's parent row. */
  externalParentId: string | null;
  /** The variant this listing sells; null for a grouped product's parent. */
  internalVariantId: string | null;
  /** The channel's own last-read status word (offer or shop vocabulary). */
  channelStatus: string | null;
  quantity: number | null;
  lastCheckedAt: Date | null;
  hold: ListingSaleRowHold | null;
  state: ListingSaleState;
}

export interface ProductSaleStatus {
  productId: string;
  /** Latest `staleAt` among the product's variants; null when none is deleted. */
  deletedAt: Date | null;
  /** True while at least one variant is deleted at the master. */
  deletedAtSource: boolean;
  staleVariantIds: string[];
  rows: ListingSaleRow[];
  /** Newest channel reading across the rows. */
  checkedAt: Date | null;
}

export interface ReleaseSaleHoldsResult {
  released: string[];
  failed: { holdId: string; message: string }[];
}
