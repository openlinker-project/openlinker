/**
 * Redis Sync Lock Service
 *
 * Redis-backed implementation of SyncLockPort using SET NX PX for acquisition
 * and a compare-and-delete Lua script for safe release.
 *
 * @module libs/core/src/sync/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisClientType } from 'redis';
import type { SyncLockPort, SyncLockToken } from '../ports/sync-lock.port';

@Injectable()
export class RedisSyncLockService implements SyncLockPort {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType
  ) {}

  async acquire(key: string, ttlMs: number): Promise<SyncLockToken | null> {
    if (!key || typeof key !== 'string') {
      throw new Error('Sync lock key must be a non-empty string');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error(`Sync lock ttlMs must be a positive number (got: ${ttlMs})`);
    }

    const token = randomUUID();

    // SET key value NX PX ttlMs — PX floored for the same reason `extend`
    // floors its PEXPIRE argument (Redis rejects a non-integer).
    const result = await this.redisClient.set(key, token, {
      NX: true,
      PX: Math.floor(ttlMs),
    });

    return result === 'OK' ? token : null;
  }

  async release(key: string, token: SyncLockToken): Promise<boolean> {
    if (!key || typeof key !== 'string') {
      throw new Error('Sync lock key must be a non-empty string');
    }
    if (!token || typeof token !== 'string') {
      throw new Error('Sync lock token must be a non-empty string');
    }

    // Compare-and-delete to avoid releasing somebody else's lock.
    // Returns 1 if deleted, 0 otherwise.
    const lua = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redisClient.eval(lua, {
      keys: [key],
      arguments: [token],
    });

    // node-redis returns number for eval result
    return result === 1;
  }

  async extend(key: string, token: SyncLockToken, ttlMs: number): Promise<boolean> {
    if (!key || typeof key !== 'string') {
      throw new Error('Sync lock key must be a non-empty string');
    }
    if (!token || typeof token !== 'string') {
      throw new Error('Sync lock token must be a non-empty string');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error(`Sync lock ttlMs must be a positive number (got: ${ttlMs})`);
    }

    // Compare-and-PEXPIRE, mirroring release()'s compare-and-delete: extending
    // an expired-and-reacquired key would stretch ANOTHER holder's lease, so
    // the token check and the PEXPIRE must be one atomic step.
    const lua = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await this.redisClient.eval(lua, {
      keys: [key],
      // Floored: PEXPIRE rejects a non-integer outright ("value is not an
      // integer or out of range"), which would surface as an opaque eval
      // throw rather than a lease decision. The port permits any positive
      // finite number, so the coercion belongs here.
      arguments: [token, String(Math.floor(ttlMs))],
    });

    return result === 1;
  }
}
