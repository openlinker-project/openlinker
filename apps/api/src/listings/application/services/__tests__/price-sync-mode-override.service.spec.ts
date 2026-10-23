/**
 * Price Sync Mode Override Service tests (#3162 review)
 *
 * @module apps/api/src/listings/application/services/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { PriceSyncModeOverrideService } from '../price-sync-mode-override.service';

const DEST_ID = 'dest-1';
const SRC_ID = 'src-1';

function buildConnection(config: Record<string, unknown> = {}): Connection {
  return new Connection(
    DEST_ID,
    'allegro',
    'Allegro — PL',
    'active',
    config,
    'ref',
    new Date(),
    new Date(),
    undefined,
    []
  );
}

describe('PriceSyncModeOverrideService', () => {
  let connections: { get: jest.Mock; update: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock; extend: jest.Mock };
  let service: PriceSyncModeOverrideService;

  beforeEach(() => {
    connections = {
      get: jest.fn().mockResolvedValue(buildConnection()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    lock = {
      acquire: jest.fn().mockResolvedValue('token-1'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    };
    service = new PriceSyncModeOverrideService(connections as never, lock as never);
  });

  it('merges the source override into config and writes it through IConnectionService', async () => {
    const result = await service.setSourceOverrideAutomatic({
      destinationConnectionId: DEST_ID,
      sourceConnectionId: SRC_ID,
    });

    expect(result).toBe(true);
    expect(connections.update).toHaveBeenCalledWith(
      DEST_ID,
      expect.objectContaining({
        config: expect.objectContaining({
          priceSyncMode: { default: 'manual', sourceOverrides: { [SRC_ID]: 'automatic' } },
        }),
      })
    );
  });

  it('locks per destination connection and always releases', async () => {
    await service.setSourceOverrideAutomatic({
      destinationConnectionId: DEST_ID,
      sourceConnectionId: SRC_ID,
    });

    expect(lock.acquire).toHaveBeenCalledWith(`pricing:sync-mode:${DEST_ID}`, expect.any(Number));
    expect(lock.release).toHaveBeenCalledWith(`pricing:sync-mode:${DEST_ID}`, 'token-1');
  });

  it('returns false (never throws) when the lock cannot be acquired', async () => {
    lock.acquire.mockResolvedValue(null);

    const result = await service.setSourceOverrideAutomatic({
      destinationConnectionId: DEST_ID,
      sourceConnectionId: SRC_ID,
    });

    expect(result).toBe(false);
    expect(connections.update).not.toHaveBeenCalled();
  });

  it('returns false (never throws) when IConnectionService.update rejects — e.g. #2610 validation', async () => {
    connections.update.mockRejectedValue(new Error('config.priceSyncMode is malformed'));

    const result = await service.setSourceOverrideAutomatic({
      destinationConnectionId: DEST_ID,
      sourceConnectionId: SRC_ID,
    });

    expect(result).toBe(false);
    // The lock is still released even though the write failed.
    expect(lock.release).toHaveBeenCalled();
  });

  it('preserves an existing sourceOverrides entry for a different source', async () => {
    connections.get.mockResolvedValue(
      buildConnection({
        priceSyncMode: { default: 'manual', sourceOverrides: { 'other-src': 'automatic' } },
      })
    );

    await service.setSourceOverrideAutomatic({
      destinationConnectionId: DEST_ID,
      sourceConnectionId: SRC_ID,
    });

    expect(connections.update).toHaveBeenCalledWith(
      DEST_ID,
      expect.objectContaining({
        config: expect.objectContaining({
          priceSyncMode: {
            default: 'manual',
            sourceOverrides: { 'other-src': 'automatic', [SRC_ID]: 'automatic' },
          },
        }),
      })
    );
  });

  describe('setSourceOverridesAutomatic', () => {
    it('applies each pair sequentially', async () => {
      await service.setSourceOverridesAutomatic([
        { destinationConnectionId: DEST_ID, sourceConnectionId: SRC_ID },
        { destinationConnectionId: 'dest-2', sourceConnectionId: 'src-2' },
      ]);

      expect(connections.get).toHaveBeenCalledTimes(2);
      expect(connections.update).toHaveBeenCalledTimes(2);
    });

    it('is a no-op for an empty list', async () => {
      const outcomes = await service.setSourceOverridesAutomatic([]);
      expect(connections.get).not.toHaveBeenCalled();
      expect(outcomes).toEqual([]);
    });

    it('reports each pair\'s own outcome rather than discarding it (#3162 re-review, IMPORTANT)', async () => {
      connections.update
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('config.priceSyncMode is malformed'));

      const outcomes = await service.setSourceOverridesAutomatic([
        { destinationConnectionId: DEST_ID, sourceConnectionId: SRC_ID },
        { destinationConnectionId: 'dest-2', sourceConnectionId: 'src-2' },
      ]);

      expect(outcomes).toEqual([
        { destinationConnectionId: DEST_ID, sourceConnectionId: SRC_ID, applied: true },
        { destinationConnectionId: 'dest-2', sourceConnectionId: 'src-2', applied: false },
      ]);
    });
  });
});
