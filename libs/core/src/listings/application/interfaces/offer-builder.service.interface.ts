/**
 * Offer Builder Service Interface
 *
 * Contract for assembling a platform-neutral `CreateOfferCommand` from an OL
 * internal variant id plus optional overrides. Implementations resolve the
 * parent master product (for name/description/images/price), the target
 * marketplace category (via the existing category resolution chain), and
 * assemble the final command consumed by `OfferManagerPort.createOffer`.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { CreateOfferCommand, OfferProductSetComponent } from '@openlinker/core/listings';
import type { BuildCreateOfferCommandInput } from '../types/offer-builder.types';

export interface IOfferBuilderService {
  /**
   * Resolve and assemble a `CreateOfferCommand` for the given variant and
   * marketplace connection.
   *
   * Failure modes:
   * - Unknown variant → `OfferBuilderValidationException` (`internalVariantId`, `NOT_FOUND`)
   * - Unknown marketplace connection → `ConnectionNotFoundException`
   * - Marketplace connection missing `masterCatalogConnectionId` in config →
   *   `MasterCatalogConnectionNotConfiguredException`
   * - Cannot resolve category (no EAN/GTIN, no override, resolution returned null) →
   *   `OfferBuilderValidationException` (`overrides.categoryId`, `REQUIRED`)
   * - Cannot resolve price/currency → `OfferBuilderValidationException` (`price.currency`, `REQUIRED`)
   */
  buildCreateOfferCommand(input: BuildCreateOfferCommandInput): Promise<CreateOfferCommand>;

  /**
   * The product-set components a bundle variant would publish with (#3520), or
   * `undefined` when the variant is not a bundle. The same resolution the
   * publish path runs, exposed so the wizard can preview it read-only.
   */
  resolveBundleComponents(input: {
    connectionId: string;
    internalVariantId: string;
    categoryId?: string;
  }): Promise<OfferProductSetComponent[] | undefined>;
}
