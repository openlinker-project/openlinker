/**
 * Empik offer validation: tests
 *
 * @module features/listings/components/empik
 */
import { describe, expect, it } from 'vitest';

import type { OfferRowValidationInput } from '../../../../shared/plugins';
import {
  EMPIK_CARD_MISSING_PARAMETERS_BLOCKER,
  EMPIK_CARD_NO_DESCRIPTION_BLOCKER,
  EMPIK_CARD_NO_IMAGE_BLOCKER,
  EMPIK_NEW_CARD_NOTICE,
  empikOfferValidation,
} from './empik-offer-validation';

function row(overrides: Partial<OfferRowValidationInput> = {}): OfferRowValidationInput {
  return {
    imageCount: 1,
    needsProductParameters: false,
    willLinkProductCard: true,
    title: 'Harry Potter',
    barcode: '9788380082113',
    catalogueConsulted: true,
    ...overrides,
  };
}

describe('empikOfferValidation', () => {
  it('should pass a row with an EAN that links an Empik card', () => {
    expect(empikOfferValidation.validateRow(row())).toEqual([]);
  });

  it('should leave a row without an EAN to the host barcode check', () => {
    expect(
      empikOfferValidation.validateRow(row({ barcode: '  ', willLinkProductCard: false }))
    ).toEqual([]);
  });

  it('should only note a new card when a card-less row has what the card needs', () => {
    expect(empikOfferValidation.validateRow(row({ willLinkProductCard: false }))).toEqual([
      EMPIK_NEW_CARD_NOTICE,
    ]);
  });

  it('should block a new card without an image or with required attributes missing', () => {
    expect(
      empikOfferValidation.validateRow(
        row({ willLinkProductCard: false, imageCount: 0, needsProductParameters: true })
      )
    ).toEqual([
      EMPIK_NEW_CARD_NOTICE,
      EMPIK_CARD_NO_IMAGE_BLOCKER,
      EMPIK_CARD_MISSING_PARAMETERS_BLOCKER,
    ]);
  });

  it('should block a new card without a description, but not when the host did not tell', () => {
    expect(
      empikOfferValidation.validateRow(row({ willLinkProductCard: false, hasDescription: false }))
    ).toEqual([EMPIK_NEW_CARD_NOTICE, EMPIK_CARD_NO_DESCRIPTION_BLOCKER]);
    expect(
      empikOfferValidation.validateRow(row({ willLinkProductCard: false, hasDescription: true }))
    ).toEqual([EMPIK_NEW_CARD_NOTICE]);
  });

  it('should not ask for card attributes on a row that links an existing card', () => {
    expect(
      empikOfferValidation.validateRow(row({ imageCount: 0, needsProductParameters: true }))
    ).toEqual([]);
  });

  it('should not claim a missing card when no lookup ran', () => {
    expect(
      empikOfferValidation.validateRow(
        row({ willLinkProductCard: false, catalogueConsulted: false })
      )
    ).toEqual([]);
  });

  it('should keep the new-card note advisory and the card checks blocking', () => {
    const byId = new Map(empikOfferValidation.blockers.map((blocker) => [blocker.id, blocker]));

    expect([...byId.keys()]).toEqual([
      EMPIK_NEW_CARD_NOTICE,
      EMPIK_CARD_NO_IMAGE_BLOCKER,
      EMPIK_CARD_NO_DESCRIPTION_BLOCKER,
      EMPIK_CARD_MISSING_PARAMETERS_BLOCKER,
    ]);
    expect(byId.get(EMPIK_NEW_CARD_NOTICE)?.advisory).toBe(true);
    expect(byId.get(EMPIK_CARD_NO_IMAGE_BLOCKER)?.advisory).toBeUndefined();
    expect(empikOfferValidation.needsCategoryParameterSchema).toBe(true);
  });
});
