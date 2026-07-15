/**
 * Fake InPost Shipping Adapter — unit tests
 *
 * @module libs/integrations/inpost/src/testing
 */
import {
  ShippingProviderRejectionException,
  type GenerateLabelCommand,
  type PickupPoint,
} from '@openlinker/core/shipping';
import { FakeInpostShippingAdapter } from '../fake-inpost-shipping.adapter';

const paczkomatCmd: GenerateLabelCommand = {
  shipmentId: 'ol_shipment_abc',
  orderId: 'ol_order_xyz',
  connectionId: 'conn-1',
  shippingMethod: 'paczkomat',
  paczkomatId: 'POZ08A',
  recipient: { email: 'buyer@example.com', phone: '111222333' },
  parcel: { template: 'small' },
};

describe('FakeInpostShippingAdapter', () => {
  let fake: FakeInpostShippingAdapter;

  beforeEach(() => {
    fake = new FakeInpostShippingAdapter();
  });

  it('should return supported methods', () => {
    expect(fake.getSupportedMethods()).toEqual(['paczkomat', 'kurier']);
  });

  it('should generate a deterministic label and ref', async () => {
    const result = await fake.generateLabel(paczkomatCmd);
    expect(result.providerShipmentId).toBe('fake-1');
    expect(result.labelPdfRef).toBe('shipx:label:fake-1');
    expect(result.trackingNumber).toBeNull();
  });

  it('should validate a missing paczkomatId like the real adapter (#885)', async () => {
    await expect(
      fake.generateLabel({ ...paczkomatCmd, paczkomatId: undefined }),
    ).rejects.toMatchObject({
      name: 'ShippingProviderRejectionException',
      providerName: 'inpost',
      providerCode: 'preflight.missing-paczkomat-id',
    });
  });

  it('should report cancelled tracking after cancelShipment', async () => {
    const { providerShipmentId } = await fake.generateLabel(paczkomatCmd);
    await fake.cancelShipment({ providerShipmentId });
    const snapshot = await fake.getTracking({ providerShipmentId });
    expect(snapshot.status).toBe('cancelled');
  });

  it('should throw the seeded failure from generateLabel', async () => {
    fake.seedFailure(
      new ShippingProviderRejectionException('inpost', 'preflight.unsupported-method', 'seeded'),
    );
    await expect(fake.generateLabel(paczkomatCmd)).rejects.toThrow('seeded');
  });

  it('should return seeded pickup points', async () => {
    const point: PickupPoint = {
      providerId: 'POZ08A',
      name: 'POZ08A',
      address: { line1: 'Główna 1', city: 'Poznań', postalCode: '60-001', country: 'PL' },
      status: 'active',
    };
    fake.seedPickupPoints([point]);
    await expect(fake.findPickupPoints({ city: 'Poznań' })).resolves.toEqual([point]);
  });

  it('should return a deterministic protocol document for a batch', async () => {
    const result = await fake.generateProtocol({ providerShipmentIds: ['fake-1', 'fake-2'] });
    expect(result.contentType).toBe('application/pdf');
    expect(result.body).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it('should reject an empty protocol batch like the real adapter', async () => {
    await expect(fake.generateProtocol({ providerShipmentIds: [] })).rejects.toMatchObject({
      name: 'ShippingProviderRejectionException',
      providerCode: 'preflight.empty-protocol-batch',
    });
  });

  it('should reset state on clear', async () => {
    await fake.generateLabel(paczkomatCmd);
    fake.clear();
    const result = await fake.generateLabel(paczkomatCmd);
    expect(result.providerShipmentId).toBe('fake-1');
  });
});
