/**
 * The placeholder obligation reader (#2346)
 *
 * This spec is the guard that makes forgetting to swap in #2339's real reader
 * SAFE and swapping it DELIBERATE: while this class is bound the sweep can
 * never release a reservation.
 *
 * @module libs/core/src/inventory/infrastructure/reservations
 */
import { UnavailableOrderHoldReader } from './unavailable-order-hold.reader';
import {
  resolveObligation,
  type ObligationReaders,
} from '../../domain/types/reservation-obligation.types';

describe('UnavailableOrderHoldReader', () => {
  it('should answer indeterminate — there is no order_holds table to consult', async () => {
    expect(await new UnavailableOrderHoldReader().read('ol_order_1')).toBe('indeterminate');
  });

  it('should never produce a verdict that releases a reservation', async () => {
    const holds = new UnavailableOrderHoldReader();
    const readers: ObligationReaders = {
      'open-order-hold': (orderRecordId) => holds.read(orderRecordId),
    };

    // `absent` is the ONLY verdict `ReservationExpiryService` releases on. While
    // this reader is bound the sweep therefore extends everything and releases
    // nothing — the deliberate fail-closed posture, asserted rather than assumed.
    for (const orderRecordId of ['ol_order_1', 'ol_order_2', '']) {
      expect(await resolveObligation(readers, orderRecordId)).not.toBe('absent');
    }
  });
});
