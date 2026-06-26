/**
 * Offer Stock Restorer Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters whose marketplace
 * auto-decrements stock on purchase but does NOT restore it on cancellation
 * (e.g. Erli, ADR-025 §4a) declare `implements OfferStockRestorer` and issue the
 * compensating absolute-set write. Core resolves the per-offer target quantity
 * from master inventory and passes `OfferStockRestoreTarget[]`; the adapter just
 * writes (it never reads master inventory).
 *
 * See `offer-field-updater.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferStockRestoreTarget } from '../../types/offer-stock-restore.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferStockRestorer {
  restoreStockOnCancellation(targets: readonly OfferStockRestoreTarget[]): Promise<void>;
}

export function isOfferStockRestorer(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferStockRestorer {
  return (
    typeof (adapter as Partial<OfferStockRestorer>).restoreStockOnCancellation === 'function'
  );
}
