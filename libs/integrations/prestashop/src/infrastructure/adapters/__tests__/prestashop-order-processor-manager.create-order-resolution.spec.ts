/**
 * PrestaShop Order Processor Manager — createOrder resolution paths
 *
 * Carrier resolution (#455), OL module sidecar write (#516), pickup-point
 * forwarding (#458), DestinationOptionsReader (#472/#473), and order-state
 * override resolution (#862). Split from the former 2279-line adapter spec
 * (#976); shared mocks/adapter/builders live in the sibling factory at
 * src/__tests__/mocks. These describes construct mapping-config-equipped
 * adapter instances inline, so the adapter class is imported directly.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import {
  createOrderProcessorManagerHarness,
  createTestOrder,
  OL_DYNAMIC_CARRIER_ID,
  type OrderProcessorHarness,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';
import { PrestashopOrderProcessorManagerAdapter } from '../prestashop-order-processor-manager.adapter';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopApiException } from '@openlinker/integrations-prestashop';
import { PrestashopOlModuleException } from '../../../domain/exceptions/prestashop-ol-module.exception';
import type { OrderCreate } from '@openlinker/core/orders';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { PrestashopOrder } from '../../mappers/prestashop.mapper.interface';

describe('PrestashopOrderProcessorManagerAdapter — createOrder resolution', () => {
  let adapter: OrderProcessorHarness['adapter'];
  let mockHttpClient: OrderProcessorHarness['mockHttpClient'];
  let mockIdentifierMapping: OrderProcessorHarness['mockIdentifierMapping'];
  let mockOrderMapper: OrderProcessorHarness['mockOrderMapper'];
  let mockCurrencyResolver: OrderProcessorHarness['mockCurrencyResolver'];
  let mockTaxRateResolver: OrderProcessorHarness['mockTaxRateResolver'];
  let mockCustomerProjectionRepository: OrderProcessorHarness['mockCustomerProjectionRepository'];
  let mockCustomerProvisioner: OrderProcessorHarness['mockCustomerProvisioner'];
  let mockAddressProvisioner: OrderProcessorHarness['mockAddressProvisioner'];
  let mockOpenLinkerModuleClient: OrderProcessorHarness['mockOpenLinkerModuleClient'];
  let connection: OrderProcessorHarness['connection'];
  let setCreateResourceDispatch: OrderProcessorHarness['setCreateResourceDispatch'];

  beforeEach(() => {
    ({
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
    } = createOrderProcessorManagerHarness());
  });

  describe('carrier resolution (#455)', () => {
    const ALLEGRO_CONNECTION_ID = 'conn-allegro-1';
    const ALLEGRO_METHOD_ID = '1fa56f79-aaa';

    const buildOrderWithShipping = (): OrderCreate => ({
      ...createTestOrder(),
      shipping: { methodId: ALLEGRO_METHOD_ID, methodName: 'InPost Paczkomat' },
      source: { connectionId: ALLEGRO_CONNECTION_ID },
    });

    const wireSuccessfulMappings = (externalCustomerId: string): void => {
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType, internalId) => {
          if (entityType === 'Customer') {
            return Promise.resolve([
              {
                connectionId: connection.id,
                externalId: externalCustomerId,
                entityType: 'Customer',
              },
            ]);
          }
          if (entityType === 'Product' && internalId === 'internal-product-456') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: '100', entityType: 'Product' },
            ]);
          }
          if (entityType === 'Product' && internalId === 'internal-product-789') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: '200', entityType: 'Product' },
            ]);
          }
          if (entityType === 'ProductVariant') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: '300', entityType: 'ProductVariant' },
            ]);
          }
          return Promise.resolve([]);
        });

      mockOrderMapper.mapOrderCreate.mockReturnValue({
        id_customer: externalCustomerId,
        current_state: 1,
        associations: { order_rows: { order_row: [] } },
      });

      setCreateResourceDispatch({ id: '123' }, {
        id: '999',
        reference: 'TEST-ORDER-001',
      } as PrestashopOrder);

      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);
    };

    it('passes mapped externalCarrierId to mapOrderCreate when MappingConfigService resolves', async () => {
      wireSuccessfulMappings('42');
      const resolveCarrierMapping = jest.fn().mockResolvedValue('4');
      const mockMappingConfig = {
        resolveCarrierMapping,
        resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterWithMapping = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      // 9th arg = externalCarrierId — passed to BOTH mappers (#503).
      // Cart-side is the load-bearing assertion: PS resolves the order's
      // id_carrier from the cart, ignoring the order body's value.
      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        4
      );
      expect(resolveCarrierMapping).toHaveBeenCalledWith(ALLEGRO_CONNECTION_ID, ALLEGRO_METHOD_ID);
    });

    it('falls back to connection.config.defaultCarrierId when no mapping resolves', async () => {
      wireSuccessfulMappings('42');
      // Connection fixture with defaultCarrierId set.
      const connWithDefault = createTestConnection();
      (connWithDefault.config as Record<string, unknown>).defaultCarrierId = 7;

      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
        resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterWithMapping = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connWithDefault,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      // Carrier flows onto the CART (#503): PS resolves the order's id_carrier
      // from the cart, ignoring any order-body value.
      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        7
      );
    });

    it('ignores invalid defaultCarrierId (0, negative, NaN) and falls back to OL Dynamic carrier (#503 / #516)', async () => {
      // Operator sets defaultCarrierId=0 (or negative, or non-numeric) in
      // connection config. Without the guard, the mapper writes id_carrier=0
      // to the cart and PS reproduces the #503 failure mode through a
      // different door — `??` doesn't fall back on 0, only null/undefined.
      // Adapter must filter and use the OL Dynamic carrier id (#516).
      wireSuccessfulMappings('42');
      const connWithBadDefault = createTestConnection();
      (connWithBadDefault.config as Record<string, unknown>).defaultCarrierId = 0;

      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
        resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterWithMapping = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connWithBadDefault,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        OL_DYNAMIC_CARRIER_ID
      );
    });

    it('falls back to OL Dynamic carrier when neither mapping nor defaultCarrierId is set (#516)', async () => {
      wireSuccessfulMappings('42');
      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
        resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterWithMapping = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection, // default fixture — no defaultCarrierId
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      // Carrier flows onto the CART (#503).
      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        OL_DYNAMIC_CARRIER_ID
      );
    });
  });

  describe('OL module sidecar write (#516)', () => {
    const ALLEGRO_CONNECTION_ID = 'conn-allegro-1';
    const ALLEGRO_METHOD_ID = 'method-courier';
    const STATIC_CARRIER_ID = 4;

    const buildOrderForSidecar = (shipping = 12.5): OrderCreate => ({
      ...createTestOrder(),
      shipping: { methodId: ALLEGRO_METHOD_ID, methodName: 'InPost Paczkomat' },
      source: { connectionId: ALLEGRO_CONNECTION_ID },
      totals: {
        subtotal: 109.97,
        tax: 10.0,
        shipping,
        total: 109.97 + 10.0 + shipping,
        currency: 'EUR',
      },
    });

    const wireSuccessfulCreatePath = (): void => {
      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType: string) => {
        if (entityType === 'Customer') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '42', entityType: 'Customer' },
          ]);
        }
        if (entityType === 'Product') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '100', entityType: 'Product' },
          ]);
        }
        if (entityType === 'ProductVariant') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '300', entityType: 'ProductVariant' },
          ]);
        }
        return Promise.resolve([]);
      });

      mockOrderMapper.mapOrderCreate.mockReturnValue({
        id_customer: '42',
        current_state: 1,
        associations: { order_rows: { order_row: [] } },
      });

      setCreateResourceDispatch({ id: '123' }, {
        id: '999',
        reference: 'TEST-ORDER-001',
      } as PrestashopOrder);

      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);
    };

    it('writes the sidecar row when the resolved carrier is the OL Dynamic carrier (mapping branch)', async () => {
      wireSuccessfulCreatePath();
      const mockMappingConfig = {
        // Mapping resolves to the OL Dynamic carrier id — adapter must write the sidecar.
        resolveCarrierMapping: jest.fn().mockResolvedValue(String(OL_DYNAMIC_CARRIER_ID)),
        resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterUnderTest = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterUnderTest.createOrder(buildOrderForSidecar(12.5));

      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledTimes(1);
      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledWith(
        expect.objectContaining({
          idCart: 123,
          amountTaxExcl: 12.5,
          amountTaxIncl: 12.5,
          source: expect.stringContaining(`connection:${ALLEGRO_CONNECTION_ID}`),
        })
      );
    });

    it('does NOT write the sidecar when a static carrier id is resolved via mapping', async () => {
      wireSuccessfulCreatePath();
      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(String(STATIC_CARRIER_ID)),
        resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterUnderTest = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterUnderTest.createOrder(buildOrderForSidecar());

      expect(mockOpenLinkerModuleClient.writeCartShipping).not.toHaveBeenCalled();
    });

    it('does NOT write the sidecar when defaultCarrierId resolves to a static carrier', async () => {
      wireSuccessfulCreatePath();
      const connWithStaticDefault = createTestConnection();
      (connWithStaticDefault.config as Record<string, unknown>).defaultCarrierId =
        STATIC_CARRIER_ID;
      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
        resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterUnderTest = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connWithStaticDefault,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterUnderTest.createOrder(buildOrderForSidecar());

      expect(mockOpenLinkerModuleClient.writeCartShipping).not.toHaveBeenCalled();
    });

    it('writes the sidecar when no mapping/default resolves and falls back to OL Dynamic', async () => {
      // No MappingConfigService and no defaultCarrierId — adapter falls
      // back to the OL Dynamic carrier and must therefore write the sidecar.
      wireSuccessfulCreatePath();

      await adapter.createOrder(buildOrderForSidecar(8.0));

      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledTimes(1);
      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledWith(
        expect.objectContaining({
          idCart: 123,
          amountTaxExcl: 8.0,
          amountTaxIncl: 8.0,
        })
      );
    });

    it('aborts order creation (does NOT POST /orders) when the sidecar write throws', async () => {
      wireSuccessfulCreatePath();
      const sidecarError = new PrestashopOlModuleException(
        connection.id,
        123,
        500,
        'persist-failed'
      );
      mockOpenLinkerModuleClient.writeCartShipping.mockRejectedValueOnce(sidecarError);

      // Adapter wraps non-domain errors in PrestashopApiException ("Failed to
      // create PrestaShop order: …"); the underlying reason is preserved in
      // the message.
      await expect(adapter.createOrder(buildOrderForSidecar())).rejects.toThrow(
        PrestashopApiException
      );

      // createResource was called once (cart); the order import never ran.
      expect(mockHttpClient.createResource).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.createResource).toHaveBeenCalledWith('carts', expect.anything());
      expect(mockOpenLinkerModuleClient.importOrder).not.toHaveBeenCalled();
    });

    it('warns and uses the first live row when multiple OL Dynamic carriers exist', async () => {
      // Operator cloned the OL Dynamic carrier in BO (or a botched migration
      // double-inserted). The adapter must keep working but warn so the
      // operator notices and cleans up.
      wireSuccessfulCreatePath();
      const warnSpy = jest
        .spyOn((adapter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([
              { id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' },
              { id: OL_DYNAMIC_CARRIER_ID + 1, active: '1', deleted: '0' },
            ]);
          }
          return Promise.resolve([]);
        });

      await adapter.createOrder(buildOrderForSidecar(8.0));

      // First-row id was used for both the cart's id_carrier and the sidecar.
      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        OL_DYNAMIC_CARRIER_ID
      );
      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledTimes(1);
      // Operator-visible warn naming the duplicate set.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Multiple live OL Dynamic carrier rows')
      );
      warnSpy.mockRestore();
    });

    it('aborts when the OL Dynamic carrier row returns a non-positive id (PS WS trust-boundary guard)', async () => {
      // PS WS edge: the row exists but `id` decodes to NaN / 0 / negative
      // (operator BO edit, schema drift). Adapter must NOT propagate
      // id_carrier=NaN into the cart mapper — treat as missing instead.
      wireSuccessfulCreatePath();
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([{ id: 'not-a-number', active: '1', deleted: '0' }]);
          }
          return Promise.resolve([]);
        });

      await expect(adapter.createOrder(buildOrderForSidecar())).rejects.toThrow(
        PrestashopApiException
      );
      expect(mockHttpClient.createResource).not.toHaveBeenCalled();
      expect(mockOpenLinkerModuleClient.writeCartShipping).not.toHaveBeenCalled();
    });

    it('aborts before any PS write when the OL module is not installed (carrier discovery empty)', async () => {
      wireSuccessfulCreatePath();
      // Override the discovery default with an empty result — operator
      // hasn't installed/activated the OL module.
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        });

      await expect(adapter.createOrder(buildOrderForSidecar())).rejects.toThrow(
        PrestashopApiException
      );

      // No cart, no order, no sidecar — discovery threw before any write.
      expect(mockHttpClient.createResource).not.toHaveBeenCalled();
      expect(mockOpenLinkerModuleClient.writeCartShipping).not.toHaveBeenCalled();
    });
  });

  describe('pickup-point forwarding (#458)', () => {
    it('forwards order.pickupPoint into addressProvisioner.resolveOrCreateAddress', async () => {
      const order: OrderCreate = {
        ...createTestOrder(),
        shippingAddress: {
          firstName: 'Buyer',
          lastName: 'Profile',
          address1: 'ul. Lockerowa 1',
          city: 'Poznań',
          postalCode: '60-001',
          country: 'PL',
        },
        pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A', description: 'Stacja paliw BP' },
      };

      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType) => {
        if (entityType === 'Customer') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '42', entityType: 'Customer' },
          ]);
        }
        if (entityType === 'Product') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '100', entityType: 'Product' },
          ]);
        }
        if (entityType === 'ProductVariant') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '300', entityType: 'ProductVariant' },
          ]);
        }
        return Promise.resolve([]);
      });
      mockAddressProvisioner.resolveOrCreateAddress = jest.fn().mockResolvedValue('800');

      mockOrderMapper.mapOrderCreate.mockReturnValue({
        id_customer: '42',
        current_state: 1,
        associations: { order_rows: { order_row: [] } },
      });
      setCreateResourceDispatch({ id: '123' }, {
        id: '999',
        reference: 'TEST-ORDER-001',
      } as PrestashopOrder);
      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

      await adapter.createOrder(order);

      // 9th positional arg of resolveOrCreateAddress is `pickupPoint`.
      expect(mockAddressProvisioner.resolveOrCreateAddress).toHaveBeenCalledWith(
        expect.any(String), // internalCustomerId
        expect.any(String), // prestashopCustomerId
        order.shippingAddress,
        'shipping',
        connection.id,
        mockHttpClient,
        expect.any(Object), // connectionConfig
        mockCustomerProjectionRepository,
        order.pickupPoint
      );
    });
  });

  describe('DestinationOptionsReader (#472 / #473)', () => {
    describe('listCarriers', () => {
      it('returns active non-deleted carriers with id_reference as value', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          { id: '1', id_reference: '1', name: 'Click and collect', active: '1', deleted: '0' },
          { id: '2', id_reference: '2', name: 'My carrier', active: '1', deleted: '0' },
          { id: '3', id_reference: '3', name: 'My cheap carrier', active: '1', deleted: '0' },
          { id: '4', id_reference: '4', name: 'My light carrier', active: '1', deleted: '0' },
        ]);

        const result = await adapter.listCarriers();

        expect(mockHttpClient.listResources).toHaveBeenCalledWith(
          'carriers',
          { custom: { active: '1', deleted: '0' } },
          1000,
          0
        );
        expect(result).toEqual([
          { value: '1', label: 'Click and collect' },
          { value: '2', label: 'My carrier' },
          { value: '3', label: 'My cheap carrier' },
          { value: '4', label: 'My light carrier' },
        ]);
      });

      it('unwraps multi-language name field shape', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          {
            id: '1',
            id_reference: '1',
            name: { language: [{ '#text': 'Click and collect' }] },
            active: '1',
            deleted: '0',
          },
        ]);

        const result = await adapter.listCarriers();

        expect(result).toEqual([{ value: '1', label: 'Click and collect' }]);
      });

      it("marks the OL Dynamic carrier with kind='dynamic' (#517) when external_module_name='openlinker'", async () => {
        // The OL PS module installs the carrier with
        // `external_module_name='openlinker'` (#515 / #524). FE relies on
        // `kind: 'dynamic'` to decorate the dropdown — runtime routing is
        // already handled by the order-processor adapter (#516).
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          { id: '1', id_reference: '1', name: 'Click and collect', active: '1', deleted: '0' },
          {
            id: '99',
            id_reference: '99',
            name: 'OpenLinker Dynamic',
            active: '1',
            deleted: '0',
            external_module_name: 'openlinker',
          },
          { id: '4', id_reference: '4', name: 'My light carrier', active: '1', deleted: '0' },
        ]);

        const result = await adapter.listCarriers();

        // OL Dynamic carries kind='dynamic'; siblings stay static (no kind).
        expect(result).toEqual([
          { value: '1', label: 'Click and collect' },
          { value: '99', label: 'OpenLinker Dynamic', kind: 'dynamic' },
          { value: '4', label: 'My light carrier' },
        ]);
      });

      it('treats unrelated external_module_name values as static (no kind set)', async () => {
        // Defensive: if some other PS carrier module ships with its own
        // `external_module_name` (e.g. a third-party InPost integration),
        // we don't accidentally light it up as dynamic. Only the literal
        // `'openlinker'` value enables the discriminator.
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          {
            id: '7',
            id_reference: '7',
            name: 'Some other carrier module',
            active: '1',
            deleted: '0',
            external_module_name: 'thirdparty_carrier',
          },
        ]);

        const result = await adapter.listCarriers();

        expect(result).toEqual([{ value: '7', label: 'Some other carrier module' }]);
        expect(result[0]).not.toHaveProperty('kind');
      });

      it('returns empty array when PS reports no carriers', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);
        await expect(adapter.listCarriers()).resolves.toEqual([]);
      });
    });

    describe('listOrderStatuses', () => {
      it('returns non-deleted order_states keyed by id', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          { id: '1', name: 'Awaiting check payment', deleted: '0' },
          { id: '2', name: 'Payment accepted', deleted: '0' },
          { id: '5', name: 'Delivered', deleted: '0' },
        ]);

        const result = await adapter.listOrderStatuses();

        expect(mockHttpClient.listResources).toHaveBeenCalledWith(
          'order_states',
          { custom: { deleted: '0' } },
          1000,
          0
        );
        expect(result).toEqual([
          { value: '1', label: 'Awaiting check payment' },
          { value: '2', label: 'Payment accepted' },
          { value: '5', label: 'Delivered' },
        ]);
      });
    });

    describe('listPaymentMethods (#483)', () => {
      function adapterWithOverrides(
        overrides: string[] | undefined
      ): PrestashopOrderProcessorManagerAdapter {
        const baseConfig = connection.config as Record<string, unknown>;
        const cfg: Record<string, unknown> =
          overrides === undefined
            ? baseConfig
            : { ...baseConfig, paymentModuleOverrides: overrides };
        const connectionWithOverrides = createTestConnection({
          config: cfg,
        });
        return new PrestashopOrderProcessorManagerAdapter(
          mockHttpClient,
          mockIdentifierMapping,
          mockOrderMapper,
          connectionWithOverrides,
          mockCustomerProvisioner,
          mockAddressProvisioner,
          mockCurrencyResolver,
          mockCustomerProjectionRepository,
          mockOpenLinkerModuleClient,
          mockTaxRateResolver
        );
      }

      it('returns the curated list verbatim when no overrides are configured', async () => {
        mockHttpClient.listResources = jest.fn();

        const result = await adapter.listPaymentMethods();

        // PS WS keys cannot read /api/modules — the adapter must not call it.
        expect(mockHttpClient.listResources).not.toHaveBeenCalled();
        // Curated list covers ps_wirepayment, payu, etc.; spot-check a few entries.
        expect(result).toEqual(
          expect.arrayContaining([
            { value: 'ps_wirepayment', label: 'Bank wire transfer (ps_wirepayment)' },
            { value: 'payu', label: 'PayU' },
            { value: 'paypal', label: 'PayPal' },
          ])
        );
        // All values are unique.
        const values = result.map((m) => m.value);
        expect(new Set(values).size).toBe(values.length);
      });

      it('appends override entries to the curated list', async () => {
        const overrideAdapter = adapterWithOverrides(['custom_gateway_xyz']);
        mockHttpClient.listResources = jest.fn();

        const result = await overrideAdapter.listPaymentMethods();

        expect(mockHttpClient.listResources).not.toHaveBeenCalled();
        expect(result).toContainEqual({
          value: 'custom_gateway_xyz',
          label: 'custom_gateway_xyz',
        });
      });

      it('dedups overrides whose value collides with a curated entry', async () => {
        // 'payu' is already in the curated list — must not appear twice and
        // the curated label must win.
        const overrideAdapter = adapterWithOverrides(['payu', 'unique_override']);

        const result = await overrideAdapter.listPaymentMethods();

        const payuEntries = result.filter((m) => m.value === 'payu');
        expect(payuEntries).toHaveLength(1);
        expect(payuEntries[0].label).toBe('PayU');
        expect(result).toContainEqual({
          value: 'unique_override',
          label: 'unique_override',
        });
      });

      it('dedups overrides whose value is repeated within the override list', async () => {
        const overrideAdapter = adapterWithOverrides(['custom_a', 'custom_a', 'custom_b']);

        const result = await overrideAdapter.listPaymentMethods();

        expect(result.filter((m) => m.value === 'custom_a')).toHaveLength(1);
        expect(result.filter((m) => m.value === 'custom_b')).toHaveLength(1);
      });
    });
  });

  describe('order-state override resolution (#862)', () => {
    const PS_ORDER_ID = '5001';
    const DEFAULT_SHIPPED_ID = 4;

    function buildAdapterWithStateMapping(
      resolveOrderStateMapping: jest.Mock
    ): PrestashopOrderProcessorManagerAdapter {
      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
        resolveOrderStateMapping,
      } as unknown as IMappingConfigService;
      return new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );
    }

    beforeEach(() => {
      mockOrderMapper.mapStatusToPrestashopStateId = jest.fn().mockReturnValue(DEFAULT_SHIPPED_ID);
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });
    });

    it('transitions to the configured override state id (destination-scoped) instead of the default map', async () => {
      const resolveOrderStateMapping = jest.fn().mockResolvedValue('12');
      const adapterWithMapping = buildAdapterWithStateMapping(resolveOrderStateMapping);

      await adapterWithMapping.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      // Scoped by THIS (destination) connection, not the source.
      expect(resolveOrderStateMapping).toHaveBeenCalledWith(connection.id, 'shipped');
      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: 12 },
        { sendEmail: true }
      );
    });

    it('falls back to the hardcoded default-install map when no override is configured', async () => {
      const adapterWithMapping = buildAdapterWithStateMapping(jest.fn().mockResolvedValue(null));

      await adapterWithMapping.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      expect(mockOrderMapper.mapStatusToPrestashopStateId).toHaveBeenCalledWith('shipped');
      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: DEFAULT_SHIPPED_ID },
        { sendEmail: true }
      );
    });

    it('ignores a non-positive / non-numeric override and falls back to the default map', async () => {
      const adapterWithMapping = buildAdapterWithStateMapping(
        jest.fn().mockResolvedValue('not-a-number')
      );

      await adapterWithMapping.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: DEFAULT_SHIPPED_ID },
        { sendEmail: true }
      );
    });
  });
});
