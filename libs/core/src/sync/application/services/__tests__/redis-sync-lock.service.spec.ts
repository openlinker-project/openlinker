/**
 * Redis Sync Lock Service Unit Tests
 *
 * Pins the lease heartbeat added for #2279: `extend` is an atomic
 * compare-and-PEXPIRE (never a bare PEXPIRE, which would stretch another
 * holder's lease after expiry-and-reacquisition), reports loss as `false`
 * rather than an error, and validates its inputs like acquire/release do.
 *
 * Also pins the #2716 self-recognition fix: `acquire` distinguishes genuine
 * contention (a different holder's token) from a transport-level resend of
 * the SAME request landing after its own SET already won.
 *
 * @module libs/core/src/sync/application/services
 */
import type { RedisClientType } from 'redis';
import { RedisSyncLockService } from '../redis-sync-lock.service';

describe('RedisSyncLockService', () => {
  let redisClient: { set: jest.Mock; get: jest.Mock; eval: jest.Mock };
  let service: RedisSyncLockService;

  beforeEach(() => {
    redisClient = { set: jest.fn(), get: jest.fn(), eval: jest.fn() };
    service = new RedisSyncLockService(redisClient as unknown as RedisClientType);
  });

  describe('acquire', () => {
    it('acquires with SET NX PX and returns the minted token', async () => {
      redisClient.set.mockResolvedValue('OK');

      const token = await service.acquire('lock:a', 5_000);

      expect(token).toEqual(expect.any(String));
      expect(redisClient.set).toHaveBeenCalledWith('lock:a', token, { NX: true, PX: 5_000 });
      expect(redisClient.get).not.toHaveBeenCalled();
    });

    it('returns null when NX fails and a different holder owns the key', async () => {
      redisClient.set.mockResolvedValue(null);
      redisClient.get.mockResolvedValue('someone-elses-token');

      await expect(service.acquire('lock:a', 5_000)).resolves.toBeNull();
      expect(redisClient.get).toHaveBeenCalledWith('lock:a');
    });

    it('#2716: recognizes its own resent request instead of reporting contention against itself', async () => {
      let mintedToken: string | undefined;
      redisClient.set.mockImplementation((_key: string, value: string) => {
        mintedToken = value;
        // Simulates the SET's own OK response being lost/delayed while the
        // key was in fact written — the caller observes NX failure.
        return Promise.resolve(null);
      });
      redisClient.get.mockImplementation(() => Promise.resolve(mintedToken));

      const token = await service.acquire('lock:a', 5_000);

      expect(token).toBe(mintedToken);
      expect(token).not.toBeNull();
    });
  });

  describe('extend (#2279 lease heartbeat)', () => {
    it('extends via an atomic compare-and-PEXPIRE script keyed on the token', async () => {
      redisClient.eval.mockResolvedValue(1);

      const extended = await service.extend('lock:a', 'tok-1', 60_000);

      expect(extended).toBe(true);
      const [lua, options] = redisClient.eval.mock.calls[0] as [
        string,
        { keys: string[]; arguments: string[] },
      ];
      expect(lua).toContain('GET');
      expect(lua).toContain('PEXPIRE');
      expect(options.keys).toEqual(['lock:a']);
      expect(options.arguments).toEqual(['tok-1', '60000']);
    });

    it('reports false — never throws — when the lock expired or another holder claimed it', async () => {
      redisClient.eval.mockResolvedValue(0);

      await expect(service.extend('lock:a', 'stale-token', 60_000)).resolves.toBe(false);
    });

    it('rejects a non-positive ttl before touching Redis', async () => {
      await expect(service.extend('lock:a', 'tok-1', 0)).rejects.toThrow('positive number');
      expect(redisClient.eval).not.toHaveBeenCalled();
    });

    it('rejects an empty token before touching Redis', async () => {
      await expect(service.extend('lock:a', '', 60_000)).rejects.toThrow('non-empty string');
      expect(redisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('releases via compare-and-delete and reports whether it deleted', async () => {
      redisClient.eval.mockResolvedValue(1);
      await expect(service.release('lock:a', 'tok-1')).resolves.toBe(true);

      redisClient.eval.mockResolvedValue(0);
      await expect(service.release('lock:a', 'tok-1')).resolves.toBe(false);
    });
  });
});
