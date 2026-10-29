/**
 * Order Line Costs Controller Unit Tests (#3588)
 */
import { NotFoundException } from '@nestjs/common';
import type { IAnalyticsDisplaySettingsService } from '@openlinker/core/analytics';
import type { IOrderLineCostService } from '@openlinker/core/orders';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { OrderLineCostsController } from './order-line-costs.controller';

describe('OrderLineCostsController', () => {
  const settings = {
    getSettings: jest.fn().mockResolvedValue({ includeBackfilledTaxRatesInNetSales: true }),
  } as unknown as IAnalyticsDisplaySettingsService;

  it('should be restricted to admin, operator and viewer (never packer, never any-role)', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      OrderLineCostsController.prototype.getLineCosts
    ) as string[];
    expect([...roles].sort()).toEqual(['admin', 'operator', 'viewer']);
  });

  it('should pass the net-sales era setting to the service', async () => {
    const getLineCosts = jest.fn().mockResolvedValue({ currency: 'PLN', lines: [] });
    const controller = new OrderLineCostsController(
      { getLineCosts } as unknown as IOrderLineCostService,
      settings
    );
    await expect(controller.getLineCosts('ord-1')).resolves.toEqual({ currency: 'PLN', lines: [] });
    expect(getLineCosts).toHaveBeenCalledWith('ord-1', true);
  });

  it('should answer 404 when the order is unknown', async () => {
    const controller = new OrderLineCostsController(
      { getLineCosts: jest.fn().mockResolvedValue(null) } as unknown as IOrderLineCostService,
      settings
    );
    await expect(controller.getLineCosts('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
