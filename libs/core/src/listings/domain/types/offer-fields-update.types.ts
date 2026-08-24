/**
 * Offer Fields Update Types
 *
 * Command type for full offer field updates (price, title, description) via
 * `OfferManagerPort.updateOfferFields`. Distinct from quantity-only updates in
 * `offer-quantity-update.types.ts`.
 *
 * @module libs/core/src/listings/domain/types
 */

import type { OfferFieldUpdate } from './offer-update.types';

export interface UpdateOfferFieldsCommand {
  /** Marketplace-native (external) offer ID. */
  externalOfferId: string;
  /** Partial field update — at least one field must be set. */
  fields: OfferFieldUpdate;
  /** Optional idempotency key for deduplication. */
  idempotencyKey?: string;
}

/**
 * One field the destination refused to change because the seller froze it
 * (#2262; Erli's `frozen` object, #988 / ADR-025 §4b).
 *
 * `currentValue` is what the destination still holds, when its read carried
 * one. Absent means the destination could not name it - never that the value
 * is empty, which is why the field is optional rather than `string | null`.
 */
export interface FrozenOfferField {
  field: keyof OfferFieldUpdate;
  currentValue?: string;
}

/**
 * What a destination reports about the update it just applied (#2262).
 *
 * It exists because "the call returned" is not the same as "every field was
 * written": a destination that silently DROPS a field the seller froze is
 * otherwise indistinguishable from one that applied it, and the tax-rate
 * journal (#2250, ADR-063 § 4) would then record a write that never happened.
 *
 * Deliberately reported rather than thrown: a frozen field is information, not
 * a failure - the seller set it deliberately, and the rest of the update did
 * land.
 *
 * The return type is a UNION with `void` so this is purely additive: an
 * adapter compiled against the pre-#2262 `Promise<void>` signature still
 * satisfies the capability, and a caller reads "returned nothing" as *the
 * destination declared nothing*, never as *nothing was frozen*.
 */
export interface UpdateOfferFieldsReport {
  frozenFields?: readonly FrozenOfferField[];
}
