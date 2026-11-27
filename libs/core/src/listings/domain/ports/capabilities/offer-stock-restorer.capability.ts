/**
 * Offer Stock Restorer Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters whose marketplace
 * auto-decrements stock on purchase but does NOT restore it on cancellation
 * (Erli, ADR-025 §4a; Allegro, E2E-24) declare `implements OfferStockRestorer`.
 *
 * Core's cancellation restore (`OfferStockRestoreService`) reads the
 * declaration and then issues the compensating absolute set itself, through the
 * ordered quantity write every propagation uses (`IInventorySyncService
 * .updateOfferQuantities`, #2617 / ADR-067), rather than calling
 * `restoreStockOnCancellation`. An adapter cannot see the per-offer freshness
 * mark, so a restore it wrote directly could land after a newer propagation and
 * roll the listing back. The method stays the contract an implementer
 * satisfies - an absolute set per target, never a read-and-increment, honouring
 * `idempotencyKey` where its write is command-keyed - and is what an
 * adapter-internal caller (Erli's order-source cancellation writeback) uses.
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
