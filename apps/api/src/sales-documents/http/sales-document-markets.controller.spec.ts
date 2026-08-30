/**
 * SalesDocumentMarketsController - unit tests (#2518, ADR-066)
 *
 * @module apps/api/src/sales-documents/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import type { IOrderRecordService } from '@openlinker/core/orders';

import { SalesDocumentMarketsController } from './sales-document-markets.controller';

describe('SalesDocumentMarketsController', () => {
  let controller: SalesDocumentMarketsController;
  let orderRecords: { discoverSalesDocumentMarkets: jest.Mock };

  beforeEach(async () => {
    orderRecords = {
      discoverSalesDocumentMarkets: jest.fn().mockResolvedValue({
        windowDays: 30,
        since: '2026-07-31T10:00:00.000Z',
        markets: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesDocumentMarketsController],
      providers: [
        {
          provide: ORDER_RECORD_SERVICE_TOKEN,
          useValue: orderRecords as unknown as IOrderRecordService,
        },
      ],
    }).compile();

    controller = module.get(SalesDocumentMarketsController);
  });

  it('should return country plus count over the window, most orders first', async () => {
    orderRecords.discoverSalesDocumentMarkets.mockResolvedValue({
      windowDays: 30,
      since: '2026-07-31T10:00:00.000Z',
      markets: [
        { country: 'PL', orderCount: 47 },
        { country: 'DE', orderCount: 12 },
        { country: 'CZ', orderCount: 6 },
      ],
    });

    const result = await controller.listDetectedMarkets();

    expect(result.windowDays).toBe(30);
    expect(result.since).toBe('2026-07-31T10:00:00.000Z');
    expect(result.markets).toEqual([
      { country: 'PL', orderCount: 47 },
      { country: 'DE', orderCount: 12 },
      { country: 'CZ', orderCount: 6 },
    ]);
  });

  it('should classify nothing, so a configured and an unconfigured market are indistinguishable here', async () => {
    orderRecords.discoverSalesDocumentMarkets.mockResolvedValue({
      windowDays: 30,
      since: '2026-07-31T10:00:00.000Z',
      markets: [
        { country: 'PL', orderCount: 47 },
        { country: 'DE', orderCount: 12 },
      ],
    });

    const result = await controller.listDetectedMarkets();

    // Classification is the caller's job (ADR-066 decision 1). A `configured`
    // or `hasTemplate` flag here would be a second source of truth for it.
    for (const market of result.markets) {
      expect(Object.keys(market).sort()).toEqual(['country', 'orderCount']);
    }
  });

  it('should return an empty list for a brand-new instance rather than an error', async () => {
    const result = await controller.listDetectedMarkets();

    expect(result.markets).toEqual([]);
  });

  it('should issue exactly one read and no write', async () => {
    await controller.listDetectedMarkets();

    expect(orderRecords.discoverSalesDocumentMarkets).toHaveBeenCalledTimes(1);
    // Nothing else on the service is reachable from this controller: it holds
    // one dependency and calls one read. Discovery never creates routing.
    expect(Object.keys(orderRecords)).toEqual(['discoverSalesDocumentMarkets']);
  });
});
