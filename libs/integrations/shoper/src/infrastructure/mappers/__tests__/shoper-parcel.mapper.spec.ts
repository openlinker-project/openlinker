import type { ShoperParcel, ShoperShippingRow } from '../../../domain/types/shoper-api.types';
import {
  acceptsShoperManualParcel,
  buildShoperParcelCreateRequest,
  normalizeTrackingNumber,
  planShoperParcelWrite,
  readShoperDispatched,
  selectShoperParcelShipping,
} from '../shoper-parcel.mapper';

function parcel(id: string, code: string | null): ShoperParcel {
  return { parcel_id: id, order_id: '10', shipping_code: code };
}

describe('shoper-parcel.mapper', () => {
  describe('buildShoperParcelCreateRequest', () => {
    it('should carry the tracking number as shipping_code and mark the parcel sent', () => {
      expect(buildShoperParcelCreateRequest(10, 8, 'T1')).toEqual({
        order_id: 10,
        shipping_id: 8,
        shipping_code: 'T1',
        sent: true,
      });
    });

    it('should omit shipping_code when no tracking number is known', () => {
      expect(buildShoperParcelCreateRequest(10, 8, undefined)).toEqual({
        order_id: 10,
        shipping_id: 8,
        sent: true,
      });
    });
  });

  describe('planShoperParcelWrite', () => {
    it('should create when the order has no parcel yet', () => {
      expect(planShoperParcelWrite([], 'T1')).toEqual({ kind: 'create' });
      expect(planShoperParcelWrite([], undefined)).toEqual({ kind: 'create' });
    });

    it('should be a no-op when a parcel already carries the tracking number', () => {
      expect(planShoperParcelWrite([parcel('5', ' T1 ')], 'T1')).toEqual({ kind: 'already-applied' });
    });

    it('should be a no-op for a dispatch without tracking once a parcel exists', () => {
      expect(planShoperParcelWrite([parcel('5', null)], undefined)).toEqual({ kind: 'already-applied' });
    });

    it('should attach a late tracking number to the single untracked parcel', () => {
      expect(planShoperParcelWrite([parcel('5', '')], 'T2')).toEqual({
        kind: 'attach-tracking',
        parcelId: '5',
        alreadySent: false,
      });
    });

    it('should mark the attach as going to an already-sent parcel when Shoper reports it sent', () => {
      expect(planShoperParcelWrite([{ ...parcel('5', ''), sent: '1' }], 'T2')).toEqual({
        kind: 'attach-tracking',
        parcelId: '5',
        alreadySent: true,
      });
    });

    it('should report a conflict when the order only has parcels tracked under other numbers', () => {
      expect(planShoperParcelWrite([parcel('5', 'T1')], 'T2')).toEqual({ kind: 'conflict' });
    });

    it('should not guess between several untracked parcels', () => {
      expect(planShoperParcelWrite([parcel('5', null), parcel('6', null)], 'T2')).toEqual({ kind: 'conflict' });
    });
  });

  describe('normalizeTrackingNumber', () => {
    it('should trim and treat blank as absent', () => {
      expect(normalizeTrackingNumber(' T1 ')).toBe('T1');
      expect(normalizeTrackingNumber('   ')).toBeUndefined();
      expect(normalizeTrackingNumber(undefined)).toBeUndefined();
    });
  });

  describe('acceptsShoperManualParcel', () => {
    it('should accept only the plain personal engine, whatever its case', () => {
      expect(acceptsShoperManualParcel({ shipping_id: '8', engine: 'personal' })).toBe(true);
      expect(acceptsShoperManualParcel({ shipping_id: '8', engine: ' Personal ' })).toBe(true);
      expect(acceptsShoperManualParcel({ shipping_id: '1', engine: 'inpost' })).toBe(false);
      expect(acceptsShoperManualParcel({ shipping_id: '2', engine: null })).toBe(false);
      expect(acceptsShoperManualParcel({ shipping_id: '3' })).toBe(false);
    });
  });

  describe('selectShoperParcelShipping', () => {
    const SHIPPINGS: ShoperShippingRow[] = [
      { shipping_id: '1', engine: 'inpost', active: '1' },
      { shipping_id: '7', engine: 'personal', active: '0' },
      { shipping_id: '8', engine: 'personal', active: '1' },
      { shipping_id: '9', engine: 'personal' },
    ];

    it("should take the operator's configured method first, whatever the order uses", () => {
      expect(
        selectShoperParcelShipping({ configuredShippingId: 4, orderShippingId: 9, shippings: SHIPPINGS }),
      ).toEqual({ shippingId: 4, source: 'config' });
    });

    it("should keep the order's own method when Shoper accepts a parcel for it, even an inactive one", () => {
      expect(
        selectShoperParcelShipping({ configuredShippingId: undefined, orderShippingId: 7, shippings: SHIPPINGS }),
      ).toEqual({ shippingId: 7, source: 'order' });
    });

    it('should fall back to the first ACTIVE plain method for an integrated order method', () => {
      expect(
        selectShoperParcelShipping({ configuredShippingId: undefined, orderShippingId: 1, shippings: SHIPPINGS }),
      ).toEqual({ shippingId: 8, source: 'fallback' });
    });

    it('should read a method with no active flag as active', () => {
      expect(
        selectShoperParcelShipping({
          configuredShippingId: undefined,
          orderShippingId: null,
          shippings: [{ shipping_id: '9', engine: 'personal' }],
        }),
      ).toEqual({ shippingId: 9, source: 'fallback' });
    });

    it('should answer null when nothing qualifies', () => {
      expect(
        selectShoperParcelShipping({
          configuredShippingId: undefined,
          orderShippingId: 1,
          shippings: [{ shipping_id: '1', engine: 'inpost', active: '1' }],
        }),
      ).toBeNull();
    });
  });

  describe('readShoperDispatched', () => {
    const sent: ShoperParcel = { parcel_id: '1', order_id: '10', sent: '1' };
    const unsent: ShoperParcel = { parcel_id: '1', order_id: '10', sent: '0' };

    it('should read a sent parcel as dispatched when the status is cancelled', () => {
      expect(readShoperDispatched({ type: 4, labels: ['anulowane'] }, [sent])).toBe(true);
    });

    it('should read a parcel with a send date as dispatched when it carries no sent flag', () => {
      expect(readShoperDispatched(null, [{ parcel_id: '1', order_id: '10', send_date: '2026-10-01 10:00:00' }])).toBe(
        true,
      );
    });

    it('should read the sent status type as dispatched when no parcel was sent', () => {
      expect(readShoperDispatched({ type: 3, labels: [] }, [unsent])).toBe(true);
    });

    it('should read new and in-progress status types as not dispatched when the parcels are unknown', () => {
      expect(readShoperDispatched({ type: 1, labels: [] }, null)).toBe(false);
      expect(readShoperDispatched({ type: 2, labels: [] }, null)).toBe(false);
    });

    it('should read a cancellation as not dispatched when the parcels are unknown', () => {
      expect(readShoperDispatched({ type: 4, labels: ['anulowane'] }, null)).toBe(false);
    });

    it('should read a return as not dispatched only when its parcels were read and none was sent', () => {
      expect(readShoperDispatched({ type: 4, labels: ['zwrot'] }, [unsent])).toBe(false);
      expect(readShoperDispatched({ type: 4, labels: ['zwrot'] }, null)).toBeNull();
    });

    it('should read an unlisted status or an unknown type as unknown when no parcel was sent', () => {
      expect(readShoperDispatched(null, [])).toBeNull();
      expect(readShoperDispatched({ type: 9, labels: [] }, [])).toBeNull();
    });
  });
});
