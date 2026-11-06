/**
 * Pins the sync catalogue's write-mark prefix (#4023) to the key this context
 * builds (#2617), so renaming one without the other fails here.
 */
import { OFFER_QUANTITY_WRITE_MARK_PREFIX } from '@openlinker/core/sync';
import { offerQuantityObservationCursorKey } from './offer-quantity-write-order.types';

describe('offer quantity write-mark prefix', () => {
  it('should start every write-mark key with the prefix the sync overview summarises', () => {
    expect(offerQuantityObservationCursorKey('123')).toBe(`${OFFER_QUANTITY_WRITE_MARK_PREFIX}123`);
  });
});
