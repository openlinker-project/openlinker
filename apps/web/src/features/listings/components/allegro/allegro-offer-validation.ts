/**
 * Allegro offer validation
 *
 * Declares Allegro's platform-specific per-row blockers and the pure row
 * validator, migrated out of the host `BulkRowBlocker` enum onto the plugin
 * contract (#1096). Two rules today:
 *
 * - `needs-product-parameters` (#810) — a row that creates a product inline (no
 *   catalogue card to inherit from) under a category with required product-
 *   section params it hasn't supplied would 422 at submit; card-linked rows are
 *   exempt (they inherit the params).
 * - `title-too-long` (#1962) — the pre-submit half of the adapter's 75-char
 *   title check (#1934/F11). Without it an untouched row whose master product
 *   name is long reads **ready**, submits `202`, and only then terminates
 *   `business_failure` per record.
 *
 * The neutral price/stock/category blockers stay host-owned — only the
 * Allegro-specific ones live here.
 *
 * @module features/listings/components/allegro
 */
import type { OfferValidationContribution } from '../../../../shared/plugins';
import { isAllegroTitleTooLong } from './allegro-title';

export const ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER = 'allegro:needs-product-parameters';
export const ALLEGRO_TITLE_TOO_LONG_BLOCKER = 'allegro:title-too-long';

export const allegroOfferValidation: OfferValidationContribution = {
  blockers: [
    {
      id: ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
      tone: 'warning',
      label: 'add product params',
    },
    {
      id: ALLEGRO_TITLE_TOO_LONG_BLOCKER,
      tone: 'error',
      label: 'title too long',
    },
  ],
  validateRow: (input) => {
    const blockers: string[] = [];
    if (input.needsProductParameters && !input.willLinkProductCard) {
      blockers.push(ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER);
    }
    if (isAllegroTitleTooLong(input.title)) {
      blockers.push(ALLEGRO_TITLE_TOO_LONG_BLOCKER);
    }
    return blockers;
  },
  // Allegro's validator reads `needsProductParameters`, so the host must fetch
  // the per-category required-param schema for this batch (#810 / #1096).
  needsCategoryParameterSchema: true,
};
