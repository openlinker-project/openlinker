/**
 * Dev Stack Health Service
 *
 * Implements development stack health checking operations. Checks connectivity
 * and health of PostgreSQL, Redis, and PrestaShop services. PrestaShop is
 * treated as an external dependency - if unreachable, returns degraded status
 * rather than error.
 *
 * @module apps/api/src/health
 * @implements {IDevStackHealthService}
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { RedisClientType } from 'redis';
import { WORKER_HEARTBEAT_REDIS_KEY } from '@openlinker/shared/worker';
import type { IDevStackHealthService } from './dev-stack-health.service.interface';
import { IConnectionInfraHealthService } from './connection-infra-health.service.interface';
import { CONNECTION_INFRA_HEALTH_SERVICE_TOKEN } from './health.tokens';
import { withTimeout } from './with-timeout.util';
import type {
  InternalHealthReadiness,
  DevStackHealthResponse,
  ConnectionHealthEntry,
  ServiceHealth,
  ServiceStatus,
} from './dev-stack-health.types';

@Injectable()
export class DevStackHealthService implements IDevStackHealthService {
  private readonly logger = new Logger(DevStackHealthService.name);
  private readonly CHECK_TIMEOUT_MS = 5000;
  private readonly HEALTHCHECK_STREAM = 'healthcheck';
  private readonly WORKER_OK_MS = 30_000; // 30 seconds
  private readonly WORKER_WARN_MS = 60_000; // 60 seconds

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(CONNECTION_INFRA_HEALTH_SERVICE_TOKEN)
    private readonly connectionInfraHealthService: IConnectionInfraHealthService
  ) {}

  async checkInternalHealth(): Promise<InternalHealthReadiness> {
    const services = {
      postgres: await this.checkPostgres(),
      redis: await this.checkRedis(),
    };

    // Determine overall status - internal services only
    const hasError = services.postgres.status === 'error' || services.redis.status === 'error';

    const status: 'ok' | 'error' = hasError ? 'error' : 'ok';

    return {
      status,
      services,
      timestamp: new Date().toISOString(),
    };
  }

  async checkDevStackHealth(): Promise<DevStackHealthResponse> {
    // Run all checks in parallel so checkWorker()'s GET reaches Redis before
    // checkRedis()'s xAdd is queued, preventing pipeline blocking.
    const [postgres, redis, prestashop, worker, connections] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkPrestaShop(),
      this.checkWorker(),
      this.checkInfraConnections(),
    ]);
    const services = { postgres, redis, prestashop, worker };

    // Determine overall status
    // Priority: internal errors > external errors > all ok
    const hasInternalError =
      services.postgres.status === 'error' || services.redis.status === 'error';
    const hasExternalError =
      services.prestashop.status === 'error' ||
      services.worker.status === 'error' ||
      services.worker.status === 'warning' ||
      connections.some(
        (connection) => connection.status === 'error' || connection.status === 'warning'
      );

    let status: 'ok' | 'degraded' | 'error';
    if (hasInternalError) {
      // Internal services (PostgreSQL, Redis) are down - critical error
      status = 'error';
    } else if (hasExternalError) {
      // Internal services are healthy, but an external dependency (PrestaShop,
      // worker, or an infra-bearing connection) is down/slow - degraded
      status = 'degraded';
    } else {
      // All services (internal + external) are healthy
      status = 'ok';
    }

    return {
      status,
      services,
      connections,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkInfraConnections(): Promise<ConnectionHealthEntry[]> {
    try {
      return await this.connectionInfraHealthService.checkInfraConnections();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Infra connection health rollup failed: ${errorMessage}`, error);
      return [];
    }
  }

  private async checkPostgres(): Promise<ServiceHealth> {
    try {
      await withTimeout(
        this.dataSource.query('SELECT 1'),
        'PostgreSQL health check timeout',
        this.CHECK_TIMEOUT_MS
      );
      return { status: 'ok' as ServiceStatus };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`PostgreSQL health check failed: ${errorMessage}`, error);
      return {
        status: 'error' as ServiceStatus,
        message: `PostgreSQL connection failed: ${errorMessage}`,
      };
    }
  }

  private async checkRedis(): Promise<ServiceHealth> {
    try {
      const streamKey = this.HEALTHCHECK_STREAM;
      const timestamp = Date.now().toString();

      await withTimeout(this.redisClient.ping(), 'Redis ping timeout', this.CHECK_TIMEOUT_MS);

      // Exercise Redis Streams with a non-blocking write. XADD succeeds iff
      // the server supports Streams and accepts writes; no read-back needed,
      // which avoids false positives on cold boot when consumer groups or
      // stream entries are not yet initialized.
      await withTimeout(
        this.redisClient.xAdd(
          streamKey,
          '*',
          { timestamp },
          {
            TRIM: {
              strategy: 'MAXLEN',
              strategyModifier: '~',
              threshold: 1,
            },
          }
        ),
        'Redis xAdd timeout',
        this.CHECK_TIMEOUT_MS
      );

      return { status: 'ok' as ServiceStatus };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Redis health check failed: ${errorMessage}`, error);
      return {
        status: 'error' as ServiceStatus,
        message: `Redis connection or Streams test failed: ${errorMessage}`,
      };
    }
  }

  private async checkPrestaShop(): Promise<ServiceHealth> {
    try {
      const baseUrl = this.configService.get<string>(
        'PRESTASHOP_BASE_URL',
        'http://localhost:8080'
      );

      if (!baseUrl || (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://'))) {
        return {
          status: 'error' as ServiceStatus,
          message:
            'Invalid PRESTASHOP_BASE_URL configuration (must start with http:// or https://)',
        };
      }

      // Accept 200 OK or 302 redirect (login redirects are common)
      // Timeout is set in the pipe, not in axios config to avoid double timeout
      const response = await firstValueFrom(
        this.httpService
          .get(baseUrl, {
            validateStatus: (status) => status === 200 || status === 302,
            maxRedirects: 5,
          })
          .pipe(timeout(this.CHECK_TIMEOUT_MS))
      );

      if (response.status === 200 || response.status === 302) {
        return { status: 'ok' as ServiceStatus };
      }

      return {
        status: 'error' as ServiceStatus,
        message: `PrestaShop returned status ${response.status}`,
      };
    } catch (error) {
      // PrestaShop is external - log but don't treat as critical error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`PrestaShop health check failed (external dependency): ${errorMessage}`);
      return {
        status: 'error' as ServiceStatus,
        message: 'PrestaShop is unreachable',
      };
    }
  }

  private async checkWorker(): Promise<ServiceHealth> {
    try {
      const heartbeat = await withTimeout(
        this.redisClient.get(WORKER_HEARTBEAT_REDIS_KEY),
        'Worker heartbeat check timeout',
        this.CHECK_TIMEOUT_MS
      );

      if (!heartbeat) {
        return {
          status: 'error' as ServiceStatus,
          message: 'Worker is not running',
        };
      }

      const age = Date.now() - parseInt(heartbeat, 10);

      if (age <= this.WORKER_OK_MS) {
        return { status: 'ok' as ServiceStatus };
      }

      if (age <= this.WORKER_WARN_MS) {
        return {
          status: 'warning' as ServiceStatus,
          message: `Worker last seen ${Math.round(age / 1000)}s ago`,
        };
      }

      return {
        status: 'error' as ServiceStatus,
        message: `Worker last seen ${Math.round(age / 1000)}s ago`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Worker health check failed: ${errorMessage}`, error);
      return {
        status: 'error' as ServiceStatus,
        message: 'Worker health check failed',
      };
    }
  }
}
