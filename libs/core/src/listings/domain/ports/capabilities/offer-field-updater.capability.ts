/**
 * Offer Field Updater Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that support partial
 * field updates (price, title, description, …) declare `implements OfferFieldUpdater`.
 * Partial-update semantics: only fields present in `cmd.fields` are sent to the
 * marketplace.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { UpdateOfferFieldsCommand } from '../../types/offer-fields-update.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferFieldUpdater {
  updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<void>;
}

export function isOfferFieldUpdater(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferFieldUpdater {
  return typeof (adapter as Partial<OfferFieldUpdater>).updateOfferFields === 'function';
}
