/**
 * Resolve Catalogue Tax Rate
 *
 * Read the variant's effective catalogue tax rate (ADR-063: the variant override
 * wins over the product's own) for a destination command. Shared by the offer
 * builder and the product-publish builder so both stamp the same rate the same
 * way - a shop publisher needs it to turn the gross catalogue price back into
 * its own net field (ADR-077), exactly as a marketplace needs it for its tax
 * settings.
 *
 * A failed read degrades to "no rate" and is logged rather than thrown: the
 * destination adapter decides what an absent rate means for it (a marketplace
 * may publish without one; a net-priced shop refuses), and a transient read
 * error here must not fail a build that may not need the rate at all.
 *
 * @module libs/core/src/listings/application/services
 */

import type { LoggerPort } from '@openlinker/shared/logging';
import type { IProductsService } from '@openlinker/core/products';

export interface ResolvedCatalogueTaxRate {
  /** Percent-as-string code (`'23'`, `'zw'`, ...), or null when unknown. */
  code: string | null;
  /** ISO 3166-1 alpha-2 the rate was resolved against, or null. */
  countryIso2: string | null;
}

export async function resolveCatalogueTaxRate(
  productsService: Pick<IProductsService, 'getEffectiveTaxRate'>,
  logger: LoggerPort,
  productId: string,
  variantId: string
): Promise<ResolvedCatalogueTaxRate> {
  try {
    const stored = await productsService.getEffectiveTaxRate(productId, variantId);
    return { code: stored.code, countryIso2: stored.countryIso2 };
  } catch (error) {
    logger.warn(
      `Could not read the catalogue tax rate for variant ${variantId}: ${(error as Error).message}`
    );
    return { code: null, countryIso2: null };
  }
}
