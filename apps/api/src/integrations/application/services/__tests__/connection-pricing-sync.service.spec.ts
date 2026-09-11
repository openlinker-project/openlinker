/**
 * Connection Pricing Sync Service tests (#3146, ADR-072; #3163 review)
 *
 * @module apps/api/src/integrations/application/services/__tests__
 */
import { ConflictException, BadRequestException } from '@nestjs/common';
import { Connection } from '@openlinker/core/identifier-mapping';
import { ConnectionPricingSyncService } from '../connection-pricing-sync.service';

const DEST_ID = 'dest-1';
const SRC_ID = 'src-1';

function buildConnection(
  id: string,
  name: string,
  config: Record<string, unknown> = {},
  updatedAt: Date = new Date('2026-01-01T00:00:00.000Z')
): Connection {
  return new Connection(id, 'allegro', name, 'active', config, 'ref', new Date(), updatedAt, undefined, []);
}

describe('ConnectionPricingSyncService', () => {
  let connections: { get: jest.Mock; list: jest.Mock };
  let connectionService: { update: jest.Mock };
  let priceChanges: { countOpenBySource: jest.Mock; listOpenDestinationConnectionIds: jest.Mock };
  let integrationsService: { resolveAdapterMetadata: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };
  let service: ConnectionPricingSyncService;

  beforeEach(() => {
    connections = {
      get: jest.fn().mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL')),
      list: jest.fn().mockResolvedValue([]),
    };
    connectionService = { update: jest.fn() };
    priceChanges = {
      countOpenBySource: jest.fn().mockResolvedValue(new Map()),
      listOpenDestinationConnectionIds: jest.fn().mockResolvedValue([]),
    };
    integrationsService = {
      resolveAdapterMetadata: jest.fn().mockResolvedValue({
        adapterKey: 'allegro.publicapi.v1',
        platformType: 'allegro',
        supportedCapabilities: ['OfferManager', 'OrderSource'],
        displayName: 'Allegro',
        version: '1.0.0',
      }),
    };
    lock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn().mockResolvedValue(undefined) };

    service = new ConnectionPricingSyncService(
      connections as never,
      connectionService as never,
      priceChanges as never,
      integrationsService as never,
      lock as never
    );
  });

  describe('getPricingSync', () => {
    it('reports `rule: null` for an unconfigured connection rather than synthesizing passthrough', async () => {
      const view = await service.getPricingSync(DEST_ID);

      expect(view.default).toEqual({ mode: 'manual', rule: null });
      expect(view.sources).toEqual([]);
      // No per-source loop: one countOpenBySource call, one connections.list() call.
      expect(priceChanges.countOpenBySource).toHaveBeenCalledTimes(1);
    });

    it('lists a configured source override with independent mode/rule overridden flags', async () => {
      connections.get.mockResolvedValue(
        buildConnection(DEST_ID, 'Allegro — PL', {
          pricingRule: {
            default: { type: 'markup', percent: 20, rounding: 'none' },
            sourceOverrides: { [SRC_ID]: { type: 'margin', percent: 30, rounding: 'endingIn99' } },
          },
          priceSyncMode: { default: 'manual', sourceOverrides: {} },
        })
      );
      connections.list.mockResolvedValue([buildConnection(SRC_ID, 'PrestaShop — Main Store')]);

      const view = await service.getPricingSync(DEST_ID);

      expect(view.sources).toHaveLength(1);
      expect(view.sources[0]).toEqual(
        expect.objectContaining({
          sourceConnectionId: SRC_ID,
          sourceLabel: 'PrestaShop — Main Store',
          modeOverridden: false,
          ruleOverridden: true,
          effective: { mode: 'manual', rule: { type: 'margin', percent: 30, rounding: 'endingIn99' } },
        })
      );
    });

    it('lists a source that only opted into automatic mode without materializing a rule override', async () => {
      connections.get.mockResolvedValue(
        buildConnection(DEST_ID, 'Allegro — PL', {
          pricingRule: { default: { type: 'markup', percent: 20, rounding: 'none' }, sourceOverrides: {} },
          priceSyncMode: { default: 'manual', sourceOverrides: { [SRC_ID]: 'automatic' } },
        })
      );
      connections.list.mockResolvedValue([buildConnection(SRC_ID, 'PrestaShop — Main Store')]);

      const view = await service.getPricingSync(DEST_ID);

      expect(view.sources[0].modeOverridden).toBe(true);
      expect(view.sources[0].ruleOverridden).toBe(false);
      expect(view.sources[0].effective.rule).toEqual({ type: 'markup', percent: 20, rounding: 'none' });
    });

    it('lists a source with an open episode but no configured override, using the batched count', async () => {
      priceChanges.countOpenBySource.mockResolvedValue(new Map([[SRC_ID, 3]]));
      connections.list.mockResolvedValue([buildConnection(SRC_ID, 'PrestaShop — Main Store')]);

      const view = await service.getPricingSync(DEST_ID);

      expect(view.sources).toHaveLength(1);
      expect(view.sources[0].modeOverridden).toBe(false);
      expect(view.sources[0].ruleOverridden).toBe(false);
      expect(view.sources[0].openEpisodeCount).toBe(3);
    });

    it('labels a source with no matching connection as Unknown connection rather than failing', async () => {
      priceChanges.countOpenBySource.mockResolvedValue(new Map([[SRC_ID, 1]]));
      connections.list.mockResolvedValue([]);

      const view = await service.getPricingSync(DEST_ID);

      expect(view.sources[0].sourceLabel).toBe('Unknown connection');
    });
  });

  describe('updatePricingSync', () => {
    it('merges pricingRule and priceSyncMode into config.update, preserving the rest of config, writing only supplied override halves', async () => {
      connections.get.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL', { currency: 'PLN' }));
      connectionService.update.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL'));

      await service.updatePricingSync(DEST_ID, {
        default: { mode: 'automatic', rule: { type: 'passthrough', percent: 0, rounding: 'none' } },
        sourceOverrides: {
          [SRC_ID]: { mode: 'manual', rule: { type: 'markup', percent: 15, rounding: 'none' } },
          'src-2': { mode: 'automatic' }, // mode-only opt-in — must NOT materialize a rule override
        },
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
            priceSyncMode: {
              default: 'automatic',
              sourceOverrides: { [SRC_ID]: 'manual', 'src-2': 'automatic' },
            },
          }),
        })
      );
    });

    it('writes `default.rule: null` verbatim rather than synthesizing a passthrough rule', async () => {
      connections.get.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL'));
      connectionService.update.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL'));

      await service.updatePricingSync(DEST_ID, {
        default: { mode: 'manual', rule: null },
        sourceOverrides: {},
      });

      expect(connectionService.update).toHaveBeenCalledWith(
        DEST_ID,
        expect.objectContaining({
          config: expect.objectContaining({
            pricingRule: { default: null, sourceOverrides: {} },
          }),
        })
      );
    });

    it('refuses the write when the connection is not a viable pricing destination (ADR-072 decision 2)', async () => {
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
        displayName: 'PrestaShop',
        version: '1.0.0',
      });

      await expect(
        service.updatePricingSync(DEST_ID, {
          default: { mode: 'manual', rule: null },
          sourceOverrides: {},
        })
      ).rejects.toThrow(BadRequestException);

      expect(connectionService.update).not.toHaveBeenCalled();
    });

    it('409s when the lock cannot be acquired (a concurrent write is in progress)', async () => {
      lock.acquire.mockResolvedValue(null);

      await expect(
        service.updatePricingSync(DEST_ID, { default: { mode: 'manual', rule: null }, sourceOverrides: {} })
      ).rejects.toThrow(ConflictException);

      expect(connectionService.update).not.toHaveBeenCalled();
      expect(lock.release).not.toHaveBeenCalled();
    });

    it('409s on a stale expectedUpdatedAt (lost-update guard)', async () => {
      connections.get.mockResolvedValue(
        buildConnection(DEST_ID, 'Allegro — PL', {}, new Date('2026-06-01T00:00:00.000Z'))
      );

      await expect(
        service.updatePricingSync(DEST_ID, {
          default: { mode: 'manual', rule: null },
          sourceOverrides: {},
          expectedUpdatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        })
      ).rejects.toThrow(ConflictException);

      expect(connectionService.update).not.toHaveBeenCalled();
      expect(lock.release).toHaveBeenCalled();
    });

    it('proceeds when expectedUpdatedAt matches the persisted value', async () => {
      const updatedAt = new Date('2026-06-01T00:00:00.000Z');
      connections.get.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL', {}, updatedAt));
      connectionService.update.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL'));

      await service.updatePricingSync(DEST_ID, {
        default: { mode: 'manual', rule: null },
        sourceOverrides: {},
        expectedUpdatedAt: updatedAt.toISOString(),
      });

      expect(connectionService.update).toHaveBeenCalled();
      expect(lock.release).toHaveBeenCalled();
    });

    it('releases the lock even when the update fails', async () => {
      connections.get.mockResolvedValue(buildConnection(DEST_ID, 'Allegro — PL'));
      connectionService.update.mockRejectedValue(new Error('boom'));

      await expect(
        service.updatePricingSync(DEST_ID, { default: { mode: 'manual', rule: null }, sourceOverrides: {} })
      ).rejects.toThrow('boom');

      expect(lock.release).toHaveBeenCalled();
    });
  });

  describe('getAsSource', () => {
    it('lists every destination naming this connection, config-derived or via an open episode, with split override flags', async () => {
      connections.list.mockResolvedValue([
        buildConnection('dest-a', 'Allegro — PL', {
          pricingRule: {
            default: { type: 'markup', percent: 20, rounding: 'none' },
            sourceOverrides: { [SRC_ID]: { type: 'margin', percent: 10, rounding: 'none' } },
          },
        }),
        buildConnection('dest-b', 'Erli — PL'),
        buildConnection(SRC_ID, 'PrestaShop — Main Store'), // excluded: self
      ]);
      priceChanges.listOpenDestinationConnectionIds.mockResolvedValue(['dest-b']);

      const result = await service.getAsSource(SRC_ID);

      expect(result.map((r) => r.destinationConnectionId).sort()).toEqual(['dest-a', 'dest-b']);
      const destA = result.find((r) => r.destinationConnectionId === 'dest-a');
      expect(destA?.ruleOverridden).toBe(true);
      expect(destA?.modeOverridden).toBe(false);
      const destB = result.find((r) => r.destinationConnectionId === 'dest-b');
      expect(destB?.ruleOverridden).toBe(false);
      expect(destB?.effectiveRuleSummary).toBeNull();
    });
  });
});
