/**
 * Pickup-Point Controller unit tests (#766).
 *
 * Mocks IPickupPointLookupService. Covers DTO mapping on search, the
 * unsupported-capability → 422 and provider-error → 502 mappings, and the
 * cached-read hit/miss (404) paths.
 */
import {
  BadGatewayException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PickupPointFinderNotSupportedException,
  type IPickupPointLookupService,
  type PickupPoint,
} from '@openlinker/core/shipping';
import { CapabilityNotEnabledException } from '@openlinker/core/integrations';
import { PickupPointController } from './pickup-point.controller';
import { ListPickupPointsQueryDto } from './dto/list-pickup-points-query.dto';

const point: PickupPoint = {
  providerId: 'POZ08A',
  name: 'Paczkomat POZ08A',
  address: { line1: 'Krakowska 12', city: 'Poznań', postalCode: '60-001', country: 'PL' },
  status: 'active',
};

function makeQuery(overrides: Partial<ListPickupPointsQueryDto> = {}): ListPickupPointsQueryDto {
  return Object.assign(new ListPickupPointsQueryDto(), {
    connectionId: '33333333-3333-4333-8333-333333333333',
    limit: 20,
    ...overrides,
  });
}

describe('PickupPointController', () => {
  let lookup: jest.Mocked<IPickupPointLookupService>;
  let controller: PickupPointController;

  beforeEach(() => {
    lookup = { search: jest.fn(), refreshSearch: jest.fn(), getCachedPoint: jest.fn() };
    controller = new PickupPointController(lookup);
  });

  describe('search', () => {
    it('should map provider results to DTOs and forward the query', async () => {
      lookup.search.mockResolvedValue([point]);

      const result = await controller.search(makeQuery({ city: 'Poznań', searchText: 'rynek' }));

      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('POZ08A');
      expect(result[0].status).toBe('active');
      expect(lookup.search).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', {
        searchText: 'rynek',
        city: 'Poznań',
        postalCode: undefined,
        limit: 20,
      });
    });

    it('should map an unsupported finder sub-capability to 422', async () => {
      lookup.search.mockRejectedValue(new PickupPointFinderNotSupportedException('conn-1'));

      await expect(controller.search(makeQuery())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should map a connection-capability error (disabled/unsupported) to 422', async () => {
      lookup.search.mockRejectedValue(
        new CapabilityNotEnabledException('conn-1', 'inpost.shipx.v1', 'ShippingProviderManager'),
      );

      await expect(controller.search(makeQuery())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should map a provider/transport error to 502', async () => {
      lookup.search.mockRejectedValue(new Error('ShipX 500'));

      await expect(controller.search(makeQuery())).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('getCached', () => {
    it('should return the cached point as a DTO on hit', async () => {
      lookup.getCachedPoint.mockResolvedValue(point);

      const result = await controller.getCached('POZ08A');

      expect(result.providerId).toBe('POZ08A');
      expect(lookup.getCachedPoint).toHaveBeenCalledWith('POZ08A');
    });

    it('should return 404 on cache miss', async () => {
      lookup.getCachedPoint.mockResolvedValue(null);

      await expect(controller.getCached('NOPE')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
