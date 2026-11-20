/**
 * redactOrderSnapshotBuyerData tests (#4178)
 *
 * @module domain/__tests__
 */
import { redactOrderSnapshotBuyerData } from '../order-buyer-data-redaction';

describe('redactOrderSnapshotBuyerData', () => {
  const snapshot = {
    id: 'ol_order_1',
    status: 'shipped',
    items: [{ id: 'l1', sku: 'MUG', quantity: 2, price: 19.95, name: 'Mug' }],
    totals: { total: 39.9, currency: 'EUR' },
    customerEmail: 'abc@marketplace.amazon.de',
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Schmidt',
      address1: 'Hauptstrasse 1',
      city: 'Berlin',
      postalCode: '10115',
      country: 'DE',
      phone: '+49 30 1',
      taxId: 'DE1',
    },
    billingAddress: { address1: 'Weg 2', city: 'Hamburg', postalCode: '20095', country: 'DE' },
  };

  it('should reduce both addresses to their country and drop the email', () => {
    const redacted = redactOrderSnapshotBuyerData(snapshot);

    expect(redacted.shippingAddress).toEqual({
      address1: '[REDACTED]',
      city: '[REDACTED]',
      postalCode: '[REDACTED]',
      country: 'DE',
    });
    expect(redacted.billingAddress).toMatchObject({ address1: '[REDACTED]', country: 'DE' });
    expect(redacted).not.toHaveProperty('customerEmail');
    expect(JSON.stringify(redacted)).not.toMatch(/Anna|Schmidt|Hauptstrasse|\+49|DE1|amazon\.de/);
  });

  it('should keep lines, totals, status and ids', () => {
    const redacted = redactOrderSnapshotBuyerData(snapshot);
    expect(redacted).toMatchObject({ id: 'ol_order_1', status: 'shipped', items: snapshot.items, totals: snapshot.totals });
  });

  it('should not add address keys a snapshot never had', () => {
    expect(redactOrderSnapshotBuyerData({ id: 'x' })).toEqual({ id: 'x' });
  });

  it('should not change its input', () => {
    const copy = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    redactOrderSnapshotBuyerData(snapshot);
    expect(snapshot).toEqual(copy);
  });
});
