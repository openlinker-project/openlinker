import type { ShoperParcel } from '../../../domain/types/shoper-api.types';
import {
  buildShoperParcelCreateRequest,
  normalizeTrackingNumber,
  planShoperParcelWrite,
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
      });
    });

    it('should create when the order only has parcels tracked under other numbers', () => {
      expect(planShoperParcelWrite([parcel('5', 'T1')], 'T2')).toEqual({ kind: 'create' });
    });

    it('should not guess between several untracked parcels', () => {
      expect(planShoperParcelWrite([parcel('5', null), parcel('6', null)], 'T2')).toEqual({ kind: 'create' });
    });
  });

  describe('normalizeTrackingNumber', () => {
    it('should trim and treat blank as absent', () => {
      expect(normalizeTrackingNumber(' T1 ')).toBe('T1');
      expect(normalizeTrackingNumber('   ')).toBeUndefined();
      expect(normalizeTrackingNumber(undefined)).toBeUndefined();
    });
  });
});
