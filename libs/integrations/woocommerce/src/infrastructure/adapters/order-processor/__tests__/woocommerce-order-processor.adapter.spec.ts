/**
 * WooCommerce Order Processor Adapter — unit tests
 *
 * Mocks IWooCommerceHttpClient and IdentifierMappingPort.
 * All helpers (isValidEmail, toPositiveInt, WC_ORDER_STATUS_MAP) are tested
 * via direct import — no adapter instantiation needed for pure-function coverage.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor/__tests__
 */
import {
  WooCommerceOrderProcessorAdapter,
  isValidEmail,
  toPositiveInt,
} from '../woocommerce-order-processor.adapter';
import { WC_ORDER_STATUS_MAP } from '../woocommerce-order.types';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE, DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import type { OrderCreate, OrderItem } from '@openlinker/core/orders';
import { WooCommerceResourceNotFoundException } from '../../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceOrderProcessingException } from '../../../../domain/exceptions/woocommerce-order-processing.exception';
import { WooCommerceInvalidArgumentException } from '../../../../domain/exceptions/woocommerce-invalid-argument.exception';
import { WooCommerceAuthFailureException } from '../../../../domain/exceptions/woocommerce-auth-failure.exception';
import { WooCommerceHttpResponseException } from '../../../http/woocommerce-http-response.exception';
import { WooCommerceUnauthorizedException } from '../../../../domain/exceptions/woocommerce-unauthorized.exception';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const CONNECTION_ID = 'conn-wc-001';

