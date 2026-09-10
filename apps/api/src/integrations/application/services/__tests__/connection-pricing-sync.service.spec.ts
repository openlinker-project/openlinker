/**
 * Connection Pricing Sync Service tests (#3146, ADR-072)
 *
 * @module apps/api/src/integrations/application/services/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { ConnectionPricingSyncService } from '../connection-pricing-sync.service';

const DEST_ID = 'dest-1';
const SRC_ID = 'src-1';

function buildConnection(id: string, name: string, config: Record<string, unknown> = {}): Connection {
  return new Connection(id, 'allegro', name, 'active', config, 'ref', new Date(), new Date(), undefined, []);
}

describe('ConnectionPricingSyncService', () => {
  let connections: { get: jest.Mock; list: jest.Mock };
  let connectionService: { update: jest.Mock };
  let episodes: { findOpenForConnection: jest.Mock; findOpenAll: jest.Mock; countOpen: jest.Mock };
  let service: ConnectionPricingSyncService;

  beforeEach(() => {
    connections = {
      get: jest.fn().mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL')),
      list: jest.fn().mockResolvedValue([]),
    };
    connectionService = { update: jest.fn() };
    episodes = {
      findOpenForConnection: jest.fn().mockResolvedValue([]),
      findOpenAll: jest.fn().mockResolvedValue([]),
      countOpen: jest.fn().mockResolvedValue(0),
    };

    service = new ConnectionPricingSyncService(
      connections as never,
      connectionService as never,
      episodes as never
    );
  });

  it('returns the default with no overrides for an unconfigured connection', async () => {
    const view = await service.getPricingSync(DEST_ID);

    expect(view.default).toEqual({ mode: 'manual', rule: { type: 'passthrough', percent: 0, rounding: 'none' } });
    expect(view.sources).toEqual([]);
  });

  it('lists a configured source override even with no open episode', async () => {
    connections.get.mockImplementation((id: string) =>
      Promise.resolve(
        id === DEST_ID
          ? buildConnection(DEST_ID, 'Allegro — PL', {
              pricingRule: {
                default: { type: 'markup', percent: 20 },
                sourceOverrides: { [SRC_ID]: { type: 'margin', percent: 30, rounding: 'endingIn99' } },
              },
              priceSyncMode: { default: 'manual', sourceOverrides: {} },
            })
          : buildConnection(SRC_ID, 'PrestaShop — Main Store')
      )
    );

    const view = await service.getPricingSync(DEST_ID);

    expect(view.sources).toHaveLength(1);
    expect(view.sources[0]).toEqual(
      expect.objectContaining({
        sourceConnectionId: SRC_ID,
        sourceLabel: 'PrestaShop — Main Store',
        isCustomOverride: true,
        effective: { mode: 'manual', rule: { type: 'margin', percent: 30, rounding: 'endingIn99' } },
      })
    );
  });

  it('lists a source with an open episode but no configured override', async () => {
    episodes.findOpenForConnection.mockResolvedValue([
      { sourceConnectionId: SRC_ID } as never,
    ]);
    connections.get.mockImplementation((id: string) =>
      Promise.resolve(buildConnection(id, id === DEST_ID ? 'Allegro — PL' : 'PrestaShop — Main Store'))
    );

    const view = await service.getPricingSync(DEST_ID);

    expect(view.sources).toHaveLength(1);
    expect(view.sources[0].isCustomOverride).toBe(false);
  });

  it('merges pricingRule and priceSyncMode into config.update, preserving the rest of config', async () => {
    connections.get.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL', { currency: 'PLN' }));
    connectionService.update.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL'));

    await service.updatePricingSync(DEST_ID, {
      default: { mode: 'automatic', rule: { type: 'passthrough', percent: 0, rounding: 'none' } },
      sourceOverrides: { [SRC_ID]: { mode: 'manual', rule: { type: 'markup', percent: 15, rounding: 'none' } } },
    });

    expect(connectionService.update).toHaveBeenCalledWith(
      DEST_ID,
      expect.objectContaining({
        config: expect.objectContaining({
          currency: 'PLN',
          pricingRule: {
            default: { type: 'passthrough', percent: 0, rounding: 'none' },
            sourceOverrides: { [SRC_ID]: { type: 'markup', percent: 15, rounding: 'none' } },
          },
          priceSyncMode: { default: 'automatic', sourceOverrides: { [SRC_ID]: 'manual' } },
        }),
      })
    );
  });

  describe('getAsSource', () => {
    it('lists every destination naming this connection, config-derived or via an open episode', async () => {
      connections.list.mockResolvedValue([
        buildConnection('dest-a', 'Allegro — PL', {
          pricingRule: { default: { type: 'markup', percent: 20 }, sourceOverrides: { [SRC_ID]: { type: 'margin', percent: 10 } } },
        }),
        buildConnection('dest-b', 'Erli — PL'),
        buildConnection(SRC_ID, 'PrestaShop — Main Store'), // excluded: self
      ]);
      episodes.findOpenAll.mockResolvedValue([{ destinationConnectionId: 'dest-b' } as never]);

      const result = await service.getAsSource(SRC_ID);

      expect(result.map((r) => r.destinationConnectionId).sort()).toEqual(['dest-a', 'dest-b']);
      const destA = result.find((r) => r.destinationConnectionId === 'dest-a');
      expect(destA?.isCustomOverride).toBe(true);
      const destB = result.find((r) => r.destinationConnectionId === 'dest-b');
      expect(destB?.isCustomOverride).toBe(false);
    });
  });
});
