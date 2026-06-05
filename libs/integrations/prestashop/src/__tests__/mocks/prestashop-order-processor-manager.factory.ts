/**
 * PrestaShop Order Processor Manager — shared test harness factory
 *
 * Builds the fully-mocked `PrestashopOrderProcessorManagerAdapter` under test
 * plus its collaborating mocks, the test connection, an `OrderCreate` builder,
 * and the `createResource` dispatch helper. Extracted from the former
 * 2279-line `prestashop-order-processor-manager.adapter.spec.ts` (#976) so the
 * per-method spec files (create-order, create-order-resolution,
 * update-fulfillment, fulfillment-status) share one source of setup and no
 * single Jest worker holds the whole adapter's test state at once.
 *
 * Sole owner of the cross-context `CustomerProjectionRepositoryPort` import:
 * the split spec files read `mockCustomerProjectionRepository` off the typed
 * `OrderProcessorHarness` return (inferred), so only this file carries the
 * deny-pattern import (allow-listed in `scripts/check-cross-context-imports.mjs`).
 *
 * @module libs/integrations/prestashop/src/__tests__/mocks
 */
import { PrestashopOrderProcessorManagerAdapter } from '../../infrastructure/adapters/prestashop-order-processor-manager.adapter';
import { createMockHttpClient } from './mock-http-client.factory';
import { createMockIdentifierMapping } from './mock-identifier-mapping.factory';
import { createTestConnection } from '../fixtures/connection.fixture';
import type { IPrestashopWebserviceClient } from '../../infrastructure/http/prestashop-webservice.client.interface';
import type { IPrestashopOpenLinkerModuleClient } from '../../infrastructure/http/prestashop-openlinker-module.client.interface';
import type { IPrestashopOrderMapper } from '../../infrastructure/mappers/prestashop.mapper.interface';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { OrderCreate } from '@openlinker/core/orders';
import type { PrestashopCurrencyResolver } from '../../infrastructure/provisioners/prestashop-currency-resolver';
import type { PrestashopTaxRateResolver } from '../../infrastructure/provisioners/prestashop-tax-rate.resolver';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { PrestashopCustomerProvisioner } from '../../infrastructure/provisioners/prestashop-customer-provisioner';
import type { PrestashopAddressProvisioner } from '../../infrastructure/provisioners/prestashop-address-provisioner';

/**
 * The numeric `id_carrier` returned by the OL module's discovery row in
 * these tests. Picked so it doesn't collide with any other carrier id used
 * in the suite (#455 mapping tests use 4, fixture defaultCarrierId tests
 * use 7). Tests that need to assert the OL Dynamic fallback compare against
 * this constant.
 */
export const OL_DYNAMIC_CARRIER_ID = 99;

/**
 * The PrestaShop order-state id the order mapper maps `order.status` onto for
 * the `importOrder` (validateOrder) call (ADR-016 / #905). Asserted explicitly
 * on the happy path against the `idOrderState` field of the importOrder input.
 */
export const IMPORT_ORDER_STATE_ID = 2;

const METADATA_INTERNAL_ORDER_ID = 'ol_order_allegro_abc123';

export const createTestOrder = (overrides: Partial<OrderCreate> = {}): OrderCreate => ({
  orderNumber: 'TEST-ORDER-001',
  status: 'pending',
  customerId: 'internal-customer-123',
  metadata: { internalOrderId: METADATA_INTERNAL_ORDER_ID },
  items: [
    {
      id: 'item-1',
      productId: 'internal-product-456',
      variantId: 'internal-variant-789',
      quantity: 2,
      price: 29.99,
      sku: 'PROD-001-VAR-001',
    },
    {
      id: 'item-2',
      productId: 'internal-product-789',
      quantity: 1,
      price: 49.99,
      sku: 'PROD-002',
    },
  ],
  totals: {
    subtotal: 109.97,
    tax: 10.0,
    shipping: 5.0,
    total: 124.97,
    currency: 'EUR',
  },
  ...overrides,
});

/**
 * The composed test context: the adapter under test plus every collaborating
 * mock, the test connection, and the `createResource` dispatch helper.
 */
export interface OrderProcessorHarness {
  adapter: PrestashopOrderProcessorManagerAdapter;
  mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  mockOrderMapper: jest.Mocked<IPrestashopOrderMapper>;
  mockCurrencyResolver: jest.Mocked<PrestashopCurrencyResolver>;
  mockTaxRateResolver: PrestashopTaxRateResolver;
  mockCustomerProjectionRepository: jest.Mocked<CustomerProjectionRepositoryPort>;
  mockCustomerProvisioner: jest.Mocked<PrestashopCustomerProvisioner>;
  mockAddressProvisioner: jest.Mocked<PrestashopAddressProvisioner>;
  mockOpenLinkerModuleClient: jest.Mocked<IPrestashopOpenLinkerModuleClient>;
  connection: ReturnType<typeof createTestConnection>;
  /**
   * Dispatch `createResource` by resource name so the order-creation flow's
   * intermediate `specific_prices` pins (#895) don't consume the cart/order
   * slots the way sequential `mockResolvedValueOnce` did.
   *
   * The order INSERT no longer goes through `createResource('orders')` —
   * it's the OL module's `importOrder` (validateOrder, ADR-016 / #905). The
   * `order` argument drives `importOrder`'s resolved `{ idOrder, reference }`
   * so existing happy-path assertions (createdOrder.id → idOrder,
   * createdOrder.reference → reference) keep their meaning.
   */
  setCreateResourceDispatch: (cart: unknown, order: unknown) => void;
}

