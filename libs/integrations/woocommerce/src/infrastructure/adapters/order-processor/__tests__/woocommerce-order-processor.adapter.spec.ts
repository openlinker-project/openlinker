/**
 * WooCommerce Order Processor Adapter — unit tests
 *
 * Mocks IWooCommerceHttpClient and IdentifierMappingPort.
 * Pure helpers (isValidEmail, WC_ORDER_STATUS_MAP) and the shared
 * `toPositiveInt` coercion are tested via direct import — no adapter
 * instantiation needed for pure-function coverage.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor/__tests__
 */
import {
  WooCommerceOrderProcessorAdapter,
  isValidEmail,
} from '../woocommerce-order-processor.adapter';
import { toPositiveInt } from '../../../utils/woocommerce-utils';
import { WC_ORDER_STATUS_MAP, WC_ORDER_STATUS_VALUES } from '../woocommerce-order.types';
import { isOrderStatusWriteback, isDestinationOptionsReader } from '@openlinker/core/orders';
import { WC_ORDER_STATUS_LABELS } from '../woocommerce-options.types';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE, DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import type {
  OrderCreate,
  OrderItem,
  OrderStatus,
  OrderLifecycleEvent,
} from '@openlinker/core/orders';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import { Logger } from '@openlinker/shared/logging';
import { DestinationAddressMapping } from '@openlinker/core/customers';
import type { SyncLockPort } from '@openlinker/core/sync';
import { WooCommerceCustomerProvisioner } from '../../../provisioners/woocommerce-customer-provisioner';
import { WooCommerceAddressProvisioner } from '../../../provisioners/woocommerce-address-provisioner';
import { WooCommerceResourceNotFoundException } from '../../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceInvalidIdentifierException } from '../../../../domain/exceptions/woocommerce-invalid-identifier.exception';
import { WooCommerceOrderProcessingException } from '../../../../domain/exceptions/woocommerce-order-processing.exception';
import { WooCommerceOrderCreateAmbiguousException } from '../../../../domain/exceptions/woocommerce-order-create-ambiguous.exception';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import { WooCommerceInvalidArgumentException } from '../../../../domain/exceptions/woocommerce-invalid-argument.exception';
import { WooCommerceAuthFailureException } from '../../../../domain/exceptions/woocommerce-auth-failure.exception';
import { WooCommerceHttpResponseException } from '../../../http/woocommerce-http-response.exception';
import { WooCommerceUnauthorizedException } from '../../../../domain/exceptions/woocommerce-unauthorized.exception';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const CONNECTION_ID = 'conn-wc-001';

// Address reuse tracking hashes the address (getPiiConfig requires a salt).
const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;
beforeAll(() => {
  process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';
});
afterAll(() => {
  if (originalPiiHashSalt === undefined) delete process.env.OL_PII_HASH_SALT;
  else process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
});

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