const mockConnection: Connection = {
  id: CONNECTION_ID,
  platformType: 'woocommerce',
  name: 'Test WC Store',
  status: 'active',
  config: { siteUrl: 'https://myshop.com' } as Record<string, unknown>,
  credentialsRef: 'cred-ref-001',
  adapterKey: 'woocommerce.restapi.v3',
  enabledCapabilities: ['OrderProcessorManager'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeHttpClient(): jest.Mocked<IWooCommerceHttpClient> {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
}

function makeIdentifierMapping(): jest.Mocked<IdentifierMappingPort> {
  return {
    getOrCreateInternalId: jest.fn(),
    getOrCreateExactMapping: jest.fn(),
    getInternalId: jest.fn(),
    getExternalIds: jest.fn(),
    createMapping: jest.fn(),
    batchGetOrCreateInternalIds: jest.fn(),
    deleteMapping: jest.fn(),
    listExternalIdsByConnection: jest.fn(),
  };
}

function makeAdapter(
  httpClient: jest.Mocked<IWooCommerceHttpClient>,
  identifierMapping: jest.Mocked<IdentifierMappingPort>,
): WooCommerceOrderProcessorAdapter {
  return new WooCommerceOrderProcessorAdapter(httpClient, identifierMapping, mockConnection);
}

function makeOrder(overrides: Partial<OrderCreate> = {}): OrderCreate {
  const item: OrderItem = {
    id: 'item-1',
    productId: 'ol-prod-1',
    quantity: 2,
    price: 19.99,
    name: 'Test Product',
  };
  return {
    status: 'processing',
    customerId: 'ol-cust-1',
    items: [item],
    totals: { subtotal: 39.98, tax: 0, shipping: 5.00, total: 44.98, currency: 'PLN' },
    billingAddress: {
      firstName: 'Jan', lastName: 'Kowalski',
      address1: 'ul. Kwiatowa 1', city: 'Warszawa',
      postalCode: '00-001', country: 'PL',
    },
    shippingAddress: {
      firstName: 'Jan', lastName: 'Kowalski',
      address1: 'ul. Kwiatowa 1', city: 'Warszawa',
      postalCode: '00-001', country: 'PL',
    },
    metadata: {
      buyerEmail: 'jan.kowalski@example.com',
    },
    ...overrides,
  };
}

/**
 * Sets up minimal getExternalIds mock for tests that exercise the full createOrder
 * flow but focus on a specific payload assertion:
 *   Customer  → externalId '7' (skips WC customer provisioning)
 *   Product 'ol-prod-1' → externalId '42'
 */
function mockMinimalMappings(identifierMapping: jest.Mocked<IdentifierMappingPort>): void {
  identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
    if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
      return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
    }
    if (entityType === CORE_ENTITY_TYPE.Customer) {
      return [{ externalId: '7', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
    }
    return [];
  });
}

// ─── Pure function tests ───────────────────────────────────────────────────

describe('WC_ORDER_STATUS_MAP', () => {
  it('should map all six OL statuses to WC strings', () => {
    expect(WC_ORDER_STATUS_MAP.pending).toBe('pending');
    expect(WC_ORDER_STATUS_MAP.processing).toBe('processing');
    expect(WC_ORDER_STATUS_MAP.shipped).toBe('completed');
    expect(WC_ORDER_STATUS_MAP.delivered).toBe('completed');
    expect(WC_ORDER_STATUS_MAP.cancelled).toBe('cancelled');
    expect(WC_ORDER_STATUS_MAP.refunded).toBe('refunded');
  });

  it('should map shipped and delivered both to completed', () => {
    expect(WC_ORDER_STATUS_MAP.shipped).toBe(WC_ORDER_STATUS_MAP.delivered);
  });
});

describe('toPositiveInt', () => {
  it('should return the integer for a valid numeric string', () => {
    expect(toPositiveInt('42', 'Product', 'prod-1', CONNECTION_ID)).toBe(42);
  });

  it.each(['0', '-1', 'abc', '', 'NaN', '1.5'])(
    'should throw WooCommerceResourceNotFoundException for "%s"',
    (value) => {
      expect(() => toPositiveInt(value, 'Product', 'prod-1', CONNECTION_ID))
        .toThrow(WooCommerceResourceNotFoundException);
    },
  );
});

describe('isValidEmail', () => {
  it.each(['a@b.com', 'user@example.org', 'name+tag@domain.co'])('returns true for %s', (v) => {
    expect(isValidEmail(v)).toBe(true);
  });

  it.each([42, null, undefined, 'not-email', '@', 'a@', '@b.com'])('returns false for %s', (v) => {
    expect(isValidEmail(v)).toBe(false);
  });
});

// ─── createOrder ───────────────────────────────────────────────────────────

describe('WooCommerceOrderProcessorAdapter — createOrder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create order unconditionally and return WC native id', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 99, number: 'WC-99' });

    const adapter = makeAdapter(httpClient, identifierMapping);
    const result = await adapter.createOrder(makeOrder());

    expect(httpClient.post).toHaveBeenCalledWith('/wp-json/wc/v3/orders', expect.any(Object));
    // B2: orderId must be WC-native id (String(raw.id)), not internal OL id
    expect(result.orderId).toBe('99');
    expect(result.orderNumber).toBe('WC-99');
  });

  it('should POST to /wp-json/wc/v3/orders with correct payload', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    // Customer mapping: no existing → provision new
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) return [];
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') return { id: 10, email: 'jan.kowalski@example.com' };
      return { id: 99, number: 'WC-99' };
    });

    const adapter = makeAdapter(httpClient, identifierMapping);
    const result = await adapter.createOrder(makeOrder());

    expect(httpClient.post).toHaveBeenCalledWith(
      '/wp-json/wc/v3/orders',
      expect.objectContaining({
        status: 'processing',
        line_items: expect.arrayContaining([expect.objectContaining({ product_id: 42 })]),
      }),
    );
    // B2: orderId is WC-native id
    expect(result.orderId).toBe('99');
    // B3: adapter does NOT write identifier mapping — that is OrderSyncService's responsibility
    expect(identifierMapping.createMapping).not.toHaveBeenCalledWith(
      CORE_ENTITY_TYPE.Order, expect.any(String), expect.any(String), expect.any(String),
    );
  });

  it('should NOT check for existing order mapping before creating (no adapter-side idempotency check)', async () => {
    // B3: the adapter must NOT do a skip-check via getExternalIds for Order entity
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    // getExternalIds returns an Order mapping — adapter should still call POST, not return early
    identifierMapping.getExternalIds.mockImplementation((entityType: string) => {
      if (entityType === CORE_ENTITY_TYPE.Order) {
        return [{ externalId: '55', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      if (entityType === CORE_ENTITY_TYPE.Product) {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      if (entityType === CORE_ENTITY_TYPE.Customer) {
        return [{ externalId: '7', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockResolvedValue({ id: 99, number: 'WC-99' });

    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());

    // Adapter creates unconditionally, regardless of any existing OL order mapping
    expect(httpClient.post).toHaveBeenCalledWith('/wp-json/wc/v3/orders', expect.any(Object));
  });

  it('should include _ol_order_id in meta_data when metadata.internalOrderId is present', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ metadata: { buyerEmail: 'jan.kowalski@example.com', internalOrderId: 'ol-order-abc123' } }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).meta_data).toContainEqual({ key: '_ol_order_id', value: 'ol-order-abc123' });
  });

  it('should omit meta_data when metadata.internalOrderId is absent', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    // No internalOrderId in metadata — adapter should still create the order
    await adapter.createOrder(makeOrder({ metadata: { buyerEmail: 'jan.kowalski@example.com' } }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).meta_data).toBeUndefined();
  });

  it('should create order even when no metadata is provided (B1: no guard on internalOrderId)', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 55 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    // No metadata at all — adapter must not throw
    const result = await adapter.createOrder(makeOrder({ metadata: undefined }));
    expect(result.orderId).toBe('55');
    expect(httpClient.post).toHaveBeenCalledWith('/wp-json/wc/v3/orders', expect.any(Object));
  });

  it('should set billing.email from metadata.buyerEmail when valid', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ items: [{ id: 'i1', productId: 'ol-prod-1', quantity: 1, price: 10 }], metadata: { buyerEmail: 'user@example.com' } }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).billing).toMatchObject({ email: 'user@example.com' });
  });

  it('should omit billing.email when metadata.buyerEmail is absent', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ metadata: {} }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).billing).not.toHaveProperty('email');
  });

  it('should omit billing.email when metadata.buyerEmail is invalid format', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ metadata: { buyerEmail: 'not-an-email' } }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).billing).not.toHaveProperty('email');
  });

  it('should set status: completed when OL status is shipped', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ status: 'shipped' }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).status).toBe('completed');
  });

  it('should set status: cancelled when OL status is cancelled', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ status: 'cancelled' }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).status).toBe('cancelled');
  });

  it('should include shipping_lines when totals.shipping > 0', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).shipping_lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ total: '5.00' })]),
    );
  });

  it('should omit shipping_lines when totals.shipping is 0', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' } }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).shipping_lines).toBeUndefined();
  });

  // ── Line item price pinning (B4) ──

  it('should send subtotal and total per line item (buyer-paid price pinning)', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    // item: price=19.99, quantity=2 → subtotal='39.98', total='39.98'
    await adapter.createOrder(makeOrder());
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    const lineItems = (payload as Record<string, unknown>).line_items as Array<Record<string, unknown>>;
    expect(lineItems[0]).toMatchObject({ subtotal: '39.98', total: '39.98' });
    // price field must not be present (it is read-only in WC REST API)
    expect(lineItems[0]).not.toHaveProperty('price');
  });

  // ── Customer provisioning ──

  it('should use mapped WC customer_id when identifier mapping exists', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer && id === 'ol-cust-1') {
        return [{ externalId: '7', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      if (entityType === CORE_ENTITY_TYPE.Product) {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockResolvedValue({ id: 99 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).customer_id).toBe(7);
  });

  it('should provision new WC customer via POST when no mapping exists and buyerEmail valid', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') return { id: 15 };
      return { id: 99 };
    });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());
    expect(httpClient.post).toHaveBeenCalledWith(
      '/wp-json/wc/v3/customers',
      expect.objectContaining({ email: 'jan.kowalski@example.com' }),
    );
    expect(identifierMapping.createMapping).toHaveBeenCalledWith(
      CORE_ENTITY_TYPE.Customer, '15', CONNECTION_ID, 'ol-cust-1',
    );
  });

  it('should fall back to existing WC customer on 400 duplicate-email', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') throw new WooCommerceHttpResponseException(400, 'email exists');
      return { id: 99 };
    });
    httpClient.get.mockResolvedValue([{ id: 22, email: 'jan.kowalski@example.com' }]);
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());
    expect(httpClient.get).toHaveBeenCalledWith('/wp-json/wc/v3/customers', { email: 'jan.kowalski@example.com' });
    expect(identifierMapping.createMapping).toHaveBeenCalledWith(
      CORE_ENTITY_TYPE.Customer, '22', CONNECTION_ID, 'ol-cust-1',
    );
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).customer_id).toBe(22);
  });

  it('should use guest (0) when 400 duplicate-email but GET returns no match', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') throw new WooCommerceHttpResponseException(400, 'email exists');
      return { id: 99 };
    });
    httpClient.get.mockResolvedValue([]);
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).customer_id).toBe(0);
  });

  it('should throw WooCommerceAuthFailureException when WC customer POST fails with 401 (I1)', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') {
        throw new WooCommerceUnauthorizedException('401 Unauthorized');
      }
      return { id: 99 };
    });
    const adapter = makeAdapter(httpClient, identifierMapping);
    // Auth failure must NOT be swallowed into a guest order — it must propagate
    await expect(adapter.createOrder(makeOrder())).rejects.toBeInstanceOf(WooCommerceAuthFailureException);
    expect(httpClient.post).not.toHaveBeenCalledWith('/wp-json/wc/v3/orders', expect.any(Object));
  });

  it('should use guest (0) when WC customer POST fails with non-400 non-auth error', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') throw new WooCommerceHttpResponseException(500, 'server error');
      return { id: 99 };
    });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).customer_id).toBe(0);
  });

  it('should use guest (0) when buyerEmail is absent (warn log)', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockResolvedValue({ id: 99 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ metadata: {} }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).customer_id).toBe(0);
  });

  it('should use guest (0) when Customer mapping externalId is corrupted', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer && id === 'ol-cust-1') {
        return [{ externalId: 'abc', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockResolvedValue({ id: 99 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).customer_id).toBe(0);
  });

  it('should handle DuplicateIdentifierMappingError on Customer createMapping — return winner', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    let callCount = 0;
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      if (entityType === CORE_ENTITY_TYPE.Customer) {
        callCount++;
        if (callCount >= 2) {
          // Second lookup — winner lookup after duplicate
          return [{ externalId: '30', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
        }
      }
      return [];
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') return { id: 30 };
      return { id: 99 };
    });
    identifierMapping.createMapping.mockImplementation((entityType: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) throw new DuplicateIdentifierMappingError('Customer', '30', 'woocommerce', CONNECTION_ID);
    });
    const adapter = makeAdapter(httpClient, identifierMapping);
    const result = await adapter.createOrder(makeOrder());
    // orderId is WC native id
    expect(result.orderId).toBe('99');
  });

  it('should use guest (0) when Customer DuplicateIdentifierMappingError and no winner found', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') return { id: 30 };
      return { id: 99 };
    });
    identifierMapping.createMapping.mockImplementation((entityType: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) throw new DuplicateIdentifierMappingError('Customer', '30', 'woocommerce', CONNECTION_ID);
    });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder());
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).customer_id).toBe(0);
  });

  it('should use guest (0) when order.customerId is undefined', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockResolvedValue({ id: 99 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ customerId: undefined }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).customer_id).toBe(0);
  });

  // ── Line item resolution ──

  it('should resolve product_id and variation_id from identifier mapping', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    const itemWithVariant: OrderItem = { id: 'i1', productId: 'ol-prod-1', variantId: 'ol-var-1', quantity: 1, price: 10 };
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) return [];
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      if (entityType === CORE_ENTITY_TYPE.ProductVariant && id === 'ol-var-1') {
        return [{ externalId: '101', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    httpClient.post.mockResolvedValue({ id: 99 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ items: [itemWithVariant] }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).line_items).toContainEqual(
      expect.objectContaining({ product_id: 42, variation_id: 101 }),
    );
  });

  it('should throw WooCommerceResourceNotFoundException when product mapping missing', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    // Return [] for all lookups — no Product mapping.
    // customerId: undefined so customer provisioning is skipped (avoids unmocked POST /customers).
    identifierMapping.getExternalIds.mockResolvedValue([]);
    const adapter = makeAdapter(httpClient, identifierMapping);
    await expect(adapter.createOrder(makeOrder({ customerId: undefined }))).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('should throw WooCommerceResourceNotFoundException when variant mapping missing', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    const itemWithVariant: OrderItem = { id: 'i1', productId: 'ol-prod-1', variantId: 'ol-var-missing', quantity: 1, price: 10 };
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await expect(adapter.createOrder(makeOrder({ items: [itemWithVariant] }))).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
  });

  it('should throw WooCommerceResourceNotFoundException when product externalId is "0" (corrupted)', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return [{ externalId: '0', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }];
      }
      return [];
    });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await expect(adapter.createOrder(makeOrder())).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
  });

  it('should throw WooCommerceOrderProcessingException when order.items is empty', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockResolvedValue([]);
    const adapter = makeAdapter(httpClient, identifierMapping);
    await expect(adapter.createOrder(makeOrder({ items: [] }))).rejects.toBeInstanceOf(WooCommerceOrderProcessingException);
  });
});

