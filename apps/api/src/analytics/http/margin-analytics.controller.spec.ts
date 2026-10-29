/**
 * Margin Analytics Controller - Unit Tests (#3588)
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { IAnalyticsDisplaySettingsService } from '@openlinker/core/analytics';
import type { IMarginAnalyticsService, MarginAnalytics } from '@openlinker/core/orders';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { IMarginAnalyticsApiService } from '../application/services/margin-analytics-api.service.interface';
import { MarginAnalyticsController } from './margin-analytics.controller';
import { MarginAnalyticsQueryDto, MarginProductsQueryDto } from './dto/margin-analytics-query.dto';

describe('MarginAnalyticsController', () => {
  const range = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' };

  const analytics: MarginAnalytics = {
    currency: 'PLN',
    bucket: 'day',
    headline: {
      netRevenue: 100,
      coveredNetRevenue: 80,
      costOfGoods: 50,
      grossMargin: 30,
      marginPct: 0.375,
      costCoveragePct: 0.8,
      gaps: [
        { reason: 'no-cost', lineCount: 1, netAmount: 20 },
        { reason: 'cost-entered-after-sale', lineCount: 0, netAmount: 0 },
        { reason: 'no-variant', lineCount: 0, netAmount: 0 },
        { reason: 'currency-mismatch', lineCount: 0, netAmount: 0 },
      ],
    },
    trend: [],
    channels: [],
    excludedLineCount: 3,
  };

  const build = (
    includeBackfilledTaxRatesInNetSales = false
  ): {
    controller: MarginAnalyticsController;
    margin: jest.Mocked<Pick<IMarginAnalyticsService, 'getMargin'>>;
    api: jest.Mocked<IMarginAnalyticsApiService>;
    settings: jest.Mocked<Pick<IAnalyticsDisplaySettingsService, 'getSettings'>>;
  } => {
    const margin = { getMargin: jest.fn().mockResolvedValue(analytics) };
    const api = { getMarginProducts: jest.fn(), getMarginProductVariants: jest.fn() };
    const settings = {
      getSettings: jest.fn().mockResolvedValue({ includeBackfilledTaxRatesInNetSales }),
    };
    return {
      controller: new MarginAnalyticsController(
        margin as unknown as IMarginAnalyticsService,
        api as unknown as IMarginAnalyticsApiService,
        settings as unknown as IAnalyticsDisplaySettingsService
      ),
      margin,
      api: api as jest.Mocked<IMarginAnalyticsApiService>,
      settings,
    };
  };

  it('maps the query (bucket defaulting to day) and reads the opt-in fresh per request', async () => {
    const { controller, margin, settings } = build(true);

    const result = await controller.getMargin({ ...range, sourceConnectionId: 'conn-a' });

    expect(settings.getSettings).toHaveBeenCalledTimes(1);
    expect(margin.getMargin).toHaveBeenCalledWith(
      {
        from: new Date(range.from),
        to: new Date(range.to),
        sourceConnectionId: 'conn-a',
      },
      'day',
      true
    );
    expect(result.currency).toBe('PLN');
    expect(result.headline.gaps).toHaveLength(4);
  });

  it('forwards an explicit week bucket', async () => {
    const { controller, margin } = build();

    await controller.getMargin({ ...range, bucket: 'week' });

    expect(margin.getMargin).toHaveBeenCalledWith(expect.anything(), 'week', false);
  });

  it('rejects a range where to is not after from', async () => {
    const { controller } = build();

    await expect(controller.getMargin({ from: range.to, to: range.from })).rejects.toThrow(
      BadRequestException
    );
  });

  it('rejects a range wider than 400 days', async () => {
    const { controller } = build();

    await expect(
      controller.getMargin({ from: '2025-01-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' })
    ).rejects.toThrow(BadRequestException);
  });

  it('forwards product ranking defaults and an explicit sort', async () => {
    const { controller, api } = build();

    await controller.getMarginProducts({ ...range });
    await controller.getMarginProducts({ ...range, sortBy: 'marginPct', limit: 5, offset: 10 });

    expect(api.getMarginProducts).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sortBy: 'grossMargin', limit: 20, offset: 0 }),
      false
    );
    expect(api.getMarginProducts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sortBy: 'marginPct', limit: 5, offset: 10 }),
      false
    );
  });

  it('forwards the product id to the variant drill-down', async () => {
    const { controller, api } = build();

    await controller.getMarginProductVariants('ol_product_1', range);

    expect(api.getMarginProductVariants).toHaveBeenCalledWith(
      'ol_product_1',
      { from: new Date(range.from), to: new Date(range.to), sourceConnectionId: undefined },
      false
    );
  });

  it('restricts all three routes to admin, operator and viewer', () => {
    const proto = MarginAnalyticsController.prototype;
    for (const method of [
      proto.getMargin,
      proto.getMarginProducts,
      proto.getMarginProductVariants,
    ]) {
      const roles = Reflect.getMetadata(ROLES_KEY, method) as string[] | undefined;
      expect([...(roles ?? [])].sort()).toEqual(['admin', 'operator', 'viewer']);
    }
  });

  describe('query DTO validation', () => {
    it('accepts a valid margin query', async () => {
      const dto = plainToInstance(MarginAnalyticsQueryDto, { ...range, bucket: 'week' });
      expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    });

    it('rejects an unknown bucket', async () => {
      const dto = plainToInstance(MarginAnalyticsQueryDto, { ...range, bucket: 'month' });
      const errors = await validate(dto);
      expect(errors[0].property).toBe('bucket');
    });

    it('rejects an unknown parameter (displayCurrency is not supported by margin)', async () => {
      const dto = plainToInstance(MarginAnalyticsQueryDto, { ...range, displayCurrency: 'PLN' });
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.map((error) => error.property)).toContain('displayCurrency');
    });

    it('rejects an unknown sortBy and an over-large limit', async () => {
      const bad = plainToInstance(MarginProductsQueryDto, {
        ...range,
        sortBy: 'units',
        limit: '500',
      });
      const properties = (await validate(bad)).map((error) => error.property);
      expect(properties).toEqual(expect.arrayContaining(['sortBy', 'limit']));
    });

    it('coerces numeric limit and offset from the query string', async () => {
      const dto = plainToInstance(MarginProductsQueryDto, { ...range, limit: '10', offset: '20' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.limit).toBe(10);
      expect(dto.offset).toBe(20);
    });
  });
});
