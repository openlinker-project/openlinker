/**
 * PrestaShop Order Processor Manager - OrderCreateStockEffect
 *
 * The adapter answers for the order IT just created: PrestaShop lowers stock as
 * `validateOrder` creates the order, except in `PS_OS_CANCELED` /
 * `PS_OS_ERROR`, so the answer is read for that order rather than from a shop
 * setting. An instance that created nothing answers `false`.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { isOrderCreateStockEffect, lowersStockOnOrderCreate } from '@openlinker/core/orders';
import {
  createOrderProcessorManagerHarness,
  createTestOrder,
  OL_DYNAMIC_CARRIER_ID,
  type OrderProcessorHarness,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';

describe('PrestashopOrderProcessorManagerAdapter - OrderCreateStockEffect', () => {
  let harness: OrderProcessorHarness;
  let initialState: string;

  beforeEach(() => {
    harness = createOrderProcessorManagerHarness();
    harness.mockIdentifierMapping.getExternalIds = jest
      .fn()
      .mockImplementation((entityType: string) =>
        Promise.resolve([{ connectionId: harness.connection.id, externalId: '42', entityType }])
      ) as typeof harness.mockIdentifierMapping.getExternalIds;
    harness.setCreateResourceDispatch({ id: '123' }, { id: '999', reference: 'ORDER-1' });
    initialState = '2';
    harness.mockHttpClient.listResources = jest
      .fn()
      .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
        if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
          return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
        }
        if (resource === 'order_histories') {
          return Promise.resolve([{ id: '10', id_order_state: initialState }]);
        }
        if (resource === 'configurations') {
          return Promise.resolve([
            { name: 'PS_OS_CANCELED', value: '6' },
            { name: 'PS_OS_ERROR', value: '8' },
          ]);
        }
        if (resource === 'stock_availables') {
          return Promise.resolve([{ id: '1', depends_on_stock: '0' }]);
        }
        return Promise.resolve([]);
      });
  });

  it('should be detected by the isOrderCreateStockEffect guard', () => {
    expect(isOrderCreateStockEffect(harness.adapter)).toBe(true);
  });

  it('should answer true for an order PrestaShop created in a stock-lowering state', async () => {
    await harness.adapter.createOrder(createTestOrder());

    await expect(lowersStockOnOrderCreate(harness.adapter)).resolves.toBe(true);
    expect(harness.mockHttpClient.listResources).toHaveBeenCalledWith(
      'order_histories',
      expect.objectContaining({ custom: { id_order: '999' } }),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('should answer false when PrestaShop created the order in Payment error', async () => {
    initialState = '8';
    await harness.adapter.createOrder(createTestOrder());

    await expect(lowersStockOnOrderCreate(harness.adapter)).resolves.toBe(false);
  });

  it('should answer false when the order history cannot be read', async () => {
    await harness.adapter.createOrder(createTestOrder());
    const reads = harness.mockHttpClient.listResources as jest.Mock;
    const served = reads.getMockImplementation();
    harness.mockHttpClient.listResources = jest.fn((resource: string, ...rest: unknown[]) =>
      resource === 'order_histories'
        ? Promise.reject(new Error('order_histories read refused'))
        : (served as (...args: unknown[]) => Promise<unknown>)(resource, ...rest)
    ) as unknown as typeof harness.mockHttpClient.listResources;

    await expect(lowersStockOnOrderCreate(harness.adapter)).resolves.toBe(false);
  });

  it('should answer false when this instance created no order (a skipped create)', async () => {
    await expect(lowersStockOnOrderCreate(harness.adapter)).resolves.toBe(false);
  });
});
