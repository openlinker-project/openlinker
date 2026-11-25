import { describe, expect, it } from 'vitest';
import { resolveOrderDetailTab, tabForAnchor } from './order-detail-tabs';

describe('resolveOrderDetailTab', () => {
  it('should use the tab param when it names a known tab', () => {
    expect(resolveOrderDetailTab({ tabParam: 'documents', hash: '', hasRetryShipmentId: false })).toBe('documents');
  });
  it('should ignore an unknown tab param and fall back to the default', () => {
    expect(resolveOrderDetailTab({ tabParam: 'nope', hash: '', hasRetryShipmentId: false })).toBe('overview');
  });
  it('should map each legacy anchor onto the tab that holds it', () => {
    expect(tabForAnchor('shipment')).toBe('shipping');
    expect(tabForAnchor('packing')).toBe('packing');
    expect(tabForAnchor('invoicing')).toBe('documents');
    expect(tabForAnchor('order-raw-snapshot')).toBe('technical');
    expect(tabForAnchor('unknown')).toBeNull();
  });
  it('should let the tab param win over a legacy anchor', () => {
    expect(resolveOrderDetailTab({ tabParam: 'notes', hash: '#shipment', hasRetryShipmentId: false })).toBe('notes');
  });
  it('should land a retryShipmentId link on shipping', () => {
    expect(resolveOrderDetailTab({ tabParam: null, hash: '', hasRetryShipmentId: true })).toBe('shipping');
  });
});
