import type { ICustomerProjectionService } from '@openlinker/core/customers';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IOperationalSettingsService } from '@openlinker/core/operational-settings';
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { BuyerDataRetentionService } from './buyer-data-retention.service';

const setting = <T>(value: T) => ({ value, source: 'setting' as const, workerMayDiffer: false });

describe('BuyerDataRetentionService', () => {
  let orders: jest.Mocked<OrderRecordRepositoryPort>;
  let customers: jest.Mocked<ICustomerProjectionService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let settings: jest.Mocked<IOperationalSettingsService>;
  let service: BuyerDataRetentionService;

  const connection = (id: string, config: Record<string, unknown> = {}) => ({
    connectionId: id,
    connection: { id, config },
    adapter: {},
    metadata: {},
  });

  beforeEach(() => {
    orders = {
      countBuyerDataRetentionCandidates: jest
        .fn()
        .mockResolvedValue({
          toHide: 2,
          toErase: 1,
          total: 2,
          skippedProtected: 3,
          skippedByReason: { openReturn: 1, hold: 1, invoicePending: 1 },
        }),
      countVisibleOrdersForBuyerData: jest.fn().mockResolvedValue(10),
      findBuyerDataRetentionSamples: jest.fn().mockResolvedValue([]),
      getBuyerDataAgeHistogram: jest.fn(),
      hideOrdersForBuyerDataRetention: jest.fn().mockResolvedValue(0),
      findErasableOrdersForBuyerDataRetention: jest.fn().mockResolvedValue([]),
      erasePersonalDataForRetention: jest.fn().mockResolvedValue({ erased: 0, customerIds: [] }),
      findCustomerIdsWithoutPersonalDataOrders: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<OrderRecordRepositoryPort>;
    customers = {
      clearPersonalData: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<ICustomerProjectionService>;
    integrations = {
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;
    settings = {
      resolve: jest.fn().mockResolvedValue({
        buyerDataRetentionEnabled: setting(true),
        buyerDataHideAfterDays: setting(180),
        buyerDataEraseAfterDays: setting(365),
        buyerDataEraseMode: setting('personal-data'),
      }),
      updateSettings: jest.fn(),
    } as unknown as jest.Mocked<IOperationalSettingsService>;
    service = new BuyerDataRetentionService(orders, settings, integrations, customers);
  });

  it('should preview without writing anything', async () => {
    const result = await service.preview({
      hideAfterDays: 180,
      eraseAfterDays: 365,
      mode: 'whole-order',
    });
    expect(result).toMatchObject({
      toHide: 2,
      toErase: 1,
      skippedProtected: 3,
      skippedByReason: { openReturn: 1, hold: 1, invoicePending: 1 },
      totalOrders: 10,
    });
    expect(orders.countBuyerDataRetentionCandidates.mock.calls[0][0].eraseHides).toBe(true);
    expect(orders.hideOrdersForBuyerDataRetention).not.toHaveBeenCalled();
    expect(orders.erasePersonalDataForRetention).not.toHaveBeenCalled();
  });

  it('should densify the age histogram and serialise the oldest instant', async () => {
    orders.getBuyerDataAgeHistogram.mockResolvedValue({
      rows: [
        { ageMonths: 1, visible: 2, hidden: 0, erased: 0 },
        { ageMonths: 4, visible: 0, hidden: 1, erased: 3 },
      ],
      totalOrders: 6,
      oldestPlacedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const result = await service.getAgeHistogram('c1', new Date('2026-11-24T00:00:00Z'));
    expect(result.bucketUnit).toBe('month');
    expect(result.buckets.map((b) => b.ageMonths)).toEqual([0, 1, 2, 3, 4]);
    expect(result.buckets[2]).toEqual({ ageMonths: 2, visible: 0, hidden: 0, erased: 0 });
    expect(result.totalOrders).toBe(6);
    expect(result.oldestPlacedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(orders.getBuyerDataAgeHistogram.mock.calls[0][1]).toBe('c1');
  });

  it('should return an empty histogram for an empty order book', async () => {
    orders.getBuyerDataAgeHistogram.mockResolvedValue({
      rows: [],
      totalOrders: 0,
      oldestPlacedAt: null,
    });
    const result = await service.getAgeHistogram();
    expect(result).toEqual({
      bucketUnit: 'month',
      buckets: [],
      totalOrders: 0,
      oldestPlacedAt: null,
    });
  });

  it('should skip a connection whose own override turns retention off', async () => {
    integrations.listCapabilityAdapters.mockResolvedValue([
      connection('c1', { buyerDataRetention: { enabled: false } }),
    ] as never);
    await service.runOnce(new Date());
    expect(orders.hideOrdersForBuyerDataRetention).not.toHaveBeenCalled();
    expect(orders.findErasableOrdersForBuyerDataRetention).not.toHaveBeenCalled();
  });

  it('should sweep a connection whose own override carries no enabled key when the global switch is on', async () => {
    integrations.listCapabilityAdapters.mockResolvedValue([
      connection('c1', { buyerDataRetention: { hideAfterDays: 30, eraseAfterDays: 0 } }),
    ] as never);
    await service.runOnce(new Date());
    expect(orders.hideOrdersForBuyerDataRetention).toHaveBeenCalled();
  });

  it('should apply the connection override over the global period', async () => {
    integrations.listCapabilityAdapters.mockResolvedValue([
      connection('c1', { buyerDataRetention: { hideAfterDays: 30, eraseAfterDays: 0 } }),
    ] as never);
    const now = new Date('2026-11-24T00:00:00Z');
    await service.runOnce(now);
    const before = orders.hideOrdersForBuyerDataRetention.mock.calls[0][1];
    expect(before.getTime()).toBe(now.getTime() - 30 * 86_400_000);
    expect(orders.findErasableOrdersForBuyerDataRetention).not.toHaveBeenCalled();
  });

  it('should erase, hide in whole-order mode, and clear only fully erased customers', async () => {
    settings.resolve.mockResolvedValue({
      buyerDataRetentionEnabled: setting(true),
      buyerDataHideAfterDays: setting(0),
      buyerDataEraseAfterDays: setting(365),
      buyerDataEraseMode: setting('whole-order'),
    } as never);
    integrations.listCapabilityAdapters.mockResolvedValue([connection('c1')] as never);
    orders.findErasableOrdersForBuyerDataRetention.mockResolvedValue([
      {
        internalOrderId: 'o1',
        customerId: 'cust1',
        orderSnapshot: {
          customerEmail: 'a@b.c',
          shippingAddress: { address1: 'x', city: 'y', postalCode: 'z', country: 'PL' },
        },
      },
    ]);
    orders.erasePersonalDataForRetention.mockResolvedValue({ erased: 1, customerIds: ['cust1'] });
    orders.findCustomerIdsWithoutPersonalDataOrders.mockResolvedValue(['cust1']);
    customers.clearPersonalData.mockResolvedValue(1);

    const result = await service.runOnce(new Date());

    const [erasures] = orders.erasePersonalDataForRetention.mock.calls[0];
    expect(erasures[0].hide).toBe(true);
    expect(JSON.stringify(erasures[0].orderSnapshot)).not.toContain('a@b.c');
    expect(customers.clearPersonalData).toHaveBeenCalledWith(['cust1']);
    expect(result).toMatchObject({ erased: 1, customersCleared: 1 });
  });

  it('should keep going when one connection fails', async () => {
    integrations.listCapabilityAdapters.mockResolvedValue([
      connection('c1'),
      connection('c2'),
    ] as never);
    orders.hideOrdersForBuyerDataRetention
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(0);
    await expect(service.runOnce(new Date())).resolves.toBeDefined();
    expect(orders.hideOrdersForBuyerDataRetention).toHaveBeenCalledTimes(2);
  });
});