/**
 * Build a fresh `OrderProcessorHarness`. Call once per test (in `beforeEach`)
 * so every test gets independent mocks and a freshly-constructed adapter.
 */
export function createOrderProcessorManagerHarness(): OrderProcessorHarness {
  const mockHttpClient = createMockHttpClient();
  const mockIdentifierMapping = createMockIdentifierMapping();
  const connection = createTestConnection();
  const mockOrderMapper = {
    mapOrder: jest.fn(),
    mapOrderCreate: jest.fn(),
    mapCartCreate: jest.fn().mockReturnValue({
      id_customer: '42',
      id_currency: 1,
      id_lang: 1,
      associations: {
        cart_rows: {
          cart_row: [],
        },
      },
    }),
    mapStatusToPrestashopStateId: jest.fn().mockReturnValue(IMPORT_ORDER_STATE_ID),
  } as unknown as jest.Mocked<IPrestashopOrderMapper>;

  const mockCurrencyResolver = {
    resolveCurrencyId: jest.fn().mockResolvedValue(1), // Default to ID 1
    clearCache: jest.fn(),
  } as unknown as jest.Mocked<PrestashopCurrencyResolver>;

  const mockTaxRateResolver = {
    // Default: untaxed (net == gross) so existing assertions are unaffected.
    resolveProductTaxRate: jest.fn().mockResolvedValue(0),
  } as unknown as PrestashopTaxRateResolver;

  const mockCustomerProjectionRepository = {
    findById: jest.fn(),
    findByEmailHash: jest.fn(),
    upsertProjection: jest.fn(),
  } as unknown as jest.Mocked<CustomerProjectionRepositoryPort>;

  const mockCustomerProvisioner = {
    resolveOrCreateGuestCustomer: jest.fn(),
  } as unknown as jest.Mocked<PrestashopCustomerProvisioner>;

  const mockAddressProvisioner = {
    resolveOrCreateAddress: jest.fn(),
  } as unknown as jest.Mocked<PrestashopAddressProvisioner>;

  const mockOpenLinkerModuleClient = {
    writeCartShipping: jest.fn().mockResolvedValue(undefined),
    importOrder: jest
      .fn()
      .mockResolvedValue({ idOrder: 999, reference: 'TEST-ORDER-001', alreadyExisted: false }),
  } as unknown as jest.Mocked<IPrestashopOpenLinkerModuleClient>;

  // Default OL Dynamic carrier discovery: every createOrder call invokes
  // `discoverDynamicCarrierId()` early, which calls
  // `httpClient.listResources('carriers', { custom: { external_module_name: 'openlinker' } }, …)`.
  // Tests in this suite that reassign `listResources` must remember to
  // re-mock this path (none in createOrder do; the listCarriers /
  // listOrderStatuses / listPaymentMethods describes don't go through
  // createOrder, so they're unaffected).
  mockHttpClient.listResources = jest
    .fn()
    .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
      if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
        return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
      }
      return Promise.resolve([]);
    });

  const adapter = new PrestashopOrderProcessorManagerAdapter(
    mockHttpClient,
    mockIdentifierMapping,
    mockOrderMapper,
    connection,
    mockCustomerProvisioner,
    mockAddressProvisioner,
    mockCurrencyResolver,
    mockCustomerProjectionRepository,
    mockOpenLinkerModuleClient,
    mockTaxRateResolver
  );

  function setCreateResourceDispatch(cart: unknown, order: unknown): void {
    mockHttpClient.createResource = jest.fn().mockImplementation((resource: string) => {
      if (resource === 'specific_prices') {
        return Promise.resolve({ id: 'sp_test' });
      }
      // 'carts' (and any other resource hit during create) → cart payload.
      return Promise.resolve(cart);
    });
    mockOpenLinkerModuleClient.importOrder = jest.fn().mockResolvedValue({
      idOrder: Number((order as { id?: unknown }).id ?? 999),
      reference: (order as { reference?: string }).reference ?? 'TEST-ORDER-001',
      alreadyExisted: false,
    });
  }

  return {
    adapter,
    mockHttpClient,
    mockIdentifierMapping,
    mockOrderMapper,
    mockCurrencyResolver,
    mockTaxRateResolver,
    mockCustomerProjectionRepository,
    mockCustomerProvisioner,
    mockAddressProvisioner,
    mockOpenLinkerModuleClient,
    connection,
    setCreateResourceDispatch,
  };
}
