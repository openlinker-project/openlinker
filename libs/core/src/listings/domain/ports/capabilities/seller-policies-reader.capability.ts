/**
 * Seller Policies Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can surface the
 * seller-configured policies required when creating an offer (delivery, return,
 * warranty, implied-warranty) declare `implements SellerPoliciesReader`. The FE
 * offer-creation wizard renders these so the operator can attach them via
 * `CreateOfferCommand.overrides.platformParams`.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { SellerPolicies } from '../../types/seller-policies.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface SellerPoliciesReader {
  fetchSellerPolicies(): Promise<SellerPolicies>;
}

export function isSellerPoliciesReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & SellerPoliciesReader {
  return (
    typeof (adapter as Partial<SellerPoliciesReader>).fetchSellerPolicies === 'function'
  );
}
