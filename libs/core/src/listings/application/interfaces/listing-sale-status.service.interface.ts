/**
 * Listing Sale Status Service Interface (#3962)
 *
 * Reads where a product is still on sale after a master deletion, puts held
 * listings back on sale at the operator's request, and answers the hold
 * questions other contexts ask (the propagation guard, the products banner).
 *
 * @module libs/core/src/listings/application/interfaces
 */
import type { ListingSaleHold } from '../../domain/entities/listing-sale-hold.entity';
import type { ListingRef } from '../../domain/types/listing-sale-hold.types';
import type { ProductSaleStatus, ReleaseSaleHoldsResult } from '../../domain/types/listing-sale-status.types';

export interface IListingSaleStatusService {
  getProductSaleStatus(productId: string): Promise<ProductSaleStatus>;

  /**
   * Put the given held listings back on sale. Refused as a whole
   * (`SaleHoldReleaseRefusedException`) while a listed variant is still
   * deleted at the master. Never automatic: this is the only way a hold ends.
   */
  releaseHolds(productId: string, holdIds: readonly string[], actor: string): Promise<ReleaseSaleHoldsResult>;

  /** Active holds among the given listings - the propagation guard's question. */
  findActiveHolds(refs: readonly ListingRef[]): Promise<ListingSaleHold[]>;

  /** Products deleted at the master that at least one channel could not stop selling. */
  countProductsStillOnSale(): Promise<number>;
}
