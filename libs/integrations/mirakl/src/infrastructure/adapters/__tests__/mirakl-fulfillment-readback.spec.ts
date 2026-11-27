/**
 * Mirakl Fulfillment Readback: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { MiraklNetworkException } from '../../../domain/exceptions/mirakl-network.exception';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { MiraklFulfillmentReadback } from '../mirakl-fulfillment-readback';
import { buildMiraklOrder } from './mirakl-order.fixture';

function readback(get: jest.Mock): MiraklFulfillmentReadback {
  return new MiraklFulfillmentReadback('conn-1', { get } as unknown as IMiraklHttpClient, 'Empik');
}

describe('MiraklFulfillmentReadback', () => {
  it('should report a shipment entered in the operator panel with its carrier', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        orders: [
          buildMiraklOrder({
            order_state: 'SHIPPED',
            shipping_tracking: 'TRK-9',
            shipping_carrier_code: 'dpd',
            shipping_company: 'DPD',
          }),
        ],
      },
    });

    expect(await readback(get).readFulfillment({ externalOrderId: '1001-A' })).toEqual({
      outcome: 'read',
      rawStatus: 'SHIPPED',
      dispatched: true,
      waybills: [{ waybill: 'TRK-9', carrierId: 'dpd', carrierName: 'DPD' }],
    });
  });

  it('should report an order still to ship with no waybills', async () => {
    const get = jest
      .fn()
      .mockResolvedValue({
        status: 200,
        data: { orders: [buildMiraklOrder({ order_state: 'SHIPPING' })] },
      });

    expect(await readback(get).readFulfillment({ externalOrderId: '1001-A' })).toMatchObject({
      outcome: 'read',
      dispatched: false,
      waybills: [],
    });
  });

  it('should answer unavailable, never throw, when the read fails', async () => {
    const get = jest.fn().mockRejectedValue(new MiraklNetworkException('down'));

    expect((await readback(get).readFulfillment({ externalOrderId: '1001-A' })).outcome).toBe(
      'unavailable'
    );
  });
});