// ─── updateFulfillment ─────────────────────────────────────────────────────

describe('WooCommerceOrderProcessorAdapter — updateFulfillment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should PUT to /wp-json/wc/v3/orders/{id} with correct WC status', async () => {
    const httpClient = makeHttpClient();
    httpClient.put.mockResolvedValue({ id: 55, status: 'completed' });
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());
    await adapter.updateFulfillment({ externalOrderId: '55', status: 'shipped' });
    expect(httpClient.put).toHaveBeenCalledWith(
      '/wp-json/wc/v3/orders/55',
      { status: 'completed' },
    );
  });

  it('should throw WooCommerceResourceNotFoundException when WC returns 404', async () => {
    const httpClient = makeHttpClient();
    httpClient.put.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());
    await expect(
      adapter.updateFulfillment({ externalOrderId: '55', status: 'shipped' }),
    ).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
  });

  it.each(['1/refunds', 'abc', '', '-1'])(
    'should throw WooCommerceInvalidArgumentException for non-numeric externalOrderId "%s" (GREEN: validation exception not ResourceNotFound)',
    async (id) => {
      const adapter = makeAdapter(makeHttpClient(), makeIdentifierMapping());
      await expect(
        adapter.updateFulfillment({ externalOrderId: id, status: 'cancelled' }),
      ).rejects.toBeInstanceOf(WooCommerceInvalidArgumentException);
    },
  );

  it('should accept trackingNumber without error and not send it to WC', async () => {
    const httpClient = makeHttpClient();
    httpClient.put.mockResolvedValue({ id: 55 });
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());
    await expect(
      adapter.updateFulfillment({ externalOrderId: '55', status: 'shipped', trackingNumber: 'TRACK123' }),
    ).resolves.toBeUndefined();
    const [, payload] = httpClient.put.mock.calls[0];
    expect(payload).not.toHaveProperty('tracking_number');
  });
});
