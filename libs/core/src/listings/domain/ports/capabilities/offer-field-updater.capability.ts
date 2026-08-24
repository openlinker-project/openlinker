/**
 * Offer Field Updater Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that support partial
 * field updates (price, title, description, …) declare `implements OfferFieldUpdater`.
 * Partial-update semantics: only fields present in `cmd.fields` are sent to the
 * marketplace.
 *
 * It also carries the destination's `getDescriptionFormat()` declaration
 * (ADR-046) - see the method's own comment for why this sub-capability is its
 * home on the marketplace side.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { DescriptionFormat } from '../../types/description-format.types';
import type {
  UpdateOfferFieldsCommand,
  UpdateOfferFieldsReport,
} from '../../types/offer-fields-update.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferFieldUpdater {
  /**
   * Apply the fields in `cmd.fields` to the destination's offer.
   *
   * The return type is a union with `void` on purpose (#2262). A destination
   * that can refuse a field - Erli drops anything the seller froze, #988 /
   * ADR-025 §4b - reports it in an `UpdateOfferFieldsReport` so a caller can
   * tell "written" from "silently dropped"; the tax-rate journal (#2250)
   * depends on that distinction to avoid recording a write that never
   * happened. An adapter with nothing to declare returns nothing, which every
   * caller must read as *the destination declared nothing*, never as *nothing
   * was frozen*. Keeping it a union is also what keeps an out-of-tree plugin
   * compiled against the pre-#2262 `Promise<void>` signature compatible.
   */
  updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<UpdateOfferFieldsReport | void>;
  /**
   * What this destination accepts in a description (ADR-046). Pure and
   * synchronous: no I/O, no credentials, no network - the adapter declares a
   * value, mirroring `TaxonomyBorrower.getBorrowedTaxonomy()`.
   *
   * It lives on this sub-capability rather than the base port because
   * `OfferFieldUpdater` is the marketplace contract that already names
   * `description`. Consequence: an adapter declaring `OfferCreator` without
   * this sub-capability declares no format and falls back to
   * `CONSERVATIVE_DESCRIPTION_FORMAT`. No such adapter exists today.
   */
  getDescriptionFormat(): DescriptionFormat;
}

export function isOfferFieldUpdater(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferFieldUpdater {
  return typeof (adapter as Partial<OfferFieldUpdater>).updateOfferFields === 'function';
}
