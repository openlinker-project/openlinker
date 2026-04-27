/**
 * Redis Cache Adapter
 *
 * Implements CachePort over the global 'REDIS_CLIENT' provider exposed by
 * RedisConfigModule. Stores values as JSON; logs and returns null on parse
 * failure so callers can treat malformed cache entries as misses.
 *
 * @module libs/shared/src/cache
 * @implements {CachePort}
 */
import { Inject, Injectable } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { Logger } from '../logging';
import type { CachePort } from './cache.port';

@Injectable()
export class RedisCacheAdapter implements CachePort {
  private readonly logger = new Logger(RedisCacheAdapter.name);

  constructor(@Inject('REDIS_CLIENT') private readonly client: RedisClientType) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to parse cache value for key ${key}: ${message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), { EX: ttlSec });
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}
