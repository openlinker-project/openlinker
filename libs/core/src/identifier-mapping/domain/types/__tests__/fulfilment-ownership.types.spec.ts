/**
 * Fulfilment ownership helper tests (#2118)
 *
 * @module libs/core/src/identifier-mapping/domain/types/__tests__
 */
import {
  isPresentButInvalidFulfilmentOwnedByDestination,
  readFulfilmentOwnedByDestination,
} from '../fulfilment-ownership.types';

describe('fulfilment-ownership', () => {
  describe('readFulfilmentOwnedByDestination', () => {
    it('should default to false when config is null or undefined', () => {
      expect(readFulfilmentOwnedByDestination(null)).toBe(false);
      expect(readFulfilmentOwnedByDestination(undefined)).toBe(false);
    });

    it('should default to false when the key is absent', () => {
      expect(readFulfilmentOwnedByDestination({})).toBe(false);
      expect(readFulfilmentOwnedByDestination({ stockSafetyBuffer: 3 })).toBe(false);
    });

    it('should read an explicit boolean', () => {
      expect(readFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: true })).toBe(true);
      expect(readFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: false })).toBe(
        false
      );
    });

    it('should read any non-boolean value as false', () => {
      for (const raw of ['true', 1, 'yes', null, {}, []]) {
        expect(readFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: raw })).toBe(
          false
        );
      }
    });
  });

  describe('isPresentButInvalidFulfilmentOwnedByDestination', () => {
    it('should not flag absent, null or boolean values', () => {
      expect(isPresentButInvalidFulfilmentOwnedByDestination(null)).toBe(false);
      expect(isPresentButInvalidFulfilmentOwnedByDestination({})).toBe(false);
      expect(
        isPresentButInvalidFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: null })
      ).toBe(false);
      expect(
        isPresentButInvalidFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: false })
      ).toBe(false);
      expect(
        isPresentButInvalidFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: true })
      ).toBe(false);
    });

    it('should flag a present non-boolean value', () => {
      for (const raw of ['true', 1, 0, {}, []]) {
        expect(
          isPresentButInvalidFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: raw })
        ).toBe(true);
      }
    });
  });
});
