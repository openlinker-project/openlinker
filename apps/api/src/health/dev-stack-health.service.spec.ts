/**
 * Dev Stack Health Service — Unit Tests
 *
 * Covers the Redis probe behavior that caused #159: a successful
 * PING + XADD must report `ok` even on a cold stack (no prior stream
 * entries), and Redis failures must surface as `error`.
 *
 * @module apps/api/src/health
 */
import type { DataSource } from 'typeorm';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import { of, throwError } from 'rxjs';
import { DevStackHealthService } from './dev-stack-health.service';
import type { IConnectionInfraHealthService } from './connection-infra-health.service.interface';

describe('DevStackHealthService', () => {
  let service: DevStackHealthService;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;
  let redisClient: jest.Mocked<Pick<RedisClientType, 'ping' | 'xAdd' | 'get'>>;
  let httpService: jest.Mocked<Pick<HttpService, 'get'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let connectionInfraHealthService: jest.Mocked<IConnectionInfraHealthService>;

  beforeEach(() => {
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      xAdd: jest.fn().mockResolvedValue('0-1'),
      get: jest.fn().mockResolvedValue(String(Date.now())), // Fresh heartbeat by default
    };
    httpService = { get: jest.fn().mockReturnValue(of({ status: 200 })) };
    configService = { get: jest.fn().mockReturnValue('http://localhost:8080') };
    connectionInfraHealthService = { checkInfraConnections: jest.fn().mockResolvedValue([]) };

    service = new DevStackHealthService(
      dataSource as unknown as DataSource,
      redisClient as unknown as RedisClientType,
      httpService as unknown as HttpService,
      configService as unknown as ConfigService,
      connectionInfraHealthService
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

    it('should include worker status in dev stack health', async () => {
      const result = await service.checkDevStackHealth();

      expect(result.services.worker).toBeDefined();
      expect(result.services.worker.status).toBe('ok');
    });

    it('should include infra-bearing connections in dev stack health', async () => {
      connectionInfraHealthService.checkInfraConnections.mockResolvedValueOnce([
        {
          connectionId: 'conn-1',
          name: 'My WooCommerce Shop',
          platformType: 'woocommerce',
          status: 'ok',
        },
      ]);

      const result = await service.checkDevStackHealth();

      expect(result.connections).toEqual([
        {
          connectionId: 'conn-1',
          name: 'My WooCommerce Shop',
          platformType: 'woocommerce',
          status: 'ok',
        },
      ]);
      expect(result.status).toBe('ok');
    });

    it('should report degraded when an infra-bearing connection is unhealthy but internals are ok', async () => {
      connectionInfraHealthService.checkInfraConnections.mockResolvedValueOnce([
        {
          connectionId: 'conn-1',
          name: 'My WooCommerce Shop',
          platformType: 'woocommerce',
          status: 'error',
          message: 'Unauthorized',
        },
      ]);

      const result = await service.checkDevStackHealth();

      expect(result.status).toBe('degraded');
      expect(result.connections[0].status).toBe('error');
    });

    it('should report empty connections and not fail when the infra rollup throws', async () => {
      connectionInfraHealthService.checkInfraConnections.mockRejectedValueOnce(
        new Error('registry unavailable')
      );

      const result = await service.checkDevStackHealth();

      expect(result.connections).toEqual([]);
      expect(result.status).toBe('ok');
    });

    it('should report degraded when worker is stale but internals are ok', async () => {
      // Heartbeat from 90 seconds ago (past 60s warning threshold)
      redisClient.get.mockResolvedValueOnce(String(Date.now() - 90_000));

      const result = await service.checkDevStackHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.worker.status).toBe('error');
      expect(result.services.worker.message).toContain('90');
    });
  });

  describe('checkWorker', () => {
    it('should report ok when worker heartbeat is fresh', async () => {
      redisClient.get.mockResolvedValueOnce(String(Date.now() - 5_000)); // 5s old

      const result = await service.checkDevStackHealth();

      expect(result.services.worker.status).toBe('ok');
      expect(result.services.worker.message).toBeUndefined();
    });

    it('should report warning when worker heartbeat is stale (30-60s)', async () => {
      redisClient.get.mockResolvedValueOnce(String(Date.now() - 45_000)); // 45s old

      const result = await service.checkDevStackHealth();

      expect(result.services.worker.status).toBe('warning');
      expect(result.services.worker.message).toContain('45');
    });

    it('should report error when worker heartbeat is very stale (>60s)', async () => {
      redisClient.get.mockResolvedValueOnce(String(Date.now() - 90_000)); // 90s old

      const result = await service.checkDevStackHealth();

      expect(result.services.worker.status).toBe('error');
      expect(result.services.worker.message).toContain('90');
    });

    it('should report error when worker heartbeat key is absent', async () => {
      redisClient.get.mockResolvedValueOnce(null);

      const result = await service.checkDevStackHealth();

      expect(result.services.worker.status).toBe('error');
      expect(result.services.worker.message).toContain('not running');
    });

    it('should report error when redis get fails', async () => {
      redisClient.get.mockRejectedValueOnce(new Error('connection lost'));

      const result = await service.checkDevStackHealth();

      expect(result.services.worker.status).toBe('error');
      expect(result.services.worker.message).toContain('health check failed');
    });
  });
});
