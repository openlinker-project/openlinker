/**
 * Analytics CSV export — controller unit tests (#3589)
 */
import { BadRequestException, StreamableFile } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type {
  IDisplayCurrencyConversionService,
  IOrderRecordService,
  SalesAndChannelAnalytics,
} from '@openlinker/core/orders';
import type { IAnalyticsDisplaySettingsService } from '@openlinker/core/analytics';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { SalesAnalyticsController } from './sales-analytics.controller';
import { TopProductsController } from './top-products.controller';
import { SalesAnalyticsQueryDto } from './dto/sales-analytics-query.dto';
import { TopProductsQueryDto } from './dto/top-products-query.dto';
import type { TopProductRowDto, TopProductsResponseDto } from './dto/top-products-response.dto';
import type { ITopProductsService } from '../application/services/top-products.service.interface';

async function readStream(file: StreamableFile): Promise<string> {
  let out = '';
  for await (const chunk of file.getStream()) {
    out += String(chunk);
  }
  return out;
}

const channel = (id: string, revenue: number, net: number, share: number): SalesAndChannelAnalytics['channels'][number] => ({
  sourceConnectionId: id,
  revenue,
  orderCount: 10,
  averageOrderValue: revenue / 10,
  unitsSold: 20,
  unconvertedUnitsSold: 1,
  cancelledCount: 0,
  cancelledValue: 0,
  cancelledUnconvertedCount: 0,
  cancelledUnconvertedValue: 0,
  cancelledNetExcludedCount: 0,
  cancelledNetExcludedValue: 0,
  currency: 'PLN',
  unconvertedCount: 0,
  unconvertedValue: 0,
  unconvertedCurrency: null,
  netRevenue: net,
  netAverageOrderValue: net / 10,
  netExcludedCount: 0,
  netExcludedValue: 0,
  revenueShare: share,
  trend: [],
  coverageComplete: true,
});

const analytics = {
  headline: { currency: 'PLN' },
  channels: [channel('conn-a', 1000, 800, 0.6), channel('conn-b', 500, 400, 0.4)],
} as unknown as SalesAndChannelAnalytics;

const FROM = '2026-08-01T00:00:00.000Z';

describe('SalesAnalyticsController CSV export', () => {
  const build = (basis: 'gross' | 'net' = 'gross'): {
    controller: SalesAnalyticsController;
    service: jest.Mocked<Pick<IOrderRecordService, 'getSalesAndChannelAnalytics'>>;
  } => {
    const service = { getSalesAndChannelAnalytics: jest.fn().mockResolvedValue(analytics) };
    const settings = {
      getSettings: jest.fn().mockResolvedValue({
        includeBackfilledTaxRatesInNetSales: false,
        netGrossBasis: basis,
      }),
    };
    return {
      service,
      controller: new SalesAnalyticsController(
        service as unknown as IOrderRecordService,
        {} as IDisplayCurrencyConversionService,
        settings as unknown as IAnalyticsDisplaySettingsService
      ),
    };
  };

  it('should return a CSV stream with BOM, comment lines, header, rows and a Total row', async () => {
    const { controller } = build();
    const result = await controller.getSalesAnalytics({
      from: FROM,
      to: '2026-09-01T00:00:00.000Z',
      format: 'csv',
    });
    expect(result).toBeInstanceOf(StreamableFile);
    const text = await readStream(result as StreamableFile);
    const lines = text.split('\r\n');
    expect(lines[0].startsWith('﻿# report: ')).toBe(true);
    expect(lines.some((l) => l === '# vat basis: gross (VAT-inclusive)')).toBe(true);
    expect(lines.some((l) => l.startsWith('# currency: PLN'))).toBe(true);
    expect(lines).toContain('channel,connection_id,gmv,orders,aov,units,share_pct');
    expect(lines).toContain('conn-a,conn-a,1000.00,10,100.00,21,60.0');
    expect(lines).toContain('Total,,1500.00,20,75.00,42,100.0');
  });

  it('should write net figures and say so when basis=net', async () => {
    const { controller } = build();
    const result = (await controller.getSalesAnalytics({
      from: FROM,
      to: '2026-09-01T00:00:00.000Z',
      format: 'csv',
      basis: 'net',
    })) as StreamableFile;
    const text = await readStream(result);
    expect(text).toContain('# vat basis: net (VAT-exclusive)');
    expect(text).toContain('net_sales');
    expect(text).toContain('Total,,1200.00');
    expect(result.getHeaders().disposition).toContain('_PLN_net.csv');
  });

  it('should default the basis to the stored setting', async () => {
    const { controller } = build('net');
    const result = (await controller.getSalesAnalytics({
      from: FROM,
      to: '2026-09-01T00:00:00.000Z',
      format: 'csv',
    })) as StreamableFile;
    expect(result.getHeaders().disposition).toContain('_net.csv');
    expect(result.getHeaders().type).toBe('text/csv; charset=utf-8');
  });

  it('should refuse 367 days with EXPORT_RANGE_TOO_WIDE and accept 366', async () => {
    const { controller, service } = build();
    const from = new Date(FROM);
    const to367 = new Date(from.getTime() + 367 * 86_400_000).toISOString();
    const to366 = new Date(from.getTime() + 366 * 86_400_000).toISOString();
    await expect(
      controller.getSalesAnalytics({ from: FROM, to: to367, format: 'csv' })
    ).rejects.toMatchObject({ response: { code: 'EXPORT_RANGE_TOO_WIDE' } });
    expect(service.getSalesAndChannelAnalytics).not.toHaveBeenCalled();
    await expect(
      controller.getSalesAnalytics({ from: FROM, to: to366, format: 'csv' })
    ).resolves.toBeInstanceOf(StreamableFile);
  });

  it('should leave JSON untouched and keep its 400-day cap when format is absent', async () => {
    const { controller } = build();
    const json = await controller.getSalesAnalytics({ from: FROM, to: '2026-09-01T00:00:00.000Z' });
    expect(json.channels).toHaveLength(2);
    const to380 = new Date(new Date(FROM).getTime() + 380 * 86_400_000).toISOString();
    await expect(controller.getSalesAnalytics({ from: FROM, to: to380 })).resolves.toBeDefined();
    const to401 = new Date(new Date(FROM).getTime() + 401 * 86_400_000).toISOString();
    await expect(controller.getSalesAnalytics({ from: FROM, to: to401 })).rejects.toThrow(
      BadRequestException
    );
  });

  it('should let the viewer role call the route', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      SalesAnalyticsController.prototype.getSalesAnalytics
    ) as string[];
    expect(roles).toEqual(expect.arrayContaining(['admin', 'operator', 'viewer']));
  });
});

