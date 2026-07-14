/**
 * WooCommerce Fulfillment Status Mapper — unit tests
 *
 * Pure-function coverage of the WC → neutral fulfillment status mapping
 * (#1550). No adapter or HTTP client instantiation needed.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor/__tests__
 */
import {
  mapWooCommerceStatus,
  mapToFulfillmentStatusSnapshot,
  WC_FULFILLMENT_STATUS_MAP,
} from '../woocommerce-fulfillment-status.mapper';
import { WC_ORDER_STATUS_VALUES } from '../woocommerce-order-status.types';
import { FULFILLMENT_STATUS } from '@openlinker/core/orders';

describe('WooCommerceFulfillmentStatusMapper', () => {
  describe('mapWooCommerceStatus', () => {
    it.each([
      ['pending', null],
      ['processing', null],
      ['on-hold', null],
      ['failed', null],
      ['completed', FULFILLMENT_STATUS.Delivered],
      ['cancelled', FULFILLMENT_STATUS.Cancelled],
      ['refunded', FULFILLMENT_STATUS.Cancelled],
    ] as const)('should map WC status "%s" to neutral %s', (wcStatus, expected) => {
      expect(mapWooCommerceStatus(wcStatus)).toBe(expected);
    });

    it('should map an unknown status to null', () => {
      expect(mapWooCommerceStatus('checkout-draft')).toBeNull();
    });

    it('should map an absent status to null', () => {
      expect(mapWooCommerceStatus(undefined)).toBeNull();
    });

    it('should have a mapping entry for every WC status in the shared vocabulary', () => {
      for (const status of WC_ORDER_STATUS_VALUES) {
        expect(WC_FULFILLMENT_STATUS_MAP).toHaveProperty(status);
      }
    });
  });

  describe('mapToFulfillmentStatusSnapshot', () => {
    it('should return delivered with deliveredAt from date_completed_gmt for a completed order', () => {
      const snapshot = mapToFulfillmentStatusSnapshot({
        id: 1,
        status: 'completed',
        date_completed_gmt: '2026-07-14T10:30:00',
      });

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Delivered);
      expect(snapshot.trackingNumber).toBeNull();
      expect(snapshot.deliveredAt).toEqual(new Date('2026-07-14T10:30:00Z'));
    });

    it('should fall back to date_modified_gmt for deliveredAt when date_completed_gmt is absent', () => {
      const snapshot = mapToFulfillmentStatusSnapshot({
        id: 1,
        status: 'completed',
        date_modified_gmt: '2026-07-13T08:00:00',
      });

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Delivered);
      expect(snapshot.deliveredAt).toEqual(new Date('2026-07-13T08:00:00Z'));
    });

    it('should return delivered with null deliveredAt when no completion timestamp is present', () => {
      const snapshot = mapToFulfillmentStatusSnapshot({ id: 1, status: 'completed' });

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Delivered);
      expect(snapshot.deliveredAt).toBeNull();
    });

    it('should return cancelled with null deliveredAt for a cancelled order', () => {
      const snapshot = mapToFulfillmentStatusSnapshot({ id: 1, status: 'cancelled' });

      expect(snapshot).toEqual({
        status: FULFILLMENT_STATUS.Cancelled,
        trackingNumber: null,
        deliveredAt: null,
      });
    });

    it('should return cancelled for a refunded order', () => {
      const snapshot = mapToFulfillmentStatusSnapshot({ id: 1, status: 'refunded' });

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Cancelled);
      expect(snapshot.deliveredAt).toBeNull();
    });

    it('should return null status for a pre-fulfillment (processing) order', () => {
      const snapshot = mapToFulfillmentStatusSnapshot({ id: 1, status: 'processing' });

      expect(snapshot).toEqual({ status: null, trackingNumber: null, deliveredAt: null });
    });

    it('should not populate deliveredAt for a non-delivered status even when a timestamp exists', () => {
      const snapshot = mapToFulfillmentStatusSnapshot({
        id: 1,
        status: 'cancelled',
        date_modified_gmt: '2026-07-14T10:30:00',
      });

      expect(snapshot.deliveredAt).toBeNull();
    });

    it('should honour an explicit timezone offset on the completion timestamp', () => {
      const snapshot = mapToFulfillmentStatusSnapshot({
        id: 1,
        status: 'completed',
        date_completed_gmt: '2026-07-14T12:30:00+02:00',
      });

      expect(snapshot.deliveredAt).toEqual(new Date('2026-07-14T10:30:00Z'));
    });
  });
});
