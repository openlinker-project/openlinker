/**
 * Mirakl Offer Write Types
 *
 * A stock or price change OpenLinker owes a Mirakl offer. Mirakl takes both
 * only as file imports (STO01 for stock, PRI01 for prices), applied
 * asynchronously, and asks sellers not to import more than every few minutes.
 * So a change is recorded first and sent later, one file per connection per
 * tick, and its import is followed until Mirakl reports the outcome.
 *
 * @module libs/integrations/mirakl/src/domain/types
 */

/**
 * `stock` goes through STO01, `price` through PRI01. `offer` is an OF24 create
 * (#4278): recorded already submitted, so the status read can follow it.
 */
export const MiraklOfferWriteKindValues = ['stock', 'price', 'offer'] as const;
export type MiraklOfferWriteKind = (typeof MiraklOfferWriteKindValues)[number];

/** The kinds recorded first and sent as one file per pass. */
export const MiraklBufferedWriteKindValues = ['stock', 'price'] as const;
export type MiraklBufferedWriteKind = (typeof MiraklBufferedWriteKindValues)[number];

/**
 * - `pending`: recorded, not sent yet. At most one per offer and kind; a newer
 *   value replaces it.
 * - `submitted`: sent in the import named by `importId`, outcome not known yet.
 * - `applied`: the import finished and this line had no error.
 * - `failed`: the import failed, or reported an error for this line.
 */
export const MiraklOfferWriteStatusValues = ['pending', 'submitted', 'applied', 'failed'] as const;
export type MiraklOfferWriteStatus = (typeof MiraklOfferWriteStatusValues)[number];

/** A value to record: a quantity, or a price with its currency. */
export interface MiraklOfferWriteValue {
  readonly offerSku: string;
  /** A whole quantity, or a decimal price string such as `"44.99"`. */
  readonly value: string;
  readonly currency?: string | null;
}
