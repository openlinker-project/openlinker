/**
 * Delivery Country Facts Controller Specs (#3907)
 *
 * @module apps/api/src/sales-documents/http
 */
import { NotFoundException } from '@nestjs/common';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { IConnectionService } from '../../integrations/application/interfaces/connection.service.interface';
import { DeliveryCountryFactsController } from './delivery-country-facts.controller';

describe('DeliveryCountryFactsController', () => {
  let orderRecords: jest.Mocked<Pick<IOrderRecordService, 'getDeliveryCountryFacts'>>;
  let connections: jest.Mocked<Pick<IConnectionService, 'get'>>;
  let controller: DeliveryCountryFactsController;

  beforeEach(() => {
    orderRecords = { getDeliveryCountryFacts: jest.fn() };
    connections = { get: jest.fn().mockResolvedValue({ id: 'conn-1' }) };
    controller = new DeliveryCountryFactsController(
      orderRecords as unknown as IOrderRecordService,
      connections as unknown as IConnectionService,
    );
  });

  it('should map facts to the wire shape when orders exist', async () => {
    orderRecords.getDeliveryCountryFacts.mockResolvedValue([
      {
        country: 'PL',
        orders: 47,
        ratesSeen: ['23', '8'],
        currency: 'PLN',
        example: { lines: [{ name: 'Shirt', gross: 49.99, rate: '23' }], delivery: 12.99 },
      },
      { country: 'DE', orders: 3, ratesSeen: [], currency: null, example: null },
    ]);

    const result = await controller.getCountryFacts('conn-1');

    expect(result.windowDays).toBe(30);
    expect(result.countries).toEqual([
      {
        country: 'PL',
        orders30d: 47,
        ratesSeen: ['23', '8'],
        currency: 'PLN',
        example: { lines: [{ name: 'Shirt', gross: 49.99, rate: '23' }], delivery: 12.99 },
      },
      { country: 'DE', orders30d: 3, ratesSeen: [], currency: null, example: null },
    ]);
  });

  it('should scope the read to the connection and a 30 day window when called', async () => {
    orderRecords.getDeliveryCountryFacts.mockResolvedValue([]);
    const before = Date.now();

    await controller.getCountryFacts('conn-1');

    const [connectionId, since] = orderRecords.getDeliveryCountryFacts.mock.calls[0];
    expect(connectionId).toBe('conn-1');
    const days = (before - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('should not read any order when the connection does not exist', async () => {
    connections.get.mockRejectedValue(new NotFoundException('nope'));

    await expect(controller.getCountryFacts('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(orderRecords.getDeliveryCountryFacts).not.toHaveBeenCalled();
  });
});
