/**
 * Offer Creator Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can create new
 * offers outbound (OL → marketplace) declare `implements OfferCreator`.
 * Platform-specific fields travel inside `cmd.overrides.platformParams`.
 * For marketplaces that validate asynchronously (Allegro), callers must poll
 * to observe the final status.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { CreateOfferCommand, CreateOfferResult } from '../../types/offer-create.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferCreator {
  createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult>;
}

export function isOfferCreator(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferCreator {
  return typeof (adapter as Partial<OfferCreator>).createOffer === 'function';
}
