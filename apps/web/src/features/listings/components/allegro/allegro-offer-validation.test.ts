/**
 * Allegro offer-validation contract tests (#1096)
 *
 * Locks the migrated `needs-product-parameters` blocker (#810) and the opt-in
 * `needsCategoryParameterSchema` flag that gates the host's per-category param
 * fetch. Keeps the plugin-owned validator honest independent of the wizards.
 *
 * @module features/listings/components/allegro
 */
import { describe, expect, it } from 'vitest';

import {
  ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
  allegroOfferValidation,
} from './allegro-offer-validation';

describe('allegroOfferValidation', () => {
  const base = { imageCount: 1, needsProductParameters: false, willLinkProductCard: false };

  it('raises the namespaced blocker when product params are needed and no card links', () => {
    expect(allegroOfferValidation.validateRow({ ...base, needsProductParameters: true })).toEqual([
      ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
    ]);
  });

  it('exempts a card-linked row (params inherited from the catalogue card)', () => {
    expect(
      allegroOfferValidation.validateRow({
        ...base,
        needsProductParameters: true,
        willLinkProductCard: true,
      }),
    ).toEqual([]);
  });

  it('stays silent when no product params are required', () => {
    expect(allegroOfferValidation.validateRow(base)).toEqual([]);
  });

  it('declares the blocker chip once with the namespaced id', () => {
    expect(allegroOfferValidation.blockers).toEqual([
      { id: ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER, tone: 'warning', label: 'add product params' },
    ]);
  });

  it('opts into the host category-parameter schema fetch (its validator reads it)', () => {
    expect(allegroOfferValidation.needsCategoryParameterSchema).toBe(true);
  });
});