describe('TopProductsController CSV export', () => {
  const row = (id: string, units: number, revenue: number): TopProductRowDto =>
    ({
      productId: id,
      name: id === 'p1' ? '=cmd' : `Product ${id}`,
      sku: `SKU-${id}`,
      units,
      revenue,
      netRevenue: revenue * 0.8,
      currency: 'PLN',
      channels: [{ sourceConnectionId: 'conn-a', units }],
    }) as unknown as TopProductRowDto;

  const build = (): {
    controller: TopProductsController;
    service: jest.Mocked<ITopProductsService>;
  } => {
    const service: jest.Mocked<ITopProductsService> = {
      getTopProducts: jest.fn(),
      getTopProductVariantSales: jest.fn(),
    };
    const settings = {
      getSettings: jest.fn().mockResolvedValue({
        includeBackfilledTaxRatesInNetSales: false,
        netGrossBasis: 'gross',
      }),
    };
    return {
      service,
      controller: new TopProductsController(
        service,
        settings as unknown as IAnalyticsDisplaySettingsService
      ),
    };
  };

  it('should page the full ranking 500 at a time, ignoring limit/offset, and guard formula cells', async () => {
    const { controller, service } = build();
    const first = Array.from({ length: 500 }, (_, i) => row(i === 0 ? 'p1' : `x${i}`, 1, 10));
    const second = [row('last', 5, 50)];
    service.getTopProducts
      .mockResolvedValueOnce({ items: first, total: 501 } as TopProductsResponseDto)
      .mockResolvedValueOnce({ items: second, total: 501 } as TopProductsResponseDto);

    const result = (await controller.getTopProducts({
      from: FROM,
      to: '2026-09-01T00:00:00.000Z',
      format: 'csv',
      limit: 5,
      offset: 40,
      sortBy: 'units',
    })) as StreamableFile;

    expect(service.getTopProducts).toHaveBeenCalledTimes(2);
    expect(service.getTopProducts.mock.calls[0][0]).toMatchObject({
      limit: 500,
      offset: 0,
      sortBy: 'units',
    });
    expect(service.getTopProducts.mock.calls[1][0]).toMatchObject({ limit: 500, offset: 500 });
    const text = await readStream(result);
    const lines = text.split('\r\n');
    expect(lines.filter((l) => l.startsWith('Product') || l.startsWith("'=cmd"))).toHaveLength(501);
    expect(text).toContain("'=cmd");
    expect(lines).toContain('product,product_id,sku,gmv,currency,units,units_conn-a');
    expect(result.getHeaders().disposition).toContain('openlinker_top-products_');
  });

  it('should refuse a range over 366 days and leave JSON paging untouched', async () => {
    const { controller, service } = build();
    const to = new Date(new Date(FROM).getTime() + 367 * 86_400_000).toISOString();
    await expect(
      controller.getTopProducts({ from: FROM, to, format: 'csv' })
    ).rejects.toMatchObject({ response: { code: 'EXPORT_RANGE_TOO_WIDE' } });
    service.getTopProducts.mockResolvedValue({ items: [], total: 0 } as unknown as TopProductsResponseDto);
    await controller.getTopProducts({ from: FROM, to: '2026-09-01T00:00:00.000Z', limit: 7, offset: 3 });
    expect(service.getTopProducts.mock.calls[0][0]).toMatchObject({ limit: 7, offset: 3 });
  });

  it('should let the viewer role call the route', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      TopProductsController.prototype.getTopProducts
    ) as string[];
    expect(roles).toContain('viewer');
  });
});

describe('query DTO validation', () => {
  const check = async (cls: new () => object, plain: object): Promise<number> =>
    (await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true }))
      .length;

  it('should accept format=csv and basis, and still reject unknown params', async () => {
    const base = { from: FROM, to: '2026-09-01T00:00:00.000Z' };
    expect(await check(SalesAnalyticsQueryDto, { ...base, format: 'csv', basis: 'net' })).toBe(0);
    expect(await check(TopProductsQueryDto, { ...base, format: 'csv', basis: 'gross' })).toBe(0);
    expect(await check(SalesAnalyticsQueryDto, { ...base, bogus: '1' })).toBeGreaterThan(0);
    expect(await check(TopProductsQueryDto, { ...base, format: 'xml' })).toBeGreaterThan(0);
  });
});
