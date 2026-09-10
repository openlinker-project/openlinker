/**
 * Price Change Auto-Applied Log Types (#3144)
 *
 * @module libs/core/src/listings/domain/types
 */

export interface RecordAutoAppliedPriceChangeInput {
  productVariantId: string;
  destinationConnectionId: string;
  sourceConnectionId: string;
  oldAmount: number;
  newAmount: number;
  currency: string;
  appliedAt: Date;
}
