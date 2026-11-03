/**
 * WooCommerce Order Processor Adapter — tax class on create (#3505, G01-6)
 *
 * With WooCommerce taxes on, the shop recomputes each line's tax from its
 * `tax_class`, so the create payload must pin the class that gives the line's
 * own rate. With taxes off the payload must be exactly what it was before.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor/__tests__
 */
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { DestinationAddressMapping } from '@openlinker/core/customers';
import type { OrderCreate, OrderItem } from '@openlinker/core/orders';
import type { SyncLockPort } from '@openlinker/core/sync';

import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import { WooCommerceCustomerProvisioner } from '../../../provisioners/woocommerce-customer-provisioner';
import { WooCommerceAddressProvisioner } from '../../../provisioners/woocommerce-address-provisioner';
import { WooCommerceOrderProcessingException } from '../../../../domain/exceptions/woocommerce-order-processing.exception';
import type { WooCommerceTaxRate } from '../../product-master/woocommerce-product.types';
import { WooCommerceOrderProcessorAdapter } from '../woocommerce-order-processor.adapter';
import type { WooCommerceOrderCreateRequest } from '../woocommerce-order.types';

const CONNECTION_ID = 'conn-wc-tax';

const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;
beforeAll(() => {
  process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';
});
afterAll(() => {
  if (originalPiiHashSalt === undefined) delete process.env.OL_PII_HASH_SALT;
  else process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
});

const connection: Connection = {
  id: CONNECTION_ID,
  platformType: 'woocommerce',
  name: 'Tax store',
  status: 'active',
  config: { siteUrl: 'https://shop.example' } as Record<string, unknown>,
  credentialsRef: 'cred',
  adapterKey: 'woocommerce.restapi.v3',
  enabledCapabilities: ['OrderProcessorManager'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function rate(country: string, value: string): WooCommerceTaxRate {
  return { country, rate: value, priority: 1, compound: false, state: '', postcode: '', city: '' };
}

/** A Polish store: standard 23%, reduced 5%, and the stock empty zero-rate class. */
function makeHttpClient(calcTaxes: 'yes' | 'no'): jest.Mocked<IWooCommerceHttpClient> {
  const rates: Record<string, WooCommerceTaxRate[]> = {
    standard: [rate('PL', '23.0000')],
    'reduced-rate': [rate('PL', '5.0000')],
    'zero-rate': [],
  };
  const get = jest.fn((path: string, params?: Record<string, string | number | boolean>) => {
    if (path === '/wp-json/wc/v3/settings/general') {
      return Promise.resolve([{ id: 'woocommerce_calc_taxes', value: calcTaxes }]);
    }
    if (path === '/wp-json/wc/v3/taxes/classes') {
      return Promise.resolve(
        ['standard', 'reduced-rate', 'zero-rate'].map((slug) => ({ slug, name: slug })),
      );
    }
    if (path === '/wp-json/wc/v3/taxes') {
      return Promise.resolve(params?.page === 1 ? (rates[String(params.class)] ?? []) : []);
    }
    return Promise.resolve([]);
  });
  return {
    get: get as unknown as jest.Mocked<IWooCommerceHttpClient>['get'],
    post: jest.fn().mockResolvedValue({ id: 501, number: '501' }),
    put: jest.fn(),
    delete: jest.fn(),
  };
}

function makeSyncLock(): SyncLockPort {
  return {
    acquire: jest.fn().mockResolvedValue('token'),
    release: jest.fn().mockResolvedValue(true),
    extend: jest.fn().mockResolvedValue(true),
  };
}

function makeIdentifierMapping(): jest.Mocked<IdentifierMappingPort> {
  return {
    getOrCreateInternalId: jest.fn(),
    getOrCreateExactMapping: jest.fn(),
    getInternalId: jest.fn(),
    getExternalIds: jest.fn((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) {
        return Promise.resolve([
          { externalId: '7', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType },
        ]);
      }
      if (entityType === CORE_ENTITY_TYPE.Product) {
        const externalId = id === 'ol-prod-food' ? '43' : '42';
        return Promise.resolve([
          { externalId, connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType },
        ]);
      }
      return Promise.resolve([]);
    }),
    createMapping: jest.fn(),
    batchGetOrCreateInternalIds: jest.fn(),
    deleteMapping: jest.fn(),
    listExternalIdsByConnection: jest.fn(),
  };
}

/**
 * The address-reuse store, answering a reuse HIT so the address provisioner
 * adds no HTTP calls. Typed `never` at the call site: the repository port is
 * not part of the cross-context contract a plugin may import (#718/#722).
 */
function makeProjectionRepo(): unknown {
  return {
    findDestinationAddressMapping: jest.fn(() =>
      Promise.resolve(
        new DestinationAddressMapping('ol-cust-1', CONNECTION_ID, 'hash', 'billing', '7', new Date(), new Date()),
      ),
    ),
    upsertDestinationAddressMapping: jest.fn((m: unknown) => Promise.resolve(m)),
  };
}

function makeAdapter(httpClient: jest.Mocked<IWooCommerceHttpClient>): WooCommerceOrderProcessorAdapter {
  const syncLock = makeSyncLock();
  return new WooCommerceOrderProcessorAdapter(
    httpClient,
    makeIdentifierMapping(),
    connection,
    new WooCommerceCustomerProvisioner(syncLock),
    new WooCommerceAddressProvisioner(syncLock),
    makeProjectionRepo() as never,
  );
}

function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    productId: 'ol-prod-1',
    quantity: 1,
    price: 123,
    name: 'Camera',
    taxRate: '23',
    ...overrides,
  };
}

