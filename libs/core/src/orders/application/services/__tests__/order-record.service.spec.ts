/**
 * Order Record Service Unit Tests
 *
 * Unit tests for OrderRecordService, verifying PII-aware snapshot handling,
 * order persistence, and sync status updates.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { OrderRecordService } from '../order-record.service';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import type { OrderLineItemRepositoryPort } from '../../../domain/ports/order-line-item-repository.port';
import type { OrderSyncStatus } from '../../../domain/entities/order-record.entity';
import { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { Order } from '../../../domain/types/order.types';
import type { IncomingOrder } from '../../../domain/types/incoming-order.types';
import type { IOrderFxStampService } from '../../interfaces/order-fx-stamp.service.interface';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { IAutomationTriggerEmissionService } from '@openlinker/core/automation';
import { AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN } from '@openlinker/core/automation';
import { REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN } from '@openlinker/core/currency';
import {
  ORDER_FX_STAMP_SERVICE_TOKEN,
  ORDER_LINE_ITEM_REPOSITORY_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
} from '../../../orders.tokens';

describe('OrderRecordService', () => {
  let service: OrderRecordService;
  // T5 emission is exercised in `order-record-packed.service.spec.ts`; here it is
  // an inert stub so the constructor stays honest without implying participation.
  const automationEmission = {
    emit: jest.fn().mockResolvedValue({
      firedRuleIds: [],
      alreadyFiredRuleIds: [],
      evaluatedRuleCount: 0,
    }),
  } as unknown as IAutomationTriggerEmissionService;
  let repository: jest.Mocked<OrderRecordRepositoryPort>;
  let fxStamp: jest.Mocked<IOrderFxStampService>;
  let lineItemRepository: jest.Mocked<OrderLineItemRepositoryPort>;
  let reportingCurrencySettings: jest.Mocked<IReportingCurrencySettingsService>;

  const originalEnv = process.env.OL_STORE_PII;
  const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;

  beforeEach(async () => {
    process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';
    repository = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findEarliestOrderDateByConnection: jest.fn(),
      countOrdersByRoutingCountrySince: jest.fn(),
      upsert: jest.fn(),
      upsertWithLineItems: jest.fn(),
      updateSyncStatus: jest.fn(),
      updateItemResolutionFailure: jest.fn(),
      markCancelled: jest.fn(),
      updateSalesDocumentBlock: jest.fn(),
      updateOmsAttention: jest.fn(),
      countOrdersWithOmsAttention: jest.fn(),
      getDailyOrderAggregates: jest.fn(),
      getMedianOrderValue: jest.fn(),
      getNetMedianOrderValue: jest.fn(),
      findCurrencyMismatchOrders: jest.fn(),
      findProductMatchingErrorOrders: jest.fn(),
      findCurrencyMismatchOrderRefsAfter: jest.fn(),
      clearFxStampForRestatement: jest.fn(),
      countRemainingCurrencyMismatch: jest.fn(),
    } as unknown as jest.Mocked<OrderRecordRepositoryPort>;

    // Defaults to `deferred`, which is the outcome that owes NO refresh - so
    // every pre-#2125 assertion about `findById` call counts keeps its original
    // meaning unless a test opts into a stamped outcome.
    fxStamp = {
      stamp: jest.fn().mockResolvedValue({
        kind: 'deferred',
        reason: 'rate provider unavailable',
        retryEnqueued: true,
      }),
      sweep: jest.fn(),
    } as unknown as jest.Mocked<IOrderFxStampService>;

    lineItemRepository = {
      findByOrderId: jest.fn(),
      getUnitsSoldByConnection: jest.fn(),
      getTopProductRanking: jest.fn(),
      getProductChannelBreakdown: jest.fn(),
    } as unknown as jest.Mocked<OrderLineItemRepositoryPort>;

    reportingCurrencySettings = {
      resolve: jest.fn().mockResolvedValue('PLN'),
      getView: jest.fn(),
      setReportingCurrency: jest.fn(),
      listSelectableCurrencies: jest.fn(),
    } as unknown as jest.Mocked<IReportingCurrencySettingsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderRecordService,
        {
          provide: ORDER_RECORD_REPOSITORY_TOKEN,
          useValue: repository,
        },
        {
          provide: ORDER_FX_STAMP_SERVICE_TOKEN,
          useValue: fxStamp,
        },
        {
          provide: ORDER_LINE_ITEM_REPOSITORY_TOKEN,
          useValue: lineItemRepository,
        },
        {
          provide: AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN,
          useValue: automationEmission,
        },
        {
          provide: REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
          useValue: reportingCurrencySettings,
        },
      ],
    }).compile();

    service = module.get<OrderRecordService>(OrderRecordService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalEnv) {
      process.env.OL_STORE_PII = originalEnv;
    } else {
      delete process.env.OL_STORE_PII;
    }
    if (originalPiiHashSalt) {
      process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
    } else {
      delete process.env.OL_PII_HASH_SALT;
    }
  });

  const createMockOrder = (): Order => ({
    id: 'order-123',
    orderNumber: 'ORD-001',
    status: 'pending',
    customerId: 'customer-456',
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        variantId: 'variant-1',
        quantity: 2,
        price: 10.99,
        sku: 'SKU-001',
      },
    ],
    totals: {
      subtotal: 21.98,
      tax: 4.4,
      shipping: 5.0,
      total: 31.38,
      currency: 'USD',
    },
    shippingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      company: 'Acme Corp',
      address1: '123 Main St',
      address2: 'Apt 4B',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'US',
      phone: '+1234567890',
    },
    billingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      address1: '123 Main St',
      city: 'New York',
      postalCode: '10001',
      country: 'US',
    },
    createdAt: new Date('2025-01-01T10:00:00Z'),
    updatedAt: new Date('2025-01-01T10:00:00Z'),
  });

  const createMockIncomingOrder = (): IncomingOrder => ({
    externalOrderId: 'ext-order-789',
    orderNumber: 'ORD-001',
    status: 'pending',
    customerExternalId: 'ext-customer-456',
    customerEmail: 'buyer@example.com',
    items: [
      {
        id: 'item-1',
        productRef: { type: 'offer', externalId: 'offer-abc' },
        quantity: 2,
        price: 10.99,
        sku: 'SKU-001',
      },
    ],
    totals: { subtotal: 21.98, tax: 4.4, shipping: 5.0, total: 31.38, currency: 'USD' },
    shippingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      address1: '123 Main St',
      city: 'New York',
      postalCode: '10001',
      country: 'US',
    },
    createdAt: '2025-01-01T10:00:00Z',
    updatedAt: '2025-01-01T10:00:00Z',
  });

  describe('persistOrder - PII enabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);
    });

    it('should persist order with all PII fields when PII storage is enabled', async () => {
      const order = createMockOrder();
      const sourceConnectionId = 'source-connection-123';
      const sourceEventId = 'event-456';

      const expectedOrderRecord = new OrderRecord(
        order.id,
        order.customerId || null,
        sourceConnectionId,
        sourceEventId,
        expect.objectContaining({
          id: order.id,
          orderNumber: order.orderNumber,
          shippingAddress: order.shippingAddress,
          billingAddress: order.billingAddress,
        }),
        [],
        'ready',
        expect.any(Date),
        expect.any(Date)
      );

      repository.upsertWithLineItems.mockResolvedValue(expectedOrderRecord);

      const result = await service.persistOrder(order, sourceConnectionId, sourceEventId);

      expect(result).toBe(expectedOrderRecord);
      expect(repository.upsertWithLineItems).toHaveBeenCalledTimes(1);
      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot.shippingAddress).toEqual(order.shippingAddress);
      expect(callArg.orderSnapshot.billingAddress).toEqual(order.billingAddress);
      expect(callArg.recordStatus).toBe('ready');
    });

    it('should serialise OrderItem.name and imageUrl into the snapshot when present', async () => {
      const order = createMockOrder();
      order.items[0].name = 'Widget';
      order.items[0].imageUrl = 'https://cdn.example/widget.jpg';

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      const snapshotItems = (callArg.orderSnapshot as { items: Array<Record<string, unknown>> })
        .items;
      expect(snapshotItems[0]).toMatchObject({
        id: 'item-1',
        name: 'Widget',
        imageUrl: 'https://cdn.example/widget.jpg',
      });
    });

    // #2054/#2254 regression. The snapshot projection is an allowlist and is the
    // WRITER half of the pair `orderFromReadySnapshot.readItems` reads back, so a
    // field missing here is lost at persistence time and every MANUAL issuance
    // path rehydrates a rate-less order. Found end to end against a live shop:
    // the analytics line-item row carried the rate while the snapshot did not.
    it('serialises the per-line tax rate, its source and its read time into the snapshot (#2254)', async () => {
      const order = createMockOrder();
      order.items[0].taxRate = '5';
      order.items[0].taxRateCountry = 'PL';
      order.items[0].taxSource = 'shop';
      order.items[0].taxRateReadAt = '2026-08-21T13:20:33.602Z';
      order.items[0].taxRateChannel = '23';

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      const snapshotItems = (callArg.orderSnapshot as { items: Array<Record<string, unknown>> })
        .items;
      expect(snapshotItems[0]).toMatchObject({
        taxRate: '5',
        taxRateCountry: 'PL',
        taxSource: 'shop',
        taxRateReadAt: '2026-08-21T13:20:33.602Z',
        taxRateChannel: '23',
      });
    });

    it('keeps every tax key absent when the order line carries no rate (#2254)', async () => {
      const order = createMockOrder();
      expect(order.items[0].taxRate).toBeUndefined();

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      const snapshotItems = (callArg.orderSnapshot as { items: Array<Record<string, unknown>> })
        .items;
      for (const key of ['taxRate', 'taxRateCountry', 'taxSource', 'taxRateReadAt', 'taxRateChannel']) {
        expect(snapshotItems[0]).not.toHaveProperty(key);
      }
    });

    it('should omit name and imageUrl from the snapshot when the OrderItem does not carry them', async () => {
      const order = createMockOrder();
      // createMockOrder() leaves name/imageUrl unset; this asserts conditional
      // serialisation in persistOrder keeps the keys absent rather than emitting
      // explicit `undefined` (the snapshot is a stable JSON contract).
      expect(order.items[0].name).toBeUndefined();
      expect(order.items[0].imageUrl).toBeUndefined();

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      const snapshotItems = (callArg.orderSnapshot as { items: Array<Record<string, unknown>> })
        .items;
      expect(snapshotItems[0]).not.toHaveProperty('name');
      expect(snapshotItems[0]).not.toHaveProperty('imageUrl');
    });

    it('should serialise Order.deliverySmart into the snapshot when present (#738)', async () => {
      const order = createMockOrder();
      order.deliverySmart = true;

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot['deliverySmart']).toBe(true);
    });

    it('should omit deliverySmart from the snapshot when the Order does not carry it (#738)', async () => {
      const order = createMockOrder();
      // createMockOrder() leaves deliverySmart unset — assert conditional
      // serialisation keeps the key absent rather than emitting `undefined`,
      // so consumers can distinguish "Smart not reported" from "Smart false".
      expect(order.deliverySmart).toBeUndefined();

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot).not.toHaveProperty('deliverySmart');
    });

    it('should denormalize the buyer tax id from the billing address (#2599)', async () => {
      const order = createMockOrder();
      order.billingAddress = { ...order.billingAddress!, taxId: '1234567890' };

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.buyerTaxId).toBe('1234567890');
    });

    it('should encode an asserted-none buyer tax id as the empty string, not NULL (#2599)', async () => {
      const order = createMockOrder();
      order.billingAddress = { ...order.billingAddress!, taxId: null };

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.buyerTaxId).toBe('');
    });

    it('should leave the buyer tax id NULL when no address asserted one (#2599)', async () => {
      const order = createMockOrder();
      expect(order.billingAddress?.taxId).toBeUndefined();

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.buyerTaxId).toBeNull();
    });

    it('should stamp the shipping-address hash from the un-redacted address (#2395)', async () => {
      const order = createMockOrder();
      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.shippingAddressHash).toEqual(expect.any(String));
      expect(callArg.shippingAddressHash).not.toBe('');
    });

    it('should leave the shipping-address hash null when the order has no shipping address (#2395)', async () => {
      const order = createMockOrder();
      order.shippingAddress = undefined as never;
      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.shippingAddressHash).toBeNull();
    });

    // The blank-hash guard ("a blank string is itself a shared grouping key") is
    // asserted where it actually protects routing rather than mocked into being
    // here: `routing-ship-to.types.spec.ts` covers it against `buildRoutingShipTo`,
    // which is the function that decides whether a hash is forwarded to a router.
    // Driving it from this suite needed a module mock of the shared config
    // barrel purely to make a real hash return whitespace, which is machinery in
    // service of a case the production hash cannot produce.

    it('should serialise Order.placedAt into the snapshot as an ISO string when present (#926)', async () => {
      const order = createMockOrder();
      order.placedAt = new Date('2026-05-31T16:00:00.000Z');

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot['placedAt']).toBe('2026-05-31T16:00:00.000Z');
    });

    it('should omit placedAt from the snapshot when the Order does not carry it (#926)', async () => {
      const order = createMockOrder();
      expect(order.placedAt).toBeUndefined();

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot).not.toHaveProperty('placedAt');
    });

    it('should serialise Order.customerEmail into the snapshot when present (#948)', async () => {
      const order = createMockOrder();
      order.customerEmail = 'buyer@example.com';

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot['customerEmail']).toBe('buyer@example.com');
    });

    it('should omit customerEmail from the snapshot when the Order does not carry it (#948)', async () => {
      const order = createMockOrder();
      expect(order.customerEmail).toBeUndefined();

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot).not.toHaveProperty('customerEmail');
    });

    it('should serialise Order.shipping and pickupPoint into the snapshot when present (#952)', async () => {
      const order = createMockOrder();
      order.shipping = { methodId: 'allegro-courier-1', methodName: 'Kurier DPD' };
      order.pickupPoint = { id: 'POZ08A', name: 'Paczkomat POZ08A' };

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot['shipping']).toEqual({
        methodId: 'allegro-courier-1',
        methodName: 'Kurier DPD',
      });
      expect(callArg.orderSnapshot['pickupPoint']).toEqual({
        id: 'POZ08A',
        name: 'Paczkomat POZ08A',
      });
    });

    it('should omit shipping and pickupPoint from the snapshot when the Order does not carry them (#952)', async () => {
      const order = createMockOrder();
      expect(order.shipping).toBeUndefined();
      expect(order.pickupPoint).toBeUndefined();

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot).not.toHaveProperty('shipping');
      expect(callArg.orderSnapshot).not.toHaveProperty('pickupPoint');
    });

    describe('order analytics read-model derivation (#1985)', () => {
      it('derives the 4 scalars from order.totals/placedAt onto the OrderRecord passed to upsertWithLineItems', async () => {
        const order = createMockOrder();
        order.placedAt = new Date('2026-05-31T16:00:00.000Z');
        order.totals.currency = 'PLN';
        order.totals.taxTreatment = 'inclusive';
        order.totals.total = 31.38;

        repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

        await service.persistOrder(order, 'source-connection-123', 'event-456');

        const [callArg] = repository.upsertWithLineItems.mock.calls[0];
        expect(callArg.placedAt).toEqual(new Date('2026-05-31T16:00:00.000Z'));
        expect(callArg.currency).toBe('PLN');
        expect(callArg.taxTreatment).toBe('inclusive');
        expect(callArg.totalAmount).toBe(31.38);
      });

      it('degrades taxTreatment/placedAt to null when the order does not carry them', async () => {
        const order = createMockOrder();
        expect(order.placedAt).toBeUndefined();
        expect(order.totals.taxTreatment).toBeUndefined();

        repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

        await service.persistOrder(order, 'source-connection-123', 'event-456');

        const [callArg] = repository.upsertWithLineItems.mock.calls[0];
        expect(callArg.placedAt).toBeNull();
        expect(callArg.taxTreatment).toBeNull();
      });

      it('derives one line item per order item and passes them as the 2nd argument', async () => {
        const order = createMockOrder();

        repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

        await service.persistOrder(order, 'source-connection-123', 'event-456');

        const [, lineItems] = repository.upsertWithLineItems.mock.calls[0];
        expect(lineItems).toEqual([
          {
            lineNumber: 0,
            productId: 'product-1',
            variantId: 'variant-1',
            quantity: 2,
            unitPrice: 10.99,
            sourceConnectionId: 'source-connection-123',
            placedAt: null,
            // #2250 - the snapshot line carried no rate, so the transcribed row
            // carries none. No default: a row that disagreed with the snapshot
            // it copies would be worse than an empty one.
            taxRate: null,
            taxSource: null,
            taxRateReadAt: null,
          },
        ]);
      });
    });
  });

  describe('persistOrder - PII disabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'false';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);
    });

    it('should store no buyer tax id at all when PII storage is disabled (#2599)', async () => {
      const order = createMockOrder();
      order.billingAddress = { ...order.billingAddress!, taxId: '1234567890' };

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.buyerTaxId).toBeNull();
      expect(callArg.orderSnapshot.billingAddress).not.toHaveProperty('taxId');
    });

    it('should still stamp the shipping-address hash when PII storage is disabled (#2395)', async () => {
      // The whole point: `RoutingShipTo`'s degraded arm serves exactly this
      // deployment, so the hash must NOT be PII-gated the way `buyerTaxId` is.
      // It is also derived from the LIVE address, so it must not collapse to
      // the one-hash-per-country value that hashing the redacted snapshot
      // would produce - assert it differs between two distinct addresses in
      // the same country.
      const order = createMockOrder();
      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');
      const first = repository.upsertWithLineItems.mock.calls[0][0].shippingAddressHash;
      expect(first).toEqual(expect.any(String));
      expect(first).not.toBe('');

      const other = createMockOrder();
      other.shippingAddress = {
        ...other.shippingAddress!,
        address1: 'Somewhere Else 999',
        city: 'Gdansk',
        postalCode: '80-001',
      };
      repository.upsertWithLineItems.mockClear();
      await service.persistOrder(other, 'source-connection-123', 'event-457');
      expect(repository.upsertWithLineItems.mock.calls[0][0].shippingAddressHash).not.toBe(first);
    });

    it('should persist order with sanitized addresses when PII storage is disabled', async () => {
      const order = createMockOrder();
      const sourceConnectionId = 'source-connection-123';
      const sourceEventId = 'event-456';

      const expectedOrderRecord = new OrderRecord(
        order.id,
        order.customerId || null,
        sourceConnectionId,
        sourceEventId,
        expect.objectContaining({
          id: order.id,
          orderNumber: order.orderNumber,
        }),
        [],
        'ready',
        expect.any(Date),
        expect.any(Date)
      );

      repository.upsertWithLineItems.mockResolvedValue(expectedOrderRecord);

      const result = await service.persistOrder(order, sourceConnectionId, sourceEventId);

      expect(result).toBe(expectedOrderRecord);
      expect(repository.upsertWithLineItems).toHaveBeenCalledTimes(1);
      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot.shippingAddress).toEqual({
        address1: '[REDACTED]',
        city: '[REDACTED]',
        postalCode: '[REDACTED]',
        country: 'US',
      });
      expect(callArg.orderSnapshot.billingAddress).toEqual({
        address1: '[REDACTED]',
        city: '[REDACTED]',
        postalCode: '[REDACTED]',
        country: 'US',
      });
    });

    it('should handle missing addresses gracefully', async () => {
      const order = createMockOrder();
      order.shippingAddress = undefined;
      order.billingAddress = undefined;

      const sourceConnectionId = 'source-connection-123';
      const sourceEventId = 'event-456';

      const expectedOrderRecord = new OrderRecord(
        order.id,
        order.customerId || null,
        sourceConnectionId,
        sourceEventId,
        expect.objectContaining({
          id: order.id,
        }),
        [],
        'ready',
        expect.any(Date),
        expect.any(Date)
      );

      repository.upsertWithLineItems.mockResolvedValue(expectedOrderRecord);

      const result = await service.persistOrder(order, sourceConnectionId, sourceEventId);

      expect(result).toBe(expectedOrderRecord);
      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot.shippingAddress).toBeUndefined();
      expect(callArg.orderSnapshot.billingAddress).toBeUndefined();
    });

    it('should omit customerEmail under hash-only PII mode even when present (#948)', async () => {
      const order = createMockOrder();
      order.customerEmail = 'buyer@example.com';

      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.orderSnapshot).not.toHaveProperty('customerEmail');
    });
  });

  describe('persistOrder — cancellation recorded via markCancelled (#1984)', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);
    });

    it('never constructs the OrderRecord passed to upsertWithLineItems() with a non-null cancelledAt, even for a cancelled order', async () => {
      // The domain OrderRecord built here always defaults cancelledAt to null
      // (persistOrder never threads order.status into the constructor) —
      // markCancelled (asserted in the next test) is the sole writer. This
      // guards against a future regression where someone "helpfully" starts
      // passing a derived cancelledAt into the constructor, which would let
      // upsertWithLineItems()'s full-object save() race markCancelled's atomic
      // COALESCE update — see the toOrm comment on OrderRecordRepository.
      const order = createMockOrder();
      order.status = 'cancelled';
      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);
      repository.findById.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.cancelledAt).toBeNull();
    });

    it('calls markCancelled with (approximately) now for a cancelled order, AFTER upsertWithLineItems', async () => {
      const order = createMockOrder();
      order.status = 'cancelled';
      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);
      repository.findById.mockResolvedValue({} as OrderRecord);

      const before = new Date();
      await service.persistOrder(order, 'source-connection-123', 'event-456');
      const after = new Date();

      expect(repository.markCancelled).toHaveBeenCalledTimes(1);
      const [calledId, calledAt] = repository.markCancelled.mock.calls[0];
      expect(calledId).toBe(order.id);
      expect(calledAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(calledAt.getTime()).toBeLessThanOrEqual(after.getTime());
      const upsertOrder = repository.upsertWithLineItems.mock.invocationCallOrder[0];
      const markCancelledOrder = repository.markCancelled.mock.invocationCallOrder[0];
      expect(upsertOrder).toBeLessThan(markCancelledOrder);
    });

    it('returns the re-fetched record so the caller sees the recorded cancellation', async () => {
      const order = createMockOrder();
      order.status = 'cancelled';
      const refetched = { cancelledAt: new Date() } as unknown as OrderRecord;
      repository.upsertWithLineItems.mockResolvedValue({ cancelledAt: null } as unknown as OrderRecord);
      repository.findById.mockResolvedValue(refetched);

      const result = await service.persistOrder(order, 'source-connection-123', 'event-456');

      expect(result).toBe(refetched);
    });

    it('does not call markCancelled or re-fetch for a non-cancelled order', async () => {
      const order = createMockOrder();
      order.status = 'pending';
      const saved = {} as OrderRecord;
      repository.upsertWithLineItems.mockResolvedValue(saved);

      const result = await service.persistOrder(order, 'source-connection-123', 'event-456');

      expect(repository.markCancelled).not.toHaveBeenCalled();
      expect(repository.findById).not.toHaveBeenCalled();
      expect(result).toBe(saved);
    });
  });

  describe('persistOrder - fulfillment rollup left to updateFulfillmentState (#2101)', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);
    });

    it('never constructs the OrderRecord passed to upsertWithLineItems() with a fulfillment state', async () => {
      // No order source reports a fulfillment state, so the ingestion path must
      // leave the field at its null default. Passing a derived value here would
      // let the upsert's full-object save() reset the rollup the shipping
      // context committed out-of-band - see the toOrm comment in
      // OrderRecordRepository.
      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(createMockOrder(), 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.fulfillmentState).toBeNull();
    });
  });

  describe('persist paths - destination sync state left to updateSyncStatus (#2140)', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);
    });

    it('never constructs the OrderRecord passed to upsertWithLineItems() with sync state', async () => {
      // No order source reports OL's own destination sync state. The empty
      // arrays here are the ingestion path declining to have an opinion; the
      // upsert then omits both columns so a re-ingestion cannot erase what
      // updateSyncStatus committed - see the toOrm comment in
      // OrderRecordRepository.
      repository.upsertWithLineItems.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(createMockOrder(), 'source-connection-123', 'event-456');

      const [callArg] = repository.upsertWithLineItems.mock.calls[0];
      expect(callArg.syncStatus).toEqual([]);
      expect(callArg.syncAttempts).toEqual([]);
    });

    it('never constructs the snapshot OrderRecord with sync state either', async () => {
      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(
        createMockIncomingOrder(),
        'ol_order_abc123',
        null,
        'source-connection-123',
        'event-456'
      );

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.syncStatus).toEqual([]);
      expect(callArg.syncAttempts).toEqual([]);
    });
  });

  describe('persistIncomingSnapshot', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);
    });

    it('should persist incoming snapshot with awaiting_mapping status', async () => {
      const incoming = createMockIncomingOrder();
      const internalOrderId = 'ol_order_abc123';
      const customerId = 'ol_customer_xyz';
      const sourceConnectionId = 'conn-123';
      const sourceEventId = 'event-456';

      const expectedRecord = new OrderRecord(
        internalOrderId,
        customerId,
        sourceConnectionId,
        sourceEventId,
        expect.objectContaining({ externalOrderId: incoming.externalOrderId }),
        [],
        'awaiting_mapping',
        expect.any(Date),
        expect.any(Date)
      );

      repository.upsert.mockResolvedValue(expectedRecord);

      const result = await service.persistIncomingSnapshot(
        incoming,
        internalOrderId,
        customerId,
        sourceConnectionId,
        sourceEventId
      );

      expect(result).toBe(expectedRecord);
      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.recordStatus).toBe('awaiting_mapping');
      expect(callArg.orderSnapshot['externalOrderId']).toBe(incoming.externalOrderId);
      expect(callArg.orderSnapshot['items']).toEqual(incoming.items);
    });

    it('should pass incoming.placedAt through into the raw snapshot when present (#926)', async () => {
      const incoming = { ...createMockIncomingOrder(), placedAt: '2026-05-31T16:00:00.000Z' };

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-1', 'evt-1');

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot['placedAt']).toBe('2026-05-31T16:00:00.000Z');
    });

    it('should omit placedAt from the raw snapshot when incoming does not carry it (#926)', async () => {
      const incoming = createMockIncomingOrder();
      expect(incoming.placedAt).toBeUndefined();

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-1', 'evt-1');

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot).not.toHaveProperty('placedAt');
    });

    it('should sanitize addresses in snapshot when PII is disabled', async () => {
      process.env.OL_STORE_PII = 'false';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);

      const incoming = createMockIncomingOrder();
      const expectedRecord = new OrderRecord(
        'ol_order_abc',
        null,
        'conn-123',
        null,
        expect.objectContaining({}),
        [],
        'awaiting_mapping',
        expect.any(Date),
        expect.any(Date)
      );
      repository.upsert.mockResolvedValue(expectedRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot['shippingAddress']).toEqual({
        address1: '[REDACTED]',
        city: '[REDACTED]',
        postalCode: '[REDACTED]',
        country: 'US',
      });
    });

    it('should serialise IncomingOrder.deliverySmart into the snapshot when present (#738)', async () => {
      const incoming = createMockIncomingOrder();
      incoming.deliverySmart = false;

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot['deliverySmart']).toBe(false);
    });

    it('should omit deliverySmart from the snapshot when IncomingOrder does not carry it (#738)', async () => {
      const incoming = createMockIncomingOrder();
      expect(incoming.deliverySmart).toBeUndefined();

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot).not.toHaveProperty('deliverySmart');
    });

    it('should serialise IncomingOrder.customerEmail into the snapshot when present (#948)', async () => {
      const incoming = createMockIncomingOrder(); // carries customerEmail

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot['customerEmail']).toBe('buyer@example.com');
    });

    it('should omit customerEmail from the snapshot when IncomingOrder does not carry it (#948)', async () => {
      const incoming = { ...createMockIncomingOrder(), customerEmail: undefined };

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot).not.toHaveProperty('customerEmail');
    });

    it('should omit customerEmail from the snapshot under hash-only PII mode (#948)', async () => {
      process.env.OL_STORE_PII = 'false';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);

      const incoming = createMockIncomingOrder();
      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot).not.toHaveProperty('customerEmail');
    });

    it('should serialise IncomingOrder.shipping and pickupPoint into the snapshot when present (#952)', async () => {
      const incoming = {
        ...createMockIncomingOrder(),
        shipping: { methodId: 'allegro-courier-1', methodName: 'Kurier DPD' },
        pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A' },
      };

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot['shipping']).toEqual({
        methodId: 'allegro-courier-1',
        methodName: 'Kurier DPD',
      });
      expect(callArg.orderSnapshot['pickupPoint']).toEqual({
        id: 'POZ08A',
        name: 'Paczkomat POZ08A',
      });
    });

    it('should omit shipping and pickupPoint from the snapshot when IncomingOrder does not carry them (#952)', async () => {
      const incoming = createMockIncomingOrder();
      expect(incoming.shipping).toBeUndefined();
      expect(incoming.pickupPoint).toBeUndefined();

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot).not.toHaveProperty('shipping');
      expect(callArg.orderSnapshot).not.toHaveProperty('pickupPoint');
    });
  });

  describe('persistIncomingSnapshot — cancellation recorded via markCancelled (#1984)', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      service = new OrderRecordService(repository, fxStamp, lineItemRepository, reportingCurrencySettings, automationEmission);
    });

    it('never constructs the OrderRecord passed to upsert() with a non-null cancelledAt, even for a cancelled order', async () => {
      const incoming = createMockIncomingOrder();
      incoming.status = 'cancelled';
      repository.upsert.mockResolvedValue({} as OrderRecord);
      repository.findById.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.cancelledAt).toBeNull();
    });

    it('calls markCancelled AFTER upsert for a cancelled order whose items have not resolved yet', async () => {
      const incoming = createMockIncomingOrder();
      incoming.status = 'cancelled';
      repository.upsert.mockResolvedValue({} as OrderRecord);
      repository.findById.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      expect(repository.markCancelled).toHaveBeenCalledWith('ol_order_abc', expect.any(Date));
      const upsertOrder = repository.upsert.mock.invocationCallOrder[0];
      const markCancelledOrder = repository.markCancelled.mock.invocationCallOrder[0];
      expect(upsertOrder).toBeLessThan(markCancelledOrder);
    });

    it('does not call markCancelled for a non-cancelled order', async () => {
      const incoming = createMockIncomingOrder();
      incoming.status = 'pending';
      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      expect(repository.markCancelled).not.toHaveBeenCalled();
    });
  });

  describe('updateSyncStatus', () => {
    const FROZEN_NOW = new Date('2026-04-30T11:22:33.000Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(FROZEN_NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should pass through status and stamp attemptedAt with the current time', async () => {
      const internalOrderId = 'order-123';
      const destinationConnectionId = 'dest-connection-456';
      const status: OrderSyncStatus = {
        destinationConnectionId,
        status: 'synced',
        syncedAt: new Date('2026-04-30T11:22:33.000Z'),
        externalOrderId: 'external-order-789',
        externalOrderNumber: 'EXT-001',
      };

      repository.updateSyncStatus.mockResolvedValue();

      await service.updateSyncStatus(internalOrderId, destinationConnectionId, status);

      expect(repository.updateSyncStatus).toHaveBeenCalledWith(
        internalOrderId,
        destinationConnectionId,
        status,
        {
          destinationConnectionId,
          status: 'synced',
          attemptedAt: FROZEN_NOW,
          error: undefined,
          externalOrderId: 'external-order-789',
          externalOrderNumber: 'EXT-001',
        }
      );
    });

    it('should propagate the error onto the attempt for failed status', async () => {
      const internalOrderId = 'order-123';
      const destinationConnectionId = 'dest-connection-456';
      const status: OrderSyncStatus = {
        destinationConnectionId,
        status: 'failed',
        error: 'Sync failed: Connection timeout',
      };

      repository.updateSyncStatus.mockResolvedValue();

      await service.updateSyncStatus(internalOrderId, destinationConnectionId, status);

      expect(repository.updateSyncStatus).toHaveBeenCalledWith(
        internalOrderId,
        destinationConnectionId,
        status,
        expect.objectContaining({
          destinationConnectionId,
          status: 'failed',
          attemptedAt: FROZEN_NOW,
          error: 'Sync failed: Connection timeout',
        })
      );
    });
  });

  describe('getOrderRecord', () => {
    it('should retrieve order record by ID', async () => {
      const internalOrderId = 'order-123';
      const expectedRecord = new OrderRecord(
        internalOrderId,
        'customer-456',
        'source-connection-123',
        'event-456',
        { id: internalOrderId },
        [],
        'ready',
        new Date(),
        new Date()
      );

      repository.findById.mockResolvedValue(expectedRecord);

      const result = await service.getOrderRecord(internalOrderId);

      expect(result).toBe(expectedRecord);
      expect(repository.findById).toHaveBeenCalledWith(internalOrderId);
    });

    it('should return null when order record not found', async () => {
      const internalOrderId = 'non-existent-order';

      repository.findById.mockResolvedValue(null);

      const result = await service.getOrderRecord(internalOrderId);

      expect(result).toBeNull();
      expect(repository.findById).toHaveBeenCalledWith(internalOrderId);
    });
  });

  describe('findByIds (#1995)', () => {
    it('delegates to the repository as a pure passthrough', async () => {
      const records = [
        new OrderRecord(
          'order-123',
          'customer-456',
          'source-connection-123',
          'event-456',
          { id: 'order-123' },
          [],
          'ready',
          new Date(),
          new Date()
        ),
      ];
      repository.findByIds.mockResolvedValue(records);

      const result = await service.findByIds(['order-123', 'order-456']);

      expect(result).toBe(records);
      expect(repository.findByIds).toHaveBeenCalledWith(['order-123', 'order-456']);
    });
  });

  describe('discoverSalesDocumentMarkets (#2518, ADR-066)', () => {
    it('reports the window it applied and derives `since` from it', async () => {
      repository.countOrdersByRoutingCountrySince.mockResolvedValue([]);

      const result = await service.discoverSalesDocumentMarkets(
        new Date('2026-08-30T10:00:00.000Z'),
      );

      expect(result.windowDays).toBe(30);
      expect(result.since).toBe('2026-07-31T10:00:00.000Z');
      expect(repository.countOrdersByRoutingCountrySince).toHaveBeenCalledWith(
        new Date('2026-07-31T10:00:00.000Z'),
      );
    });

    it('returns configured and unconfigured markets alike, most orders first', async () => {
      repository.countOrdersByRoutingCountrySince.mockResolvedValue([
        { country: 'PL', orderCount: 47 },
        { country: 'DE', orderCount: 12 },
        { country: 'CZ', orderCount: 6 },
      ]);

      const result = await service.discoverSalesDocumentMarkets(new Date());

      // No `configured` / `hasTemplate` flag: classification is the caller's
      // job, so this read cannot become a second source of truth for it.
      expect(result.markets).toEqual([
        { country: 'PL', orderCount: 47 },
        { country: 'DE', orderCount: 12 },
        { country: 'CZ', orderCount: 6 },
      ]);
    });

    it('reports no markets on an instance with no orders in the window', async () => {
      repository.countOrdersByRoutingCountrySince.mockResolvedValue([]);

      const result = await service.discoverSalesDocumentMarkets(new Date());

      // A brand-new install is a legitimate state, not an error.
      expect(result.markets).toEqual([]);
    });

    it('issues ONE read, never one per country', async () => {
      repository.countOrdersByRoutingCountrySince.mockResolvedValue([
        { country: 'PL', orderCount: 47 },
        { country: 'DE', orderCount: 12 },
      ]);

      await service.discoverSalesDocumentMarkets(new Date());

      expect(repository.countOrdersByRoutingCountrySince).toHaveBeenCalledTimes(1);
    });

    it('writes nothing', async () => {
      repository.countOrdersByRoutingCountrySince.mockResolvedValue([]);

      await service.discoverSalesDocumentMarkets(new Date());

      // Discovery must never create routing on its own (ADR-066 decision 1).
      expect(repository.upsert).not.toHaveBeenCalled();
      expect(repository.upsertWithLineItems).not.toHaveBeenCalled();
      expect(repository.updateSalesDocumentBlock).not.toHaveBeenCalled();
    });
  });

  describe('getEarliestOrderDateByConnection (#2083)', () => {
    it('delegates to the repository as a pure passthrough', async () => {
      const map = new Map([['conn-1', new Date('2026-01-01T00:00:00.000Z')]]);
      repository.findEarliestOrderDateByConnection.mockResolvedValue(map);

      const result = await service.getEarliestOrderDateByConnection(['conn-1', 'conn-2']);

      expect(result).toBe(map);
      expect(repository.findEarliestOrderDateByConnection).toHaveBeenCalledWith([
        'conn-1',
        'conn-2',
      ]);
    });
  });

  describe('markItemResolutionFailure (#1689)', () => {
    it('delegates to the repository as a narrow absolute-set — no read-modify-write', async () => {
      const internalOrderId = 'order-123';

      await service.markItemResolutionFailure(internalOrderId, {
        status: 'source_deleted',
        reason: 'variant ol_variant_b deleted at the master',
      });

      expect(repository.findById).not.toHaveBeenCalled();
      expect(repository.updateItemResolutionFailure).toHaveBeenCalledWith(internalOrderId, {
        status: 'source_deleted',
        reason: 'variant ol_variant_b deleted at the master',
      });
    });
  });

  describe('markCancelled (#1984)', () => {
    it('delegates to the repository as a pure passthrough', async () => {
      const internalOrderId = 'order-123';
      const cancelledAt = new Date('2026-08-11T09:00:00Z');

      await service.markCancelled(internalOrderId, cancelledAt);

      expect(repository.markCancelled).toHaveBeenCalledWith(internalOrderId, cancelledAt);
    });
  });

  describe('markSalesDocumentBlock (#2100)', () => {
    it('should pass the reported block straight through to the repository', async () => {
      const block = {
        reason: 'unresolved-routing',
        unresolvedReason: 'ambiguous-connection-no-primary',
        detail: '2 invoicing connections, none marked primary',
      } as const;

      await service.markSalesDocumentBlock('ol_order_abc', block);

      expect(repository.updateSalesDocumentBlock).toHaveBeenCalledWith('ol_order_abc', block);
    });

    it('should pass null through — the clear is the ordinary path, not an edge case', async () => {
      await service.markSalesDocumentBlock('ol_order_abc', null);

      expect(repository.updateSalesDocumentBlock).toHaveBeenCalledWith('ol_order_abc', null);
    });

    it('should not accumulate: repeated calls with the same reason are plain absolute-sets', async () => {
      const block = { reason: 'trigger-model-manual' } as const;

      await service.markSalesDocumentBlock('ol_order_abc', block);
      await service.markSalesDocumentBlock('ol_order_abc', block);
      await service.markSalesDocumentBlock('ol_order_abc', block);

      // The gate is level-evaluated and fires on EVERY transition, so this method
      // is called repeatedly for one order. It must stay an absolute-set (one row,
      // one state) rather than anything append-shaped.
      expect(repository.updateSalesDocumentBlock).toHaveBeenCalledTimes(3);
      for (const call of repository.updateSalesDocumentBlock.mock.calls) {
        expect(call).toEqual(['ol_order_abc', block]);
      }
    });
  });

  describe('getSalesAndChannelAnalytics (#1987)', () => {
    const filters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    it('composes the three raw reads + earliest-date lookup into the response', async () => {
      reportingCurrencySettings.resolve.mockResolvedValue('EUR');
      const dailyRows = [
        {
          day: new Date('2026-08-01T00:00:00.000Z'),
          sourceConnectionId: 'conn-a',
          orderCount: 2,
          revenue: 200,
          unconvertedCount: 0,
          unconvertedValue: 0,
          unconvertedCurrency: null,
          cancelledCount: 0,
          cancelledValue: 0,
          reportingCurrency: 'EUR',
          netRevenue: 150,
          netExcludedCount: 0,
          netExcludedValue: 0,
        },
      ];
      const unitsByConnection = new Map([['conn-a', { unitsSold: 5, unconvertedUnitsSold: 0 }]]);
      const earliestMap = new Map([['conn-a', new Date('2026-07-01T00:00:00.000Z')]]);

      repository.getDailyOrderAggregates.mockResolvedValue(dailyRows);
      repository.getMedianOrderValue.mockResolvedValue(90);
      repository.getNetMedianOrderValue.mockResolvedValue(80);
      lineItemRepository.getUnitsSoldByConnection.mockResolvedValue(unitsByConnection);
      repository.findEarliestOrderDateByConnection.mockResolvedValue(earliestMap);

      const result = await service.getSalesAndChannelAnalytics(filters);

      expect(repository.getDailyOrderAggregates).toHaveBeenCalledWith(filters, 'EUR');
      expect(repository.getMedianOrderValue).toHaveBeenCalledWith(filters, 'EUR');
      expect(repository.getNetMedianOrderValue).toHaveBeenCalledWith(filters, 'EUR');
      expect(lineItemRepository.getUnitsSoldByConnection).toHaveBeenCalledWith(filters, 'EUR');
      expect(repository.findEarliestOrderDateByConnection).toHaveBeenCalledWith(['conn-a']);
      expect(result.headline.revenue).toBe(200);
      expect(result.headline.medianOrderValue).toBe(90);
      expect(result.headline.netMedianOrderValue).toBe(80);
      expect(result.headline.netRevenue).toBe(150);
      expect(result.headline.unitsSold).toBe(5);
      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].coverageComplete).toBe(true);
    });

    it('derives the earliest-date lookup scope from the connections present in dailyRows only', async () => {
      repository.getDailyOrderAggregates.mockResolvedValue([]);
      repository.getMedianOrderValue.mockResolvedValue(null);
      repository.getNetMedianOrderValue.mockResolvedValue(null);
      lineItemRepository.getUnitsSoldByConnection.mockResolvedValue(new Map());
      repository.findEarliestOrderDateByConnection.mockResolvedValue(new Map());

      const result = await service.getSalesAndChannelAnalytics(filters);

      expect(repository.findEarliestOrderDateByConnection).toHaveBeenCalledWith([]);
      expect(result.headline.revenue).toBe(0);
      expect(result.channels).toEqual([]);
    });
  });

  describe('getTopProducts (#1988)', () => {
    const filters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
      sortBy: 'revenue' as const,
      limit: 20,
      offset: 0,
    };

    it('composes the ranking read + a breakdown read scoped to the ranked page only', async () => {
      const ranking = [
        {
          productId: 'p1',
          units: 10,
          revenue: 100,
          unconvertedRevenue: 0,
          unconvertedOrderCount: 0,
          currency: 'EUR',
          unconvertedCurrency: null,
          netRevenue: 80,
          netExcludedRevenue: 20,
          netExcludedLineCount: 1,
        },
        {
          productId: 'p2',
          units: 5,
          revenue: 50,
          unconvertedRevenue: 0,
          unconvertedOrderCount: 0,
          currency: 'EUR',
          unconvertedCurrency: null,
          netRevenue: 50,
          netExcludedRevenue: 0,
          netExcludedLineCount: 0,
        },
      ];
      const breakdown = [
        {
          productId: 'p1',
          sourceConnectionId: 'conn-a',
          units: 10,
          revenue: 100,
          unconvertedRevenue: 0,
          currency: 'EUR',
          unconvertedCurrency: null,
          netRevenue: 80,
          netExcludedRevenue: 20,
          netExcludedLineCount: 1,
        },
        {
          productId: 'p2',
          sourceConnectionId: 'conn-b',
          units: 5,
          revenue: 50,
          unconvertedRevenue: 0,
          currency: 'EUR',
          unconvertedCurrency: null,
          netRevenue: 50,
          netExcludedRevenue: 0,
          netExcludedLineCount: 0,
        },
      ];
      lineItemRepository.getTopProductRanking.mockResolvedValue({ rows: ranking, total: 2 });
      lineItemRepository.getProductChannelBreakdown.mockResolvedValue(breakdown);

      const result = await service.getTopProducts(filters);

      expect(lineItemRepository.getTopProductRanking).toHaveBeenCalledWith(filters, 'PLN');
      // Breakdown query MUST receive only the ranked page's product ids —
      // never re-derived from the full scoped set — to keep its cost bounded
      // by page size (#1988 correctness requirement).
      expect(lineItemRepository.getProductChannelBreakdown).toHaveBeenCalledWith(
        ['p1', 'p2'],
        filters,
        'PLN'
      );
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].channels).toEqual([breakdown[0]]);
      expect(result.items[1].channels).toEqual([breakdown[1]]);
    });

    it('does not call the breakdown read with product ids outside the ranked page', async () => {
      lineItemRepository.getTopProductRanking.mockResolvedValue({
        rows: [
          {
            productId: 'p1',
            units: 1,
            revenue: 1,
            unconvertedRevenue: 0,
            unconvertedOrderCount: 0,
            currency: 'EUR',
            unconvertedCurrency: null,
            netRevenue: 1,
            netExcludedRevenue: 0,
            netExcludedLineCount: 0,
          },
        ],
        total: 500,
      });
      lineItemRepository.getProductChannelBreakdown.mockResolvedValue([]);

      await service.getTopProducts(filters);

      expect(lineItemRepository.getProductChannelBreakdown).toHaveBeenCalledWith(
        ['p1'],
        filters,
        'PLN'
      );
    });

    it('returns an empty page and zero total when nothing matches', async () => {
      lineItemRepository.getTopProductRanking.mockResolvedValue({ rows: [], total: 0 });
      lineItemRepository.getProductChannelBreakdown.mockResolvedValue([]);

      const result = await service.getTopProducts(filters);

      expect(lineItemRepository.getProductChannelBreakdown).toHaveBeenCalledWith(
        [],
        filters,
        'PLN'
      );
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('resolves the CURRENT reporting currency and never mixes a prior era into revenue (#2049/ADR-040 bugfix)', async () => {
      reportingCurrencySettings.resolve.mockResolvedValue('EUR');
      lineItemRepository.getTopProductRanking.mockResolvedValue({ rows: [], total: 0 });
      lineItemRepository.getProductChannelBreakdown.mockResolvedValue([]);

      await service.getTopProducts(filters);

      expect(reportingCurrencySettings.resolve).toHaveBeenCalled();
      expect(lineItemRepository.getTopProductRanking).toHaveBeenCalledWith(filters, 'EUR');
      expect(lineItemRepository.getProductChannelBreakdown).toHaveBeenCalledWith(
        [],
        filters,
        'EUR'
      );
    });
  });

  describe('getCurrencyMismatchOrders (#2466)', () => {
    it('is a thin pass-through to the repository read, forwarding args verbatim', async () => {
      const salesFilters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      };
      const pagination = { limit: 10, offset: 0 };
      repository.findCurrencyMismatchOrders.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getCurrencyMismatchOrders(salesFilters, 'EUR', pagination);

      expect(repository.findCurrencyMismatchOrders).toHaveBeenCalledWith(
        salesFilters,
        'EUR',
        pagination
      );
      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('getProductMatchingErrorOrders (#2466)', () => {
    it('is a thin pass-through to the repository read, forwarding args verbatim', async () => {
      const healthFilters = { sourceConnectionId: 'conn-a' };
      const pagination = { limit: 10, offset: 0 };
      repository.findProductMatchingErrorOrders.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getProductMatchingErrorOrders(healthFilters, pagination);

      expect(repository.findProductMatchingErrorOrders).toHaveBeenCalledWith(
        healthFilters,
        pagination
      );
      expect(result).toEqual({ items: [], total: 0 });
    });
  });
});
