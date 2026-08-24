/**
 * Top Products Controller — Unit Tests (#1988)
 */
import { BadRequestException } from '@nestjs/common';
import { TopProductsController } from './top-products.controller';
import type { TopProductsResponseDto } from './dto/top-products-response.dto';
import type { ITopProductsService } from '../application/services/top-products.service.interface';

describe('TopProductsController', () => {
  const response: TopProductsResponseDto = {
    items: [],
    total: 0,
    unresolvedProductCount: 0,
    coverageGapAvailable: true,
  };

  const createService = (): jest.Mocked<ITopProductsService> => ({
    getTopProducts: jest.fn(),
  });

  it('maps query params to filters (with defaults) and returns the service result', async () => {
    const service = createService();
    service.getTopProducts.mockResolvedValue(response);
    const controller = new TopProductsController(service);

    const result = await controller.getTopProducts({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-08T00:00:00.000Z',
      sourceConnectionId: 'conn-a',
    });

    expect(service.getTopProducts).toHaveBeenCalledWith({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
      sourceConnectionId: 'conn-a',
      sortBy: 'revenue',
      limit: 20,
      offset: 0,
    });
    expect(result).toBe(response);
  });

  it('forwards an explicit sortBy/limit/offset', async () => {
    const service = createService();
    service.getTopProducts.mockResolvedValue(response);
    const controller = new TopProductsController(service);

    await controller.getTopProducts({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-08T00:00:00.000Z',
      sortBy: 'units',
      limit: 5,
      offset: 10,
    });

    expect(service.getTopProducts).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'units', limit: 5, offset: 10 })
    );
  });

  it('throws BadRequestException when to <= from', async () => {
    const service = createService();
    const controller = new TopProductsController(service);

    await expect(
      controller.getTopProducts({
        from: '2026-08-08T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      })
    ).rejects.toThrow(BadRequestException);
    expect(service.getTopProducts).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when to === from', async () => {
    const service = createService();
    const controller = new TopProductsController(service);

    await expect(
      controller.getTopProducts({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      })
    ).rejects.toThrow(BadRequestException);
  });
});
