/**
 * Dev Stack Health Service — Unit Tests
 *
 * Covers the Redis probe behavior that caused #159: a successful
 * PING + XADD must report `ok` even on a cold stack (no prior stream
 * entries), and Redis failures must surface as `error`.
 *
 * @module apps/api/src/health
 */
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { RedisClientType } from 'redis';
import { of, throwError } from 'rxjs';
import { DevStackHealthService } from './dev-stack-health.service';

describe('DevStackHealthService', () => {
  let service: DevStackHealthService;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;
  let redisClient: jest.Mocked<Pick<RedisClientType, 'ping' | 'xAdd'>>;
  let httpService: jest.Mocked<Pick<HttpService, 'get'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(() => {
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      xAdd: jest.fn().mockResolvedValue('0-1'),
    };
    httpService = { get: jest.fn().mockReturnValue(of({ status: 200 })) };
    configService = { get: jest.fn().mockReturnValue('http://localhost:8080') };

    service = new DevStackHealthService(
      dataSource as unknown as DataSource,
      redisClient as unknown as RedisClientType,
      httpService as unknown as HttpService,
      configService as unknown as ConfigService,
    );
  });

  describe('checkInternalHealth', () => {
    it('should report ok when postgres and redis are healthy on a cold stack', async () => {
      const result = await service.checkInternalHealth();

      expect(result.status).toBe('ok');
      expect(result.services.postgres.status).toBe('ok');
      expect(result.services.redis.status).toBe('ok');
      // #159 regression guard: probe must not depend on xRead / pre-seeded entries
      expect(redisClient.ping).toHaveBeenCalledTimes(1);
      expect(redisClient.xAdd).toHaveBeenCalledTimes(1);
    });

    it('should report error when redis ping fails', async () => {
      redisClient.ping.mockRejectedValueOnce(new Error('connection refused'));

      const result = await service.checkInternalHealth();

      expect(result.status).toBe('error');
      expect(result.services.redis.status).toBe('error');
      expect(result.services.redis.message).toContain('connection refused');
    });

    it('should report error when redis xAdd fails', async () => {
      redisClient.xAdd.mockRejectedValueOnce(new Error('streams unavailable'));

      const result = await service.checkInternalHealth();

      expect(result.status).toBe('error');
      expect(result.services.redis.status).toBe('error');
      expect(result.services.redis.message).toContain('streams unavailable');
    });

    it('should report error when postgres query fails', async () => {
      dataSource.query.mockRejectedValueOnce(new Error('db down'));

      const result = await service.checkInternalHealth();

      expect(result.status).toBe('error');
      expect(result.services.postgres.status).toBe('error');
    });
  });

  describe('checkDevStackHealth', () => {
    it('should report degraded when prestashop is unreachable but internals are ok', async () => {
      httpService.get.mockReturnValueOnce(throwError(() => new Error('ECONNREFUSED')));

      const result = await service.checkDevStackHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.prestashop.status).toBe('error');
      expect(result.services.postgres.status).toBe('ok');
      expect(result.services.redis.status).toBe('ok');
    });
  });
});