function order(items: OrderItem[], shipping = 0): OrderCreate {
  const goods = items.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return {
    status: 'processing',
    customerId: 'ol-cust-1',
    items,
    totals: { subtotal: goods, tax: 0, shipping, total: goods + shipping, currency: 'PLN' },
    shippingAddress: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      address1: 'ul. Kwiatowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
    metadata: { buyerEmail: 'jan@example.com' },
  };
}

function sentPayload(httpClient: jest.Mocked<IWooCommerceHttpClient>): WooCommerceOrderCreateRequest {
  const call = httpClient.post.mock.calls.find(([path]) => path === '/wp-json/wc/v3/orders');
  if (!call) throw new Error('no order POST');
  return call[1] as WooCommerceOrderCreateRequest;
}

describe('WooCommerceOrderProcessorAdapter — tax class (#3505)', () => {
  it('should pin the standard class as an empty tax_class when taxes are on', async () => {
    const httpClient = makeHttpClient('yes');

    await makeAdapter(httpClient).createOrder(order([item()]));

    expect(sentPayload(httpClient).line_items[0].tax_class).toBe('');
  });

  it('should pin the reduced-rate class on a 5% line when taxes are on', async () => {
    const httpClient = makeHttpClient('yes');

    await makeAdapter(httpClient).createOrder(
      order([item({ productId: 'ol-prod-food', price: 10.5, taxRate: '5' })]),
    );

    expect(sentPayload(httpClient).line_items[0]).toEqual(
      expect.objectContaining({ product_id: 43, tax_class: 'reduced-rate', total: '10.00' }),
    );
  });

  it('should leave the payload without tax_class or fee_lines when taxes are off', async () => {
    const httpClient = makeHttpClient('no');

    await makeAdapter(httpClient).createOrder(
      order([item(), item({ id: 'item-2', productId: 'ol-prod-food', price: 10.5, taxRate: '5' })], 12.3),
    );

    const payload = sentPayload(httpClient);
    expect(payload.line_items.every((line) => !('tax_class' in line))).toBe(true);
    expect(payload).not.toHaveProperty('fee_lines');
    expect(payload.shipping_lines).toHaveLength(2);
  });

  it('should refuse the order when no tax class gives the line rate', async () => {
    const httpClient = makeHttpClient('yes');

    await expect(
      makeAdapter(httpClient).createOrder(order([item({ taxRate: '8' })])),
    ).rejects.toThrow(WooCommerceOrderProcessingException);
    expect(httpClient.post).not.toHaveBeenCalledWith('/wp-json/wc/v3/orders', expect.anything());
  });

  it('should book a mixed-rate shipping charge as one taxable fee line per rate', async () => {
    const httpClient = makeHttpClient('yes');

    await makeAdapter(httpClient).createOrder(
      order([item(), item({ id: 'item-2', productId: 'ol-prod-food', price: 123, taxRate: '5' })], 20),
    );

    const payload = sentPayload(httpClient);
    expect(payload).not.toHaveProperty('shipping_lines');
    expect(payload.fee_lines).toHaveLength(2);
    expect(payload.fee_lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tax_class: '', tax_status: 'taxable', total: '8.13' }),
        expect.objectContaining({ tax_class: 'reduced-rate', tax_status: 'taxable', total: '9.52' }),
      ]),
    );
  });

  it('should keep a single-rate shipping charge as an ordinary shipping line when taxes are on', async () => {
    const httpClient = makeHttpClient('yes');

    await makeAdapter(httpClient).createOrder(order([item()], 12.3));

    const payload = sentPayload(httpClient);
    expect(payload).not.toHaveProperty('fee_lines');
    expect(payload.shipping_lines).toEqual([
      expect.objectContaining({ method_id: 'flat_rate', total: '10.00' }),
    ]);
  });
});
