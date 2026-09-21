import { SubiektOrderProcessorAdapter } from '../subiekt-order-processor.adapter';
import { SubiektOrdersBridgeClient } from '../../../bridge/subiekt-orders-bridge.client';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { OrderCreate } from '@openlinker/core/orders';

const noopLogger: LoggerPort = {
  log: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('SubiektOrderProcessorAdapter', () => {
  it('creates a ZK priced at the buyer-paid source total, never a catalogue lookup', async () => {
    let capturedBody: unknown;
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({ success: true, data: { id: 7, numer: 'ZK 7/2026' }, error: null }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
    const adapter = new SubiektOrderProcessorAdapter(client, noopLogger);

    const order: OrderCreate = {
      status: 'pending',
      items: [
        { id: '1', productId: 'ol_product_x', quantity: 2, price: 19.99, sku: 'SKU-1' },
      ],
      totals: { subtotal: 39.98, tax: 0, shipping: 0, total: 39.98, currency: 'PLN' },
      billingAddress: {
        company: 'Acme Sp. z o.o.',
        taxId: '1234567890',
        address1: 'Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
      orderNumber: 'OL-100',
    };

    const ref = await adapter.createOrder(order);

    expect(ref).toEqual({ orderId: '7', orderNumber: 'ZK 7/2026' });
    expect(capturedBody).toMatchObject({
      buyer: { nazwa: 'Acme Sp. z o.o.', nip: '1234567890' },
      lines: [{ symbol: 'SKU-1', ilosc: 2, wartoscBrutto: 39.98 }],
      orderRef: 'OL-100',
    });
  });

  it('falls back to first/last name when no company is present', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: { id: 1, numer: 'ZK 1/2026' }, error: null }), {
          status: 200,
        }),
      )) as unknown as typeof fetch;
    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
    const adapter = new SubiektOrderProcessorAdapter(client, noopLogger);

    const order: OrderCreate = {
      status: 'pending',
      items: [{ id: '1', productId: 'ol_product_x', quantity: 1, price: 10 }],
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
      shippingAddress: {
        firstName: 'Jan',
        lastName: 'Kowalski',
        address1: 'Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
    };

    const ref = await adapter.createOrder(order);
    expect(ref.orderId).toBe('1');
  });
});
