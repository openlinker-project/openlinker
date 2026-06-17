/**
 * Allegro offer validation
 *
 * Declares Allegro's platform-specific per-row blocker (`needs-product-parameters`,
 * #810) and the pure row validator, migrated out of the host `BulkRowBlocker`
 * enum onto the plugin contract (#1096). A row that creates a product inline
 * (no catalogue card to inherit from) under a category with required product-
 * section params it hasn't supplied would 422 at submit; card-linked rows are
 * exempt (they inherit the params). The neutral price/stock/category blockers
 * stay host-owned — only this Allegro-specific one moves here.
 *
 * @module features/listings/components/allegro
 */
import type { OfferValidationContribution } from '../../../../shared/plugins';

export const ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER = 'allegro:needs-product-parameters';

export const allegroOfferValidation: OfferValidationContribution = {
  blockers: [
    {
      id: ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
      tone: 'warning',
      label: 'add product params',
    },
  ],
  validateRow: (input) =>
    input.needsProductParameters && !input.willLinkProductCard
      ? [ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER]
      : [],
  // Allegro's validator reads `needsProductParameters`, so the host must fetch
  // the per-category required-param schema for this batch (#810 / #1096).
  needsCategoryParameterSchema: true,
};