/** In-memory SyncLockPort — single-holder-per-key, enough for the adapter tests. */
function makeSyncLock(): SyncLockPort {
  const locks = new Map<string, string>();
  return {
    acquire: jest.fn((key: string) => {
      if (locks.has(key)) return Promise.resolve(null);
      const token = `tok-${Math.random().toString(36).slice(2)}`;
      locks.set(key, token);
      return Promise.resolve(token);
    }),
    release: jest.fn((key: string, token: string) => {
      if (locks.get(key) === token) {
        locks.delete(key);
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }),
    extend: jest.fn((key: string, token: string) => Promise.resolve(locks.get(key) === token)),
  };
}

/**
 * Stub customer-projection repository. `findDestinationAddressMapping` returns a
 * reuse HIT by default so the address provisioner short-circuits and adds no HTTP
 * calls — these createOrder tests focus on customer + order-payload behaviour,
 * not address reuse (that has its own dedicated provisioner spec).
 */
function makeProjectionRepo(): jest.Mocked<CustomerProjectionRepositoryPort> {
  return {
    findById: jest.fn(),
    findByEmailHash: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    findAddressesByCustomerId: jest.fn(),
    upsertAddress: jest.fn(),
    findDestinationAddressMapping: jest.fn(() =>
      Promise.resolve(
        new DestinationAddressMapping('ol-cust-1', CONNECTION_ID, 'hash', 'billing', '7', new Date(), new Date()),
      ),
    ),
    upsertDestinationAddressMapping: jest.fn((m) => Promise.resolve(m)),
  } as unknown as jest.Mocked<CustomerProjectionRepositoryPort>;
}

function makeAdapter(
  httpClient: jest.Mocked<IWooCommerceHttpClient>,
  identifierMapping: jest.Mocked<IdentifierMappingPort>,
): WooCommerceOrderProcessorAdapter {
  const syncLock = makeSyncLock();
  return new WooCommerceOrderProcessorAdapter(
    httpClient,
    identifierMapping,
    mockConnection,
    new WooCommerceCustomerProvisioner(syncLock),
    new WooCommerceAddressProvisioner(syncLock),
    makeProjectionRepo(),
  );
}

function makeOrder(overrides: Partial<OrderCreate> = {}): OrderCreate {
  const item: OrderItem = {
    id: 'item-1',
    productId: 'ol-prod-1',
    quantity: 2,
    price: 19.99,
    name: 'Test Product',
    // #3470 — createOrder converts a gross-priced line to net using taxRate
    // when totals.taxTreatment is 'inclusive'/unset (the shared fixture's
    // default). '0' keeps every dollar-amount assertion in this file
    // unchanged (net === gross at 0%) while still exercising the real
    // conversion code path, rather than silently bypassing it.
    taxRate: '0',
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
      return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
    }
    if (entityType === CORE_ENTITY_TYPE.Customer) {
      return Promise.resolve([{ externalId: '7', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
    }
    return Promise.resolve([]);
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

describe('WC_ORDER_STATUS_VALUES', () => {
  it('should expose the WooCommerce core status vocabulary', () => {
    expect(WC_ORDER_STATUS_VALUES).toEqual([
      'pending',
      'processing',
      'on-hold',
      'completed',
      'cancelled',
      'refunded',
      'failed',
    ]);
  });

  it('should contain every value produced by the neutral → WC map', () => {
    for (const wcStatus of Object.values(WC_ORDER_STATUS_MAP)) {
      expect(WC_ORDER_STATUS_VALUES).toContain(wcStatus);
    }
  });
});

describe('toPositiveInt', () => {
  it('should return the integer for a valid numeric string', () => {
    expect(toPositiveInt('42', 'product id')).toBe(42);
  });

  it.each(['0', '-1', 'abc', '', 'NaN'])(
    'should throw WooCommerceInvalidIdentifierException for "%s"',
    (value) => {
      expect(() => toPositiveInt(value, 'product id'))
        .toThrow(WooCommerceInvalidIdentifierException);
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
      if (entityType === CORE_ENTITY_TYPE.Customer) return Promise.resolve([]);
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') return Promise.resolve({ id: 10, email: 'jan.kowalski@example.com' });
      return Promise.resolve({ id: 99, number: 'WC-99' });
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
        return Promise.resolve([{ externalId: '55', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      if (entityType === CORE_ENTITY_TYPE.Product) {
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      if (entityType === CORE_ENTITY_TYPE.Customer) {
        return Promise.resolve([{ externalId: '7', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
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
    await adapter.createOrder(makeOrder({ items: [{ id: 'i1', productId: 'ol-prod-1', quantity: 1, price: 10, taxRate: '0' }], metadata: { buyerEmail: 'user@example.com' } }));
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

  // ── set_paid gating (#2600 / #3471 — keyed on paymentStatus, never status alone) ──

  it('should set set_paid: true when paymentStatus is "paid"', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ status: 'processing', paymentStatus: 'paid' }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).set_paid).toBe(true);
  });

  it('should omit set_paid for a cash-on-delivery order even while "processing" (#3471)', async () => {
    // The regression #3471 exists to close: a COD order reaching 'processing'
    // must NOT be stamped set_paid — nothing has reached the seller yet.
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ status: 'processing', paymentStatus: 'cod' }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).set_paid).toBeUndefined();
  });

  it.each<Exclude<OrderCreate['paymentStatus'], 'paid'> | undefined>(['awaiting', 'refunded', undefined])(
    'should omit set_paid for paymentStatus=%s',
    async (paymentStatus) => {
      const httpClient = makeHttpClient();
      const identifierMapping = makeIdentifierMapping();
      mockMinimalMappings(identifierMapping);
      httpClient.post.mockResolvedValue({ id: 1 });
      const adapter = makeAdapter(httpClient, identifierMapping);
      await adapter.createOrder(makeOrder({ status: 'processing', paymentStatus }));
      const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
      expect((payload as Record<string, unknown>).set_paid).toBeUndefined();
    },
  );

  it.each<OrderStatus>(['pending', 'cancelled', 'refunded'])(
    'should omit set_paid for %s status when paymentStatus is absent',
    async (status) => {
      const httpClient = makeHttpClient();
      const identifierMapping = makeIdentifierMapping();
      mockMinimalMappings(identifierMapping);
      httpClient.post.mockResolvedValue({ id: 1 });
      const adapter = makeAdapter(httpClient, identifierMapping);
      await adapter.createOrder(makeOrder({ status }));
      const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
      expect((payload as Record<string, unknown>).set_paid).toBeUndefined();
    },
  );

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
        return Promise.resolve([{ externalId: '7', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      if (entityType === CORE_ENTITY_TYPE.Product) {
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') return Promise.resolve({ id: 15 });
      return Promise.resolve({ id: 99 });
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') throw new WooCommerceHttpResponseException(400, 'email exists');
      return Promise.resolve({ id: 99 });
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') throw new WooCommerceHttpResponseException(400, 'email exists');
      return Promise.resolve({ id: 99 });
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') {
        throw new WooCommerceUnauthorizedException('401 Unauthorized');
      }
      return Promise.resolve({ id: 99 });
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') throw new WooCommerceHttpResponseException(500, 'server error');
      return Promise.resolve({ id: 99 });
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
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
        return Promise.resolve([{ externalId: 'abc', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      if (entityType === CORE_ENTITY_TYPE.Customer) {
        callCount++;
        if (callCount >= 2) {
          // Second lookup — winner lookup after duplicate
          return Promise.resolve([{ externalId: '30', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
        }
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') return Promise.resolve({ id: 30 });
      return Promise.resolve({ id: 99 });
    });
    identifierMapping.createMapping.mockImplementation((entityType: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) throw new DuplicateIdentifierMappingError('Customer', '30', 'woocommerce', CONNECTION_ID);
      return Promise.resolve();
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockImplementation((path) => {
      if (path === '/wp-json/wc/v3/customers') return Promise.resolve({ id: 30 });
      return Promise.resolve({ id: 99 });
    });
    identifierMapping.createMapping.mockImplementation((entityType: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) throw new DuplicateIdentifierMappingError('Customer', '30', 'woocommerce', CONNECTION_ID);
      return Promise.resolve();
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
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
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
    const itemWithVariant: OrderItem = { id: 'i1', productId: 'ol-prod-1', variantId: 'ol-var-1', quantity: 1, price: 10, taxRate: '0' };
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) return Promise.resolve([]);
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      if (entityType === CORE_ENTITY_TYPE.ProductVariant && id === 'ol-var-1') {
        return Promise.resolve([{ externalId: '101', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockResolvedValue({ id: 99 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ items: [itemWithVariant] }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).line_items).toContainEqual(
      expect.objectContaining({ product_id: 42, variation_id: 101 }),
    );
  });

  it('should omit variation_id when the variant is a synthetic simple-product variant (product:{id})', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    const itemWithSyntheticVariant: OrderItem = { id: 'i1', productId: 'ol-prod-1', variantId: 'ol-var-synth', quantity: 2, price: 49.99, taxRate: '0' };
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Customer) return Promise.resolve([]);
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return Promise.resolve([{ externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      if (entityType === CORE_ENTITY_TYPE.ProductVariant && id === 'ol-var-synth') {
        return Promise.resolve([{ externalId: 'product:10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockResolvedValue({ id: 99 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ items: [itemWithSyntheticVariant] }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    const lineItems = (payload as { line_items: Array<Record<string, unknown>> }).line_items;
    expect(lineItems).toContainEqual(expect.objectContaining({ product_id: 10 }));
    expect(lineItems[0]).not.toHaveProperty('variation_id');
  });

  it('should omit nullish address fields instead of sending null (WC rejects non-string address props)', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product) {
        return Promise.resolve([{ externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    httpClient.post.mockResolvedValue({ id: 99 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(
      makeOrder({
        customerId: undefined,
        billingAddress: undefined,
        shippingAddress: {
          firstName: 'Norbert',
          lastName: 'Kulus',
          company: null as unknown as string,
          address1: 'taj as 2',
          city: 'Gietrzwałd',
          postalCode: '11-036',
          country: 'PL',
          phone: '+48510033555',
        },
      }),
    );
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    const shipping = (payload as { shipping: Record<string, unknown> }).shipping;
    expect(shipping).not.toHaveProperty('company');
    expect(shipping).not.toHaveProperty('state');
    expect(shipping).toMatchObject({ first_name: 'Norbert', city: 'Gietrzwałd', country: 'PL' });
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
    const itemWithVariant: OrderItem = { id: 'i1', productId: 'ol-prod-1', variantId: 'ol-var-missing', quantity: 1, price: 10, taxRate: '0' };
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return Promise.resolve([{ externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
    });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await expect(adapter.createOrder(makeOrder({ items: [itemWithVariant] }))).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
  });

  it('should throw WooCommerceResourceNotFoundException when product externalId is "0" (corrupted)', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) => {
      if (entityType === CORE_ENTITY_TYPE.Product && id === 'ol-prod-1') {
        return Promise.resolve([{ externalId: '0', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType }]);
      }
      return Promise.resolve([]);
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

  // ── currency (#3470) ──

  it('should send currency on the create payload', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(makeOrder({ totals: { subtotal: 39.98, tax: 0, shipping: 5, total: 44.98, currency: 'EUR' } }));
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    expect((payload as Record<string, unknown>).currency).toBe('EUR');
  });

  it('should refuse to create an order with an empty currency, before any WC write', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    const adapter = makeAdapter(httpClient, identifierMapping);
    await expect(
      adapter.createOrder(makeOrder({ totals: { subtotal: 39.98, tax: 0, shipping: 5, total: 44.98, currency: '' } })),
    ).rejects.toBeInstanceOf(WooCommerceOrderProcessingException);
    expect(httpClient.post).not.toHaveBeenCalled();
    expect(identifierMapping.getExternalIds).not.toHaveBeenCalled();
  });

  // ── tax treatment (#3470) ──

  it('should convert a gross-priced line to net using the line taxRate when inclusive/unset', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    // price=19.99, quantity=2 → gross 39.98; taxRate 23% → net 39.98/1.23 = 32.50
    await adapter.createOrder(
      makeOrder({
        items: [{ id: 'i1', productId: 'ol-prod-1', quantity: 2, price: 19.99, taxRate: '23' }],
      }),
    );
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    const lineItems = (payload as { line_items: Array<Record<string, unknown>> }).line_items;
    expect(lineItems[0]).toMatchObject({ subtotal: '32.50', total: '32.50' });
  });

  it('should pin the net price as-is (no conversion) when taxTreatment is exclusive', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(
      makeOrder({
        totals: { subtotal: 39.98, tax: 0, shipping: 5, total: 44.98, currency: 'PLN', taxTreatment: 'exclusive' },
        // No taxRate needed for an exclusive (already-net) order — must not throw.
        items: [{ id: 'i1', productId: 'ol-prod-1', quantity: 2, price: 19.99 }],
      }),
    );
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    const lineItems = (payload as { line_items: Array<Record<string, unknown>> }).line_items;
    expect(lineItems[0]).toMatchObject({ subtotal: '39.98', total: '39.98' });
  });

  it('should throw rather than create an order when a gross line has no resolvable tax rate', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    const adapter = makeAdapter(httpClient, identifierMapping);
    await expect(
      adapter.createOrder(
        makeOrder({
          items: [{ id: 'i1', productId: 'ol-prod-1', quantity: 2, price: 19.99 }],
        }),
      ),
    ).rejects.toBeInstanceOf(WooCommerceOrderProcessingException);
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('should treat a non-numeric exemption tax code (zw) as a 0% rate, not unknown', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const adapter = makeAdapter(httpClient, identifierMapping);
    await adapter.createOrder(
      makeOrder({
        items: [{ id: 'i1', productId: 'ol-prod-1', quantity: 2, price: 19.99, taxRate: 'zw' }],
      }),
    );
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    const lineItems = (payload as { line_items: Array<Record<string, unknown>> }).line_items;
    expect(lineItems[0]).toMatchObject({ subtotal: '39.98', total: '39.98' });
  });

  // ── total reconciliation (#3470) ──

  it('should warn (not throw) when the booked total drifts from the buyer-paid total', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1, total: '50.00' });
    const adapter = makeAdapter(httpClient, identifierMapping);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // makeOrder()'s default total is 44.98 — the booked 50.00 diverges by > 0.01.
    const result = await adapter.createOrder(makeOrder());
    expect(result.orderId).toBe('1');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('total mismatch'));
    warnSpy.mockRestore();
  });

  it('should not warn when the booked total matches within rounding tolerance', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1, total: '44.98' });
    const adapter = makeAdapter(httpClient, identifierMapping);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await adapter.createOrder(makeOrder());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('total mismatch'));
    warnSpy.mockRestore();
  });

  // ── ambiguous create response (#3469) ──

  it('should throw WooCommerceOrderCreateAmbiguousException (not WooCommerceResourceNotFoundException) on a 2xx with no id', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({});
    const adapter = makeAdapter(httpClient, identifierMapping);
    await expect(adapter.createOrder(makeOrder())).rejects.toBeInstanceOf(WooCommerceOrderCreateAmbiguousException);
  });

  // ── carrier mapping (#3471) ──

  it('should resolve the shipping method_id via the configured carrier mapping', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const mappingConfigService = {
      resolveCarrierMapping: jest.fn().mockResolvedValue('local_pickup'),
    } as unknown as IMappingConfigService;
    const syncLock = makeSyncLock();
    const adapter = new WooCommerceOrderProcessorAdapter(
      httpClient,
      identifierMapping,
      mockConnection,
      new WooCommerceCustomerProvisioner(syncLock),
      new WooCommerceAddressProvisioner(syncLock),
      makeProjectionRepo(),
      mappingConfigService,
    );
    await adapter.createOrder(
      makeOrder({ source: { connectionId: 'src-conn-1' }, shipping: { methodId: 'allegro-courier' } }),
    );
    expect(mappingConfigService.resolveCarrierMapping).toHaveBeenCalledWith('src-conn-1', 'allegro-courier');
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    const shippingLines = (payload as { shipping_lines: Array<Record<string, unknown>> }).shipping_lines;
    expect(shippingLines[0]).toMatchObject({ method_id: 'local_pickup' });
  });

  it('should fall back to flat_rate when no carrier mapping is configured', async () => {
    const httpClient = makeHttpClient();
    const identifierMapping = makeIdentifierMapping();
    mockMinimalMappings(identifierMapping);
    httpClient.post.mockResolvedValue({ id: 1 });
    const mappingConfigService = {
      resolveCarrierMapping: jest.fn().mockResolvedValue(null),
    } as unknown as IMappingConfigService;
    const syncLock = makeSyncLock();
    const adapter = new WooCommerceOrderProcessorAdapter(
      httpClient,
      identifierMapping,
      mockConnection,
      new WooCommerceCustomerProvisioner(syncLock),
      new WooCommerceAddressProvisioner(syncLock),
      makeProjectionRepo(),
      mappingConfigService,
    );
    await adapter.createOrder(
      makeOrder({ source: { connectionId: 'src-conn-1' }, shipping: { methodId: 'unmapped-method' } }),
    );
    const [, payload] = httpClient.post.mock.calls.find(([p]) => p === '/wp-json/wc/v3/orders') ?? [];
    const shippingLines = (payload as { shipping_lines: Array<Record<string, unknown>> }).shipping_lines;
    expect(shippingLines[0]).toMatchObject({ method_id: 'flat_rate' });
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

// ─── OrderStatusWriteback (write) ────────────────────────────────────────────

describe('WooCommerceOrderProcessorAdapter — OrderStatusWriteback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should be detected by the isOrderStatusWriteback guard', () => {
    const adapter = makeAdapter(makeHttpClient(), makeIdentifierMapping());
    expect(isOrderStatusWriteback(adapter)).toBe(true);
  });

  // ── dispatched ──

  it('should read the order then PUT status completed for a dispatched event', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: 55, status: 'processing' });
    httpClient.put.mockResolvedValue({ id: 55, status: 'completed' });
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());

    const result = await adapter.write({ type: 'dispatched', externalOrderId: '55' });

    expect(httpClient.get).toHaveBeenCalledWith('/wp-json/wc/v3/orders/55');
    expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/orders/55', { status: 'completed' });
    expect(result).toEqual({ outcome: 'applied' });
  });

  it.each(['cancelled', 'refunded'])(
    'should reject a dispatch writeback when WC is already %s (no PUT, #3471)',
    async (currentStatus) => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue({ id: 55, status: currentStatus });
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      const result = await adapter.write({ type: 'dispatched', externalOrderId: '55' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain(currentStatus);
      expect(httpClient.put).not.toHaveBeenCalled();
    },
  );

  it('should skip the PUT and still report applied when WC already reports completed', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: 55, status: 'completed' });
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());

    const result = await adapter.write({ type: 'dispatched', externalOrderId: '55' });

    expect(result).toEqual({ outcome: 'applied' });
    expect(httpClient.put).not.toHaveBeenCalled();
  });

  it('should NOT report plain applied when a trackingNumber cannot be stored (#3471 / #1947)', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: 55, status: 'processing' });
    httpClient.put.mockResolvedValue({ id: 55, status: 'completed' });
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());

    const result = await adapter.write({
      type: 'dispatched',
      externalOrderId: '55',
      trackingNumber: 'TRACK123',
    });

    // The status write still applies — only the tracking write is unsupported.
    expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/orders/55', { status: 'completed' });
    const [, payload] = httpClient.put.mock.calls[0];
    expect(payload).not.toHaveProperty('tracking_number');
    expect(result.outcome).not.toBe('applied');
    expect(result).toEqual({ outcome: 'unsupported', detail: expect.any(String) });
  });

  // ── cancelled ──

  it('should read the order then PUT status cancelled for a cancelled event', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: 55, status: 'processing' });
    httpClient.put.mockResolvedValue({ id: 55, status: 'cancelled' });
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());

    const result = await adapter.write({ type: 'cancelled', externalOrderId: '55' });

    expect(httpClient.get).toHaveBeenCalledWith('/wp-json/wc/v3/orders/55');
    expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/orders/55', { status: 'cancelled' });
    expect(result).toEqual({ outcome: 'applied' });
  });

  it.each(['completed', 'refunded'])(
    'should reject a cancel writeback when WC is already %s (no PUT)',
    async (currentStatus) => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue({ id: 55, status: currentStatus });
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      const result = await adapter.write({ type: 'cancelled', externalOrderId: '55' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain(currentStatus);
      expect(httpClient.put).not.toHaveBeenCalled();
    },
  );

  it('should treat a cancel writeback as an idempotent no-op when already cancelled (no PUT)', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: 55, status: 'cancelled' });
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());

    const result = await adapter.write({ type: 'cancelled', externalOrderId: '55' });

    expect(result).toEqual({ outcome: 'applied' });
    expect(httpClient.put).not.toHaveBeenCalled();
  });

  // ── failure / validation ──

  it.each(['1/refunds', 'abc', '', '-1'])(
    'should reject (not throw) a non-numeric externalOrderId "%s"',
    async (id) => {
      const httpClient = makeHttpClient();
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      const result = await adapter.write({ type: 'cancelled', externalOrderId: id });

      expect(result.outcome).toBe('rejected');
      expect(httpClient.get).not.toHaveBeenCalled();
      expect(httpClient.put).not.toHaveBeenCalled();
    },
  );

  it('should return rejected (never throw) when the WC PUT fails', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: 55, status: 'processing' });
    httpClient.put.mockRejectedValue(new WooCommerceHttpResponseException(500, 'server error'));
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());

    const result = await adapter.write({ type: 'cancelled', externalOrderId: '55' });

    expect(result.outcome).toBe('rejected');
    expect(result.detail).toBeDefined();
  });

  // ── unknown member (never-default, #2286) ──
  //
  // Before the switch conversion an unrecognised member fell into the cancel
  // branch and could PUT `cancelled` onto a live shop order.
  it('should return unsupported for an unknown member without reading or writing', async () => {
    const httpClient = makeHttpClient();
    const adapter = makeAdapter(httpClient, makeIdentifierMapping());

    const result = await adapter.write({
      type: 'amended',
      externalOrderId: '55',
    } as unknown as OrderLifecycleEvent);

    expect(result.outcome).toBe('unsupported');
    expect(result.detail).toContain('amended');
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(httpClient.put).not.toHaveBeenCalled();
  });
});

