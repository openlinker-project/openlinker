/**
 * Pickup-point refresh service unit tests (#849).
 *
 * Mocks IIntegrationsService (→ finder / courier-only adapter), the
 * query-stats port, and the lookup service. Covers the finder guard, the
 * top-N re-warm loop, per-query failure isolation, and the empty case.
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { PickupPointRefreshService } from './pickup-point-refresh.service';
import type { IPickupPointLookupService } from '../interfaces/pickup-point-lookup.service.interface';
import type { PickupPointQueryStatsPort } from '../../domain/ports/pickup-point-query-stats.port';

const CONN = 'conn-inpost';

function finderAdapter(): unknown {
  return { generateLabel: jest.fn(), getTracking: jest.fn(), findPickupPoints: jest.fn() };
}

function courierOnlyAdapter(): unknown {
  return { generateLabel: jest.fn(), getTracking: jest.fn() };
}

describe('PickupPointRefreshService', () => {
  let getCapabilityAdapter: jest.Mock;
  let stats: jest.Mocked<PickupPointQueryStatsPort>;
  let lookup: jest.Mocked<IPickupPointLookupService>;
  let service: PickupPointRefreshService;

  beforeEach(() => {
    getCapabilityAdapter = jest.fn().mockResolvedValue(finderAdapter());
    stats = { record: jest.fn(), topQueries: jest.fn().mockResolvedValue([]) };
    lookup = {
      search: jest.fn(),
      refreshSearch: jest.fn().mockResolvedValue(undefined),
      getCachedPoint: jest.fn(),
    };
    const integrations = { getCapabilityAdapter } as unknown as IIntegrationsService;
    service = new PickupPointRefreshService(integrations, stats, lookup);
  });

  it('no-ops when the connection adapter is not a pickup-point finder', async () => {
    getCapabilityAdapter.mockResolvedValue(courierOnlyAdapter());

    const result = await service.refreshFrequentForConnection(CONN);

    expect(result).toEqual({ refreshed: 0, failed: 0 });
    expect(stats.topQueries).not.toHaveBeenCalled();
    expect(lookup.refreshSearch).not.toHaveBeenCalled();
  });

  it('re-runs each top-N query and reports the refreshed count', async () => {
    stats.topQueries.mockResolvedValue([{ city: 'poznań' }, { postalCode: '00-001' }]);

    const result = await service.refreshFrequentForConnection(CONN);

    expect(result).toEqual({ refreshed: 2, failed: 0 });
    expect(lookup.refreshSearch).toHaveBeenCalledWith(CONN, { city: 'poznań' });
    expect(lookup.refreshSearch).toHaveBeenCalledWith(CONN, { postalCode: '00-001' });
  });

  it('isolates a per-query failure without aborting the batch', async () => {
    stats.topQueries.mockResolvedValue([{ city: 'a' }, { city: 'b' }, { city: 'c' }]);
    lookup.refreshSearch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('ShipX 500'))
      .mockResolvedValueOnce(undefined);

    const result = await service.refreshFrequentForConnection(CONN);

    expect(result).toEqual({ refreshed: 2, failed: 1 });
    expect(lookup.refreshSearch).toHaveBeenCalledTimes(3);
  });

  it('defensively skips an unfiltered query without calling the provider', async () => {
    stats.topQueries.mockResolvedValue([{}, { city: 'poznań' }]);

    const result = await service.refreshFrequentForConnection(CONN);

    expect(result).toEqual({ refreshed: 1, failed: 0 });
    expect(lookup.refreshSearch).toHaveBeenCalledTimes(1);
    expect(lookup.refreshSearch).toHaveBeenCalledWith(CONN, { city: 'poznań' });
  });

  it('returns zero counts when there are no recorded queries', async () => {
    stats.topQueries.mockResolvedValue([]);

    const result = await service.refreshFrequentForConnection(CONN);

    expect(result).toEqual({ refreshed: 0, failed: 0 });
    expect(lookup.refreshSearch).not.toHaveBeenCalled();
  });
});
