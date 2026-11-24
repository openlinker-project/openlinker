import { describe, expect, it } from 'vitest';
import { hasShipmentInProgress, shipmentStatusSignature } from './shipment-polling';

describe('hasShipmentInProgress', () => {
  it('should keep polling while a shipment can still move forward', () => {
    expect(hasShipmentInProgress([{ status: 'generated' }])).toBe(true);
    expect(hasShipmentInProgress([{ status: 'dispatched' }])).toBe(true);
    expect(hasShipmentInProgress([{ status: 'in-transit' }])).toBe(true);
  });

  it('should stop polling when every shipment is final or has no label', () => {
    expect(hasShipmentInProgress([])).toBe(false);
    expect(
      hasShipmentInProgress([{ status: 'delivered' }, { status: 'failed' }, { status: 'cancelled' }]),
    ).toBe(false);
    expect(hasShipmentInProgress([{ status: 'draft' }])).toBe(false);
  });

  it('should keep polling when one of several shipments is still in progress', () => {
    expect(hasShipmentInProgress([{ status: 'delivered' }, { status: 'generated' }])).toBe(true);
  });
});

describe('shipmentStatusSignature', () => {
  it('should change when a status changes and not when only the order differs', () => {
    const a = shipmentStatusSignature([
      { id: 's1', status: 'generated' },
      { id: 's2', status: 'delivered' },
    ]);
    const reordered = shipmentStatusSignature([
      { id: 's2', status: 'delivered' },
      { id: 's1', status: 'generated' },
    ]);
    const changed = shipmentStatusSignature([
      { id: 's1', status: 'dispatched' },
      { id: 's2', status: 'delivered' },
    ]);

    expect(reordered).toBe(a);
    expect(changed).not.toBe(a);
  });

  it('should change when a shipment appears', () => {
    expect(shipmentStatusSignature([])).not.toBe(
      shipmentStatusSignature([{ id: 's1', status: 'generated' }]),
    );
  });
});