// ─── DestinationOptionsReader (#472 / #1551) ────────────────────────────────

describe('WooCommerceOrderProcessorAdapter — DestinationOptionsReader', () => {
  it('should satisfy the isDestinationOptionsReader guard', () => {
    const adapter = makeAdapter(makeHttpClient(), makeIdentifierMapping());
    expect(isDestinationOptionsReader(adapter)).toBe(true);
  });

  describe('listOrderStatuses', () => {
    it('should return the full WC status vocabulary as neutral options with labels', async () => {
      const adapter = makeAdapter(makeHttpClient(), makeIdentifierMapping());

      const options = await adapter.listOrderStatuses();

      expect(options.length).toBeGreaterThan(0);
      expect(options).toContainEqual({ value: 'processing', label: 'Processing' });
      expect(options).toContainEqual({ value: 'on-hold', label: 'On hold' });
      // every option carries a non-empty label sourced from the shared label map
      for (const option of options) {
        expect(option.label).toBe(
          WC_ORDER_STATUS_LABELS[option.value as keyof typeof WC_ORDER_STATUS_LABELS],
        );
        expect(option.label.length).toBeGreaterThan(0);
      }
    });

    it('should not hit the network (static vocabulary)', async () => {
      const httpClient = makeHttpClient();
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      await adapter.listOrderStatuses();

      expect(httpClient.get).not.toHaveBeenCalled();
    });
  });

  describe('listPaymentMethods', () => {
    it('should map GET /payment_gateways rows to neutral options', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([
        { id: 'bacs', title: 'Direct bank transfer', enabled: true },
        { id: 'cod', title: 'Cash on delivery', enabled: false },
      ]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      const options = await adapter.listPaymentMethods();

      expect(httpClient.get).toHaveBeenCalledWith('/wp-json/wc/v3/payment_gateways');
      expect(options).toEqual([
        { value: 'bacs', label: 'Direct bank transfer' },
        { value: 'cod', label: 'Cash on delivery' },
      ]);
    });

    it('should fall back to the gateway id when title is missing', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 'paypal' }]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      const options = await adapter.listPaymentMethods();

      expect(options).toEqual([{ value: 'paypal', label: 'paypal' }]);
    });
  });

  describe('listCarriers', () => {
    it('should map GET /shipping_methods rows to neutral options', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([
        { id: 'flat_rate', title: 'Flat rate' },
        { id: 'free_shipping', title: 'Free shipping' },
        { id: 'local_pickup', title: 'Local pickup' },
      ]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      const options = await adapter.listCarriers();

      expect(httpClient.get).toHaveBeenCalledWith('/wp-json/wc/v3/shipping_methods');
      expect(options).toEqual([
        { value: 'flat_rate', label: 'Flat rate' },
        { value: 'free_shipping', label: 'Free shipping' },
        { value: 'local_pickup', label: 'Local pickup' },
      ]);
    });

    it('should fall back to the method id when title is missing', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 'flat_rate' }]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      const options = await adapter.listCarriers();

      expect(options).toEqual([{ value: 'flat_rate', label: 'flat_rate' }]);
    });

    it('should return an empty list when the store registers no shipping methods', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping());

      const options = await adapter.listCarriers();

      expect(options).toEqual([]);
    });
  });
});
