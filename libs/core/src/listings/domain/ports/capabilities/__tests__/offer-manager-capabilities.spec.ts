/**
 * Offer Manager Capabilities — type guards spec
 *
 * Table-driven coverage for every `is{Capability}(adapter)` type guard exposed
 * under `libs/core/src/listings/domain/ports/capabilities/`. Each guard must
 * return true when the matching method is a function on the adapter, false
 * when the method is absent, and false when the method slot exists but is
 * not callable.
 *
 * @module libs/core/src/listings/domain/ports/capabilities/__tests__
 */

import type { OfferManagerPort } from '../../offer-manager.port';
import { isOfferLister } from '../offer-lister.capability';
import { isOfferEventReader } from '../offer-event-reader.capability';
import { isOfferQuantityBatchUpdater } from '../offer-quantity-batch-updater.capability';
import { isOfferFieldUpdater } from '../offer-field-updater.capability';
import { isCategoryBrowser } from '../category-browser.capability';
import { isCategoryPathReader } from '../category-path-reader.capability';
import { isCategoryBarcodeMatcher } from '../category-barcode-matcher.capability';
import { isCategoryParametersReader } from '../category-parameters-reader.capability';
import { isCatalogProductReader } from '../catalog-product-reader.capability';
import { isOfferCreator } from '../offer-creator.capability';
import { isOfferReader } from '../offer-reader.capability';
import { isSellerPoliciesReader } from '../seller-policies-reader.capability';

type Guard = (adapter: OfferManagerPort) => boolean;

const cases: ReadonlyArray<readonly [string, Guard, string]> = [
  ['OfferLister', isOfferLister, 'listOffers'],
  ['OfferEventReader', isOfferEventReader, 'listOfferEvents'],
  ['OfferQuantityBatchUpdater', isOfferQuantityBatchUpdater, 'updateOfferQuantitiesBatch'],
  ['OfferFieldUpdater', isOfferFieldUpdater, 'updateOfferFields'],
  ['CategoryBrowser', isCategoryBrowser, 'fetchCategories'],
  ['CategoryPathReader', isCategoryPathReader, 'fetchCategoryPath'],
  ['CategoryBarcodeMatcher', isCategoryBarcodeMatcher, 'matchCategoryByBarcode'],
  ['CategoryParametersReader', isCategoryParametersReader, 'fetchCategoryParameters'],
  ['OfferCreator', isOfferCreator, 'createOffer'],
  ['OfferReader', isOfferReader, 'getOffer'],
  ['SellerPoliciesReader', isSellerPoliciesReader, 'fetchSellerPolicies'],
];

function makeAdapter(extra: Record<string, unknown> = {}): OfferManagerPort {
  return { updateOfferQuantity: jest.fn(), ...extra } as unknown as OfferManagerPort;
}

describe('Offer Manager capability type guards', () => {
  describe.each(cases)('%s', (_name, guard, methodName) => {
    it(`returns true when \`${methodName}\` is a function`, () => {
      expect(guard(makeAdapter({ [methodName]: jest.fn() }))).toBe(true);
    });

    it(`returns false when \`${methodName}\` is absent`, () => {
      expect(guard(makeAdapter())).toBe(false);
    });

    it(`returns false when \`${methodName}\` is present but non-function`, () => {
      expect(guard(makeAdapter({ [methodName]: 'not a function' }))).toBe(false);
    });
  });

  // CatalogProductReader requires BOTH methods, so the table-driven shape
  // above (which checks one method per row) doesn't fit; a dedicated block
  // covers the combinatorics.
  describe('CatalogProductReader', () => {
    it('returns true when both methods are functions', () => {
      expect(
        isCatalogProductReader(
          makeAdapter({ findProductsByBarcode: jest.fn(), getProduct: jest.fn() }),
        ),
      ).toBe(true);
    });

    it('returns false when only findProductsByBarcode is a function', () => {
      expect(isCatalogProductReader(makeAdapter({ findProductsByBarcode: jest.fn() }))).toBe(false);
    });

    it('returns false when only getProduct is a function', () => {
      expect(isCatalogProductReader(makeAdapter({ getProduct: jest.fn() }))).toBe(false);
    });

    it('returns false when neither method is present', () => {
      expect(isCatalogProductReader(makeAdapter())).toBe(false);
    });

    it('returns false when methods are present but non-function', () => {
      expect(
        isCatalogProductReader(
          makeAdapter({ findProductsByBarcode: 'no', getProduct: 'no' }),
        ),
      ).toBe(false);
    });
  });
});
