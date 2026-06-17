/**
 * Erli offer-validation contract tests (#1096)
 *
 * Locks the missing-image blocker and confirms Erli opts OUT of the host's
 * per-category required-product-param fetch (its validator ignores
 * `needsProductParameters`), so an Erli batch issues zero category-param
 * queries. Mirrors the Allegro contract test.
 *
 * @module features/listings/components/erli
 */
import { describe, expect, it } from 'vitest';

import { ERLI_MISSING_IMAGE_BLOCKER, erliOfferValidation } from './erli-offer-validation';

describe('erliOfferValidation', () => {
  const base = { imageCount: 1, needsProductParameters: false, willLinkProductCard: false };

  it('blocks a row whose master product carries no image', () => {
    expect(erliOfferValidation.validateRow({ ...base, imageCount: 0 })).toEqual([
      ERLI_MISSING_IMAGE_BLOCKER,
    ]);
  });

  it('passes a row with at least one image', () => {
    expect(erliOfferValidation.validateRow(base)).toEqual([]);
  });

  it('ignores `needsProductParameters` entirely (Erli has no product-section params)', () => {
    expect(
      erliOfferValidation.validateRow({
        imageCount: 1,
        needsProductParameters: true,
        willLinkProductCard: false,
      }),
    ).toEqual([]);
  });

  it('declares the missing-image chip once with the namespaced id', () => {
    expect(erliOfferValidation.blockers).toEqual([
      { id: ERLI_MISSING_IMAGE_BLOCKER, tone: 'error', label: 'no image' },
    ]);
  });

  it('opts OUT of the host category-parameter schema fetch (validator never reads it)', () => {
    expect(erliOfferValidation.needsCategoryParameterSchema).toBeFalsy();
  });
});
