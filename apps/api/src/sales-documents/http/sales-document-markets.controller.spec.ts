/**
 * SalesDocumentMarketsController - unit tests (#2518, ADR-066)
 *
 * @module apps/api/src/sales-documents/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import type { IOrderRecordService } from '@openlinker/core/orders';
import { SALES_DOCUMENT_RULES_SERVICE_TOKEN } from '@openlinker/core/sales-documents';
import type { ISalesDocumentRulesService } from '@openlinker/core/sales-documents';

import { SalesDocumentMarketsController } from './sales-document-markets.controller';

describe('SalesDocumentMarketsController', () => {
  let controller: SalesDocumentMarketsController;
  let orderRecords: { discoverSalesDocumentMarkets: jest.Mock };
  let rules: { listConfiguredCountries: jest.Mock; resolveRoutingBatch: jest.Mock };

  beforeEach(async () => {
    orderRecords = {
      discoverSalesDocumentMarkets: jest.fn().mockResolvedValue({
        windowDays: 30,
        since: '2026-07-31T10:00:00.000Z',
        markets: [],
      }),
    };
    rules = {
      listConfiguredCountries: jest.fn().mockResolvedValue([]),
      resolveRoutingBatch: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesDocumentMarketsController],
      providers: [
        {
          provide: ORDER_RECORD_SERVICE_TOKEN,
          useValue: orderRecords as unknown as IOrderRecordService,
        },
        {
          provide: SALES_DOCUMENT_RULES_SERVICE_TOKEN,
          useValue: rules as unknown as ISalesDocumentRulesService,
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

  describe('listMarkets', () => {
    it('should merge a detected-only market and a configured-only market into two distinct rows', async () => {
      orderRecords.discoverSalesDocumentMarkets.mockResolvedValue({
        windowDays: 30,
        since: '2026-07-31T10:00:00.000Z',
        markets: [{ country: 'DE', orderCount: 12 }],
      });
      rules.listConfiguredCountries.mockResolvedValue([
        {
          country: 'PL',
          ruleCount: 3,
          invoiceDefaultConnectionId: 'c-ksef',
          receiptDefaultConnectionId: 'c-epar',
          acknowledgedNoDocumentAt: null,
        },
      ]);
      rules.resolveRoutingBatch.mockResolvedValue([
        { kind: 'unresolved', reason: 'no-matching-rule' },
        { kind: 'unresolved', reason: 'no-configuration-for-country' },
      ]);

      const result = await controller.listMarkets();

      expect(result.markets).toHaveLength(2);
      const byCountry = new Map(result.markets.map((m) => [m.country, m]));
      expect(byCountry.get('PL')).toMatchObject({ orderCount: null, ruleCount: 3 });
      expect(byCountry.get('DE')).toMatchObject({ orderCount: 12, ruleCount: 0 });
    });

    it('should merge one row when a market is both configured and detected', async () => {
      orderRecords.discoverSalesDocumentMarkets.mockResolvedValue({
        windowDays: 30,
        since: '2026-07-31T10:00:00.000Z',
        markets: [{ country: 'PL', orderCount: 47 }],
      });
      rules.listConfiguredCountries.mockResolvedValue([
        {
          country: 'PL',
          ruleCount: 3,
          invoiceDefaultConnectionId: null,
          receiptDefaultConnectionId: null,
          acknowledgedNoDocumentAt: null,
        },
      ]);
      rules.resolveRoutingBatch.mockResolvedValue([{ kind: 'unresolved', reason: 'no-matching-rule' }]);

      const result = await controller.listMarkets();

      expect(result.markets).toHaveLength(1);
      expect(result.markets[0]).toMatchObject({ country: 'PL', orderCount: 47, ruleCount: 3 });
    });

    it('should resolve each row\'s outcome through the shared evaluator, never a hand-derived value', async () => {
      orderRecords.discoverSalesDocumentMarkets.mockResolvedValue({
        windowDays: 30,
        since: '2026-07-31T10:00:00.000Z',
        markets: [{ country: 'PL', orderCount: 47 }],
      });
      rules.listConfiguredCountries.mockResolvedValue([]);
      rules.resolveRoutingBatch.mockResolvedValue([
        { kind: 'route', documentKind: 'invoice', connectionId: 'c-ksef' },
      ]);

      const result = await controller.listMarkets();

      expect(result.markets[0].outcome).toEqual({ kind: 'route', documentKind: 'invoice', connectionId: 'c-ksef' });
      expect(rules.resolveRoutingBatch).toHaveBeenCalledWith([
        expect.objectContaining({ country: 'PL', buyerHasTaxId: undefined }),
      ]);
    });

    it('should report a template only for a market the catalogue has guidance for', async () => {
      orderRecords.discoverSalesDocumentMarkets.mockResolvedValue({
        windowDays: 30,
        since: '2026-07-31T10:00:00.000Z',
        markets: [
          { country: 'PL', orderCount: 47 },
          { country: 'DE', orderCount: 12 },
        ],
      });
      rules.listConfiguredCountries.mockResolvedValue([]);
      rules.resolveRoutingBatch.mockResolvedValue([
        { kind: 'unresolved', reason: 'no-configuration-for-country' },
        { kind: 'unresolved', reason: 'no-configuration-for-country' },
      ]);

      const result = await controller.listMarkets();

      const byCountry = new Map(result.markets.map((m) => [m.country, m]));
      expect(byCountry.get('PL')?.hasTemplate).toBe(true);
      expect(byCountry.get('DE')?.hasTemplate).toBe(false);
    });

    it('should never write anything while listing markets', async () => {
      await controller.listMarkets();

      expect(Object.keys(rules)).toEqual(['listConfiguredCountries', 'resolveRoutingBatch']);
    });

    it('should never report an acknowledged market as unresolved (#2531)', async () => {
      orderRecords.discoverSalesDocumentMarkets.mockResolvedValue({
        windowDays: 30,
        since: '2026-07-31T10:00:00.000Z',
        markets: [],
      });
      rules.listConfiguredCountries.mockResolvedValue([
        {
          country: 'GB',
          ruleCount: 0,
          invoiceDefaultConnectionId: null,
          receiptDefaultConnectionId: null,
          acknowledgedNoDocumentAt: '2026-08-01T00:00:00.000Z',
        },
      ]);
      // Acknowledgment and configuration are mutually exclusive by
      // construction, so the evaluator's real answer for GB would be
      // exactly this — proving the override, not a scenario that cannot
      // happen.
      rules.resolveRoutingBatch.mockResolvedValue([
        { kind: 'unresolved', reason: 'no-configuration-for-country' },
      ]);

      const result = await controller.listMarkets();

      expect(result.markets).toHaveLength(1);
      expect(result.markets[0].acknowledgedNoDocumentAt).toBe('2026-08-01T00:00:00.000Z');
      expect(result.markets[0].outcome).toEqual({ kind: 'acknowledged' });
    });
  });
});
