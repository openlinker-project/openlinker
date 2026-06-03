/**
 * Fake DPD Shipping Adapter — unit tests
 *
 * Verifies the in-memory fake mirrors the real adapter's observable contract:
 * supported methods, courier pre-submit validation, a seeded failure, and the
 * dormant `getTracking` throw.
 *
 * @module libs/integrations/dpd-polska/src/testing
 */
import { ShippingProviderRejectionException, type GenerateLabelCommand } from '@openlinker/core/shipping';
import { FakeDpdShippingAdapter } from '../fake-dpd-shipping.adapter';

function makeCmd(overrides: Partial<GenerateLabelCommand> = {}): GenerateLabelCommand {
  return {
    shipmentId: 'ol_shipment_1',
    orderId: 'ol_order_1',
    connectionId: 'conn-dpd',
    shippingMethod: 'kurier',
    recipient: {
      email: 'buyer@example.com',
      phone: '+48500600700',
      address: { street: 'Krakowska', buildingNumber: '12', city: 'Poznań', postCode: '60-001', countryCode: 'PL' },
    },
    parcel: { weightGrams: 1500 },
    ...overrides,
  };
}

describe('FakeDpdShippingAdapter', () => {
  let adapter: FakeDpdShippingAdapter;

  beforeEach(() => {
    adapter = new FakeDpdShippingAdapter();
  });

  it('should support kurier and pickup', () => {
    expect(adapter.getSupportedMethods()).toEqual(['kurier', 'pickup']);
  });

  it('should generate a deterministic, incrementing waybill', async () => {
    const a = await adapter.generateLabel(makeCmd());
    const b = await adapter.generateLabel(makeCmd());

    expect(a.providerShipmentId).toBe('fake-dpd-1');
    expect(b.providerShipmentId).toBe('fake-dpd-2');
    expect(a.trackingNumber).toBe('fake-dpd-1');
    expect(a.labelPdfRef).toBe('fake-dpd-1');
  });

  it('should reject an unsupported method', async () => {
    await expect(adapter.generateLabel(makeCmd({ shippingMethod: 'paczkomat' }))).rejects.toBeInstanceOf(
      ShippingProviderRejectionException,
    );
  });

  it('should reject a courier shipment with no recipient address', async () => {
    const cmd = makeCmd();
    await expect(
      adapter.generateLabel({ ...cmd, recipient: { ...cmd.recipient, address: undefined } }),
    ).rejects.toMatchObject({ providerCode: 'preflight.missing-recipient-address' });
  });

  it('should generate a pickup shipment when a point id is supplied', async () => {
    const result = await adapter.generateLabel(makeCmd({ shippingMethod: 'pickup', paczkomatId: 'PL11033' }));
    expect(result.providerShipmentId).toBe('fake-dpd-1');
  });

  it('should reject a pickup shipment with no point id', async () => {
    await expect(adapter.generateLabel(makeCmd({ shippingMethod: 'pickup' }))).rejects.toMatchObject({
      providerCode: 'preflight.missing-paczkomat-id',
    });
  });

  it('should return seeded pickup points and clear them on reset', async () => {
    adapter.seedPickupPoints([
      { providerId: 'PL11033', name: 'Żabka', address: { line1: 'Krakowska 12', city: 'Poznań', postalCode: '60-001', country: 'PL' }, status: 'active' },
    ]);
    await expect(adapter.findPickupPoints({ city: 'Poznań' })).resolves.toHaveLength(1);

    adapter.clear();
    await expect(adapter.findPickupPoints({ city: 'Poznań' })).resolves.toEqual([]);
  });

  it('should return a PDF label document', async () => {
    const doc = await adapter.fetchLabel({ providerShipmentId: 'fake-dpd-1' });
    expect(doc.contentType).toBe('application/pdf');
    expect(doc.body.length).toBeGreaterThan(0);
  });

  it('should throw tracking.unavailable from getTracking', async () => {
    await expect(adapter.getTracking({ providerShipmentId: 'fake-dpd-1' })).rejects.toMatchObject({
      providerCode: 'tracking.unavailable',
    });
  });

  it('should surface a seeded failure and reset it on clear', async () => {
    adapter.seedFailure(new Error('boom'));
    await expect(adapter.generateLabel(makeCmd())).rejects.toThrow('boom');

    adapter.clear();
    await expect(adapter.generateLabel(makeCmd())).resolves.toMatchObject({ providerShipmentId: 'fake-dpd-1' });
  });
});
