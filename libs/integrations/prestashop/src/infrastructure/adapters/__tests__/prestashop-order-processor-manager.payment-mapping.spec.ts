/**
 * PrestaShop Order Processor Manager - payment mapping (#3474)
 *
 * `createOrder` used to hardcode `paymentMethod: 'Check payment'`, so a payment
 * mapping the operator configured on the Payments tab changed nothing. The
 * mapping is source-keyed (stored under the source connection, keyed by the
 * source's own payment type); the adapter resolves it and sends the mapped
 * value as the order's payment label. Anything that prevents a lookup - no
 * mapping service, no source connection, no source payment type, no row, a
 * blank row, a failing lookup - keeps the label OpenLinker has always sent, and
 * never costs the order.
 *
 * The label is all that changes: the OL module still delegates to
 * `ps_checkpayment`.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import {
  createOrderProcessorManagerHarness,
  createTestOrder,
  type OrderProcessorHarness,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';
import {
  DEFAULT_PAYMENT_METHOD_LABEL,
  PrestashopOrderProcessorManagerAdapter,
} from '../prestashop-order-processor-manager.adapter';
import type { OrderCreate } from '@openlinker/core/orders';
import type { IMappingConfigService } from '@openlinker/core/mappings';

const SOURCE_CONNECTION_ID = 'conn-allegro-1';

describe('PrestashopOrderProcessorManagerAdapter - payment mapping (#3474)', () => {
  let harness: OrderProcessorHarness;
  let warnings: string[];

  beforeEach(() => {
    harness = createOrderProcessorManagerHarness();
    harness.mockIdentifierMapping.getExternalIds = jest
      .fn()
      .mockImplementation((entityType: string) =>
        Promise.resolve([{ connectionId: harness.connection.id, externalId: '42', entityType }])
      ) as typeof harness.mockIdentifierMapping.getExternalIds;
    harness.setCreateResourceDispatch({ id: '123' }, { id: '999', reference: 'ORDER-1' });
    warnings = [];
  });

  /** An adapter wired exactly like the harness one, plus a mapping service. */
  function adapterWith(mappingConfig: Partial<IMappingConfigService> | undefined): {
    adapter: PrestashopOrderProcessorManagerAdapter;
  } {
    const adapter = new PrestashopOrderProcessorManagerAdapter(
      harness.mockHttpClient,
      harness.mockIdentifierMapping,
      harness.mockOrderMapper,
      harness.connection,
      harness.mockCustomerProvisioner,
      harness.mockAddressProvisioner,
      harness.mockCurrencyResolver,
      harness.mockCustomerProjectionRepository,
      harness.mockOpenLinkerModuleClient,
      harness.mockTaxRateResolver,
      // The adapter consults the carrier and order-state mappings on every
      // create; they resolve nothing here so only the payment lookup is in play.
      mappingConfig === undefined
        ? undefined
        : ({
            resolveCarrierMapping: jest.fn().mockResolvedValue(null),
            resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
            ...mappingConfig,
          } as unknown as IMappingConfigService)
    );
    jest
      .spyOn((adapter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
      .mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });
    return { adapter };
  }

  function orderFrom(overrides: Partial<OrderCreate> = {}): OrderCreate {
    return {
      ...createTestOrder(),
      source: { connectionId: SOURCE_CONNECTION_ID },
      sourcePaymentMethod: 'CASH_ON_DELIVERY',
      ...overrides,
    };
  }

  function sentPaymentMethod(): string {
    const call = harness.mockOpenLinkerModuleClient.importOrder.mock.calls.at(-1);
    return (call?.[0] as { paymentMethod: string }).paymentMethod;
  }

  it('sends the configured mapping as the PrestaShop payment_method', async () => {
    const resolvePaymentMapping = jest.fn().mockResolvedValue('ps_cashondelivery');
    const { adapter } = adapterWith({ resolvePaymentMapping });

    await adapter.createOrder(orderFrom());

    expect(sentPaymentMethod()).toBe('ps_cashondelivery');
    // Source-scoped, like the carrier mapping: the SOURCE connection and the
    // source's own payment type, never the destination connection.
    expect(resolvePaymentMapping).toHaveBeenCalledWith(SOURCE_CONNECTION_ID, 'CASH_ON_DELIVERY');
  });

  it('trims the configured value before sending it', async () => {
    const { adapter } = adapterWith({
      resolvePaymentMapping: jest.fn().mockResolvedValue('  ps_wirepayment  '),
    });

    await adapter.createOrder(orderFrom());

    expect(sentPaymentMethod()).toBe('ps_wirepayment');
  });

  it('keeps the default label when no mapping is configured for the payment type', async () => {
    const { adapter } = adapterWith({ resolvePaymentMapping: jest.fn().mockResolvedValue(null) });

    await adapter.createOrder(orderFrom());

    expect(sentPaymentMethod()).toBe(DEFAULT_PAYMENT_METHOD_LABEL);
    expect(DEFAULT_PAYMENT_METHOD_LABEL).toBe('Check payment');
  });

  it.each([[''], ['   ']])(
    'keeps the default label when the configured value is blank (%j)',
    async (blank) => {
      const { adapter } = adapterWith({ resolvePaymentMapping: jest.fn().mockResolvedValue(blank) });

      await adapter.createOrder(orderFrom());

      expect(sentPaymentMethod()).toBe(DEFAULT_PAYMENT_METHOD_LABEL);
    }
  );

  it('does not look anything up when the source reported no payment type', async () => {
    const resolvePaymentMapping = jest.fn().mockResolvedValue('ps_cashondelivery');
    const { adapter } = adapterWith({ resolvePaymentMapping });

    await adapter.createOrder(orderFrom({ sourcePaymentMethod: undefined }));

    expect(resolvePaymentMapping).not.toHaveBeenCalled();
    expect(sentPaymentMethod()).toBe(DEFAULT_PAYMENT_METHOD_LABEL);
  });

  it('does not look anything up when the order carries no source connection', async () => {
    const resolvePaymentMapping = jest.fn().mockResolvedValue('ps_cashondelivery');
    const { adapter } = adapterWith({ resolvePaymentMapping });

    await adapter.createOrder(orderFrom({ source: undefined }));

    expect(resolvePaymentMapping).not.toHaveBeenCalled();
    expect(sentPaymentMethod()).toBe(DEFAULT_PAYMENT_METHOD_LABEL);
  });

  it('keeps the default label when no mapping service is wired', async () => {
    const { adapter } = adapterWith(undefined);

    await adapter.createOrder(orderFrom());

    expect(sentPaymentMethod()).toBe(DEFAULT_PAYMENT_METHOD_LABEL);
  });

  describe('neutral payment method (#3294)', () => {
    it.each([
      ['cash_on_delivery', 'Cash on delivery'],
      ['bank_transfer', 'Bank transfer'],
      ['online', 'Online payment'],
    ] as const)('labels a %s order "%s" when no mapping applies', async (paymentMethod, label) => {
      const { adapter } = adapterWith(undefined);

      await adapter.createOrder(orderFrom({ paymentMethod, sourcePaymentMethod: undefined }));

      expect(sentPaymentMethod()).toBe(label);
    });

    it('keeps the default label for an unknown or unreported method', async () => {
      const { adapter } = adapterWith(undefined);

      await adapter.createOrder(orderFrom({ paymentMethod: 'unknown', sourcePaymentMethod: undefined }));
      expect(sentPaymentMethod()).toBe(DEFAULT_PAYMENT_METHOD_LABEL);

      await adapter.createOrder(orderFrom({ paymentMethod: undefined, sourcePaymentMethod: undefined }));
      expect(sentPaymentMethod()).toBe(DEFAULT_PAYMENT_METHOD_LABEL);
    });

    it('lets an operator mapping win over the neutral label', async () => {
      const { adapter } = adapterWith({
        resolvePaymentMapping: jest.fn().mockResolvedValue('ps_wirepayment'),
      });

      await adapter.createOrder(orderFrom({ paymentMethod: 'cash_on_delivery' }));

      expect(sentPaymentMethod()).toBe('ps_wirepayment');
    });

    it('falls back to the neutral label when the mapping has no row or fails', async () => {
      const none = adapterWith({ resolvePaymentMapping: jest.fn().mockResolvedValue(null) });
      await none.adapter.createOrder(orderFrom({ paymentMethod: 'bank_transfer' }));
      expect(sentPaymentMethod()).toBe('Bank transfer');

      const failing = adapterWith({
        resolvePaymentMapping: jest.fn().mockRejectedValue(new Error('db unavailable')),
      });
      await failing.adapter.createOrder(orderFrom({ paymentMethod: 'bank_transfer' }));
      expect(sentPaymentMethod()).toBe('Bank transfer');
    });
  });

  it('still creates the order, with a warning, when the mapping lookup fails', async () => {
    const { adapter } = adapterWith({
      resolvePaymentMapping: jest.fn().mockRejectedValue(new Error('db unavailable')),
    });

    const created = await adapter.createOrder(orderFrom());

    expect(created).toBeDefined();
    expect(sentPaymentMethod()).toBe(DEFAULT_PAYMENT_METHOD_LABEL);
    const warning = warnings.find((w) => w.includes('Payment mapping lookup failed'));
    expect(warning).toContain('sourcePaymentMethod=CASH_ON_DELIVERY');
    expect(warning).toContain(SOURCE_CONNECTION_ID);
    expect(warning).toContain('db unavailable');
  });
});
