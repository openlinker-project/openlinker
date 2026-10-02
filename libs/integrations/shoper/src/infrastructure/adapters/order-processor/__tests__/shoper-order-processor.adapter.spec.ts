import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { Address, OrderCreate } from '@openlinker/core/orders';

import { ShoperNotSupportedException } from '../../../../domain/exceptions/shoper-not-supported.exception';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperCustomerProvisioner } from '../../../provisioners/shoper-customer.provisioner';
import { ShoperOrderProcessorAdapter } from '../shoper-order-processor.adapter';

function address(firstName: string, lastName: string): Address {
  return { firstName, lastName, address1: 'Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' };
}

function setup() {
  const resolveOrCreateCustomer = jest.fn().mockResolvedValue('91');
  const adapter = new ShoperOrderProcessorAdapter(
    {} as ShoperHttpClient,
    {} as IdentifierMappingPort,
    { resolveOrCreateCustomer } as unknown as ShoperCustomerProvisioner,
    'conn-1',
  );
  return { adapter, resolveOrCreateCustomer };
}

function order(overrides: Partial<OrderCreate> = {}): OrderCreate {
  return {
    status: 'pending',
    customerId: 'ol_customer_1',
    items: [],
    totals: { total: 0, currency: 'PLN' },
    billingAddress: address('Jan', 'Kowalski'),
    metadata: { buyerEmail: ' jan@example.com ' },
    ...overrides,
  } as OrderCreate;
}

describe('ShoperOrderProcessorAdapter', () => {
  it('should not create orders yet', async () => {
    const { adapter } = setup();

    await expect(adapter.createOrder(order())).rejects.toBeInstanceOf(ShoperNotSupportedException);
  });

  it('should resolve the customer from the metadata email and the billing name', async () => {
    const { adapter, resolveOrCreateCustomer } = setup();

    await expect(adapter.resolveCustomer(order())).resolves.toBe('91');

    expect(resolveOrCreateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        internalCustomerId: 'ol_customer_1',
        buyerEmail: 'jan@example.com',
        firstName: 'Jan',
        lastName: 'Kowalski',
        connectionId: 'conn-1',
      }),
    );
  });

  it('should fall back to the shipping name and pass no email when it is not valid', async () => {
    const { adapter, resolveOrCreateCustomer } = setup();

    await adapter.resolveCustomer(
      order({
        billingAddress: undefined,
        shippingAddress: address('Anna', 'Nowak'),
        metadata: { buyerEmail: 'not-an-email' },
      }),
    );

    expect(resolveOrCreateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ buyerEmail: undefined, firstName: 'Anna', lastName: 'Nowak' }),
    );
  });
});
