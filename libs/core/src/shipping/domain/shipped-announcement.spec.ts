/**
 * shipped-announcement specs (#3554)
 */
import type { ShipmentStatus } from './types/shipment-status.types';
import {
  SHIPPED_TRACKING_GRACE_MS,
  hasKnownTrackingNumber,
  isTrackingWaitOver,
} from './shipped-announcement';

const NOW = new Date('2026-11-02T12:00:00Z');

const shipment = (
  overrides: Partial<{
    status: ShipmentStatus;
    trackingNumber: string | null;
    dispatchedAt: Date | null;
    updatedAt: Date;
  }> = {}
) => ({
  status: 'dispatched' as ShipmentStatus,
  trackingNumber: null,
  dispatchedAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('hasKnownTrackingNumber', () => {
  it('should be true when a live shipment carries a number', () => {
    expect(hasKnownTrackingNumber([shipment({ trackingNumber: '6010014966' })])).toBe(true);
  });

  it('should be false while no shipment has a number yet', () => {
    expect(hasKnownTrackingNumber([shipment()])).toBe(false);
  });

  it('should ignore an empty number and a cancelled or failed label', () => {
    expect(
      hasKnownTrackingNumber([
        shipment({ trackingNumber: '' }),
        shipment({ status: 'cancelled', trackingNumber: 'OLD1' }),
        shipment({ status: 'failed', trackingNumber: 'OLD2' }),
      ])
    ).toBe(false);
  });
});

describe('isTrackingWaitOver', () => {
  const past = (ms: number): Date => new Date(NOW.getTime() - ms);

  it('should be over once a number-less shipment has waited the grace period', () => {
    expect(isTrackingWaitOver(shipment({ dispatchedAt: past(SHIPPED_TRACKING_GRACE_MS) }), NOW)).toBe(
      true
    );
  });

  it('should keep waiting inside the grace period', () => {
    expect(isTrackingWaitOver(shipment({ dispatchedAt: past(60_000) }), NOW)).toBe(false);
  });

  it('should not apply to a shipment that already has a number, or is not on its way', () => {
    const long = past(2 * SHIPPED_TRACKING_GRACE_MS);
    expect(isTrackingWaitOver(shipment({ dispatchedAt: long, trackingNumber: 'X1' }), NOW)).toBe(
      false
    );
    expect(isTrackingWaitOver(shipment({ dispatchedAt: long, status: 'generated' }), NOW)).toBe(
      false
    );
  });

  it('should fall back to the last write when the dispatch instant is missing', () => {
    expect(
      isTrackingWaitOver(
        shipment({ dispatchedAt: null, updatedAt: past(SHIPPED_TRACKING_GRACE_MS + 1) }),
        NOW
      )
    ).toBe(true);
  });
});
