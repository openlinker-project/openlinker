/**
 * Empik offer validation: tests
 *
 * @module features/listings/components/empik
 */
import { describe, expect, it } from 'vitest';

import type { OfferRowValidationInput } from '../../../../shared/plugins';
import {
  EMPIK_NO_CARD_BLOCKER,
  EMPIK_NO_EAN_BLOCKER,
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

  it('should block a row without an EAN', () => {
    expect(empikOfferValidation.validateRow(row({ barcode: '  ' }))).toEqual([
      EMPIK_NO_EAN_BLOCKER,
    ]);
  });

  it('should block a row whose EAN has no Empik card', () => {
    expect(empikOfferValidation.validateRow(row({ willLinkProductCard: false }))).toEqual([
      EMPIK_NO_CARD_BLOCKER,
    ]);
  });

  it('should not claim a missing card when no lookup ran', () => {
    expect(
      empikOfferValidation.validateRow(
        row({ willLinkProductCard: false, catalogueConsulted: false })
      )
    ).toEqual([]);
  });

  it('should declare a descriptor for every blocker it raises', () => {
    expect(empikOfferValidation.blockers.map((blocker) => blocker.id)).toEqual([
      EMPIK_NO_EAN_BLOCKER,
      EMPIK_NO_CARD_BLOCKER,
    ]);
  });
});
