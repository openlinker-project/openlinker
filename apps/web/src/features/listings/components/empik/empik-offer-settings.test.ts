/**
 * Empik offer settings: tests
 *
 * @module features/listings/components/empik
 */
import { describe, expect, it } from 'vitest';

import {
  empikBulkConfigIsComplete,
  readEmpikConnectionOfferDefaults,
  readEmpikOfferSettings,
} from './empik-offer-settings';

describe('readEmpikOfferSettings', () => {
  it('should keep valid values and drop the rest', () => {
    expect(readEmpikOfferSettings({ leadTimeToShip: 2, logisticClass: 1 })).toEqual({
      leadTimeToShip: 2,
      logisticClass: '1',
    });
    expect(readEmpikOfferSettings({ leadTimeToShip: 31, logisticClass: ' ' })).toEqual({});
    expect(readEmpikOfferSettings(null)).toEqual({});
  });

  it('should read the connection defaults from offerDefaults', () => {
    expect(readEmpikConnectionOfferDefaults({ offerDefaults: { leadTimeToShip: 3 } })).toEqual({
      leadTimeToShip: 3,
    });
  });
});

describe('empikBulkConfigIsComplete', () => {
  it('should be complete only with a lead time and a logistic class', () => {
    expect(
      empikBulkConfigIsComplete({ platformParams: { leadTimeToShip: 0, logisticClass: '1' } })
    ).toBe(true);
    expect(empikBulkConfigIsComplete({ platformParams: { leadTimeToShip: 2 } })).toBe(false);
  });
});
